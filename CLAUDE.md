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
6. 微博页面按 F12 可查看页面控制台

## 架构与核心技术问题

### 文件结构

所有逻辑集中在 `popup.js` 一个文件中，没有构建流程。`manifest.json` 声明权限，`popup.html` + `popup.css` 是弹窗 UI。

### 关键技术方案：chrome.debugger

**微博页面 (`www.weibo.com`) 的 API (`weibo.com/ajax/...`) 跨域被 CORS 拦截，页面监控脚本 (`frame_ant.js`) 还会劫持 `fetch` 和 `XMLHttpRequest`。** popup 的 `fetch` 因 `chrome-extension://` 源也被 403 拒绝。

**解决方案**：使用 `chrome.debugger` API attach 到页面，通过 `Runtime.evaluate` 在页面上下文中执行 `fetch`，拥有和浏览器控制台完全相同的权限。

```
chrome.debugger.attach → Runtime.evaluate(fetch) → chrome.debugger.detach
```

页面顶部会出现"扩展正在调试此浏览器"黄色横幅，这是正常行为。

### 微博 API

- **端点**：`https://weibo.com/ajax/statuses/mymblog?uid={uid}&page={page}&feature=0`
- **返回格式**：`data.data.list[]`，每条包含 `text_raw`（纯文本）、`text`（HTML 富文本）、`created_at`（时间字符串如 `"Sun Jul 06 00:32:02 +0800 2025"`）
- **分页**：每页约 20 条，通过 `list.length >= 20` 判断是否有下一页
- **注意**：URL 必须用 `weibo.com`（不带 www），`www.weibo.com` 的 API 返回 403

### 时间格式化

`created_at` 格式为 `"Sun Jul 06 00:32:02 +0800 2025"`，可通过 `new Date()` 直接解析，也支持相对时间（"刚刚"、"X分钟前"）和 Unix 时间戳。

## 语言约定

文档和注释使用中文，技术术语保留英文。
