# 薪火笔记社 🔥

[![Site contract checks](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/site-checks.yml/badge.svg)](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/site-checks.yml)
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
├── .github/workflows/   # 代码变更的契约检查
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

当前数据包含 4,613 份培养方案及执行教学计划、16,431 个课程代码、226,560 条原始记录，其中 224,601 条有代码课程安排按计划 ID 完整保存在数据包中，323 门课程已有资料。没有代码的原始记录仍完整保留在管理数据中。`/lessons` 与手写资料页直接使用 Registry 文件路由，不再依赖 OpenList 或旧附件仓库。

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

`/lessons` 展示全部仓库资料，课程中心负责课程发现和元数据展示。手写资料页通过冻结来源路径确定展示范围，下载始终使用当前仓库路由；软件包和多文件文档保留实际相对路径。旧附件路径只用于来源追溯，不作为生产下载后端。

## 🛠️ 技术栈

- **框架**：[VitePress](https://vitepress.dev/) - Vue 驱动的静态站点生成器
- **样式**：[Tailwind CSS](https://tailwindcss.com/) + [PrimeVue](https://primevue.org/)
- **部署**：EdgeOne 自动生产部署；GitHub Actions 仅保留 PR 代码契约检查及手动验收，不重复构建并部署 GitHub Pages。
- **包管理 / 运行时**：Bun

## 仓库维护与资料分类

当前生产管理工具位于 [fireworks-repos-management-v2](https://github.com/HIT-Fireworks/fireworks-repos-management-v2)，权威数据位于 [fireworks-course-registry-v2](https://github.com/HIT-Fireworks/fireworks-course-registry-v2)。主站中的旧 Python 管理器、旧 TUI、迁移计划和版本化历史审计仅作为历史实现与证据，不应用于修改当前数据。

资料直接归属仓库，不再维护资源组实体。每个完整课程代码只归属一个资料仓；共享文件关联的课程不能拆到不同仓库。维护边界需要分开时拆仓，不以仓内资源组代替。

资料使用预设中文分类：`教材/`、`笔记/`、`课件/`、`试卷/`、`作业/`、`实验/`、`软件/`、`教程/`、`模板/`、`项目/`、`其他/`。只创建有实际文件的分类，不添加空目录占位文件。维护者不得自行新增根级分类；确有新分类需要时，先统一修改管理规则。仓库根目录仅保留 README、LICENSE、repository.toml 和必要配置；软件包、代码项目、多文件文档在分类内保留完整结构。

当前快照包括 176 个受控仓库，其中 117 个有资料仓，完整维护 3,857 个原始文件（9,159,380,782 字节）。资料及模板仓不运行独立 CI；Registry 集中核验分片、课程绑定、教学计划索引和文件路径；主站代码检查及管理工具测试只在相应 PR 或手动验收时运行，Windows 包仅按发布 Tag 或手动打包。

```sh
python scripts/validate-registry.py --root .
bun run test:courses
bun run docs:build
```

一次性迁移执行器与冻结证据位于 `scripts/complete-repository-cutover.py` 和 `data/repository-flat-migration/`，不是日常内容管理入口。

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
