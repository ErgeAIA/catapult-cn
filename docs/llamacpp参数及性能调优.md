# llamacpp 参数及性能调优

> 更新日期：2026-08-30
>
> 本手册以 **llama-server manpage**（Debian unstable，llama.cpp-tools 1:0.2.0+dfsg1-1）的分组方式为骨架，
> 将《Catapult 完整参数配置指南》中的中文参数说明按 manpage 分组重组，并附性能调优要点。
>
> 英文原文参考（已保存到本地）：
>
> - [docs/reference/llama-server-manpage.md](reference/llama-server-manpage.md) — llama-server(1) 手册页英文原文
> - [docs/reference/performance-tuning.md](reference/performance-tuning.md) — llama.cpp 官方性能调优指南英文原文

llama-server 的全部命令行参数在 manpage 中按以下四组组织：

1. **common params** — 通用参数（线程、上下文、GPU、内存、模型加载、RoPE、LoRA、日志等）
2. **sampling params** — 采样参数（温度、Top-K/P、惩罚、DRY、Mirostat 等）
3. **speculative params** — 推测解码参数（草稿模型相关）
4. **example-specific params** — 服务器特定参数（网络、API、缓存、聊天、多模态、工具等）

下文按此分组重组中文说明；每个参数附 CLI 参数名、含义、默认值与推荐配置。

***

## 一、Common Params（通用参数）

### 1.1 基础

- **帮助 / 版本**：`-h, --help` 打印用法；`--version` 显示版本与构建信息。
- **缓存列表**：`-cl, --cache-list` 显示模型缓存列表。
- **Bash 补全**：`--completion-bash` 打印 bash 补全脚本。均为 CLI 辅助功能，界面内无需配置。

### 1.2 线程与 CPU 亲和性

**线程数**（`-t, --threads N`）

- 含义：生成阶段使用的 CPU 线程数（默认：CPU 核心数）。
- 官方建议：纯 CPU 推理用**物理核心数**；有 GPU 时 **4-8 线程**即可（线程过多反而变慢）；服务器并行场景每请求 **2-4 线程**。
- 推荐：**留空（自动）**。

**批次线程数**（`-tb, --threads-batch N`）

- 含义：批处理（提示处理 prefill）阶段的 CPU 线程数，默认与线程数相同。
- 官方建议：与自回归生成分离，提示处理线程可设更高以加速 prefill（例如线程 4 / 批次线程 8）。
- 推荐：留空。

**CPU 掩码**（`-C, --cpu-mask M`）：CPU 亲和性掩码（任意长的十六进制），与 cpu-range 互补。留空。

**CPU 范围**（`-Cr, --cpu-range lo-hi`）：CPU 亲和性范围，`lo-hi` 格式。留空。

**CPU 严格**（`--cpu-strict <0|1>`）：严格 CPU 绑定模式，默认 0（关闭）。推荐**关闭**。

**批次 CPU 掩码 / 范围 / 严格**（`-Cb, --cpu-mask-batch` / `-Crb, --cpu-range-batch` / `--cpu-strict-batch`）：批处理阶段对应配置，默认同非批次项。留空。

**优先级**（`--prio N`）：进程/线程优先级：Low（-1）/ Normal（0，默认）/ Medium（1）/ High（2）/ Realtime（3）。推荐 **Normal（0）**。

**轮询**（`--poll <0...100>`）：使用轮询级别等待工作完成，0 = 不轮询，默认 50。范围 0-100。推荐保持默认。

**批次优先级 / 批次轮询**（`--prio-batch` / `--poll-batch`）：批处理阶段对应项，默认同非批次项。

### 1.3 上下文与预测

**上下文大小**（`-c, --ctx-size N`）

- 含义：模型一次能"记住"的最大 token 数，0 = 从模型加载（默认）。token 约等于 0.75 个中文汉字。
- 建议：Qwen3.6-35B-A3B 原生支持 131072。**中档推荐 32768**（≈24000 汉字）；8GB 显存 16384；6GB 8192。
- 性能提示：上下文大小直接影响显存占用、推理速度与最大对话长度，只开启必要的大小。

**最大令牌数**（`-n, --predict, --n-predict N`）：单次生成的最大 token 数，-1 = 无限（默认）。推荐 **-1**，让客户端自行控制。

**批次大小**（`-b, --batch-size N`）

- 含义：逻辑最大批次大小（提示处理并行度），默认 2048。越大提示处理越快、越耗显存。
- 官方建议：CPU/GPU 场景 512-2048，服务器并行场景见"性能调优"章（须满足 `batch-size ≥ ctx-size × 并行槽数`）。

**微批次大小**（`-ub, --ubatch-size N`）：物理最大批次大小，默认 512。影响单次推理显存峰值，保持默认。

**保留令牌**（`--keep N`）：保留初始提示前 N 个 token，0 = 不保留，-1 = 全部保留，默认 0。保持默认。

### 1.4 注意力与 KV 缓存

**Flash Attention**（`-fa, --flash-attn [on|off|auto]`）

- 含义：加速注意力计算的算法，降低显存占用与推理延迟。
- 默认：`auto`（有益时才启用）。部分旧 GPU 不支持，RTX 30/40/50 系列完全兼容。
- 推荐：显式 **on**，自动模式在某些场景下可能不启用。

**KV 缓存类型 (K) / (V)**（`-ctk, --cache-type-k TYPE` / `-ctv, --cache-type-v TYPE`）

- 含义：Key / Value 缓存精度。KV Cache 占用大量显存。
- 选项：`f32`、`f16`（默认）、`bf16`、`q8_0`、`q4_0`、`q4_1`、`iq4_nl`、`q5_0`、`q5_1`。
- 注意：Qwen3.5 系列在 f16 KV Cache 下准确率会下降（社区报告）。推荐 **q8\_0**（质量无明显损失、节省约 50% KV 显存）；24GB 高端可 bf16。

**KV 卸载**（`-kvo, --kv-offload, -nkvo, --no-kv-offload`）：是否将 KV Cache 卸载到 GPU，默认开启。保持**开启**，关闭后走系统内存、速度大幅下降。

**SWA 完整**（`--swa-full`）：使用全尺寸滑动窗口注意力缓存，默认 false。部分模型（Gemma、Mistral）原生使用滑动窗口。除非明确需要，保持**关闭**。

**权重重打包**（`--repack, -nr, --no-repack`）：启用权重重新打包优化内存布局，默认开启。保持**开启**。

**无主机缓冲区**（`--no-host`）：绕过主机缓冲区申请额外设备显存。默认关闭，开启可能提升性能但可能带来兼容性问题。推荐**关闭**。

### 1.5 模型加载与内存管理

> 新版统一由 **加载模式（`--load-mode`）** 管理模型加载，旧的 mlock / mmap / direct-io 均标记为 DEPRECATED。

**加载模式**（`-lm, --load-mode MODE`）：默认 `auto`。选项：`auto`（自动 mmap，除非设备不支持）/ `none` / `mmap` / `mlock`（锁定到物理内存防交换）/ `mmap+mlock` / `dio`（DirectIO）。推荐保持 **auto**。

**mlock**（`--mlock`，DEPRECATED）：将模型权重锁定在物理内存，防交换导致延迟抖动。系统内存 32GB+ 可开启，16GB 建议关闭。

**内存映射**（`--mmap, --no-mmap`，DEPRECATED）：内存映射加载模型，默认开启。开启后加载更快、可按需分页。

**直接 IO**（`-dio, --direct-io`，DEPRECATED）：绕过文件系统缓存直接读盘。桌面平台通常不需要，推荐关闭。

**NUMA**（`--numa TYPE`）：非统一内存访问优化，用于多路 CPU。类型：distribute / isolate / numactl。消费级桌面不需要，推荐**禁用**。

### 1.6 GPU 卸载与多 GPU

**GPU 层**（`-ngl, --gpu-layers, --n-gpu-layers N`）

- 含义：卸载到 VRAM 的层数，可选具体数字、`auto`（默认，自动）、`all`（-1 = 全部上 GPU）、0 = 纯 CPU。
- 推荐：\*\*-1（all）\*\*并配合"适配"，Catapult 自动管理；纯 CPU 推理设 0。
- 性能提示：显存不足时 llama.cpp 会自动在 GPU/CPU 间分载（混合推理）。

**适配**（`-fit, --fit [on|off]`）：自动调整未设置的参数以适配显存，默认 `on`。超出显存时自动把部分层卸载到系统内存。推荐**开启**。注意：`--fit` 的大模型可能把部分层放到 CPU，影响性能。

**适配目标**（`-fitt, --fit-target MiB0,...`）：每张 GPU 保留的显存余量，默认 1024 MiB。显存紧张可调低（如 256-512）。

**适配最小上下文**（`-fitc, --fit-ctx N`）：适配模式允许设定的最小上下文，默认 4096。保持默认。

**设备**（`-dev, --device <dev1,dev2,..>`）：指定卸载设备列表（逗号分隔），none = 不卸载。单卡留空。

**分割模式**（`-sm, --split-mode {none,layer,row,tensor}`）：多 GPU 分割策略：none / layer（默认，按层流水线）/ row（按行并行）/ tensor（按张量，试验性）。单卡保持 **layer**。

**张量分割**（`-ts, --tensor-split N0,N1,...`）：多 GPU 分载比例，如 `3,1`。单卡留空。

**主 GPU**（`-mg, --main-gpu INDEX`）：主 GPU 索引，默认 0。单卡留空。

### 1.7 MoE 与覆盖

**CPU MoE**（`-cmoe, --cpu-moe`）：将全部 MoE 专家权重强制留在 CPU（MoE 模型专家层占参数量大头）。6-8GB 显存建议**开启**（牺牲速度保稳定），12GB 以上关闭让 Fit 自动管理。

**N 个 CPU MoE 层**（`-ncmoe, --n-cpu-moe N`）：指定前 N 层 MoE 权重留 CPU，优先级高于 CPU MoE 总开关。留空。

**检查张量**（`--check-tensors`）：加载时校验张量数据完整性，默认 false。首次加载新模型可临时开启，之后关闭节省启动时间。

**覆盖张量**（`-ot, --override-tensor <pattern>=<buffer type>,...`）：覆盖指定张量的分配，如 `attn_v=cuda0`。调试用，留空。

**覆盖 KV**（`--override-kv KEY=TYPE:VALUE,...`）：覆盖模型元数据键值，如 `tokenizer.ggml.add_bos_token=bool:false`。调试用，留空。

**算子卸载**（`--op-offload, --no-op-offload`）：将主机张量操作（reshape/permute）卸载到设备，默认 true。保持**开启**。

### 1.8 RoPE / YaRN（旋转位置编码）

- **RoPE 缩放**（`--rope-scaling {none,linear,yarn}`）：默认 linear（除非模型指定）。Qwen3.6 原生支持长上下文，不需要手动缩放，推荐**默认**。
- **RoPE 缩放因子**（`--rope-scale N`）：按 N 倍扩展上下文，留空（=1.0）。
- **RoPE 频率基数**（`--rope-freq-base N`）：默认从模型加载，留空。
- **RoPE 频率缩放**（`--rope-freq-scale N`）：按 1/N 倍扩展上下文，留空。
- **YaRN 原始上下文**（`--yarn-orig-ctx N`）：YaRN 原始上下文长度，0 = 模型训练长度，留空。
- **YaRN 扩展因子**（`--yarn-ext-factor N`）：默认 -1.00，0.0 = 完全内插，留空。
- **YaRN 注意力因子**（`--yarn-attn-factor N`）：默认 -1.00，留空。
- **YaRN Beta 慢 / Beta 快**（`--yarn-beta-slow N` / `--yarn-beta-fast N`）：默认 -1.00，留空。

### 1.9 LoRA 与控制向量

- **LoRA**（`--lora FNAME`）：LoRA 适配器路径，逗号分隔多个。留空；有微调权重时挂载。
- **LoRA 缩放**（`--lora-scaled FNAME:SCALE,...`）：带缩放的 LoRA。留空。
- **LoRA 初始化不应用**（`--lora-init-without-apply`）：加载但不立即应用，稍后通过 API 动态切换，默认关闭。
- **控制向量**（`--control-vector FNAME`）：控制向量路径（行为控制，如情感调节）。
- **控制向量缩放**（`--control-vector-scaled FNAME:SCALE,...`）：带缩放的控制向量。
- **控制向量层范围**（`--control-vector-layer-range START END`）：应用控制向量的层段（起止包含）。
- 推荐：全部留空。

### 1.10 模型来源

- **模型路径**（`-m, --model FNAME`）：模型文件路径，由 Catapult 模型管理填充。
- **模型下载 URL**（`-mu, --model-url URL`）：模型下载地址，默认 unused。
- **Docker 仓库**（`-dr, --docker-repo [<repo>/]<model>[:quant]`）：从 Docker Hub 拉取模型。
- **HuggingFace 仓库**（`-hf, --hf-repo <user>/<model>[:quant]`）：从 HF 仓库加载，quant 默认 Q4\_K\_M，自动下载 mmproj。
- **HF 文件 / HF 令牌**（`-hff, --hf-file` / `-hft, --hf-token`）：覆盖 quant / HF 访问令牌。
- 推荐：界面内通过模型管理操作即可，无需手填。

### 1.11 日志

**日志文件**（`--log-file FNAME`）：日志输出文件路径，留空输出到控制台。可设为 `catapult.log`。

**日志颜色**（`--log-colors [on|off|auto]`）：默认 auto（终端输出时启用颜色）。推荐 **Auto**。

**详细程度**（`-lv, --verbosity, --log-verbosity N`）：日志阈值，高于该级别的消息被忽略。级别：0 = generic / 1 = error / 2 = warning / 3 = info（默认）/ 4 = trace / 5 = debug。推荐 **3 - Info**；排查问题临时切 5。

**详细**（`-v, --verbose, --log-verbose`）：把详细程度设为无穷大（输出全部日志），用于调试。日常关闭。

**日志前缀 / 日志时间戳**（`--log-prefix` / `--log-timestamps`）：日志消息加前缀 / 时间戳，推荐开启。

**离线模式**（`--offline`）：强制使用缓存、阻止网络访问。默认关闭，保持关闭。

**日志提示词目录**（`--log-prompts-dir PATH`）：把每次请求的提示词写入目录（自动创建），仅调试用。留空。

**性能计时**（`--perf, --no-perf`）：启用内部性能计时（默认 false）。推荐**开启**，方便监控推理速度。

**性能分析**（`--profile`）：启用后端性能分析（CPU、BLAS、CUDA），用于性能调优。推荐**关闭**，排查性能问题时临时开启。

**分析输出**（`--profile-output FNAME`）：将性能分析结果以 JSON 格式写入文件（默认输出到 stdout）。留空。

***

## 二、Sampling Params（采样参数）

采样参数控制生成的"创造力"与随机性。

### 2.1 基础

**温度**（`--temp, --temperature N`）

- 含义：值越高越随机、有创意；越低越确定、保守。默认 0.80。
- 推荐（思考模式）：**0.60**（Qwen 官方推荐）；日常聊天 0.7-0.8；纯编码 0.3-0.4。

**随机种子**（`-s, --seed SEED`）：RNG 种子，-1 = 随机（默认）。设固定值可复现输出。推荐 **-1**。

**采样器链**（`--samplers SAMPLERS`）：采样器执行顺序，分号分隔。默认 `penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature`。推荐保持默认（llama.cpp 优化过的顺序）。

### 2.2 Top-K / Top-P / Min-P

**Top-K**（`--top-k N`）：只从概率最高的 K 个 token 中采样，默认 40，0 = 禁用。推荐 **40**；编码任务可降至 20-30。

**Top-P**（`--top-p N`）：核采样累积概率阈值，默认 0.95，1.0 = 禁用。推荐 **0.95**（Qwen 官方推荐）。

**Min-P**（`--min-p N`）：相对最高概率 token 的最低概率阈值，默认 0.05，0.0 = 禁用。推荐 **0.05**。自动过滤低概率"垃圾"token。

**Top-N-Sigma**（`--top-n-sigma N`）：基于标准差的动态 Top-K，默认 -1.00（禁用）。推荐 **-1（禁用）**。

**Typical P**（`--typical-p N`）：局部典型采样，默认 1.00（禁用）。与 Top-P/Min-P 重叠，推荐**禁用**。

### 2.3 惩罚

- **重复最后 N**（`--repeat-last-n N`）：在最后 N 个 token 内检测重复并惩罚，默认 64，0 = 禁用。推荐 **0（禁用）**，交给客户端；模型严重重复时可设 512-1024。
- **重复惩罚**（`--repeat-penalty N`）：重复 token 惩罚系数，默认 1.00（禁用）。推荐**禁用**，客户端自行控制。
- **存在惩罚**（`--presence-penalty N`）：对已出现 token 施加固定惩罚，默认 0.00（禁用）。推荐**禁用**。
- **频率惩罚**（`--frequency-penalty N`）：按出现次数追加惩罚，默认 0.00（禁用）。推荐**禁用**。

### 2.4 XTC（排他性 Top-p 链）

- **XTC 概率**（`--xtc-probability N`）：XTC 采样概率，默认 0.00（禁用）。实验性采样器，社区反馈不一，推荐**禁用**。
- **XTC 阈值**（`--xtc-threshold N`）：默认 0.10，1.0 = 禁用。仅启用 XTC 时有用。

### 2.5 DRY 采样（重复抑制采样）

- **DRY 倍数**（`--dry-multiplier N`）：默认 0.00（禁用）。
- **DRY 基数**（`--dry-base N`）：默认 1.75。
- **DRY 允许长度**（`--dry-allowed-length N`）：允许的重复行最大长度，默认 2。
- **DRY 惩罚最后 N**（`--dry-penalty-last-n N`）：默认 64，0 = 禁用。
- **DRY 序列打断符**（`--dry-sequence-breaker STRING`）：追加序列打断符，会清空默认打断符（`\n`、`:`、`"`、`*`）。
- 推荐：全部保持默认（禁用）。

### 2.6 自适应采样（Adaptive-p）

- **自适应目标**（`--adaptive-target N`）：目标概率（有效范围 0.0\~1.0），**负数 = 禁用**，默认 -1.00。推荐**禁用**。
- **自适应衰减**（`--adaptive-decay N`）：目标概率随时间衰减率，值越低越灵敏、越高越稳定（0.0\~0.99），默认 0.90。

### 2.7 动态温度

- **范围**（`--dynatemp-range N`）：温度动态波动范围，默认 0.00（禁用）。推荐**禁用**。
- **指数**（`--dynatemp-exp N`）：动态温度指数，默认 1.00。

### 2.8 Mirostat

- **模式**（`--mirostat N`）：0 = 禁用（默认），1 = Mirostat，2 = Mirostat 2.0。与 Min-P/Top-P 思路不同，同时启用可能相互干扰，推荐**禁用**。
- **目标熵**（`--mirostat-ent N`）：目标熵 tau，默认 5.00。
- **学习率**（`--mirostat-lr N`）：学习率 eta，默认 0.10。

### 2.9 其他

**忽略 EOS**（`--ignore-eos`）：忽略结束符持续生成（隐含 `--logit-bias EOS-inf`）。推荐**关闭**。

**后端采样**（`-bs, --backend-sampling`）：使用后端采样实现（GPU 采样内核），实验性，默认禁用。推荐**关闭**。

**Token 偏差**（`-l, --logit-bias TOKEN_ID(+/-)BIAS`）：调整指定 token 的出现概率，如 `--logit-bias 15043+1`。留空。

**语法约束**（`--grammar GRAMMAR` / `--grammar-file FNAME`）：BNF 语法约束生成。留空。

**JSON Schema 约束**（`-j, --json-schema SCHEMA` / `-jf, --json-schema-file FILE`）：按 JSON Schema 约束输出（外部 \$ref 用 --grammar）。留空。

***

## 三、Speculative Params（推测解码参数）

推测解码：用更小更快的"草稿模型"先快速生成候选 token，再由大模型验证，可显著加速（尤其 MoE 模型）。

**草稿模型**（`--spec-draft-model, -md, --model-draft FNAME`）：草稿模型 GGUF 路径，默认 unused。推荐**留空（禁用）**，35B MoE 推理速度已不错。

**推测类型**（`--spec-type`）：未提供草稿模型时的策略：`none`（默认）/ `draft-simple` / `draft-eagle3` / `draft-mtp` / `draft-dflash` / `draft-dspark` / `ngram-simple` / `ngram-map-k` / `ngram-map-k4v` / `ngram-mod` / `ngram-cache`。推荐 **none**。

**草稿最大**（`--spec-draft-n-max N`）：最大草稿 token 数，默认 3。

**草稿最小**（`--spec-draft-n-min N`）：最小草稿 token 数，默认 0。

**草稿 P 分割**（`--spec-draft-p-split P`）：推测解码分割概率，默认 0.10。

**草稿 P 最小**（`--spec-draft-p-min P`）：贪婪解码最小接受概率，默认 0.00。

**草稿上下文大小**：（UI 概念，无 CLI 参数；manpage 与 b10688 `--help` 均无 `--spec-draft-ctx-size`，草稿与主模型共享 `-c, --ctx-size N`）：草稿模型上下文大小，0 = 来自模型。

**草稿 GPU 层**（`--spec-draft-ngl, -ngld, --gpu-layers-draft N`）：草稿模型卸载到 VRAM 的层数，默认 auto。

**草稿线程 / 草稿批处理线程**（`--spec-draft-threads, -td` / `--spec-draft-threads-batch, -tbd`）：草稿模型 CPU 线程数，默认同主模型。

**草稿 KV 缓存类型**（`--spec-draft-type-k, -ctkd` / `--spec-draft-type-v, -ctvd`）：草稿模型 KV Cache 精度，默认 f16。

**草稿 CPU MoE**（`--spec-draft-cpu-moe` / `--spec-draft-n-cpu-moe, -ncmoed`）：草稿模型 MoE 权重留 CPU 策略，默认关闭。

**草稿设备**（`--spec-draft-device, -devd`）：草稿模型卸载设备列表。

**草稿覆盖张量**（`--spec-draft-override-tensor, -otd, --override-tensor-draft <pattern>=<buffer type>,...`）：覆盖草稿模型指定张量的设备分配，如 `attn_v=cuda0`。调试用，留空。

**草稿 CPU 亲和性**（`--spec-draft-cpu-mask` / `--spec-draft-cpu-range` / `--spec-draft-cpu-strict` / `--spec-draft-prio` / `--spec-draft-poll` 及 batch 变体）：草稿模型亲和性配置，默认同主模型。

**草稿 HF 仓库**（`--spec-draft-hf, -hfd, --hf-repo-draft`）：草稿模型 HF 仓库来源。

**ngram 推测参数**（`--spec-ngram-mod-n-min` / `-max` / `-match`、`--spec-ngram-simple-*`、`--spec-ngram-map-k-*`、`--spec-ngram-map-k4v-*`）：ngram 类推测解码的查找长度与最小命中数，默认见 manpage。

**已移除参数**：`--draft/--draft-max`、`--draft-min`、`--spec-ngram-size-n/-m`、`--spec-ngram-min-hits` 均已移除，改用上述 `--spec-*` 形参。

推荐：以上全部保持默认（未使用草稿模型）。

***

## 四、Example-Specific Params（llama-server 服务器参数）

### 4.1 网络

**主机地址**（`--host HOST`）：监听 IP，默认 127.0.0.1。`0.0.0.0` = 局域网/远程可访问。推荐 **127.0.0.1**（仅本地）。

**端口**（`--port PORT`）：监听端口，默认 8080。推荐 **8001**（占用时可换）。

**并行槽**（`-np, --parallel N`）：并行请求槽位数，-1 = 自动（默认）。推荐 **1**（本地单用户）；多用户 2-4。注意：并行槽越多，KV 显存与批大小要求越高。

**HTTP 线程**（`--threads-http N`）：HTTP 请求处理线程数，默认 -1。保持自动。

**超时**（`-to, --timeout N`）：服务器读写超时（秒），默认 3600。长上下文生成可保持默认或 1800-3600。

**SSE 心跳间隔**（`--sse-ping-interval N`）：SSE 心跳包间隔（秒），-1 = 禁用，默认 30。

**端口复用**（`--reuse-port`）：允许同一端口多 socket 绑定，默认禁用。本地不需要，保持关闭。

**空闲休眠**（`--sleep-idle-seconds SECONDS`）：空闲 N 秒后自动休眠，-1 = 禁用（默认）。本地不需要，保持 -1。

### 4.2 API 与认证

**API 密钥**（`--api-key KEY`）：访问 API 所需密钥，逗号分隔多个，默认 none。推荐自定义密码。

**API 密钥文件**（`--api-key-file FNAME`）：含密钥的文件路径（每行一个，`#` 开头为注释）。留空。

**别名**（`-a, --alias STRING`）：API 模型名称别名（兼容 OpenAI 格式）。可设为自定义名称。

**标签**（`--tags STRING`）：模型标签（仅信息性，不参与路由）。留空。

**API 前缀**（`--api-prefix PREFIX`）：服务器提供 API 的前缀路径（不带尾部斜杠）。留空。

### 4.3 CORS

- **CORS 来源**（`--cors-origins ORIGINS`）：允许的来源，逗号分隔，默认 `*`；特殊值 `localhost` 表示仅在来源为 localhost 时回显 Origin。
- **CORS 方法**（`--cors-methods METHODS`）：允许的方法，默认 `GET, POST, DELETE, OPTIONS`。
- **CORS 头**（`--cors-headers HEADERS`）：允许的请求头，默认 `*`。
- **CORS 凭据**（`--cors-credentials`）：允许携带凭据，默认开启（注意：与 `*` 来源组合时会回显 Origin）。
- 推荐：本地使用保持默认；浏览器前端跨域调用时按需调整。

### 4.4 缓存与槽位

**缓存提示**（`--cache-prompt, --no-cache-prompt`）：启用提示缓存（默认启用）。保持**开启**，可大幅加速连续交互。

**缓存重用最小块**（`--cache-reuse N`）：通过 KV 移位复用缓存的最小块大小，需启用提示缓存，默认 0。高级用户可设 8-32 优化多轮对话。

**上下文移位**（`--context-shift, --no-context-shift`）：无限文本生成时是否启用上下文偏移，默认禁用。保持默认（客户端自行管理上下文）。

**缓存 RAM（MiB）**（`-cram, --cache-ram N`）：KV Cache 最大系统内存，默认 8192，-1 = 无限制，0 = 禁用。推荐保持 8192 或按内存上调。

**缓存空闲槽**（`--cache-idle-slots`）：新任务时保存并清除空闲槽 KV Cache（默认开启，需开启缓存 RAM 与 KV 统一）。保持**开启**。

**KV 统一**（`-kvu, --kv-unified`）：跨所有序列共享统一 KV 缓冲区（默认槽数自动时启用），减少显存碎片。推荐**开启**。

**槽位提示相似度**（`-sps, --slot-prompt-similarity SIMILARITY`）：槽位复用的最小提示匹配度，默认 0.10，0 = 禁用。保持默认。

**上下文检查点**（`-ctxcp, --ctx-checkpoints N`）：每槽最大上下文检查点数，默认 32。保持默认。

**检查点间隔**（`-cms, --checkpoint-min-step N`）：检查点最小间隔 token 数，默认 8192，0 = 无最小。保持默认。

### 4.5 功能开关

**连续批处理**（`-cb, --cont-batching`）：动态批处理提高吞吐，默认开启。推荐**开启**（显存紧张的小显存场景可关闭）。

**WebUI**（`--ui, --webui`）：内置 Web 聊天界面，默认开启。推荐**开启**（临时测试方便）。

**WebUI MCP 代理**（`--ui-mcp-proxy`）：实验性 MCP CORS 代理，默认禁用。**不要**在不可信环境开启。

**指标**（`--metrics`）：Prometheus 兼容指标端点，默认禁用。按需开启。

**属性**（`--props`）：允许通过 POST `/props` 修改全局属性，默认禁用。保持关闭。

**槽端点**（`--slots`）：暴露槽位监控端点，默认开启。保持开启。

**嵌入**（`--embedding`）：仅嵌入模式（限专用嵌入模型），默认禁用。仅纯嵌入服务时开启。

**重排序**（`--rerank`）：启用重排序端点，默认禁用。保持关闭。

**预热**（`--warmup`）：空跑热身，默认开启。需最短首请求延迟时开启；否则可关闭缩短启动时间。

**反向提示**（`-r, --reverse-prompt PROMPT`）：遇到 PROMPT 时停止生成（交互模式）。留空。

**特殊令牌**（`-sp, --special`）：输出特殊 token，默认 false。保持关闭。

**SPM 填充**（`--spm-infill`）：Suffix/Prefix/Middle 填充模式（部分模型更偏好），默认禁用。仅代码补全场景需要。

**转义序列**（`-e, --escape`）：处理转义序列（`\n` 等），默认 true。推荐**开启**。

### 4.6 工具 / Agent / MCP（实验性）

- **内置工具**（`--tools TOOL1,TOOL2,...`）：`read_file`、`file_glob_search`、`grep_search`、`exec_shell_command`、`write_file`、`edit_file`、`get_info`，可指定 `all`。默认无工具。
- **工具运行时**（`--tools-runtime OPTION`）：`docker:<镜像>` / `podman:<镜像>` / `docker-container:<id>` / `podman-container:<id>` / `ssh:<目标>`，默认使用宿主环境。
- **Agent 模式**（`-ag, --agent`）：一键开启 CORS 代理 + 全部内置工具，默认禁用。
- **MCP 服务器配置**（`--mcp-servers-config PATH`）：Cursor 兼容格式的 MCP 服务器 JSON 文件。
- **MCP 服务器内联 JSON**（`--mcp-servers-json JSON`）：内联 MCP 服务器定义。
- 安全注意：全部默认关闭。启用后为安全考虑会把 CORS 来源限制为 localhost，**切勿在不可信环境开启**。

### 4.7 路由模式（Router，多模型）

- **模型目录**（`--models-dir PATH`）：Router 模式的模型目录，默认禁用。
- **模型预设文件**（`--models-preset PATH`）：INI 格式模型预设路径，默认禁用。
- **最大同时加载模型数**（`--models-max N`）：默认 4，0 = 不限。
- **自动加载模型**（`--models-autoload`）：按需自动加载，默认开启。
- 推荐：单模型用户全部留空 / 关闭。

### 4.8 SSL 与存储

- **SSL 密钥 / 证书文件**（`--ssl-key-file FNAME` / `--ssl-cert-file FNAME`）：HTTPS 配置，本地使用留空。
- **静态文件路径**（`--path PATH`）：静态文件服务路径，留空。
- **槽位保存路径**（`--slot-save-path PATH`）：槽位 KV 缓存持久化路径，默认禁用，留空。
- **媒体路径**（`--media-path PATH`）：本地媒体文件目录（经 file:// URL 访问），默认禁用，留空。
- **WebUI 配置 (JSON)**（`--ui-config JSON`）：覆盖 WebUI 默认设置的 JSON 字符串。
- **WebUI 配置文件**（`--ui-config-file PATH`）：JSON 配置文件路径。

### 4.9 聊天模板与推理

**模板**（`--chat-template JINJA_TEMPLATE`）：Jinja 聊天模板名或内联模板（默认取模型元数据）。支援数十种内置模板。推荐**留空**（自动从 GGUF 读取）。

**模板文件**（`--chat-template-file PATH`）：Jinja 模板文件路径。留空。

**模板参数**（`--chat-template-kwargs STRING`）：模板额外参数 JSON，如 `{"key1":"value1"}`。留空。

**Jinja**（`--jinja`）：使用 Jinja 模板引擎（默认开启）。保持**开启**。

**预填充助手**（`--prefill-assistant`）：最后一条消息为助手消息时预填充其回复（默认开启）。保持**开启**。

**跳过聊天解析**（`--skip-chat-parsing`）：强制纯内容解析器（不提取推理/工具调用），默认禁用。纯聊天用户可开启。

**推理**（`-rea, --reasoning [on|off|auto]`）：是否启用思考模式，默认 auto（从模板检测）。推荐 **Auto**。

**推理格式**（`--reasoning-format FORMAT`）：思考内容返回格式：none（留在 content）/ deepseek（放入 `reasoning_content`）/ deepseek-legacy（保留标签同时填充）。默认 auto。

**推理预算**（`--reasoning-budget N`）：思考 token 预算，-1 = 无限制（默认），0 = 立即结束。默认 -1。

**推理努力**（`--reasoning-effort LEVEL`）：思考深度等级：default / minimal / low / medium / high / xhigh / max。默认 default。

**预算消息**（`--reasoning-budget-message MESSAGE`）：预算耗尽时注入的消息。留空。

**保留推理轨迹**（`--reasoning-preserve`）：把推理轨迹保留在完整历史中（默认由模板能力决定）。保持默认。

### 4.10 多模态

**mmproj 路径**（`-mm, --mmproj FILE`）：多模态投影仪文件路径（将图片编码为向量）。视觉模型（如 Qwen3.6-35B-A3B）需配套 `mmproj-F16.gguf`；Catapult 自动检测配对，通常无需手填。

**mmproj URL**（`-mmu, --mmproj-url URL`）：投影仪文件下载 URL。

**mmproj 自动**（`--mmproj-auto`）：可用时自动使用投影仪（默认开启）。保持**开启**。

**mmproj 卸载**（`--mmproj-offload`）：投影仪 GPU 卸载（默认开启）。保持**开启**。

**mmproj 设备**（`-mmdev, --mmproj-device DEVICE`）：投影仪所在设备，默认 auto。

**图片最小 / 最大令牌**（`--image-min-tokens N` / `--image-max-tokens N`）：单图最少/最多 token 数（仅动态分辨率视觉模型），默认从模型读取。留空（用模型默认）。注意：Qwen-VL 系接地任务至少需 1024 图像 token。

**图片批最大令牌**（`--mtmd-batch-max-tokens N`）：批量编码图片时单批最大 token 数，默认 1024。

### 4.11 嵌入与池化

**嵌入池化类型**（`--pooling {none,mean,cls,last,rank}`）：嵌入池化方式，不指定用模型默认。rank 供重排序模型。推荐**模型默认**。

**嵌入归一化**（`--embd-normalize N`）：嵌入向量归一化，默认 2（欧几里得），-1 = 不归一化。保持默认。

### 4.12 查找缓存

**查找缓存（静态）**（`-lcs, --lookup-cache-static FNAME`）：静态查找缓存路径（生成时不更新）。留空。

**查找缓存（动态）**（`-lcd, --lookup-cache-dynamic FNAME`）：动态查找缓存路径（随生成更新）。留空。

***

## 五、性能调优要点（Performance Tuning）

> 摘自官方性能调优指南（[performance-tuning.md](reference/performance-tuning.md)）。线程错误是推理变慢的第一大原因。

### 5.1 快速见效

- **用 GPU**：`--n-gpu-layers` 卸载层到 GPU（可设极大数如 200000 自动全部卸载）。
- **优化线程**：`--threads` 设为物理核心数。
- **量化选择**：Q4\_K\_M / Q5\_K\_M 是速度/质量最佳平衡。
- **调整上下文**：`--ctx-size` 只开到必要大小。

### 5.2 线程配置

- **CPU-only**：物理核心数（非超线程数）。
- **有 GPU**：4-8 线程（无关核心总数）。
- **服务器并行**：每请求 2-4 线程。
- 验证工具：Linux `lscpu` / macOS `sysctl -n hw.physicalcpu` / Windows `wmic cpu get NumberOfCores`。
- 批次线程：提示处理与生成分离，`--threads-batch` 可高于 `--threads`（如 4 / 8）。
- 实测（A6000 + 30B Q4\_0）：GPU+4 线程 9.1 tok/s，GPU+7 线程反而降到 8.7 —— **线程过多会变慢**。

### 5.3 上下文与批次

- 上下文：512（最快）/ 2048（平衡）/ 8192+（大上下文）——大多数任务 2048 足够。
- 逻辑批次（`--batch-size`）：提示处理并行度；CPU/GPU 512-2048。
- 物理批次（`--ubatch-size`）：硬件限制，默认 512。
- **服务器并行时须满足** **`batch-size ≥ ctx-size × 并行槽数`**，否则连续批处理中后续请求会等待。

### 5.4 Flash Attention

- 默认 `auto`（有益时启用）；显式 `--flash-attn on` 更可靠。
- 大模型开 Flash Attention 可显著降低显存占用与延迟。

### 5.5 量化选择表

| 量化       | 速度 | 质量 | 场景       |
| -------- | -- | -- | -------- |
| Q2\_K    | 最快 | 最低 | 试验       |
| Q3\_K\_M | 很快 | 低  | 资源受限     |
| Q4\_K\_M | 快  | 好  | **推荐默认** |
| Q5\_K\_M | 中等 | 很好 | 质量优先     |
| Q6\_K    | 较慢 | 优秀 | 接近原版     |
| Q8\_0    | 最慢 | 最高 | 参考/评测    |

### 5.6 显存不足（混合推理）

- 模型大于 VRAM 时启用 `--n-gpu-layers` 指定层数 + `--threads 4`，llama.cpp 自动分载 GPU/CPU。
- OOM 解决：换小量化、`--ctx-size` 调小、`--batch-size` 调小、少卸载层、开 mmap。
- 实测基准：GPU only（错误线程）<0.1 tok/s；CPU only 1.7；GPU+1 线程 5.5；GPU+4 线程 **9.1**。

### 5.7 服务器调优

- `--n-parallel`：2-8 个槽；`--threads` 每请求 2-4；`--batch-size` 足够大（见 5.3）。
- 连续批处理（`--cont-batching`）默认开启，多请求场景保持开启。
- 监控：`POST /metrics`（Prometheus）或 `curl http://127.0.0.1:8080/metrics`；`--perf` 看吞吐。
- 基准工具：`llama-bench -m model.gguf --n-prompt 512 --n-gen 128 -ngl 32 -t 4,8,16`。

### 5.8 高级优化

- CPU 亲和性：`--cpu-mask 0xFF --cpu-strict 1`。
- 进程优先级：`--prio 2`（级别 -1/0/1/2/3）。
- 轮询降延迟：`--poll 100`（0-100，100 = 全忙等）。
- 平台模板：NVIDIA `-ngl 999 --threads 4 --batch-size 512 --flash-attn`；Apple/AMD 同款；CPU-only `--threads <物理核> --batch-size 512 --mlock`。

***

## 六、参数设置原则总结

**1. GPU Layers 永远用 -1**
`-1 + --fit on` 组合让 Catapult 自动计算最佳分配策略。

**2. CPU MOE 是显存不足时的救命稻草**
6-8GB 显存必须开启，12GB 以上建议关闭。把占大头的专家层留在 CPU，GPU 只跑 attention。

**3. KV Cache 精度 = 显存余额的风向标**
24GB 用 bf16，12-16GB 用 q8\_0。**不要用 f16**（Qwen3.5 系列 f16 KV Cache 有已知准确率问题）。

**4. Context Size 由 KV Cache 显存决定**
Q4\_K\_M + q8\_0 KV 下每 8K 上下文约消耗 0.8-1.2GB 显存，估算后下调 25% 留余量。

**5. mlock 在系统内存充足时开启**
32GB+ 可开，16GB 建议关闭防内存压力。

**6. Sampling 参数优先官方推荐**
0.60 温度 + 0.95 Top-P + 0.05 Min-P + 40 Top-K 是最稳定起点。

**7. 量化优先 Q4\_K\_M / Q5\_K\_M**
官方认为这是速度/质量最佳平衡点；Q6\_K 接近原版、Q8\_0 仅参考。

**8. 线程数按场景设置，不是越多越好**
纯 CPU = 物理核心数；有 GPU = 4-8 线程；服务器并行 = 每请求 2-4 线程。

**9. 服务器并行时 batch-size 要足够大**
满足 `batch-size ≥ ctx-size × 并行槽数`，否则连续批处理后续请求会等待。

***

## 七、档位预设速查表（配置覆盖值）

> 以《常用高级页参数》中的**档位预设（最新版）为准，面向 Qwen3.6-35B-A3B（UD-Q4\_K\_M 量化，约 20-22GB）**。
> 仅列出随档位变化的覆盖参数；未列出的参数在全部档位一致，作为全局默认值使用（各参数默认值见第八章）。

### 7.1 档位预设速看表

| 字段                  | D1 (6GB) | D2 (8GB) | D3 (12GB) | D4 (16GB) | D5a (24GB) | D5b (32GB)    | P1 (CPU) | P2 (多卡)   | P3 (48GB+) |
| ------------------- | -------- | -------- | --------- | --------- | ---------- | ------------- | -------- | --------- | ---------- |
| 1. 上下文              | 4096     | 8192     | 16384     | 32768     | 65536      | 65536\~131072 | 4096     | 65536+    | 131072     |
| 2. KV 类型            | q8\_0    | q8\_0    | q8\_0     | q8\_0     | bf16       | bf16          | q8\_0    | bf16      | bf16       |
| 3. CPU MoE          | 开        | 开        | 关         | 关         | 关          | 关             | 开        | 关         | 关          |
| 4. mlock            | 关        | 关        | 关         | 开         | 开          | 开             | 开        | 开         | 开          |
| 5. Fit Target (MiB) | 256      | 512      | 1024      | 1024      | 1536       | 1536          | —        | 1024/卡    | 2048       |
| 6. 批处理/微批次          | 512/256  | 1024/256 | 2048/512  | 2048/512  | 4096/512   | 4096/512      | 512/256  | 2048/512  | 4096/512   |
| 7. 推测类型（可选）         | —        | —        | —         | —         | draft-mtp  | draft-mtp     | —        | draft-mtp | draft-mtp  |

**实现说明**：加载档位时注入以上 7 项。第 7 项默认仍为 `none`，`draft-mtp` 仅作为建议值提示用户确认（需模型支持 MTP 头）；其余参数全部走全局默认。

> 档位含义：D 系列按显存分档（6GB→32GB）；P 系列为特殊场景（P1 纯 CPU / P2 多卡 / P3 48GB+）。

***

## 八、常用页与高级页参数清单（131 项）

> 完整两页参数清单：**常用页 28 项**、**高级页 103 项**，共 131 项。
> 字段名、控件类型、默认值均已按最新修订文档标注，可直接照此铺 UI。
> 与档位的关系：本清单默认值为**全局默认**；档位预设仅覆盖第七章 7.1 所列 7 项。
> 英文字段说明：以下「英文（CLI）」列即运行时传递给 llama-server 的参数名，均取自 manpage 与 performance-tuning 原文，**逐字节精确**；「中文」列为 UI 显示名。`字段`=中文显示，`参数`=英文 CLI 原文。
> 参数归属：8.1 常用页与 8.2 高级页共 131 项均为 **UI 设置参数**（每个字段都有对应控件，运行时由 UI 组装成 argv 传递）；manpage / performance-tuning 中其余参数为 **CLI 专用参数**（不进 UI 设计），单独列于**第九章**。

### 8.1 常用页（28 项）

#### 基础（已有，6 项）

| # | 中文      | 英文（CLI）              | 控件       | 默认/推荐              |
| - | ------- | -------------------- | -------- | ------------------ |
| 1 | 档案名称    | （UI 概念，无 CLI 参数）     | 文本       | 必填                 |
| 2 | 模型      | `-m, --model FNAME`  | GGUF 选择器 | 必填                 |
| 3 | host    | `--host HOST`        | 文本       | 127.0.0.1          |
| 4 | 端口      | `--port PORT`        | 数字       | 8080               |
| 5 | API Key | `--api-key KEY`      | 文本（加密存储） | 留空                 |
| 6 | 别名      | `-a, --alias STRING` | 文本       | 留空（OpenAI API 模型名） |

#### 上下文与缓存（7 项）

| #  | 中文              | 英文（CLI）                                        | 控件                       | 默认/推荐          |
| -- | --------------- | ---------------------------------------------- | ------------------------ | -------------- |
| 7  | 上下文长度           | `-c, --ctx-size N`                             | 数字（空=模型上限）               | 32768；8GB 以下降档 |
| 8  | 最大生成 Token      | `-n, --predict, --n-predict N`                 | 数字，-1=不限                 | -1             |
| 9  | GPU 层数          | `-ngl, --gpu-layers, --n-gpu-layers N`         | 下拉（自动/数字）                | 自动(auto)       |
| 10 | Flash Attention | `-fa, --flash-attn [on\|off\|auto]`            | 下拉 auto/on/off           | auto           |
| 11 | KV 缓存量化 K       | `-ctk, --cache-type-k TYPE`                    | 下拉 f16/bf16/q8\_0/q4\_0… | q8\_0（推荐覆盖）    |
| 12 | KV 缓存量化 V       | `-ctv, --cache-type-v TYPE`                    | 同上                       | q8\_0          |
| 13 | KV 统一缓存         | `-kvu, --kv-unified, -no-kvu, --no-kv-unified` | 开关                       | 开              |

#### 显存与内存（5 项）

| #  | 中文           | 英文（CLI）                             | 控件 | 默认/推荐       |
| -- | ------------ | ----------------------------------- | -- | ----------- |
| 14 | Fit 自适应      | `-fit, --fit [on\|off]`             | 开关 | 开           |
| 15 | Fit 余量 (MiB) | `-fitt, --fit-target MiB0,MiB1,...` | 数字 | 1024        |
| 16 | CPU MoE      | `-cmoe, --cpu-moe`                  | 开关 | 关（需内存≥模型总量） |
| 17 | mlock（锁定内存）  | `--mlock`（DEPRECATED）               | 开关 | 关           |
| 18 | 内存映射 mmap    | `--mmap, --no-mmap`（DEPRECATED）     | 开关 | 开           |

#### 采样（4 项，已有）

| #  | 中文    | 英文（CLI）                   | 默认/推荐            |
| -- | ----- | ------------------------- | ---------------- |
| 19 | 温度    | `--temp, --temperature N` | 0.60（思考）/0.80 默认 |
| 20 | Top-K | `--top-k N`               | 40               |
| 21 | Top-P | `--top-p N`               | 0.95             |
| 22 | Min-P | `--min-p N`               | 0.05             |

#### 推理与网络（6 项）

| #  | 中文    | 英文（CLI）                                           | 默认/推荐          |
| -- | ----- | ------------------------------------------------- | -------------- |
| 23 | 推理模式  | `-rea, --reasoning [on\|off\|auto]`               | Auto           |
| 24 | 推理预算  | `--reasoning-budget N`                            | 数字，-1=不限；默认 -1 |
| 25 | 并行槽   | `-np, --parallel N`                               | 1              |
| 26 | 连续批处理 | `-cb, --cont-batching, -nocb, --no-cont-batching` | 开              |
| 27 | 批处理大小 | `-b, --batch-size N`                              | 2048           |
| 28 | 微批次大小 | `-ub, --ubatch-size N`                            | 512            |

### 8.2 高级页（103 项）

> 8.2 与 8.1 同构：`中文`=UI 显示名，`英文（CLI）`=运行时传递给 llama-server 的参数，均取自 manpage / performance-tuning 原文，**逐字节精确**；`默认/推荐`以 manpage 默认值为准。一栏含多个参数时用 `/` 分隔、或列出全部别名（短/长选项原样保留）；标注「UI 概念」的字段无对应 CLI 参数。核对说明：已逐条对照 manpage 修正参数写法（如 mmproj-url 为 `-mmu` 而非 `-mu`、不存在 `--spec-draft-ctx-size` 参数等），「覆盖与调试」中重复的 RoPE 项已归入 RoPE 全组。

#### 推测解码（17 项）

| 中文                                           | 英文（CLI）                                                                                                                                                                                               | 默认/推荐                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 推测类型                                         | `--spec-type none,draft-simple,draft-eagle3,draft-mtp,draft-dflash,draft-dspark,ngram-simple,ngram-map-k,ngram-map-k4v,ngram-mod,ngram-cache`                                                         | none；下拉可选上述全部         |
| 草稿模型                                         | `--spec-draft-model, -md, --model-draft FNAME`                                                                                                                                                        | 留空                    |
| 草稿最大                                         | `--spec-draft-n-max N`                                                                                                                                                                                | **3**                 |
| 草稿最小                                         | `--spec-draft-n-min N`                                                                                                                                                                                | 0                     |
| 草稿 P 最小                                      | `--spec-draft-p-min, --draft-p-min P`                                                                                                                                                                 | **0.00**              |
| 草稿 P 分割                                      | `--spec-draft-p-split, --draft-p-split P`                                                                                                                                                             | 0.10                  |
| 草稿上下文                                        | （UI 概念，无 CLI 参数；草稿与主模型共享 `-c, --ctx-size N`）                                                                                                                                                          | 0                     |
| 草稿 GPU 层                                     | `--spec-draft-ngl, -ngld, --gpu-layers-draft, --n-gpu-layers-draft N`                                                                                                                                 | auto（'auto'/'all'/数字） |
| 草稿设备                                         | `--spec-draft-device, -devd, --device-draft <dev1,dev2,..>`（none = 不卸载）                                                                                                                               | 留空                    |
| 草稿 KV K / V                                  | `--spec-draft-type-k, -ctkd, --cache-type-k-draft TYPE` / `--spec-draft-type-v, -ctvd, --cache-type-v-draft TYPE`                                                                                     | f16                   |
| 草稿后端采样                                       | `--spec-draft-backend-sampling, --no-spec-draft-backend-sampling`                                                                                                                                     | 开（manpage 默认启用）       |
| 草稿 CPU MoE                                   | `--spec-draft-cpu-moe, -cmoed, --cpu-moe-draft`                                                                                                                                                       | 关                     |
| 草稿 N CPU MoE 层                               | `--spec-draft-n-cpu-moe, --spec-draft-ncmoe, -ncmoed, --n-cpu-moe-draft N`                                                                                                                            | 留空                    |
| ngram-mod n-min / n-max / match              | `--spec-ngram-mod-n-min N` / `--spec-ngram-mod-n-max N` / `--spec-ngram-mod-n-match N`                                                                                                                | 48 / 64 / 24          |
| ngram-simple size-n / size-m / min-hits      | `--spec-ngram-simple-size-n N` / `--spec-ngram-simple-size-m N` / `--spec-ngram-simple-min-hits N`                                                                                                    | 12 / 48 / 1           |
| ngram-map-k / k4v size-n / size-m / min-hits | `--spec-ngram-map-k-size-n N` / `--spec-ngram-map-k-size-m N` / `--spec-ngram-map-k-min-hits N`；`--spec-ngram-map-k4v-size-n N` / `--spec-ngram-map-k4v-size-m N` / `--spec-ngram-map-k4v-min-hits N` | 12 / 48 / 1           |
| 查找缓存静态 / 动态                                  | `-lcs, --lookup-cache-static FNAME` / `-lcd, --lookup-cache-dynamic FNAME`                                                                                                                            | 留空（动态缓存会随生成更新）        |

#### CPU MoE 细分（2 项）

| 中文             | 英文（CLI）                                                                    | 默认/推荐      |
| -------------- | -------------------------------------------------------------------------- | ---------- |
| N 个 CPU MoE 层  | `-ncmoe, --n-cpu-moe N`                                                    | 留空（优先于总开关） |
| CPU MoE 层数（草稿） | `--spec-draft-n-cpu-moe, --spec-draft-ncmoe, -ncmoed, --n-cpu-moe-draft N` | 留空         |

#### 内存与加载（6 项）

| 中文           | 英文（CLI）                                                      | 默认/推荐                                   |
| ------------ | ------------------------------------------------------------ | --------------------------------------- |
| 加载模式         | `-lm, --load-mode MODE`（auto/none/mmap/mlock/mmap+mlock/dio） | auto（mlock/mmap/dio 均已 deprecated，此为正主） |
| 直接 IO        | `-dio, --direct-io, -ndio, --no-direct-io`（DEPRECATED）       | 关                                       |
| 缓存 RAM (MiB) | `-cram, --cache-ram N`                                       | 8192；-1=不限，0=禁用                         |
| 权重重打包        | `--repack, -nr, --no-repack`                                 | 开                                       |
| 算子卸载         | `--op-offload, --no-op-offload`                              | 开                                       |
| 无主机缓冲区       | `--no-host`                                                  | 关                                       |

#### 缓存与检查点（8 项）

| 中文      | 英文（CLI）                                          | 默认             |
| ------- | ------------------------------------------------ | -------------- |
| 缓存提示    | `--cache-prompt, --no-cache-prompt`              | 开              |
| 缓存空闲槽   | `--cache-idle-slots, --no-cache-idle-slots`      | 开（需 cache-ram） |
| 缓存重用最小块 | `--cache-reuse N`                                | 0              |
| 上下文移位   | `--context-shift, --no-context-shift`            | 关              |
| 每槽检查点数  | `-ctxcp, --ctx-checkpoints, --swa-checkpoints N` | 32             |
| 检查点间隔   | `-cms, --checkpoint-min-step N`                  | 8192；0=无最小间隔   |
| SWA 完整  | `--swa-full`                                     | 关              |
| KV 卸载   | `-kvo, --kv-offload, -nkvo, --no-kv-offload`     | 开              |

#### 批处理与线程（10 项）

| 中文                     | 英文（CLI）                                                                                   | 默认/推荐                             |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| 生成线程数                  | `-t, --threads N`                                                                         | CPU 核心数（自动）；GPU 场景 4-8，服务器每请求 2-4 |
| 批处理线程数                 | `-tb, --threads-batch N`                                                                  | 同 --threads（可更高以加速 prefill）       |
| NUMA                   | `--numa TYPE`（distribute/isolate/numactl）                                                 | 禁用                                |
| CPU 掩码 / 范围 / 严格       | `-C, --cpu-mask M` / `-Cr, --cpu-range lo-hi` / `--cpu-strict <0\|1>`                     | 留空 / 留空 / 0（关）                    |
| CPU 掩码批次 / 范围批次 / 严格批次 | `-Cb, --cpu-mask-batch M` / `-Crb, --cpu-range-batch lo-hi` / `--cpu-strict-batch <0\|1>` | 同非批次项                             |
| 优先级                    | `--prio N`（low(-1)/normal(0)/medium(1)/high(2)/realtime(3)）                               | 0（normal）                         |
| 批次优先级                  | `--prio-batch N`（0-normal/1-medium/2-high/3-realtime）                                     | 0                                 |
| 轮询                     | `--poll <0...100>`（0 = 不轮询）                                                               | 50                                |
| 批次轮询                   | `--poll-batch <0\|1>`                                                                     | 同 --poll                          |

#### 槽位与调度（4 项）

| 中文      | 英文（CLI）                                     | 默认            |
| ------- | ------------------------------------------- | ------------- |
| 槽位提示相似度 | `-sps, --slot-prompt-similarity SIMILARITY` | 0.10；0.0 = 禁用 |
| 槽位保存路径  | `--slot-save-path PATH`                     | 留空（默认不保存）     |
| 槽端点     | `--slots, --no-slots`（暴露 slots 监控端点）        | 开             |
| HTTP 线程 | `--threads-http N`                          | -1（自动）        |

#### 采样扩展（16 项）

| 中文                                             | 英文（CLI）                                                                                                                                           | 默认/推荐                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 采样器链                                           | `--samplers SAMPLERS`（按 `;` 分隔的顺序）                                                                                                                | penalties;dry;top\_n\_sigma;top\_k;typ\_p;top\_p;min\_p;xtc;temperature |
| 采样器简化序列                                        | `--sampler-seq, --sampling-seq SEQUENCE`                                                                                                          | edskypmxt                                                               |
| 随机种子                                           | `-s, --seed SEED`                                                                                                                                 | -1（-1 = 随机）                                                             |
| 重复最后 N                                         | `--repeat-last-n N`                                                                                                                               | 64（0 = 禁用）                                                              |
| 重复惩罚                                           | `--repeat-penalty N`                                                                                                                              | 1.00（1.0 = 禁用）                                                          |
| 存在惩罚                                           | `--presence-penalty N`                                                                                                                            | 0.00（0.0 = 禁用）                                                          |
| 频率惩罚                                           | `--frequency-penalty N`                                                                                                                           | 0.00（0.0 = 禁用）                                                          |
| DRY 倍数 / 基数 / 允许长度 / 惩罚最后 N                    | `--dry-multiplier N` / `--dry-base N` / `--dry-allowed-length N` / `--dry-penalty-last-n N`；另含 `--dry-sequence-breaker STRING`                    | 0.00 / 1.75 / 2 / 64（默认断句符 '\n' ':' '"' '\*' 可替换）                       |
| XTC 概率 / 阈值                                    | `--xtc-probability N` / `--xtc-threshold N`                                                                                                       | 0.00 / 0.10（概率 0.0=禁用，阈值 1.0=禁用）                                        |
| Top-N-Sigma                                    | `--top-nsigma, --top-n-sigma N`                                                                                                                   | -1.00（-1.0 = 禁用）                                                        |
| Typical P                                      | `--typical, --typical-p N`                                                                                                                        | 1.00（1.0 = 禁用）                                                          |
| 自适应目标 / 衰减                                     | `--adaptive-target N`（有效范围 0.0-1.0，负 = 禁用）/ `--adaptive-decay N`（有效范围 0.0-0.99，越低越灵敏）                                                             | -1.00 / 0.90                                                            |
| 动态温度范围 / 指数                                    | `--dynatemp-range N` / `--dynatemp-exp N`                                                                                                         | 0.00（0.0 = 禁用）/ 1.00                                                    |
| Mirostat 模式 / 熵 / 学习率                          | `--mirostat N`（0=关，1=Mirostat，2=Mirostat 2.0）/ `--mirostat-ent N`（目标熵 tau）/ `--mirostat-lr N`（学习率 eta）                                            | 0 / 5.00 / 0.10                                                         |
| 忽略 EOS                                         | `--ignore-eos`（隐含 `--logit-bias EOS-inf`）                                                                                                         | 关                                                                       |
| 后端采样                                           | `-bs, --backend-sampling`（实验性）                                                                                                                    | 关                                                                       |
| Grammar / JSON Schema / Schema 文件 / Logit-bias | `--grammar GRAMMAR` / `--grammar-file FNAME` / `-j, --json-schema SCHEMA` / `-jf, --json-schema-file FILE` / `-l, --logit-bias TOKEN_ID(+/-)BIAS` | 留空                                                                      |

#### 聊天模板（7 项）

| 中文          | 英文（CLI）                                                            | 默认                             |
| ----------- | ------------------------------------------------------------------ | ------------------------------ |
| 模板          | `--chat-template JINJA_TEMPLATE`                                   | 留空（读 GGUF 元数据）                 |
| 模板文件        | `--chat-template-file JINJA_TEMPLATE_FILE`                         | 留空                             |
| Jinja       | `--jinja, --no-jinja`                                              | 开（manpage：enabled）             |
| 模板参数 JSON   | `--chat-template-kwargs STRING`                                    | 留空（合法的 JSON 对象串）               |
| 预填充助手       | `--prefill-assistant, --no-prefill-assistant`                      | 开（manpage：prefill enabled）     |
| 跳过聊天解析      | `--skip-chat-parsing, --no-skip-chat-parsing`                      | 关（manpage：disabled）            |
| 推理格式 / 预算消息 | `--reasoning-format FORMAT` / `--reasoning-budget-message MESSAGE` | auto / 留空（manpage：auto / none） |

#### 多模态（7 项）

| 中文              | 英文（CLI）                                         | 默认                 |
| --------------- | ----------------------------------------------- | ------------------ |
| mmproj 路径 / URL | `-mm, --mmproj FILE` / `-mmu, --mmproj-url URL` | 留空（-hf 时可省略 -mm）   |
| mmproj 自动       | `--mmproj-auto, --no-mmproj, --no-mmproj-auto`  | 开（manpage：enabled） |
| mmproj 卸载       | `--mmproj-offload, --no-mmproj-offload`         | 开（manpage：enabled） |
| mmproj 设备       | `-mmdev, --mmproj-device DEVICE`（none = 不卸载）    | auto               |
| 图片最小 / 最大 token | `--image-min-tokens N` / `--image-max-tokens N` | 读模型默认（0 / -1）      |
| mtmd 批次上限       | `--mtmd-batch-max-tokens N`                     | 1024               |

#### LoRA 与控制向量（5 项）

| 中文      | 英文（CLI）                                   | 默认 |
| ------- | ----------------------------------------- | -- |
| LoRA    | `--lora FNAME`                            | 留空 |
| LoRA 缩放 | `--lora-scaled FNAME:SCALE,...`           | 留空 |
| 控制向量    | `--control-vector FNAME`                  | 留空 |
| 控制向量缩放  | `--control-vector-scaled FNAME:SCALE,...` | 留空 |
| 控制向量层范围 | `--control-vector-layer-range START END`  | 留空 |

#### 覆盖与调试（6 项）

| 中文                   | 英文（CLI）                                                                                               | 默认                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| 覆盖张量                 | `-ot, --override-tensor <tensor name pattern>=<buffer type>,...`                                      | 留空                  |
| 覆盖张量（草稿）             | `--spec-draft-override-tensor, -otd, --override-tensor-draft <tensor name pattern>=<buffer type>,...` | 留空                  |
| 覆盖 KV                | `--override-kv KEY=TYPE:VALUE,...`                                                                    | 留空                  |
| 检查张量                 | `--check-tensors`                                                                                     | 关（manpage：disabled） |
| RoPE 缩放/因子/频率基数/频率缩放 | 见下「RoPE 全组」：`--rope-scaling / --rope-scale / --rope-freq-base / --rope-freq-scale`（此处 4 项不重复列出）       | 留空                  |

#### RoPE 全组（8 项）

| 中文                                          | 英文（CLI）                                                                                                            | 默认                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| RoPE 缩放方式 / 缩放因子 / 频率基数 / 频率缩放              | `--rope-scaling {none,linear,yarn}` / `--rope-scale N` / `--rope-freq-base N` / `--rope-freq-scale N`              | 留空（未指定默认 linear / 读模型 / 读模型 / 1.0）             |
| YaRN 原始上下文 / 扩展因子 / 注意力因子 / Beta 快 / Beta 慢 | `--yarn-orig-ctx N` / `--yarn-ext-factor N` / `--yarn-attn-factor N` / `--yarn-beta-fast N` / `--yarn-beta-slow N` | 留空（0=模型训练上下文 / -1.00 / 1.0 / 读模型 / 读模型；合计 9 项） |

#### 网络与安全（8 项）

| 中文                    | 英文（CLI）                                                                                                                      | 默认                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| CORS 来源 / 方法 / 头 / 凭证 | `--cors-origins ORIGINS` / `--cors-methods METHODS` / `--cors-headers HEADERS` / `--cors-credentials, --no-cors-credentials` | `*` / GET,POST,DELETE,OPTIONS / `*` / 开 |
| SSL 密钥 / 证书           | `--ssl-key-file FNAME` / `--ssl-cert-file FNAME`                                                                             | 留空                                      |
| 复用端口                  | `--reuse-port`                                                                                                               | 关（manpage：disabled）                     |
| 超时（秒）                 | `-to, --timeout N`                                                                                                           | 3600（manpage 默认）                        |
| 空闲休眠（秒）               | `--sleep-idle-seconds SECONDS`                                                                                               | -1（-1 = 禁用）                             |

#### 功能开关（10 项）

| 中文               | 英文（CLI）                                                                           | 默认                      |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------- |
| WebUI            | `--ui, --webui, --no-ui, --no-webui`                                              | 开（manpage：enabled）      |
| WebUI MCP 代理     | `--ui-mcp-proxy, --webui-mcp-proxy, --no-ui-mcp-proxy, --no-webui-mcp-proxy`（实验性） | 关（manpage：disabled）     |
| 指标 /metrics      | `--metrics`                                                                       | 关（manpage：disabled）     |
| 属性 /props        | `--props`                                                                         | 关（manpage：disabled）     |
| 嵌入模式 / 重排序       | `--embedding, --embeddings` / `--rerank, --reranking`                             | 关 / 关（manpage：disabled） |
| 预热               | `--warmup, --no-warmup`                                                           | 开（manpage：enabled；推荐关）  |
| Agent 模式         | `-ag, --agent, -no-ag, --no-agent`（实验性）                                           | 关（manpage：disabled）     |
| 内置工具             | `--tools TOOL1,TOOL2,...`（实验性；指定 "all" 启用全部）                                      | 关（manpage：no tools）     |
| 工具运行时            | `--tools-runtime OPTION`（实验性）                                                     | none（宿主机环境）             |
| MCP 服务器配置 / JSON | `--mcp-servers-config PATH` / `--mcp-servers-json JSON`（实验性）                      | 留空（manpage：none）        |

#### 嵌入与池化（2 项）

| 中文     | 英文（CLI）                               | 默认       |
| ------ | ------------------------------------- | -------- |
| 嵌入池化类型 | `--pooling {none,mean,cls,last,rank}` | 留空（模型默认） |
| 嵌入归一化  | `--embd-normalize N`                  | 2        |

#### 模型来源（5 项）

| 中文        | 英文（CLI）                                       | 默认             |
| --------- | --------------------------------------------- | -------------- |
| 模型 URL    | `-mu, --model-url MODEL_URL`                  | 留空（模型管理页代管时隐藏） |
| HF 仓库     | `-hf, -hfr, --hf-repo <user>/<model>[:quant]` | 留空             |
| HF 文件     | `-hff, --hf-file FILE`                        | 留空             |
| HF Token  | `-hft, --hf-token TOKEN`                      | 留空             |
| Docker 仓库 | `-dr, --docker-repo [<repo>/]<model>[:quant]` | 留空             |

#### 日志（9 项）

| 中文          | 英文（CLI）                                                                                             | 默认                   |
| ----------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| 日志文件 / 日志颜色 | `--log-file FNAME` / `--log-colors [on\|off\|auto]`                                                 | 留空 / auto            |
| 详细程度        | `-lv, --verbosity, --log-verbosity N`（0 generic / 1 error / 2 warning / 3 info / 4 trace / 5 debug） | 3（info）              |
| 详细          | `-v, --verbose, --log-verbose`                                                                      | 关（默认不开启）             |
| 性能计时        | `--perf, --no-perf`                                                                                 | 关（manpage：false；推荐开） |
| 日志前缀 / 时间戳  | `--log-prefix, --no-log-prefix` / `--log-timestamps, --no-log-timestamps`                           | 开 / 开                |
| 离线          | `--offline`                                                                                         | 关（默认不开启）             |

#### 其他（3 项）

| 中文                                   | 英文（CLI）                                                                                                                 | 默认            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------- |
| 静态文件路径 / 媒体路径 / WebUI 配置 JSON / 配置文件 | `--path PATH` / `--media-path PATH` / `--ui-config, --webui-config JSON` / `--ui-config-file, --webui-config-file PATH` | 留空（4 项）       |
| SPM 填充 / 特殊令牌 / 转义序列 | `--spm-infill` / `-sp, --special` / `-e, --escape, --no-escape` | 关 / 关 / 开 |
| 额外参数（原始命令行兜底）                        | （UI 概念，无 CLI 参数；原文透传给 llama-server）                                                                                     | 留空            |

***

## 九、CLI 专用参数清单（不进 UI 设计）

> 以下参数均来自 manpage 原文，属于 **CLI 专用参数**：无对应 UI 控件，不在常用页/高级页铺 UI，仅作为运行时命令行直接传递（或由「额外参数」兜底透传）。其中一次性动作类参数（`--help`、`--list-devices` 等）启动后立即退出，不应出现在服务进程的启动参数中。
>
> 核对说明：已逐条对照 manpage 全量 **248 条选项行**，凡 8.1 / 8.2 已收录的归为 UI 设置参数，其余全部列入本章，共 **55 项**。标注（DEPRECATED）者已弃用、（removed）者已删除，仅保留用于兼容旧配置时识别。
>
> 版本补充：另经 **b10688 版** **`llama-server.exe --help`** **输出** 逐条核对，manpage（0.2.0）未收录的新增参数共 **9 项**，见 **9.8 新增参数** 小节。本章合计 **64 项**。

### 9.1 一次性动作 / 查询类（5 项）

| 中文           | 英文（CLI）               | 说明 / 默认                        |
| ------------ | --------------------- | ------------------------------ |
| 帮助           | `-h, --help, --usage` | 打印用法后退出                        |
| 版本           | `--version`           | 显示版本和构建信息后退出                   |
| 缓存模型列表       | `-cl, --cache-list`   | 显示缓存中的模型列表后退出                  |
| 生成 bash 补全脚本 | `--completion-bash`   | 打印 llama.cpp 的 bash 补全脚本后退出    |
| 列出可用设备       | `--list-devices`      | 打印可用设备列表后退出（配合 `-dev` 等设备参数使用） |

### 9.2 常规参数（未入 UI，11 项）

| 中文          | 英文（CLI）                                                               | 说明 / 默认                                      |
| ----------- | --------------------------------------------------------------------- | -------------------------------------------- |
| 保留令牌        | `--keep N`                                                            | 从初始提示保留的 token 数（默认 0，-1 = 全部）               |
| 模型标签        | `--tags STRING`（逗号分隔）                                                 | 模型标签（仅信息用途，不参与路由）                            |
| API 前缀路径    | `--api-prefix PREFIX`                                                 | 服务器服务前缀路径，不带末尾斜杠                             |
| API Key 文件  | `--api-key-file FNAME`                                                | 从文件读 API Key（每行一个，`#` 开头为注释）                 |
| SSE 心跳间隔    | `--sse-ping-interval N`（秒）                                            | -1 = 禁用（默认 30）                               |
| 推理努力度       | `--reasoning-effort LEVEL`（default/minimal/low/medium/high/xhigh/max） | 思考强度（默认 default，保留模板默认）                      |
| 保留推理痕迹      | `--reasoning-preserve, --no-reasoning-preserve`                       | 在完整历史中保留推理痕迹（默认模板决定）                         |
| 仅加载不应用 LoRA | `--lora-init-without-apply`                                           | 只加载 LoRA 适配器而不应用（稍后经 POST /lora-adapters 应用） |
| 关闭日志        | `--log-disable`                                                       | 关闭所有日志输出                                     |
| 提示日志目录      | `--log-prompts-dir PATH`（auto-created，仅调试用）                           | 将提示文本写入日志目录（默认禁用）                            |
| 反向提示        | `-r, --reverse-prompt PROMPT`                                         | 互动模式中遇到 PROMPT 时停止生成（服务进程一般不用）               |

### 9.3 草稿模型细分配置（12 项）

> 与第八章「推测解码」里的草稿参数不同，以下为草稿模型的线程 / CPU 亲和力 / 优先级 / HF 来源等**细分配置**，与主模型同名前缀对应（`-td` 对应 `-t` 等）。

| 中文          | 英文（CLI）                                                                  | 说明 / 默认                  |
| ----------- | ------------------------------------------------------------------------ | ------------------------ |
| 草稿 HF 仓库    | `--spec-draft-hf, -hfd, -hfrd, --hf-repo-draft <user>/<model>[:quant]`   | 同 `--hf-repo`，但用于草稿模型    |
| 草稿生成线程数     | `--spec-draft-threads, -td, --threads-draft N`                           | 默认同 `--threads`          |
| 草稿批处理线程数    | `--spec-draft-threads-batch, -tbd, --threads-batch-draft N`              | 默认同 `--threads-draft`    |
| 草稿 CPU 掩码   | `--spec-draft-cpu-mask, -Cd, --cpu-mask-draft M`                         | 默认同 `--cpu-mask`         |
| 草稿 CPU 范围   | `--spec-draft-cpu-range, -Crd, --cpu-range-draft lo-hi`                  | 与 `--cpu-mask-draft` 互补  |
| 草稿 CPU 严格   | `--spec-draft-cpu-strict, --cpu-strict-draft <0\|1>`                     | 默认同 `--cpu-strict`       |
| 草稿优先级       | `--spec-draft-prio, --prio-draft N`（0-normal/1-medium/2-high/3-realtime） | 默认 0                     |
| 草稿轮询        | `--spec-draft-poll, --poll-draft <0\|1>`                                 | 默认同 `--poll`             |
| 草稿批次 CPU 掩码 | `--spec-draft-cpu-mask-batch, -Cbd, --cpu-mask-batch-draft M`            | 默认同 `--cpu-mask`         |
| 草稿批次 CPU 严格 | `--spec-draft-cpu-strict-batch, --cpu-strict-batch-draft <0\|1>`         | 默认同 `--cpu-strict-draft` |
| 草稿批次优先级     | `--spec-draft-prio-batch, --prio-batch-draft N`                          | 默认 0                     |
| 草稿批次轮询      | `--spec-draft-poll-batch, --poll-batch-draft <0\|1>`                     | 默认同 `--poll-draft`       |

### 9.4 多 GPU 部署（5 项）

| 中文        | 英文（CLI）                                     | 说明 / 默认                                         |
| --------- | ------------------------------------------- | ----------------------------------------------- |
| 设备列表      | `-dev, --device <dev1,dev2,..>`             | 用于卸载的设备列表（none = 不卸载）；用 `--list-devices` 查看可用设备 |
| 分割模式      | `-sm, --split-mode {none,layer,row,tensor}` | 多 GPU 拆分方式（默认 layer）                            |
| 张量分割      | `-ts, --tensor-split N0,N1,N2,...`          | 各 GPU 承载比例（逗号分隔，如 `3,1`）                        |
| 主 GPU     | `-mg, --main-gpu INDEX`                     | 主模型所在 GPU（默认 0）                                 |
| Fit 最小上下文 | `-fitc, --fit-ctx N`                        | `--fit` 可设置的最小 ctx（默认 4096）                     |

### 9.5 Router 路由服务器（4 项）

| 中文      | 英文（CLI）                                   | 说明 / 默认                 |
| ------- | ----------------------------------------- | ----------------------- |
| 模型目录    | `--models-dir PATH`                       | 路由服务器所含模型目录（默认禁用）       |
| 模型预设文件  | `--models-preset PATH`                    | 路由服务器模型预设 INI 文件（默认禁用）  |
| 最大并发模型数 | `--models-max N`                          | 同时加载的最大模型数（默认 4，0 = 不限） |
| 自动加载模型  | `--models-autoload, --no-models-autoload` | 是否自动加载模型（默认启用）          |

### 9.6 已移除 / 已弃用（6 项）

> 仅用于兼容旧命令时识别，新配置不应使用。

| 中文            | 英文（CLI）                                      | 说明                                                           |
| ------------- | -------------------------------------------- | ------------------------------------------------------------ |
| 草稿最大（旧）       | `--draft, --draft-n, --draft-max N`（removed） | 已删除，改用 `--spec-draft-n-max` / `--spec-ngram-mod-n-max`       |
| 草稿最小（旧）       | `--draft-min, --draft-n-min N`（removed）      | 已删除，改用 `--spec-draft-n-min` / `--spec-ngram-mod-n-min`       |
| ngram 大小 N（旧） | `--spec-ngram-size-n N`（removed）             | 已删除，改用各 `--spec-ngram-*-size-n` / `--spec-ngram-mod-n-match` |
| ngram 大小 M（旧） | `--spec-ngram-size-m N`（removed）             | 已删除，改用各 `--spec-ngram-*-size-m`                              |
| ngram 最小命中（旧） | `--spec-ngram-min-hits N`（removed）           | 已删除，改用各 `--spec-ngram-*-min-hits`                            |
| KV 碎片整理阈值     | `-dt, --defrag-thold N`（DEPRECATED）          | 已弃用                                                          |

### 9.7 一键默认模型预设（12 项）

> 均为「加载内置默认模型」的快捷开关（按需联网下载权重，属一次性动作），仅供 CLI / 脚本使用；不应出现在服务进程的启动参数中，否则会触发模型下载。

| 中文                     | 英文（CLI）                      | 说明                                          |
| ---------------------- | ---------------------------- | ------------------------------------------- |
| 嵌入默认模型                 | `--embd-gemma-default`       | 加载默认 EmbeddingGemma 模型（可联网下载权重）             |
| FIM Qwen 1.5B          | `--fim-qwen-1.5b-default`    | 加载默认 Qwen 2.5 Coder 1.5B（可联网下载权重）           |
| FIM Qwen 3B            | `--fim-qwen-3b-default`      | 加载默认 Qwen 2.5 Coder 3B（可联网下载权重）             |
| FIM Qwen 7B            | `--fim-qwen-7b-default`      | 加载默认 Qwen 2.5 Coder 7B（可联网下载权重）             |
| FIM Qwen 7B + 0.5B 草稿  | `--fim-qwen-7b-spec`         | 加载 Qwen 2.5 Coder 7B + 0.5B 草稿模型做推测解码       |
| FIM Qwen 14B + 0.5B 草稿 | `--fim-qwen-14b-spec`        | 加载 Qwen 2.5 Coder 14B + 0.5B 草稿模型做推测解码      |
| FIM Qwen 30B A3B       | `--fim-qwen-30b-default`     | 加载默认 Qwen 3 Coder 30B A3B Instruct（可联网下载权重） |
| GPT-OSS 20B            | `--gpt-oss-20b-default`      | 加载 gpt-oss-20b（可联网下载权重）                     |
| GPT-OSS 120B           | `--gpt-oss-120b-default`     | 加载 gpt-oss-120b（可联网下载权重）                    |
| Vision Gemma 3 4B      | `--vision-gemma-4b-default`  | 加载 Gemma 3 4B QAT（可联网下载权重）                  |
| Vision Gemma 3 12B     | `--vision-gemma-12b-default` | 加载 Gemma 3 12B QAT（可联网下载权重）                 |
| 默认推测解码                 | `--spec-default`             | 启用默认推测解码配置                                  |

### 9.8 新增参数（b10688+ 版 `--help` 核对，9 项）

> 以下参数在 manpage 0.2.0 中未收录，为较新版本新增（b10688+）。其中 `--spec-synth-*` 仅供基准测试用，`--video-*` 为视频/多模态输入专用，均属 CLI 专用参数，不进 UI 设计。

| 中文            | 英文（CLI）                        | 说明 / 默认                                                          |
| ------------- | ------------------------------ | ---------------------------------------------------------------- |
| RPC 服务器列表     | `--rpc SERVERS`                | 逗号分隔的 RPC 服务器列表（host:port），远程推理用                                 |
| 张量按需读取        | `--tensor-read-lazy MODE`      | 某些张量按需从磁盘读取（如逐层嵌入）；on / auto / off，默认 auto（仅对 >4GiB 张量生效，需 mmap） |
| CPU 稠密 FFN 层数 | `-ncffn, --n-cpu-ffn N`        | 将前 N 层稠密 FFN 权重保留在 CPU（稠密模型；MoE 专家权重用 `--n-cpu-moe`）             |
| 合成接受长度        | `--spec-synth-len L`           | 目标平均合成接受长度（含目标 token，仅基准测试用）                                     |
| 合成接受概率        | `--spec-synth-rates P0,P1,...` | 逐位置无条件下合成接受概率（逗号分隔，仅基准测试用）                                       |
| 每槽上下限         | `--kv-unified-per-slot N`      | 每个并行槽的上下文限制；未设时行为不变，配合 `-c` 未设置时共享 KV 池按 n\_parallel×N 分配        |
| 视频目标帧率        | `--video-fps N`                | 目标视频帧率（默认 4.0）                                                   |
| 视频时间戳间隔       | `--video-timestamp-interval N` | 文本时间戳间隔（毫秒，默认 5000）                                              |
| 视频 ffmpeg 目录  | `--video-ffmpeg-dir DIR`       | 存放 ffmpeg 与 ffprobe 的目录（默认在 PATH 中查找）                            |

***

## 附：参考来源

- llama-server(1) manpage（Debian unstable，llama.cpp-tools 1:0.2.0+dfsg1-1）：<https://manpages.debian.org/unstable/llama.cpp-tools/llama-server.1.en.html>（本地：[llama-server-manpage.md](reference/llama-server-manpage.md)）
- llama.cpp 官方性能调优指南：<https://ggml-org-llama-cpp.mintlify.app/advanced/performance-tuning>（本地：[performance-tuning.md](reference/performance-tuning.md)）
- Catapult 界面操作层面说明，见《Catapult 完整参数配置指南》。

