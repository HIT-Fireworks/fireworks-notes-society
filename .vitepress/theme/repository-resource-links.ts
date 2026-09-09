export interface RepositoryResourceLink {
  repoId: string;
  path: string;
}

export type RepositoryCdn = "edgeone" | "esa";
export type RepositoryCdnCacheStatus =
  | "checking"
  | "hit"
  | "secondary"
  | "miss"
  | "unknown"
  | "unavailable";

const repositoryOwner = "HIT-Fireworks";
const repositoryCdnOrigins: Record<RepositoryCdn, string> = {
  edgeone: "https://fireworks-eo.jwyihao.top",
  esa: "https://fireworks-esa.jwyihao.top",
};
const directProxyNode = "https://gh.dpik.top";

function encodePath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function repositoryPath(file: RepositoryResourceLink): string {
  return `/gh/${encodeURIComponent(file.repoId)}/${encodePath(file.path)}`;
}

export function repositoryCdnUrl(
  file: RepositoryResourceLink,
  cdn: RepositoryCdn,
): string {
  return `${repositoryCdnOrigins[cdn]}${repositoryPath(file)}`;
}

export function classifyRepositoryCdnCache(
  responseStatus: number,
  cacheHeaders: readonly (string | null)[],
): RepositoryCdnCacheStatus {
  if (responseStatus === 0 || (responseStatus >= 300 && responseStatus < 400)) return "unknown";
  if (responseStatus < 200 || responseStatus >= 300) return "unavailable";
  const normalized = cacheHeaders.map((value) => value?.trim().toUpperCase());
  if (normalized[0] === "HIT") return "hit";
  if (normalized.slice(1).some((value) => value === "HIT")) return "secondary";
  return normalized.some((value) => value && /^(MISS|BYPASS|EXPIRED|DYNAMIC|REVALIDATED)$/.test(value)) ? "miss" : "unknown";
}

export function repositoryRawUrl(file: RepositoryResourceLink): string {
  const rawUrl = `https://raw.githubusercontent.com/${repositoryOwner}/${encodeURIComponent(file.repoId)}/main/${encodePath(file.path)}`;
  return `${directProxyNode}/${rawUrl}`;
}

export async function probeRepositoryCdn(
  file: RepositoryResourceLink,
  cdn: RepositoryCdn,
  signal?: AbortSignal,
): Promise<RepositoryCdnCacheStatus> {
  try {
    const response = await fetch(repositoryCdnUrl(file, cdn), {
      method: "HEAD",
      credentials: "omit",
      redirect: "manual",
      signal,
    });
    const names = cdn === "esa"
      ? ["X-Site-Cache-Status", "EO-Cache-Status"]
      : ["EO-Cache-Status"];
    return classifyRepositoryCdnCache(response.status, names.map((name) => response.headers.get(name)));
  } catch {
    return "unavailable";
  }
}
