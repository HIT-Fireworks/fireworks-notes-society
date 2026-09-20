# Issue tracker：GitHub

本仓库的 Issue 和 PRD 使用 GitHub Issues 管理，所有 Issue 操作使用 `gh` CLI，并从当前仓库的 GitHub remote 推断仓库地址。

## 约定

- 创建 Issue：`gh issue create --title "..." --body "..."`。
- 读取 Issue：`gh issue view <number> --comments`，同时检查 labels 和评论。
- 列出 Issue：`gh issue list --state open --json number,title,body,labels,comments`。
- 评论 Issue：`gh issue comment <number> --body "..."`。
- 添加或移除标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- 关闭 Issue：`gh issue close <number> --comment "..."`。
- 发布 PRD 或其他可执行工作项时，创建 GitHub Issue。

## Pull Request 范围

外部 PR 不作为 `/triage` 的需求入口。协作者和外部贡献者的 PR 仍按正常 Pull Request 评审、检查和合并流程处理；`/triage` 只读取和处理 Issues。
