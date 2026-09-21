#!/usr/bin/env python3
"""按已批准 Issue 课程集合更新 v4 Registry、拓扑和仓库路由。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/repository-manifest.no-collection.v4.json"
ROUTES = ROOT / "config/repository-file-routes.v4.json"
TOPOLOGY = ROOT / "config/repository-topology.v4.json"
CONFIG = ROOT / "config/course-cluster-issues.v1.json"
REPORT = ROOT / ".vitepress/cache/course-cluster-issues-report.v1.json"
SHARD_STORE = ROOT / "data/.fireworks-json"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def compact_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
        stream.write(content)
        temporary = Path(stream.name)
    os.replace(temporary, path)


def natural_key(value: str) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value))


def unique(values: list[str] | set[str]) -> list[str]:
    return sorted(set(values), key=natural_key)


def stable_description(repo_type: str, display_name: str, repo_id: str, mapping: dict[str, str]) -> str:
    module_path = ROOT / "scripts/repository_description.py"
    spec = importlib.util.spec_from_file_location("cluster_repository_description", module_path)
    if not spec or not spec.loader:
        raise RuntimeError(f"无法加载仓库描述模块：{module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.stable_repository_description(repo_type, display_name, repo_id=repo_id, course_mapping=mapping)


def shard_refs(root: dict[str, Any], field: str) -> list[dict[str, Any]]:
    value = root.get(field)
    if not isinstance(value, dict) or value.get("$fireworks_shards") != 1 or value.get("kind") != "array":
        raise RuntimeError(f"manifest.{field} 不是预期数组分片")
    refs = value.get("parts")
    if not isinstance(refs, list) or not refs:
        raise RuntimeError(f"manifest.{field} 缺少分片")
    return refs


def read_shard(ref: dict[str, Any]) -> list[dict[str, Any]]:
    file = SHARD_STORE / f"{ref['sha256']}.json"
    content = file.read_bytes()
    if len(content) != ref["bytes"] or sha256_bytes(content) != ref["sha256"]:
        raise RuntimeError(f"分片完整性校验失败：{file}")
    value = json.loads(content)
    if not isinstance(value, list):
        raise RuntimeError(f"分片不是数组：{file}")
    return value

def prepare_shards(root: dict[str, Any], field: str, move_by_code: dict[str, dict[str, str]], persist: bool) -> tuple[list[dict[str, Any]], int]:
    new_refs: list[dict[str, Any]] = []
    changed_count = 0
    for ref in shard_refs(root, field):
        rows = read_shard(ref)
        count = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            target = move_by_code.get(row.get("course_code"))
            if not target:
                continue
            desired = {
                "repo_id": target["repo_id"],
                "attachment_repo_id": target["repo_id"],
                "physical_repository_id": target["physical_repository_id"],
            }
            if all(row.get(key) == value for key, value in desired.items()):
                continue
            row.update(desired)
            count += 1
        if not count:
            new_refs.append(dict(ref))
            continue
        content = compact_bytes(rows)
        new_ref = {"bytes": len(content), "sha256": sha256_bytes(content)}
        new_refs.append(new_ref)
        changed_count += count
        if persist:
            atomic_write(SHARD_STORE / f"{new_ref['sha256']}.json", content)
    return new_refs, changed_count


def synthetic_descriptor(code: str, name: str, target: dict[str, str], issue: int) -> dict[str, Any]:
    return {
        "attachment_repo_id": target["repo_id"],
        "course_code": code,
        "course_name": name,
        "descriptor_id": f"course-code:{code}",
        "metadata_path": f"curriculum/descriptors/{code}.json",
        "metadata_repo_id": "fireworks-course-registry-v2",
        "physical_repository_id": target["physical_repository_id"],
        "record_ids": [],
        "repo_id": target["repo_id"],
        "source_issue": issue,
        "status": "issue-course-cluster",
    }


TARGET_GENERATION = 6
FORBIDDEN_ROUTE_FIELDS = {"files", "course_code_routes", "repository_heads", "inventory_complete_repositories", "unresolved_repository_heads"}
MATERIAL_SUMMARY_FIELDS = {"material_file_count", "material_bytes", "material_repository_count", "material_course_code_count"}


def canonical_course_routes(routes: dict[str, Any], move_by_code: dict[str, dict[str, str]], repositories: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    by_code: dict[str, dict[str, str]] = {}
    source = routes.get("course_code_routes")
    if not isinstance(source, list):
        source = [
            {
                "course_code": route["route_key"],
                "physical_repository_id": route["physical_repository_id"],
                "repo_id": route["repo_id"],
            }
            for route in routes.get("repository_routes", [])
            if route.get("kind") == "curriculum-course"
        ]
    for route in source:
        code = route.get("course_code")
        if not code:
            continue
        target = move_by_code.get(code)
        repo_id = target["repo_id"] if target else route["repo_id"]
        by_code[code] = {
            "course_code": code,
            "physical_repository_id": (target or {}).get("physical_repository_id") or repositories[repo_id]["physical_repository_id"],
            "repo_id": repo_id,
        }
    for code, target in move_by_code.items():
        by_code.setdefault(code, {"course_code": code, "physical_repository_id": target["physical_repository_id"], "repo_id": target["repo_id"]})
    return sorted(by_code.values(), key=lambda item: natural_key(item["course_code"]))


def repository_routes(routes: dict[str, Any], course_routes: list[dict[str, str]], repositories: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    special: dict[str, str] = {}
    for route in routes.get("repository_routes", []):
        if route.get("kind") == "special-topic":
            special[route["route_key"]] = route["repo_id"]
    if not special:
        for file in routes.get("files", []):
            if file.get("route_kind") != "special-topic":
                continue
            for key in file.get("route_keys", []):
                prior = special.setdefault(key, file["repo_id"])
                if prior != file["repo_id"]:
                    raise RuntimeError(f"专题路由指向多个仓库：{key}")
    result = [{"kind": "curriculum-course", "physical_repository_id": route["physical_repository_id"], "repo_id": route["repo_id"], "route_key": route["course_code"]} for route in course_routes]
    result.extend({"kind": "special-topic", "physical_repository_id": repositories[repo_id]["physical_repository_id"], "repo_id": repo_id, "route_key": key} for key, repo_id in sorted(special.items()))
    return sorted(result, key=lambda item: (item["kind"], natural_key(item["route_key"])))


def build(persist: bool) -> dict[str, Any]:
    config = load_json(CONFIG)
    manifest = load_json(MANIFEST)
    routes = load_json(ROUTES)
    topology = load_json(TOPOLOGY)
    config_digest = sha256_bytes(CONFIG.read_bytes())
    source_generation = int(topology.get("generation", 0))
    if source_generation not in {TARGET_GENERATION - 1, TARGET_GENERATION}:
        raise RuntimeError(f"只允许从 generation {TARGET_GENERATION - 1} 或已生成的 generation {TARGET_GENERATION} 继续：{source_generation}")
    if source_generation == TARGET_GENERATION and routes.get("source_course_cluster_overrides_sha256") not in {None, config_digest}:
        raise RuntimeError("当前 generation 6 来自其他归集配置")

    repositories = {row["repo_id"]: row for row in manifest["repositories"]}
    topology_repositories = topology["repositories"]
    descriptor_names: dict[str, str] = {}
    descriptor_repo: dict[str, str] = {}
    existing_codes: set[str] = set()
    for ref in shard_refs(manifest, "course_descriptors"):
        for row in read_shard(ref):
            if isinstance(row, dict) and row.get("course_code"):
                code = row["course_code"]
                existing_codes.add(code)
                descriptor_names[code] = row.get("course_name") or "教务未提供名称"
                descriptor_repo[code] = row.get("repo_id", "")

    clusters = config.get("issues", [])
    if not isinstance(clusters, list) or len(clusters) != 2:
        raise RuntimeError("归集配置必须包含 Issue 18 与 Issue 19")
    move_by_code: dict[str, dict[str, str]] = {}
    target_codes: dict[str, set[str]] = {}
    source_by_target: dict[str, set[str]] = {}
    synthetic_rows: list[dict[str, Any]] = []
    cluster_reports: list[dict[str, Any]] = []
    for cluster in clusters:
        issue = int(cluster["issue"])
        target_repo = cluster["target_repo_id"]
        if target_repo not in repositories:
            raise RuntimeError(f"目标仓不存在：{target_repo}")
        target = {"repo_id": target_repo, "physical_repository_id": repositories[target_repo]["physical_repository_id"]}
        synthetic = cluster.get("synthetic_courses", {})
        requested_values = unique(list(cluster["requested_codes"]))
        requested = set(requested_values)
        target_codes.setdefault(target_repo, set()).update(repositories[target_repo].get("course_codes", []))
        for code in requested_values:
            if code not in descriptor_names:
                name = synthetic.get(code)
                if not name:
                    raise RuntimeError(f"Issue {issue} 缺少课程名称：{code}")
                descriptor_names[code] = name
                descriptor_repo[code] = target_repo
                synthetic_rows.append(synthetic_descriptor(code, name, target, issue))
            move_by_code[code] = target
            target_codes[target_repo].add(code)
            source = descriptor_repo.get(code)
            if source and source != target_repo:
                source_by_target.setdefault(target_repo, set()).add(source)
        cluster_reports.append({
            "issue": issue,
            "target_repo_id": target_repo,
            "requested_count": len(requested),
            "synthetic_descriptor_count": len(synthetic),
            "source_repo_ids": sorted(source_by_target.get(target_repo, set())),
        })

    target_repo_ids = {cluster["target_repo_id"] for cluster in clusters}
    source_repositories = {descriptor_repo[code] for code in move_by_code if descriptor_repo.get(code) not in target_repo_ids and descriptor_repo.get(code)}
    affected_repos = source_repositories | set(target_codes)
    for repo_id, row in repositories.items():
        if repo_id not in affected_repos:
            continue
        codes = set(row.get("course_codes", []))
        for code, target in move_by_code.items():
            if descriptor_repo.get(code) == repo_id and target["repo_id"] != repo_id:
                codes.discard(code)
        if repo_id in target_codes:
            codes.update(target_codes[repo_id])
        row["course_codes"] = unique(list(codes))
        row["course_names"] = unique([descriptor_names.get(code, "教务未提供名称") for code in row["course_codes"]])
        if repo_id in target_codes:
            for cluster in clusters:
                if cluster["target_repo_id"] == repo_id:
                    row["display_name"] = cluster["target_display_name"]
                    break
        mapping = {code: descriptor_names.get(code, "教务未提供名称") for code in row["course_codes"]}
        row["description"] = stable_description(row["repo_type"], row["display_name"], repo_id, mapping)
        if repo_id in topology_repositories:
            topology_repositories[repo_id]["course_codes"] = row["course_codes"]
            topology_repositories[repo_id]["course_names"] = row["course_names"]
            topology_repositories[repo_id]["display_name"] = row["display_name"]

    new_descriptor_refs, descriptor_changed = prepare_shards(manifest, "course_descriptors", move_by_code, persist)
    new_record_refs, record_changed = prepare_shards(manifest, "curriculum_records", move_by_code, persist)
    if synthetic_rows:
        content = compact_bytes(synthetic_rows)
        ref = {"bytes": len(content), "sha256": sha256_bytes(content)}
        new_descriptor_refs.append(ref)
        if persist:
            atomic_write(SHARD_STORE / f"{ref['sha256']}.json", content)
    manifest["course_descriptors"]["parts"] = new_descriptor_refs
    manifest["curriculum_records"]["parts"] = new_record_refs
    manifest.setdefault("sources", {})["course_cluster_overrides"] = {
        "file": CONFIG.relative_to(ROOT).as_posix(),
        "sha256": config_digest,
        "issues": [cluster["issue"] for cluster in clusters],
    }

    course_routes = canonical_course_routes(routes, move_by_code, repositories)
    routes["repository_routes"] = repository_routes(routes, course_routes, repositories)
    for field in FORBIDDEN_ROUTE_FIELDS:
        routes.pop(field, None)
    routes["generation"] = TARGET_GENERATION
    routes["source_course_cluster_overrides_sha256"] = config_digest
    topology["generation"] = TARGET_GENERATION
    topology["source_course_cluster_overrides_sha256"] = config_digest
    for field in MATERIAL_SUMMARY_FIELDS:
        manifest["summary"].pop(field, None)
    manifest["summary"]["course_descriptor_count"] = len(existing_codes) + len(synthetic_rows)

    return {
        "manifest": manifest,
        "routes": routes,
        "topology": topology,
        "report": {
            "issues": cluster_reports,
            "descriptor_changed": descriptor_changed,
            "record_changed": record_changed,
            "synthetic_descriptors": len(synthetic_rows),
            "route_code_count": len(move_by_code),
            "repository_route_count": len(routes["repository_routes"]),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.dry_run == args.apply:
        parser.error("必须指定 --dry-run 或 --apply")
    result = build(args.apply)
    if args.dry_run:
        print(json.dumps(result["report"], ensure_ascii=False, indent=2))
        return 0
    atomic_write(MANIFEST, compact_bytes(result["manifest"]))
    atomic_write(ROUTES, compact_bytes(result["routes"]))
    atomic_write(TOPOLOGY, compact_bytes(result["topology"]))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(result["report"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["report"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
