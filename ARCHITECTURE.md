# 架构

Catapult 是一款双界面应用程序，作为 [llama.cpp](https://github.com/ggml-org/llama.cpp) 的启动器。它负责运行时版本管理、模型发现、服务器配置，并提供嵌入式聊天界面。

**界面：**
- **GUI** — Tauri v2 桌面应用程序（Rust 后端 + React/TypeScript 前端）
- **TUI** — 基于终端的界面（Rust + ratatui/crossterm）

## 目录结构

```
catapult/
├── src-tauri/src/           # Rust 后端（约 6,500 行代码，含 TUI）
│   ├── lib.rs               # Tauri 命令注册、AppState、IPC 处理器
│   ├── config.rs            # AppConfig 持久化、运行时/模型类型
│   ├── hardware.rs          # CPU/RAM/GPU 检测、后端评分、配置建议
│   ├── runtime.rs           # GitHub release 获取、资产评分、下载/解压
│   ├── models.rs            # GGUF 扫描、元数据解析、断点续传下载
│   ├── server.rs            # ServerConfig、进程启动/终止、CLI 参数构建
│   ├── huggingface.rs       # HF API 搜索、推荐模型、量化提取、presets.ini 获取
│   ├── main.rs              # GUI 入口 stub
│   ├── tui_main.rs          # TUI 入口（ratatui + crossterm）
│   └── tui/                 # TUI 实现（约 2,200 行代码）
│       ├── app.rs           # TuiApp 状态、标签页管理、动作处理
│       ├── event.rs         # 异步事件处理器（键盘输入 + 异步事件）
│       ├── server_ctl.rs    # TUI 服务器生命周期、PID 文件跟踪
│       ├── params.rs        # TUI 表单的服务器参数定义
│       ├── tabs/            # 标签页实现
│       │   ├── dashboard.rs # 系统概览、快速操作
│       │   ├── runtime.rs   # 下载/切换运行时
│       │   ├── models.rs    # 模型浏览器、HF 搜索、下载
│       │   ├── server.rs    # 服务器配置表单
│       │   ├── logs.rs      # 实时日志流
│       │   └── chat.rs      # 启动 llama-cli 终端聊天
│       └── widgets/         # 可复用 TUI 组件
│           ├── autocomplete.rs  # HuggingFace 搜索自动补全
│           └── progress.rs      # 下载进度条
├── src/                     # React/TypeScript 前端（4,400+ 行代码）
│   ├── App.tsx              # 路由（向导 + 主布局）
│   ├── main.tsx             # React 入口
│   ├── pages/
│   │   ├── Dashboard.tsx    # 系统概览、快速启动、收藏模型
│   │   ├── Runtime.tsx      # 托管/自定义运行时管理、下载
│   │   ├── Models.tsx       # 模型浏览器、搜索、列表、目录
│   │   ├── Server.tsx       # 标签页服务器配置、预设、日志
│   │   ├── Chat.tsx         # 嵌入式 llama.cpp WebUI iframe
│   │   └── Wizard.tsx       # 首次启动设置（运行时 + 模型选择）
│   ├── components/
│   │   ├── Layout.tsx       # 侧边栏导航 shell
│   │   └── CatapultIcon.tsx # SVG catapult 图标
│   ├── types/index.ts       # 镜像 Rust 结构体的 TypeScript 接口
│   ├── utils/format.ts      # 共享格式化工具
│   └── styles/globals.css   # Tailwind 组件类
└── tests
    ├── (Rust)               # #[cfg(test)] 模块中的单元测试
    └── src/utils/format.test.ts  # Vitest 单元测试
```

## IPC 模式（仅 GUI）

所有文件系统、网络和进程操作都在 Rust 中。前端通过 `invoke()` 进行请求/响应，通过 `listen()` 监听流式事件。共有 49 个注册的 Tauri 命令，涵盖硬件检测、运行时管理、模型操作、服务器控制、配置、预设以及每个模型的预设记忆。

**事件：**
- `download_progress` (DownloadProgress) — 运行时和模型下载过程中流式传输
- `server_log` (string) — llama-server stdout/stderr 的每一行

TUI 不使用 Tauri IPC；它直接调用底层库函数并管理自己的异步事件循环。

## TUI 架构

TUI（`catapult-tui` 二进制文件）使用 [ratatui](https://github.com/ratatui/ratatui) 进行渲染，使用 [crossterm](https://github.com/crossterm-rs/crossterm) 处理输入，以终端友好的格式提供与 GUI 相同的功能。

### 入口点
`tui_main.rs` 设置终端（原始模式、备用屏幕），初始化异步事件循环，并运行主 TUI 循环。panic hook 确保崩溃时终端被恢复。

### 应用状态（`tui/app.rs`）
`TuiApp` 持有跨标签页的所有 UI 状态：
- `config: AppConfig` — 与 GUI 共享配置
- `current_tab: Tab` — 活动标签页（Dashboard、Runtime、Models、Server、Logs、Chat）
- 标签页特定状态结构体（如 `ModelsTabState`、`ServerTabState`），包含输入、列表、焦点跟踪
- `active_downloads: HashMap<String, ActiveDownload>` — 进行中的运行时/模型下载
- `server_state: Option<DetectedServer>` — PID 文件检测现有服务器进程
- `logs: Vec<String>` — 捕获的服务器输出

### 事件系统（`tui/event.rs`）
一个 tokio 任务处理：
- **同步输入**：以 60Hz 轮询的 crossterm 键盘事件
- **异步事件**：下载进度、HTTP 搜索结果、服务器生命周期事件，通过 `mpsc` channel 传输

事件合并为单一 `TuiEvent` 枚举供主循环使用。

### 标签页（`tui/tabs/`）
每个标签页是一个模块，包含：
- `render()` 函数用于绘制标签页内容
- `handle_input()` 函数用于键盘事件处理
- 可选的 `on_*` 回调用于异步结果（如 `on_search_results`）

标签页镜像 GUI 页面：Dashboard、Runtime、Models、Server、Logs、Chat。

### 服务器控制（`tui/server_ctl.rs`）
TUI 独立于 GUI 管理服务器生命周期：
- PID 文件位于 `{data_dir}/catapult/.server.pid` 用于跟踪运行中的服务器
- `detect_existing_server()` 在启动时检查孤立进程
- 服务器通过直接进程启动/停止（不使用 Tauri 命令）
- 日志通过 tokio `tokio::io::AsyncBufReadExt` 行捕获

### 聊天模式
与 GUI 嵌入 Web UI 不同，TUI 的 Chat 标签页将 `llama-cli` 作为交互式子进程启动，暂停 TUI 直到用户退出（Ctrl-C 或 `/exit`）。聊天会话期间终端恢复到已烹饪模式。

### 共享核心
TUI 重用所有核心 Rust 模块：
- `config::AppConfig` — 相同配置文件，相同持久化
- `runtime` — 相同下载/解压逻辑
- `models` — 相同 GGUF 扫描和元数据解析
- `huggingface` — 相同 HF API 集成
- `server` — 相同 `ServerConfig` 和 CLI 参数构建

只有表示层不同（ratatui vs React）。

## 数据目录

所有路径通过 `dirs` crate 跨平台，相对于 `dirs::data_dir()`：

```
{data_dir}/catapult/
├── config.json              # AppConfig（所有设置）
├── gguf_cache.json          # GGUF 元数据缓存（路径 → 名称/参数/上下文/视觉）
├── runtimes/                # 托管运行时版本
│   ├── b5000-cuda/          # 每个构建+后端的版本化子目录
│   └── b5100-cuda/
├── runtime/                 # 遗留单运行时目录（加载时迁移）
├── models/                  # 默认模型下载目录
├── presets/                 # 服务器配置预设（*.json）
│   └── __default__.json     # 用户保存的默认设置
```

## 运行时管理

运行时可以是**托管**（从 GitHub releases 下载）或**自定义**（用户指向的本地安装）。

### 托管运行时
- 存储在版本化子目录中：`runtimes/b{build}-{backend}/`
- 多个版本可以共存；一次只能有一个处于活动状态
- 旧版本可以在新安装时自动删除（`auto_delete_old_runtimes` 配置标志）
- 非活动版本显示在可折叠的"归档"部分
- 配置跟踪：构建号、标签、后端 ID/标签、资产名称、目录、安装时间戳

### 自定义运行时
- 指向任何包含 `llama-server` 二进制文件的目录
- 扫描是递归的（深度 5）并检测多个构建（如 `build/` + `vulkan/`）
- 可以注册多个自定义运行时；一次只能有一个处于活动状态

### 资产评分
每个 GitHub release 资产按当前平台评分：CUDA=100、Metal=95、ROCm=90、Vulkan=70、SYCL=60、CPU AVX-512=30、CPU AVX2=25、CPU AVX=20、CPU 无 AVX=10。系统上不可用的后端扣 200 分。

## 模型管理

### 扫描
- 可以配置多个 GGUF 存储目录，每个目录递归扫描（深度 5）
- 为新模型下载指定单独的下载目录
- IMatrix/importance_matrix 文件从显示中过滤
- 分割的 GGUF 文件（如 `model-00001-of-00003.gguf`）在所有部分都存在时合并为单个逻辑模型条目；不完整的集合单独显示各部分
- 通过规范路径去重处理符号链接和重叠目录
- `__downloading__` 临时文件从列表中排除

### GGUF 元数据
二进制解析器读取 GGUF v3 头以提取：
- `general.name` — 模型名称
- `general.size_label` — 参数量（如 "9.4B"）
- `general.architecture` — 用于定位上下文长度键
- `{arch}.context_length` — 训练上下文窗口
- `general.tags` — 字符串数组；存在 "image-to-text" 或 "image-text-to-text" 标记视觉能力

结果缓存在 `gguf_cache.json` 中，以文件路径为键，在文件大小或修改时间变化时失效。第一次扫描读取头；后续扫描使用缓存数据实现近乎即时的加载。

### 视觉模型
标记为具有视觉能力的模型与在同一目录中找到的兼容 mmproj 文件配对。匹配要求 mmproj 文件名包含 "mmproj" 并与模型共享至少 2 个名称段（如 "Qwen3.5" + "4B"）。启动服务器时自动传递 mmproj 路径作为 `--mmproj`。

### 下载
- 支持 HTTP Range 断点续传
- 指数退避重试：延迟 0s、1s、2s、4s、8s
- 连续失败计数器在收到数据时重置（只要取得进展， flaky 连接就会无限重试）
- 5 次连续失败后：下载暂停，显示 Resume/Abort 按钮
- 临时文件（`__downloading__` 前缀）在应用重启后保留用于续传
- **分割/多部分模型**：按顺序逐部分下载，合并进度报告；续传时跳过已完成的 parts；中止/删除清理所有 parts
- HuggingFace 仓库树遍历是递归的（深度 3）以发现子目录中的分割模型
- 活动下载显示在 Models 页面上的持久条中，无论当前活动标签页是什么

## 服务器配置

### ServerConfig
核心类型化字段：模型路径、mmproj 路径、主机、端口、上下文大小、GPU 层数、线程数、flash attention 模式、KV 缓存类型、采样参数（temperature、top-k/p、min-p、seed）、批处理大小、内存标志（mlock、mmap）、RoPE 参数、并行槽数。

高级标签页（GUI）和 TUI params 涵盖扩展参数集，包括：MoE CPU 卸载（`cpu-moe`、`n-cpu-moe`）、权重重新打包（`no-repack`）、主机张量卸载（`no-op-offload`）、设备绕过（`no-host`）、内存自动适配（`--fit`、`--fit-margin`、`--fit-ctx`）、KV 统一缓冲（`kv-unified`）、N-gram 推测（`spec-ngram-size-n/m`、`spec-ngram-min-hits`）、查找缓存文件、draft 模型线程/设备参数、内置工具（`tools`）、embedding/classification 分隔符、WebUI 配置覆盖和 `reuse-port`。

所有附加的 llama-server 参数存储在 `extra_params: HashMap<String, String>` 中：
- 键是 CLI 标志名称，不带 `--` 前缀（如 "api-key"、"timeout"）
- 空值表示布尔标志（仅发出 `--flag`）
- 非空值发出 `--flag value`
- 特殊键 `__raw__` 保存按空格分割的自由形式 CLI 参数
- `mmproj` 键从 extra_params 中过滤（作为类型化字段处理）

### 标签页 UI（GUI）
参数组织为 6 个标签页：Context、Hardware、Sampling、Server、Chat、Advanced。Advanced 标签页包含 RoPE、推测解码、LoRA/控制向量、多模态、CPU 亲和性、日志记录的子部分，以及原始参数字段。

### TUI 表单
参数通过标签页面板内的内联文本输入进行编辑。导航使用 Tab/Shift+Tab 在字段之间移动。空格切换复选框。Server 标签页提供最常用参数的字段；高级参数可通过 `extra_params` HashMap 编辑器添加。

TUI Server 标签页跟踪 `current_preset` 名称（`Option<String>`）。选择模型时，`load_preset_for_model()` 从 `AppConfig.model_presets` 中查找模型的保存预设，若找到则加载该预设。否则，自动应用建议的硬件设置（n_ctx、n_gpu_layers），而不覆盖用户偏好。

### 预设
服务器配置保存为 `{data_dir}/catapult/presets/` 中的 JSON 文件。特殊的 `__default__` 预设存储用户自定义默认值。模型路径和 mmproj 路径从预设中排除（它们是会话特定的）。加载预设时保留当前模型选择。

**每个模型的预设记忆**：每个模型可以关联一个上次使用的预设。此关联存储在 `AppConfig.model_presets`（`HashMap<String, String>`，以模型文件路径为键）中。选择模型时自动加载其保存的预设。应用预设并启动服务器时，模型→预设关联被持久化。两个新的 Tauri 命令支持此功能：`get_model_preset` 和 `set_model_preset`。

**HuggingFace `presets.ini` 自动导入**：成功下载模型后，Catapult 从 HF 仓库获取 `presets.ini`（如果存在）并将其保存为命名预设（仓库 ID 中的 `/` 替换为 `__`）。解析文件获取采样参数：temperature、top-k/p、min-p、n-predict、seed、repeat-penalty、repeat-last-n。这由 `huggingface::fetch_presets_ini()` 和 `server::apply_hf_preset_params()` 处理。

### 会话持久化（仅 GUI）
服务器配置、活动预设和活动标签页在同一会话中的页面导航之间持久化到 `sessionStorage`。初始加载时，从 sessionStorage 恢复状态，并回退到保存的默认值。

TUI 不持久化会话状态；每次启动都从活动 Dashboard 标签页全新开始。

### 模型选择（GUI）
- 运行页面的模型列表可折叠（折叠时显示所选模型名称）
- 模型排序时收藏优先；视觉模型显示眼睛图标
- 选择模型时检查保存的预设（`get_model_preset`）；如果找到，则加载该预设而不是硬件建议。否则，自动应用建议的硬件设置（n_ctx、n_gpu_layers），而不覆盖用户偏好

### 模型选择（TUI）
- 通过可滚动列表中的箭头导航选择模型
- 收藏优先显示并带有 `★` 标记；视觉模型用 `V` 标记（青色）
- 选择模型立即更新服务器配置，并通过 `load_preset_for_model()` 自动加载模型的上次使用预设
- 无自动折叠；列表保持可见以供重新选择

## 服务器进程管理

`start_server` 以 `kill_on_drop(true)` 启动 `llama-server`。子进程存储在 `ServerState`（Mutex 后）中。Stdout/stderr 由独立的 tokio 任务读取（使用手动 `read_until` 循环），发出 `server_log` 事件并缓冲最多 500 行。完整命令行存储为第一个日志条目。

进程退出通过每 500ms 使用 `try_wait()` 的轮询任务监控。`stop_server` 发送 SIGTERM（Unix）或 TerminateProcess（Windows），等待最多 30 秒，然后在需要时用 SIGKILL 强制终止。

状态转换：`Stopped → Starting → Running`（通过输出中的 "HTTP server listening" 检测）或 `Starting → Error`（进程退出时）。崩溃时，错误消息（退出码、进程错误）持久化到日志缓冲区并作为日志事件发出，确保错误上下文在 UI 中可见。

GUI 前端通过 `requestAnimationFrame` 批处理传入的日志事件，每帧刷新累积的行，避免高频输出的性能问题。TUI 在其绘制循环中直接渲染日志，无批处理。

## 首次启动向导（仅 GUI）

`/wizard`（在侧边栏布局之外）的两步入门流程：
1. **系统与运行时** — 硬件检测摘要、运行时资产选择或自定义目录浏览、下载进度
2. **模型选择** — 按硬件适配度（VRAM/RAM）过滤和排序的推荐模型，最多可选 3 个，并行下载

由 AppConfig 中的 `wizard_completed` 控制。可随时跳过。可通过 `--force-wizard` CLI 标志或编程重置重新运行。

TUI 没有向导；所有功能在启动时立即通过标签页界面访问。

## 聊天

### GUI 聊天
Chat 页面将 llama.cpp 的内置 WebUI 嵌入 `<iframe>`，指向 `http://127.0.0.1:{port}`。"弹出"按钮在单独的 Tauri 窗口中打开。`tauri.conf.json` 中的 CSP 允许来自 `http://127.0.0.1:*` 和 `http://localhost:*` 的脚本、样式、连接和 WebSocket，以支持嵌入式 SvelteKit 应用。

### TUI 聊天
TUI Chat 标签页将 `llama-cli` 作为交互式子进程启动，使用当前选择的模型。TUI 挂起其界面（恢复正常终端模式），启动 CLI 聊天，并在用户退出（Ctrl-C 或 `/exit`）时恢复。这提供了终端原生的聊天体验，无需单独的 WebUI。

## 样式

### GUI 样式
- Tailwind CSS 搭配深色主题（通过 `tailwind.config.js` 自定义颜色）
- 处处使用锐利边框（矩形元素无 border-radius）
- 圆形元素（状态点、切换开关、单选按钮）保留 `rounded-full`
- 组件类：`.card`、`.btn-*`、`.input`、`.badge-*`、`.progress-bar`
- 量化徽章按精度使用颜色渐变：蓝色（F16/Q8/Q7）→ 青色（Q6）→ 绿色（Q5）→ 黄色（Q4）→ 橙色（Q3）→ 红色（Q2）→ 深红色（Q1）。MXFP 量化映射到等效的 Q 级别。
- 侧边栏中的自定义 catapult SVG 图标

### TUI 样式
- Ratatui 默认样式搭配自定义配色方案
- 通过边框高亮显示焦点指示器
- 使用 Unicode 块字符的下载进度条
- 用于确认和帮助文本的模态对话框

## 测试

- **Rust：** `cargo test` — #[cfg(test)] 模块中的 55 个单元测试，涵盖资产评分、后端检测、CLI 参数构建、量化提取、大小估计、文件名解析、GGUF 解析、硬件配置建议、分割文件解析、imatrix 检测、分割模型合并、`presets.ini` 解析、`apply_hf_preset_params`、预设名称派生和 `AppConfig.model_presets` 往返。TUI 模块通过底层库函数测试共享相同核心逻辑。
- **TypeScript：** `npm test`（Vitest）— 34 个工具函数测试，涵盖 CPU/GPU 名称缩短、大小格式化、量化颜色/排序映射、imatrix 检测和 MXFP 量化处理
- 测试捕获了一个真实 bug：`noavx` 后端检测因 `contains("avx")` 首先匹配而无法到达
