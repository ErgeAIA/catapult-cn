import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Download,
  RefreshCw,
  CheckCircle,
  FolderOpen,
  ChevronDown,
  ChevronUp,
  Zap,
  Package,
  Trash2,
  Play,
  Archive,
  AlertCircle,
  X,
  Copy,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  RuntimeInfo,
  ReleaseInfo,
  AssetOption,
  BackendInfo,
  CustomBuild,
  ScanResult,
  DownloadProgress,
  AppConfig,
} from "../types";

function mbToStr(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export default function Runtime() {
  const { t } = useTranslation();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// Short label for the action that produced the current error
  /// (e.g. "fetch release", "download runtime") so the user can include
  /// it when filing a bug report. Cleared together with `error`.
  const [errorContext, setErrorContext] = useState<string | null>(null);
  const [showReleases, setShowReleases] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [customBuilds, setCustomBuilds] = useState<CustomBuild[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<DownloadProgress | null>(null);
  /// Set when the most recent download was an auxiliary package
  /// (e.g. cudart-llama-bin-*) so we can prompt the user to grab
  /// the matching main package.
  const [auxiliaryHint, setAuxiliaryHint] = useState<string | null>(null);

  // Surface an error along with a short human-readable label of the
  // action that produced it, so the user can include both when pasting
  // the error into a bug report.
  const reportError = (msg: string, ctx: string) => {
    setError(msg);
    setErrorContext(ctx);
  };

  const loadData = async () => {
    try {
      const [rt, bk, cfg] = await Promise.all([
        invoke<RuntimeInfo>("get_runtime_info"),
        invoke<BackendInfo[]>("get_available_backends"),
        invoke<AppConfig>("get_config"),
      ]);
      setRuntime(rt);
      setBackends(bk);
      setAppConfig(cfg);
    } catch (e) {
      reportError(String(e), "load runtime info");
    }
  };

  const checkUpdate = async () => {
    setChecking(true);
    setError(null);
    setErrorContext(null);
    try {
      const rel = await invoke<ReleaseInfo>("check_latest_release");
      setRelease(rel);
      if (rel.available_assets.length > 0) {
        setSelectedAsset(rel.available_assets[0].name);
      }
    } catch (e) {
      reportError(String(e), "fetch latest release");
    } finally {
      setChecking(false);
    }
  };

  const startDownload = async () => {
    if (!selectedAsset) return;
    setDownloading(true);
    setError(null);
    setErrorContext(null);
    setProgress({ id: "runtime", bytes_downloaded: 0, total_bytes: 0, percent: 0, status: "downloading" });
    const unlisten = await listen<DownloadProgress>("download_progress", (e) => {
      setProgress(e.payload);
    });
    try {
      await invoke("download_runtime", { assetName: selectedAsset });
      await loadData();
      setProgress(null);
      // If the just-downloaded asset is a CUDA-DLLs companion, hint the
      // user that they still need the main package. The backend stores
      // it as `is_auxiliary=true` but does not switch active_runtime.
      const asset = release?.available_assets.find((a) => a.name === selectedAsset);
      if (asset?.kind === "cuda_dlls") {
        setAuxiliaryHint(selectedAsset);
      } else {
        setAuxiliaryHint(null);
        setShowReleases(false);
      }
    } catch (e) {
      reportError(String(e), "download runtime");
    } finally {
      unlisten();
      setDownloading(false);
    }
  };

  const cancelDownload = () => {
    setDownloading(false);
    setProgress(null);
  };

  const startUpdate = async () => {
    // Use already-fetched release info; pick the best asset
    let rel = release;
    if (!rel) {
      try {
        rel = await invoke<ReleaseInfo>("check_latest_release");
        setRelease(rel);
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    const asset = rel.available_assets[0]?.name;
    if (!asset) {
      setError(t('runtime.noCompatibleAssets'));
      return;
    }
    setUpdating(true);
    setError(null);
    setUpdateProgress({ id: "runtime", bytes_downloaded: 0, total_bytes: 0, percent: 0, status: "downloading" });
    const unlisten = await listen<DownloadProgress>("download_progress", (e) => {
      setUpdateProgress(e.payload);
    });
    try {
      await invoke("download_runtime", { assetName: asset });
      await loadData();
      setUpdateProgress(null);
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setUpdating(false);
    }
  };

  const browseCustom = async () => {
    const selected = await open({ directory: true, title: t('runtime.selectDirectory') });
    if (!selected) return;
    flushSync(() => { setScanning(true); setError(null); });
    try {
      const result = await invoke<ScanResult>("scan_custom_runtime", { path: selected });
      if (result.builds.length === 0) {
        setCustomBuilds(null);
        setError(t('wizard.noBuildFound'));
      } else if (result.is_source_distribution) {
        // llama.cpp source tree: add all builds as custom runtimes
        await invoke("add_all_custom_runtime_binaries", {
          builds: result.builds,
        });
        setCustomBuilds(null);
        await loadData();
      } else if (result.builds.length === 1) {
        await invoke("set_custom_runtime_binary", { binaryPath: result.builds[0].binary_path });
        setCustomBuilds(null);
        await loadData();
      } else {
        setCustomBuilds(result.builds);
      }
    } catch (e) {
      reportError(String(e), "scan custom runtime");
    } finally {
      setScanning(false);
    }
  };

  const selectBuild = async (build: CustomBuild) => {
    try {
      await invoke("set_custom_runtime_binary", { binaryPath: build.binary_path });
      await loadData();
    } catch (e) {
      reportError(String(e), "set custom runtime");
    }
  };

  const activateManaged = async (build: number, backendId: string) => {
    try {
      await invoke("set_active_runtime", { runtimeType: "managed", id: build, backendId });
      await loadData();
    } catch (e) {
      reportError(String(e), "activate managed runtime");
    }
  };

  const activateCustom = async (index: number) => {
    try {
      await invoke("set_active_runtime", { runtimeType: "custom", id: index });
      await loadData();
    } catch (e) {
      reportError(String(e), "activate custom runtime");
    }
  };

  const deleteManaged = async (build: number, backendId: string) => {
    try {
      await invoke("delete_managed_runtime", { build, backendId });
      await loadData();
    } catch (e) {
      reportError(String(e), "delete managed runtime");
    }
  };

  const removeCustom = async (index: number) => {
    try {
      await invoke("remove_custom_runtime", { index });
      await loadData();
    } catch (e) {
      reportError(String(e), "remove custom runtime");
    }
  };

  const toggleAutoDelete = async (enabled: boolean) => {
    try {
      await invoke("set_auto_delete_runtimes", { enabled });
      await loadData();
    } catch (e) {
      reportError(String(e), "toggle auto-delete");
    }
  };

  useEffect(() => {
    loadData().then(() => checkUpdate());
  }, []);

  const managed = appConfig?.managed_runtimes ?? [];
  const custom = appConfig?.custom_runtimes ?? [];
  const activeType = appConfig?.active_runtime?.type ?? "none";
  const activeBuild = activeType === "managed" ? (appConfig?.active_runtime as { build: number; backend_id: string }).build : null;
  const activeBackendId = activeType === "managed" ? (appConfig?.active_runtime as { build: number; backend_id: string }).backend_id : null;
  const activeCustomIdx = activeType === "custom" ? (appConfig?.active_runtime as { index: number }).index : null;

  const latestBuild = release?.build;
  const updateAvailable = activeBuild != null && latestBuild != null && latestBuild > activeBuild;

  // Split managed runtimes: archived = older than latest release
  const archivedMr = latestBuild != null
    ? managed.filter((r) => r.build < latestBuild)
    : [];
  const currentMr = managed.filter((r) => !archivedMr.includes(r));

  const displayedAssets = showAll
    ? release?.available_assets ?? []
    : (release?.available_assets ?? []).slice(0, 5);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">{t('runtime.title')}</h1>
        <p className="text-gray-500 text-sm mt-1">
          {t('runtime.desc')}
        </p>
      </div>

      {error && (
        <ErrorBanner
          error={error}
          context={errorContext}
          onDismiss={() => { setError(null); setErrorContext(null); }}
        />
      )}

      {scanning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card flex items-center gap-3 px-6 py-4">
            <RefreshCw size={16} className="text-primary animate-spin" />
            <span className="text-sm text-gray-200">{t('runtime.searchingRuntimes')}</span>
          </div>
        </div>
      )}

      {/* ── Active Runtime ── */}
      <div className="card">
        <h2 className="section-title">{t('runtime.activeRuntime')}</h2>
        {runtime?.installed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-accent-green" />
              <span className="text-sm text-gray-200">
                {runtime.runtime_type === "managed" ? (
                  <>{t('runtime.build')} <span className="font-mono">b{runtime.build}</span></>
                ) : (
                  t('runtime.custom')
                )}
                {runtime.backend && (
                  <span className="uppercase text-xs text-primary-light font-medium ml-2">
                    {runtime.backend}
                  </span>
                )}
              </span>
              <span className={`badge-${runtime.runtime_type === "managed" ? "purple" : "gray"} text-[10px]`}>
                {runtime.runtime_type}
              </span>
            </div>
            {runtime.path && (
              <p className="text-xs text-gray-500 font-mono">{runtime.path}</p>
            )}
            {updateAvailable && !updating && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 border border-accent-yellow/30 bg-accent-yellow/5">
                <Package size={13} className="text-accent-yellow" />
                <span className="text-xs text-accent-yellow">
                  {t('runtime.updateAvailable', { version: `b${latestBuild}` })}
                </span>
                <button className="btn-primary text-xs ml-auto" onClick={startUpdate}>
                  <Download size={12} /> {t('runtime.update')}
                </button>
              </div>
            )}
            {updating && (
              <div className="mt-2 px-3 py-2 border border-primary/30 bg-primary/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-300">
                    {updateProgress?.status === "extracting" ? t('runtime.extracting') : t('runtime.updating')}
                  </span>
                  <span className="text-xs font-mono text-gray-400">{(updateProgress?.percent ?? 0).toFixed(1)}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${updateProgress?.percent ?? 0}%` }} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{t('runtime.noRuntime')}</p>
            <div className="flex gap-2">
              <button className="btn-primary text-xs" onClick={() => setShowReleases(true)}>
                <Download size={12} /> {t('runtime.download')}
              </button>
              <button className="btn-ghost text-xs" onClick={browseCustom}>
                <FolderOpen size={12} /> {t('runtime.custom')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Auxiliary package hint (after a cudart- download) ── */}
      {auxiliaryHint && (
        <div className="card border-accent-yellow/30 bg-accent-yellow/5">
          <div className="flex items-start gap-2">
            <Package size={14} className="text-accent-yellow mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-accent-yellow">
                {t('runtime.auxiliaryRecorded', {
                  main: auxiliaryHint.replace(/^cudart-/, "llama-"),
                })}
              </p>
            </div>
            <button
              className="btn-ghost text-xs py-0.5 px-1.5 text-gray-500 hover:text-gray-300"
              onClick={() => setAuxiliaryHint(null)}
              title="Dismiss">
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Custom build picker ── */}
      {customBuilds && customBuilds.length > 1 && (
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="section-title">{t('runtime.multipleBuilds')}</h2>
              <p className="section-desc">{t('runtime.selectBuild')}</p>
            </div>
            <button className="btn-ghost text-xs" onClick={() => setCustomBuilds(null)}>{t('runtime.dismiss')}</button>
          </div>
          <div className="space-y-1.5">
            {customBuilds.map((b) => (
              <button key={b.binary_path}
                className="w-full flex items-center gap-3 px-3 py-2.5 border border-border hover:border-border-strong hover:bg-surface-3 text-left transition-colors"
                onClick={() => selectBuild(b)}>
                <Zap size={14} className="text-primary-light shrink-0" />
                <span className="text-sm font-mono text-gray-200 truncate">{b.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Managed Runtimes ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title mb-0">{t('runtime.managedRuntimes')}</h2>
          <div className="flex items-center gap-2">
            {managed.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={appConfig?.auto_delete_old_runtimes ?? false}
                  onChange={(e) => toggleAutoDelete(e.target.checked)}
                  className="accent-primary" />
                {t('runtime.autoDelete')}
              </label>
            )}
            <button className="btn-secondary text-xs" onClick={() => setShowReleases(true)}>
              <Download size={12} /> {managed.length > 0 ? t('runtime.newVersion') : t('runtime.download')}
            </button>
          </div>
        </div>

        {managed.length === 0 ? (
          <p className="text-sm text-gray-500">{t('runtime.noManaged')}</p>
        ) : (
          <>
            {/* Current managed runtimes */}
            <div className="space-y-1.5">
              {currentMr.map((r) => {
                const isActive = r.build === activeBuild && r.backend_id === activeBackendId;
                return (
                  <div key={`${r.build}-${r.backend_id}`}
                    className={`flex items-center gap-3 px-3 py-2.5 border ${
                      isActive ? "border-primary/40 bg-primary/5" : "border-border"
                    }`}>
                    {isActive && <CheckCircle size={14} className="text-primary shrink-0" />}
                    <span className={`text-sm font-mono ${isActive ? "text-gray-200" : "text-gray-400"}`}>b{r.build}</span>
                    <span className={`text-xs uppercase ${isActive ? "text-primary-light" : "text-gray-500"}`}>{r.backend_label}</span>
                    {isActive ? (
                      <span className="badge-purple text-[10px] ml-auto">{t('runtime.active')}</span>
                    ) : (
                      <>
                        <span className="text-xs text-gray-600 ml-auto">
                          {new Date(r.installed_at * 1000).toLocaleDateString()}
                        </span>
                        <button className="btn-ghost text-xs py-0.5 px-1.5"
                          onClick={() => activateManaged(r.build, r.backend_id)} title={t('runtime.activate')}>
                          <Play size={11} />
                        </button>
                        <button className="text-gray-600 hover:text-accent-red"
                          onClick={() => deleteManaged(r.build, r.backend_id)} title={t('runtime.delete')}>
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Archived runtimes (older than latest release) */}
            {archivedMr.length > 0 && (
              <>
                <button className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mt-2"
                  onClick={() => setShowArchived(!showArchived)}>
                  <Archive size={12} />
                  {showArchived ? t('runtime.hide') : t('runtime.show')} {archivedMr.length} {t('runtime.archived')}
                  {showArchived ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                {showArchived && (
                  <div className="space-y-1.5 mt-2">
                    {archivedMr.map((r) => (
                      <div key={`${r.build}-${r.backend_id}`}
                        className="flex items-center gap-3 px-3 py-2 border border-border">
                        <span className="text-sm font-mono text-gray-400">b{r.build}</span>
                        <span className="text-xs text-gray-500 uppercase">{r.backend_label}</span>
                        <span className="text-xs text-gray-600 ml-auto">
                          {new Date(r.installed_at * 1000).toLocaleDateString()}
                        </span>
                        <button className="btn-ghost text-xs py-0.5 px-1.5"
                          onClick={() => activateManaged(r.build, r.backend_id)} title={t('runtime.activate')}>
                          <Play size={11} />
                        </button>
                        <button className="text-gray-600 hover:text-accent-red"
                          onClick={() => deleteManaged(r.build, r.backend_id)} title={t('runtime.delete')}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Custom Runtimes ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title mb-0">{t('runtime.customRuntimes')}</h2>
          <button className="btn-ghost text-xs" onClick={browseCustom}>
            <FolderOpen size={12} /> {t('runtime.addCustom')}
          </button>
        </div>
        {custom.length === 0 ? (
          <p className="text-sm text-gray-500">{t('runtime.noCustom')}</p>
        ) : (
          <div className="space-y-1.5">
            {custom.map((c, i) => {
              const isActive = activeCustomIdx === i;
              return (
                <div key={i}
                  className={`flex items-center gap-3 px-3 py-2 border transition-colors ${
                    isActive ? "border-primary/40 bg-primary/5" : "border-border"
                  }`}>
                  <span className="text-sm text-gray-200">{c.label}</span>
                  <span className="text-xs text-gray-500 font-mono truncate flex-1">{c.binary_path}</span>
                  {isActive ? (
                    <span className="badge-purple text-[10px]">{t('runtime.active')}</span>
                  ) : (
                    <>
                      <button className="btn-ghost text-xs py-0.5 px-1.5" onClick={() => activateCustom(i)}>
                        <Play size={11} />
                      </button>
                      <button className="text-gray-600 hover:text-accent-red" onClick={() => removeCustom(i)}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Available Backends ── */}
      <div className="card">
        <h2 className="section-title">{t('runtime.availableBackends')}</h2>
        <p className="section-desc">{t('runtime.backendDesc')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {backends.map((b) => (
            <div key={b.id}
              className={`flex items-start gap-2 p-3 border ${
                b.available ? "border-accent-green/30 bg-accent-green/5" : "border-border bg-surface-3 opacity-50"
              }`}>
              <Zap size={13} className={b.available ? "text-accent-green mt-0.5" : "text-gray-600 mt-0.5"} />
              <div>
                <p className="text-xs font-medium text-gray-200">{b.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{b.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── GitHub Releases (toggleable) ── */}
      {showReleases && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title mb-0">{t('runtime.downloadRuntime')}</h2>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={checkUpdate} disabled={checking}>
                <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
                {t('runtime.refresh')}
              </button>
              <button className="btn-ghost text-xs" onClick={() => setShowReleases(false)}>{t('runtime.close')}</button>
            </div>
          </div>

          {release ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Package size={14} className="text-gray-400" />
                <span className="text-sm text-gray-300">
                  {t('runtime.latest')} <span className="font-mono text-gray-100">{release.tag_name}</span>
                </span>
                <span className="text-xs text-gray-600 ml-auto">
                  {new Date(release.published_at).toLocaleDateString()}
                </span>
              </div>

              <div className="space-y-1.5">
                {displayedAssets.map((asset) => (
                  <AssetRow key={asset.name} asset={asset}
                    selected={selectedAsset === asset.name}
                    onSelect={() => setSelectedAsset(asset.name)} />
                ))}
              </div>

              {(release.available_assets.length > 5) && (
                <button className="btn-ghost text-xs mt-2 w-full justify-center"
                  onClick={() => setShowAll(!showAll)}>
                  {showAll
                    ? <><ChevronUp size={13} /> {t('runtime.showFewer')}</>
                    : <><ChevronDown size={13} /> {t('runtime.showAll', { count: release.available_assets.length })}</>}
                </button>
              )}

              {selectedAsset && (
                <div className="mt-4">
                  {downloading ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-300">
                          {progress?.status === "extracting" ? t('runtime.extracting') : t('runtime.downloading')}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gray-400">{(progress?.percent ?? 0).toFixed(1)}%</span>
                          {progress?.status !== "extracting" && (
                            <button className="btn-ghost text-xs text-accent-red py-0.5" onClick={cancelDownload}>
                              {t('runtime.cancel')}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
                      </div>
                    </div>
                  ) : (
                    <button className="btn-primary w-full justify-center" onClick={startDownload}>
                      <Download size={15} />
                      {t('runtime.download')} {selectedAsset}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : checking ? (
            <p className="text-sm text-gray-500">{t('runtime.fetchingReleases')}</p>
          ) : (
            <p className="text-sm text-gray-500">{t('runtime.checkReleases')}</p>
          )}
        </div>
      )}
    </div>
  );
}

/// Cheap heuristic for "the error message looks like a GitHub rate-limit
/// 403/429". Tauri bubbles reqwest error strings up unchanged, so we
/// can match on the canonical phrasing. Matching is case-insensitive.
function looksLikeRateLimit(message: string): boolean {
  return /status (403|429)|403 Forbidden|429 Too Many|rate.?limit|API rate/i.test(message);
}

/// Prominent error banner used in place of the old single-line red text.
/// Shows a clear title (rate-limit vs. generic), the full error string
/// for debugging, and a one-click "copy details" button so the user can
/// paste it into a bug report.
function ErrorBanner({ error, context, onDismiss }: {
  error: string; context: string | null; onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isRateLimit = looksLikeRateLimit(error);
  const title = isRateLimit ? t('runtime.errorRateLimitTitle') : t('runtime.errorTitle');
  const timestamp = new Date().toISOString();

  const copyDetails = async () => {
    const lines: string[] = [];
    if (context) lines.push(`Action: ${context}`);
    lines.push(`Time:    ${timestamp}`);
    lines.push(`Error:   ${error}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in some webviews; fall back to a
      // selectable <pre> so the user can still grab the text manually.
      setExpanded(true);
    }
  };

  return (
    <div className="card border-accent-red/40 bg-accent-red/5">
      <div className="flex items-start gap-2">
        <AlertCircle size={15} className="text-accent-red mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-semibold text-accent-red">{title}</p>
          {isRateLimit && (
            <p className="text-xs text-accent-red/90 leading-relaxed">
              {t('runtime.errorRateLimitHint')}
            </p>
          )}
          <button
            className="text-xs text-accent-red/80 hover:text-accent-red font-mono text-left break-all block"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Click to collapse" : "Click to expand"}>
            {expanded ? error : (error.length > 140 ? error.slice(0, 140) + "…" : error)}
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="btn-ghost text-xs py-0.5 px-1.5 text-accent-red/80 hover:text-accent-red inline-flex items-center gap-1"
            onClick={copyDetails}
            title={t('runtime.errorCopyDetails')}>
            {copied ? <><Check size={11} /> {t('runtime.errorCopied')}</> : <><Copy size={11} /> {t('runtime.errorCopyDetails')}</>}
          </button>
          <button
            className="btn-ghost text-xs py-0.5 px-1.5 text-accent-red/80 hover:text-accent-red"
            onClick={onDismiss}
            title={t('runtime.errorDismiss')}>
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetRow({ asset, selected, onSelect }: {
  asset: AssetOption; selected: boolean; onSelect: () => void;
}) {
  const { t } = useTranslation();
  const isAux = asset.kind === "cuda_dlls";
  // Strip the `cudart-` prefix and replace `.zip` to suggest the main
  // package name, e.g. `cudart-llama-bin-win-cuda-13.3-x64.zip` →
  // `llama-b<build>-bin-win-cuda-13.3-x64.zip`. We don't know the build
  // number from the cudart filename, so we fall back to a generic hint.
  const mainHint = isAux ? asset.name.replace(/^cudart-/, "llama-") : "";
  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2.5 border text-left transition-colors ${
        isAux
          ? "border-border bg-surface-2 opacity-70 hover:opacity-100"
          : selected
            ? "border-primary/60 bg-primary/10"
            : "border-border hover:border-border-strong hover:bg-surface-3"
      }`}
      onClick={onSelect}>
      <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${selected ? "border-primary bg-primary" : "border-gray-600"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-200 truncate">{asset.name}</span>
          {isAux ? (
            <span className="badge-gray text-[10px] shrink-0" title={t('runtime.auxiliaryRecorded', { main: mainHint })}>
              {t('runtime.cudaDepsBadge')}
            </span>
          ) : (
            <>
              {asset.score >= 90 && <span className="badge-green text-[10px] shrink-0">{t('runtime.recommended')}</span>}
              {asset.score >= 60 && asset.score < 90 && (
                <span className="badge-purple text-[10px] shrink-0">{asset.backend_label}</span>
              )}
            </>
          )}
        </div>
        <div className="flex gap-3 mt-0.5">
          <span className="text-xs text-gray-500">{asset.backend_label}</span>
          <span className="text-xs text-gray-600">{mbToStr(asset.size_mb)}</span>
        </div>
      </div>
    </button>
  );
}
