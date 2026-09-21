#!/usr/bin/env python3
"""将当前已验证的 Registry 快照以 CAS 后继提交发布到远端。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/repository-manifest.no-collection.v4.json"
TOPOLOGY = ROOT / "config/repository-topology.v4.json"
ROUTES = ROOT / "config/repository-file-routes.v4.json"
WORKFLOW = ROOT / "data/repository-flat-migration/registry-checks.yml"
RECEIPT = ROOT / "data/registry-generation6-publish-verification.v1.json"
GIT = ROOT / ".workspaces/registry-generation6.git"
REMOTE = "git@github.com:HIT-Fireworks/fireworks-course-registry-v2.git"
ENV = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",
    "GOMAXPROCS": "1",
    "GIT_NO_LAZY_FETCH": "1",
}

spec = importlib.util.spec_from_file_location(
    "registry_validation", ROOT / "scripts/validate-registry.py"
)
assert spec and spec.loader
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


def run(args: list[str], cwd: Path = GIT, data: bytes | None = None, timeout: int = 600) -> bytes:
    process = subprocess.run(
        args,
        cwd=cwd,
        input=data,
        env=ENV,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if process.returncode:
        raise RuntimeError(
            f"{args[:3]}: {process.stderr.decode('utf8', 'replace')}"
        )
    return process.stdout


def save(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def compact(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()


def registry_readme() -> bytes:
    return (
        "# HIT 课程注册表\n\n"
        "课程代码、教学计划记录和资料仓库路由的权威数据。资料直接归仓，不维护仓内资源组或持久文件清单。\n\n"
        "资料使用预设中文分类：教材、笔记、课件、试卷、作业、实验、软件、教程、模板、项目、其他。"
        "维护者不得自行新增根级分类；软件和多文件文档保留必要内部结构。\n\n"
        "`python scripts/validate-registry.py --root .` 校验完整分片、课程绑定、计划索引与仓库级路由。"
        "资料文件目录由各资料仓固定 commit 的 Git Tree 快照提供；Registry 只保存课程、专题与仓库的稳定路由，不保存文件归属。\n\n"
        "来源附件仓只保留冻结迁移证据；当前文件列表与下载路径以资料仓 Git Tree 为准。\n"
    ).encode()


def snapshot_store() -> validation.Store:
    store = validation.Store(MANIFEST)
    store.verify()
    return store


def root_files(store: validation.Store) -> list[tuple[str, Path | bytes]]:
    files: list[tuple[str, Path | bytes]] = [
        ("repository-manifest.json", MANIFEST),
        ("repository-topology.v4.json", TOPOLOGY),
        ("repository-file-routes.v4.json", ROUTES),
        ("scripts/validate-registry.py", ROOT / "scripts/validate-registry.py"),
        (".github/workflows/registry-checks.yml", WORKFLOW),
        ("README.md", registry_readme()),
    ]
    files.extend(
        (
            part.relative_to(MANIFEST.parent).as_posix(),
            part,
        )
        for part in sorted(store.dependencies - {store.path})
    )
    return files


def content(value: Path | bytes) -> bytes:
    return value.read_bytes() if isinstance(value, Path) else value


def snapshot_identity(store: validation.Store) -> str:
    digest = hashlib.sha256()
    for name, source in root_files(store):
        digest.update(name.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(content(source)).digest())
    return digest.hexdigest()


def referenced_shards(value: Any, seen: set[str] | None = None) -> set[Path]:
    seen = seen if seen is not None else set()
    result: set[Path] = set()
    if isinstance(value, dict):
        if value.get(validation.MARKER) == 1:
            for part in value.get("parts", []):
                digest = part["sha256"]
                if digest in seen:
                    continue
                seen.add(digest)
                path = MANIFEST.parent / ".fireworks-json" / f"{digest}.json"
                result.add(path)
                referenced = json.loads(path.read_bytes())
                result.update(referenced_shards(referenced, seen))
        else:
            for child in value.values():
                result.update(referenced_shards(child, seen))
    elif isinstance(value, list):
        for child in value:
            result.update(referenced_shards(child, seen))
    return result


def copied_snapshot(destination: Path) -> None:
    validation.validate(ROOT)
    store = snapshot_store()
    mapping = {
        MANIFEST: destination / "data/repository-manifest.no-collection.v4.json",
        TOPOLOGY: destination / "config/repository-topology.v4.json",
        ROUTES: destination / "config/repository-file-routes.v4.json",
    }
    for source, target in mapping.items():
        save(target, source.read_bytes())
    for part in store.dependencies - {store.path}:
        target = destination / "data" / part.relative_to(MANIFEST.parent)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != part.read_bytes():
            raise RuntimeError(f"内容寻址分片冲突：{target}")
        if not target.exists():
            shutil.copyfile(part, target)
    print(f"已同步完整快照：{destination}", flush=True)


def current_remote_head() -> str:
    output = run(
        ["git", "ls-remote", REMOTE, "refs/heads/main"], cwd=ROOT, timeout=60
    ).decode()
    if not output.strip():
        raise RuntimeError("Registry 远端 main 不存在")
    return output.split()[0]


def initialize_git(parent: str) -> None:
    GIT.mkdir(parents=True, exist_ok=True)
    if not (GIT / "HEAD").exists():
        run(["git", "init", "--bare"])
    run(
        [
            "git",
            "fetch",
            "--no-tags",
            "--depth=1",
            "--filter=blob:none",
            REMOTE,
            f"+{parent}:refs/heads/generation-parent",
        ],
        timeout=300,
    )
    run(["git", "update-ref", "-d", "refs/heads/generation-6"])


def remote_generation(parent: str) -> int:
    raw = run(["git", "show", f"{parent}:repository-topology.v4.json"])
    return int(json.loads(raw)["generation"])


def retained_tree(parent: str) -> dict[str, tuple[str, str]]:
    retained: dict[str, tuple[str, str]] = {}
    for row in run(["git", "ls-tree", "-r", "-z", parent]).split(b"\0"):
        if not row:
            continue
        fields, name = row.split(b"\t", 1)
        mode, _kind, sha = fields.decode().split()
        retained[name.decode()] = (mode, sha)
    return retained


def reconcile_receipt(receipt: dict[str, Any], snapshot: str, actual: str) -> dict[str, Any] | None:
    if receipt.get("snapshot_sha256") != snapshot:
        return None
    if receipt.get("head") == actual:
        if receipt.get("status") not in {"prepared", "completed"}:
            raise RuntimeError("Registry generation 6 发布记录状态无效")
        completed = dict(receipt)
        completed["status"] = "completed"
        completed.setdefault("published_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        return completed
    if receipt.get("parent") != actual:
        raise RuntimeError("Registry generation 6 发布记录与远端 HEAD 冲突")
    return None


def import_commit(parent: str, store: validation.Store) -> str:
    retained = retained_tree(parent)
    desired_root_shards = {
        name for name, _source in root_files(store) if name.startswith(".fireworks-json/")
    }
    manifest = store.object()
    indexes = store.object(manifest["curriculum_metadata_indexes"])
    desired_index_shards: set[str] = set()
    for raw in indexes.values():
        expanded = compact(store.expand(raw))
        if len(expanded) <= 8 * 1024 * 1024:
            continue
        desired_index_shards.update(
            "indexes/" + part.relative_to(MANIFEST.parent).as_posix()
            for part in referenced_shards(raw)
        )

    with tempfile.TemporaryFile() as error_log:
        process = subprocess.Popen(
            ["git", "fast-import", "--quiet"],
            cwd=GIT,
            env=ENV,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=error_log,
        )
        assert process.stdin
        stream = process.stdin

        def line(value: str) -> None:
            stream.write(value.encode() + b"\n")

        def payload(value: bytes) -> None:
            line(f"data {len(value)}")
            stream.write(value + b"\n")

        def put(name: str, value: bytes) -> None:
            validation.safe_path(name)
            sha = hashlib.sha1(
                f"blob {len(value)}\0".encode() + value
            ).hexdigest()
            if retained.get(name) == ("100644", sha):
                return
            line("M 100644 inline " + json.dumps(name, ensure_ascii=False))
            payload(value)

        line("commit refs/heads/generation-6")
        line(
            f"committer HIT Fireworks Automation <actions@users.noreply.github.com> {int(time.time())} +0000"
        )
        payload(
            b"feat(registry): publish course clusters generation 6\n\n"
            + f"Snapshot: {snapshot_identity(store)}".encode()
        )
        line("from " + parent)

        for name in sorted(retained):
            stale_root = name.startswith(".fireworks-json/") and name not in desired_root_shards
            stale_index = name.startswith("indexes/.fireworks-json/") and name not in desired_index_shards
            if stale_root or stale_index:
                line("D " + json.dumps(name, ensure_ascii=False))

        for name, source in root_files(store):
            put(name, content(source))

        for field in ["course_descriptors", "curriculum_records", "curriculum_plans"]:
            count = 0
            for raw in store.items(manifest[field], "array"):
                item = store.expand(raw)
                put(item["metadata_path"], compact(item))
                count += 1
            print(f"Registry {field}: {count}", flush=True)

        indexes = store.object(manifest["curriculum_metadata_indexes"])
        for name, raw in indexes.items():
            expanded = compact(store.expand(raw))
            encoded = expanded
            if len(expanded) > 8 * 1024 * 1024:
                encoded = compact(raw)
                for part in sorted(referenced_shards(raw)):
                    put(
                        "indexes/" + part.relative_to(MANIFEST.parent).as_posix(),
                        part.read_bytes(),
                    )
            put("indexes/" + name.replace("_", "-") + ".json", encoded)

        put(
            "course-groups.v1.json",
            compact(
                {
                    "course_groups": store.expand(manifest["course_groups"]),
                    "course_group_memberships": store.expand(
                        manifest["course_group_memberships"]
                    ),
                }
            ),
        )
        line("")
        line("done")
        stream.close()
        code = process.wait(timeout=1800)
        if code:
            error_log.seek(0)
            raise RuntimeError(error_log.read().decode("utf8", "replace"))

    return run(["git", "rev-parse", "refs/heads/generation-6"]).decode().strip()


def registry_commit() -> dict[str, Any]:
    result = validation.validate(ROOT)
    topology = json.loads(TOPOLOGY.read_text(encoding="utf8"))
    generation = int(topology["generation"])
    if generation != 6:
        raise RuntimeError(f"只允许发布 generation 6：{generation}")
    store = snapshot_store()
    snapshot = snapshot_identity(store)
    actual = current_remote_head()

    if RECEIPT.exists():
        receipt = json.loads(RECEIPT.read_text(encoding="utf8"))
        reconciled = reconcile_receipt(receipt, snapshot, actual)
        if reconciled:
            save(RECEIPT, compact(reconciled))
            print(json.dumps(reconciled, ensure_ascii=False), flush=True)
            return reconciled

    initialize_git(actual)
    current_generation = remote_generation(actual)
    if current_generation > generation:
        raise RuntimeError(
            f"远端 Registry generation {current_generation} 新于本地 {generation}"
        )
    commit = import_commit(actual, store)
    receipt = {
        "schema_version": 1,
        "generation": generation,
        "snapshot_sha256": snapshot,
        "parent": actual,
        "head": commit,
        "status": "prepared",
        "validation": result,
    }
    save(RECEIPT, compact(receipt))

    run(
        ["git", "-c", "pack.threads=1", "push", REMOTE, f"{commit}:refs/heads/main"],
        timeout=1800,
    )
    published = current_remote_head()
    if published != commit:
        raise RuntimeError("Registry 远端提交核验失败")
    receipt["status"] = "completed"
    receipt["published_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save(RECEIPT, compact(receipt))
    print(json.dumps(receipt, ensure_ascii=False), flush=True)
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["registry", "local"])
    args = parser.parse_args()
    if args.phase == "registry":
        registry_commit()
    else:
        if not RECEIPT.exists():
            raise RuntimeError("Registry generation 6 尚未发布")
        receipt = json.loads(RECEIPT.read_text(encoding="utf8"))
        if receipt.get("status") != "completed" or current_remote_head() != receipt.get("head"):
            raise RuntimeError("Registry generation 6 发布记录未完成或远端已漂移")
        manager = ROOT / ".workspaces/fireworks-repos-management-v2"
        copied_snapshot(manager)
        shutil.copyfile(
            ROOT / "scripts/validate-registry.py",
            manager / "scripts/validate-registry.py",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
