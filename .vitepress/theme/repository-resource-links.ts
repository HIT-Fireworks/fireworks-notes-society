export interface RepositoryResourceLink {
  repoId: string;
  path: string;
}

const repositoryOwner = "HIT-Fireworks";

function encodePath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function repositoryRawUrl(file: RepositoryResourceLink): string {
  return `https://raw.githubusercontent.com/${repositoryOwner}/${encodeURIComponent(file.repoId)}/main/${encodePath(file.path)}`;
}

export function repositorySiteDownloadUrl(
  file: RepositoryResourceLink,
): string {
  return `/gh/${encodeURIComponent(file.repoId)}/${encodePath(file.path)}`;
}
