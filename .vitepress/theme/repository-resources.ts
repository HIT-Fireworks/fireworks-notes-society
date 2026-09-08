import path from "node:path";
import { readManifestJson } from "./manifest-store";

export interface RepositoryFileEntry {
  repoId: string;
  repoName: string;
  path: string;
  name: string;
  routeKind: string;
  courseCodes: string[];
  size: number;
}

export interface RepositoryFileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  children: RepositoryFileTreeNode[];
  file?: RepositoryFileEntry;
}


const repoRoot = path.resolve(import.meta.dirname, "../..");
const manifestFile = path.join(
  repoRoot,
  "data/repository-manifest.no-collection.v4.json",
);
const routesFile = path.join(repoRoot, "config/repository-file-routes.v4.json");

type JsonRecord = Record<string, unknown>;

interface ResourceSource {
  repositories: JsonRecord[];
  files: JsonRecord[];
}

let sourceCache: ResourceSource | undefined;
let entriesCache: RepositoryFileEntry[] | undefined;
let treeCache: Map<string, RepositoryFileTreeNode> | undefined;
let manifestCache: WeakRef<JsonRecord> | undefined;
let routesCache: WeakRef<JsonRecord> | undefined;

function readSource(): ResourceSource {
  const manifest = readManifestJson<JsonRecord>(manifestFile);
  const routes = readManifestJson<JsonRecord>(routesFile);
  if (!sourceCache || manifestCache?.deref() !== manifest || routesCache?.deref() !== routes) {
    manifestCache = new WeakRef(manifest);
    routesCache = new WeakRef(routes);
    entriesCache = undefined;
    treeCache = undefined;
    sourceCache = {
      repositories: Array.isArray(manifest.repositories)
        ? manifest.repositories
        : [],
      files: Array.isArray(routes.files) ? routes.files : [],
    };
  }
  return sourceCache;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numericValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasUnsafePathPart(value: string): boolean {
  return value
    .split("/")
    .some((part) => !part || part === "." || part === "..");
}


function repositoryName(
  repository: JsonRecord | undefined,
  repoId: string,
): string {
  return (
    stringValue(repository?.display_name) ||
    stringValue(repository?.name) ||
    repoId
  );
}

export function repositoryFileEntries(repoId?: string): RepositoryFileEntry[] {
  const { repositories, files } = readSource();
  if (!entriesCache) {
    const repositoryById = new Map(
      repositories.map((repository) => [
        stringValue(repository.repo_id),
        repository,
      ]),
    );
    entriesCache = files
      .map((file) => {
        const id = stringValue(file.repo_id);
        const filePath = stringValue(file.path);
        if (!id || !filePath || hasUnsafePathPart(filePath)) return undefined;
        return {
          repoId: id,
          repoName: repositoryName(repositoryById.get(id), id),
          path: filePath,
          name: filePath.split("/").pop() || filePath,
          routeKind: stringValue(file.route_kind) || "其他资料",
          courseCodes: Array.isArray(file.course_codes)
            ? file.course_codes.map(stringValue).filter(Boolean)
            : [],
          size: numericValue(file.size),
        } satisfies RepositoryFileEntry;
      })
      .filter((entry): entry is RepositoryFileEntry => Boolean(entry));
  }
  return repoId
    ? entriesCache.filter((entry) => entry.repoId === repoId)
    : entriesCache;
}

export function repositoryFilesForCourse(
  courseCode: string,
  repoIds: Iterable<string>,
): RepositoryFileEntry[] {
  const repositories = new Set(repoIds);
  return repositoryFileEntries().filter(
    (entry) =>
      repositories.has(entry.repoId) && entry.courseCodes.includes(courseCode),
  );
}

export function repositoryFileTree(repoId: string): RepositoryFileTreeNode {
  readSource();
  if (!treeCache) treeCache = new Map();
  const cached = treeCache.get(repoId);
  if (cached) return cached;
  const root: RepositoryFileTreeNode = {
    name: repoId,
    path: "",
    isDirectory: true,
    size: 0,
    children: [],
  };
  for (const file of repositoryFileEntries(repoId)) {
    let parent = root;
    const parts = file.path.split("/");
    parts.forEach((part, index) => {
      const childPath = parts.slice(0, index + 1).join("/");
      let child = parent.children.find((candidate) => candidate.name === part);
      if (!child) {
        child = {
          name: part,
          path: childPath,
          isDirectory: index < parts.length - 1,
          size: 0,
          children: [],
        };
        parent.children.push(child);
      }
      child.size += file.size;
      if (index === parts.length - 1) child.file = file;
      parent = child;
    });
  }
  sortTree(root);
  treeCache.set(repoId, root);
  return root;
}

function sortTree(node: RepositoryFileTreeNode): void {
  node.children.sort(
    (left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.name.localeCompare(right.name, "zh-CN"),
  );
  for (const child of node.children) {
    if (child.isDirectory) sortTree(child);
  }
}

export function repositoryFileStats(repoId: string): {
  count: number;
  bytes: number;
  categories: Array<{ name: string; count: number }>;
} {
  const entries = repositoryFileEntries(repoId);
  const categories = new Map<string, number>();
  for (const entry of entries) {
    categories.set(entry.routeKind, (categories.get(entry.routeKind) || 0) + 1);
  }
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    categories: Array.from(categories, ([name, count]) => ({
      name,
      count,
    })).sort(
      (left, right) =>
        right.count - left.count ||
        left.name.localeCompare(right.name, "zh-CN"),
    ),
  };
}
