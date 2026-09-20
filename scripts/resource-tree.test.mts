import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryForPath, filesFromSnapshot, normalizeGitTree, statsFromSnapshot, treeCacheRelativePath } from "../.vitepress/theme/resource-tree.ts";

const snapshot = normalizeGitTree("COURSE", "a".repeat(40), "b".repeat(40), [
  { path: "README.md", type: "blob", sha: "1".repeat(40), size: 10, mode: "100644" },
  { path: "笔记", type: "tree", sha: "2".repeat(40), mode: "040000" },
  { path: "笔记/.gitkeep", type: "blob", sha: "3".repeat(40), size: 0, mode: "100644" },
  { path: "笔记/复习.pdf", type: "blob", sha: "4".repeat(40), size: 42, mode: "100644" },
  { path: ".github/workflows/sync.yml", type: "blob", sha: "5".repeat(40), size: 10, mode: "100644" },
]);

test("资料树只投影预设分类并排除脚手架文件", () => {
  assert.equal(categoryForPath("笔记/复习.pdf"), "笔记");
  assert.equal(categoryForPath("README.md"), undefined);
  assert.deepEqual(snapshot.entries.map((entry) => entry.path), ["笔记", "笔记/复习.pdf"]);
});
test("资料文件按仓库 commit 生成且不含课程关联", () => {
  const files = filesFromSnapshot(snapshot);
  assert.deepEqual(files, [{ repoId: "COURSE", commit: "a".repeat(40), treeSha: "b".repeat(40), path: "笔记/复习.pdf", name: "复习.pdf", routeKind: "笔记", size: 42 }]);
  assert.equal(Object.hasOwn(files[0], "courseCodes"), false);
});

test("资料树统计只计算 blob 且缓存地址不可变", () => {
  assert.deepEqual(statsFromSnapshot(snapshot), { fileCount: 1, bytes: 42, categories: [{ name: "笔记", count: 1 }] });
  assert.equal(treeCacheRelativePath(snapshot), `v1/COURSE/${"a".repeat(40)}/${"b".repeat(40)}.json`);
});
