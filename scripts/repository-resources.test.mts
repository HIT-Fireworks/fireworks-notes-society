import assert from "node:assert/strict";
import { test } from "node:test";
import {
  repositoryFileEntries,
  repositoryFileStats,
} from "../.vitepress/theme/repository-resources.ts";
import {
  classifyRepositoryCdnCache,
  probeRepositoryCdn,
  repositoryCdnUrl,
  repositoryRawUrl,
} from "../.vitepress/theme/repository-resource-links.ts";

test(
  "资源快照覆盖当前 GitHub 文件路由",
  { timeout: 30_000 },
  () => {
    const entries = repositoryFileEntries();
    assert.equal(entries.length, 3857);
    assert.ok(entries.every((entry) => entry.repoId && entry.path));
  },
);

test("中文特殊字符逐路径段编码，下载始终指向 CDN 或独立代理", () => {
  const file = { repoId: "COURSES-A", path: "笔记/a #?%+.pdf" };
  for (const [cdn, host] of [
    ["edgeone", "fireworks-eo.jwyihao.top"],
    ["esa", "fireworks-esa.jwyihao.top"],
  ] as const) {
    const url = new URL(repositoryCdnUrl(file, cdn));
    assert.equal(url.hostname, host);
    assert.equal(
      url.pathname,
      "/gh/COURSES-A/%E7%AC%94%E8%AE%B0/a%20%23%3F%25%2B.pdf",
    );
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
  assert.equal(
    repositoryRawUrl(file),
    "https://gh.dpik.top/https://raw.githubusercontent.com/HIT-Fireworks/COURSES-A/main/%E7%AC%94%E8%AE%B0/a%20%23%3F%25%2B.pdf",
  );
});

test("只有成功文件响应才能显示缓存命中，缺失头不伪装为 MISS", () => {
  assert.equal(classifyRepositoryCdnCache(200, [" hit ", "MISS"]), "hit");
  assert.equal(classifyRepositoryCdnCache(200, ["MISS", "HIT"]), "secondary");
  assert.equal(classifyRepositoryCdnCache(200, ["MISS", "MISS"]), "miss");
  assert.equal(classifyRepositoryCdnCache(200, [null, null]), "unknown");
  assert.equal(classifyRepositoryCdnCache(200, ["UNRECOGNIZED"]), "unknown");
  assert.equal(classifyRepositoryCdnCache(0, [null]), "unknown");
  assert.equal(classifyRepositoryCdnCache(302, ["HIT"]), "unknown");
  assert.equal(classifyRepositoryCdnCache(403, ["HIT", "HIT"]), "unavailable");
  assert.equal(classifyRepositoryCdnCache(404, ["HIT"]), "unavailable");
});

test("ESA 的边缘命中和上层 EdgeOne 命中不可混淆，探测只发送 HEAD", async () => {
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (input, init) => {
    methods.push(init?.method ?? "GET");
    assert.equal(init?.cache, undefined);
    assert.equal(init?.credentials, "omit");
    assert.equal(new URL(String(input)).search, "");
    return new Response(null, {
      status: 200,
      headers: { "EO-Cache-Status": "HIT", "X-Site-Cache-Status": "MISS" },
    });
  }) as typeof fetch;
  try {
    const file = { repoId: "COURSES-A", path: "笔记/a.pdf" };
    assert.equal(await probeRepositoryCdn(file, "esa"), "secondary");
    assert.equal(await probeRepositoryCdn(file, "edgeone"), "hit");
    assert.deepEqual(methods, ["HEAD", "HEAD"]);
    globalThis.fetch = (async () => {
      throw new TypeError("CORS or TLS failure");
    }) as typeof fetch;
    assert.equal(await probeRepositoryCdn(file, "edgeone"), "unavailable");
  } finally {
    globalThis.fetch = original;
  }
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
