# Issue #13 已确认改进项设计

## 背景

GitHub issue #13「一些小问题」集中列出了若干安全与维护性建议。按项目边界核对后，当前仓库主体是 VitePress 静态站点，文件访问依赖 OpenList，校园网检测是无后端条件下的访问门槛，不承担完整认证系统职责。因此本设计只纳入讨论中已经确认值得处理、且能在当前架构内低成本落地的改进项。

线上站点 `https://fireworks.jwyihao.top/` 当前由 EdgeOne Pages 提供服务。已确认 HTTP 会跳转到 HTTPS，资源 `Content-Type` 基本正确，但缺少 HSTS、`nosniff`、frame 防护、Referrer-Policy、Permissions-Policy 等常见安全响应头。同时，`/campus-verify.json` 作为非 hash 配置文件当前返回一年浏览器缓存，不利于后续快速更新校园验证数据。

## 目标

1. 替换前端与 OpenList API 工具中的 `unescape(encodeURIComponent(...))`，消除废弃 API，同时保持中文字符串参与 MD5 时的字节语义不变。
2. 缩短校园验证图片探测超时，并在失败或超时时主动取消当前图片加载，减少异常网络下的等待时间。
3. 对校园验证图片 URL 增加 `https://zb.hit.edu.cn` 白名单校验，覆盖生成脚本和前端运行时两个入口。
4. 增强 `scripts/update-campus-url.mjs` 的重定向处理，使用 `URL` 解析、限制协议和主机、加入最大跳转次数。
5. 增加 EdgeOne Pages 的 `edgeone.json` 配置，补充保守安全响应头。
6. 单独降低 `/campus-verify.json` 的浏览器缓存时间，并让前端读取该文件时触发 revalidation，避免非 hash 配置文件被长期缓存。

## 非目标

1. 不新增后端服务、会话系统、完整鉴权、防重放或强认证能力。
2. 不把 OpenList 后端权限边界问题作为前端安全漏洞处理。
3. 不引入证书钉扎、自定义 CA 或本地脚本专用 TLS 信任链。
4. 不引入会限制 `script-src`、`style-src`、`img-src`、`connect-src` 的严格 CSP；本轮只采用不易误伤 VitePress 的保守 CSP 指令。
5. 不重构页面结构、下载源选择逻辑、OpenList API 形态或校园网检测算法。
6. 不处理仅影响缓存命中徽标展示的响应头可信度问题。
7. 不在本轮调整 OpenList API 错误信息脱敏；该项影响偏低，且未被列入已确认改进项。

## 方案对比

### 方案 A：按 issue 编号逐项修复

优点是与 #13 原始反馈一一对应，便于在 issue 中逐条回复。

缺点是 #1/#5/#14 都属于重定向处理，#2/#6 都属于校园验证图片 URL 校验，按编号实现会产生重复设计和重复验证。

### 方案 B：按工作流组织修复

把改进拆成三条工作流：本地维护脚本健壮性、前端校园验证与 MD5 编码、EdgeOne Pages 部署响应头与缓存。

优点是更接近实际文件边界，后续实现计划和验证命令更清晰。

### 方案 C：只做最小清单式修复

优点是文档最短。

缺点是缺少边界说明、风险处理和验收标准，后续实现时容易重新讨论哪些项应做、哪些项不应做。

## 选定方案

采用方案 B。

原因是本轮只覆盖已确认会做的改进项，而这些改进天然落在三个边界清晰的区域：`scripts/update-campus-url.mjs`、`.vitepress/theme/components/`、EdgeOne Pages 部署配置。按工作流组织能避免重复实现，也便于后续把验证拆成脚本、构建、线上响应头三部分。

## 详细设计

### 1. 本地维护脚本健壮性

涉及文件：`scripts/update-campus-url.mjs`。

`fetchBuffer` 应改为基于 `URL` 对象处理请求地址和重定向地址。初始请求和普通重定向只允许 `https:` 协议和 `zb.hit.edu.cn` 主机。遇到 `Location` 指向 `ids.hit.edu.cn` 时，不继续抓取该地址，而是保留现有“需要校园网/VPN 登录”的错误语义。

新增最大重定向次数，建议值为 5。超过上限时抛出明确错误，避免无上限递归。相对路径 `Location` 必须用当前请求 URL 作为 base 解析，解析失败时视为无效重定向。

校园验证图片提取逻辑应改为先提取通用 `<img src="...">`，再统一通过 URL 规范化函数过滤，而不是继续依赖当前把路径片段写进正则的提取方式。该函数使用 `new URL(src, ZB_BASE)` 解析相对和绝对地址。

当前 `public/campus-verify.json` 中存在 `https://zb.hit.edu.cn//images/...` 和 `https://zb.hit.edu.cn//upload/...` 这类双斜杠路径。规范化函数必须先把 `pathname` 开头的多个 `/` 折叠为单个 `/`，再进行路径白名单判断，并返回规范化后的 canonical URL。实施时应同步规范化现有 `public/campus-verify.json`，避免前端白名单上线后把现有图片全部跳过。

规范化后的 URL 必须同时满足：

1. `protocol === "https:"`。
2. `hostname === "zb.hit.edu.cn"`。
3. `pathname` 以 `/upload/hit/image/` 或 `/images/help/` 开头。

不符合条件的图片 URL 直接跳过或报错，不能写入 `public/campus-verify.json`。

### 2. 前端校园验证与 MD5 编码

涉及文件：`.vitepress/theme/components/OListItem.vue` 与 `.vitepress/theme/components/alist.api.mts`。

现有 `unescape(encodeURIComponent(str))` 的用途是把 JavaScript 字符串转成 UTF-8 字节序列，再交给当前 MD5 实现处理。替换时应引入一个小型 UTF-8 二进制字符串转换 helper，使用 `TextEncoder` 得到 `Uint8Array`，再用循环或分块方式转换为由 byte code 组成的字符串，保证 ASCII、中文、路径和密码输入得到的 MD5 结果与旧实现一致。不要使用可能触发参数数量上限的 `String.fromCharCode(...bytes)` 处理未知长度输入。

校园验证图片探测逻辑应将单图超时从 10 秒缩短到 5 秒。超时或失败时应先清理 `onload`、`onerror` 和定时器，再将 `img.src` 清空，避免浏览器继续加载已经判定失败的图片。成功路径也应清理 handler 和定时器，减少悬挂引用。

前端读取 `campus-verify.json` 时应使用 `fetch("/campus-verify.json", { cache: "no-cache" })` 或等效 revalidation 策略，避免存量浏览器继续使用旧的一年缓存响应。读取后，在发起 `new Image()` 请求前再次校验图片 URL。前端校验应与脚本使用同样的 canonical URL 逻辑：折叠 `pathname` 开头多个 `/`，只允许 `https://zb.hit.edu.cn/...` 且路径位于脚本允许的两个目录下。无效条目不参与密码候选计算，并应在控制台输出短警告，方便维护者发现配置污染。

本轮不设置 `crossOrigin`。该逻辑只读取 `naturalWidth` 和 `naturalHeight`，不读取 canvas 像素；当前风险控制重点是 URL 来源白名单和加载超时。

### 3. EdgeOne Pages 响应头与缓存

新增文件：`edgeone.json`，位于仓库根目录。

线上域名 `fireworks.jwyihao.top` 的响应头由 EdgeOne Pages 控制，现有 GitHub Pages workflow 不是本轮响应头配置入口。若 EdgeOne Pages 使用 Git 集成构建，应把 `edgeone.json` 放在仓库根目录；若未来改为直接上传 `.vitepress/dist`，则必须确保 `edgeone.json` 进入上传内容根目录。

全站 `/*` 增加保守安全响应头：

1. `Strict-Transport-Security: max-age=31536000; includeSubDomains`
2. `X-Content-Type-Options: nosniff`
3. `X-Frame-Options: DENY`
4. `Referrer-Policy: strict-origin-when-cross-origin`
5. `Permissions-Policy: camera=(), microphone=(), geolocation=()`
6. `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`

CSP 只包含不易误伤当前 VitePress 产物的指令，不限制脚本、样式、图片或接口来源。后续如果要引入完整 CSP，应单独做 report-only 验证，不纳入本轮。

对 `/campus-verify.json` 增加单独缓存头：

```http
Cache-Control: public, max-age=300, must-revalidate
```

该文件不是 hash 命名资源，不应像构建产物中的 hash JS/CSS 一样缓存一年。5 分钟缓存可以兼顾访问性能和配置更新速度。

`edgeone.json` 建议结构如下：

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

如果 EdgeOne Pages 对多个匹配的 `headers` 规则采用覆盖而不是合并语义，`/campus-verify.json` 作为 JSON 配置文件即使只应用短缓存规则也可接受；首页和页面 HTML 必须应用 `/*` 的安全头。实施时应对照 EdgeOne Pages 文档或线上结果确认 `source: "/*"` 的匹配语义，如平台要求不同通配写法，应同步调整示例。

## 验证计划

本地验证：

1. 执行 `bun ci`，确认依赖锁文件仍可复现安装。
2. 执行 `bun run docs:build`，确认 VitePress 构建通过。
3. 解析 `edgeone.json`，确认它是合法 JSON，且包含 `/*` 与 `/campus-verify.json` 两条 `headers` 规则。
4. 构建后检查 `.vitepress/dist`，确认内部 `docs/superpowers` 文档没有被站点产物收录。
5. 对 UTF-8 helper 做兼容校验，至少覆盖 ASCII、中文、混合路径、密码字符串四类输入，确认新 helper 生成的 MD5 与旧 `unescape(encodeURIComponent(...))` 路径一致。
6. 检查 `public/campus-verify.json` 中现有 URL 全部通过新的 `zb.hit.edu.cn` 白名单规则，并确认双斜杠路径已被规范化。
7. 在可访问 HIT 校园网或 VPN 的环境下运行 `bun run update-campus`，确认脚本仍能生成校园验证数据；如果当前环境无法访问，则记录网络限制，并至少用本地样例验证 URL 解析规则。样例应覆盖 `https://zb.hit.edu.cn//images/help/...`、`/images/help/...`、`https://evil.example/images/help/...`、`http://zb.hit.edu.cn/images/help/...`、`https://ids.hit.edu.cn/...` 和超过最大次数的重定向链。

线上验证：

1. 部署后执行 `curl.exe -I https://fireworks.jwyihao.top/`，确认全站安全响应头生效。EdgeOne Pages 配置可能存在生效延迟；如果首次验证未命中，应等待配置发布完成，必要时刷新 CDN 缓存后重试。
2. 执行 `curl.exe -I https://fireworks.jwyihao.top/campus-verify.json`，确认 `Cache-Control` 已变为短缓存策略。
3. 访问首页与笔记页，确认 VitePress 页面正常渲染、主题切换和本地搜索入口不受 CSP 影响。
4. 在包含 `OList` 的页面触发资源列表加载，确认 OpenList 数据请求和校园验证流程仍可完成。

## 风险与回滚

重定向和 URL 白名单可能误伤 HIT 站点未来的合法资源域名或路径变更。如果 `zb.hit.edu.cn` 后续调整图片目录，应优先更新允许路径，而不是放宽到任意外链。

图片探测超时从 10 秒缩短到 5 秒可能在极慢网络下减少可用候选图片数量。由于候选图片并行加载，5 秒仍保留一定容错；若实际校园网环境频繁误判，可把超时调整到 8 秒，但不应恢复无清理的长超时。

`edgeone.json` 的安全头主要风险是 frame 限制影响第三方嵌入。如果只需要同源嵌入，可以把 `X-Frame-Options` 调整为 `SAMEORIGIN` 并同步调整 CSP `frame-ancestors`；如果需要可信第三方站点嵌入，应移除 `X-Frame-Options` 并用 CSP `frame-ancestors` 明确允许来源。

`Strict-Transport-Security` 的 `includeSubDomains` 在 `fireworks.jwyihao.top` 上只影响该主机及其子域。不要把同样配置直接加到父域 `jwyihao.top`，除非已经确认父域下所有子域都长期支持 HTTPS。

`X-Frame-Options: DENY` 与 CSP `frame-ancestors 'none'` 是有意的兼容性冗余。现代浏览器优先使用 CSP，旧浏览器仍可通过 `X-Frame-Options` 获得 frame 防护。

`/campus-verify.json` 短缓存可能增加少量回源请求。该文件体积小，且更新正确性比一年缓存更重要；如果流量压力明显，可以把 `max-age` 提高到 1800 或 3600，但不应继续使用一年缓存。响应头变更无法追溯缩短已经按旧一年缓存策略缓存该文件的存量浏览器缓存；为覆盖这类客户端，前端读取该文件时应使用 `fetch("/campus-verify.json", { cache: "no-cache" })` 或等效 revalidation 策略，确保后续访问会重新校验配置文件。

如果部署后安全头导致页面异常，优先回滚 `edgeone.json` 中的 CSP 行，而不是回滚所有安全头。`nosniff`、HSTS、Referrer-Policy 和 Permissions-Policy 对当前静态站点的破坏面较小。

## 接受标准

1. 仓库根目录存在合法 JSON 格式的 `edgeone.json`，并包含本设计列出的安全响应头和 `/campus-verify.json` 缓存规则。
2. `scripts/update-campus-url.mjs` 的请求和图片 URL 处理使用 `URL` 解析，并限制协议、主机、路径和最大重定向次数。
3. `public/campus-verify.json` 不会写入非 `https://zb.hit.edu.cn` 的图片 URL，且现有双斜杠图片路径被规范化。
4. 前端校园验证加载图片前会做同样的 URL 白名单校验。
5. 前端读取 `/campus-verify.json` 时使用 `cache: "no-cache"` 或等效 revalidation 策略。
6. 图片探测单图超时为 5 秒，成功、失败或超时时都会清理 handler；失败或超时时会取消当前图片加载。
7. `.vitepress/theme/components/OListItem.vue` 和 `.vitepress/theme/components/alist.api.mts` 不再使用 `unescape(encodeURIComponent(...))`。
8. UTF-8/MD5 兼容校验证明 ASCII、中文、混合路径、密码字符串输入的新旧结果一致。
9. `bun ci` 与 `bun run docs:build` 通过。
10. 构建产物不包含 `docs/superpowers` 内部文档。
11. 线上首页返回新增安全响应头，`/campus-verify.json` 返回短缓存策略。
