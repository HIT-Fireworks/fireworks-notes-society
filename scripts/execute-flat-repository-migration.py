#!/usr/bin/env python3
"""按冻结计划完成资源直归仓库的无损切换；不会删除仓库或自动归档附件仓。"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from repository_description import repository_readme, stable_repository_description

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "data/repository-flat-migration"
OBJECTS = ROOT / ".workspaces/fireworks-attachments"
OWNER = "HIT-Fireworks"
ENV = {**os.environ, "GOMAXPROCS": "1", "GOMEMLIMIT": "128MiB", "GIT_TERMINAL_PROMPT": "0"}
AUTHOR = {"GIT_AUTHOR_NAME": "HIT Fireworks Automation", "GIT_AUTHOR_EMAIL": "actions@users.noreply.github.com", "GIT_COMMITTER_NAME": "HIT Fireworks Automation", "GIT_COMMITTER_EMAIL": "actions@users.noreply.github.com"}


def run(args, *, data=None, cwd=OBJECTS, env=None, timeout=600):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd, env={**ENV, **(env or {})}, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0:3]}: {result.stderr.decode('utf-8', 'replace')}")
    return result.stdout


def gh(endpoint, *, payload=None, method=None):
    args = ["gh", "api", endpoint]
    if method:
        args += ["--method", method]
    if payload is not None:
        args += ["--input", "-"]
    value = run(args, data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None)
    return json.loads(value) if value.strip() else None


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        stream.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())
        stream.flush()
        os.fsync(stream.fileno())
        name = stream.name
    os.replace(name, path)


def text(args, **kwargs):
    return run(["git", *args], **kwargs).decode().strip()


def tree(revision):
    result = {}
    for row in run(["git", "ls-tree", "-r", "-z", revision]).split(b"\0"):
        if not row:
            continue
        info, path = row.split(b"\t", 1)
        mode, kind, sha = info.decode().split()
        if kind != "blob":
            raise RuntimeError(f"不支持的非 blob 条目 {path!r}: {kind}")
        result[path.decode()] = {"mode": mode, "sha": sha}
    return result


def fetch(repo, head):
    ref = f"refs/flat-migration/{repo}"
    existing = subprocess.run(["git", "cat-file", "-e", f"{head}^{{commit}}"], cwd=OBJECTS, env={**ENV, "GIT_NO_LAZY_FETCH": "1"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    if existing.returncode:
        run(["git", "fetch", "--no-tags", "--depth=1", "--filter=blob:none", f"git@github.com:{OWNER}/{repo}.git", f"{head}:{ref}"], timeout=300)
    if text(["rev-parse", f"{head}^{{commit}}"] ) != head:
        raise RuntimeError(f"提交身份错误：{repo}")


def remote(repo, branch="main"):
    output = text(["ls-remote", f"git@github.com:{OWNER}/{repo}.git", f"refs/heads/{branch}"], timeout=45)
    return output.split()[0] if output else None


def commit_tree(parent, entries, repo, phase):
    fd, index_name = tempfile.mkstemp(prefix="flat-migration-index-")
    os.close(fd)
    os.unlink(index_name)
    env = {"GIT_INDEX_FILE": index_name, **AUTHOR}
    try:
        run(["git", "read-tree", "--empty"], env=env)
        records = b"".join(f"{item['mode']} blob {item['sha']}\t{path}".encode() + b"\0" for path, item in sorted(entries.items()))
        run(["git", "update-index", "--add", "-z", "--index-info"], data=records, env=env)
        root = text(["write-tree"], env=env)
        args = ["commit-tree", root]
        if parent:
            args += ["-p", parent]
        message = f"refactor(resources): {phase}直接归仓资料路径\n\n仓库：{repo}\n冻结迁移：{PLAN['identity_sha256']}\n"
        return {"head": text(args, data=message.encode(), env=env), "tree": root}
    finally:
        if os.path.exists(index_name):
            os.unlink(index_name)


def put_blob(value):
    return {"mode": "100644", "sha": text(["hash-object", "-w", "--stdin"], data=value.encode())}


def check_paths(entries):
    seen = set()
    for path in entries:
        parts = path.split("/")
        if not path or "\\" in path or "\0" in path or any(part in {"", ".", "..", ".git"} for part in parts):
            raise RuntimeError(f"非法目标路径 {path}")
        key = path.casefold()
        if key in seen:
            raise RuntimeError(f"大小写冲突：{path}")
        seen.add(key)
        if any("/".join(parts[:i]) in entries for i in range(1, len(parts))):
            raise RuntimeError(f"文件目录冲突：{path}")


def verify_target(repo, entries, files):
    for file in files:
        expected = {"mode": file["source_mode"], "sha": file["source_blob_sha1"]}
        if entries.get(file["target_path"]) != expected:
            raise RuntimeError(f"目标资料校验失败：{repo}/{file['target_path']}")


def publish(repo, stage, expected_parent, entries, files):
    phases = JOURNAL.setdefault("repositories", {}).setdefault(repo, {})
    prior = phases.get(stage)
    actual = remote(repo)
    if prior:
        if prior.get("status") == "completed":
            # 后续清理提交是该仓的合法后继；由最终 verify 检查。
            later = phases.get("cleanup", {}) if stage == "add" else {}
            if actual not in {prior["head"], later.get("head")}:
                raise RuntimeError(f"已完成目标发生漂移：{repo}")
            return prior
        if actual == prior["head"]:
            prior["status"] = "completed"
            save(JOURNAL_PATH, JOURNAL)
            return prior
        if actual != prior.get("parent"):
            raise RuntimeError(f"恢复目标发生漂移：{repo}")
        commit = prior
    else:
        if actual != expected_parent:
            raise RuntimeError(f"远端 HEAD 漂移：{repo}: {actual} != {expected_parent}")
        check_paths(entries)
        verify_target(repo, entries, files)
        commit = {**commit_tree(expected_parent, entries, repo, "写入" if stage == "add" else "清除旧分组并保留"), "parent": expected_parent, "status": "prepared"}
        phases[stage] = commit
        save(JOURNAL_PATH, JOURNAL)
    run(["git", "push", f"git@github.com:{OWNER}/{repo}.git", f"{commit['head']}:refs/heads/main"], timeout=600)
    actual = remote(repo)
    if actual != commit["head"]:
        raise RuntimeError(f"推送后 HEAD 不一致：{repo}")
    verify_target(repo, tree(commit["head"]), files)
    commit["status"] = "completed"
    save(JOURNAL_PATH, JOURNAL)
    return commit


def ensure_new(spec):
    repo = spec["repo_id"]
    receipt = JOURNAL.setdefault("created", {}).get(repo)
    if receipt:
        meta = gh(f"repos/{OWNER}/{repo}")
        if meta["id"] != receipt["id"] or meta["node_id"] != receipt["node_id"]:
            raise RuntimeError(f"新仓库身份漂移：{repo}")
        return
    probe = subprocess.run(["gh", "api", f"repos/{OWNER}/{repo}"], cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if probe.returncode == 0:
        raise RuntimeError(f"未持有创建凭据，拒绝认领同名仓库：{repo}")
    if b"404" not in probe.stderr:
        raise RuntimeError(probe.stderr.decode('utf-8', 'replace'))
    description = METADATA[repo]["description"]
    meta = gh(f"orgs/{OWNER}/repos", method="POST", payload={"name": repo, "description": description, "private": False, "auto_init": False})
    JOURNAL["created"][repo] = {"id": meta["id"], "node_id": meta["node_id"], "created_at": meta["created_at"]}
    save(JOURNAL_PATH, JOURNAL)
    time.sleep(1)


def readme(repo):
    data = METADATA[repo]
    return data["readme"]


def add():
    for spec in PLAN["new_repositories"]:
        ensure_new(spec)
        print(f"创建凭据已确认：{spec['repo_id']}", flush=True)
    ordered = sorted(PLAN["targets"], key=lambda item: (not item["new_repository"], item["repo_id"]))
    for index, spec in enumerate(ordered, 1):
        repo = spec["repo_id"]
        files = BY_TARGET[repo]
        baseline = BASELINE["repositories"].get(repo)
        parent = baseline["head"] if baseline else None
        if repo in JOURNAL.get("repositories", {}):
            publish(repo, "add", parent, {}, files)
            print(f"目标已恢复并核验 {index}/{len(ordered)}：{repo}", flush=True)
            continue
        if parent:
            fetch(repo, parent)
            entries = tree(parent)
        else:
            source = spec["source_repo_id"]
            fetch(source, BASELINE["repositories"][source]["head"])
            entries = {p: e for p, e in tree(BASELINE["repositories"][source]["head"]).items() if p in {"LICENSE", "repository.toml", ".gitattributes", ".gitignore"} or p.startswith(".github/")}
            entries["README.md"] = put_blob(readme(repo))
        for file in files:
            path = file["target_path"]
            value = {"mode": file["source_mode"], "sha": file["source_blob_sha1"]}
            if path in entries and entries[path] != value:
                raise RuntimeError(f"拒绝覆盖不同内容：{repo}/{path}")
            entries[path] = value
        publish(repo, "add", parent, entries, files)
        print(f"目标已写入并核验 {index}/{len(ordered)}：{repo}", flush=True)
    JOURNAL["add_verified"] = True
    save(JOURNAL_PATH, JOURNAL)


def verify(clean=False):
    errors = []
    rows = []
    count = 0
    for spec in PLAN["targets"]:
        repo = spec["repo_id"]
        phases = JOURNAL.get("repositories", {}).get(repo, {})
        stage = phases.get("cleanup") or phases.get("add")
        if not stage or stage["status"] != "completed":
            errors.append(f"仓库尚未完成：{repo}")
            continue
        actual = remote(repo)
        if actual != stage["head"]:
            errors.append(f"远端提交不一致：{repo}")
            continue
        entries = tree(stage["head"])
        verify_target(repo, entries, BY_TARGET[repo])
        if clean:
            current_paths = {f["target_path"] for f in BY_TARGET[repo]}
            for file in BY_SOURCE.get(repo, []):
                if file["source_path"] not in current_paths and file["source_path"] in entries:
                    errors.append(f"旧路径未清理：{repo}/{file['source_path']}")
            if any(p.split("/")[0] in {"resource-groups", "course-components", "legacy-imports", "collisions"} for p in entries):
                errors.append(f"内部资源分组仍存在：{repo}")
        count += len(BY_TARGET[repo])
        rows.append({"repo_id": repo, "head": actual, "tree": stage["tree"], "files": len(BY_TARGET[repo])})
        print(f"已核验 {len(rows)}/{len(PLAN['targets'])}：{repo}", flush=True)
    if count != len(PLAN["files"]):
        errors.append(f"文件覆盖错误：{count}")
    result = {"plan_identity_sha256": PLAN["identity_sha256"], "phase": "final" if clean else "targets", "files": count, "bytes": sum(f["size"] for f in PLAN["files"]), "repositories": rows, "errors": errors, "valid": not errors}
    save(AUDIT / ("final-content-verification.json" if clean else "target-verification.json"), result)
    if errors:
        raise RuntimeError(str(errors[:10]))
    return result


def cleanup():
    if not (AUDIT / "site-cutover-verification.json").exists():
        raise RuntimeError("尚无新站点已切换的验证证据，禁止清除旧路径")
    gate = json.loads((AUDIT / "site-cutover-verification.json").read_text(encoding="utf-8"))
    if gate.get("plan_identity_sha256") != PLAN["identity_sha256"] or gate.get("valid") is not True:
        raise RuntimeError("站点切换验证未通过")
    verify()
    for index, spec in enumerate(PLAN["targets"], 1):
        repo = spec["repo_id"]
        stage = JOURNAL["repositories"][repo]["add"]
        entries = tree(stage["head"])
        current_paths = {f["target_path"] for f in BY_TARGET[repo]}
        for file in BY_SOURCE.get(repo, []):
            if file["source_path"] not in current_paths:
                expected = {"mode": file["source_mode"], "sha": file["source_blob_sha1"]}
                if entries.get(file["source_path"]) != expected:
                    raise RuntimeError(f"旧路径内容变化，拒绝删除：{repo}/{file['source_path']}")
                del entries[file["source_path"]]
        for path in list(entries):
            if path.endswith("/.gitkeep") and path not in current_paths and entries[path]["sha"] == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391":
                del entries[path]
        entries["README.md"] = put_blob(readme(repo))
        publish(repo, "cleanup", stage["head"], entries, BY_TARGET[repo])
        gh(f"repos/{OWNER}/{repo}", method="PATCH", payload={"description": METADATA[repo]["description"]})
        print(f"旧资源目录已清理 {index}/{len(PLAN['targets'])}：{repo}", flush=True)
    verify(clean=True)


def verify_blobs():
    expected = {}
    for file in PLAN["files"]:
        value = (file["size"], file["sha256"])
        if file["source_blob_sha1"] in expected and expected[file["source_blob_sha1"]] != value:
            raise RuntimeError("同一 Git blob 的来源摘要冲突")
        expected[file["source_blob_sha1"]] = value
    process = subprocess.Popen(["git", "cat-file", "--batch"], cwd=OBJECTS, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    pointers = []
    try:
        for index, (sha, (size, digest)) in enumerate(expected.items(), 1):
            process.stdin.write((sha + "\n").encode())
            process.stdin.flush()
            header = process.stdout.readline().decode().strip().split()
            if header != [sha, "blob", str(size)]:
                raise RuntimeError(f"Git blob 不可用或大小错误：{sha}: {header}")
            remaining = size
            hasher = hashlib.sha256()
            prefix = b""
            while remaining:
                chunk = process.stdout.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise RuntimeError("Git blob 读取中断")
                if len(prefix) < 200:
                    prefix += chunk[:200-len(prefix)]
                hasher.update(chunk)
                remaining -= len(chunk)
            if process.stdout.read(1) != b"\n" or hasher.hexdigest() != digest:
                raise RuntimeError(f"原字节摘要不匹配：{sha}")
            if prefix.startswith(b"version https://git-lfs.github.com/spec/v1"):
                pointers.append(sha)
            if index % 250 == 0:
                print(f"原始 blob 已核验：{index}/{len(expected)}", flush=True)
        if pointers:
            raise RuntimeError(f"存在未展开的 LFS pointer：{pointers}")
        save(AUDIT / "source-byte-verification.json", {"valid": True, "plan_identity_sha256": PLAN["identity_sha256"], "unique_blobs": len(expected), "files": len(PLAN["files"]), "bytes": sum(f["size"] for f in PLAN["files"]), "lfs_pointers": []})
    finally:
        process.stdin.close()
        process.stdout.close()
        process.wait(timeout=20)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["verify-blobs", "add", "verify", "cleanup", "verify-final"])
    args = parser.parse_args()
    PLAN = json.loads((AUDIT / "plan.json").read_text(encoding="utf-8"))
    identity_payload = {key: value for key, value in PLAN.items() if key != "identity_sha256"}
    actual_identity = hashlib.sha256(json.dumps(identity_payload, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    if actual_identity != PLAN["identity_sha256"]:
        raise RuntimeError("迁移计划内容身份不符")
    BASELINE = json.loads((AUDIT / "baseline.json").read_text(encoding="utf-8"))
    METADATA = json.loads((AUDIT / "repository-metadata.json").read_text(encoding="utf-8"))
    JOURNAL_PATH = AUDIT / "execution.json"
    JOURNAL = json.loads(JOURNAL_PATH.read_text(encoding="utf-8")) if JOURNAL_PATH.exists() else {"plan_identity_sha256": PLAN["identity_sha256"], "created": {}, "repositories": {}}
    if JOURNAL["plan_identity_sha256"] != PLAN["identity_sha256"]:
        raise RuntimeError("迁移计划与执行日志身份不符")
    BY_TARGET, BY_SOURCE = {}, {}
    for file in PLAN["files"]:
        BY_TARGET.setdefault(file["target_repo_id"], []).append(file)
        BY_SOURCE.setdefault(file["source_repo_id"], []).append(file)
    if args.phase in {"add", "cleanup"}:
        evidence = json.loads((AUDIT / "source-byte-verification.json").read_text(encoding="utf-8"))
        if evidence.get("valid") is not True or evidence.get("plan_identity_sha256") != PLAN["identity_sha256"]:
            raise RuntimeError("原始内容验证未通过")
        if gh("user")["login"] != BASELINE["github_actor"]:
            raise RuntimeError("GitHub 操作者漂移")
    {"verify-blobs": verify_blobs, "add": add, "verify": verify, "cleanup": cleanup, "verify-final": lambda: verify(clean=True)}[args.phase]()
