# Changelog

## [0.1.5-1] - 2026-06-11

### Fixed

- **Runtime download fails with no feedback under GitHub API rate limit (403)**: When `api.github.com/repos/ggml-org/llama.cpp/releases/latest` returns 403 (anonymous rate limit, common in mainland China), `fetch_latest_release` now falls back to a local ETag-aware cache (`%APPDATA%\catapult\release_cache.json`) and serves the last known release so the user can still browse and download assets. Subsequent successful requests send `If-None-Match` so 304 responses do not consume the rate limit.

- **Runtime: HTTP proxy support actually wired up**: The `HTTPS_PROXY` / `HTTP_PROXY` support claimed in the previous bullet was not functional at first because `Cargo.toml` sets `default-features = false` on `reqwest` without re-enabling the `proxy` feature. This fix:
  - Adds the `system-proxy` cargo feature to `reqwest` (Windows WinHTTP / macOS system configuration auto-detection — covers Clash / V2RayN "Allow LAN" on Windows and Surge / ClashX on macOS)
  - Reads `ALL_PROXY` → `HTTPS_PROXY` → `HTTP_PROXY` (both upper- and lower-case variants, six names) in priority order and feeds the first non-empty value to `reqwest::Proxy::all()`
  - Raises the shared HTTP client base timeout from 30s to 120s
  - Sets a per-request timeout of 300s on `download_runtime` so 100+ MB release assets have headroom over slow proxy / Chinese links; the `download_progress` event stream is still available for the UI to detect a stalled connection

- **CUDA DLL companion packages no longer hijack the active runtime**: `cudart-llama-bin-*.zip` is now correctly classified as an auxiliary package (`kind: "cuda_dlls"`, score `-1000`) in both `AssetOption` and `ManagedRuntime`. Downloading it is allowed (users still need it alongside the main CUDA package) but it never becomes the active runtime and never triggers auto-delete of other backends. The UI now shows a "CUDA DLLs" badge on the asset row and a hint banner after a cudart download pointing the user to the matching main package (e.g. `llama-b<build>-bin-win-cuda-XX.X-x64.zip`).

- **Runtime page: prominent error banner with one-click copy**: the old single-line red text was easy to miss, often truncated, and gave users no way to report what went wrong. It is now replaced with an `ErrorBanner` that shows a red border + title (switches to "GitHub API rate limit" with proxy/wait guidance when 403/429 is detected), the full error text (truncated by default, click to expand), a "Copy details" button (with transient "Copied" feedback; falls back to expand when the clipboard API is unavailable), and a dismiss button. Every error source is now tagged with an `errorContext` label (`fetch latest release` / `download runtime` / `activate runtime` / etc.); the copied payload is `Action` / `Time` / `Error` for easier triage. New i18n keys: `errorTitle`, `errorRateLimitTitle`, `errorRateLimitHint`, `errorCopyDetails`, `errorCopied`, `errorDismiss`.

- **Runtime page: netdisk mirror entry (Quark)**: a new "Netdisk" button (`CloudDownload` icon) is added to the header of the "Download runtime" card, sitting to the left of the existing Refresh button. Clicking it routes through `invoke('open_url')` (with a `window.open` fallback) to the Quark netdisk mirror (https://pan.quark.cn/s/22a140f65f88?pwd=TXQs) — useful for users in mainland China where GitHub release assets are slow even after the proxy support. New i18n keys: `netdiskDownload`, `netdiskTitle`.

- **Runtime page: latest-version label is now a link to GitHub**: the "Latest: b9594" text is now a button with an `ArrowUpRight` icon, hovering turns it primary-colored and underlined. Clicking it opens the corresponding GitHub release page (`https://github.com/ggml-org/llama.cpp/releases/tag/{tag_name}`) through `invoke('open_url')`. New i18n key: `openReleaseOnGithub`.

- **Server logs: one-click copy button**: a new copy button (`ClipboardCopy` icon) is added to the right of the "Server logs" header, sitting next to the existing collapse chevron. Clicking it writes the `logs` array joined by `\n` to the clipboard via `navigator.clipboard.writeText` (with a hidden `<textarea>` + `document.execCommand("copy")` fallback when the Clipboard API is unavailable). For 1.5s the icon swaps to a primary-colored `CircleCheck` as a transient "copied" affordance. The button auto-disables when `logs.length === 0`. **v0.1.5-1 fix**: the outer wrapper `<button>` was split into a title-area `<button>` + an action-area `<div>` + a separate collapse `<button>`. The HTML spec forbids `<button>` inside `<button>` — the browser silently hoists the inner element, so `e.stopPropagation()` cannot prevent the outer collapse handler from firing (which manifested as "clicking copy collapsed the panel"). `aria-label` for the collapse control now uses dedicated `collapsePanel` / `expandPanel` keys. New i18n keys: `server.labels.copyLogs`, `logsCopied`, `collapsePanel`, `expandPanel`.

- **Server: fix `--fit` consuming the next flag as its value, causing startup to fail**: on the Server tab, the `Fit` field is a dropdown (`on` / `off`). When the UI picks `on` it stores `extra_params["fit"] = ""`. The old `build_args` emitted a bare `--fit` (no value) for every empty `extra_params` entry, producing `… --fit --kv-unified …` on the command line — `llama-server` then parsed `--kv-unified` as the value of `--fit` and exited with `unknown value for --fit: '--kv-unified'`. The fix introduces an `OPTIONAL_ON_OFF_FLAGS` allow-list (`fit`, `no-warmup`, `warmup` for now) in `build_args`: when an entry is on the list, an empty value is expanded to `on`; a non-empty value is passed through verbatim. All other flags keep the previous "drop empty value" behaviour so we do not pollute the command line. Three regression tests cover the on, off, and unaffected-flag cases.

- **Server: pre-flight KV-cache budget warning (`estimate_kv_usage`)**: the GGUF header parser now also reads the architecture fields `embedding_length` / `block_count` / `attention.head_count_kv` / `attention.key_length`. Combined with the user-configured `n_ctx` and `cache_type_k` (f16 / q8_0 / q4_0 / …), a new Tauri command `estimate_kv_usage` computes an upper bound on KV-cache memory using `2 × head_dim × head_count_kv × block_count × bpe × ctx × 1.08`, adds the model file size, and compares the total against the sum of `GpuInfo.vram_mb`:
  - `usage_pct < 0.80` — no banner
  - `0.80 ≤ usage_pct < 1.00` — yellow "Tight fit: …" toast above the Launch button
  - `usage_pct ≥ 1.00` — yellow "Predicted to OOM at startup: …" toast (informational only; does not block startup)
  - No GPUs detected (integrated graphics / WSL1) — friendly "lower bound only" message
  The toast shows three numbers (weights / KV / VRAM) and a dismiss button. New `kv_estimate` Rust module with two unit tests, new `KvEstimate` TS type, and i18n keys `kvWarningTitle` / `kvWarningHint`. **Typical trigger**: RTX 5080 (16 GB) + 32 GB RAM + gemma-4-12b-it-UD-Q4_K_XL (6.86 GB) + ctx=65536 + KV=q8_0 ⇒ ~13 GB KV ⇒ OOM warning suggests dropping to ctx=16384.

## [0.1.5] - 2026-05-18

### Fixed

- **Added MTP support**: added support for MTP parameters

## [0.1.4] - 2026-05-05

### Fixed

- **Updated server parameters**: Updated parameters to match current `master` for llama.cpp

- **Bump versions and synchronize**: Bumped and synchronized Tauri versions

## [0.1.3] - 2026-04-16

### Fixed

- **macOS app unresponsive (issue #8)**: The debounce introduced in 0.1.2 did not fully resolve the issue. The root cause was the initial `isMaximized()` call on mount, which on macOS triggers a resize event, which calls `isMaximized()` again — an infinite loop. Removed the initial call entirely; the debounced resize handler already keeps the maximize indicator in sync.

- **TUI crash in logs tab (issue #13)**: After restarting the server, the new log file is shorter than the previous one. If the scroll position was beyond the end of the new log, the slice operation panicked with an out-of-range index. The scroll offset is now clamped to the new line count on every tick, with an additional guard in the render path.

## [0.1.2] - 2026-04-13

### Fixed

- **macOS app unresponsive (issue #8)**: Calling `isMaximized()` inside the window resize handler triggered an infinite resize event loop on macOS, freezing the entire UI. The check is now debounced so the loop cannot form.

- **`--parallel 1` not emitted (issue #11)**: The `--parallel` flag was only emitted when the value was greater than 1. Since llama.cpp defaults to 4 parallel slots when the flag is omitted, users could not explicitly request single-slot mode from the UI. The flag is now always emitted.

- **`--no-cont-batching` not emitted (issue #11)**: Disabling continuous batching in the UI had no effect — the `--no-cont-batching` flag was never passed to llama-server. It is now emitted when the toggle is off.

- **Virtual GPU selected over real GPU on Windows (issue #9)**: GPU detection via WMI returned all video adapters in arbitrary order, so virtual adapters (Hyper-V, Microsoft Basic Display, VMware, etc.) could be picked as the primary GPU. Virtual adapters are now filtered out when a real GPU is present.

- **Server process orphaned on GUI exit (issue #7)**: Closing the GUI window without stopping the server left llama-server running in the background with no way to reattach. A shutdown handler now terminates the server process when the app exits.

- **Zombie server processes in TUI (issue #7)**: Stopped llama-server processes lingered as zombies in the process table until the TUI itself exited. The child process handle is now properly dropped instead of leaked via `mem::forget`, and `waitpid` is called after the process is confirmed dead.

- **Console windows flashing on Windows (issue #10)**: Every child process spawned for hardware detection (PowerShell, nvidia-smi, etc.) opened a visible console window. All subprocess invocations now use `CREATE_NO_WINDOW` to suppress them.

## [0.1.1] - 2026-04-10

### Fixed

- **App icon**: Replaced placeholder purple square icons with a proper catapult icon across all platforms (PNG, ICO, ICNS) and added the missing web favicon SVG.

- **Per-backend runtime management**: Managed runtimes are now identified by both build number and backend (e.g., CUDA, Vulkan, ROCm). Previously, only the build number was used, which prevented users from installing and switching between multiple backends of the same build version. Downloading a new backend no longer removes existing backends for the same build. Auto-delete of old runtimes now only removes outdated versions of the same backend type.

- **mmproj download filename**: When downloading a vision projection (mmproj) file alongside a core model, the mmproj filename is now prefixed with the core model's base name (e.g., `Qwen2.5-VL-7B-mmproj-f16.gguf` instead of just `mmproj-f16.gguf`). This ensures the mmproj is correctly detected and paired with its companion model.

- **mmproj detection via GGUF metadata**: Vision projection files are now detected not only by filename (containing "mmproj") but also by GGUF metadata (`general.architecture == "clip"`). This fixes detection for mmproj files from repositories that don't include "mmproj" in the filename. Detected mmproj files are also excluded from the main installed models list.

- **Config erasure on runtime download**: The runtime download handler previously cloned the config before the async operation and wrote it back after completion, which could silently discard any concurrent config changes (e.g., model selection, preset saves) made while the download was in progress. The download now returns a structured result that is applied atomically to the live config under its mutex lock.

- **Config robustness**: If the config file fails to parse on startup, Catapult now backs it up to `config.json.bak` before falling back to defaults, preserving the original data for recovery. The `auto_check_updates` setting now correctly defaults to `true` for new installs (previously it could silently default to `false` if the field was absent from the JSON).

### Added

- **Custom runtime: source distribution auto-import**: When browsing for a custom runtime, Catapult now detects llama.cpp source distributions by the presence of `CMakeLists.txt`. All `llama-server` binaries found under the tree are automatically registered as individual custom runtime entries, making it easy to switch between build configurations (e.g., CUDA vs. Vulkan builds) from a local build tree.

- **One-click runtime update**: The "Update available" banner on the Runtime page now triggers the download inline and displays a progress bar in place, instead of redirecting to the releases browser. The releases browser remains available for manual version selection.

- **Scanning spinner**: A loading overlay is displayed while Catapult scans a selected directory for `llama-server` binaries, providing feedback for large source trees that take a moment to traverse.

## [0.1.0] - Initial release

First public release of Catapult, a GUI/TUI launcher for llama.cpp.
