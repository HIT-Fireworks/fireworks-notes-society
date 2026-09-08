import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { build as bundle } from "esbuild";
import { build } from "vitepress";

const repository = path.resolve(import.meta.dirname, "..");

test(
  "共享课程模板生成独立完整页面并清除旧发布产物",
  { timeout: 60000 },
  async (t) => {
    const cache = path.join(repository, ".vitepress/cache");
    await mkdir(cache, { recursive: true });
    const fixture = await mkdtemp(path.join(cache, "course-page-test-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await bundle({
      entryPoints: [
        path.join(repository, ".vitepress/theme/course-page-build.ts"),
      ],
      outfile: path.join(fixture, "course-page-build.mjs"),
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
    });
    await mkdir(path.join(fixture, ".vitepress/dist"), { recursive: true });
    await mkdir(path.join(fixture, "courses"));
    await writeFile(path.join(fixture, ".vitepress/dist/stale.json"), "{}");
    await writeFile(
      path.join(fixture, ".vitepress/config.mts"),
      `
import { coursePageBuildPlugin } from "../course-page-build.mjs";
export default {
  title: "课程构建验证", mpa: true, cleanUrls: true, buildConcurrency: 2,
  vite: { plugins: [coursePageBuildPlugin()] },
};
`,
    );
    await writeFile(path.join(fixture, "index.md"), "# 课程构建验证\n");
    await writeFile(
      path.join(fixture, "courses/[code].paths.ts"),
      `
export default {
  paths() {
    return ["ALPHA", "BETA"].map(code => ({
      params: { code, courseCode: code, detailFile: code + ".json" },
    }));
  },
};
`,
    );
    await writeFile(
      path.join(fixture, "courses/[code].md"),
      `---
layout: page
sidebar: false
outline: false
lastUpdated: false
---
<script setup>
import { useData } from "vitepress";
const { page } = useData();
</script>
<h1>{{ page.params.courseCode }}</h1>
<p>{{ page.relativePath }}</p>
<p>完整课程内容</p>
`,
    );
    await build(fixture, { mpa: true });
    for (const code of ["ALPHA", "BETA"]) {
      const html = await readFile(
        path.join(fixture, ".vitepress/dist/courses", code + ".html"),
        "utf8",
      );
      assert.ok(html.includes(`<h1>${code}</h1>`), `${code} 课程身份错误`);
      assert.ok(html.includes(`courses/${code}.md`), `${code} 页面路径错误`);
      assert.ok(html.includes("完整课程内容"), `${code} HTML 不完整`);
      const other = code === "ALPHA" ? "BETA" : "ALPHA";
      assert.ok(!html.includes(`<h1>${other}</h1>`), `${code} 混入其他课程`);
    }
    await assert.rejects(
      readFile(path.join(fixture, ".vitepress/dist/stale.json")),
      { code: "ENOENT" },
    );
  },
);
