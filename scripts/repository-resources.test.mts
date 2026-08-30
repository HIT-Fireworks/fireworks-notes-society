import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PROXY_NODES,
  buildGithubProxyUrl,
  buildSiteDownloadUrl,
  githubRawUrlFromOrigin,
  repositoryFileEntries,
  repositoryFileStats,
} from "../.vitepress/theme/repository-resources.ts";

test("资源快照覆盖当前 GitHub 文件路由", () => {
  const entries = repositoryFileEntries();
  assert.equal(entries.length, 3857);
  assert.ok(entries.every((entry) => entry.siteDownloadUrl.startsWith("/gh/")));
  assert.ok(
    entries.every((entry) =>
      entry.githubRawUrl.startsWith("https://raw.githubusercontent.com/"),
    ),
  );
});

test("资源来源转换保留提交版本和中文路径", () => {
  const raw = githubRawUrlFromOrigin(
    "github://HIT-Fireworks/fireworks-attachments@abc123/课程资料/第一讲.pdf",
  );
  assert.equal(
    raw,
    "https://raw.githubusercontent.com/HIT-Fireworks/fireworks-attachments/abc123/%E8%AF%BE%E7%A8%8B%E8%B5%84%E6%96%99/%E7%AC%AC%E4%B8%80%E8%AE%B2.pdf",
  );
});

test("构建期和边缘函数共用固定下载地址契约", () => {
  const raw =
    "https://raw.githubusercontent.com/HIT-Fireworks/fireworks-attachments/main/a.pdf";
  assert.equal(
    buildGithubProxyUrl(DEFAULT_PROXY_NODES[0], raw),
    `${DEFAULT_PROXY_NODES[0]}/${raw}`,
  );
  assert.match(
    buildSiteDownloadUrl("COURSES-A", "a/b.pdf", raw),
    /^\/gh\/COURSES-A\/a\/b\.pdf\?source=/,
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
