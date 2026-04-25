# GitHub Actions Node 24 兼容升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 GitHub Pages 部署 workflow 中触发 Node.js 20 deprecation annotation 的 GitHub-owned actions 升级到官方 Node 24 兼容 major。

**Architecture:** 采用最小 YAML 版本替换方案，只修改 `.github/workflows/deploy.yml` 的四处 `uses:` action major。Bun 安装、依赖安装、VitePress 构建、Pages 权限、触发条件、并发策略、artifact path 和部署环境保持不变。规格文档和本计划文档随实现一起保留在仓库内，依赖既有 VitePress `docs/**` 屏蔽配置防止内部文档发布。

**Tech Stack:** GitHub Actions、GitHub Pages、Bun、VitePress、PowerShell、GitHub CLI。

---

## 工作区

本计划在项目内 worktree 执行：

- Worktree: `C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\actions-node24`
- Branch: `opencode/actions-node24`
- Base: `main` 当前提交 `78cd37a`

主工作区 `C:\Users\34404\Documents\GitHub\fireworks-notes-society` 不直接修改实现文件。

## 文件结构

- Modify: `.github/workflows/deploy.yml`
  - 只负责 GitHub Pages 部署流程。
  - 本次只改四处 GitHub-owned action major：checkout、configure-pages、upload-pages-artifact、deploy-pages。
- Create: `docs/superpowers/specs/2026-04-25-actions-node24-design.md`
  - 已审查通过的设计规格，记录目标、非目标、方案、验证和回滚规则。
- Create: `docs/superpowers/plans/2026-04-25-actions-node24.md`
  - 本实现计划，记录任务分解、命令和验收证据。

---

### Task 1: 更新 Pages Workflow Action Versions

**Files:**
- Modify: `.github/workflows/deploy.yml:32-55`
- Reference: `docs/superpowers/specs/2026-04-25-actions-node24-design.md`

- [ ] **Step 1: 确认 worktree 状态**

Run from `C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\actions-node24`:

```powershell
rtk git status --short --branch
```

Expected:

```text
## opencode/actions-node24
?? docs/superpowers/plans/2026-04-25-actions-node24.md
?? docs/superpowers/specs/2026-04-25-actions-node24-design.md
```

Only the two superpowers docs should be untracked before editing the workflow.

- [ ] **Step 2: 更新四处 action major**

Edit `.github/workflows/deploy.yml` so the relevant steps become exactly:

```yaml
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Pages
        uses: actions/configure-pages@v6

      - name: Install dependencies
        run: bun ci

      - name: Build VitePress
        run: bun run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v5
        with:
          # Upload entire repository
          path: "./.vitepress/dist"

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

Do not change any other workflow lines.

- [ ] **Step 3: 检查 workflow diff 范围**

Run:

```powershell
rtk git diff -- .github/workflows/deploy.yml
```

Expected diff must contain only these four replacements:

```diff
-        uses: actions/checkout@v4
+        uses: actions/checkout@v6
-        uses: actions/configure-pages@v5
+        uses: actions/configure-pages@v6
-        uses: actions/upload-pages-artifact@v3
+        uses: actions/upload-pages-artifact@v5
-        uses: actions/deploy-pages@v4
+        uses: actions/deploy-pages@v5
```

If permissions, triggers, Bun steps, build command, artifact path, concurrency, environment, or comments changed, revert those unrelated edits before continuing.

---

### Task 2: 本地验证

**Files:**
- Verify: `.github/workflows/deploy.yml`
- Verify: `.vitepress/dist/**`

- [ ] **Step 1: 安装依赖一致性检查**

Run from the actions-node24 worktree:

```powershell
bun ci
```

Expected:

```text
Checked ... installs across ... packages (no changes)
```

Any dependency change is unexpected. If `bun.lock` or `package.json` changes, stop and inspect before continuing.

- [ ] **Step 2: 构建 VitePress**

Run:

```powershell
bun run docs:build
```

Expected:

```text
build complete
```

The existing Rollup chunk-size warning is acceptable. Any build error is blocking.

- [ ] **Step 3: 扫描内部 docs 泄漏**

Run:

```powershell
if (-not (Test-Path '.vitepress/dist')) { throw 'Missing .vitepress/dist; run bun run docs:build first' }
$matches = Get-ChildItem -Path '.vitepress/dist' -Recurse -File | Select-String -Pattern 'actions-node24-design|superpowers|docs_superpowers|/docs/superpowers/' -ErrorAction Stop
if ($matches) { $matches | Select-Object -First 50 | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line)" }; exit 1 } else { 'NO_DOCS_MATCHES' }
```

Expected:

```text
NO_DOCS_MATCHES
```

Any match means an internal design or plan document may have leaked into the built site and must be fixed before committing.

- [ ] **Step 4: 检查最终本地 diff**

Run:

```powershell
rtk git status --short --branch
rtk git diff --stat
rtk git diff -- .github/workflows/deploy.yml
```

Expected:

```text
## opencode/actions-node24
 M .github/workflows/deploy.yml
?? docs/superpowers/plans/2026-04-25-actions-node24.md
?? docs/superpowers/specs/2026-04-25-actions-node24-design.md
```

The workflow diff must still show only the four `uses:` major replacements from Task 1.

---

### Task 3: 提交、合并与远端验证

**Files:**
- Commit: `.github/workflows/deploy.yml`
- Commit: `docs/superpowers/specs/2026-04-25-actions-node24-design.md`
- Commit: `docs/superpowers/plans/2026-04-25-actions-node24.md`

- [ ] **Step 1: 提交 worktree 分支变更**

Run from the actions-node24 worktree:

```powershell
rtk git add .github/workflows/deploy.yml docs/superpowers/specs/2026-04-25-actions-node24-design.md docs/superpowers/plans/2026-04-25-actions-node24.md
rtk git commit -m "ci(actions): 升级 Pages workflow 到 Node 24"
rtk git status --short --branch
```

Expected:

```text
## opencode/actions-node24
```

If a hook modifies files, inspect the diff and create a new commit after fixing; do not amend unless the commit succeeded and the hook only auto-modified files from this same commit.

- [ ] **Step 2: 合并到 main**

Run from the main worktree `C:\Users\34404\Documents\GitHub\fireworks-notes-society`:

```powershell
rtk git status --short --branch
```

Expected:

```text
## main...origin/main
```

If output contains any modified, staged, untracked, ahead, or behind state, stop and report before pulling, merging, or pushing. Do not overwrite, move, or delete user changes.

After confirming main is clean, run:

```powershell
rtk git pull --ff-only
rtk git status --short --branch
```

Expected:

```text
## main...origin/main
```

If `git pull --ff-only` fails or status is not clean afterward, stop immediately; do not push and do not use non-fast-forward merge.

Then run:

```powershell
rtk git merge --ff-only opencode/actions-node24
rtk git status --short --branch
```

Expected after merge:

```text
## main...origin/main [ahead 1]
```

If main has unrelated user changes, do not overwrite them. Stop and report the conflict.

If `git merge --ff-only` fails, stop immediately. Do not fall back to a normal merge, reset, force, or conflict resolution on main without a reviewed plan update.

- [ ] **Step 3: 推送 main 并记录 commit SHA**

Run from the main worktree:

```powershell
$commit = (rtk git rev-parse HEAD | Where-Object { $_ -match '^[0-9a-f]{40}$' } | Select-Object -Last 1)
if (-not $commit) { throw 'Could not capture commit SHA' }
rtk git push origin main
rtk git status --short --branch
$commit
```

Expected: push succeeds and prints the commit SHA that triggered the workflow.
Status after push should be `## main...origin/main`.

- [ ] **Step 4: 找到本次 commit SHA 对应的 Pages run**

Run from the main worktree:

```powershell
$runJson = (rtk gh run list --branch main --event push --workflow "Deploy to Pages" --commit $commit --limit 1 --json databaseId,headSha,workflowName,event,headBranch,status,conclusion,url | Where-Object { $_ -notmatch '^\[rtk\]' }) -join "`n"
$runs = @($runJson | ConvertFrom-Json)
if ($runs.Count -ne 1 -or $runs[0].headSha -ne $commit -or $runs[0].event -ne 'push' -or $runs[0].workflowName -ne 'Deploy to Pages' -or $runs[0].headBranch -ne 'main') { $runs | ConvertTo-Json -Depth 5; exit 1 }
$runId = $runs[0].databaseId
$runId
```

Expected: one numeric run id is printed. It must belong to the pushed commit SHA, event `push`, branch `main`, and workflow `Deploy to Pages`.

- [ ] **Step 5: 等待远端 workflow 完成**

Run:

```powershell
rtk gh run watch $runId --exit-status
```

Expected:

```text
✓ main Deploy to Pages · 123456789
```

The numeric value in the success line should match `$runId` from Step 4.

The `deploy` job must complete successfully.

- [ ] **Step 6: 检查 annotation**

Run:

```powershell
$viewJson = (rtk gh run view $runId --json conclusion,databaseId,headSha,workflowName,url,jobs | Where-Object { $_ -notmatch '^\[rtk\]' }) -join "`n"
$view = $viewJson | ConvertFrom-Json
if ($view.conclusion -ne 'success' -or $view.headSha -ne $commit -or $view.workflowName -ne 'Deploy to Pages') { $view | ConvertTo-Json -Depth 5; exit 1 }
$annotationText = foreach ($job in @($view.jobs)) { rtk gh api "repos/{owner}/{repo}/check-runs/$($job.databaseId)/annotations" }
$annotationText = $annotationText -join "`n"
if ($annotationText -match 'Node\.js 20 actions are deprecated|actions/checkout@v4|actions/configure-pages@v5|actions/deploy-pages@v4|actions/upload-pages-artifact@v3|actions/upload-artifact@v4') { $annotationText; exit 1 } else { 'NO_NODE20_ANNOTATIONS' }
$view | Select-Object conclusion,databaseId,headSha,workflowName,url | ConvertTo-Json -Compress
```

Expected:

```text
NO_NODE20_ANNOTATIONS
"conclusion":"success"
```

The annotations must not mention `Node.js 20 actions are deprecated`, `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/deploy-pages@v4`, `actions/upload-pages-artifact@v3`, or `actions/upload-artifact@v4`.

- [ ] **Step 7: 清理 feature worktree 和分支**

Run from the main worktree only after remote verification passes:

```powershell
rtk git worktree remove .worktrees/actions-node24
rtk git branch -d opencode/actions-node24
rtk git status --short --branch
```

Expected:

```text
## main...origin/main
```

Do not remove unrelated worktrees such as `.worktrees/openlist-github-mtime`.

---

## 回滚规则

If remote workflow fails, inspect the failed step first:

- Checkout failure: consider reverting only `actions/checkout@v6` to `@v4`.
- Setup Pages failure: consider reverting only `actions/configure-pages@v6` to `@v5`.
- Upload artifact failure: consider reverting only `actions/upload-pages-artifact@v5` to `@v3` first.
- Deploy failure: consider reverting only `actions/deploy-pages@v5` to `@v4`.
- Workflow succeeds but Node 20 annotation remains: inspect the annotation action/step and decide whether it points to an unchanged action, an indirect dependency, or a tag resolution issue before reverting.

Avoid full rollback unless multiple upgraded actions fail or the failure cannot be isolated.

Remote-failure rollback must be done by editing `.github/workflows/deploy.yml`, rerunning Task 2 local verification, creating a new repair commit, and pushing normally. Do not use `git reset --hard`, `git push --force`, or any command that rewrites `main` history.
