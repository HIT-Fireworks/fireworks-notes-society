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
test("默认边缘代理节点与受控配置一致", () => {
  assert.deepEqual(helpers.configuredNodes({}), [
    "https://gh-proxy.com",
    "https://gh.dpik.top",
    "https://github.tbap.top",
    "https://gh.inkchills.cn",
  ]);
});

test("边缘下载路由拒绝路径穿越", () => {
  const request = new Request("https://site.example/gh/course/..%2Fsecret.pdf");
  assert.equal(helpers.routeInfo(request), undefined);
});
test("固定站内路由解析到目标课程仓 main 分支", () => {
  const request = new Request(
    "https://site.example/gh/COURSES-A/%E8%B5%84%E6%96%99/a%20b.pdf",
  );
  const info = helpers.routeInfo(request);
  assert.deepEqual(
    info && { repoId: info.repoId, filePath: info.filePath },
    { repoId: "COURSES-A", filePath: "资料/a b.pdf" },
  );
  assert.equal(
    helpers.resolveRawUrl(info, "HIT-Fireworks"),
    "https://raw.githubusercontent.com/HIT-Fireworks/COURSES-A/main/%E8%B5%84%E6%96%99/a%20b.pdf",
  );
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
