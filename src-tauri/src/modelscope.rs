use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::huggingface::{extract_quant, is_imatrix_file, is_mmproj_file, parse_split_filename};

// ModelScope uses the same well-known GGUF quantizers as HuggingFace.
// Re-exported from huggingface module for consistency.
pub use crate::huggingface::KNOWN_GGUF_OWNERS;

// ── Public types (shared with frontend via Tauri commands) ──────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsModel {
    pub model_id: String,
    pub name: String,
    pub author: String,
    pub files: Vec<MsFile>,
    pub downloads: u64,
    pub likes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsFile {
    pub filename: String,
    pub size_bytes: u64,
    pub quant: Option<String>,
    pub download_url: String,
    #[serde(default)]
    pub is_split: bool,
    #[serde(default)]
    pub split_parts: Vec<MsFilePart>,
    #[serde(default)]
    pub is_mmproj: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MsFilePart {
    pub filename: String,
    pub size_bytes: u64,
    pub download_url: String,
}

// ── ModelScope OpenAPI response types ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsApiResponse {
    data: MsApiData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsApiData {
    models: Vec<MsApiModel>,
    total_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsApiModel {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    tags: Vec<String>,
}

// ── ModelScope file list response types ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsFileListResponse {
    #[serde(rename = "Data")]
    data: MsFileListData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsFileListData {
    #[serde(rename = "Files")]
    files: Vec<MsFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsFileEntry {
    #[serde(rename = "Type")]
    entry_type: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Path")]
    path: String,
    #[serde(rename = "Size")]
    size: Option<u64>,
}

// ── Public API functions ────────────────────────────────────────────────────

/// Search for GGUF models on ModelScope.
pub async fn search_models(
    client: &reqwest::Client,
    query: &str,
    owner: Option<&str>,
) -> Result<Vec<MsModel>> {
    let mut url = format!(
        "https://modelscope.cn/openapi/v1/models?search={}&sort=downloads&page_size=30",
        urlencoding_simple(query)
    );
    if let Some(owner) = owner {
        url = format!(
            "https://modelscope.cn/openapi/v1/models?owner={}&search={}&sort=downloads&page_size=50",
            urlencoding_simple(owner),
            urlencoding_simple(query)
        );
    }

    let response = client
        .get(&url)
        .header("User-Agent", "catapult-launcher/0.1")
        .send()
        .await
        .context("Failed to search ModelScope")?;

    if !response.status().is_success() {
        anyhow::bail!("ModelScope API error: {}", response.status());
    }

    let api_resp: MsApiResponse = response.json().await.context("Failed to parse ModelScope response")?;
    Ok(api_resp.data.models.into_iter().map(convert_model).collect())
}

/// Get GGUF files for a ModelScope model repo.
pub async fn get_repo_files(
    client: &reqwest::Client,
    model_id: &str,
) -> Result<Vec<MsFile>> {
    let url = format!(
        "https://modelscope.cn/api/v1/models/{}/repo/files?Root=&Revision=master",
        urlencoding_simple(model_id)
    );

    let response = client
        .get(&url)
        .header("User-Agent", "catapult-launcher/0.1")
        .send()
        .await
        .context("Failed to fetch ModelScope repo files")?;

    if !response.status().is_success() {
        anyhow::bail!("ModelScope file list API error: {}", response.status());
    }

    let file_resp: MsFileListResponse = response.json().await.context("Failed to parse ModelScope file list")?;

    let files: Vec<MsFile> = file_resp
        .data
        .files
        .into_iter()
        .filter(|e| e.entry_type == "blob" && e.path.ends_with(".gguf"))
        .filter(|e| !is_imatrix_file(&e.path))
        .map(|e| {
            let quant = extract_quant(&e.path);
            let download_url = format!(
                "https://modelscope.cn/api/v1/models/{}/repo?Revision=master&FilePath={}",
                model_id, e.path
            );
            let is_mmproj = is_mmproj_file(&e.path);
            MsFile {
                filename: e.path,
                size_bytes: e.size.unwrap_or(0),
                quant,
                download_url,
                is_split: false,
                split_parts: vec![],
                is_mmproj,
            }
        })
        .collect();

    Ok(consolidate_files(files))
}

// ── Internal helpers ────────────────────────────────────────────────────────

fn convert_model(m: MsApiModel) -> MsModel {
    let model_id = m.id.clone();
    let author = model_id.split('/').next().unwrap_or("unknown").to_string();
    let name = model_id.split('/').last().unwrap_or(&model_id).to_string();

    MsModel {
        model_id,
        name,
        author,
        files: vec![],
        downloads: m.downloads,
        likes: m.likes,
    }
}

/// Grouping key for split files.
fn split_group_key(path: &str) -> Option<String> {
    let dir_prefix = match path.rfind('/') {
        Some(pos) => &path[..=pos],
        None => "",
    };
    let (base, _, total) = parse_split_filename(path)?;
    Some(format!("{}{}-{:05}", dir_prefix, base, total))
}

/// Consolidate split GGUF files into single entries.
fn consolidate_files(files: Vec<MsFile>) -> Vec<MsFile> {
    use std::collections::BTreeMap;

    let mut singles: Vec<MsFile> = Vec::new();
    let mut split_groups: BTreeMap<String, Vec<MsFile>> = BTreeMap::new();

    for file in files {
        if let Some(key) = split_group_key(&file.filename) {
            split_groups.entry(key).or_default().push(file);
        } else {
            let basename = file.filename.rsplit('/').next().unwrap_or(&file.filename).to_string();
            let is_mmproj = is_mmproj_file(&basename);
            singles.push(MsFile {
                filename: basename,
                is_split: false,
                split_parts: vec![],
                is_mmproj,
                ..file
            });
        }
    }

    for (_key, mut parts) in split_groups {
        parts.sort_by_key(|f| {
            parse_split_filename(&f.filename).map(|(_, n, _)| n).unwrap_or(0)
        });

        let total_size: u64 = parts.iter().map(|p| p.size_bytes).sum();
        let quant = parts[0].quant.clone();

        let split_parts: Vec<MsFilePart> = parts
            .iter()
            .map(|p| {
                let basename = p.filename.rsplit('/').next().unwrap_or(&p.filename).to_string();
                MsFilePart {
                    filename: basename,
                    size_bytes: p.size_bytes,
                    download_url: p.download_url.clone(),
                }
            })
            .collect();

        let first = &parts[0];
        let first_basename = first.filename.rsplit('/').next().unwrap_or(&first.filename).to_string();

        singles.push(MsFile {
            filename: first_basename,
            size_bytes: total_size,
            quant,
            download_url: first.download_url.clone(),
            is_split: true,
            split_parts,
            is_mmproj: false,
        });
    }

    singles
}

fn urlencoding_simple(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => '+'.to_string(),
            c => format!("%{:02X}", c as u32),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consolidate_groups_split_files() {
        let files = vec![
            MsFile {
                filename: "Q4_K_M/model-Q4_K_M-00002-of-00003.gguf".into(),
                size_bytes: 200,
                quant: Some("Q4_K_M".into()),
                download_url: "https://example.com/Q4_K_M/model-Q4_K_M-00002-of-00003.gguf".into(),
                is_split: false,
                split_parts: vec![],
                is_mmproj: false,
            },
            MsFile {
                filename: "Q4_K_M/model-Q4_K_M-00001-of-00003.gguf".into(),
                size_bytes: 200,
                quant: Some("Q4_K_M".into()),
                download_url: "https://example.com/Q4_K_M/model-Q4_K_M-00001-of-00003.gguf".into(),
                is_split: false,
                split_parts: vec![],
                is_mmproj: false,
            },
            MsFile {
                filename: "Q4_K_M/model-Q4_K_M-00003-of-00003.gguf".into(),
                size_bytes: 200,
                quant: Some("Q4_K_M".into()),
                download_url: "https://example.com/Q4_K_M/model-Q4_K_M-00003-of-00003.gguf".into(),
                is_split: false,
                split_parts: vec![],
                is_mmproj: false,
            },
            MsFile {
                filename: "single-Q8_0.gguf".into(),
                size_bytes: 500,
                quant: Some("Q8_0".into()),
                download_url: "https://example.com/single-Q8_0.gguf".into(),
                is_split: false,
                split_parts: vec![],
                is_mmproj: false,
            },
        ];

        let result = consolidate_files(files);
        assert_eq!(result.len(), 2);

        let single = result.iter().find(|f| !f.is_split).unwrap();
        assert_eq!(single.filename, "single-Q8_0.gguf");
        assert_eq!(single.size_bytes, 500);

        let split = result.iter().find(|f| f.is_split).unwrap();
        assert_eq!(split.size_bytes, 600);
        assert_eq!(split.split_parts.len(), 3);
    }
}
