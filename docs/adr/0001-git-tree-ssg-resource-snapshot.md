# ADR：资料树采用完整 Git Tree 快照与 SSG 水合

- 状态：已实现
- 日期：2026-09-19

## 决策

构建期按资料仓库的固定 commit 读取完整 Git Tree，生成按 `repoId + commit + treeSha` 标识的完整树缓存。每门课程只关联一个资料仓库，文件不保存课程级关联字段。

SSG 使用完整树快照生成首屏页面，并将当前仓库的 `repoId`、`commit`、`treeSha` 与完整初始树数据注入页面。客户端 hydration 先复用与 SSR HTML 一致的快照；同一 SPA 会话中再次访问同仓库时复用 `repoId + commit` 快照，不重复请求。

hydration 完成后查询轻量 `resource-head`。如果当前 commit 与 SSG commit 相同，保持当前树；如果不同，后台请求该 commit 的完整树缓存，成功后替换资料树并用 PrimeVue Toast 做临时“已更新”提示。请求失败时保留旧树，并用 PrimeVue Toast 提示当前显示的是构建版本；不放置持久页面提示。

资料仓 push 不立即构建全站。GitHub Webhook 只写独立 event marker；每日固定时间的 GitHub Actions 比较当前 head 与最近成功构建 commit，只有存在差异才调用 EdgeOne 部署 Webhook。构建期间的新事件独立保留，不因旧构建成功而丢失。

## 缓存

- `resource-head/<repoId>`：约 10 分钟缓存，用于发现版本变化。
- 完整树缓存：`repoId + commit + treeSha` 不可变，CDN 侧缓存 1 年 `immutable`。
- 版本化资料正文：固定 commit 时 CDN 侧缓存 1 年 `immutable`。
- 固定 `main` 的下载地址只能短缓存，不能直接缓存一年。
- 不生成或运行时依赖全站 `repository-resources.json`；不维护任何手写文件清单。

## 取舍

选择完整树快照而非分页，原因是当前单仓库资料树规模可接受，Git Tree 只包含元数据和路径，不包含文件正文；完整快照可让 SSG 直接输出可用页面，也让 Edge Function 只在版本变化或缓存缺失时工作。若未来出现超大仓库，再以目录子树分页作为容量优化，不改变权威来源和版本键。

## 验收

1. 资料仓新增、删除、重命名文件无需修改 Registry 文件清单即可在热更新和下一次构建中反映。
2. 同一仓库关联的课程看到相同树；不存在文件级课程归属。
3. 同 commit hydration 不请求 Git Tree；不同 commit 后台更新。
4. 首屏 SSG 在无 JavaScript 时包含完整资料树。
5. 新旧 commit 缓存严格隔离；更新失败保留旧树并只显示临时 Toast。
6. 无 dirty 事件不构建；push、重复 webhook、构建失败和构建期间新 push 不丢状态。
