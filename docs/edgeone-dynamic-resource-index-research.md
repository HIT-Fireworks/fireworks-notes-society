# 动态资料索引与 EdgeOne 热加载研究

> 目标：资料仓提交可自动触发站点刷新；源码仓不维护任何手写文件清单；构建产物只作为快速缓存；EdgeOne Edge Function 在缓存缺失或过期时从 GitHub 真实 Git Tree 补充热数据。
>
> 访问日期：2026-09-19

## 结论

当前实现不符合目标：

1. 站点文件列表在构建期从 `config/repository-file-routes.v4.json` 读取，并生成静态 `repository-resources.json`；这是显式文件清单。
2. `edge-functions/gh/[[default]].js` 只把已知路径重定向到 Raw GitHub/代理节点，不读取 Git Tree，也不能发现新增、删除或重命名文件。
3. EdgeOne 项目绑定的是主站仓库 `HIT-Fireworks/fireworks-notes-society` 的 `main` 分支。资料仓库是其他 GitHub 仓库，资料仓 push 不会天然触发主站项目构建。

推荐目标架构：

```text
GitHub 资料仓 push
        │
        ├─ GitHub Organization Webhook → Edge Function webhook
        │       └─ repository_dispatch（防抖通知主站）
        │
        ├─ 主站 GitHub Action：等待安静窗口 + 最小构建间隔
        │       └─ 触发主站 main 空提交，沿用 EdgeOne Git Provider 自动构建
        │
        └─ Edge Function：
              GitHub Git Tree → 派生文件元数据 → Edge Cache/KV

主站构建产物 = 快速缓存，不是权威文件清单
GitHub Git Tree = 文件路径、大小、模式、提交版本的唯一权威来源
课程 Registry = 课程代码 → 资料仓库的稳定关系，不保存仓内文件列表
```

### 关键决策

- **不再把 `repository-file-routes.v4.json.files` 作为运行时文件列表真源。** 它可以暂时作为历史迁移证据，但新的站点文件列表不应从它读取。
- **允许缓存中出现自动生成的派生索引。** Edge Cache、KV、Blob 或未提交的构建产物中的文件元数据不是手写清单；它必须带仓库 commit SHA，可被 Git Tree 重建和淘汰。
- **课程代码 → repo_id 仍需保留。** 这是课程归属关系，不是文件清单；课程页面先解析资料仓，再动态获取该仓当前 Git Tree。
- **下载正文继续走 `/gh/<repo>/<path>`。** 热索引只返回路径、文件名、大小、目录类别和 commit，不把大文件搬进 Edge Function。

## 当前代码证据

### 构建期显式文件清单

- `.vitepress/theme/repository-resources.ts` 读取：
  - `data/repository-manifest.no-collection.v4.json`
  - `config/repository-file-routes.v4.json`
- `repositoryFileEntries()` 将 `routes.files` 转成 `RepositoryFileEntry[]`。
- `.vitepress/theme/course-catalog-delivery.ts` 将 `repositoryFileEntries()` 写入构建产物 `repository-resources.json`。
- `CourseDetail` 和资料页从这个构建快照筛选文件。

### 当前 Edge Function 只处理下载重定向

`edge-functions/gh/[[default]].js`：

- 解析 `/gh/<repo>/<path>`；
- 生成 `raw.githubusercontent.com/HIT-Fireworks/<repo>/main/<path>`；
- 选择代理节点；
- 返回 302；
- 使用 Cache API 缓存“代理节点选择”，不缓存 Git Tree 或文件列表。

### 当前构建触发

官方 EdgeOne GitHub Provider 文档说明：绑定仓库后，部署分支的新提交会自动拉取并部署。当前 EdgeOne 项目实测 Provider 为 `Github`，绑定主站仓库 `HIT-Fireworks/fireworks-notes-society` 的 `main`。

因此：

- 主站代码 push：可触发 EdgeOne 自动构建；
- 任意资料仓 push：不会自动触发另一个 GitHub 仓库的 EdgeOne 项目构建；需要额外通知链路。

## 官方限制与证据

| 能力 | 官方限制/行为 | 对本项目的影响 |
|---|---|---|
| Edge Function 代码包 | 5 MB | 动态索引函数必须保持很小；不能把全量课程/文件数据打包进去。 |
| Edge Function 请求体 | 1 MB | webhook payload 与 API 请求应保持小；不要把整棵树通过客户端 POST 上传。 |
| Edge Function CPU | 单次 200 ms CPU 时间片 | 不适合在边缘节点做大规模 JSON 解析、全量跨仓扫描或复杂归并；I/O 等待不计入 CPU，但解析和转换计入。 |
| Edge Function 月执行数 | Free Edition 3,000,000 次/月 | 按请求量看足够，但 GitHub API 冷请求、CPU 月额度和外部限流仍是主要风险。 |
| Edge Function 月 CPU | Free Edition 3,000,000 ms/月 | 平均每次 1 ms 约可支撑 3M 次；若每次解析大 Tree 接近 50–200 ms，实际可承载量会显著降低。 |
| Pages 构建次数 | Free Edition 500 builds/月 | 资料仓每次 push 都触发完整构建不可取；必须防抖并设置最小构建间隔。 |
| Pages 并发构建 | 1 | 多个资料仓同时提交时会排队；需要集中合并触发。 |
| Pages 单次构建超时 | 20 分钟；4 cores、6 GB | 当前完整构建实测约 16 分钟，只有约 4 分钟余量；不能把每次资料仓 push 都转为构建。 |
| Pages 项目文件数/总容量 | 20,000 文件/项目、5 GB 总容量 | 静态缓存需控制文件数量；当前页面产物应保持在限制内。 |
| KV | Free Edition 1 GB；官方 KV 文档说明边缘缓存最长约 60 秒最终一致；最多 10 个 namespace | 适合保存 repo→head、commit→索引元数据等小状态，不应当作为大文件源。 |
| KV 单值 | 官方总配额页写最大值 1 MB；KV API 页的 `put` 参数又写 ≤25 MB，存在文档冲突 | 设计按更严格的 **≤1 MB/值**，按仓库分片；在控制台实测确认后再放宽。 |
| KV key | ≤512 B；list 默认/最大 256 | 采用短 key，例如 `head/<repo>`、`tree/<repo>/<commit>`；176 仓可单 namespace 分页读取。 |
| Blob | Free Edition 1 GB；单值 25 MB | 可作为较大派生索引的备选，但需确认当前项目是否已绑定 Blob；不把 Blob 当 Git 源。 |
| Edge Cache API | 缓存只在当前数据节点有效，不会自动复制；过期 `cache.match` 不主动回源，可能返回 504；`cache.put` 不能使用 `no-store`/`no-cache`/`private`，不能缓存 206 | 必须显式设计 miss/fallback；不能假设一次暖缓存全球同步。用 commit 作为不可变缓存键。 |
| GitHub REST 未认证 | 60 requests/hour/IP | Edge Function 不能匿名高频查 Tree。 |
| GitHub REST 认证 | 通常 5,000 requests/hour；GitHub App/Enterprise 情况另有额度 | 动态索引必须使用服务端 GitHub App installation token/PAT，不能把 token 发到浏览器。 |
| GitHub secondary limit | REST 最多 100 并发；通常 900 points/min/endpoint；内容生成还有限额 | 禁止每个浏览器请求都递归调用 GitHub；必须缓存、合并和限并发。 |
| Git Trees recursive | 返回树数组最多 100,000 entries、最大 7 MB；`truncated=true` 时必须改用非递归逐目录读取 | 单仓热索引需实现 truncated fallback；不能假设所有仓一次递归成功。 |
| GitHub Contents 目录 | 单目录接口上限 1,000 文件；更大目录使用 Git Trees | 不用 Contents 递归扫仓库；优先 Tree API。 |

官方来源：

- [Edge Functions - EdgeOne Makers](https://pages.edgeone.ai/document/edge-functions)：代码包 5 MB、请求体 1 MB、CPU 200 ms、Fetch/Cache API、`waitUntil`。
- [EdgeOne Makers Free Edition Quotas and Limits](https://pages.edgeone.ai/document/limits-and-quotas)：Free Edition 的构建、函数、KV、Blob 配额。
- [KV Storage - EdgeOne Makers](https://pages.edgeone.ai/document/kv-storage)：KV 的边缘缓存、60 秒最终一致、key/value/list API。
- [Edge Function Cache API - Tencent Cloud](https://cloud.tencent.com/document/product/1552/81893)：Cache API 的节点局部性、过期行为和 `cache.put` 限制。
- [Importing a Git Repository - EdgeOne Makers](https://pages.edgeone.ai/document/importing-a-git-repository)：GitHub 绑定、部署分支 push 自动部署。
- [Build Guide - EdgeOne Makers](https://pages.edgeone.ai/document/build-guide)：Auto Deploy、构建并发和环境行为。
- [Use Github Actions - EdgeOne Pages](https://pages.edgeone.ai/document/use-github-actions)：通过 GitHub Action 构建和部署的官方路径。
- [EdgeOne Pages Notification](https://pages.edgeone.ai/document/notification)：EdgeOne 自身部署事件 webhook；它不是资料仓 GitHub push webhook。
- [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees)：递归 Tree 的 100,000 entries/7 MB 上限及 truncated fallback。
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)：目录 1,000 文件上限及大文件限制。
- [GitHub About Webhooks](https://docs.github.com/en/webhooks/about-webhooks)：push webhook 近实时、比轮询节省 API 资源、可用于触发 CI/deploy。
- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)：未认证/认证额度、并发和 secondary limits。

上述官方页面访问日期均为 2026-09-19。

## 请求与规模估算

当前规模：176 个受控仓、117 个有资料仓、3,857 个资料文件；页面访问通常只涉及 1–3 个资料仓。

### 构建缓存刷新

若一次构建扫描 117 个有资料仓：

- 每仓至少需要获取一次 `main` head/tree；
- 每仓一次递归 Tree，约 2×117 = 234 个 GitHub API 请求（若使用 commit 直接取 tree，可减少 head 请求）；
- 只在构建时执行，不应由浏览器执行；使用 GitHub Actions token，避免 60/hour 未认证限制；
- 这类构建适合按资料 push 批量执行，不适合每个仓每次 commit 单独执行。

### 热加载

推荐单次请求流程：

1. 浏览器请求 `/api/resources?repo=<id>`；
2. Edge Function 读取 `head/<repo>`（KV）或短 TTL head Cache；
3. 以 commit SHA 查 `tree/<repo>/<commit>`；
4. miss 时只向 GitHub Git Trees API 请求一次；
5. 返回已过滤的文件元数据；下载本体仍走现有 `/gh/<repo>/<path>`。

理论上热门仓每个 edge node 每个 commit 只产生一次冷 Tree 请求；实际 Cache API 是节点局部缓存，全球不会只请求一次，因此需要 head KV/Blob、GitHub App token、失败重试和旧缓存回退。

### CPU/配额估算

- Edge Function 执行次数：若每天 10,000 个热索引请求，约 300,000 次/月，低于 3M/月。
- 若每天 100,000 个请求，约 3M/月，已接近 Free Edition 上限。
- 3M ms CPU/月意味着平均 CPU 预算：
  - 300,000 请求/月约 10 ms/请求；
  - 3,000,000 请求/月约 1 ms/请求。
- 因此响应缓存命中必须尽量不解析大 JSON；Tree miss 只允许低频发生。
- 当前完整构建约 16 分钟，Free Edition 20 分钟超时；若每天 1 次构建约 30 次/月，安全；若每 30 分钟构建约 1,440 次/月，超过 500 builds/月。

## 方案比较

### A：Edge Function 直接调用 GitHub Contents/Tree API

**优点**：实现最直接；没有源码文件清单；新增/删除实时可见。

**问题**：

- 每个冷请求消耗 GitHub API；匿名额度只有 60/hour；
- 每个 edge node 的 Cache API 不共享，热门仓在多节点会重复冷请求；
- Contents 单目录 1,000 文件，需 Tree API；
- 需要处理 Tree 7 MB/100k entries 截断；
- 单次 CPU 200 ms，不能在函数里做重型归并；
- GitHub token 必须保存在 EdgeOne secret，不能发送给浏览器。

**结论**：可以做低流量 fallback，不适合单独作为主索引方案。

### B：Edge Function 读取 Git Tree/raw，并用 Edge Cache

**优点**：访问速度快；commit SHA 可作为不可变缓存键；无源码清单。

**问题**：

- Cache API 只在当前数据节点有效，不自动全球复制；
- 新 commit 的 head 发现仍要查询 GitHub 或依赖 webhook；
- Cache miss 仍受 GitHub API 限流；
- 只能缓存派生元数据，不能把 9.16 GB 资料放进 KV/Blob/Edge Function；
- Cache 过期不会主动回源，代码必须处理 miss/504。

**结论**：应作为热加载层和构建缓存回退层，但必须配合 webhook/head 状态和服务端 token。

### C：GitHub Webhook/Actions 生成派生缓存索引，Edge Function 提供热加载

**优点**：

- GitHub Webhook 近实时，避免轮询 176 个仓；
- 文件列表由真实 Git Tree 自动生成，不在源码仓手写；
- Edge Function 只读缓存，低 CPU、低 GitHub API 压力；
- 构建与热加载解耦：构建是快速缓存，热数据可先于完整构建可见。

**问题**：

- 需要组织级 GitHub Webhook 或 GitHub App 权限；
- 需要持久队列/去重状态，不能只靠 Edge Function `waitUntil`；
- KV 60 秒最终一致，适合作为 dirty/head 状态而不是强一致队列；
- 需要处理 webhook 重试、签名、乱序、重复 push；
- EdgeOne 当前 GitHub Provider 仍只会看到主站仓 push，外部资料仓事件必须经过额外触发链路。

**结论**：推荐。C 负责更新派生缓存和触发构建，B 负责读取热数据，A 只作为最终 fallback。

## 推荐接口与缓存键

### 1. GitHub Webhook 接口

`POST /api/resource-events/github`

- 来源：GitHub Organization Webhook，事件 `push`；
- 校验：`X-Hub-Signature-256`，密钥放 EdgeOne secret；
- 读取 payload：`repository.full_name`、`after`、`ref`、`deleted`；
- 行为：只记录 `repo/<repoId>/head = <after>` 和 dirty 时间，不在请求内扫全仓；
- 返回：快速 `202`；使用 `waitUntil` 只做轻量异步写入，不能把它当持久队列。

### 2. 热文件索引接口

`GET /api/resources/repo/<repoId>?ref=main`

响应只包含：

```json
{
  "repoId": "22MA15024",
  "commit": "<sha>",
  "entries": [
    {"path":"教材/概率论与数理统计_第2版.pdf","name":"概率论与数理统计_第2版.pdf","size":123,"category":"教材"}
  ],
  "source":"github-tree",
  "stale":false
}
```

- `repoId` 只允许当前课程归属映射中的仓库；
- GitHub Tree 递归结果按根分类过滤；
- `entries` 不写回源码仓，不作为人工维护数据；
- Tree 超过 7 MB/100k entries 时按子树递归读取；
- 大仓可以按 `category` 分页，避免一次响应过大。

### 3. 缓存键与 TTL

- `head/<repoId>`：KV/派生状态，值为资料仓最近 push 的 commit SHA 与事件时间；不保存文件路径、文件名或大小。
- `built/<repoId>`：构建元数据中的最近成功构建 commit；只表示缓存版本，不是文件清单。
- `dirty/<repoId>`：资料仓 push 写入的最新 SHA；每日构建据此判断是否需要刷新。
- `tree/<repoId>/<commitSha>/<category>`：Edge Cache 或 Blob/KV 中按 commit 派生的文件元数据；commit 不可变，可缓存 1 小时至 24 小时。
- 浏览器响应：`ETag: "<repoId>-<commitSha>-<category>"`。

建议 TTL：

- `GET /api/resource-head/<repoId>`：`Cache-Control: public, max-age=600, s-maxage=600`。这是可调整的发现延迟；建议先用 10 分钟，不能设成一年，否则新 push 最长一年无法自动发现。
- `GET /api/resources/repo/<repoId>?commit=<sha>`：commit 是不可变版本，建议 `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`；一年缓存安全，因为新 commit 使用新 URL 查询键。
- `/repository-resources.json?commit=<buildGeneration>`：构建产物版本化后可用一年 `immutable`；不要对无版本固定 URL 设置一年缓存，除非每次部署使用 CDN purge 或版本化入口。
- `/api/resource-build-meta`：只包含 `repoId → builtCommit`，建议 `max-age=600, s-maxage=600`；它是构建版本发现接口，不是文件清单。
- 下载正文 `/gh/<repo>/<path>?commit=<sha>`：如果 URL 能固定到 commit，可用一年 `immutable`；当前 `/gh/<repo>/<path>` 固定 main，不能直接设一年，否则替换同一路径的文件会被旧缓存压一年。
- 每日构建只在存在 `dirty/<repoId> != built/<repoId>` 时执行；没有 dirty 差异就退出，不消耗 Pages 构建额度。
- 多个 push 在当天合并为一次构建；热索引不等待每日构建。

### 需要在 CDN 侧调整的缓存配置

开发完成后提醒在 CDN/EdgeOne 控制台配置：

1. `GET /api/resources/repo/<repoId>?commit=<sha>`：TTL 1 年，`immutable`；
2. `/repository-resources.json?commit=<buildGeneration>`：TTL 1 年，`immutable`；
3. `/gh/<repo>/<path>?commit=<sha>`：TTL 1 年，`immutable`；
4. `/api/resource-head/<repoId>`：TTL 10 分钟；
5. `/api/resource-build-meta`：TTL 10 分钟；
6. 不要给固定 `main` 下载 URL 设置 1 年缓存，除非同步执行 purge；
7. 旧版本 commit 缓存不需要 purge，新 commit 使用新键自然隔离。

## 构建 commit 快路径

课程页面加载某个资料仓时采用以下判断：

1. 读取构建产物中的 `builtCommit(repoId)`；
2. 请求轻量的 `GET /api/resource-head/<repoId>` 获取当前 commit；
3. 如果两者相同，直接筛选构建产物中的资料缓存，不查询 Git Tree；
4. 如果两者不同，请求 `GET /api/resources/repo/<repoId>?commit=<currentCommit>`；
5. 热索引成功后显示新结果，并保留构建缓存作为 fallback。

因此，commit 相同的常规请求不会实际查询仓库文件树。只查询一个很小的 commit SHA 接口；该接口缓存 10 分钟。文件 Tree 接口按 commit 缓存一年，因为 commit 键不可变。

构建产物中的 `repository-resources.json` 仍然可以保留，但它必须被明确视为派生缓存：构建时从真实 Git Tree 生成，源码仓不维护它，Registry 不保存仓内文件清单。后续应移除运行时对 `repository-file-routes.v4.json.files` 的依赖。

## 构建触发方案

### Webhook marker 设计

资料仓 push 不直接触发全站构建，只写两个小型 marker。推荐 marker 结构：

```json
{
  "repoId": "22MA15024",
  "branch": "main",
  "headCommit": "<40-char-sha>",
  "eventId": "<github-delivery-id>",
  "observedAt": "2026-09-19T00:00:00Z",
  "generation": 17
}
```

KV keys：

- `resource/head/<repoId>`：最近一次有效 push 的 marker；只接受 `ref=refs/heads/main`。
- `resource/dirty/<repoId>`：待构建 marker；保存最新 SHA，不保存文件列表。
- `resource/built/<repoId>`：最近成功构建的 `headCommit`、构建 ID 和完成时间；只保存版本状态。
- `resource/event/<eventId>`：短期幂等记录，防止 GitHub webhook 重试重复入队。

Webhook 处理规则：

1. 校验 `X-Hub-Signature-256`、`X-GitHub-Event=push`、仓库归属和 `refs/heads/main`。
2. 以 `X-GitHub-Delivery` 做幂等键；已处理事件直接返回 202。
3. 写入 `head` 和 `dirty` 时只允许新事件覆盖旧事件；不能用旧 delivery 覆盖更新的 SHA。
4. 立即返回 202；不要在 webhook 请求内扫描 Git Tree。
5. marker 只记录版本，不是文件清单；文件路径、大小和分类只能从该 commit 的 Git Tree 派生。

### 每日固定检查

使用 GitHub Actions 的 `schedule` 事件，例如每天 UTC 02:00：

```yaml
on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:
concurrency:
  group: resource-rebuild
  cancel-in-progress: false
```

workflow 步骤：

1. 读取所有 `resource/head/*` 与 `resource/built/*` marker；
2. 计算 `dirty = headCommit != builtCommit`；
3. `dirty` 为空时退出成功，不触发 Pages 构建；
4. 有 dirty 时建立本次 immutable build plan：`repoId → scanCommit=headCommit`；
5. 触发主站构建/部署；
6. 构建成功后只把仍然等于 `scanCommit` 的 dirty marker 更新为 built；
7. 如果构建期间 webhook 已写入更晚的 SHA，则保留 dirty marker，下一天继续构建。

每日 workflow 是“检查频率”，不是“无条件构建频率”。因此 Pages 每月最多约 30 次计划检查，但只有发生资料变化才消耗构建额度。

### 构建期间竞态

设本次扫描计划为 `scanCommit=A`：

```text
t0: dirty=A, built=Z
t1: 每日检查锁定 scanCommit=A
t2: 资料仓 push B，Webhook 写 dirty=B
t3: 构建 A 成功，写 built=A
t4: dirty=B != built=A，B 不丢失，下一次构建继续处理
```

禁止无条件执行 `dirty = built`；只能 CAS/条件更新 `dirty[A] → clean`。这样高频 push 不会在构建完成时被误清除。

### 触发方式

1. 在 GitHub Organization 层配置 `push` Webhook 到 Edge Function；
2. Edge Function 验签并写入 marker；不扫描文件树；
3. 每日固定时间的 GitHub Actions workflow 比较 dirty/build 状态；
4. 有差异时只触发一次主站构建，使用 workflow concurrency 合并重复调度；
5. 构建从每个受影响资料仓的真实 Git Tree 生成派生缓存和 `resource-build-meta.json`；
6. 构建部署成功后按上述 CAS 规则更新 built；
7. 当前 EdgeOne GitHub Provider 绑定主站 `main` 时，最小触发方式是主站 push；也可使用 EdgeOne 项目 deployment webhook 触发 redeploy，但 webhook URL 必须作为机密管理。

这里的“每日一次”是完整站点构建频率，不限制热索引。新文件会先由热索引可见，下一次成功构建后进入快速静态缓存。
## 失败降级

1. **GitHub API 限流**：继续服务同 commit 的 Edge Cache/KV；新 commit 暂时返回上一版本并带 `stale=true`，不把错误当空目录。
2. **Git Tree truncated**：改用非递归子树读取；超过单分类响应大小时分页。
3. **KV 暂时旧值**：用 webhook payload 的 commit 做单调性比较；旧 commit 不覆盖新 commit。
4. **Cache API miss/504**：先读 KV/Blob 派生缓存；再回源；最终回退构建缓存。
5. **Webhook 重复/乱序**：按 commit ancestry/时间戳去重；不能以较旧 `after` 覆盖新 head。
6. **构建排队或超时**：不阻塞热接口；延迟构建，继续提供 commit-specific hot index。
7. **GitHub 仓库删除/分支重置**：返回明确状态；不自动把仓库显示为空；需要重新获取 head 和 tree 后确认。

## 为什么当前规模能支撑

**可以支撑，但不能采用“每个浏览器请求直接打 GitHub API”的实现。**

推荐组合：

- GitHub Webhook：事件驱动，不轮询；
- GitHub Actions：防抖、限频、构建缓存生成；
- Edge Function：小逻辑、缓存命中优先；
- Cache/KV：保存按 commit 派生的小索引；
- GitHub API：只有 webhook 后刷新和 cache miss 使用。

当前 Free Edition 3M Edge Function executions/month 对普通站点流量足够；3M ms CPU/month 要求缓存命中路径极轻。Pages 500 builds/month 和当前约 16 分钟构建时间是更紧约束，必须限频；不能每个资料仓 commit 都完整构建。

## 未决事实与上线前必须验证

官方资料未确认或存在版本差异的项目：

1. Edge Function 的响应体大小、单次 wall-clock timeout、`waitUntil` 实际延长时间；
2. Cache API 的实际空间、单 key 大小、跨节点淘汰和最大 TTL；
3. EdgeOne KV 配额页写单值 1 MB，但 KV API 页写 `put` value ≤25 MB；上线按 1 MB 设计并做控制台实测；
4. EdgeOne 项目是否可直接配置 Organization-level GitHub Webhook，及其对 176 个资料仓的授权范围；
5. EdgeOne GitHub Provider 是否支持 repository_dispatch 直接触发，当前文档只明确 deployment branch push 自动部署；
6. 当前主站 domain/CDN 对 `/api/resources/*` Edge Function 路由的具体缓存覆盖方式；
7. GitHub App token 在 Edge Function secret 中的轮换和最小权限配置。

上线前建议用 1 个测试资料仓完成：push → webhook → dirty/head → hot index → 空提交 → EdgeOne build → 静态缓存替换的全链路验收，再扩展到组织级 Webhook。
