#!/usr/bin/env bun
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readManifestJson } from "../.vitepress/theme/manifest-store";
import { normalizeGitTree, treeCacheRelativePath } from "../.vitepress/theme/resource-tree";

const root = path.resolve(import.meta.dir, "..");
const output = path.resolve(process.argv[2] ?? path.join(root, ".vitepress/cache/resource-tree-build"));
const persistent = path.join(root, ".vitepress/cache/resource-tree");
const owner = process.env.GITHUB_OWNER || "HIT-Fireworks";
const manifestPath = path.join(root, "data/repository-manifest.no-collection.v4.json");

function token(): string {
  const supplied = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (supplied) return supplied;
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

const authToken = token();
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "HIT-Fireworks-resource-tree-builder",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (authToken) headers.Authorization = `Bearer ${authToken}`;

async function github<T>(endpoint: string): Promise<T> {
  const response = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return (await response.json()) as T;
}

interface CommitResponse { sha: string; commit: { tree: { sha: string } } }
interface TreeResponse { sha: string; truncated?: boolean; tree: Array<Record<string, unknown>> }
interface Repository { repo_id?: string; repo_type?: string }

const manifest = readManifestJson<{ repositories: Repository[] }>(manifestPath);
const repoIds = Array.from(new Set((manifest.repositories ?? [])
  .filter((repo) => repo.repo_type === "course" || repo.repo_type === "shared" || repo.repo_type === "competition")
  .map((repo) => repo.repo_id)
  .filter((repoId): repoId is string => Boolean(repoId)))).sort();

if (!authToken && repoIds.length > 50) {
  console.warn("GITHUB_TOKEN/GH_TOKEN 未提供；GitHub 未认证 API 可能触发 60 requests/hour 限制。");
}


let previous = { schemaVersion: 1, repositories: {} };
try { previous = JSON.parse(await readFile(path.join(persistent, "resource-build-meta.json"), "utf8")); } catch {}

await mkdir(output, { recursive: true });
const snapshots: Record<string, { commit: string; treeSha: string; path: string }> = {};
let index = 0;
const queue = [...repoIds];
async function worker(): Promise<void> {
  while (queue.length) {
    const repoId = queue.shift();
    if (!repoId) return;
    const commit = await github<CommitResponse>(`/repos/${owner}/${encodeURIComponent(repoId)}/commits/main`);
    const treeSha = commit.commit.tree.sha;
    const prior = previous.repositories?.[repoId];
    const priorRelative = prior?.path?.replace(/^\/+/, "");
    if (prior?.commit === commit.sha && prior?.treeSha === treeSha && priorRelative) {
      const source = path.join(persistent, priorRelative);
      try {
        await stat(source);
        const target = path.join(output, priorRelative);
        await mkdir(path.dirname(target), { recursive: true });
        await cp(source, target);
        snapshots[repoId] = prior;
        index++;
        console.log(`[resource-tree] ${index}/${repoIds.length} ${repoId} cached`);
        continue;
      } catch {}
    }
    const tree = await github<TreeResponse>(`/repos/${owner}/${encodeURIComponent(repoId)}/git/trees/${treeSha}?recursive=1`);
    if (tree.truncated) throw new Error(`Git Tree 超过 API 单响应限制：${repoId}`);
    const snapshot = normalizeGitTree(repoId, commit.sha, treeSha, tree.tree);
    const relative = treeCacheRelativePath(snapshot);
    const file = path.join(output, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot), "utf8");
    snapshots[repoId] = { commit: snapshot.commit, treeSha: snapshot.treeSha, path: `/${relative.replaceAll("\\", "/")}` };
    index++;
    console.log(`[resource-tree] ${index}/${repoIds.length} ${repoId} ${snapshot.entries.filter((entry) => entry.type === "blob").length} files`);
  }
}
await Promise.all(Array.from({ length: Math.min(8, repoIds.length) }, () => worker()));
const meta = JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), repositories: snapshots });
await writeFile(path.join(output, "resource-build-meta.json"), meta, "utf8");
await mkdir(persistent, { recursive: true });
await cp(output, persistent, { recursive: true, force: true });
