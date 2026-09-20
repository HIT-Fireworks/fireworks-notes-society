import path from "node:path";

export const RESOURCE_TREE_SCHEMA_VERSION = 1;
export const RESOURCE_TREE_CATEGORIES = [
  "教材",
  "笔记",
  "课件",
  "试卷",
  "作业",
  "实验",
  "软件",
  "教程",
  "模板",
  "项目",
  "其他",
] as const;

export type ResourceTreeCategory = (typeof RESOURCE_TREE_CATEGORIES)[number];
export type GitTreeEntryType = "blob" | "tree";

export interface ResourceTreeEntry {
  path: string;
  name: string;
  type: GitTreeEntryType;
  sha: string;
  mode: string;
  size?: number;
  category: ResourceTreeCategory;
}

export interface ResourceTreeSnapshot {
  schemaVersion: number;
  repoId: string;
  commit: string;
  treeSha: string;
  entries: ResourceTreeEntry[];
}

export interface ResourceFile {
  repoId: string;
  commit: string;
  treeSha: string;
  path: string;
  name: string;
  routeKind: string;
  size: number;
}

const categorySet = new Set<string>(RESOURCE_TREE_CATEGORIES);

export function categoryForPath(filePath: string): ResourceTreeCategory | undefined {
  const first = filePath.split("/", 1)[0];
  return categorySet.has(first) ? (first as ResourceTreeCategory) : undefined;
}

export function normalizeGitTree(
  repoId: string,
  commit: string,
  treeSha: string,
  tree: Array<Record<string, unknown>>,
): ResourceTreeSnapshot {
  const entries: ResourceTreeEntry[] = [];
  for (const raw of tree) {
    const filePath = typeof raw.path === "string" ? raw.path.replace(/^\/+|\/+$/g, "") : "";
    const category = categoryForPath(filePath);
    const type = raw.type === "tree" ? "tree" : raw.type === "blob" ? "blob" : undefined;
    const sha = typeof raw.sha === "string" ? raw.sha : "";
    const mode = typeof raw.mode === "string" ? raw.mode : "100644";
    if (!filePath || !category || !type || !sha || filePath.endsWith("/.gitkeep")) continue;
    entries.push({
      path: filePath,
      name: path.posix.basename(filePath),
      type,
      sha,
      mode,
      ...(typeof raw.size === "number" && Number.isFinite(raw.size) ? { size: raw.size } : {}),
      category,
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  return { schemaVersion: RESOURCE_TREE_SCHEMA_VERSION, repoId, commit, treeSha, entries };
}

export function filesFromSnapshot(snapshot: ResourceTreeSnapshot): ResourceFile[] {
  return snapshot.entries
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({
      repoId: snapshot.repoId,
      commit: snapshot.commit,
      treeSha: snapshot.treeSha,
      path: entry.path,
      name: entry.name,
      routeKind: entry.category,
      size: entry.size ?? 0,
    }));
}
export function statsFromSnapshot(snapshot: ResourceTreeSnapshot): ResourceTreeStats {
  const categories = new Map<string, number>();
  let bytes = 0;
  let fileCount = 0;
  for (const entry of snapshot.entries) {
    if (entry.type !== "blob") continue;
    fileCount++;
    bytes += entry.size ?? 0;
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  return {
    fileCount,
    bytes,
    categories: Array.from(categories, ([name, count]) => ({ name, count })).sort(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"),
    ),
  };
}

export function treeCacheRelativePath(snapshot: Pick<ResourceTreeSnapshot, "repoId" | "commit" | "treeSha">): string {
  return `v${RESOURCE_TREE_SCHEMA_VERSION}/${encodeURIComponent(snapshot.repoId)}/${snapshot.commit}/${snapshot.treeSha}.json`;
}

export function isResourceTreeSnapshot(value: unknown): value is ResourceTreeSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ResourceTreeSnapshot>;
  return snapshot.schemaVersion === RESOURCE_TREE_SCHEMA_VERSION &&
    typeof snapshot.repoId === "string" &&
    /^[0-9a-f]{40}$/.test(snapshot.commit) &&
    /^[0-9a-f]{40}$/.test(snapshot.treeSha) &&
    Array.isArray(snapshot.entries);
}
