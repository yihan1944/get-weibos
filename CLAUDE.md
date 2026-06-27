# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Chrome 浏览器插件（Manifest V3），用于将微博用户主页的推文下载为 Markdown 或 HTML 格式（可打印为 PDF）。无构建步骤，直接加载目录即可运行。

## 开发与调试

1. 打开 `chrome://extensions/`，开启开发者模式
2. 点击"加载已解压的扩展程序"，选择本项目目录
3. 修改代码后，在扩展页面点击插件的刷新按钮
4. 打开微博用户主页（如 `weibo.com/u/数字ID`），点击插件图标测试
5. 弹窗页面右键 → "检查" 可打开 popup 的控制台
6. 微博页面按 F12 可查看页面控制台（注入脚本的 console.log 输出在这里）

## 架构与核心技术问题

### 文件结构

所有逻辑集中在 `popup.js` 一个文件中，没有构建流程。`manifest.json` 声明权限，`popup.html` + `popup.css` 是弹窗 UI。

### 关键技术约束：跨域请求

**当前代码中的 `fetchTweetsFromApi` 直接从 popup 上下文调用 `m.weibo.cn` API，这会被 CORS 拦截。** popup 运行在 `chrome-extension://` 源下，不是 `weibo.com` 或 `m.weibo.cn`，即使 `manifest.json` 配置了 `host_permissions`，`credentials: 'include'` 也无法携带微博的登录 Cookie。

### 正确的数据获取方案

需要通过 `chrome.scripting.executeScript` 将请求注入到微博页面中执行，利用页面的登录态：

- **方案 A**：注入脚本到 `weibo.com` 页面，调用 PC 端 API `weibo.com/ajax/statuses/mymblog?uid={uid}&page={page}`（同源，最可靠）。返回 `data.data.statuses[]`，每条含 `text_raw`、`created_at`。
- **方案 B**：注入脚本调用移动端 API `m.weibo.cn/api/container/getIndex?containerid=107603{uid}&page={page}`。返回 `data.data.cards[]`（`card_type === 9` 为推文），每条 `mblog` 含 `text_raw`、`created_at`。

**注意 `chrome.scripting.executeScript` 的限制**：
- 默认在隔离世界（`ISOLATED`）运行，多次注入之间 `window` 变量不共享
- `func` 参数不支持返回 Promise/复杂对象——需要设置 `world: 'MAIN'` 在页面主世界执行，或通过 `window` 变量中转数据
- `args` 参数只能传可序列化的值

### 微博 API 数据格式

- **时间戳**：`created_at` 可能是 Unix 秒级时间戳、相对时间字符串（"刚刚"、"5分钟前"）、或 `"Sun Jul 01 12:00:00 +0800 2015"` 格式
- **内容**：`text_raw` 是纯文本，`text` 是含 HTML 标签的富文本，需 `stripHtml()` 处理
- **分页**：PC API 用 `page` 参数，每页约 20 条；移动端 API 同理

## 语言约定

文档和注释使用中文，技术术语保留英文。
