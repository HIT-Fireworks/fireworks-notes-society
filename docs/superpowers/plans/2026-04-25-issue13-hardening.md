# Issue #13 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 issue #13 中已确认采纳的低成本安全与维护性改进，包括脚本 URL 校验、前端校园验证加载优化、废弃编码 API 替换、EdgeOne 响应头与 `/campus-verify.json` 缓存修正。

**Architecture:** 改动分为三个边界：`scripts/update-campus-url.mjs` 负责本地维护脚本的 URL 规范化、跳转限制和生成数据规范化；`.vitepress/theme/components/` 负责前端校园验证、MD5 UTF-8 字节转换和图片加载清理；仓库根目录 `edgeone.json` 负责 EdgeOne Pages 部署响应头和非 hash JSON 缓存。实现阶段在 `C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\issue13-hardening` worktree 中完成。

**Tech Stack:** Bun 1.3.12、VitePress 1.6.4、Vue 3.5、TypeScript/ESM、EdgeOne Pages `edgeone.json`。

**Worktree Rule:** All relative paths and commands in this plan are relative to `C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\issue13-hardening`. Do not write implementation changes to the main workspace.

---

## 参考文件

- 已审查通过的 spec：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\specs\2026-04-25-issue13-hardening-design.md`
- 实施 worktree：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\issue13-hardening`
- 计划文件：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\issue13-hardening\docs\superpowers\plans\2026-04-25-issue13-hardening.md`

## 文件结构

- Create: `edgeone.json`，EdgeOne Pages 响应头与 `/campus-verify.json` 缓存规则。
- Create: `.vitepress/theme/components/md5-utf8.mts`，浏览器侧复用的 UTF-8 binary string helper。
- Modify: `.vitepress/theme/components/alist.api.mts`，导入 helper 并替换废弃编码 API。
- Modify: `.vitepress/theme/components/OListItem.vue`，导入 helper，替换备用 MD5 编码路径，增加校园验证 URL 校验、`campus-verify.json` revalidation、图片加载清理。
- Modify: `scripts/update-campus-url.mjs`，限制 `fetchBuffer` URL、跳转和图片来源，生成 canonical 图片 URL。
- Modify: `public/campus-verify.json`，把现有 `https://zb.hit.edu.cn//...` 图片 URL 规范化为 `https://zb.hit.edu.cn/...`。

## Task 1: EdgeOne Pages 配置

**Files:**
- Create: `edgeone.json`

- [ ] **Step 1: 写入 EdgeOne 配置文件**

在 worktree 根目录创建 `edgeone.json`，内容如下：

```json
{
  "headers": [
    {
      "source": "/*",
      "headers": [
        {
          "key": "Strict-Transport-Security",
          "value": "max-age=31536000; includeSubDomains"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "camera=(), microphone=(), geolocation=()"
        },
        {
          "key": "Content-Security-Policy",
          "value": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
        }
      ]
    },
    {
      "source": "/campus-verify.json",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=300, must-revalidate"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: 验证 JSON 结构**

Run:

```powershell
bun -e "const cfg = await Bun.file('edgeone.json').json(); if (!Array.isArray(cfg.headers)) throw new Error('headers must be an array'); const sources = cfg.headers.map((rule) => rule.source).sort(); if (sources.join('|') !== '/*|/campus-verify.json') throw new Error('unexpected sources: ' + sources.join(',')); for (const rule of cfg.headers) { if (!Array.isArray(rule.headers) || rule.headers.length === 0) throw new Error('empty headers for ' + rule.source); for (const header of rule.headers) { if (!header.key || !header.value) throw new Error('invalid header in ' + rule.source); } } console.log('edgeone.json ok');"
```

Expected:

```text
edgeone.json ok
```

- [ ] **Step 3: 检查配置 diff**

Run:

```powershell
git diff -- edgeone.json
```

Expected: diff 只包含新增 `edgeone.json`，且 `source` 为 `/*` 与 `/campus-verify.json`。

## Task 2: 替换 MD5 UTF-8 编码路径

**Files:**
- Create: `.vitepress/theme/components/md5-utf8.mts`
- Modify: `.vitepress/theme/components/alist.api.mts`
- Modify: `.vitepress/theme/components/OListItem.vue`

- [ ] **Step 1: 创建 UTF-8 helper**

Create `.vitepress/theme/components/md5-utf8.mts`:

```ts
/**
 * Convert a JavaScript string into the binary-string form expected by the
 * existing MD5 implementation: one character per UTF-8 byte.
 */
export function toUtf8BinaryString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}
```

- [ ] **Step 2: 更新 `alist.api.mts`**

在 `.vitepress/theme/components/alist.api.mts` 文件顶部添加导入。源码文件是 `.mts`，但当前 VitePress 源码里的运行时 import 使用 `.mjs` 扩展，保持同样风格：

```ts
import { toUtf8BinaryString } from "./md5-utf8.mjs";
```

把 `convertToWordArray` 中的旧编码行：

```ts
const utf8 = unescape(encodeURIComponent(str));
```

替换为：

```ts
const utf8 = toUtf8BinaryString(str);
```

- [ ] **Step 3: 更新 `OListItem.vue`**

在 `.vitepress/theme/components/OListItem.vue` 现有 imports 附近添加：

```ts
import { toUtf8BinaryString } from "./md5-utf8.mjs";
```

把备用 `computeMd5Inline` 的 `convertToWordArray` 中旧编码行：

```ts
const utf8 = unescape(encodeURIComponent(str));
```

替换为：

```ts
const utf8 = toUtf8BinaryString(str);
```

- [ ] **Step 4: 验证 helper 与旧编码语义一致**

Run:

```powershell
bun -e "import { toUtf8BinaryString } from './.vitepress/theme/components/md5-utf8.mts'; const inputs = ['abc', '中文测试', '/Fireworks/校内资源', 'password-密码-123']; for (const input of inputs) { const legacy = unescape(encodeURIComponent(input)); const modern = toUtf8BinaryString(input); if (legacy !== modern) throw new Error('utf8 mismatch for ' + input); } console.log('utf8 helper ok');"
```

Expected:

```text
utf8 helper ok
```

- [ ] **Step 5: 确认源码不再使用废弃组合**

Run:

```powershell
if (rg "unescape\(encodeURIComponent" .vitepress/theme/components) { throw "deprecated encoding API still present" } else { "no deprecated encoding API" }
```

Expected:

```text
no deprecated encoding API
```

## Task 3: 前端校园验证 URL、缓存和图片加载

**Files:**
- Modify: `.vitepress/theme/components/OListItem.vue`

- [ ] **Step 1: 增加 URL 规范化常量和函数**

在 `CampusVerifyData` interface 附近添加：

```ts
const CAMPUS_VERIFY_CONFIG_URL = "/campus-verify.json";
const CAMPUS_IMAGE_HOST = "zb.hit.edu.cn";
const CAMPUS_IMAGE_PATH_PREFIXES = ["/upload/hit/image/", "/images/help/"];

function normalizeCampusImageUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    const pathname = parsed.pathname.replace(/^\/+/, "/");

    if (parsed.protocol !== "https:" || parsed.hostname !== CAMPUS_IMAGE_HOST) {
      return null;
    }

    if (!CAMPUS_IMAGE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return null;
    }

    parsed.pathname = pathname;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: 让 `campus-verify.json` 请求触发 revalidation**

在 `tryCampusNetworkDetection()` 中把：

```ts
const configRes = await fetch("/campus-verify.json");
```

替换为：

```ts
const configRes = await fetch(CAMPUS_VERIFY_CONFIG_URL, {
  cache: "no-cache",
});
```

- [ ] **Step 3: 过滤并规范化验证图片**

在 `if (!config.images || config.images.length === 0) { ... }` 之后添加：

```ts
const verificationImages = config.images.flatMap((imgData) => {
  const normalizedUrl = normalizeCampusImageUrl(imgData.url);
  if (!normalizedUrl) {
    console.warn(`[Campus] Ignoring invalid verification image: ${imgData.url}`);
    return [];
  }

  return [{ ...imgData, url: normalizedUrl }];
});

if (verificationImages.length === 0) {
  console.log("[Campus] No valid verification images configured");
  return;
}
```

把后续使用 `config.images` 发起加载和统计日志的地方改为 `verificationImages`：

```ts
console.log(`[Campus] Loading ${verificationImages.length} images...`);
const passwordPromises = verificationImages.map((imgData) =>
  tryLoadImageAndComputePassword(imgData.url, imgData.md5),
);
```

并把成功数量日志改成：

```ts
console.log(
  `[Campus] ${validPasswords.length}/${verificationImages.length} images loaded`,
);
```

- [ ] **Step 4: 更新图片加载超时和清理逻辑**

把 `tryLoadImageAndComputePassword` 中定时器、`onload`、`onerror` 逻辑替换为：

```ts
let settled = false;
let timeout: ReturnType<typeof setTimeout>;

const cleanup = (cancelLoad: boolean) => {
  clearTimeout(timeout);
  img.onload = null;
  img.onerror = null;
  if (cancelLoad) {
    img.src = "";
  }
};

const finish = (value: string | null, cancelLoad: boolean) => {
  if (settled) {
    return;
  }
  settled = true;
  cleanup(cancelLoad);
  resolve(value);
};

timeout = setTimeout(() => {
  finish(null, true);
}, 5000);

img.onload = () => {
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  if (width === 0 || height === 0) {
    finish(null, false);
    return;
  }

  const dimsStr = `${width}x${height}`;
  const password = md5(realMd5 + dimsStr);
  finish(password, false);
};

img.onerror = () => {
  finish(null, true);
};
```

保留函数末尾：

```ts
img.src = url;
```

- [ ] **Step 5: 构建验证前端改动**

Run:

```powershell
bun run docs:build
```

Expected: build complete。

## Task 4: 维护脚本 URL 校验与现有 JSON 规范化

**Files:**
- Modify: `scripts/update-campus-url.mjs`
- Modify: `public/campus-verify.json`

- [ ] **Step 1: 调整脚本常量和 imports**

把 `scripts/update-campus-url.mjs` 中的 URL import：

```js
import { fileURLToPath } from "url";
```

改为：

```js
import { fileURLToPath, pathToFileURL } from "url";
```

删除 HTTP import：

```js
import { get as httpGet } from "http";
```

删除。把现有配置附近改成：

```js
const TARGET_IMAGE_COUNT = 20;
const ZB_BASE = "https://zb.hit.edu.cn";
const ZB_HOST = "zb.hit.edu.cn";
const IDS_HOST = "ids.hit.edu.cn";
const MAX_REDIRECTS = 5;
const CAMPUS_IMAGE_PATH_PREFIXES = ["/upload/hit/image/", "/images/help/"];
```

如果 `MYTODAY_BASE` 没有实际使用，删除该常量。

- [ ] **Step 2: 添加 URL helper**

在 `promptPassword` 后、`fetchBuffer` 前添加：

```js
function parseUrl(input, base = ZB_BASE) {
  let parsed;
  try {
    parsed = new URL(input, base);
  } catch {
    throw new Error(`无效 URL: ${input}`);
  }

  return parsed;
}

export function parseHttpsUrl(input, base = ZB_BASE) {
  const parsed = parseUrl(input, base);

  if (parsed.protocol !== "https:") {
    throw new Error(`不允许的协议: ${parsed.protocol}`);
  }

  return parsed;
}

export function normalizeZbRequestUrl(input, base = ZB_BASE) {
  const parsed = parseHttpsUrl(input, base);
  if (parsed.hostname !== ZB_HOST) {
    throw new Error(`不允许的主机: ${parsed.hostname}`);
  }
  parsed.hash = "";
  return parsed;
}

export function normalizeCampusImageUrl(src) {
  let parsed;
  try {
    parsed = normalizeZbRequestUrl(src);
  } catch {
    return null;
  }

  const pathname = parsed.pathname.replace(/^\/+/, "/");

  if (!CAMPUS_IMAGE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  parsed.pathname = pathname;
  return parsed.toString();
}

export function resolveRedirectUrl(location, currentUrl, redirectCount) {
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error(`重定向次数超过上限 ${MAX_REDIRECTS}`);
  }

  const nextUrl = parseUrl(location, currentUrl);
  if (nextUrl.hostname === IDS_HOST) {
    throw new Error("需要登录");
  }

  return normalizeZbRequestUrl(nextUrl.href);
}
```

- [ ] **Step 3: 替换 `fetchBuffer`**

把现有 `fetchBuffer(url)` 函数替换为：

```js
function fetchBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let requestUrl;
    try {
      requestUrl = normalizeZbRequestUrl(url);
    } catch (error) {
      reject(error);
      return;
    }

    get(requestUrl, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`重定向次数超过上限 ${MAX_REDIRECTS}`));
          return;
        }

        let nextUrl;
        try {
          nextUrl = resolveRedirectUrl(
            res.headers.location,
            requestUrl,
            redirectCount,
          );
        } catch (error) {
          reject(error);
          return;
        }

        fetchBuffer(nextUrl.href, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}
```

- [ ] **Step 4: 增加脚本导入安全 guard**

把文件末尾：

```js
main();
```

替换为：

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

这样后续 one-liner 可以 import URL helper，不会触发交互式 OpenList 登录流程。

- [ ] **Step 5: 替换文章图片提取逻辑**

在 `collectImageVerificationData()` 中删除局部 `const ZB_BASE = "https://zb.hit.edu.cn";`，使用文件顶部常量。

把当前图片提取与 URL 拼接逻辑：

```js
const imgMatches = articleHtml.matchAll(
  /<img[^>]+src="([^"]+(?:\/upload\/hit\/image\/|\/images\/help\/)[^"]+)"/g,
);
const imgUrls = [...imgMatches].map((m) => m[1]);

for (const src of imgUrls) {
  const fullUrl = src.startsWith("http") ? src : `${ZB_BASE}${src}`;
  if (!allImageUrls.includes(fullUrl)) {
    allImageUrls.push(fullUrl);
  }
}
```

替换为：

```js
const imgMatches = articleHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
const imgUrls = [...imgMatches].map((m) => m[1]);

for (const src of imgUrls) {
  const normalizedUrl = normalizeCampusImageUrl(src);
  if (normalizedUrl && !allImageUrls.includes(normalizedUrl)) {
    allImageUrls.push(normalizedUrl);
  }
}
```

- [ ] **Step 6: 增加非交互式 URL helper 样例验证**

Run:

```powershell
bun -e "const m = await import('./scripts/update-campus-url.mjs'); const expect = (condition, message) => { if (!condition) throw new Error(message); }; expect(m.normalizeCampusImageUrl('https://zb.hit.edu.cn//images/help/demo.png') === 'https://zb.hit.edu.cn/images/help/demo.png', 'double slash image should normalize'); expect(m.normalizeCampusImageUrl('/images/help/demo.png') === 'https://zb.hit.edu.cn/images/help/demo.png', 'relative image should normalize'); expect(m.normalizeCampusImageUrl('https://evil.example/images/help/demo.png') === null, 'evil host should be rejected'); expect(m.normalizeCampusImageUrl('http://zb.hit.edu.cn/images/help/demo.png') === null, 'http image should be rejected'); try { m.resolveRedirectUrl('https://ids.hit.edu.cn/login', 'https://zb.hit.edu.cn/help', 0); throw new Error('ids redirect should throw'); } catch (error) { expect(String(error.message).includes('需要登录'), 'ids redirect should keep login error'); } try { m.resolveRedirectUrl('/help?page=2', 'https://zb.hit.edu.cn/help?page=1', 5); throw new Error('max redirect should throw'); } catch (error) { expect(String(error.message).includes('重定向次数超过上限'), 'max redirect should throw limit error'); } console.log('campus script url helpers ok');"
```

Expected:

```text
campus script url helpers ok
```

- [ ] **Step 7: 规范化现有 JSON**

把 `public/campus-verify.json` 中所有 `https://zb.hit.edu.cn//` 替换为 `https://zb.hit.edu.cn/`。完成后运行：

```powershell
bun -e "const cfg = await Bun.file('public/campus-verify.json').json(); const prefixes = ['/upload/hit/image/', '/images/help/']; for (const image of cfg.images) { const url = new URL(image.url); if (url.protocol !== 'https:' || url.hostname !== 'zb.hit.edu.cn') throw new Error('bad host: ' + image.url); if (url.pathname.startsWith('//')) throw new Error('double slash path: ' + image.url); if (!prefixes.some((prefix) => url.pathname.startsWith(prefix))) throw new Error('bad path: ' + image.url); } console.log('campus-verify urls ok');"
```

Expected:

```text
campus-verify urls ok
```

## Task 5: 最终验证

**Files:**
- Verify: `edgeone.json`
- Verify: `.vitepress/theme/components/md5-utf8.mts`
- Verify: `.vitepress/theme/components/alist.api.mts`
- Verify: `.vitepress/theme/components/OListItem.vue`
- Verify: `scripts/update-campus-url.mjs`
- Verify: `public/campus-verify.json`
- Verify: `docs/superpowers/plans/2026-04-25-issue13-hardening.md`

- [ ] **Step 1: 重新安装依赖基线**

Run:

```powershell
bun ci
```

Expected: completes successfully. `bun ci` is the Bun CLI frozen install command, not a `package.json` script.

- [ ] **Step 2: 运行构建**

Run:

```powershell
bun run docs:build
```

Expected: build complete。

- [ ] **Step 3: 确认废弃 API 已移除**

Run:

```powershell
if (rg "unescape\(encodeURIComponent" .vitepress/theme/components) { throw "deprecated encoding API still present" } else { "no deprecated encoding API" }
```

Expected:

```text
no deprecated encoding API
```

- [ ] **Step 4: 确认内部文档未进入构建产物**

Run:

```powershell
if (rg "docs/superpowers|issue13-hardening|2026-04-25-issue13" .vitepress/dist) { throw "internal docs leaked into build output" } else { "no internal docs in build output" }
```

Expected:

```text
no internal docs in build output
```

- [ ] **Step 5: 汇总 diff**

Run:

```powershell
git diff --stat
git status --short
```

Expected: changes are limited to `edgeone.json`, `.vitepress/theme/components/md5-utf8.mts`, `.vitepress/theme/components/alist.api.mts`, `.vitepress/theme/components/OListItem.vue`, `scripts/update-campus-url.mjs`, `public/campus-verify.json`, and this plan file.

- [ ] **Step 6: 记录部署后线上验证命令**

Do not run these until the change is deployed to EdgeOne Pages. After deployment, verify with:

```powershell
curl.exe -I https://fireworks.jwyihao.top/
curl.exe -I https://fireworks.jwyihao.top/campus-verify.json
```

Expected after deployment: homepage headers include `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Content-Security-Policy`; `/campus-verify.json` includes `Cache-Control: public, max-age=300, must-revalidate`.

- [ ] **Step 7: Commit checkpoint only if explicitly requested**

Do not create a git commit unless the user explicitly asks for one. If a commit is requested later, use Conventional Commits with a Chinese subject, for example:

```text
fix(security): 加固校园验证与响应头配置
```
