#!/usr/bin/env python3
"""同步课程归集影响仓库的 README 与 GitHub description，并生成可恢复凭据。"""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OWNER = "HIT-Fireworks"
MANIFEST = ROOT / "data/repository-manifest.no-collection.v4.json"
TOPOLOGY = ROOT / "config/repository-topology.v4.json"
REGISTRY_RECEIPT = ROOT / "data/registry-generation6-publish-verification.v1.json"
RECEIPT = ROOT / "data/course-cluster-metadata-publish-verification.v1.json"
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GOMAXPROCS": "1"}

spec = importlib.util.spec_from_file_location(
    "registry_validation", ROOT / "scripts/validate-registry.py"
)
assert spec and spec.loader
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)

description_spec = importlib.util.spec_from_file_location(
    "repository_description", ROOT / "scripts/repository_description.py"
)
assert description_spec and description_spec.loader
repository_description = importlib.util.module_from_spec(description_spec)
description_spec.loader.exec_module(repository_description)
repository_readme = repository_description.repository_readme
stable_repository_description = repository_description.stable_repository_description

def compact(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()


def save(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(compact(value))
    os.replace(temporary, path)


def run(args: list[str], data: bytes | None = None, timeout: int = 120) -> bytes:
    process = subprocess.run(
        args,
        cwd=ROOT,
        env=ENV,
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if process.returncode:
        raise RuntimeError(
            f"{args[:4]}: {process.stderr.decode('utf8', 'replace')}"
        )
    return process.stdout


def git_json(revision: str, path: str) -> dict[str, Any]:
    return json.loads(run(["git", "show", f"{revision}:{path}"]))


def api(endpoint: str, method: str = "GET", payload: Any | None = None) -> Any:
    args = ["gh", "api", endpoint, "--method", method]
    data = None
    if payload is not None:
        args += ["--input", "-"]
        data = compact(payload)
    attempts = 3 if method == "GET" else 1
    for attempt in range(attempts):
        try:
            raw = run(args, data=data, timeout=120)
            return json.loads(raw) if raw.strip() else None
        except (RuntimeError, subprocess.TimeoutExpired):
            if attempt + 1 == attempts:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def current_snapshot() -> tuple[dict[str, Any], dict[str, Any], dict[str, str]]:
    validation.validate(ROOT)
    topology = json.loads(TOPOLOGY.read_text(encoding="utf8"))
    store = validation.Store(MANIFEST)
    store.verify()
    manifest = store.object()
    names: dict[str, str] = {}
    for raw in store.items(manifest["course_descriptors"], "array"):
        descriptor = store.expand(raw)
        names[descriptor["course_code"]] = (
            descriptor.get("course_name") or "教务未提供名称"
        )
    return topology, manifest, names


def previous_topology(current_generation: int) -> tuple[str, dict[str, Any]]:
    commits = run(
        ["git", "log", "--format=%H", "--", "config/repository-topology.v4.json"]
    ).decode().splitlines()
    for commit in commits:
        value = git_json(commit, "config/repository-topology.v4.json")
        if int(value.get("generation", 0)) == current_generation - 1:
            return commit, value
    raise RuntimeError(f"找不到 generation {current_generation - 1} topology 基线")


def affected_repository_ids(
    previous: dict[str, Any], current: dict[str, Any]
) -> list[str]:
    before = previous["repositories"]
    after = current["repositories"]
    result = []
    for repo_id in sorted(after):
        old = before.get(repo_id, {})
        new = after[repo_id]
        if (
            old.get("course_codes", []) != new.get("course_codes", [])
            or old.get("display_name") != new.get("display_name")
        ):
            result.append(repo_id)
    return result


def expected_repositories(registry_head: str) -> dict[str, dict[str, Any]]:
    topology, manifest, names = current_snapshot()
    generation = int(topology["generation"])
    baseline_ref, baseline = previous_topology(generation)
    listed = {row["repo_id"]: row for row in manifest["repositories"]}
    result: dict[str, dict[str, Any]] = {}
    for repo_id in affected_repository_ids(baseline, topology):
        repository = listed[repo_id]
        mapping = {
            code: names.get(code) or "教务未提供名称"
            for code in repository.get("course_codes", [])
        }
        readme = repository_readme(
            repo_type=repository["repo_type"], course_mapping=mapping
        )
        description = stable_repository_description(
            repository["repo_type"],
            repository["display_name"],
            repo_id=repo_id,
            course_mapping=mapping,
        )
        if repository.get("description") != description:
            raise RuntimeError(f"manifest description 与生成契约不一致：{repo_id}")
        readme_bytes = readme.encode()
        readme_sha = hashlib.sha1(
            f"blob {len(readme_bytes)}\0".encode() + readme_bytes
        ).hexdigest()
        result[repo_id] = {
            "repo_id": repo_id,
            "course_code_count": len(mapping),
            "description": description,
            "readme": readme,
            "readme_blob_sha1": readme_sha,
        }
    return {
        "generation": generation,
        "baseline_ref": baseline_ref,
        "registry_head": registry_head,
        "repositories": result,
    }


def plan_identity(plan: dict[str, Any]) -> str:
    projection = {
        "generation": plan["generation"],
        "baseline_ref": plan["baseline_ref"],
        "registry_head": plan["registry_head"],
        "repositories": {
            repo_id: {
                key: value
                for key, value in repository.items()
                if key != "readme"
            }
            for repo_id, repository in plan["repositories"].items()
        },
    }
    return hashlib.sha256(compact(projection)).hexdigest()


def remote_state(repo_id: str) -> dict[str, Any]:
    metadata = api(f"repos/{OWNER}/{repo_id}")
    reference = api(f"repos/{OWNER}/{repo_id}/git/ref/heads/main")
    head = reference["object"]["sha"]
    commit = api(f"repos/{OWNER}/{repo_id}/git/commits/{head}")
    tree = api(
        f"repos/{OWNER}/{repo_id}/git/trees/{commit['tree']['sha']}?recursive=1"
    )
    if tree.get("truncated"):
        raise RuntimeError(f"{repo_id}: 截断 tree 禁止用于元数据同步")
    entries = {row["path"]: row for row in tree["tree"] if row["type"] != "tree"}
    return {
        "id": metadata["id"],
        "node_id": metadata["node_id"],
        "description": metadata.get("description") or "",
        "head": head,
        "tree": commit["tree"]["sha"],
        "readme_blob_sha1": entries.get("README.md", {}).get("sha"),
    }


def create_readme_commit(repo_id: str, parent: str, base_tree: str, expected: dict[str, Any]) -> str:
    blob = api(
        f"repos/{OWNER}/{repo_id}/git/blobs",
        "POST",
        {"content": base64.b64encode(expected["readme"].encode()).decode(), "encoding": "base64"},
    )
    if blob["sha"] != expected["readme_blob_sha1"]:
        raise RuntimeError(f"{repo_id}: README blob 身份不一致")
    tree = api(
        f"repos/{OWNER}/{repo_id}/git/trees",
        "POST",
        {
            "base_tree": base_tree,
            "tree": [
                {
                    "path": "README.md",
                    "mode": "100644",
                    "type": "blob",
                    "sha": blob["sha"],
                }
            ],
        },
    )
    commit = api(
        f"repos/{OWNER}/{repo_id}/git/commits",
        "POST",
        {
            "message": "docs: 同步 generation 6 课程映射",
            "tree": tree["sha"],
            "parents": [parent],
        },
    )
    api(
        f"repos/{OWNER}/{repo_id}/git/refs/heads/main",
        "PATCH",
        {"sha": commit["sha"], "force": False},
    )
    return commit["sha"]


def load_registry_receipt() -> dict[str, Any]:
    if not REGISTRY_RECEIPT.is_file():
        raise RuntimeError("Registry generation 6 发布凭据缺失")
    receipt = json.loads(REGISTRY_RECEIPT.read_text(encoding="utf8"))
    if receipt.get("status") != "completed" or receipt.get("generation") != 6:
        raise RuntimeError("Registry generation 6 尚未完成")
    if api(f"repos/{OWNER}/fireworks-course-registry-v2/commits/main")["sha"] != receipt["head"]:
        raise RuntimeError("Registry 远端 HEAD 与 generation 6 凭据不一致")
    return receipt


def synchronize() -> dict[str, Any]:
    registry_receipt = load_registry_receipt()
    plan = expected_repositories(registry_receipt["head"])
    identity = plan_identity(plan)
    if RECEIPT.exists():
        receipt = json.loads(RECEIPT.read_text(encoding="utf8"))
        if receipt.get("plan_identity_sha256") != identity:
            raise RuntimeError("仓库元数据发布凭据与当前计划不一致")
    else:
        receipt = {
            "schema_version": 1,
            "generation": 6,
            "registry_head": registry_receipt["head"],
            "plan_identity_sha256": identity,
            "status": "prepared",
            "repositories": {},
        }
        save(RECEIPT, receipt)

    for repo_id, expected in plan["repositories"].items():
        prior = receipt["repositories"].get(repo_id)
        current = remote_state(repo_id)
        if prior:
            if current["id"] != prior["repository_id"] or current["node_id"] != prior["node_id"]:
                raise RuntimeError(f"{repo_id}: 仓库身份变化")
            if current["head"] not in {prior["parent"], prior["head"]}:
                raise RuntimeError(f"{repo_id}: main 在元数据同步期间漂移")
        else:
            prior = {
                "repository_id": current["id"],
                "node_id": current["node_id"],
                "parent": current["head"],
                "head": current["head"],
                "status": "prepared",
            }
            receipt["repositories"][repo_id] = prior
            save(RECEIPT, receipt)

        if current["readme_blob_sha1"] != expected["readme_blob_sha1"]:
            if current["head"] != prior["parent"]:
                raise RuntimeError(f"{repo_id}: 已发布 HEAD 的 README 与预期不一致")
            prior["head"] = create_readme_commit(
                repo_id, current["head"], current["tree"], expected
            )
            save(RECEIPT, receipt)
            current = remote_state(repo_id)

        if current["description"] != expected["description"]:
            api(
                f"repos/{OWNER}/{repo_id}",
                "PATCH",
                {"description": expected["description"]},
            )
            current = remote_state(repo_id)

        if (
            current["head"] != prior["head"]
            or current["readme_blob_sha1"] != expected["readme_blob_sha1"]
            or current["description"] != expected["description"]
        ):
            raise RuntimeError(f"{repo_id}: README 或 description 核验失败")
        prior.update(
            {
                "status": "completed",
                "course_code_count": expected["course_code_count"],
                "readme_blob_sha1": expected["readme_blob_sha1"],
                "description": expected["description"],
            }
        )
        save(RECEIPT, receipt)
        print(f"{repo_id}: README/description 已核验", flush=True)

    receipt["status"] = "completed"
    receipt["verified_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save(RECEIPT, receipt)
    return receipt


def verify() -> dict[str, Any]:
    registry_receipt = load_registry_receipt()
    plan = expected_repositories(registry_receipt["head"])
    identity = plan_identity(plan)
    if not RECEIPT.is_file():
        raise RuntimeError("仓库元数据发布凭据缺失")
    receipt = json.loads(RECEIPT.read_text(encoding="utf8"))
    if receipt.get("status") != "completed" or receipt.get("plan_identity_sha256") != identity:
        raise RuntimeError("仓库元数据发布凭据未完成或身份不一致")
    for repo_id, expected in plan["repositories"].items():
        current = remote_state(repo_id)
        row = receipt["repositories"].get(repo_id, {})
        if (
            row.get("status") != "completed"
            or current["head"] != row.get("head")
            or current["readme_blob_sha1"] != expected["readme_blob_sha1"]
            or current["description"] != expected["description"]
        ):
            raise RuntimeError(f"{repo_id}: 远端元数据验证失败")
    return {
        "valid": True,
        "generation": 6,
        "registry_head": registry_receipt["head"],
        "repository_count": len(plan["repositories"]),
        "plan_identity_sha256": identity,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["plan", "apply", "verify"])
    args = parser.parse_args()
    if args.phase == "plan":
        registry_receipt = load_registry_receipt()
        plan = expected_repositories(registry_receipt["head"])
        print(
            json.dumps(
                {
                    "generation": plan["generation"],
                    "baseline_ref": plan["baseline_ref"],
                    "registry_head": plan["registry_head"],
                    "affected_repositories": sorted(plan["repositories"]),
                    "plan_identity_sha256": plan_identity(plan),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    elif args.phase == "apply":
        print(json.dumps(synchronize(), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(verify(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
