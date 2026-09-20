#!/usr/bin/env bun
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { readManifestJson } from "../.vitepress/theme/manifest-store";
import { normalizeGitTree, treeCacheRelativePath } from "../.vitepress/theme/resource-tree";

const root = path.resolve(import.meta.dir, "..");
const output = path.resolve(process.argv[2] ?? path.join(root, ".vitepress/cache/resource-tree-build"));
const persistent = path.join(root, ".vitepress/cache/resource-tree");
const owner = process.env.GITHUB_OWNER || "HIT-Fireworks";
const manifestPath = path.join(root, "data/repository-manifest.no-collection.v4.json");

function token(): string {
  if (process.env.RESOURCE_TREE_FORCE_GIT === "1") return "";
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

function git(args: string[], cwd?: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ${args[0]} 失败：${result.stderr.trim()}`);
  return result.stdout;
}

interface CommitResponse { sha: string; commit: { tree: { sha: string } } }
interface TreeResponse { truncated?: boolean; tree: Array<Record<string, unknown>> }
interface Repository { repo_id?: string; repo_type?: string }
interface Reference { commit: string; treeSha: string; path: string }
interface PreviousMeta { repositories?: Record<string, Reference> }

async function publicHead(repoId: string): Promise<string> {
  const output = git(["ls-remote", "--refs", `https://github.com/${owner}/${repoId}.git`, "refs/heads/main"]);
  const sha = output.trim().split(/\s+/, 1)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`无法解析仓库 head：${repoId}`);
  return sha;
}

async function publicTree(repoId: string): Promise<{ commit: string; treeSha: string; tree: Array<Record<string, unknown>> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "fireworks-tree-"));
  try {
    git(["init", "--bare", directory]);
    git(["-c", "protocol.version=2", "fetch", "--depth=1", "--filter=blob:none", `https://github.com/${owner}/${repoId}.git`, "refs/heads/main"], directory);
    const commit = git(["rev-parse", "FETCH_HEAD"], directory).trim();
    const treeSha = git(["rev-parse", "FETCH_HEAD^{tree}"], directory).trim();
    const raw = git(["ls-tree", "-r", "-t", "-l", "-z", "FETCH_HEAD"], directory);
    const tree = raw.split("\0").filter(Boolean).map((line) => {
      const match = line.match(/^(\d{6}) (blob|tree) ([0-9a-f]{40})\s+(-|\d+)\t([\s\S]+)$/);
      if (!match) throw new Error(`无法解析 Git Tree：${repoId}`);
      return { mode: match[1], type: match[2], sha: match[3], ...(match[4] !== "-" ? { size: Number(match[4]) } : {}), path: match[5] };
    });
    return { commit, treeSha, tree };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const manifest = readManifestJson<{ repositories: Repository[] }>(manifestPath);
const repoIds = Array.from(new Set((manifest.repositories ?? [])
  .filter((repo) => repo.repo_type === "course" || repo.repo_type === "shared" || repo.repo_type === "competition")
  .map((repo) => repo.repo_id)
  .filter((repoId): repoId is string => Boolean(repoId)))).sort();

let previous: PreviousMeta = {};
try { previous = JSON.parse(await readFile(path.join(persistent, "resource-build-meta.json"), "utf8")); } catch {}
await mkdir(output, { recursive: true });
const snapshots: Record<string, Reference> = {};
let index = 0;
const queue = [...repoIds];

async function copyPrior(repoId: string, prior: Reference, commit: string): Promise<boolean> {
  if (prior.commit !== commit) return false;
  const relative = prior.path.replace(/^\/+/, "");
  const source = path.join(persistent, relative);
  try {
    await stat(source);
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
    snapshots[repoId] = prior;
    return true;
  } catch { return false; }
}

async function worker(): Promise<void> {
  while (queue.length) {
    const repoId = queue.shift();
    if (!repoId) return;
    const prior = previous.repositories?.[repoId];
    let commit: string;
    let treeSha: string;
    let tree: Array<Record<string, unknown>> | undefined;
    if (authToken) {
      const current = await github<CommitResponse>(`/repos/${owner}/${encodeURIComponent(repoId)}/commits/main`);
      commit = current.sha;
      treeSha = current.commit.tree.sha;
      if (prior && await copyPrior(repoId, prior, commit)) {
        index++; console.log(`[resource-tree] ${index}/${repoIds.length} ${repoId} cached`); continue;
      }
      const response = await github<TreeResponse>(`/repos/${owner}/${encodeURIComponent(repoId)}/git/trees/${treeSha}?recursive=1`);
      if (response.truncated) throw new Error(`Git Tree 超过 API 单响应限制：${repoId}`);
      tree = response.tree;
    } else {
      if (prior) {
        commit = await publicHead(repoId);
        if (await copyPrior(repoId, prior, commit)) {
          index++; console.log(`[resource-tree] ${index}/${repoIds.length} ${repoId} cached`); continue;
        }
      }
      const fetched = await publicTree(repoId);
      commit = fetched.commit;
      treeSha = fetched.treeSha;
      tree = fetched.tree;
    }
    const snapshot = normalizeGitTree(repoId, commit, treeSha, tree!);
    const relative = treeCacheRelativePath(snapshot);
    const file = path.join(output, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(snapshot), "utf8");
    snapshots[repoId] = { commit: snapshot.commit, treeSha: snapshot.treeSha, path: `/${relative.replaceAll("\\", "/")}` };
    index++;
    console.log(`[resource-tree] ${index}/${repoIds.length} ${repoId} ${snapshot.entries.filter((entry) => entry.type === "blob").length} files`);
  }
}

await Promise.all(Array.from({ length: Math.min(authToken ? 8 : 4, repoIds.length) }, () => worker()));
const meta = JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), repositories: snapshots });
await writeFile(path.join(output, "resource-build-meta.json"), meta, "utf8");
await mkdir(persistent, { recursive: true });
await cp(output, persistent, { recursive: true, force: true });
