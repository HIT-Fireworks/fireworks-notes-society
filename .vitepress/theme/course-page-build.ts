import path from "node:path";
import { rm } from "node:fs/promises";
import { normalizePath, type Plugin, type ResolvedConfig } from "vite";
import type { SiteConfig } from "vitepress";

/** 课程页面只有参数不同；只编译一次 Markdown/Vue 模板。 */
export function coursePageBuildPlugin(): Plugin {
  const prefix = "\0fireworks-course-page:";
  const pages = new Map<string, { path: string; params: unknown }>();
  let template = "";
  let outputDirectory = "";
  return {
    name: "course-page-build",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      const site = (config as ResolvedConfig & { vitepress?: SiteConfig })
        .vitepress;
      if (!site || !config.build.ssr || !site.mpa) return;
      outputDirectory = site.outDir;
      template = normalizePath(path.join(site.srcDir, "courses/[code].md"));
      for (const route of site.dynamicRoutes.routes) {
        if (route.route === "courses/[code].md") {
          pages.set(normalizePath(route.fullPath), {
            path: route.path,
            params: route.params,
          });
        }
      }
    },
    async buildStart() {
      // VitePress 的 MPA 模式只清理 SSR 临时目录，需同步清理旧版发布产物。
      if (outputDirectory)
        await rm(outputDirectory, { recursive: true, force: true });
    },
    resolveId(id) {
      const normalized = normalizePath(id);
      if (pages.has(normalized)) return `${prefix}${normalized}.js`;
    },
    load(id) {
      if (!id.startsWith(prefix)) return;
      const page = pages.get(id.slice(prefix.length, -3));
      if (!page) throw new Error("课程页面缺少路由元数据");
      return `import Page, { __pageData as template } from ${JSON.stringify(template)};
export default Page;
export const __pageData = { ...template, relativePath: ${JSON.stringify(page.path)}, params: ${JSON.stringify(page.params)} };`;
    },
  };
}
