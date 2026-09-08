# 薪火笔记社 🔥

[![Deploy to Pages](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/deploy.yml/badge.svg)](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/deploy.yml)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Content License: CC BY-NC-SA 4.0](https://img.shields.io/badge/Content%20License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

> 用笔记改变一门课，期末考研竞赛科研社团都涉及的超好用 HIT 笔记网站！

---

# ⚠️ 重要声明
**本项目内所有电子教材资源均来源于 Z-Library 公开共享平台。**
所有资料仅限个人学习、研究与交流使用，**严禁任何形式的商业使用、售卖与违规传播**。

---

## ✨ 项目简介

薪火笔记社是一个面向哈尔滨工业大学（HIT）学生的开源笔记共享平台，旨在汇聚优质学习资料，帮助同学们更好地掌握课程知识、备战考试与竞赛。

### 特色内容

- 📚 **课内笔记**：微积分、线代、马原等核心课程的复习资料
- 🏆 **竞赛经验**：各类学科竞赛的备赛经验分享
- 📖 **读书笔记**：优质书籍的阅读心得与总结

## 📂 项目结构

```
fireworks-notes-society/
├── .vitepress/          # VitePress 配置
├── .github/workflows/   # GitHub Actions 自动部署
├── public/              # 静态资源
├── lessons/             # 课程笔记索引
├── <学院或资料分类>/    # 手写 Markdown 课程与资料入口
├── parts/               # 零散片段（开发中）
└── team.md              # 团队成员
```

## 课程中心

`/courses/` 课程中心在构建时聚合完整课程数据，浏览器不会直接加载管理快照。

课程中心提供两种查看模式：

1. **我的教学计划**：先选择培养方案或执行教学计划，再按方案版本或入学年级、培养学院、完整专业身份和学期浏览；方案版本不等同于入学年级；
2. **直接找课程**：按课程名称、课程代码、别名、开课学院、培养学院、推荐学期和资料状态组合检索。

每个课程代码都有稳定的 `/courses/<课程代码>` 页面，展示课程基本信息、覆盖专业与推荐学期、资料数量/分类/容量及 GitHub 课程仓库入口。没有资料的课程也保留在目录中，方便后续贡献。

当前数据包含 4,613 份培养方案及执行教学计划、16,431 个课程代码、226,560 条原始记录，其中 224,601 条有代码课程安排按计划 ID 完整保存在数据包中，323 门课程已有资料。没有代码的原始记录仍完整保留在管理数据中。`/lessons` 继续保留原有 OpenList 资料下载入口。

课程目录维护：

- 权威数据：`data/repository-manifest.no-collection.v4.json`、同目录的 `.fireworks-json` 分片与 `config/repository-file-routes.v4.json`；根文件和分片必须一起更新，读取时核验 SHA-256 和字节数；
- 聚合逻辑：`.vitepress/theme/course-catalog.ts`；
- 中心组件：`.vitepress/theme/components/CourseExplorer.vue`；
- 课程详情组件：`.vitepress/theme/components/CourseDetail.vue`；
- 动态页面模板：`courses/[code].md` 与 `courses/[code].paths.ts`；
- 数据契约测试：`bun run test:courses`；
- 完整构建：`bun run docs:build`。

构建前由独立进程生成完整课程数据，Vite 只读取目录摘要和当前课程详情；全部课程共用一次编译的页面模板，但分别生成完整静态 HTML。教学计划按约 1 MiB 的目标大小打包，单个计划不拆分，客户端按计划 ID 提取记录。MPA 发布不重复上传仅供渲染的详情 JSON，并清理上次构建的残留产物。Tailwind 仅扫描页面和主题源码，不扫描管理数据或构建产物。数据更新后运行 `bun run docs:build`，即可生成完整页面、计划数据包及交互脚本。

## 资料入口与旧页面

`/lessons` 仍是原有资料下载入口，课程中心负责课程发现和课程元数据展示，两者互补，不删除既有手写课程页面。

## 🛠️ 技术栈

- **框架**：[VitePress](https://vitepress.dev/) - Vue 驱动的静态站点生成器
- **样式**：[Tailwind CSS](https://tailwindcss.com/) + [PrimeVue](https://primevue.org/)
- **部署**：GitHub Pages + GitHub Actions 自动化部署
- **包管理 / 运行时**：Bun

### 本地仓库状态 TUI

仓库状态 TUI 使用 Rust 的 `ratatui` 与 `crossterm`。默认读取 116 个 production 仓库的课程代码原子化 canonical `data/repository-manifest.json`、`config/repository-topology.v3.json`、`config/repository-file-routes.v3.json`，以及课程代码原子化迁移执行与验证报告。界面中的“检查课程代码原子计划”和“核验课程代码原子内容”都是只读操作；不会从 TUI 发起远端写入或删除。

```bash
# 构建并运行全屏 TUI
cargo run --manifest-path repository-tui/Cargo.toml -- --root .

# 非交互检查 canonical manifest、v3 topology/routes 与原子化终态
cargo run --manifest-path repository-tui/Cargo.toml -- --check --root .

# 编译与单元测试
cargo check --manifest-path repository-tui/Cargo.toml
cargo test --manifest-path repository-tui/Cargo.toml
```

兼容入口 `python scripts/repository_management.py tui` 只负责定位并启动上述 Rust 二进制；TUI 本身不执行 Python 菜单或课程处理逻辑。

课程代码原子化收敛已完成：远端精确包含 116 个 production 仓库，以及固定保留的 `fireworks-attachments` 和 `fireworks-notes-society`，合计 118 个仓库。83 个退出仓库已按冻结的 `node_id`、commit 和 tree 逐项删除并确认 404；3,857 个文件（9,159,380,782 B）、76 个操作目标仓和 13,309 个 Registry 受控文件均已复核。

新的仓库模型以培养方案中的课程代码为不可拆分原子；同一冻结资料文件通过多个 `route_keys` 连接的课程代码形成不可拆分共享资料连通分量。历史 ResourceGroup 仅保留为导航、审计和迁移血缘证据，不再约束物理仓库演进。无资料课程代码按唯一开课单位合并，课程类别只作为审计标签。

本地 canonical 状态：

- `data/repository-manifest.json`：116 仓课程代码原子化 production manifest。
- `config/repository-topology.v3.json`：116 仓显式拓扑。
- `config/repository-file-routes.v3.json`：3,857 条文件路由与 2,618 条课程代码路由。
- `data/repository-manifest.resource-aware-192.v2.json`：上一轮 192 仓资料感知历史快照。
- `data/repository-manifest.legacy-255.v1.json`：更早的 255 仓历史快照。
- `data/course-code-atomic-repository-convergence-verification.v1.json`：118 仓远端终态验证证据。

旧 `execute-final-repository-convergence.py`、资料感知上一轮执行器、旧迁移报告和旧清理报告均作为历史执行证据保留，不再作为默认生产入口。

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
# 验证课程目录数据契约
bun run test:courses

# 构建生产版本（同时生成全部课程详情页）
bun run docs:build

# 预览构建结果
bun run docs:preview
```

## 📝 参与贡献

我们欢迎任何形式的贡献！您可以：

1. **提交笔记**：分享您的课程笔记或学习心得
2. **修正错误**：发现问题可以直接点击页面底部的"在 GitHub 上编辑此页面"
3. **提出建议**：通过 Issue 提出改进建议

### 贡献步骤

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingNotes`)
3. 提交您的更改 (`git commit -m 'Add some AmazingNotes'`)
4. 推送到分支 (`git push origin feature/AmazingNotes`)
5. 开启一个 Pull Request

## 📜 许可证

- **代码**：本项目代码采用 [Mozilla Public License 2.0 (MPL-2.0)](LICENSE) 许可证开源
- **内容**：笔记等文字内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans) 许可证

## 🔗 相关链接

- 🌐 [网站主页](https://hit-fireworks.github.io/fireworks-notes-society/)
- 📦 [GitHub 仓库](https://github.com/HIT-Fireworks/fireworks-notes-society)

---

<p align="center">
  <strong>薪火相传，笔记共享</strong><br>
  Made with ❤️ by HIT Fireworks
</p>
