import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repositoryFileEntries,
  repositoryFileStats,
} from "../.vitepress/theme/repository-resources.ts";
import {
  repositoryRawUrl,
  repositorySiteDownloadUrl,
} from "../.vitepress/theme/repository-resource-links.ts";

test("资源快照覆盖当前 GitHub 文件路由", () => {
  const entries = repositoryFileEntries();
  assert.equal(entries.length, 3857);
  assert.ok(entries.every((entry) => entry.repoId && entry.path));
});

test("构建期和浏览器共用目标课程仓下载地址契约", () => {
  const file = {
    repoId: "COURSES-A",
    path: "资料/a b.pdf",
  };
  assert.equal(
    repositorySiteDownloadUrl(file),
    "/gh/COURSES-A/%E8%B5%84%E6%96%99/a%20b.pdf",
  );
  assert.equal(
    repositoryRawUrl(file),
    "https://raw.githubusercontent.com/HIT-Fireworks/COURSES-A/main/%E8%B5%84%E6%96%99/a%20b.pdf",
  );
});

test("仓库文件统计与列表一致", () => {
  const entries = repositoryFileEntries("COURSES-RA-531F0B625E8A");
  const stats = repositoryFileStats("COURSES-RA-531F0B625E8A");
  assert.equal(stats.count, entries.length);
  assert.equal(
    stats.bytes,
    entries.reduce((sum, entry) => sum + entry.size, 0),
  );
  assert.ok(stats.categories.length > 0);
});
