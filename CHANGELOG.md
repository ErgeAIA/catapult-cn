# 更新日志

> 中文版在英文版 0.1.5 基础上汉化，只做了 GUI 版汉化，只测试了 windows 端
>
> <br />

原项目更新日志见：[English](CHANGELOG.en.md)

## [Unreleased]

### 中文版本特性

- **【运行】面板：修复"运行时下载"在 GitHub API 限速时无反应的问题**：当 `api.github.com/repos/ggml-org/llama.cpp/releases/latest` 返回 403（匿名调用频次限制，国内常见）时，改为优先回退到本地 ETag 缓存（`%APPDATA%\catapult\release_cache.json`），用户依然可以浏览和下载最近一次成功的 release 资产。后续网络成功时附带 `If-None-Match`，命中 304 不再消耗 API 配额。共享的 HTTP 客户端同时支持读取 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量，便于通过代理访问。

## [0.1.5] - 2026-05-28

### 中文版本特性

- **中文语言支持**：增加了中文翻译，自适应系统语言，也可手动切换语言
- **【模型】-【已安装】面板增强**：
  - 增加了打开模型所在目录按钮，一键直达模型所在目录
- **【模型】-【推荐】面板增强**：
  - 点击模型名称，跳转到 ModelScope 对应模型页面
  - 增加 ModelScope 下载按钮
- 增加**【浏览 ModelScope】面板**：
  - 可从 ModelScope 上搜索模型，无需魔法直接下载
  - 点击搜索结果中模型名称，可跳转到模型页面，可用作模型管理
- **【运行】面板预设增强**：
  - 增加了七套预设，根据自身硬件点击可切换
- **界面信息增强**：
  - 软件界面增加了原版 GitHub 和汉化版本 GitHub 地址，方便查看

