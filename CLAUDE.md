# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个 Chrome 浏览器插件，用于将微博推文下载为 Markdown 或 HTML 格式（可打印为 PDF）。

## 功能特性

1. 下载全部推文
2. 下载指定数量推文（最近 n 条，n 为正整数）
3. 自动翻页获取大量推文，显示实时进度
4. 内容格式：发送时间 + 推文内容（图片推文显示"图片"）
5. 按日期分组展示
6. 支持导出为 Markdown 和 HTML 格式
7. 基于用户本地电脑运行

## 项目结构

```
get-fan/
├── manifest.json      # Chrome 插件配置
├── popup.html         # 插件弹窗界面
├── popup.css          # 样式文件
├── popup.js           # 主逻辑
├── icons/             # 插件图标
│   └── icon128.png
└── readme.md          # 项目说明
```

## 安装使用

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本项目目录
5. 打开微博网站 (weibo.com) 并登录
6. 点击插件图标，选择下载选项

## 技术说明

- 使用 Chrome Extension Manifest V3
- 通过微博移动端 API (`m.weibo.cn/api/container/getIndex`) 获取推文数据
- 用户页面 URL 格式：`https://weibo.com/u/{数字ID}`
- containerid 格式：`107603{uid}`
- HTML 文件可直接打印为 PDF（`Ctrl+P`）

## 语言约定

文档和注释使用中文，技术术语保留英文。
