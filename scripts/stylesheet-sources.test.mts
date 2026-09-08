import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const repository = path.resolve(import.meta.dirname, "..");

test("Tailwind 生成页面和主题样式，但不消费管理数据或构建产物", { timeout: 30000 }, async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "fireworks-style-sources-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const fixtures = [
    ["index.md", '<div class="w-[137px]">首页</div>'],
    ["courses/index.md", '<div class="grid-cols-7">课程</div>'],
    [".vitepress/theme/components/Fixture.vue", '<template><div class="h-[139px]" /></template>'],
    ["data/.fireworks-json/fixture.json", '{"value":"w-[901px]"}'],
    ["data/notes.md", '<div class="w-[902px]" />'],
    ["config/notes.md", '<div class="w-[903px]" />'],
    [".vitepress/.temp/course.md", '<div class="w-[904px]" />'],
    [".vitepress/dist/course.md", '<div class="w-[905px]" />'],
    [".agents/example.md", '<div class="w-[906px]" />'],
    [".workspaces/example.md", '<div class="w-[907px]" />'],
  ];
  for (const [relative, content] of fixtures) {
    const file = path.join(fixture, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  const stylesheet = path.join(repository, ".vitepress/theme/style.css");
  const compiler = await compile(await readFile(stylesheet, "utf8"), {
    base: path.dirname(stylesheet),
    onDependency() {},
  });
  const sources = (compiler.root === "none" ? [] : compiler.root === null
    ? [{ base: repository, pattern: "**/*", negated: false }]
    : [{ ...compiler.root, negated: false }]).concat(compiler.sources);
  const scanner = new Scanner({
    sources: sources.map((source) => ({
      ...source,
      base: path.resolve(fixture, path.relative(repository, source.base)),
    })),
  });
  const candidates = scanner.scan();
  for (const expected of ["w-[137px]", "grid-cols-7", "h-[139px]"]) {
    assert.ok(candidates.includes(expected), `缺少页面样式：${expected}`);
  }
  for (let width = 901; width <= 907; width++) {
    assert.ok(!candidates.includes(`w-[${width}px]`), `错误扫描了非页面内容：${width}`);
  }
  const css = compiler.build(candidates);
  assert.match(css, /width:\s*137px/);
  assert.match(css, /height:\s*139px/);
  assert.doesNotMatch(css, /width:\s*90[1-7]px/);
});
