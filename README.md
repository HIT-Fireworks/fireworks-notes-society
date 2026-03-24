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
├── 数学学院/            # 数学学院课程笔记
│   ├── 数学分析/
│   ├── 高等代数/
│   ├── 复变函数/
│   ├── 实变函数/
│   ├── 泛函分析/
│   ├── 常微分方程/
│   ├── 初等数论/
│   ├── 集合论图论/
│   ├── 计算概论/
│   └── ...
├── 交通科学与工程学院/  # 交通学院课程笔记
├── parts/               # 零散部分（开发中）
└── team.md              # 团队成员
```

## 🛠️ 技术栈

- **框架**：[VitePress](https://vitepress.dev/) - Vue 驱动的静态站点生成器
- **样式**：[Tailwind CSS](https://tailwindcss.com/) + [PrimeVue](https://primevue.org/)
- **部署**：GitHub Pages + GitHub Actions 自动化部署
- **包管理**：pnpm

## 🚀 快速开始

### 环境要求

- Node.js 18+
- pnpm 10+

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/HIT-Fireworks/fireworks-notes-society.git
cd fireworks-notes-society

# 安装依赖
pnpm install

# 启动开发服务器
pnpm docs:dev

# 构建生产版本
pnpm docs:build

# 预览构建结果
pnpm docs:preview
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
