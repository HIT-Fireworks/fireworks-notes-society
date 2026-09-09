import { createHash } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Plugin } from "vite";
import {
  getCourseCatalogIndex,
  getCourseDetailCatalog,
  getCourseDetailPage,
  type CourseCatalogIndex,
  type CourseCatalogOccurrence,
  type CourseDetailCatalog,
} from "./course-catalog";
import { repositoryFileEntries, repositoryFilesForPagePath } from "./repository-resources";
const buildStateKey = Symbol.for("fireworks.course-catalog-build.v1");
interface CourseCatalogBuildState {
  directory: string;
  catalog?: CourseCatalogDirectory;
}
const buildState = globalThis as typeof globalThis & {
  [buildStateKey]?: CourseCatalogBuildState;
};

export interface CourseCatalogDirectory extends Omit<
  CourseCatalogIndex,
  "occurrences"
> {
  planFiles: Record<string, string>;
}
export interface CoursePlanRecords {
  planId: string;
  occurrences: CourseCatalogOccurrence[];
}
export interface CoursePlanBundle {
  plans: Record<string, CoursePlanRecords>;
}
export interface CourseCatalogDelivery {
  directory: CourseCatalogDirectory;
  files: Map<string, CoursePlanBundle>;
}

/** 按计划线性分组，再按 UTF-8 字节数打包；不拆开单个计划或合并记录身份。 */
export function buildCourseCatalogDelivery(
  index: CourseCatalogIndex,
): CourseCatalogDelivery {
  const { occurrences, ...summary } = index;
  const planFiles: Record<string, string> = Object.create(null);
  const files = new Map<string, CoursePlanBundle>();
  const byPlan = new Map<string, CoursePlanRecords>();
  for (const plan of index.plans) {
    if (byPlan.has(plan.id)) throw new Error(`方案 ID 重复：${plan.id}`);
    const payload = {
      planId: plan.id,
      occurrences: [] as CourseCatalogOccurrence[],
    };
    byPlan.set(plan.id, payload);
  }
  for (const occurrence of occurrences) {
    const payload = byPlan.get(occurrence.planId);
    if (!payload) throw new Error(`课程记录引用不存在的方案：${occurrence.id}`);
    payload.occurrences.push(occurrence);
  }
  const targetBytes = 1024 * 1024;
  let bundle: CoursePlanBundle = { plans: Object.create(null) };
  let bytes = Buffer.byteLength('{"plans":{}}');
  let count = 0;
  const flush = () => {
    if (!count) return;
    const hash = createHash("sha256")
      .update(JSON.stringify(bundle))
      .digest("hex");
    const url = `/course-plans/${hash}.json`;
    files.set(url, bundle);
    for (const id of Object.keys(bundle.plans)) planFiles[id] = url;
    bundle = { plans: Object.create(null) };
    bytes = Buffer.byteLength('{"plans":{}}');
    count = 0;
  };
  for (const [id, payload] of byPlan) {
    const entryBytes =
      Buffer.byteLength(JSON.stringify(id)) +
      1 +
      Buffer.byteLength(JSON.stringify(payload));
    if (count && bytes + 1 + entryBytes > targetBytes) flush();
    bytes += (count ? 1 : 0) + entryBytes;
    bundle.plans[id] = payload;
    count++;
  }
  flush();
  return { directory: { ...summary, planFiles }, files };
}

let cachedIndex: CourseCatalogIndex | undefined;
let cachedDelivery: CourseCatalogDelivery | undefined;
export function getCourseCatalogDelivery(): CourseCatalogDelivery {
  const index = getCourseCatalogIndex();
  if (index !== cachedIndex) {
    cachedDelivery = buildCourseCatalogDelivery(index);
    cachedIndex = index;
  }
  return cachedDelivery!;
}

/** 配置、动态路由和数据加载器共享轻量产物，不在打包进程中保留管理清单。 */
export function prepareCourseCatalogBuild(): void {
  const root = path.resolve(import.meta.dirname, "../..");
  const cache = path.join(root, ".vitepress/cache");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(path.join(cache, "course-build-"));
  try {
    execFileSync(
      "bun",
      [path.join(root, "scripts/write-course-catalog-client.mts"), directory],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
    buildState[buildStateKey] = { directory };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function getCourseCatalogDirectory(): CourseCatalogDirectory {
  const prepared = buildState[buildStateKey];
  if (!prepared) return getCourseCatalogDelivery().directory;
  return (prepared.catalog ??= JSON.parse(
    readFileSync(path.join(prepared.directory, "course-catalog.json"), "utf8"),
  ));
}

export async function publishPreparedCourseCatalog(
  outDir: string,
  mpa: boolean,
): Promise<void> {
  const prepared = buildState[buildStateKey];
  if (!prepared) throw new Error("课程构建数据尚未准备完成");
  try {
    await cp(
      path.join(prepared.directory, "course-catalog.json"),
      path.join(outDir, "course-catalog.json"),
    );
    await cp(
      path.join(prepared.directory, "course-plans"),
      path.join(outDir, "course-plans"),
      { recursive: true },
    );
    await cp(path.join(prepared.directory, "repository-resources.json"), path.join(outDir, "repository-resources.json"));
    if (!mpa)
      await cp(
        path.join(prepared.directory, "course-details"),
        path.join(outDir, "course-details"),
        { recursive: true },
      );
  } finally {
    delete buildState[buildStateKey];
    await rm(prepared.directory, { recursive: true, force: true });
  }
}

export function courseDetailFileName(code: string): string {
  return `${createHash("sha256").update(code).digest("hex")}.json`;
}

async function publishCourseDetails(outDir: string): Promise<void> {
  const directory = path.join(outDir, "course-details");
  await mkdir(directory, { recursive: true });
  const catalog = getCourseDetailCatalog();
  for (const code of Object.keys(catalog.courses)) {
    await writeFile(
      path.join(directory, courseDetailFileName(code)),
      JSON.stringify(getCourseDetailPage(code, catalog)),
      "utf8",
    );
  }
}

/** Shared by both VitePress build modes and the optional publication CLI. */
export async function publishCourseCatalog(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "repository-resources.json"), JSON.stringify(repositoryFileEntries()), "utf8");
  const { directory, files } = getCourseCatalogDelivery();
  await mkdir(path.join(outDir, "course-plans"), { recursive: true });
  await writeFile(
    path.join(outDir, "course-catalog.json"),
    JSON.stringify(directory),
    "utf8",
  );
  for (const [url, payload] of files) {
    await writeFile(
      path.join(outDir, url.slice(1)),
      JSON.stringify(payload),
      "utf8",
    );
  }
  await publishCourseDetails(outDir);
}

export function courseCatalogDeliveryPlugin(): Plugin {
  const virtualId = "virtual:course-detail";
  const resolvedId = `\0${virtualId}`;
  const resourcesId = "virtual:repository-resources";
  const resolvedResourcesId = `\0${resourcesId}`;
  let outputDirectory = "";
  let detailIndex: CourseDetailCatalog | undefined;
  let detailCodes = new Map<string, string>();
  return {
    name: "course-catalog-delivery",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
      if (id === resourcesId) return resolvedResourcesId;
    },
    load(id, options) {
      if (id === resolvedResourcesId) {
        const select = `const normalized = pagePath.replace(/^\\/+|\\/+$/g, "");
          return entries.filter(entry => {
            const original = entry.origin.replace(/^github:\\/\\/[^/]+\\/[^/]+@[^/]+\\//, "");
            return !normalized || original === normalized || original.startsWith(normalized + "/");
          }).map(({ repoId, repoName, path, name, routeKind, size }) => ({ repoId, repoName, path, name, routeKind, size }));`;
        if (options?.ssr) {
          const prepared = buildState[buildStateKey];
          if (prepared) return `import { readFile } from "node:fs/promises";
            let data;
            export async function loadRepositoryResources(pagePath) {
              const entries = await (data ??= readFile(${JSON.stringify(path.join(prepared.directory, "repository-resources.json"))}, "utf8").then(JSON.parse));
              ${select}
            }`;
          return `import { repositoryFilesForPagePath } from ${JSON.stringify(path.resolve(import.meta.dirname, "repository-resources.ts"))};
            export async function loadRepositoryResources(pagePath) { return repositoryFilesForPagePath(pagePath); }`;
        }
        return `let data;
          export async function loadRepositoryResources(pagePath) {
            const entries = await (data ??= fetch("/repository-resources.json").then(response => {
              if (!response.ok) throw new Error("资料索引加载失败：" + response.status);
              return response.json();
            }).catch(error => { data = undefined; throw error; }));
            ${select}
          }`;
      }
      if (id !== resolvedId) return;
      const check = `if (!/^[a-f0-9]{64}\\.json$/.test(file)) throw new Error("课程详情地址无效");`;
      if (options?.ssr) {
        return `import { readFile } from "node:fs/promises";
          export async function loadCourseDetail(file) {
            ${check}
            return JSON.parse(await readFile(${JSON.stringify(path.join(buildState[buildStateKey]?.directory ?? outputDirectory, "course-details") + path.sep)} + file, "utf8"));
          }`;
      }
      return `export async function loadCourseDetail(file) {
        ${check}
        const response = await fetch("/course-details/" + file);
        if (!response.ok) throw new Error("课程详情加载失败：" + response.status);
        return response.json();
      }`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0];
        if (
          url !== "/course-catalog.json" &&
          url !== "/repository-resources.json" &&
          !url.startsWith("/course-plans/") &&
          !url.startsWith("/course-details/")
        )
          return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.end();
          return;
        }
        try {
          let payload: unknown;
          if (url === "/repository-resources.json") {
            payload = repositoryFileEntries();
          } else if (url.startsWith("/course-details/")) {
            const catalog = getCourseDetailCatalog();
            if (detailIndex !== catalog) {
              detailIndex = catalog;
              detailCodes = new Map(
                Object.keys(catalog.courses).map((code) => [
                  courseDetailFileName(code),
                  code,
                ]),
              );
            }
            const code = detailCodes.get(url.slice("/course-details/".length));
            if (code) payload = getCourseDetailPage(code, catalog);
          } else {
            const delivery = getCourseCatalogDelivery();
            payload =
              url === "/course-catalog.json"
                ? delivery.directory
                : delivery.files.get(url);
          }
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.statusCode = payload ? 200 : 404;
          response.end(
            request.method === "HEAD"
              ? undefined
              : JSON.stringify(payload ?? { error: "方案不存在" }),
          );
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
