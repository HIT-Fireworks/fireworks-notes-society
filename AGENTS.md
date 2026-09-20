# 仓库 Agent 工作约定

## Agent skills

### Issue tracker

本仓库使用 GitHub Issues 作为唯一 Issue tracker，使用 `gh` CLI 管理 Issue。外部 Pull Request 不作为 `/triage` 的需求入口；正常 PR 仍按代码评审流程处理。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用 `needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix` 五个标准标签。详见 `docs/agents/triage-labels.md`。

### Domain docs

本仓库采用单一上下文布局。探索代码前读取根目录 `CONTEXT.md`；相关架构决策存在时读取 `docs/adr/`。输出和实现使用 `CONTEXT.md` 中定义的领域术语。详见 `docs/agents/domain.md`。
