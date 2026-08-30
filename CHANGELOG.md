# 更新日志

> 中文版在英文版 0.1.5 基础上汉化，只做了 GUI 版汉化，只测试了 windows 端
>
> <br />

原项目更新日志见：[English](CHANGELOG.en.md)

## [Unreleased]

### 新增

- **新增《llamacpp 参数及性能调优》文档**：以 llama-server manpage 的四组分组方式，重组《Catapult 完整参数配置指南》中的参数说明，并附性能调优要点。含档位预设速查表、常用页/高级页参数清单（131 项，英文字段逐字节取自官方文档，供 UI 运行时传递）与 CLI 专用参数清单（64 项，不进 UI），另附参数设置原则总结。
- **新增 `docs/reference/` 目录**：存档 llama-server 手册页（manpage）与 llama.cpp 官方性能调优指南的英文原文，作为参数校对的权威依据。

### 变更

- **《Catapult 完整参数配置指南》全面对齐 llama.cpp 官方文档**：逐条校正参数含义、取值范围与默认值（如超时 3600s、优先级五级、Flash Attention 默认 `auto`、GPU 层数默认 `auto` 等），补齐新增参数（`--load-mode`、`--reasoning-effort`、`--kv-unified-per-slot`、`--video-*`、`--spec-synth-*` 等），补充按显存分级（6GB–48GB+）的推荐配置速查表，并在文档头标注更新日期。
- **移除无官方文档支持的界面参数**：删除语音合成两项（`--model-vocoder`、`--tts-use-guide-tokens`）与过时的"详细提示"字段（`--no-display-prompt`）。约定：所有进入界面的参数必须以官方 manpage 与 `llama-server --help` 为准，无官方依据的参数不做 UI。

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

- **【运行】面板：网盘下载入口（夸克网盘）**：在「下载运行时」卡片头部右侧新增「网盘下载」按钮（图标 `CloudDownload`），位置在「刷新」按钮左侧。点击后用 `invoke('open_url')`（fallback `window.open`）直达夸克网盘镜像（https://pan.quark.cn/s/22a140f65f88?pwd=TXQs），适合 GitHub release 资产直连慢速的国内用户。i18n 新增 `netdiskDownload` / `netdiskTitle` 中英双语。

- **【运行】面板：最新版本号变为 GitHub 跳转链接**：之前「最新版本: b9594」是纯文本，现在把整段做成一个带 `ArrowUpRight` 图标的按钮（hover 时变 primary 色 + 下划线），点击用 `invoke('open_url')` 打开对应的 GitHub release 页面（`https://github.com/ggml-org/llama.cpp/releases/tag/{tag_name}`）。i18n 新增 `openReleaseOnGithub` 中英双语。

- **【运行】面板：服务器日志新增"一键复制"按钮**：「服务器日志」头部右侧新增复制按钮（`ClipboardCopy` 图标），紧邻折叠箭头。点击后用 `navigator.clipboard.writeText` 把 `logs` 数组用换行符拼接写入剪贴板（剪贴板 API 不可用时回退到隐藏 `textarea` + `document.execCommand("copy")`），1.5s 内图标切换为 `CircleCheck` 并变 primary 色作"已复制"瞬态反馈。`logs.length === 0` 时按钮自动 disabled。**v0.1.5-1 修复**：将外层包裹的 `<button>` 拆为「标题区按钮 + 操作区 div + 操作区折叠按钮」三件套（HTML 规范禁止 `<button>` 嵌套 `<button>`，浏览器解析时会自动提走内层按钮，导致 `e.stopPropagation()` 失效、外层折叠 `onClick` 仍触发——表现为"点复制会折叠面板"）。`aria-label` 同步拆为 `collapsePanel` / `expandPanel`（中英双语）。

- **【运行】面板：修复 `--fit` 必传参被吞掉的启动失败**：Catapult 在「运行」面板的「Server」标签里 `Fit` 是下拉框（`on` / `off`），UI 选中 `on` 时 `extra_params["fit"]` 值为空串。后端 `build_args` 之前对所有空值都走"只 push 旗标、不 push 值"的分支，导致拼出的命令行形如 `… --fit --kv-unified …`，`llama-server` 解析时把 `--kv-unified` 当成 `--fit` 的参数值、报 `unknown value for --fit: '--kv-unified'` 并退出 1。修复方式：后端加白名单 `OPTIONAL_ON_OFF_FLAGS`（当前含 `fit` / `no-warmup` / `warmup`），命中时强制 emit `"on"`（空值时）或原值（非空时），其它 flag 行为保持不变（空值 drop，避免污染命令行）。新增 3 个回归测试（`build_args_fit_on_emits_value_kv_unified_stays_dangling` / `build_args_fit_off_passes_value` / `build_args_non_on_off_flag_empty_value_dropped`）。

- **【运行】面板：启动前 KV 缓存预算提示（`estimate_kv_usage`）**：从 GGUF 头部读 `embedding_length` / `block_count` / `attention.head_count_kv` / `attention.key_length` 四个 arch 字段，结合用户在 UI 配的 `n_ctx` 和 `cache_type_k`（f16/q8_0/q4_0 等），按 `2 × head_dim × head_count_kv × block_count × bpe × ctx × 1.08` 公式估算 KV 占用，叠加上模型文件大小（GB）得到总 VRAM 占用，与当前 `GpuInfo.vram_mb` 总和比对：
  - `usage_pct < 0.80`：无提示
  - `0.80 ≤ usage_pct < 1.00`：黄色 toast「Tight fit: …」
  - `usage_pct ≥ 1.00`：黄色 toast「Predicted to OOM at startup: …」（不阻止启动，仅提示）
  - 检测不到 VRAM（核显 / WSL1）时给「lower bound」友好文案
  Toast 显示在「启动」按钮上方，含三个数字（权重 / KV / VRAM）和「关闭」按钮。新增 Tauri command `estimate_kv_usage` + `kv_estimate` Rust 模块（2 个单测）+ `KvEstimate` TS 类型。i18n 新增 `kvWarningTitle` / `kvWarningHint` 中英双语。**典型场景**：5080 16G + 32G RAM + gemma-4-12b-it-UD-Q4_K_XL（6.86 GB）+ ctx=65536 + KV=q8_0 时，估算 KV 占用约 13 GB，会触发「Predicted to OOM」提示，建议降到 ctx=16384。

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

