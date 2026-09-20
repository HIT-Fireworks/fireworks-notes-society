import fs from "node:fs";
import path from "node:path";
import { filesFromSnapshot, isResourceTreeSnapshot, type ResourceFile, type ResourceTreeSnapshot } from "./resource-tree";

const stateKey = Symbol.for("fireworks.resource-tree-store.v1");
const state = globalThis as typeof globalThis & {
  [stateKey]?: { directory?: string; snapshots?: Map<string, ResourceTreeSnapshot> };
};

export interface ResourceBuildMeta {
  schemaVersion: number;
  generatedAt: string;
  repositories: Record<string, { commit: string; treeSha: string; path: string }>;
}

export function setResourceTreeDirectory(directory: string): void {
  state[stateKey] = { directory: path.resolve(directory) };
}

export function resourceTreeDirectory(): string | undefined {
  return state[stateKey]?.directory || process.env.FIREWORKS_RESOURCE_TREE_DIR;
}

export function readResourceBuildMeta(): ResourceBuildMeta {
  const directory = resourceTreeDirectory();
  if (!directory) return { schemaVersion: 1, generatedAt: "", repositories: {} };
  const file = path.join(directory, "resource-build-meta.json");
  if (!fs.existsSync(file)) return { schemaVersion: 1, generatedAt: "", repositories: {} };
  return JSON.parse(fs.readFileSync(file, "utf8")) as ResourceBuildMeta;
}

export function getResourceTreeSnapshots(repoIds?: Iterable<string>): Map<string, ResourceTreeSnapshot> {
  const wanted = repoIds ? new Set(repoIds) : undefined;
  const existing = state[stateKey]?.snapshots;
  if (!wanted && existing) return existing;
  const directory = resourceTreeDirectory();
  const result = new Map<string, ResourceTreeSnapshot>();
  if (!directory) return result;
  const meta = readResourceBuildMeta();
  for (const [repoId, reference] of Object.entries(meta.repositories)) {
    if (wanted && !wanted.has(repoId)) continue;
    const file = path.join(directory, reference.path.replace(/^\/+/, ""));
    if (!fs.existsSync(file)) continue;
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isResourceTreeSnapshot(value) || value.repoId !== repoId || value.commit !== reference.commit || value.treeSha !== reference.treeSha) {
      throw new Error(`资料树快照与构建元数据不一致：${repoId}`);
    }
    result.set(repoId, value);
  }
  if (!wanted) state[stateKey] = { directory, snapshots: result };
  return result;
}

export function allResourceFiles(): ResourceFile[] {
  const result: ResourceFile[] = [];
  for (const snapshot of getResourceTreeSnapshots().values()) result.push(...filesFromSnapshot(snapshot));
  return result;
}

export function resourceTreeSourceFiles(): string[] {
  const directory = resourceTreeDirectory();
  if (!directory || !fs.existsSync(directory)) return [];
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) files.push(full);
    }
  };
  walk(directory);
  return files;
}
