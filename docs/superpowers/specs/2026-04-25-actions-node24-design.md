# GitHub Actions Node 24 兼容升级设计

## 背景

`Deploy to Pages` workflow 在最近一次推送后成功完成，但 GitHub Actions 给出 annotation：多个 GitHub-owned actions 仍运行在即将弃用的 Node.js 20 runtime。该 annotation 提示 Node.js 20 actions 会在 2026-06-02 起默认被强制切到 Node.js 24，并在 2026-09-16 从 runner 中移除。

当前 workflow 文件为 `.github/workflows/deploy.yml`。它只包含一个 Pages 部署 job，流程为 checkout、setup Bun、setup Pages、`bun ci`、`bun run docs:build`、上传 Pages artifact、部署 Pages。

## 目标

消除 GitHub Actions Node.js 20 runtime deprecation warning，并在 GitHub 默认切换前主动使用官方 Node 24 兼容 action 版本。

## 非目标

- 不改变 Bun 版本安装方式。
- 不改变依赖安装命令 `bun ci`。
- 不改变 VitePress 构建命令 `bun run docs:build`。
- 不改变 Pages 权限、触发条件、并发策略或部署环境。
- 不使用 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` 强制旧 action 运行在 Node 24。

## 实现约束

实现阶段在项目内 `.worktrees/` 目录创建独立 worktree，避免直接在主工作区修改 workflow。

## 方案

采用最小 workflow 版本升级，只更新 GitHub-owned actions：

- `actions/checkout@v4` 升级到 `actions/checkout@v6`。
- `actions/configure-pages@v5` 升级到 `actions/configure-pages@v6`。
- `actions/upload-pages-artifact@v3` 升级到 `actions/upload-pages-artifact@v5`。
- `actions/deploy-pages@v4` 升级到 `actions/deploy-pages@v5`。

继续保留 `oven-sh/setup-bun@v2`，因为本次 annotation 未指向该 action，且当前部署已成功。

## 依据

通过 GitHub 官方仓库 release/tag 与 `action.yml` 确认：

- `actions/checkout` 最新 v6 系列为 `v6.0.2`，`action.yml` 使用 `node24`。
- `actions/configure-pages@v6.0.0` release notes 标明升级到 Node 24，`action.yml` 使用 `node24`。
- `actions/deploy-pages@v5.0.0` release notes 标明升级到 Node 24，`action.yml` 使用 `node24`。
- `actions/upload-pages-artifact@v5.0.0` 是 composite action，内部上传步骤 pin 到 `actions/upload-artifact` 的 `v7.0.0` 对应 commit，后者使用 `node24`。

## 验证计划

本地验证：

- 运行 `git diff -- .github/workflows/deploy.yml`，确认 workflow diff 仅包含四处 `uses:` major 版本替换，权限、触发条件、Bun 步骤、build 命令和 artifact path 无变化。
- 运行 `bun ci`。
- 运行 `bun run docs:build`。
- 构建后搜索 `.vitepress/dist`，确认不包含 `actions-node24-design`、`superpowers`、`docs_superpowers`、`/docs/superpowers/`；命中视为失败。

远端验证：

- 推送后记录本次 commit SHA 触发的 main 分支 `Deploy to Pages` run id。
- 确认该 run conclusion 为 success。
- 查看该 run 的 annotations 或 summary，确认不再包含 Node.js 20 action deprecation warning。

## 风险与回滚

风险主要来自 action major 升级可能包含兼容性变化。该 workflow 使用的输入很少，主要是 checkout 默认行为、Pages 默认配置、artifact `path` 和 deploy 默认行为，因此风险较低。

如果远端 workflow 失败，先按失败 step 定位并优先只回滚对应 action major。若 `actions/upload-pages-artifact@v5` 或内部 artifact 上传失败，先仅回滚 `actions/upload-pages-artifact` 并保留其他升级。若部署成功但 Node.js 20 annotation 仍存在，先读取 annotation 指向的 action 或 step，判断是否为未改动 action、间接依赖 action 或 tag 未解析到 Node 24，再决定补充升级、局部回滚或记录为后续问题；不要直接全量回滚。

## 接受标准

- `.github/workflows/deploy.yml` 只更新目标 action 版本。
- 本地 `bun ci` 和 `bun run docs:build` 通过。
- 构建产物不包含内部规格文档泄漏特征。
- 本次推送 commit SHA 触发的 main 分支 `Deploy to Pages` workflow 通过。
- 该 workflow run 不再报告 Node.js 20 action deprecation annotation。
