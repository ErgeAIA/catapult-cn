//! KV-cache memory budget estimator.
//!
//! Used to warn the user in the Server page *before* spawning
//! `llama-server` that the chosen `--ctx-size` plus the model's
//! architecture will not fit into the available VRAM, which is by
//! far the most common reason a freshly started server exits with
//! code 137 / OOM a few seconds into model load.
//!
//! The maths here is a simplified but conservative upper bound — it
//! intentionally over-counts rather than under-counts, because the
//! failure mode ("OOM at startup") is much worse than the
//! false-positive ("we lowered your ctx by 4K"):

use crate::hardware::SystemInfo;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Bytes per element for the most common KV cache quantisations.
/// `f16` and `bf16` are 2 bytes; q8_0 is ~0.6 bytes after the
/// per-block scale/bias; q4_0 ~0.34 bytes. We use the documented
/// llama.cpp "size per token" values that the server itself prints
/// in its startup banner ("llama_model_loader: - KV self size =
/// X MB") for verification, but those values include both K and V.
fn bytes_per_kv_elem(quant: &str) -> f64 {
    match quant {
        "f32" => 4.0,
        "f16" | "bf16" => 2.0,
        "q8_0" | "q8_1" => 1.0, // slightly under-counted, conservative
        "q4_0" | "q4_1" => 0.5, // ditto
        _ => 2.0,              // unknown → assume fp16
    }
}

/// Per-token KV cache size in bytes for one full transformer pass.
///
/// Each layer stores K and V per token, per KV-head.
/// Total per token = 2 (K + V) × head_dim × head_count_kv × block_count
///                    × bytes_per_elem.
pub fn kv_per_token_bytes(
    block_count: u64,
    head_count_kv: u64,
    head_dim: u64,
    kv_quant: &str,
) -> u64 {
    let bpe = bytes_per_kv_elem(kv_quant);
    let raw = 2.0 * (head_dim as f64) * (head_count_kv as f64)
        * (block_count as f64) * bpe;
    raw as u64
}

/// Estimate of the full KV cache in MB, given a model file path and a
/// target context size. Returns `None` if the GGUF metadata does not
/// contain enough information (older / non-standard quantisation).
pub fn estimate_kv_mb(model_path: &Path, n_ctx: u32, kv_quant: &str) -> Option<u64> {
    let meta = crate::models::read_gguf_metadata_for_estimate(model_path)?;
    let block_count = meta.block_count?;
    let head_count_kv = meta.head_count_kv?;
    let key_length = meta.key_length?;
    if block_count == 0 || head_count_kv == 0 || key_length == 0 {
        return None;
    }
    let per_token = kv_per_token_bytes(block_count, head_count_kv, key_length, kv_quant);
    // Add 8% headroom for llama.cpp's internal alignment / scratch.
    let total_bytes = (per_token as f64) * (n_ctx as f64) * 1.08;
    Some((total_bytes / (1024.0 * 1024.0)) as u64)
}

/// Hard limits applied to the on-screen warning. Conservative: we
/// trigger a yellow toast at 80% of available VRAM (after the model's
/// own weights are subtracted), and a red toast at 100%.
const WARN_THRESHOLD_PCT: f64 = 0.80;
const BLOCK_THRESHOLD_PCT: f64 = 1.00;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KvEstimate {
    /// Estimated total KV cache size in MB (for the chosen ctx).
    pub kv_total_mb: u64,
    /// Estimated weight size in MB (raw file size of the GGUF).
    pub model_weights_mb: u64,
    /// Sum of all detected GPUs' VRAM in MB.
    pub available_vram_mb: u64,
    /// VRAM remaining after the model weights and KV cache, in MB.
    pub headroom_mb: i64,
    /// 0..1 ratio of (weights + kv) / vram. >= 1.0 means we are
    /// predicted to OOM.
    pub usage_pct: f64,
    /// Human-readable warning, or `None` when no warning is needed.
    pub warning: Option<String>,
}

pub fn estimate_for_config(
    model_path: &Path,
    n_ctx: u32,
    kv_quant: &str,
    system: &SystemInfo,
) -> KvEstimate {
    let model_weights_mb = std::fs::metadata(model_path)
        .map(|m| m.len() / (1024 * 1024))
        .unwrap_or(0);
    let available_vram_mb: u64 = system
        .gpus
        .iter()
        .filter(|g| g.vram_mb > 0)
        .map(|g| g.vram_mb)
        .sum();
    // GGUF metadata may be missing on third-party re-quants (e.g.
    // Unsloth, mradermacher). In that case the architecture fields
    // are None and we cannot compute a reliable per-token KV figure.
    // We still surface a "cannot estimate" warning so the user is
    // not silently told the config is fine when we actually don't
    // know.
    let kv_meta = crate::models::read_gguf_metadata_for_estimate(model_path);
    let kv_arch_complete = kv_meta
        .map(|m| m.block_count.is_some() && m.head_count_kv.is_some() && m.key_length.is_some())
        .unwrap_or(false);
    let kv_total_mb = if kv_arch_complete {
        estimate_kv_mb(model_path, n_ctx, kv_quant).unwrap_or(0)
    } else {
        0
    };
    // Subtract 256 MB for llama.cpp runtime / driver overhead so we
    // do not flag configs that are technically tight but workable.
    let usable_vram_mb = available_vram_mb.saturating_sub(256);
    let used_mb = model_weights_mb.saturating_add(kv_total_mb);
    let headroom_mb = usable_vram_mb as i64 - used_mb as i64;
    let usage_pct = if usable_vram_mb == 0 {
        0.0
    } else {
        used_mb as f64 / usable_vram_mb as f64
    };

    let warning = if available_vram_mb == 0 {
        Some("No VRAM detected (integrated GPU or WSL1). KV cache will be served from RAM; the estimate below is only a lower bound.".to_string())
    } else if !kv_arch_complete {
        // We know the model size and the available VRAM, but not the
        // arch — flag it as "we cannot estimate KV" rather than
        // pretending the config is safe. Typical cause: a third-party
        // re-quant (Unsloth, mradermacher) that does not emit the
        // arch KV pairs the llama.cpp loader uses.
        Some(format!(
            "Cannot read the model architecture from the GGUF header (block_count / head_count_kv / key_length missing). \
             Weights ≈ {model_weights_mb} MB; VRAM {available_vram_mb} MB. Verify --ctx-size / KV cache type manually."
        ))
    } else if usage_pct >= BLOCK_THRESHOLD_PCT {
        Some(format!(
            "Predicted to OOM at startup: weights + KV cache ≈ {used_mb} MB but only {available_vram_mb} MB VRAM. \
             Try lowering --ctx-size, switching cache-type-k/v to q8_0 or q4_0, or offloading fewer layers to GPU."
        ))
    } else if usage_pct >= WARN_THRESHOLD_PCT {
        Some(format!(
            "Tight fit: weights + KV cache ≈ {used_mb} MB of {available_vram_mb} MB VRAM ({:.0}%). \
             The server may fail under sustained load.",
            usage_pct * 100.0
        ))
    } else {
        None
    };

    KvEstimate {
        kv_total_mb,
        model_weights_mb,
        available_vram_mb,
        headroom_mb,
        usage_pct,
        warning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_per_kv_elem_known_quants() {
        assert_eq!(bytes_per_kv_elem("f16"), 2.0);
        assert_eq!(bytes_per_kv_elem("q8_0"), 1.0);
        assert_eq!(bytes_per_kv_elem("q4_0"), 0.5);
    }

    #[test]
    fn kv_per_token_scales_linearly() {
        let a = kv_per_token_bytes(32, 8, 128, "f16") as f64;
        let b = kv_per_token_bytes(64, 8, 128, "f16") as f64;
        assert!((b / a - 2.0).abs() < 0.01, "doubling block_count must double per-token KV");
    }

    #[test]
    fn gemma_4_12b_q4_estimate_order_of_magnitude() {
        // gemma-4-12b-UD-Q4_K_XL: 46 layers, 8 KV heads, 256 head_dim, q8_0 KV
        // 2 * 256 * 8 * 46 * 1.0 = 188_416 bytes/token ≈ 184 KB/token
        let per_token = kv_per_token_bytes(46, 8, 256, "q8_0");
        assert!(per_token > 180_000 && per_token < 200_000,
            "gemma 4 12B q8_0 per-token KV should be ~184KB, got {}", per_token);
        // 65536 ctx -> ~12 GB
        let total_mb = (per_token as f64) * 65536.0 * 1.08 / (1024.0 * 1024.0);
        assert!(total_mb > 12_000.0 && total_mb < 14_000.0,
            "65K ctx KV should be ~12-13 GB, got {} MB", total_mb);
    }
}
