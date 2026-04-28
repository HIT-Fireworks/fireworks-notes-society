# 参与贡献指南

感谢您有兴趣为薪火笔记社做出贡献！本文档将指导您如何参与到项目中。

## 🌟 贡献方式

### 1. 提交笔记内容

我们欢迎各类课程笔记，包括但不限于：

- 课内课程笔记
- 考试/考研复习资料
- 竞赛经验分享
- 读书笔记

### 2. 改进现有内容

- 修正笔记中的错误
- 完善笔记内容
- 改进排版和格式

### 3. 技术贡献

- 修复网站 Bug
- 改进网站功能
- 优化用户体验

## 📋 贡献流程

### 快速方式（适合小修改）

1. 在网站任意笔记页面底部点击"在 GitHub 上编辑此页面"
2. 在 GitHub 网页编辑器中修改内容
3. 提交 Pull Request

### 标准流程

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

## 📝 内容规范

### 文件组织

- 笔记按学院分类存放，如 `数学学院/`、`交通科学与工程学院/`
- 每门课程单独创建文件夹
- 每个课程文件夹需要有 `index.md` 作为课程主页
- 中间分组页和实验报告、竞赛、模板等非普通资料分类也可以有 `index.md`
- 页面是否存在由手写 Markdown 决定，`<OList path>` 需要通过审计验证

### 课程页与 OpenList 目录维护

新增、移动或删除课程页时，请按以下顺序检查：

1. 确认 Markdown 路径是站点内希望展示的分类或课程入口。
2. 确认页面标题和课程说明由维护者手写，不由脚本生成。
3. 确认 `<OList path="..." />` 指向真实存在的 OpenList `/Fireworks` 子目录。
4. 判断页面类型是普通课程页、中间分组页，还是实验报告、竞赛、模板等非普通资料分类。
5. 运行 `bun run audit:openlist` 查看当前差距报告，并确认没有新增 `error`。

审计脚本只读 OpenList 和本地 Markdown。它可以输出报告，但不会自动创建、移动、删除或修改课程 Markdown 页面。审计报告不得作为课程入口提交到课程目录。

### Markdown 格式

- 使用标准 Markdown 语法
- 数学公式使用 LaTeX 语法，如 `$E=mc^2$`
- 图片统一放置在对应笔记目录下

### 命名规范

- 文件名使用中文或有意义的英文
- 避免使用特殊字符
- 建议格式：`章节名称.md` 或 `知识点.md`

## 🔍 代码规范

在提交代码更改前，请运行格式化：

```bash
bun run format
```

## 💡 提交信息规范

提交信息建议遵循以下格式：

```
<类型>: <描述>

[可选的详细说明]
```

类型包括：

- `feat`: 新功能或新内容
- `fix`: 修复错误
- `docs`: 文档更新
- `style`: 格式调整（不影响代码逻辑）
- `refactor`: 代码重构

示例：

```
feat: 添加高等代数第三章笔记
docs: 更新 README 安装说明
fix: 修复数学公式渲染问题
```

## ❓ 需要帮助？

如果您在贡献过程中遇到任何问题，可以：

1. 在 [GitHub Issues](https://github.com/HIT-Fireworks/fireworks-notes-society/issues) 中提问
2. 查看现有的 Issue 了解常见问题

## 📜 许可声明

提交内容即表示您同意将其以以下许可发布：

- **代码**：MPL-2.0
- **内容**：CC BY-NC-SA 4.0

---

再次感谢您的贡献！🙏
