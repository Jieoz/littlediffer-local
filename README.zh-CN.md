# Little Differ — 本地 Nginx/PHP 版本

这是一个可自托管、无需构建步骤的 [littlediffer.com](https://www.littlediffer.com/) 本地复刻版本：一个快速、极简的文本 diff 工具。

本版本使用 **PHP + HTML/CSS/JavaScript** 实现页面和交互：不需要 npm、不需要 Node、不需要数据库，也不会在服务端保存任何输入内容。

> **隐私说明**：你的文本不会离开浏览器。PHP 只负责渲染页面壳；diff 计算、语言检测、语法高亮都在浏览器本地完成。粘贴的文本不会上传到服务器，也不会被服务端存储。

## 功能

- 双栏文本编辑区，带行号和接近 Monaco 的 diff overlay。
- 输入时实时在浏览器本地计算 diff。
- 并排视图：红色表示删除，绿色表示新增，并支持行内字符/词级高亮。
- **Unified View**：单栏合并视图。
- **Ignore Whitespace**：比较时忽略行首/行尾空白，但仍展示原始文本。
- **Word Wrap**：长行自动换行。
- **主题切换**：浅色 / 深色 / 跟随系统，并通过 `theme` 写入 `localStorage`。
- **语言选择器**：支持自动检测，也可以手动指定语言。
- **本地语法高亮**：无 npm、无 CDN、无 Monaco 依赖。
- **Swap**：交换左右两侧内容。
- 编辑器状态会保存在 `localStorage` 的 `little-differ` key 下，刷新后可恢复内容和开关状态。

## 运行方式

### 方式 A：PHP 内置服务器，本地快速验证

```bash
cd /workspace/repos/littlediffer-local
php -S 0.0.0.0:8080 -t public
```

然后打开：

```text
http://localhost:8080/
```

### 方式 B：Nginx + PHP-FPM，接近正式部署

1. 复制或改造 [`nginx.conf.example`](./nginx.conf.example) 到你的 nginx `sites-available` 或 `conf.d`。
2. 把 `root` 改成当前仓库 `public/` 目录的绝对路径。
3. 把 `fastcgi_pass` 改成你的 PHP-FPM socket，或 `127.0.0.1:9000`。
4. 执行：

```bash
nginx -t && nginx -s reload
```

PHP-FPM 只执行 `public/index.php`，静态资源由 nginx 直接提供。

## 目录结构

```text
public/
  index.php                 # PHP 入口，只负责页面模板/壳
  icon.png                  # favicon
  assets/
    styles.css              # 页面样式、diff 颜色、语法高亮颜色
    diff.js                 # 浏览器本地 diff 引擎
    highlight.js            # 本地语言检测 + 静态语法高亮
    app.js                  # 编辑器交互、开关、主题、语言、状态持久化
  vendor/
    fonts/inter-latin.woff2 # 本地 Inter 字体子集
nginx.conf.example          # Nginx + PHP-FPM 示例配置
README.md                   # 英文说明
README.zh-CN.md             # 中文说明
```

## 已支持的语言检测/高亮

当前是轻量级本地启发式检测和静态高亮，不是完整 Monaco tokenizer，也不是机器学习模型。

覆盖常见格式和语言：

- JSON
- JavaScript / TypeScript
- HTML / XML
- CSS
- PHP
- Python
- SQL
- Markdown
- Shell
- YAML / TOML / INI
- Dockerfile
- Nginx
- Java / C / C++ / C#
- Go / Rust / Swift / Kotlin / Ruby

## 高保真部分

以下部分已经尽量贴近源站：

- 顶部工具栏、checkbox 风格开关、居中 swap 按钮、主题按钮、底部状态栏、隐私提示、`@oztune` 链接。
- 颜色 token 和浅色/深色主题风格。
- 删除/新增的 gutter、行背景、行内字符背景。
- Inter 字体。
- 浏览器本地 diff 和“不上传文本”的隐私模型。
- `localStorage` 的 key：`little-differ`、`theme`。

## 和源站不同/近似的地方

这是一个本地可部署的复刻版本，不是源站源码拷贝。

- **编辑器引擎不同**：源站使用 Monaco diff editor。本项目为了保持无 npm、无构建步骤，用 `textarea + overlay + gutter` 模拟 Monaco 的操作观感。
- **diff 算法不同**：本项目使用行级 LCS + 行内词/字符细化，常见文本效果接近，但不是 Monaco 内部算法。大文本场景会先裁剪公共前后缀，再对过大的 diff 窗口使用较粗的按位置对齐兜底，以避免浏览器冻结；代价是大段重写区域里的高亮精度会低于完整 LCS。
- **语言检测/语法高亮不同**：本项目用本地静态 JS 实现，体积小、可离线部署，但覆盖深度不如完整 Monaco。
- **Unified View**：更偏阅读视图；主要编辑仍在并排双栏中完成。

## 适合的使用场景

- 内网部署一个轻量文本 diff 工具。
- 不希望文本内容离开浏览器。
- 希望用 Nginx + PHP 直接托管，而不是 Node/Next.js/Vercel。
- 需要一个接近 littlediffer.com 操作体验的本地版本。

## 性能说明

- 对公共不变的行级前缀/后缀先跳过，再进入 LCS；因此 1 万行文件中只改一行时会明显更快。
- 对非常大的未匹配区域设置矩阵规模上限，超过后用线性兜底，不再让浏览器分配无限制的 `n × m` 表。
- 行内字符/词级高亮也做了公共前后缀裁剪，并对超长单行/压缩文本设置更小的安全上限。
- 大文本输入会使用稍长一点的渲染 debounce，避免粘贴或连续输入时每个按键都重新计算。

## 后续可继续打磨

- 引入更完整的 tokenizer/语法高亮规则，但仍保持本地静态资源。
- 继续改进超大文本体验，例如虚拟滚动或真正的分块 diff。
- 增强移动端体验。
- 增加导入文件、复制 diff、下载 patch 等辅助功能。
- 增加自动化浏览器回归测试。
