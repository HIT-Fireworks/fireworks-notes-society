import type { ResourceFile } from "./resource-tree";

export interface CachedResourceSnapshot {
  commit: string;
  treeSha: string;
  files: ResourceFile[];
}

export interface ResourceResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ResourceFetch = (url: string) => Promise<ResourceResponse>;

interface RefreshRepositoryInput {
  repoId: string;
  builtCommit: string;
  builtTreeSha: string;
  initialFiles: ResourceFile[];
  cache: Map<string, CachedResourceSnapshot>;
  fetcher?: ResourceFetch;
}

export interface RefreshRepositoryResult {
  changed: boolean;
  files: ResourceFile[];
}

export async function refreshResourceRepository({
  repoId,
  builtCommit,
  builtTreeSha,
  initialFiles,
  cache,
  fetcher = (url) => fetch(url),
}: RefreshRepositoryInput): Promise<RefreshRepositoryResult> {
  const cached = cache.get(repoId);
  if (!cached || cached.commit === builtCommit) {
    cache.set(repoId, {
      commit: builtCommit,
      treeSha: builtTreeSha,
      files: initialFiles,
    });
  }

  const headResponse = await fetcher(
    `/api/resource-head/${encodeURIComponent(repoId)}`,
  );
  if (!headResponse.ok) {
    throw new Error(`资料版本读取失败：${headResponse.status}`);
  }
  const head = (await headResponse.json()) as {
    commit?: unknown;
    treeSha?: unknown;
  };
  if (typeof head.commit !== "string" || head.commit === builtCommit) {
    return { changed: false, files: initialFiles };
  }
  if (typeof head.treeSha !== "string") {
    throw new Error("资料版本缺少 tree SHA");
  }

  const cachedLatest = cache.get(repoId);
  if (cachedLatest?.commit === head.commit) {
    return { changed: true, files: cachedLatest.files };
  }

  const treeResponse = await fetcher(
    `/resource-tree/v1/${encodeURIComponent(repoId)}/${head.commit}/${head.treeSha}.json`,
  );
  if (!treeResponse.ok) {
    throw new Error(`资料树加载失败：${treeResponse.status}`);
  }
  const snapshot = (await treeResponse.json()) as {
    repoId?: unknown;
    commit?: unknown;
    treeSha?: unknown;
    entries?: unknown;
  };
  if (
    snapshot.repoId !== repoId ||
    snapshot.commit !== head.commit ||
    snapshot.treeSha !== head.treeSha ||
    !Array.isArray(snapshot.entries)
  ) {
    throw new Error("资料树与版本响应不一致");
  }

  const files: ResourceFile[] = [];
  for (const entry of snapshot.entries) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (value.type !== "blob" || typeof value.path !== "string") continue;
    files.push({
      repoId,
      commit: head.commit,
      treeSha: head.treeSha,
      path: value.path,
      name:
        typeof value.name === "string"
          ? value.name
          : (value.path.split("/").pop() ?? value.path),
      routeKind: typeof value.category === "string" ? value.category : "其他",
      size:
        typeof value.size === "number" && Number.isFinite(value.size)
          ? value.size
          : 0,
    });
  }

  cache.set(repoId, { commit: head.commit, treeSha: head.treeSha, files });
  return { changed: true, files };
}
