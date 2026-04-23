# Bun 全量迁移设计

## 背景

当前仓库是单包的 VitePress 站点，默认开发与部署路径都建立在 `pnpm` 之上：

1. `package.json` 里的 `packageManager` 固定为 `pnpm`。
2. `README.md` 与 `CONTRIBUTING.md` 的安装、开发、构建说明全部使用 `pnpm`。
3. `.github/workflows/deploy.yml` 在 CI 中通过 `corepack` 启用 `pnpm` 并执行构建。
4. 仓库根目录保留了 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`。

本次目标不是“顺便支持 Bun”，而是把 Bun 设为这个仓库唯一官方支持的包管理与运行时入口，并清理默认 `pnpm` 痕迹。

## 目标

1. 把仓库默认安装、开发、构建、预览与脚本执行路径全部切换到 Bun。
2. 让仓库元数据、文档、CI 与锁文件保持一致，不再出现“配置说 Bun、文档却写 pnpm”的分裂状态。
3. 清理只为 `pnpm` 服务、且对当前仓库没有实际价值的默认文件或说明。
4. 在当前环境里实际验证 `bun install`、`bun run docs:build`，并对关键脚本完成可归因的 Bun 运行时检查。
5. 将业务逻辑改动压缩到 Bun 兼容所必需的最小范围，不顺手重构站点功能。

## 非目标

1. 不借机升级 VitePress、Vue、PrimeVue 或其他依赖的大版本。
2. 不重写现有站点结构、组件逻辑或部署目标。
3. 不保留 `pnpm` 作为官方兼容选项。
4. 不为极少数旧环境额外增加“Node + pnpm”旁路文档。

## 方案对比

### 方案 A：最小全量迁移

做法：把锁文件、`packageManager`、文档、CI 切到 Bun；脚本命名与项目结构尽量保持不变，只做必要兼容修正。

优点：改动集中、风险最低，最适合当前这个单包静态站点。

缺点：虽然已经完成全量迁移，但仓库约定层面的“Bun 风格”变化相对克制。

### 方案 B：激进但聚焦的 Bun 迁移

做法：在方案 A 基础上，进一步清理仓库中的默认 `pnpm` 痕迹，并检查脚本与命令入口是否需要改成更明确的 Bun 方式；但仍不触碰业务功能。

优点：迁移完成后仓库的一致性更强，更符合“Bun 唯一、严格清理痕迹”的目标。

缺点：比方案 A 多一些配置与文档层面的改动，需要更仔细地确认不会误删仍有作用的文件。

### 方案 C：保守过渡

做法：新增 Bun 支持，但保留 `pnpm` 锁文件、说明或 CI 兼容路径。

优点：短期风险最低。

缺点：与本次“完全迁移、Bun 唯一”的目标相冲突，仓库会长期保留双栈成本。

## 选定方案

采用方案 B。

选择原因：当前仓库规模较小、依赖面清晰、CI 只有一条构建路径，适合一次性把默认工具链从 `pnpm` 收拢到 Bun。相比方案 A，方案 B 更符合“严格清理痕迹”的验收目标；相比方案 C，又不会把仓库带回长期双栈维护状态。

## 详细设计

### 1. 包管理与仓库元数据

1. `package.json` 的 `packageManager` 改为 Bun，并作为仓库唯一官方包管理声明。
2. 现有 `scripts` 名称尽量保持稳定，例如继续使用 `docs:dev`、`docs:build`、`docs:preview`、`update-campus`、`format`，避免无意义改名影响使用者记忆。
3. 虽然脚本名保持稳定，但脚本命令本体必须显式落到 Bun 运行时，不能再依赖 `node ...` 或 Node shebang 间接启动。目标口径是：
   1. `docs:dev`、`docs:build`、`docs:preview`、`format` 这类通过 CLI 执行的命令，要么显式使用 `bun --bun ...`，要么采用等效且可验证的仓库级 Bun 配置，使默认脚本不会悄悄落回 Node。
   2. `update-campus` 必须从当前的 `node scripts/update-campus-url.mjs` 改成 Bun 直接执行入口。
4. 依赖安装结果以 Bun 锁文件为准，提交 `bun.lock`。
5. 删除 `pnpm-lock.yaml`。
6. `pnpm-workspace.yaml` 不能被简单视为“纯 pnpm 痕迹”。当前文件承载的是 `onlyBuiltDependencies`，涉及 `@tailwindcss/oxide` 与 `esbuild` 的安装期行为。实施时需要先验证 Bun 是否已天然覆盖这部分需求；若没有，就把等价语义迁移到 Bun 侧配置（例如 `trustedDependencies`）后再删除；若确认不再需要，也要在实现说明中记录核实依据。

这一层的原则是“入口统一，命令稳定”：用户切换的是工具链，不是项目命名习惯。

### 2. 文档与贡献流程

以下文档统一改成 Bun 口径：

1. `README.md`
2. `CONTRIBUTING.md`
3. 如有其他默认开发文档引用 `pnpm`，同步清理。

文档更新要求：

1. 环境要求改为 Bun，而不是 `Node.js 18+` + `pnpm 10+` 的组合说明。
2. 默认安装命令改为 `bun install`。
3. 默认开发、构建、预览、格式化命令改为 `bun run docs:dev`、`bun run docs:build`、`bun run docs:preview`、`bun run format`。
4. 贡献流程中的示例命令同步更新，避免新贡献者按照旧的 `pnpm` 流程操作。
5. `update-campus` 相关说明与 `scripts/update-campus-url.mjs` 文件头中的使用示例，也要从 `node ...` 切换到 Bun 口径。
6. 如果仍需提到 Node，只在解释脚本 API 背景时出现，不再作为用户必须预装的默认前提。

### 3. CI 与部署流程

`.github/workflows/deploy.yml` 的构建路径改为 Bun：

1. 去掉当前的 `corepack` / `pnpm` 安装步骤。
2. 使用 Bun 官方推荐的 GitHub Action 安装 Bun。
3. CI 中执行冻结锁文件的安装命令，优先使用 `bun ci`，以便在锁文件漂移时立即失败。
4. 使用 `bun run docs:build` 产出 `.vitepress/dist` 后继续沿用现有 Pages 上传与部署步骤。
5. Bun 版本的单一事实来源定为 `package.json` 中的 `packageManager`；CI 必须与它保持一致，避免本地与远端构建环境漂移。

部署目标仍然是 GitHub Pages，本次不修改发布平台，也不调整构建产物目录。

### 4. 脚本兼容与代码改动边界

仓库里与运行时最相关的自定义脚本是 `scripts/update-campus-url.mjs`。该脚本使用了：

1. `crypto`
2. `fs`
3. `readline`
4. `http` / `https`
5. `process.stdin.setRawMode`

这些 API 在 Bun 下理论上大多兼容，但实现时必须以实际运行结果为准。

兼容策略：

1. 先把 `update-campus` 的包脚本入口和脚本文件头用法说明改成 Bun 直接执行。
2. 再用 Bun 实际执行该脚本，确认不会在模块加载、Node API 兼容或最初阶段直接崩溃。
3. 对这个脚本的 smoke test 采用两级口径：
   1. 基础启动检查：脚本在 Bun 下能够完成模块加载并开始进入主流程，而不是因为运行时不兼容立即失败。
   2. 交互路径检查：在具备 TTY 和外部网络条件时，脚本应能走到首个凭据输入提示；如果在此之前因为上游站点不可用或环境限制失败，需要明确归因为外部依赖问题，而不是 Bun 不兼容。
4. 如果脚本在 Bun 下因 Node 兼容细节报错，仅修正触发报错的最小必要实现。
5. 不借这次迁移改写采集逻辑、密码计算逻辑或外部接口协议。

### 5. 执行顺序

实施顺序固定为：

1. 安装或确认 Bun 环境可用。
2. 以干净依赖状态开始验证，避免现有 `node_modules` 中的 pnpm 安装产物干扰 Bun 迁移判断。
3. 生成 Bun 锁文件，确认依赖可解析。
4. 修改 `package.json` 和仓库级元数据文件。
5. 修改 CI 工作流。
6. 修改文档与贡献说明。
7. 实际运行 Bun 命令做验证。
8. 根据验证结果做必要的兼容修正与收尾清理。

这样可以优先暴露依赖解析和脚本兼容问题，避免先改完文档后才发现 Bun 路径根本跑不通。

## 失败策略与风险处理

1. 如果 Bun 解析依赖时和当前锁定结果存在差异，以“Bun 下可稳定安装与构建”为准，不主动扩大升级范围；只在必要时微调版本声明。
2. 如果 `pnpm-workspace.yaml` 中的安装期语义在 Bun 侧仍然需要，就先迁移等价配置，再删除该文件；如果确认不需要，也要把删除依据写进实现说明，避免“删掉了但没人知道为什么”。
3. 如果 `update-campus-url.mjs` 在 Bun 下出现交互式终端兼容问题，只做兼容修补，不改业务流程。
4. 如果 GitHub Actions 中 Bun 的装配方式与本地运行方式存在差异，优先保证二者共享 `package.json.packageManager` 这一单一版本声明。
5. `bun run docs:build` 需要先做失败归因：如果失败源自 Bun 新引入的安装或运行时兼容问题，这属于本次必须修复的阻塞项；如果失败源自仓库既有的构建期外部请求或上游服务不可用，则应记录为基线风险，暂停扩大迁移范围，不把无关的业务改造吸入本次任务。
6. 若验证发现 Bun 路径无法满足最基本的安装或构建要求，则停止继续清理动作，先修复阻塞问题，再完成迁移。

## 验证计划

本次迁移至少完成以下验证：

1. 在干净依赖状态下执行 `bun install`，并生成/更新 `bun.lock`。
2. 核对文件状态：`bun.lock` 已纳入仓库基线，`pnpm-lock.yaml` 已删除，`pnpm-workspace.yaml` 已删除或具备明确的保留/迁移说明。
3. 执行 `bun run docs:build`。
4. 若构建失败，先判断失败是否来自 Bun 迁移本身，还是来自仓库既有的构建期外部请求依赖；只有前者属于本次必须修复的兼容问题。
5. 执行 `bun run update-campus`，并确认它确实通过 Bun 直接运行，而不是经由 `node` 间接执行。
6. 在具备 TTY 和网络条件时，`update-campus` 应至少走到首个凭据输入提示；若上游站点或环境限制导致更早失败，需要记录清楚归因。
7. 仓库默认开发文档中不再出现 `pnpm` 指令。
8. CI 配置不再依赖 `corepack` 或 `pnpm`，并使用冻结锁文件安装。

如果某项验证失败，优先修复与 Bun 迁移直接相关的问题，再重新执行该项验证。

## 验收标准

1. 仓库默认包管理器与锁文件从 `pnpm` 完整切到 Bun，`bun.lock` 成为唯一锁文件基线。
2. `package.json` 中的默认脚本入口不再落回 `node` 或 Node shebang 运行时；至少 `update-campus` 必须改为 Bun 直接执行，CLI 类脚本也必须有可验证的 Bun 运行时保证。
3. `README.md`、`CONTRIBUTING.md`、CI 等默认入口全部以 Bun 为准。
4. 默认文档里不再把 `pnpm` 作为推荐或等价用法，但历史规格/计划文档不属于本次默认入口清理范围。
5. CI 使用冻结锁文件安装，并与 `package.json.packageManager` 保持同一 Bun 版本来源。
6. 对 `scripts/update-campus-url.mjs` 的 Bun 运行路径完成实际检查，并在必要时做最小兼容修正。
7. 当前环境里实际跑通关键 Bun 命令，能够证明迁移不是只停留在静态改字面配置；若构建失败，也必须完成失败归因，证明问题是否属于 Bun 迁移本身。

## 预期结果

迁移完成后，这个仓库会从一个“默认依赖 `pnpm` 的 VitePress 站点”变成“默认依赖 Bun 的 VitePress 站点”：本地开发、文档说明、CI 构建和锁文件状态彼此一致，新贡献者进入仓库时不会再遇到包管理器口径冲突。
