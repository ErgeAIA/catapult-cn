use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::runtime::ReleaseInfo;

/// On-disk shape: release info + ETag for conditional requests.
/// ETag is the only field that controls whether GitHub returns 304.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedRelease {
    pub etag: String,
    pub cached_at: i64,
    pub release: ReleaseInfo,
}

fn cache_path() -> Result<PathBuf> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Cannot find config directory"))?;
    Ok(config_dir.join("catapult").join("release_cache.json"))
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Read the cached release (if any). Returns None when:
/// - the file is missing or unreadable
/// - the JSON is corrupt
/// - the ETag is empty (cannot be used for conditional GET)
/// Cache is **not expired by time** — staleness is decided by the caller
/// (network success vs. failure), not by TTL. This means a cached entry
/// is always usable as a last-resort fallback for offline / rate-limited runs.
pub fn load_cached_release() -> Option<CachedRelease> {
    let path = cache_path().ok()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let parsed: CachedRelease = serde_json::from_str(&content).ok()?;
    if parsed.etag.is_empty() {
        return None;
    }
    Some(parsed)
}

/// Persist release + etag. Errors are logged, not propagated, so a
/// cache write failure never breaks the user-facing download flow.
pub fn save_cached_release(release: &ReleaseInfo, etag: &str) {
    let path = match cache_path() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("release_cache: cannot resolve path: {e}");
            return;
        }
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let cached = CachedRelease {
        etag: etag.to_string(),
        cached_at: now_secs(),
        release: release.clone(),
    };
    match serde_json::to_string_pretty(&cached) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log::warn!("release_cache: write failed: {e}");
            }
        }
        Err(e) => log::warn!("release_cache: serialize failed: {e}"),
    }
}

/// Test-only: discard the cache file.
#[cfg(test)]
pub fn clear_for_test() {
    if let Ok(p) = cache_path() {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{AssetOption, ReleaseInfo};
    use std::sync::{Mutex, OnceLock};

    /// Serialize tests that all touch the same release_cache.json file.
    fn test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn sample_release() -> ReleaseInfo {
        ReleaseInfo {
            tag_name: "b9590".to_string(),
            build: 9590,
            published_at: "2026-06-10T00:00:00Z".to_string(),
            available_assets: vec![AssetOption {
                name: "llama-b9590-bin-win-cpu-x64.zip".to_string(),
                backend_id: "cpu".to_string(),
                backend_label: "CPU".to_string(),
                platform: "windows".to_string(),
                download_url: "https://example.com/x.zip".to_string(),
                size_mb: 15,
                score: 20,
                kind: "main".to_string(),
            }],
        }
    }

    #[test]
    fn save_then_load_round_trip() {
        let _g = test_lock().lock().unwrap();
        clear_for_test();
        let r = sample_release();
        save_cached_release(&r, "W/\"abc123\"");
        let loaded = load_cached_release().expect("should load");
        assert_eq!(loaded.etag, "W/\"abc123\"");
        assert_eq!(loaded.release.tag_name, "b9590");
        assert_eq!(loaded.release.available_assets.len(), 1);
        clear_for_test();
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let _g = test_lock().lock().unwrap();
        clear_for_test();
        assert!(load_cached_release().is_none());
    }

    #[test]
    fn load_returns_none_when_corrupt_json() {
        let _g = test_lock().lock().unwrap();
        clear_for_test();
        let path = cache_path().unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{not valid json").unwrap();
        assert!(load_cached_release().is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_returns_none_when_etag_empty() {
        let _g = test_lock().lock().unwrap();
        clear_for_test();
        let r = sample_release();
        save_cached_release(&r, "");
        assert!(load_cached_release().is_none(),
            "empty ETag is treated as invalid (cannot do conditional GET)");
        clear_for_test();
    }
}
