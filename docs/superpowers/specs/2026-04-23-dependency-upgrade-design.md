# 依赖升级设计

## 背景

当前仓库刚完成 Bun 工具链迁移，并修复了 `docs/` 目录被 VitePress 与 `vitepress-sidebar` 识别的问题。现阶段需要继续处理另一类维护工作：把项目依赖更新到更接近当前稳定状态，同时保证站点仍能正常构建，并且不把 `docs/` 重新收录进站点产物、侧边栏或搜索索引。

依赖版本是时间敏感信息。根据当前 `bun outdated` 结果，仓库存在两类可升级项；实施前必须重新执行 `bun outdated`，并以当次输出作为最终目标版本来源：

1. 常规更新：如 `vue`、`primevue`、`tailwindcss`、`@tailwindcss/vite`、`vitepress-mermaid-renderer`、`prettier`。
2. major 更新：如 `@primeuix/themes`、`markdown-it-mathjax3`。

这次用户明确允许包含 major 升级，也允许在升级过程中做必要的最小兼容适配。

## 目标

1. 把当前 `package.json` 中可升级依赖推进到最新可接受版本；若实施时 `bun outdated` 输出变化，以实施时输出为准。
2. 在升级过程中保留 Bun 作为唯一默认工具链入口，不引回 `pnpm`、`corepack`、`npm` fallback 或旧 Node 脚本入口。
3. 确保 `bun install`、`bun ci` 与 `bun run docs:build` 继续通过。
4. 确保 `docs/` 目录不会重新被 VitePress 或 `vitepress-sidebar` 收录进构建产物、侧边栏或搜索索引。
5. 若 major 升级导致兼容问题，只做与升级直接相关的最小修复，不顺手重构页面、主题体系或站点结构。

## 非目标

1. 不把 Bun 本身或 GitHub Actions 官方 action 的 Node 运行时版本一并纳入这轮升级。
2. 不主动升级 `vitepress`、`vitepress-sidebar`、`primeicons`，除非实施时 `bun outdated` 明确提示新版本，或 peer 兼容检查证明必须调整它们才能完成目标依赖升级；其中 `markdown-it-mathjax3` 的 peer 冲突默认优先按单项阻塞或单项回退处理，不自动扩大到 VitePress 升级。
3. 不借机重构主题组件、页面结构、Tailwind 架构或样式体系。
4. 不为了追求“全都最新版”而忽略 major 升级的真实兼容成本。
5. 不主动运行全仓格式化，不让 `prettier` 升级引入无关的大规模格式化 diff。

## 方案对比

### 方案 A：一次性把所有依赖直接升到最新

优点：命令最少，表面推进最快。

缺点：一旦出现构建或渲染回归，很难快速判断究竟是运行栈、主题、markdown 插件还是工具链依赖导致的问题。

### 方案 B：分两批升级并分别验证

优点：能把最可能影响站点运行的依赖与文档/工具链依赖拆开验证，回归定位更清晰，也更适合包含 major 升级的场景。

缺点：执行步骤比方案 A 多，需要在中间做两次安装、冻结安装和构建验证。

### 方案 C：只升非 major 依赖

优点：风险最低。

缺点：不符合用户已经明确给出的“包含 major，并允许连带适配”要求。

## 选定方案

采用方案 B。

原因：当前依赖更新同时包含常规更新和两个 major 更新，最容易出问题的是主题栈与 markdown 数学渲染栈。把它们分两批推进，可以在不降低升级力度的前提下，把定位成本控制在可接受范围内。

## 详细设计

### 1. 升级范围划分

第一批：站点运行栈

1. `vue`：`3.5.26 -> 3.5.33`
2. `primevue`：`4.5.4 -> 4.5.5`
3. `@primeuix/themes`：`1.2.5 -> 2.0.3`
4. `tailwindcss`：`4.1.18 -> 4.2.4`
5. `@tailwindcss/vite`：`4.1.18 -> 4.2.4`

第二批：文档/工具链栈

1. `vitepress-mermaid-renderer`：`1.1.7 -> 1.1.22`
2. `markdown-it-mathjax3`：`4.3.2 -> 5.2.0`，但必须先通过 peer 兼容检查
3. `prettier`：`3.5.3 -> 3.8.3`

本轮默认不动：

1. `vitepress`
2. `vitepress-sidebar`
3. `primeicons`
4. `bun`

实施前必须重新执行 `bun outdated`。若某个版本与本节列出的目标不同，计划和实现应以最新 `bun outdated` 输出为准，并在验证结果中记录差异原因。

### 2. 当前仓库接法与风险点

当前仓库的关键接法如下，实施计划必须基于这些事实落地，而不是泛化处理：

1. Tailwind 通过 `.vitepress/config.mts` 中的 `@tailwindcss/vite` 插件接入，并在 `.vitepress/theme/style.css` 中使用 `@import "tailwindcss"`。升级时不得引入旧式 Tailwind config 或重写 CSS 架构。
2. PrimeVue theme 通过 `.vitepress/theme/index.ts` 接入，具体包括 `@primeuix/themes/aura`、`definePreset`、`@primeuix/themes/aura/base`、`PrimeVue` 的 `theme.preset` 与 `options.darkModeSelector`。升级 `@primeuix/themes` major 时必须检查这些 import path、preset API 和 PrimeVue config 形态。
3. VitePress 数学公式目前通过 `.vitepress/config.mts` 的 `markdown.math: true` 启用，并由 VitePress 内部动态使用 `markdown-it-mathjax3`，仓库没有显式手写 markdown-it 插件调用。
4. 当前 `vitepress@1.6.4` 声明 `markdown-it-mathjax3` peer 范围为 `^4`。因此把 `markdown-it-mathjax3` 升到 `5.2.0` 前必须先确认 peer 约束是否仍阻塞；若阻塞且不升级 VitePress，则该依赖应作为单项阻塞或单项回退处理，而不是强行破坏 peer 约束。
5. Mermaid 渲染通过 `.vitepress/theme/GLayout.vue` 的 `createMermaidRenderer()` 初始化；当前仓库没有已知真实 Mermaid markdown 页面样例。
6. 当前仓库没有已知会被 VitePress 构建的数学公式页面样例；`CONTRIBUTING.md` 中的公式/贡献说明示例不属于站点 source。
7. 当前 VitePress 构建链路包含外部请求：`.vitepress/theme/components/alist.data.mts` 会调用 `.vitepress/theme/components/alist.api.mts` 访问 OpenList 服务。构建失败时必须区分外部服务问题和依赖升级问题。

### 3. 执行顺序

执行顺序固定为：

1. 执行 `git status --short`，确认当前工作区状态，并隔离与本轮依赖升级无关的改动。
2. 重新执行 `bun outdated`，记录实施时的可升级版本。
3. 记录当前 `package.json` 与 `bun.lock` 基线。
4. 升级第一批运行栈依赖。
5. 执行 `bun install`、`bun ci` 与 `bun run docs:build`。
6. 若出现构建、样式或组件回归，只修与升级直接相关的最小兼容点。
7. 升级第二批文档/工具链依赖。
8. 再次执行 `bun install`、`bun ci` 与 `bun run docs:build`。
9. 若出现数学公式、markdown 或 mermaid 相关回归，只修对应最小兼容点。
10. 做一轮最终全量验证，并确认 `docs/` 屏蔽规则未回归。

### 4. 兼容适配边界

当 major 升级引发问题时，允许修复，但修复边界限定为：

1. 与依赖 API 变更直接相关的配置或调用方式。
2. 与主题或渲染器升级直接相关的最小模板/样式适配。
3. 与构建链路升级直接相关的最小配置调整。

不纳入这轮升级的内容：

1. 页面结构重做。
2. 设计风格重做。
3. 与依赖升级无关的历史代码整理。
4. 借题发挥式重构。

major 升级决策规则：

1. 如果问题可通过局部配置、import path、API 调用方式或小范围模板适配修复，则做最小适配并保留该依赖升级。
2. 如果问题需要页面结构重做、主题体系重构、样式架构重构、升级未纳入范围的大型依赖，或破坏当前 VitePress/Bun 基线，则回退该单个依赖并记录原因。
3. 如果问题来自 peer 约束，例如 `markdown-it-mathjax3@5.x` 与当前 `vitepress@1.6.4` 的 `^4` peer 范围冲突，优先记录单项阻塞或回退该依赖；不要为单个插件升级强行扩大到 VitePress 主版本升级，除非后续计划明确批准。
4. 如果无法定位具体依赖，停止进入下一批升级，记录失败命令、错误摘要、涉及依赖和已尝试的最小定位步骤。
5. 单依赖回退必须记录回退版本、失败证据和后续可重试条件。

### 5. `docs/` 屏蔽约束

由于当前仓库已经出现过 `docs/` 被 VitePress 与 `vitepress-sidebar` 识别的问题，这轮升级必须把该约束视为回归保护项。

要求：

1. `.vitepress/config.mts` 中当前对 `docs` / `docs/**` 的屏蔽规则必须保留。
2. 任何依赖升级后都必须再次验证：
   - `.vitepress/dist/docs/**` 不会生成
   - 产物中不会再出现 `docs_superpowers` 或 `/docs/superpowers/`
   - 产物中不会出现 `superpowers`、`dependency-upgrade-design`、`bun-migration` 这类内部文档泄漏特征
3. 若升级导致旧问题回归，优先把它视为阻塞项修复，而不是带病继续升级。

### 6. Prettier 与格式化边界

`prettier` 本轮可以升级，但不得把工具升级变成全仓格式化变更。

要求：

1. 本轮不主动运行 `bun run format` 或 `prettier --write .`。
2. 若兼容适配实际改了某个文件，只允许对该文件做必要的定向格式化。
3. `prettier` 升级本身应主要体现为 `package.json` 与 `bun.lock` 变化；不应引入大量与依赖升级无关的格式化 diff。

### 7. 风险处理

高风险依赖：

1. `@primeuix/themes` major 升级：最可能影响主题变量、import path、preset API、组件样式与现有 PrimeVue theme config。
2. `markdown-it-mathjax3` major 升级：最可能受到当前 VitePress peer 范围影响，并可能影响数学公式渲染链路。

处理原则：

1. 若某个依赖的最新版本与当前代码模式明显不兼容，优先单独定位并决定是补适配还是回退该单个依赖。
2. 不把所有升级一起回退，除非证据表明问题无法被拆分。
3. 每批升级都要在进入下一批前完成安装、冻结安装和构建验证，避免错误叠加后失去定位能力。

失败归因规则：

1. `bun install` 或 `bun ci` 失败：先定位是 peer 约束、锁文件不一致、生命周期脚本、registry/network，还是具体依赖版本问题。若是单依赖版本问题，优先回退该依赖或记录单项阻塞。
2. `bun run docs:build` 失败：先看错误栈属于依赖 API/配置变化、VitePress 构建链路、主题/样式、markdown/mermaid 插件，还是既有构建期外部请求。
3. 构建期外部请求失败：若失败来自 OpenList 服务不可用，应记录为既有外部依赖风险，不直接归因于依赖升级。
4. 样式或渲染异常：必须通过代表性页面或产物检查定位到主题、Tailwind、markdown、mermaid、搜索或侧边栏链路后，再决定最小适配或单依赖回退。
5. `docs/` 屏蔽回归：无论发生在哪一批，均阻塞进入下一批或最终完成。

## 验证计划

至少完成以下验证：

1. 实施前执行 `git status --short` 与 `bun outdated`，记录基线。
2. 第一批升级后执行 `bun install`。
3. 第一批升级后执行 `bun ci`。
4. 第一批升级后执行 `bun run docs:build`。
5. 第一批升级后抽查代表性站点产物或页面，至少覆盖首页、课程/侧边栏页面、使用 PrimeVue/Tailwind 样式的页面。
6. 第一批升级后检查 `.vitepress/dist/docs/**` 不存在，并搜索 `.vitepress/dist` 的内部文档泄漏关键词，避免带着 `docs/` 屏蔽回归进入第二批。
7. 第二批升级前检查 `markdown-it-mathjax3` 与当前 VitePress peer 约束；若无法安全升级到 5.x，记录单项阻塞或回退该依赖。
8. 第二批升级后再次执行 `bun install`。
9. 第二批升级后再次执行 `bun ci`。
10. 第二批升级后再次执行 `bun run docs:build`。
11. 第二批升级后验证 markdown 数学公式与 Mermaid 链路。若仓库没有真实页面样例，必须新增临时未提交 smoke fixture 或明确记录覆盖缺口；临时 fixture 不得进入最终提交。
12. 最终执行 `git status --short`，确认没有临时 smoke fixture 或无关文件遗留。
13. 最终扫描默认入口，确认未引回 `pnpm`、`corepack`、`npm` fallback 或 `node scripts/update-campus-url.mjs`。
14. 最终确认 `packageManager` 仍为 Bun，脚本仍使用 Bun，GitHub Actions 仍使用 `oven-sh/setup-bun@v2`、`bun ci` 和 `bun run docs:build`。
15. 最终确认仅存在 `bun.lock`，不存在 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`package-lock.json`、`yarn.lock`。
16. 最终检查 `.vitepress/dist/docs/**` 不存在。
17. 最终搜索 `.vitepress/dist`，确认 `docs_superpowers`、`/docs/superpowers/`、`superpowers`、`dependency-upgrade-design`、`bun-migration` 不再出现。
18. 若推送到远端，观察 GitHub Actions 结果；若未推送，最终报告必须明确 CI 尚未运行。

## 验收标准

1. 本轮计划内依赖均升级到实施时 `bun outdated` 给出的目标版本，或对无法升级的单个依赖给出明确阻塞说明。
2. `bun install` 与 `bun ci` 成功，锁文件同步更新且冻结安装路径可用。
3. `bun run docs:build` 成功。
4. 默认入口继续保持 Bun，不引回 `pnpm`、`corepack`、`npm` fallback 或旧 Node 脚本入口。
5. 仅保留 `bun.lock` 作为锁文件，不重新引入 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`package-lock.json`、`yarn.lock`。
6. `docs/` 目录不会重新被 VitePress / `vitepress-sidebar` 收进产物、侧边栏或搜索索引。
7. 若出现 major 升级兼容问题，修复范围仅限于最小必要适配，没有额外设计改版。
8. `prettier` 升级不产生全仓格式化噪音。

## 预期结果

升级完成后，仓库会处于一个更接近当前稳定版本的依赖状态，同时继续保持 Bun 工具链、正常的 VitePress 构建，以及对 `docs/` 内部文档的可靠隔离。
