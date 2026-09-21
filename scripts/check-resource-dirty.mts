import { appendFile } from "node:fs/promises";
import { readManifestJson } from "../.vitepress/theme/manifest-store";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const owner = process.env.GITHUB_OWNER || "HIT-Fireworks";
const siteOrigin = (
  process.env.SITE_ORIGIN || "https://fireworks.jwyihao.top"
).replace(/\/$/, "");
const githubOutput = process.env.GITHUB_OUTPUT || "";
const statusSecret = process.env.RESOURCE_STATUS_SECRET || "";
const token =
  process.env.RESOURCE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "HIT-Fireworks-resource-daily-check",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (token) headers.Authorization = `Bearer ${token}`;

async function github(endpoint: string) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers,
  });
  if (!response.ok)
    throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return response.json() as Promise<{
    sha: string;
    commit: { tree: { sha: string } };
  }>;
}

async function readEvents(): Promise<
  Array<{ key: string; repoId: string; deliveryId: string }>
> {
  if (!statusSecret) {
    console.warn(
      "RESOURCE_STATUS_SECRET 未配置；跳过 marker 读取，继续执行每日 head 补漏核对。",
    );
    return [];
  }
  const response = await fetch(`${siteOrigin}/api/resource-events/status`, {
    headers: {
      "x-resource-status-secret": statusSecret,
      "Cache-Control": "no-cache",
    },
  });
  if (response.status === 503 || response.status === 404) {
    console.warn(
      `resource event status ${response.status}；跳过 marker 读取，继续执行 head 补漏核对。`,
    );
    return [];
  }
  if (!response.ok) throw new Error(`resource event status ${response.status}`);
  const payload = (await response.json()) as {
    events?: Array<{ key?: string; repoId?: string; deliveryId?: string }>;
  };
  return (payload.events ?? []).filter(
    (event): event is { key: string; repoId: string; deliveryId: string } =>
      Boolean(event.key && event.repoId && event.deliveryId),
  );
}
async function acknowledge(keys: string[]): Promise<void> {
  if (!keys.length || !statusSecret) return;
  const response = await fetch(`${siteOrigin}/api/resource-events/ack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-resource-status-secret": statusSecret,
    },
    body: JSON.stringify({ keys }),
  });
  if (!response.ok) throw new Error(`resource event ack ${response.status}`);
}
let built: { repositories?: Record<string, { commit: string }> } = {};
try {
  const response = await fetch(
    `${siteOrigin}/resource-tree/resource-build-meta.json`,
    { headers: { "Cache-Control": "no-cache" } },
  );
  if (response.ok) built = await response.json();
} catch {}

const manifest = readManifestJson<{
  repositories: Array<{ repo_id?: string; repo_type?: string }>;
}>(path.join(root, "data/repository-manifest.no-collection.v4.json"));
const repos = manifest.repositories
  .filter(
    (repo) =>
      ["course", "shared", "competition"].includes(repo.repo_type || "") &&
      repo.repo_id,
  )
  .map((repo) => repo.repo_id!)
  .sort();
const events = await readEvents();
const currentByRepo = new Map<string, string>();
const queue = [...repos];
async function worker() {
  while (queue.length) {
    const repoId = queue.shift();
    if (!repoId) return;
    const current = await github(
      `/repos/${owner}/${encodeURIComponent(repoId)}/commits/main`,
    );
    currentByRepo.set(repoId, current.sha);
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()));

const dirty = repos
  .filter(
    (repoId) =>
      built.repositories?.[repoId]?.commit !== currentByRepo.get(repoId),
  )
  .map((repoId) => ({ repoId, commit: currentByRepo.get(repoId)! }));
const cleanEventKeys = events
  .filter(
    (event) =>
      built.repositories?.[event.repoId]?.commit ===
      currentByRepo.get(event.repoId),
  )
  .map((event) => event.key);
await acknowledge(cleanEventKeys);

console.log(
  JSON.stringify(
    {
      checked: repos.length,
      events: events.length,
      acknowledged: cleanEventKeys.length,
      dirty,
    },
    null,
    2,
  ),
);
if (githubOutput) {
  await appendFile(githubOutput, `dirty=${dirty.length ? "true" : "false"}\n`);
  await appendFile(githubOutput, `dirty_count=${dirty.length}\n`);
}
