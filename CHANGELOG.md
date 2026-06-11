# 更新日志

> 中文版在英文版 0.1.5 基础上汉化，只做了 GUI 版汉化，只测试了 windows 端
>
> <br />

原项目更新日志见：[English](CHANGELOG.en.md)

## [0.1.5-1] - 2026-06-11

### 中文版本特性

- **【运行】面板：修复"运行时下载"在 GitHub API 限速时无反应的问题**：当 `api.github.com/repos/ggml-org/llama.cpp/releases/latest` 返回 403（匿名调用频次限制，国内常见）时，改为优先回退到本地 ETag 缓存（`%APPDATA%\catapult\release_cache.json`），用户依然可以浏览和下载最近一次成功的 release 资产。后续网络成功时附带 `If-None-Match`，命中 304 不再消耗 API 配额。

- **【运行】面板：HTTP 代理支持实装**（上一条目承诺的代理支持在初次提交时因 `Cargo.toml` 给 `reqwest` 启用了 `default-features = false` 而未生效，本次补全）：
  - `Cargo.toml` 给 `reqwest` 加 `system-proxy` feature，覆盖 Windows WinHTTP 系统代理（Clash / V2RayN "Allow LAN"）与 macOS 系统配置（Surge / ClashX）
  - `lib.rs` 在 HTTP 客户端构建时按优先级 `ALL_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY`（大小写六个常见变量名）读第一个非空值，喂给 `reqwest::Proxy::all()` 显式注入
  - 共享客户端总 timeout 从 30s 提到 120s
  - `runtime.rs::download_runtime` 单请求 timeout 设为 300s，给 100+ MB release 资产在代理/国内链路下留足余量；同时仍可通过 `download_progress` 事件流监测/中断卡住的连接

- **【运行】面板：CUDA 依赖包不再误夺主运行时位置**：`cudart-llama-bin-*.zip`（仅含 `llama.dll`，不含 `llama-server.exe`）在 `AssetOption` 和 `ManagedRuntime` 中均被正确标记为辅助包（`kind: "cuda_dlls"`，score 设为 `-1000`）。允许下载（用户确实需要它配合主包使用），但**不会**被设为当前 active runtime，也不会触发其他后端的自动删除。UI 上：资产行显示「CUDA 依赖」徽章；下载完成后弹黄色提示横幅，指引用户改下对应主包（例如 `llama-b<build>-bin-win-cuda-XX.X-x64.zip`）。

- **【运行】面板：失败提示显眼化 + 一键复制**：原先只在页面顶部显示一行小红字，错误内容被截断/没翻译，用户也不方便把错误上报。现在统一替换为 `ErrorBanner`：红条 + 标题（识别 403/429 时切换为「GitHub API 限速」并附限速引导文案）+ 错误全文（默认截断、可点击展开）+「复制详细信息」按钮（带"已复制"瞬态反馈，剪贴板不可用时自动展开）+ 关闭按钮。所有错误源都附 `errorContext` 标签（`fetch latest release` / `download runtime` / `activate runtime` 等），复制内容包含 `Action` / `Time` / `Error` 三段，便于排查。新增 `errorTitle` / `errorRateLimitTitle` / `errorRateLimitHint` / `errorCopyDetails` / `errorCopied` / `errorDismiss` 中英双语。

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

