#!/usr/bin/env python3
"""为资料仓预建统一中文分类目录；空目录使用 .gitkeep 保留。"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import subprocess
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ORGANIZATION = "HIT-Fireworks"
MANIFEST = ROOT / "data/repository-manifest.no-collection.v4.json"
CATEGORY_CONFIG = ROOT / "config/repository-category-directories.v1.json"
DRY_RUN_REPORT = ROOT / "data/repository-category-directories-dry-run.v1.json"
EXECUTION_REPORT = ROOT / "data/repository-category-directories-execution.v1.json"
TARGET_TYPES = {"course", "shared", "competition", "template"}
GITHUB_API_ROOT = "https://api.github.com"
_github_token: str | None = None


def load_category_contract() -> tuple[str, ...]:
    value = json.loads(CATEGORY_CONFIG.read_text(encoding="utf-8"))
    directories = value.get("directories") if isinstance(value, dict) else None
    if (
        not isinstance(directories, list)
        or not directories
        or any(not isinstance(directory, str) or not directory.strip() for directory in directories)
        or len(directories) != len(set(directories))
        or value.get("placeholder") != ".gitkeep"
    ):
        raise RuntimeError(f"分类契约无效：{CATEGORY_CONFIG}")
    return tuple(directories)


CATEGORY_DIRECTORIES = load_category_contract()
EMPTY_BLOB_SHA = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"


def github_token() -> str:
    global _github_token
    if _github_token is None:
        process = subprocess.run(
            ["gh", "auth", "token"],
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )
        if process.returncode or not process.stdout.strip():
            raise RuntimeError(f"无法读取 GitHub 登录令牌：{process.stderr.strip()}")
        _github_token = process.stdout.strip()
    return _github_token


def run_gh(*arguments: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    if len(arguments) != 1:
        raise ValueError("run_gh 仅接受一个 GitHub API 路径")
    path = arguments[0]
    url = path if path.startswith("https://") else f"{GITHUB_API_ROOT}/{path.lstrip('/')}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {github_token()}",
        "User-Agent": "HIT-Fireworks-category-directory-sync",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    last_error = ""
    for attempt in range(1, 6):
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            last_error = raw[:1000] or str(error.reason)
            retryable = error.code in {429, 502, 503, 504} or (
                error.code == 403 and "rate limit" in last_error.lower()
            )
            if not retryable or attempt == 5:
                raise RuntimeError(f"GitHub API {method} {path} 失败（{error.code}）：{last_error}") from error
            retry_after = error.headers.get("Retry-After")
            delay = max(float(retry_after), 1.0) if retry_after else min(2.0 ** attempt, 30.0)
            time.sleep(delay)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = str(error)
            if attempt == 5:
                break
            time.sleep(min(float(attempt), 10.0))
    raise RuntimeError(f"GitHub API {method} {path} 失败：{last_error}")


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON 根必须是对象：{path}")
    return value


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def target_repositories(manifest: dict[str, Any], requested: set[str] | None) -> list[dict[str, Any]]:
    repositories = [
        row for row in manifest.get("repositories", [])
        if row.get("repo_type") in TARGET_TYPES
    ]
    if requested is not None:
        known = {row.get("repo_id") for row in repositories}
        unknown = sorted(requested - known)
        if unknown:
            raise RuntimeError(f"指定仓库不在资料仓或模板范围：{unknown}")
        repositories = [row for row in repositories if row.get("repo_id") in requested]
    return sorted(repositories, key=lambda row: str(row.get("repo_id", "")))


def root_snapshot(repo_id: str) -> dict[str, Any]:
    commit = run_gh(f"repos/{ORGANIZATION}/{repo_id}/commits/main")
    commit_sha = commit.get("sha") if isinstance(commit, dict) else None
    tree_sha = commit.get("commit", {}).get("tree", {}).get("sha") if isinstance(commit, dict) else None
    if not commit_sha or not tree_sha:
        raise RuntimeError(f"仓库缺少 main commit/tree：{repo_id}")
    tree = run_gh(f"repos/{ORGANIZATION}/{repo_id}/git/trees/{tree_sha}")
    entries = tree.get("tree", []) if isinstance(tree, dict) else []
    if tree.get("truncated"):
        raise RuntimeError(f"仓库根树异常截断：{repo_id}")
    root_entries = {entry.get("path"): entry for entry in entries if entry.get("path")}
    existing: list[str] = []
    missing: list[str] = []
    conflicts: list[str] = []
    for category in CATEGORY_DIRECTORIES:
        entry = root_entries.get(category)
        if entry is None:
            missing.append(category)
        elif entry.get("type") == "tree":
            existing.append(category)
        else:
            conflicts.append(category)
    return {
        "repo_id": repo_id,
        "commit": commit_sha,
        "tree": tree_sha,
        "existing_categories": existing,
        "missing_categories": missing,
        "conflicting_categories": conflicts,
        "root_entries": sorted(root_entries),
    }


def inspect_repository(repository: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
    repo_id = repository["repo_id"]
    try:
        snapshot = root_snapshot(repo_id)
        row = {
            "repo_id": repo_id,
            "repo_type": repository.get("repo_type"),
            "display_name": repository.get("display_name"),
            **snapshot,
        }
        if snapshot["conflicting_categories"]:
            return row, f"{repo_id}: 分类名与根文件冲突：{snapshot['conflicting_categories']}"
        return row, None
    except Exception as error:
        return {
            "repo_id": repo_id,
            "repo_type": repository.get("repo_type"),
            "display_name": repository.get("display_name"),
            "error": str(error),
        }, f"{repo_id}: {error}"


def build_report(repositories: list[dict[str, Any]]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(inspect_repository, repository) for repository in repositories]
        for future in concurrent.futures.as_completed(futures):
            row, error = future.result()
            rows.append(row)
            if error:
                errors.append(error)
    rows.sort(key=lambda row: row["repo_id"])
    errors.sort()
    report: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "organization": ORGANIZATION,
        "manifest": MANIFEST.relative_to(ROOT).as_posix(),
        "target_types": sorted(TARGET_TYPES),
        "category_directories": list(CATEGORY_DIRECTORIES),
        "placeholder": ".gitkeep",
        "remote_apply_performed": False,
        "summary": {
            "repository_count": len(rows),
            "repository_with_errors": sum("error" in row for row in rows),
            "repository_with_missing_categories": sum(bool(row.get("missing_categories")) for row in rows),
            "missing_category_count": sum(len(row.get("missing_categories", [])) for row in rows),
            "conflict_count": sum(len(row.get("conflicting_categories", [])) for row in rows),
            "by_repo_type": dict(Counter(row.get("repo_type") for row in rows)),
        },
        "repositories": rows,
        "errors": errors,
    }
    report["valid"] = not errors
    return report


def load_and_validate_dry_run() -> dict[str, Any]:
    report = load_json(DRY_RUN_REPORT)
    if report.get("category_directories") != list(CATEGORY_DIRECTORIES):
        raise RuntimeError("dry-run 的分类集合不是当前冻结集合")
    if report.get("placeholder") != ".gitkeep":
        raise RuntimeError("dry-run 的占位文件不是 .gitkeep")
    if report.get("errors"):
        raise RuntimeError("dry-run 存在远端读取或路径冲突错误")
    return report


def apply_repository(row: dict[str, Any]) -> dict[str, Any]:
    repo_id = row["repo_id"]
    current = root_snapshot(repo_id)
    missing = current["missing_categories"]
    if not missing:
        return {
            "repo_id": repo_id,
            "status": "already-complete",
            "commit": current["commit"],
            "added": [],
        }
    if current["commit"] != row["commit"] or current["tree"] != row["tree"]:
        raise RuntimeError(f"远端 HEAD 在 dry-run 后漂移：{repo_id}")
    if current["conflicting_categories"]:
        raise RuntimeError(f"分类目录与文件冲突：{repo_id}")
    tree_entries = [
        {
            "path": f"{category}/.gitkeep",
            "mode": "100644",
            "type": "blob",
            "content": "",
        }
        for category in missing
    ]
    created_tree = run_gh(
        f"repos/{ORGANIZATION}/{repo_id}/git/trees",
        method="POST",
        payload={"base_tree": current["tree"], "tree": tree_entries},
    )
    tree_sha = created_tree.get("sha") if isinstance(created_tree, dict) else None
    if not tree_sha:
        raise RuntimeError(f"未获得新树 SHA：{repo_id}")
    commit = run_gh(
        f"repos/{ORGANIZATION}/{repo_id}/git/commits",
        method="POST",
        payload={
            "message": "chore(resources): 预建资料分类目录",
            "tree": tree_sha,
            "parents": [current["commit"]],
        },
    )
    commit_sha = commit.get("sha") if isinstance(commit, dict) else None
    if not commit_sha:
        raise RuntimeError(f"未获得新提交 SHA：{repo_id}")
    run_gh(
        f"repos/{ORGANIZATION}/{repo_id}/git/refs/heads/main",
        method="PATCH",
        payload={"sha": commit_sha, "force": False},
    )
    return {
        "repo_id": repo_id,
        "status": "updated",
        "commit": commit_sha,
        "parent": current["commit"],
        "added": missing,
    }


def verify_repository(repo_id: str) -> dict[str, Any]:
    snapshot = root_snapshot(repo_id)
    return {
        "repo_id": repo_id,
        "commit": snapshot["commit"],
        "missing_categories": snapshot["missing_categories"],
        "conflicting_categories": snapshot["conflicting_categories"],
        "valid": not snapshot["missing_categories"] and not snapshot["conflicting_categories"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    parser.add_argument("--repo-id", action="append", dest="repo_ids", default=[])
    parser.add_argument("--all-repositories", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest = load_json(MANIFEST)
    requested = set(args.repo_ids) if args.repo_ids else None
    if requested is None and not args.all_repositories:
        raise SystemExit("必须明确指定 --repo-id 或 --all-repositories")
    repositories = target_repositories(manifest, requested)
    if args.dry_run:
        report = build_report(repositories)
        atomic_json(DRY_RUN_REPORT, report)
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        return 0 if report["valid"] else 1
    if args.apply:
        report = load_and_validate_dry_run()
        selected_ids = {row["repo_id"] for row in repositories}
        dry_ids = {row["repo_id"] for row in report.get("repositories", [])}
        if selected_ids != dry_ids:
            raise SystemExit("apply 的仓库选择与 dry-run 不一致")
        results = []
        for row in report["repositories"]:
            result = apply_repository(row)
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
        execution = {
            "schema_version": 1,
            "completed_at": datetime.now(UTC).isoformat(),
            "category_directories": list(CATEGORY_DIRECTORIES),
            "placeholder": ".gitkeep",
            "remote_apply_performed": True,
            "results": results,
        }
        atomic_json(EXECUTION_REPORT, execution)
        return 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(verify_repository, (row["repo_id"] for row in repositories)))
    results.sort(key=lambda row: row["repo_id"])
    summary = {
        "repository_count": len(results),
        "valid": all(row["valid"] for row in results),
        "invalid": [row for row in results if not row["valid"]],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if summary["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
