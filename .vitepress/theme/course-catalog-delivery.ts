import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { getCourseCatalogIndex, getCourseDetailCatalog, getCourseDetailPage, type CourseCatalogIndex, type CourseCatalogOccurrence, type CourseDetailCatalog } from "./course-catalog";
import { releaseManifestJsonCache } from "./manifest-store";

export interface CourseCatalogDirectory extends Omit<CourseCatalogIndex, "occurrences"> {
  planFiles: Record<string, string>;
}
export interface CoursePlanRecords {
  planId: string;
  occurrences: CourseCatalogOccurrence[];
}
export interface CourseCatalogDelivery {
  directory: CourseCatalogDirectory;
  files: Map<string, CoursePlanRecords>;
}

/** One linear partition; records retain their identities, order and multiplicity. */
export function buildCourseCatalogDelivery(index: CourseCatalogIndex): CourseCatalogDelivery {
  const { occurrences, ...summary } = index;
  const planFiles: Record<string, string> = Object.create(null);
  const files = new Map<string, CoursePlanRecords>();
  const byPlan = new Map<string, CoursePlanRecords>();
  for (const plan of index.plans) {
    const url = `/course-plans/${createHash("sha256").update(plan.id).digest("hex")}.json`;
    if (files.has(url)) throw new Error(`方案发布路径冲突：${plan.id}`);
    const payload = { planId: plan.id, occurrences: [] as CourseCatalogOccurrence[] };
    planFiles[plan.id] = url;
    byPlan.set(plan.id, payload);
    files.set(url, payload);
  }
  for (const occurrence of occurrences) {
    const payload = byPlan.get(occurrence.planId);
    if (!payload) throw new Error(`课程记录引用不存在的方案：${occurrence.id}`);
    payload.occurrences.push(occurrence);
  }
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

export function courseDetailFileName(code: string): string {
  return `${createHash("sha256").update(code).digest("hex")}.json`;
}

async function publishCourseDetails(outDir: string): Promise<void> {
  const directory = path.join(outDir, "course-details");
  await mkdir(directory, { recursive: true });
  const catalog = getCourseDetailCatalog();
  for (const code of Object.keys(catalog.courses)) {
    await writeFile(path.join(directory, courseDetailFileName(code)), JSON.stringify(getCourseDetailPage(code, catalog)), "utf8");
  }
}

/** Shared by both VitePress build modes and the optional publication CLI. */
export async function publishCourseCatalog(outDir: string): Promise<void> {
  const { directory, files } = getCourseCatalogDelivery();
  await mkdir(path.join(outDir, "course-plans"), { recursive: true });
  await writeFile(path.join(outDir, "course-catalog.json"), JSON.stringify(directory), "utf8");
  for (const [url, payload] of files) {
    await writeFile(path.join(outDir, url.slice(1)), JSON.stringify(payload), "utf8");
  }
  await publishCourseDetails(outDir);
}

export function courseCatalogDeliveryPlugin(): Plugin {
  const virtualId = "virtual:course-detail";
  const resolvedId = `\0${virtualId}`;
  let outputDirectory = "";
  let ssrBuild = false;
  let detailIndex: CourseDetailCatalog | undefined;
  let detailCodes = new Map<string, string>();
  return {
    name: "course-catalog-delivery",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
      ssrBuild = config.command === "build" && Boolean(config.build.ssr);
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id, options) {
      if (id !== resolvedId) return;
      const check = `if (!/^[a-f0-9]{64}\\.json$/.test(file)) throw new Error("课程详情地址无效");`;
      if (options?.ssr) {
        return `import { readFile } from "node:fs/promises";
          export async function loadCourseDetail(file) {
            ${check}
            return JSON.parse(await readFile(${JSON.stringify(path.join(outputDirectory, "course-details") + path.sep)} + file, "utf8"));
          }`;
      }
      return `export async function loadCourseDetail(file) {
        ${check}
        const response = await fetch("/course-details/" + file);
        if (!response.ok) throw new Error("课程详情加载失败：" + response.status);
        return response.json();
      }`;
    },
    async writeBundle() {
      if (ssrBuild) {
        await publishCourseDetails(outputDirectory);
        releaseManifestJsonCache();
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0];
        if (url !== "/course-catalog.json" && !url.startsWith("/course-plans/") && !url.startsWith("/course-details/")) return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.end();
          return;
        }
        try {
          let payload: unknown;
          if (url.startsWith("/course-details/")) {
            const catalog = getCourseDetailCatalog();
            if (detailIndex !== catalog) {
              detailIndex = catalog;
              detailCodes = new Map(Object.keys(catalog.courses).map((code) => [courseDetailFileName(code), code]));
            }
            const code = detailCodes.get(url.slice("/course-details/".length));
            if (code) payload = getCourseDetailPage(code, catalog);
          } else {
            const delivery = getCourseCatalogDelivery();
            payload = url === "/course-catalog.json" ? delivery.directory : delivery.files.get(url);
          }
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-cache");
          response.statusCode = payload ? 200 : 404;
          response.end(request.method === "HEAD" ? undefined : JSON.stringify(payload ?? { error: "方案不存在" }));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
