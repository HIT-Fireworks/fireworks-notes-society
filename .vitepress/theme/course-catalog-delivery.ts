import { createHash } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Plugin } from "vite";
import { getCourseCatalogIndex, getCourseDetailCatalog, getCourseDetailPage, type CourseCatalogIndex, type CourseCatalogOccurrence, type CourseDetailCatalog } from "./course-catalog";
import { setResourceTreeDirectory } from "./resource-tree-store";

const buildStateKey = Symbol.for("fireworks.course-catalog-build.v1");
interface CourseCatalogBuildState { directory: string; catalog?: CourseCatalogDirectory }
const buildState = globalThis as typeof globalThis & { [buildStateKey]?: CourseCatalogBuildState };
export interface CourseCatalogDirectory extends Omit<CourseCatalogIndex, "occurrences"> { planFiles: Record<string, string> }
export interface CoursePlanRecords { planId: string; occurrences: CourseCatalogOccurrence[] }
export interface CoursePlanBundle { plans: Record<string, CoursePlanRecords> }
export interface CourseCatalogDelivery { directory: CourseCatalogDirectory; files: Map<string, CoursePlanBundle> }

export function buildCourseCatalogDelivery(index: CourseCatalogIndex): CourseCatalogDelivery {
  const { occurrences, ...summary } = index;
  const planFiles: Record<string, string> = Object.create(null);
  const files = new Map<string, CoursePlanBundle>();
  const byPlan = new Map<string, CoursePlanRecords>();
  for (const plan of index.plans) byPlan.set(plan.id, { planId: plan.id, occurrences: [] });
  for (const occurrence of occurrences) {
    const bundle = byPlan.get(occurrence.planId);
    if (!bundle) throw new Error(`课程记录引用不存在的方案：${occurrence.id}`);
    bundle.occurrences.push(occurrence);
  }
  const targetBytes = 1024 * 1024;
  let bundle: CoursePlanBundle = { plans: Object.create(null) };
  let bytes = Buffer.byteLength('{"plans":{}}');
  let count = 0;
  const flush = () => {
    if (!count) return;
    const url = `/course-plans/${createHash("sha256").update(JSON.stringify(bundle)).digest("hex")}.json`;
    files.set(url, bundle);
    for (const id of Object.keys(bundle.plans)) planFiles[id] = url;
    bundle = { plans: Object.create(null) }; bytes = Buffer.byteLength('{"plans":{}}'); count = 0;
  };
  for (const [id, payload] of byPlan) {
    const entryBytes = Buffer.byteLength(JSON.stringify(id)) + 1 + Buffer.byteLength(JSON.stringify(payload));
    if (count && bytes + 1 + entryBytes > targetBytes) flush();
    bytes += (count ? 1 : 0) + entryBytes; bundle.plans[id] = payload; count++;
  }
  flush();
  return { directory: { ...summary, planFiles }, files };
}

let cachedIndex: CourseCatalogIndex | undefined;
let cachedDelivery: CourseCatalogDelivery | undefined;
export function getCourseCatalogDelivery(): CourseCatalogDelivery {
  const index = getCourseCatalogIndex();
  if (index !== cachedIndex) { cachedDelivery = buildCourseCatalogDelivery(index); cachedIndex = index; }
  return cachedDelivery!;
}

export function prepareCourseCatalogBuild(): void {
  const root = path.resolve(import.meta.dirname, "../..");
  const cache = path.join(root, ".vitepress/cache");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(path.join(cache, "course-build-"));
  const resourceTreeDirectory = path.join(directory, "resource-tree");
  try {
    execFileSync("bun", [path.join(root, "scripts/build-resource-tree.mts"), resourceTreeDirectory], { cwd: root, stdio: "inherit" });
    setResourceTreeDirectory(resourceTreeDirectory);
    execFileSync("bun", [path.join(root, "scripts/write-course-catalog-client.mts"), directory], { cwd: root, stdio: "inherit", env: { ...process.env, FIREWORKS_RESOURCE_TREE_DIR: resourceTreeDirectory } });
    buildState[buildStateKey] = { directory };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}

export function getCourseCatalogDirectory(): CourseCatalogDirectory {
  const prepared = buildState[buildStateKey];
  if (!prepared) return getCourseCatalogDelivery().directory;
  return prepared.catalog ??= JSON.parse(readFileSync(path.join(prepared.directory, "course-catalog.json"), "utf8"));
}

export async function publishPreparedCourseCatalog(outDir: string, mpa: boolean): Promise<void> {
  const prepared = buildState[buildStateKey];
  if (!prepared) throw new Error("课程构建数据尚未准备完成");
  try {
    await cp(path.join(prepared.directory, "course-catalog.json"), path.join(outDir, "course-catalog.json"));
    await cp(path.join(prepared.directory, "course-plans"), path.join(outDir, "course-plans"), { recursive: true });
    await cp(path.join(prepared.directory, "resource-tree"), path.join(outDir, "resource-tree"), { recursive: true });
    if (!mpa) await cp(path.join(prepared.directory, "course-details"), path.join(outDir, "course-details"), { recursive: true });
  } finally { delete buildState[buildStateKey]; await rm(prepared.directory, { recursive: true, force: true }); }
}

export function courseDetailFileName(code: string): string { return `${createHash("sha256").update(code).digest("hex")}.json`; }

async function publishCourseDetails(outDir: string): Promise<void> {
  const directory = path.join(outDir, "course-details");
  await mkdir(directory, { recursive: true });
  const catalog = getCourseDetailCatalog();
  for (const code of Object.keys(catalog.courses)) await writeFile(path.join(directory, courseDetailFileName(code)), JSON.stringify(getCourseDetailPage(code, catalog)), "utf8");
}

export async function publishCourseCatalog(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const delivery = getCourseCatalogDelivery();
  await mkdir(path.join(outDir, "course-plans"), { recursive: true });
  await writeFile(path.join(outDir, "course-catalog.json"), JSON.stringify(delivery.directory), "utf8");
  for (const [url, payload] of delivery.files) await writeFile(path.join(outDir, url.slice(1)), JSON.stringify(payload), "utf8");
  await publishCourseDetails(outDir);
}

function normalizeScope(value: string): string { const scope = value.trim().replace(/^\/+|\/+$/g, ""); return scope ? `/${scope}` : "/"; }
function resourcePageMap(): Record<string, string[]> {
  const file = path.resolve(import.meta.dirname, "../../config/resource-page-repositories.v1.json");
  try {
    const document = JSON.parse(readFileSync(file, "utf8")) as { pages?: Record<string, { path?: string; repoIds?: string[] }> };
    const result: Record<string, string[]> = {};
    for (const page of Object.values(document.pages ?? {})) {
      const scope = normalizeScope(page.path ?? "/");
      result[scope] = Array.from(new Set([...(result[scope] ?? []), ...(page.repoIds ?? [])])).sort();
    }
    return result;
  } catch { return {}; }
}

export function courseCatalogDeliveryPlugin(): Plugin {
  const virtualId = "virtual:course-detail";
  const resolvedId = `\0${virtualId}`;
  const resourcesId = "virtual:repository-resources";
  const resolvedResourcesId = `\0${resourcesId}`;
  let outputDirectory = "";
  const pageMap = JSON.stringify(resourcePageMap());
  return {
    name: "course-catalog-delivery",
    configResolved(config) { outputDirectory = path.resolve(config.root, config.build.outDir); },
    resolveId(id) { if (id === virtualId) return resolvedId; if (id === resourcesId) return resolvedResourcesId; },
    load(id, options) {
      if (id === resolvedResourcesId) {
        const storePath = JSON.stringify(path.resolve(import.meta.dirname, "resource-tree-store.ts"));
        if (options?.ssr) return `import { getResourceTreeSnapshots } from ${storePath}; const pageMap=${pageMap}; export async function loadRepositoryResources(scope="/"){const ids=pageMap[scope]||pageMap["/"]||[];const snapshots=getResourceTreeSnapshots(ids);return ids.flatMap(repoId=>{const snapshot=snapshots.get(repoId);return snapshot?snapshot.entries.filter(entry=>entry.type==="blob").map(entry=>({repoId,commit:snapshot.commit,treeSha:snapshot.treeSha,path:entry.path,name:entry.name,routeKind:entry.category,size:entry.size??0})):[];});}`;
        return `const pageMap=${pageMap};const cache=globalThis.__fireworksResourceSnapshots??=new Map();export async function loadRepositoryResources(scope="/"){const ids=pageMap[scope]||pageMap["/"]||[];const results=[];for(const repoId of ids){let cached=cache.get(repoId);if(!cached){const head=await fetch("/api/resource-head/"+encodeURIComponent(repoId));if(!head.ok)throw new Error("资料版本读取失败："+head.status);const v=await head.json();const response=await fetch("/resource-tree/v1/"+encodeURIComponent(repoId)+"/"+v.commit+"/"+v.treeSha+".json");if(!response.ok)throw new Error("资料树加载失败："+response.status);const snapshot=await response.json();const files=snapshot.entries.filter(e=>e.type==="blob").map(e=>({repoId,commit:snapshot.commit,treeSha:snapshot.treeSha,path:e.path,name:e.name,routeKind:e.category,size:e.size??0}));cached={snapshot,files};cache.set(repoId,cached);}results.push(...cached.files);}return results;}`;
      }
      if (id !== resolvedId) return;
      const check = `if (!/^[a-f0-9]{64}\\.json$/.test(file)) throw new Error("课程详情地址无效");`;
      if (options?.ssr) return `import { readFile } from "node:fs/promises";export async function loadCourseDetail(file){${check}return JSON.parse(await readFile(${JSON.stringify(path.join(buildState[buildStateKey]?.directory ?? outputDirectory, "course-details") + path.sep)}+file,"utf8"));}`;
      return `export async function loadCourseDetail(file){${check}const response=await fetch("/course-details/"+file);if(!response.ok)throw new Error("课程详情加载失败："+response.status);return response.json();}`;
    },
  };
}
