# Performance Tuning

Optimize llama.cpp for maximum inference speed and efficiency

Original source: https://ggml-org-llama-cpp.mintlify.app/advanced/performance-tuning

Optimize llama.cpp inference performance across CPU, GPU, and hybrid configurations.

## Quick Wins

- **Use GPU** — Offload layers to GPU with `--n-gpu-layers`
- **Optimize Threads** — Set `--threads` to physical CPU cores
- **Choose Quantization** — Use Q4_K_M or Q5_K_M for best speed/quality
- **Adjust Context** — Reduce `--ctx-size` to minimum needed

## GPU Acceleration

### CUDA (NVIDIA)

Offload layers to GPU:

```
llama-cli -m model.gguf --n-gpu-layers 32 -p "Hello"
```

Set `--n-gpu-layers` to a large number (e.g., 200000) to offload all possible layers automatically.

Verify GPU usage in the startup logs:

```
llama_model_load_internal: [cublas] offloading 60 layers to GPU
llama_model_load_internal: [cublas] offloading output layer to GPU
llama_model_load_internal: [cublas] total VRAM used: 17223 MB
```

### Metal (Apple Silicon)

Metal is enabled by default on macOS:

```
llama-cli -m model.gguf --n-gpu-layers 999
```

Monitor GPU utilization:

```
sudo powermetrics --samplers gpu_power -i 1000
```

### ROCm (AMD)

```
llama-cli -m model.gguf --n-gpu-layers 32
```

Check GPU usage:

```
rocm-smi
```

## Thread Configuration

Incorrect thread settings are the #1 cause of slow inference!

### Finding Optimal Thread Count

**Start conservative:**

```
# Start with 1 thread
llama-cli -m model.gguf --threads 1 -p "Test"
# Double until performance stops improving
llama-cli -m model.gguf --threads 2 -p "Test"
llama-cli -m model.gguf --threads 4 -p "Test"
llama-cli -m model.gguf --threads 8 -p "Test"
```

**Recommended values:**

- **CPU-only**: Physical CPU cores (not logical/hyperthreaded)
- **With GPU**: 4-8 threads regardless of core count
- **Server (parallel requests)**: 2-4 threads per request

Check physical core count:

- Linux: `lscpu | grep "Core(s) per socket"`
- macOS: `sysctl -n hw.physicalcpu`
- Windows: `wmic cpu get NumberOfCores`

### Batch Thread Configuration

Separate threads for prompt processing:

```
llama-cli -m model.gguf --threads 4 --threads-batch 8
```

## Context Size Optimization

**Context size directly impacts:**

- Memory usage (RAM/VRAM)
- Inference speed
- Maximum conversation length

Minimal (fastest):

```
llama-cli -m model.gguf --ctx-size 512
```

Balanced:

```
llama-cli -m model.gguf --ctx-size 2048
```

Large context:

```
llama-cli -m model.gguf --ctx-size 8192
```

Only use large context (>4096) when absolutely necessary. Most tasks work well with 2048.

## Batch Size Tuning

**Logical batch size** (prompt processing parallelism):

```
llama-cli -m model.gguf --batch-size 512
```

**Physical batch size** (hardware limit):

```
llama-cli -m model.gguf --ubatch-size 256
```

**Guidelines:**

- Larger batch = faster prompt processing, more memory
- CPU: 512-2048
- GPU: 512-2048 (depends on VRAM)
- Server: 2048+ for parallel requests

## Flash Attention

Enables more efficient attention computation:

```
llama-cli -m model.gguf --flash-attn
```

Flash Attention is enabled by default (`auto`) when beneficial. Explicitly enable with `--flash-attn on`.

## Quantization Selection

| Quantization | Speed | Quality | Use Case |
|---|---|---|---|
| Q2_K | Fastest | Lowest | Experimentation |
| Q3_K_M | Very Fast | Low | Resource-constrained |
| Q4_K_M | **Fast** | **Good** | **Recommended default** |
| Q5_K_M | Moderate | Very Good | Quality-focused |
| Q6_K | Slower | Excellent | Near-original quality |
| Q8_0 | Slowest | Highest | Reference/evaluation |

## Benchmark Example

Real-world benchmark on NVIDIA A6000 (48GB VRAM), 7-core CPU, 30B Q4_0 model:

| Configuration | Tokens/sec |
|---|---|
| GPU only, wrong threads | <0.1 |
| CPU only (`-t 7`) | 1.7 |
| GPU + 1 thread | 5.5 |
| GPU + 7 threads | 8.7 |
| GPU + 4 threads | **9.1** |

Note how too many threads (7) actually decreased performance compared to 4 threads!

## Hybrid CPU+GPU Inference

For models larger than VRAM:

```
# Model requires 32GB, GPU has 24GB
llama-cli -m model.gguf --n-gpu-layers 40 --threads 4
```

llama.cpp automatically splits:

- 40 layers on GPU
- Remaining layers on CPU

## Memory Optimization

### Memory Mapping

**Enable mmap** (default, recommended):

```
llama-cli -m model.gguf --mmap
```

**Disable mmap** (faster startup, more RAM):

```
llama-cli -m model.gguf --no-mmap
```

### Memory Locking

Prevent swapping (requires sufficient RAM):

```
llama-cli -m model.gguf --mlock
```

## Server Performance

### Parallel Request Handling

```
llama-server -m model.gguf --ctx-size 4096 --n-parallel 4 --threads 4 --batch-size 2048
```

**Configuration guide:**

- `--n-parallel`: Number of simultaneous requests (2-8)
- `--threads`: Threads per request (2-4 recommended)
- `--batch-size`: Must be ≥ ctx-size × n-parallel

### Continuous Batching

Enabled by default, improves throughput:

```
llama-server -m model.gguf --cont-batching --n-parallel 8
```

## Platform-Specific Tips

**NVIDIA GPU** — Optimal configuration:

```
llama-cli -m model.gguf --n-gpu-layers 999 --threads 4 --batch-size 512 --ubatch-size 256 --flash-attn
```

**Multi-GPU:**

```
# Split evenly across 2 GPUs
llama-cli -m model.gguf --tensor-split 1,1 --n-gpu-layers 999
```

**Apple Silicon** — Optimal configuration:

```
llama-cli -m model.gguf --n-gpu-layers 999 --threads 4 --batch-size 512
```

**For larger models:**

- Use Q4_K_M quantization
- Reduce context size to 2048
- Enable Metal automatically used (enabled by default on macOS)

**AMD GPU (ROCm)** — Optimal configuration:

```
llama-cli -m model.gguf --n-gpu-layers 999 --threads 4 --batch-size 512
```

**Check VRAM usage:**

```
rocm-smi --showmeminfo vram
```

**CPU-Only** — Optimal configuration:

```
llama-cli -m model.gguf --threads $(nproc) --batch-size 512 --mlock
```

**For low RAM:**

- Use Q4_K_M or Q3_K_M
- Reduce context: `--ctx-size 512`
- Disable mlock

## Profiling and Monitoring

### Built-in Performance Stats

Enable timing information:

```
llama-cli -m model.gguf --perf -p "Test prompt"
```

Outputs:

- Prompt evaluation time
- Token generation time
- Tokens per second

### Server Metrics

Query server metrics endpoint:

```
curl http://localhost:8080/metrics
```

Returns:

- Request counts
- Processing times
- KV cache usage
- Queue statistics

### Benchmark Tool

Systematic performance testing:

```
llama-bench -m model.gguf --n-prompt 512 --n-gen 128 -ngl 32 -t 4,8,16
```

Learn more: https://ggml-org-llama-cpp.mintlify.app/api/tools/llama-bench

## Common Performance Issues

**Very slow generation (<1 tok/s)**

Likely causes:

- Too many threads (oversaturation)
- No GPU acceleration
- Context size too large

Solutions:

- Set `--threads 1` and gradually increase
- Enable GPU layers: `--n-gpu-layers 32`
- Reduce context: `--ctx-size 2048`

**Out of memory errors**

Solutions:

- Use smaller quantization (Q4_K_M instead of Q8_0)
- Reduce context size: `--ctx-size 1024`
- Reduce batch size: `--batch-size 256`
- Offload fewer layers: `--n-gpu-layers 20`
- Enable mmap: `--mmap`

**GPU underutilized**

Check:

- Are layers offloaded? (check startup logs)
- Is batch size large enough? Try 512 or 1024
- Are you using optimal quantization? (Q4_K_M recommended)

Optimize:

```
llama-cli -m model.gguf --n-gpu-layers 999 --batch-size 1024 --ubatch-size 512
```

**Server slow with multiple requests**

Solutions:

- Increase `--n-parallel 8`
- Ensure batch size ≥ ctx-size × n-parallel
- Reduce per-request threads: `--threads 2`
- Enable continuous batching: `--cont-batching`

## Advanced Optimizations

### CPU Affinity

Bind threads to specific cores:

```
llama-cli -m model.gguf --cpu-mask 0xFF --cpu-strict 1
```

### Process Priority

Increase process priority:

```
llama-cli -m model.gguf --prio 2
```

Levels: `-1` (low), `0` (normal), `1` (medium), `2` (high), `3` (realtime)

### Polling Level

Reduce latency with busy-waiting:

```
llama-cli -m model.gguf --poll 100
```

Range: 0-100 (0=no polling, 100=full busy-wait)