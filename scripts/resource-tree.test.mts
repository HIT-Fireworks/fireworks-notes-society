import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryForPath,
  filesFromSnapshot,
  normalizeGitTree,
  statsFromSnapshot,
  treeCacheRelativePath,
} from "../.vitepress/theme/resource-tree.ts";

const snapshot = normalizeGitTree("COURSE", "a".repeat(40), "b".repeat(40), [
  {
    path: "README.md",
    type: "blob",
    sha: "1".repeat(40),
    size: 10,
    mode: "100644",
  },
  { path: "笔记", type: "tree", sha: "2".repeat(40), mode: "040000" },
  {
    path: "笔记/.gitkeep",
    type: "blob",
    sha: "3".repeat(40),
    size: 0,
    mode: "100644",
  },
  {
    path: "笔记/复习.pdf",
    type: "blob",
    sha: "4".repeat(40),
    size: 42,
    mode: "100644",
  },
  {
    path: ".github/workflows/sync.yml",
    type: "blob",
    sha: "5".repeat(40),
    size: 10,
    mode: "100644",
  },
]);

test("资料树只投影预设分类并排除脚手架文件", () => {
  assert.equal(categoryForPath("笔记/复习.pdf"), "笔记");
  assert.equal(categoryForPath("README.md"), undefined);
  assert.deepEqual(
    snapshot.entries.map((entry) => entry.path),
    ["笔记", "笔记/复习.pdf"],
  );
});
test("资料文件按仓库 commit 生成且不含课程关联", () => {
  const files = filesFromSnapshot(snapshot);
  assert.deepEqual(files, [
    {
      repoId: "COURSE",
      commit: "a".repeat(40),
      treeSha: "b".repeat(40),
      path: "笔记/复习.pdf",
      name: "复习.pdf",
      routeKind: "笔记",
      size: 42,
    },
  ]);
  assert.equal(Object.hasOwn(files[0], "courseCodes"), false);
});

test("资料树统计只计算 blob 且缓存地址不可变", () => {
  assert.deepEqual(statsFromSnapshot(snapshot), {
    fileCount: 1,
    bytes: 42,
    categories: [{ name: "笔记", count: 1 }],
  });
  assert.equal(
    treeCacheRelativePath(snapshot),
    `v1/COURSE/${"a".repeat(40)}/${"b".repeat(40)}.json`,
  );
});

test("站点构建只消费已提交资料树缓存", { timeout: 60000 }, async (t) => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = path.join(root, "data/resource-tree-cache");
  const output = await mkdtemp(
    path.join(tmpdir(), "fireworks-resource-tree-test-"),
  );
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/build-resource-tree.mts"), output],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FIREWORKS_RESOURCE_TREE_REFRESH: "0",
        FIREWORKS_RESOURCE_TREE_PERSISTENT_DIR: source,
        GITHUB_TOKEN: "must-not-be-used",
        GH_TOKEN: "must-not-be-used",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reused \d+ repositories from committed cache/);
  assert.equal(
    await readFile(path.join(output, "resource-build-meta.json"), "utf8"),
    await readFile(path.join(source, "resource-build-meta.json"), "utf8"),
  );
});
