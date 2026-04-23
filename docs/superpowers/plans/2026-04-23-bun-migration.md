# Bun 全量迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前 VitePress 仓库从 `pnpm` 完整切换到 Bun 1.3.12，清理默认 `pnpm` 痕迹，并在本地与 CI 路径上完成可归因的 Bun 验证。

**Architecture:** 迁移只动工具链入口，不改站点业务逻辑。核心做法是把 `package.json` 的脚本运行时、锁文件、安装期配置、CI 与贡献文档统一收口到 Bun；对 `update-campus` 只做运行时兼容和入口改造，不改采集/鉴权业务；对 `docs:build` 保持真实验证，但在失败时区分 Bun 兼容问题与仓库既有的构建期外部请求问题。

**Tech Stack:** Bun 1.3.12、VitePress 1.6.4、Vue 3.5.26、Prettier 3.5.3、GitHub Actions Pages。

---

## 工作区与约束

- 项目根目录：`C:\Users\34404\Documents\GitHub\fireworks-notes-society`
- 实施 worktree：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\.worktrees\bun-migration`
- 建议工作分支：`opencode/bun-migration`
- 设计文档：`C:\Users\34404\Documents\GitHub\fireworks-notes-society\docs\superpowers\specs\2026-04-23-bun-migration-design.md`
- 当前 Bun 版本基线：`1.3.12`（已通过 `bun --version` 确认）
- 当前主工作区存在无关脏改动：`.gitignore`、`.vitepress/theme/components/OList.vue`、`.vitepress/theme/components/OListItem.vue`；不要在实现过程中改动或回滚这些文件。
- 除非用户后续明确要求，否则不要创建 git commit。
- 执行前先用 `using-git-worktrees` 在项目内 `.worktrees/` 建立隔离工作区；该目录已经被 `.gitignore` 忽略。

## 文件结构

- 修改：`package.json`
  责任：把 `packageManager` 切到 `bun@1.3.12`，把默认脚本运行时显式切到 Bun，并把 `pnpm-workspace.yaml` 中的安装期语义迁移到 `trustedDependencies`。
- 删除：`pnpm-lock.yaml`
  责任：移除旧锁文件，避免仓库保留双锁文件基线。
- 删除：`pnpm-workspace.yaml`
  责任：在 `trustedDependencies` 落地后移除仅属于 pnpm 的安装期配置入口。
- 新建：`bun.lock`
  责任：作为 Bun 的唯一锁文件基线。
- 修改：`scripts/update-campus-url.mjs`
  责任：把文件头的使用方式改成 Bun 口径，保持脚本业务逻辑不变。
- 修改：`.github/workflows/deploy.yml`
  责任：用 `oven-sh/setup-bun@v2` + `bun ci` + `bun run docs:build` 替换现有 `corepack`/`pnpm` 路径。
- 修改：`README.md`
  责任：把技术栈、环境要求、快速开始与默认命令全部切到 Bun。
- 修改：`CONTRIBUTING.md`
  责任：把贡献流程与格式化命令切到 Bun。

## Task 1: 锁定 Bun 运行时入口与安装语义

**Files:**
- Modify: `package.json`
- Modify: `scripts/update-campus-url.mjs:1-13`

- [ ] **Step 1: 更新 `package.json`，把默认脚本和安装期语义切到 Bun**

把 `package.json` 调整为下面这个结构；不要改动依赖版本范围，只改脚本、`packageManager` 和 `trustedDependencies`：

```json
{
  "name": "fireworks-notes-society",
  "version": "1.0.0",
  "description": "薪火笔记社 - 用笔记改变一门课，期末考研竞赛科研社团都涉及的超好用 HIT 笔记网站",
  "main": "index.js",
  "scripts": {
    "docs:dev": "bun --bun vitepress dev",
    "docs:build": "bun --bun vitepress build",
    "docs:preview": "bun --bun vitepress preview",
    "update-campus": "bun scripts/update-campus-url.mjs",
    "format": "bun --bun prettier --write ."
  },
  "keywords": [
    "notes",
    "education",
    "hit",
    "vitepress",
    "documentation"
  ],
  "author": "HIT Fireworks <https://github.com/HIT-Fireworks>",
  "license": "MPL-2.0",
  "packageManager": "bun@1.3.12",
  "trustedDependencies": [
    "@tailwindcss/oxide",
    "esbuild"
  ],
  "devDependencies": {
    "markdown-it-mathjax3": "^4.3.2",
    "prettier": "3.5.3",
    "vitepress": "^1.6.4",
    "vitepress-sidebar": "^1.33.1",
    "vue": "^3.5.26"
  },
  "dependencies": {
    "@primeuix/themes": "^1.2.5",
    "@tailwindcss/vite": "^4.1.18",
    "primeicons": "^7.0.0",
    "primevue": "^4.5.4",
    "tailwindcss": "^4.1.18",
    "vitepress-mermaid-renderer": "^1.1.7"
  }
}
```

- [ ] **Step 2: 把 `update-campus` 脚本头部用法说明改成 Bun**

把 `scripts/update-campus-url.mjs` 顶部注释的用法说明改成下面这样，其他逻辑不动：

```js
/**
 * 校园网检测 URL 更新脚本
 *
 * 功能：
 * 1. 从 mytoday.hit.edu.cn/category/11 获取文章列表
 * 2. 提取文章中的图片，收集20张图片信息
 * 3. 计算每张图片的 MD5 和尺寸
 * 4. 使用 MD5(realMd5 + 尺寸) 作为密码更新 OpenList
 * 5. 保存图片验证数据到配置文件
 *
 * 使用方法：
 *   bun scripts/update-campus-url.mjs
 */
```

- [ ] **Step 3: 运行文本检查，确认默认入口不再落回 Node**

Run: `rg -n 'node scripts/update-campus-url.mjs|"packageManager": "pnpm|pnpm@' package.json scripts/update-campus-url.mjs`

Expected: 无匹配；如果仍有匹配，先修正文件再继续。

## Task 2: 生成 Bun 锁文件并移除 pnpm 专属基线

**Files:**
- Modify: `bun.lock`（由 `bun install` 生成）
- Delete: `pnpm-lock.yaml`
- Delete: `pnpm-workspace.yaml`

- [ ] **Step 1: 确认 worktree 处于干净依赖状态**

Run: `if (Test-Path "node_modules") { throw "Unexpected node_modules in fresh worktree" } else { "clean" }`

Expected: 输出 `clean`。如果 worktree 里意外已有 `node_modules`，先删除生成产物再继续，不要在污染状态下做 Bun 安装验证。

- [ ] **Step 2: 执行 Bun 安装，生成 `bun.lock`**

Run: `bun install`

Expected:
- 安装成功退出码为 0
- 根目录生成 `bun.lock`
- 安装过程中不再因为 `@tailwindcss/oxide` 或 `esbuild` 的生命周期脚本被阻止而失败

- [ ] **Step 3: 删除旧的 pnpm 锁文件与 workspace 配置**

使用 `apply_patch` 删除 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml` 两个文件。删除后仓库只保留 `bun.lock` 作为锁文件基线。

- [ ] **Step 4: 运行文件态检查，确认锁文件迁移完成**

Run: `@( 'bun.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml' ) | ForEach-Object { '{0}: {1}' -f $_, (Test-Path $_) }`

Expected:
- `bun.lock: True`
- `pnpm-lock.yaml: False`
- `pnpm-workspace.yaml: False`

## Task 3: 迁移 GitHub Actions 到 Bun

**Files:**
- Modify: `.github/workflows/deploy.yml:31-54`

- [ ] **Step 1: 把 `deploy.yml` 的构建步骤改成 Bun 版**

把 workflow 的构建段改成下面这个结构，保留现有的 checkout、pages 配置、artifact 上传与 deploy 步骤：

```yaml
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: bun ci

      - name: Build VitePress
        run: bun run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: "./.vitepress/dist"

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

注意点：`oven-sh/setup-bun@v2` 默认会读取 `package.json.packageManager`；因此不要再手写第二份 Bun 版本字面量。

- [ ] **Step 2: 运行文本检查，确认 workflow 不再依赖 pnpm/corepack**

Run: `rg -n 'corepack|pnpm' .github/workflows/deploy.yml`

Expected: 无匹配。

## Task 4: 迁移 README、贡献流程和脚本说明

**Files:**
- Modify: `README.md:43-75`
- Modify: `CONTRIBUTING.md:38-92`

- [ ] **Step 1: 更新 `README.md` 的技术栈和环境要求**

把 README 中与包管理、环境要求和快速开始相关的片段改成下面这样：

````md
## 🛠️ 技术栈

- **框架**：[VitePress](https://vitepress.dev/) - Vue 驱动的静态站点生成器
- **样式**：[Tailwind CSS](https://tailwindcss.com/) + [PrimeVue](https://primevue.org/)
- **部署**：GitHub Pages + GitHub Actions 自动化部署
- **包管理 / 运行时**：Bun

## 🚀 快速开始

### 环境要求

- Bun 1.3.12+

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/HIT-Fireworks/fireworks-notes-society.git
cd fireworks-notes-society

# 安装依赖
bun install

# 启动开发服务器
bun run docs:dev

# 构建生产版本
bun run docs:build

# 预览构建结果
bun run docs:preview
```
````

- [ ] **Step 2: 更新 `CONTRIBUTING.md` 的标准流程和格式化命令**

把贡献指南中的 `pnpm` 命令改成下面这样：

````md
```bash
# 1. Fork 本仓库

# 2. 克隆您 fork 的仓库
git clone https://github.com/YOUR_USERNAME/fireworks-notes-society.git
cd fireworks-notes-society

# 3. 创建并切换到新分支
git switch -c feature/your-feature-name

# 4. 安装依赖
bun install

# 5. 启动开发服务器
bun run docs:dev

# 6. 进行修改...

# 7. 提交更改
git add .
git commit -m "描述您的更改"

# 8. 推送到您的仓库
git push origin feature/your-feature-name

# 9. 在 GitHub 上创建 Pull Request
```
````

并把格式化命令改成：

````md
```bash
bun run format
```
````

- [ ] **Step 3: 运行默认入口文档扫描**

Run: `rg -n 'pnpm|corepack|node scripts/update-campus-url.mjs' README.md CONTRIBUTING.md package.json scripts/update-campus-url.mjs .github/workflows/deploy.yml`

Expected:
- 不再出现 `pnpm`
- 不再出现 `corepack`
- 不再出现 `node scripts/update-campus-url.mjs`

## Task 5: 执行 Bun 验证并完成归因

**Files:**
- Verify only: `package.json`
- Verify only: `.github/workflows/deploy.yml`
- Verify only: `.vitepress/theme/components/alist.data.mts`
- Verify only: `.vitepress/theme/components/alist.api.mts`
- Verify only: `scripts/update-campus-url.mjs`

- [ ] **Step 1: 运行站点构建验证**

Run: `bun run docs:build`

Expected:
- 首选结果：命令成功，生成 `.vitepress/dist`
- 若失败：先看错误栈是否指向 Bun 安装/运行时兼容问题，还是指向 `.vitepress/theme/components/alist.data.mts` / `.vitepress/theme/components/alist.api.mts` 触发的既有外部请求问题

判定规则：
- 如果是依赖解析、CLI 启动、Node API 兼容、锁文件不一致等问题，视为 Bun 迁移阻塞项，必须修复后重跑
- 如果是远端 `https://olist-eo.jwyihao.top` 或其他外部请求失败，记录为仓库既有基线风险，不要把无关业务重构拉进这次迁移

- [ ] **Step 2: 用交互式终端运行 `update-campus` 的 Bun smoke test**

在交互式 PTY 中运行：`bun run update-campus`

Expected:
- 命令必须是通过 Bun 直接执行，而不是经由 `node`
- 首选结果：脚本走到 `用户名:` 后输入任意占位值（例如 `smoke-test`），再走到 `密码:` 提示，此时用 `Ctrl+C` 中断；这样才能真正覆盖 `process.stdin.setRawMode` 路径
- 可接受降级结果：如果在到达 `密码:` 提示前因为上游站点不可用或网络限制失败，错误必须表现为外部依赖失败，而不是 `process.stdin.setRawMode`、模块加载或 Bun/Node 兼容报错

到达 `密码:` 提示后立即用 `Ctrl+C` 结束，避免真的修改远端 OpenList 配置。

- [ ] **Step 3: 运行最终状态检查**

Run 1: `git status --short`

Run 2: `rg -n 'pnpm|corepack|node scripts/update-campus-url.mjs' README.md CONTRIBUTING.md package.json scripts/update-campus-url.mjs .github/workflows/deploy.yml`

Expected:
- 只出现与 Bun 迁移直接相关的文件改动
- 默认入口文件中不再出现 `pnpm`、`corepack`、`node scripts/update-campus-url.mjs`

- [ ] **Step 4: 记录验证结论**

把结论整理成 3 类：
1. 已验证通过：`bun install`、`bun ci` 口径的 workflow、`bun run docs:build` 或其失败归因、`bun run update-campus` smoke test
2. 已清理完成：`pnpm-lock.yaml`、`pnpm-workspace.yaml`、默认文档中的 `pnpm`/`corepack`/`node` 入口
3. 非迁移范围但需要注明的风险：如果 `docs:build` 暴露了既有外部请求问题，把它单独记录为基线风险，而不是混入 Bun 兼容问题

## 计划自检清单

- 规格里的 7 条验收标准都能在上面找到对应任务：
  - Bun 锁文件唯一基线：Task 2
  - 默认脚本不再回落到 Node：Task 1 + Task 5
  - README/CONTRIBUTING/CI 切到 Bun：Task 3 + Task 4
  - 默认文档不再推荐 `pnpm`：Task 4 + Task 5
  - CI 使用冻结锁文件安装且版本来自 `packageManager`：Task 3
  - `update-campus` 完成 Bun 运行路径检查：Task 1 + Task 5
  - 关键 Bun 命令真实跑过并完成失败归因：Task 2 + Task 5
- 计划里没有 `TBD`、`TODO` 或“后续再补”的占位表述。
- 所有路径都使用了仓库里的真实文件，没有引入不存在的新模块或无关重构。

## 执行方式

用户已预先批准：计划通过审查后，直接使用 **Subagent-Driven** 方式执行。

执行要求：

1. 先用 `using-git-worktrees` 在项目内 `.worktrees/` 建立隔离 worktree。
2. 再用 `subagent-driven-development` 按任务拆分执行。
3. 每完成一个任务都做子代理复审；如果有 review 意见，执行审查-修改循环直到通过。
4. 完成全部实现后，再使用 `verification-before-completion` 做最终验证，之后再对用户汇报结果。
