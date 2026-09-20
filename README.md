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

每个课程代码都有稳定的 `/courses/<课程代码>` 页面，展示课程基本信息、覆盖专业与推荐学期，以及唯一资料仓库的完整资料树。没有资料的课程也保留在目录中，方便后续贡献。

当前数据包含 4,613 份培养方案及执行教学计划、16,431 个课程代码、226,560 条原始记录，其中 224,601 条有代码课程安排按计划 ID 完整保存在数据包中。没有代码的原始记录仍完整保留在管理数据中。

课程目录维护：

- 课程与仓库关系：`data/repository-manifest.no-collection.v4.json` 及同目录 `.fireworks-json` 分片；
- 文件权威来源：各资料仓库当前 commit 的真实 Git Tree；主站不维护文件清单；
- Git Tree 规范化：`.vitepress/theme/resource-tree.ts`；
- 构建缓存：`scripts/build-resource-tree.mts`，输出按 `repoId + commit + treeSha` 版本化的完整树；
- 聚合逻辑：`.vitepress/theme/course-catalog.ts`；
- 中心组件：`.vitepress/theme/components/CourseExplorer.vue`；
- 课程详情组件：`.vitepress/theme/components/CourseDetail.vue`；
- 数据契约测试：`bun run test:courses`；
- 完整构建：`bun run docs:build`。

构建期先读取资料仓真实 Git Tree，再生成完整 SSG 首屏和版本化 Tree 缓存。浏览器 hydration 复用 SSG 快照；水合后只检查仓库 head，commit 变化时才后台加载新 Tree。`repository-resources.json` 已删除，运行时不依赖 Registry 文件清单。

## 资料入口与旧页面

`/lessons` 和保留的手写导航页按“页面 → 资料仓库 ID”范围展示仓库 Tree；该映射不包含文件路径、大小或课程级文件归属。下载固定到快照 commit，软件包和多文件文档保留实际相对路径。

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
