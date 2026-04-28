# 薪火笔记社 🔥

[![Deploy to Pages](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/deploy.yml/badge.svg)](https://github.com/HIT-Fireworks/fireworks-notes-society/actions/workflows/deploy.yml)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Content License: CC BY-NC-SA 4.0](https://img.shields.io/badge/Content%20License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

> 用笔记改变一门课，期末考研竞赛科研社团都涉及的超好用 HIT 笔记网站！

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

课程与资料分类目录以手写 Markdown 作为站点入口，实际覆盖范围以仓库内容为准，可结合审计报告核对覆盖差距。

## 课程入口与资料目录

站点内的课程入口以仓库中的手写 Markdown 为准。VitePress 根据这些 Markdown 文件生成页面、侧边栏、标题和站内搜索内容。

OpenList 的 `/Fireworks` 目录是资料下载目录参考。课程页中的 `<OList path="..." />` 必须指向真实存在的 OpenList 目录，但 OpenList 不会在构建时自动生成站点页面。

当 OpenList 新增或重排目录时，维护者需要手动新增、移动或更新 Markdown 页面，然后运行 `bun run audit:openlist` 检查 `<OList path>` 是否有效。

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
