import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../edge-functions/gh/[[default]].js",
);
const module = await import(pathToFileURL(file).href);
const helpers = module.__test;

test("只接受安全的 gh-proxy 节点配置", () => {
  assert.deepEqual(
    helpers.configuredNodes({
      GH_PROXY_NODES:
        "https://fast.example, javascript:alert(1),https://second.example/",
    }),
    ["https://fast.example", "https://second.example/"],
  );
});

test("边缘下载路由拒绝路径穿越", () => {
  const request = new Request("https://site.example/gh/course/..%2Fsecret.pdf");
  assert.equal(helpers.routeInfo(request), undefined);
});

test("边缘只允许 HIT-Fireworks 的 raw 文件来源", () => {
  assert.equal(
    helpers.isValidRawUrl(
      "https://raw.githubusercontent.com/HIT-Fireworks/fireworks-attachments/main/a.pdf",
      "HIT-Fireworks",
    ),
    true,
  );
  assert.equal(
    helpers.isValidRawUrl(
      "https://raw.githubusercontent.com/example/other/main/a.pdf",
      "HIT-Fireworks",
    ),
    false,
  );
});
