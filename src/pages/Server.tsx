import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Terminal,
  ExternalLink,
  Save,
  FolderOpen,
  Trash2,
  Eye,
  ClipboardCopy,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import type { KvEstimate, ModelInfo, ServerConfig, ServerStatus } from "../types";

// ── Utility components ──────────────────────────────────────────────────────

const KV_TYPES = ["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"] as const;

function Slider({ label, hint, value, min, max, step, onChange, format }: {
  label: string; hint?: string; value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="label mb-0">{label}</label>
        <span className="text-xs font-mono text-gray-300">{format ? format(value) : value}</span>
      </div>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

function NumberInput({ label, hint, value, min, max, step = 1, onChange }: {
  label: string; hint?: string; value: number | null;
  min?: number; max?: number; step?: number;
  onChange: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setDraft(value != null ? String(value) : "");
    }
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDraft(raw);
    if (raw === "") {
      onChange(null);
    } else {
      const n = parseFloat(raw);
      if (!isNaN(n)) onChange(n);
    }
  }, [onChange]);

  const handleBlur = useCallback(() => {
    editing.current = false;
    if (draft === "" || isNaN(parseFloat(draft))) {
      // Restore previous value on blur if empty
      setDraft(value != null ? String(value) : "");
    }
  }, [draft, value]);

  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input type="number" className="input" value={draft} min={min} max={max} step={step}
        onFocus={() => { editing.current = true; }}
        onChange={handleChange}
        onBlur={handleBlur} />
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-8 h-4 rounded-full transition-colors mt-0.5 ${checked ? "bg-primary" : "bg-surface-4"}`}>
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </button>
      <div>
        <p className="text-xs font-medium text-gray-300">{label}</p>
        {hint && <p className="text-xs text-gray-600">{hint}</p>}
      </div>
    </div>
  );
}

function TextInput({ label, hint, value, placeholder, onChange }: {
  label: string; hint?: string; value: string; placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <input type="text" className="input" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectInput({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 mt-5 first:mt-0">{title}</p>;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "context", label: "Context" },
  { key: "hardware", label: "Hardware" },
  { key: "sampling", label: "Sampling" },
  { key: "server", label: "Server" },
  { key: "chat", label: "Chat" },
  { key: "advanced", label: "Advanced" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ServerConfig = {
  model_path: "",
  mmproj_path: null,
  host: "127.0.0.1",
  port: 8080,
  n_ctx: 0,
  n_gpu_layers: -1,
  n_threads: null,
  flash_attn: "auto",
  cache_type_k: "f16",
  cache_type_v: "f16",
  temperature: 0.8,
  top_k: 40,
  min_p: 0.05,
  top_p: 0.95,
  n_predict: -1,
  n_batch: 2048,
  n_ubatch: 512,
  cont_batching: true,
  mlock: false,
  no_mmap: false,
  seed: null,
  rope_freq_scale: null,
  rope_freq_base: null,
  grp_attn_n: null,
  grp_attn_w: null,
  parallel: 1,
  extra_params: {},
};

// ── Main component ───────────────────────────────────────────────────────────

// Session-storage helpers to retain config across page navigation
const SESSION_CONFIG_KEY = "catapult_server_config";
const SESSION_PRESET_KEY = "catapult_server_preset";
const SESSION_TAB_KEY = "catapult_server_tab";
const SESSION_STATUS_KEY = "catapult_server_status";

// Mirror of server::migrate_extra_params. Renames/drops flags removed in
// newer llama.cpp builds so old session state and imported presets keep working.
const REMOVED_EP_KEYS = ["spec-ngram-size-n", "spec-ngram-size-m", "spec-ngram-min-hits"] as const;
const RENAMED_EP_KEYS: Record<string, string> = {
  "draft": "spec-draft-n-max",
  "draft-max": "spec-draft-n-max",
  "draft-n-max": "spec-draft-n-max",
  "draft-min": "spec-draft-n-min",
  "draft-n-min": "spec-draft-n-min",
  "model-draft": "spec-draft-model",
  "ctx-size-draft": "spec-draft-ctx-size",
  "n-gpu-layers-draft": "spec-draft-ngl",
  "gpu-layers-draft": "spec-draft-ngl",
  "device-draft": "spec-draft-device",
  "threads-draft": "spec-draft-threads",
  "threads-batch-draft": "spec-draft-threads-batch",
  "cpu-moe-draft": "spec-draft-cpu-moe",
  "draft-cpu-moe": "spec-draft-cpu-moe",
  "n-cpu-moe-draft": "spec-draft-n-cpu-moe",
  "override-tensor-draft": "spec-draft-override-tensor",
  "draft-p-min": "spec-draft-p-min",
  "draft-p-split": "spec-draft-p-split",
  "hf-repo-draft": "spec-draft-hf",
  "cache-type-k-draft": "spec-draft-type-k",
  "cache-type-v-draft": "spec-draft-type-v",
};

export function migrateExtraParams(extra: Record<string, string>): Record<string, string> {
  const out = { ...extra };
  for (const k of REMOVED_EP_KEYS) delete out[k];
  for (const [oldKey, newKey] of Object.entries(RENAMED_EP_KEYS)) {
    if (oldKey in out && !(newKey in out)) {
      out[newKey] = out[oldKey];
    }
    delete out[oldKey];
  }
  return out;
}

function loadSessionConfig(): ServerConfig | null {
  try {
    const raw = sessionStorage.getItem(SESSION_CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as ServerConfig;
    if (cfg.extra_params) cfg.extra_params = migrateExtraParams(cfg.extra_params);
    return cfg;
  } catch { return null; }
}

function loadSessionStatus(): ServerStatus {
  try {
    const raw = sessionStorage.getItem(SESSION_STATUS_KEY);
    return raw ? JSON.parse(raw) : { type: "stopped" };
  } catch { return { type: "stopped" }; }
}

export default function Server() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [config, setConfigRaw] = useState<ServerConfig>(() => loadSessionConfig() ?? DEFAULT_CONFIG);
  const [status, setStatusRaw] = useState<ServerStatus>(loadSessionStatus);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => {
    const saved = sessionStorage.getItem(SESSION_TAB_KEY);
    const valid = TABS.find((t) => t.key === saved);
    return valid ? valid.key : "context";
  });
  const [showLogs, setShowLogs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kvWarning, setKvWarning] = useState<KvEstimate | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [showModelList, setShowModelList] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);
  const pendingLogs = useRef<string[]>([]);
  const logRaf = useRef<number | null>(null);
  const [presets, setPresets] = useState<string[]>([]);
  const [activePreset, setActivePresetRaw] = useState<string | null>(() => {
    return sessionStorage.getItem(SESSION_PRESET_KEY) || null;
  });
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);

  // Wrappers that persist to sessionStorage
  const setConfig: typeof setConfigRaw = useCallback((v) => {
    setConfigRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setActivePreset = useCallback((v: string | null) => {
    setActivePresetRaw(v);
    if (v) sessionStorage.setItem(SESSION_PRESET_KEY, v);
    else sessionStorage.removeItem(SESSION_PRESET_KEY);
  }, []);

  const setActiveTab = useCallback((v: Tab) => {
    setActiveTabRaw(v);
    sessionStorage.setItem(SESSION_TAB_KEY, v);
  }, []);

  const setStatus = useCallback((v: ServerStatus | ((prev: ServerStatus) => ServerStatus)) => {
    setStatusRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      sessionStorage.setItem(SESSION_STATUS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const flushLogs = useCallback(() => {
    logRaf.current = null;
    const batch = pendingLogs.current;
    if (batch.length === 0) return;
    pendingLogs.current = [];
    setLogs((prev) => [...prev, ...batch].slice(-500));
  }, []);

  const addLog = useCallback((line: string) => {
    pendingLogs.current.push(line);
    if (logRaf.current === null) {
      logRaf.current = requestAnimationFrame(flushLogs);
    }
  }, [flushLogs]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  // ── Extra params helpers ──────────────────────────────────────────────────

  const getEp = (key: string): string => config.extra_params?.[key] ?? "";
  const getEpNum = (key: string): number | null => {
    const v = config.extra_params?.[key];
    if (v === undefined || v === "") return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const setEp = (key: string, value: string) => {
    setConfig((c) => {
      const ep = { ...c.extra_params };
      if (value === "") delete ep[key]; else ep[key] = value;
      return { ...c, extra_params: ep };
    });
  };
  const setEpNum = (key: string, value: number | null) => {
    setEp(key, value !== null ? String(value) : "");
  };
  const hasFlag = (key: string): boolean => key in (config.extra_params ?? {});
  const setFlag = (key: string, on: boolean) => {
    setConfig((c) => {
      const ep = { ...c.extra_params };
      if (on) ep[key] = ""; else delete ep[key];
      return { ...c, extra_params: ep };
    });
  };

  // ── Presets ────────────────────────────────────────────────────────────────

  const refreshPresets = async () => {
    try { setPresets(await invoke<string[]>("list_server_presets")); } catch {}
  };

  const savePreset = async (name: string) => {
    if (!name.trim()) return;
    try {
      // Exclude model_path and mmproj_path from presets — these are per-session
      const presetConfig = { ...config, model_path: "", mmproj_path: null };
      await invoke("save_server_preset", { name: name.trim(), config: presetConfig });
      setActivePreset(name.trim());
      setSaveName("");
      await refreshPresets();
    } catch (e) { setError(String(e)); }
  };

  const loadPreset = async (name: string, modelPath?: string) => {
    try {
      const loaded = await invoke<ServerConfig>("load_server_preset", { name });
      if (loaded.extra_params) loaded.extra_params = migrateExtraParams(loaded.extra_params);
      // Preserve current model_path and mmproj_path
      setConfig((prev) => ({
        ...loaded,
        model_path: prev.model_path,
        mmproj_path: prev.mmproj_path,
      }));
      setActivePreset(name);
      setShowPresetMenu(false);
      // Save model→preset association (use provided path or fall back to current config)
      const pathToSave = modelPath ?? config.model_path;
      if (pathToSave) {
        await invoke("set_model_preset", { modelPath: pathToSave, presetName: name }).catch(() => {});
      }
    } catch {
      // Preset file not found (e.g. deleted or renamed) — silently skip
    }
  };

  const deletePreset = async (name: string) => {
    try {
      await invoke("delete_server_preset", { name });
      if (activePreset === name) setActivePreset(null);
      await refreshPresets();
    } catch (e) { setError(String(e)); }
  };

  const saveAsDefaults = async () => {
    try {
      const presetConfig = { ...config, model_path: "", mmproj_path: null };
      await invoke("save_server_preset", { name: "__default__", config: presetConfig });
      setActivePreset(null);
      setShowPresetMenu(false);
    } catch (e) { setError(String(e)); }
  };

  const resetDefaults = async () => {
    try {
      await invoke("delete_server_preset", { name: "__default__" });
    } catch {}
    const modelPath = config.model_path;
    const mmproj = config.mmproj_path;
    setConfig({ ...DEFAULT_CONFIG, model_path: modelPath, mmproj_path: mmproj });
    setActivePreset(null);
    setShowPresetMenu(false);
  };

  const loadDefaults = async () => {
    try {
      const loaded = await invoke<ServerConfig>("load_server_preset", { name: "__default__" });
      if (loaded.extra_params) loaded.extra_params = migrateExtraParams(loaded.extra_params);
      setConfig((prev) => ({
        ...loaded,
        model_path: prev.model_path,
        mmproj_path: prev.mmproj_path,
      }));
    } catch {
      // No saved defaults — use built-in defaults
    }
  };

  const resetToDefault = () => {
    loadDefaults().then(() => {
      setActivePreset(null);
      setShowPresetMenu(false);
    });
  };

  // ── Data loading ──────────────────────────────────────────────────────────

  const openChat = async () => {
    if (status.type !== "running") return;
    setOpeningChat(true);
    try { await invoke("open_chat_window", { port: status.port }); }
    catch (e) { setError(String(e)); }
    finally { setOpeningChat(false); }
  };

  const loadData = async () => {
    const [mdls, srv, cfg] = await Promise.all([
      invoke<ModelInfo[]>("list_installed_models").catch(() => []),
      invoke<ServerStatus>("get_server_status").catch(() => ({ type: "stopped" as const })),
      invoke<{ favorite_models: string[]; selected_model: string | null; model_presets: Record<string, string> }>(
        "get_config"
      ).catch(() => ({ favorite_models: [] as string[], selected_model: null, model_presets: {} as Record<string, string> })),
    ]);
    setFavorites(cfg.favorite_models);
    setModels(mdls);
    setStatus(srv);
    if (mdls.length > 0 && !config.model_path) {
      // Use the dashboard-selected model if set, otherwise first model
      const selected = cfg.selected_model
        ? mdls.find((m) => m.path === cfg.selected_model)
        : null;
      const pick = selected ?? mdls[0];
      setConfig((c) => ({
        ...c,
        model_path: pick.path,
        mmproj_path: pick.is_vision && pick.mmproj_path ? pick.mmproj_path : null,
      }));
      // Auto-load the last-used preset for this model (on first visit only)
      if (!loadSessionConfig()) {
        const savedPreset = cfg.model_presets[pick.path];
        if (savedPreset) {
          await loadPreset(savedPreset, pick.path);
        }
      }
    }
  };

  useEffect(() => {
    loadData();
    refreshPresets();
    // Only load defaults if no session-restored config
    if (!loadSessionConfig()) loadDefaults();
    // Load any existing logs (e.g. server started from Dashboard)
    invoke<string[]>("get_server_logs").then((existing) => {
      if (existing.length > 0) {
        setLogs(existing);
        setShowLogs(true);
      }
    }).catch(() => {});
    const unlistenLog = listen<string>("server_log", (e) => {
      addLog(e.payload);
    });
    const interval = setInterval(async () => {
      try { setStatus(await invoke<ServerStatus>("get_server_status")); } catch {}
    }, 2000);
    return () => {
      unlistenLog.then((f) => f());
      clearInterval(interval);
      if (logRaf.current !== null) cancelAnimationFrame(logRaf.current);
    };
  }, []);

  const applyModelConfig = async (modelPath: string) => {
    const model = models.find((m) => m.path === modelPath);
    if (!model) return;
    try {
      const suggested = await invoke<ServerConfig>("suggest_server_config", {
        modelPath, modelSizeMb: Math.round(model.size_bytes / (1024 * 1024)),
      });
      // Only apply hardware-dependent suggestions; preserve all user settings
      setConfig((prev) => ({
        ...prev,
        n_ctx: suggested.n_ctx,
        n_gpu_layers: suggested.n_gpu_layers,
      }));
    } catch {}
  };

  const handleModelChange = async (m: ModelInfo) => {
    setConfig((c) => ({
      ...c,
      model_path: m.path,
      mmproj_path: m.is_vision && m.mmproj_path ? m.mmproj_path : null,
    }));
    // Check if there's a saved preset for this model; if so, use it
    try {
      const savedPreset = await invoke<string | null>("get_model_preset", { modelPath: m.path });
      if (savedPreset) {
        await loadPreset(savedPreset, m.path);
        return;
      }
    } catch {}
    // No model-specific preset — apply hardware suggestions
    await applyModelConfig(m.path);
  };

  const startServer = async () => {
    if (!config.model_path) { setError(t("server.pleaseSelectModel")); return; }
    // Pre-flight KV-cache budget check. If the predicted usage is
    // concerning, surface a yellow toast; never block the user.
    try {
      const kv = await invoke<KvEstimate>("estimate_kv_usage", {
        modelPath: config.model_path,
        nCtx: config.n_ctx,
        kvQuant: config.cache_type_k,
      });
      if (kv.warning) {
        setKvWarning(kv);
      } else {
        setKvWarning(null);
      }
    } catch {
      // Best-effort only — if the model file is missing or the
      // GGUF header is unreadable, do not block startup.
      setKvWarning(null);
    }
    setError(null); setLogs([]); setShowLogs(true);
    try {
      await invoke("start_server", { config });
      // Persist the model→preset association so next visit auto-loads it
      if (activePreset && config.model_path) {
        await invoke("set_model_preset", { modelPath: config.model_path, presetName: activePreset }).catch(() => {});
      }
    }
    catch (e) { setError(String(e)); }
  };

  const stopServer = async () => {
    try { await invoke("stop_server"); }
    catch (e) { setError(String(e)); }
  };

  const isRunning = status.type === "running" || status.type === "starting";

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* KV-cache budget warning (pre-flight, before logs). */}
      {kvWarning && kvWarning.warning && (
        <div className="mx-6 mt-4 p-3 rounded border border-accent-yellow/40 bg-accent-yellow/10 flex items-start gap-3">
          <AlertTriangle size={18} className="text-accent-yellow shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-accent-yellow">
              {t("server.kvWarningTitle", { defaultValue: "Predicted KV-cache budget" })}
            </div>
            <p className="text-xs text-gray-200 mt-1 break-words">{kvWarning.warning}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              {t("server.kvWarningHint", {
                defaultValue: "Weights: {{w}} MB · KV cache: {{kv}} MB · VRAM: {{v}} MB",
                w: kvWarning.model_weights_mb,
                kv: kvWarning.kv_total_mb,
                v: kvWarning.available_vram_mb,
              })}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost shrink-0"
            onClick={() => setKvWarning(null)}
            aria-label={t("server.errorDismiss", { defaultValue: "Dismiss" })}
          >
            <Square size={12} />
          </button>
        </div>
      )}
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">{t("server.title")}</h1>
          <div className="flex items-center gap-2 mt-1">
            {/* Preset controls */}
            <div className="relative">
              <button className="btn-ghost text-xs py-1 px-2" onClick={() => setShowPresetMenu(!showPresetMenu)}>
                <FolderOpen size={12} />
                {activePreset ?? t("server.default")}
                <ChevronDown size={11} />
              </button>
              {showPresetMenu && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-surface-2 border border-border shadow-lg min-w-[250px]">
                  <button className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-surface-3 flex items-center gap-2"
                    onClick={resetToDefault}>
                    {t("server.default")}
                    {!activePreset && <span className="text-primary-light ml-auto text-[10px]">{t("server.active")}</span>}
                  </button>
                  {presets.filter((n) => n !== "__default__").map((name) => (
                    <div key={name} className="flex items-center hover:bg-surface-3 group">
                      <button className="flex-1 text-left px-3 py-2 text-xs text-gray-300 flex items-center gap-2"
                        onClick={() => loadPreset(name)}>
                        {name}
                        {activePreset === name && <span className="text-primary-light ml-auto text-[10px]">{t("server.active")}</span>}
                      </button>
                      <button className="px-2 py-2 text-gray-600 hover:text-accent-red opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); deletePreset(name); }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-border">
                    <button className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-surface-3 hover:text-gray-200"
                      onClick={saveAsDefaults}>
                      {t("server.saveCurrentAsDefaults")}
                    </button>
                    <button className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-surface-3 hover:text-gray-200"
                      onClick={resetDefaults}>
                      {t("server.resetDefaults")}
                    </button>
                  </div>
                  <div className="border-t border-border px-2 py-2 flex gap-1">
                    <input className="input text-xs py-1 flex-1" placeholder={t("server.presetName")}
                      value={saveName} onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") savePreset(saveName); }} />
                    <button className="btn-primary text-xs py-1 px-2" onClick={() => savePreset(saveName)}
                      disabled={!saveName.trim()}>
                      <Save size={11} /> {t("server.save")}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {activePreset && (
              <button className="btn-ghost text-xs py-1 px-2" onClick={() => savePreset(activePreset)}
                title={t("server.overwrite")}>
                <Save size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status.type === "running" && (
            <>
              <span className="flex items-center gap-1.5 text-xs text-accent-green">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
                {t("server.runningOnPort", { port: status.port })}
              </span>
              <button className="btn-secondary text-xs" onClick={openChat} disabled={openingChat}>
                <ExternalLink size={13} /> {t("server.openChat")}
              </button>
            </>
          )}
          {status.type === "starting" && (
            <span className="text-xs text-accent-yellow flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow animate-pulse" />
              {t("server.starting")}
            </span>
          )}
          {status.type === "error" && <span className="text-xs text-accent-red">{t("server.error")}</span>}
          {isRunning ? (
            <button className="btn-danger" onClick={stopServer}><Square size={14} /> {t("server.stop")}</button>
          ) : (
            <button className="btn-primary" onClick={startServer} disabled={!config.model_path}>
              <Play size={14} /> {t("server.launch")}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {error && (
          <div className="card border-accent-red/30 bg-accent-red/5">
            <p className="text-sm text-accent-red">{error}</p>
          </div>
        )}

        {/* Model selection */}
        <div className="card">
          {models.length === 0 ? (
            <>
              <h2 className="section-title">{t("server.model")}</h2>
              <p className="text-sm text-gray-500">
                {t("server.noModels")}{" "}
                <button className="text-primary-light hover:underline" onClick={() => navigate("/models")}>
                  {t("server.downloadOneFirst")}
                </button>
              </p>
            </>
          ) : (() => {
            const selected = models.find((m) => m.path === config.model_path);
            return (
              <>
                <button className="w-full flex items-center justify-between"
                  onClick={() => setShowModelList(!showModelList)}>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="section-title mb-0 shrink-0">{t("server.model")}</h2>
                    {selected && !showModelList && (
                      <span className="text-sm text-gray-300 truncate">
                        {selected.name}
                        {selected.quant && <span className="text-gray-500 ml-1">{selected.quant}</span>}
                        {selected.is_vision && selected.mmproj_path && (
                          <Eye size={11} className="inline ml-1.5 text-accent-blue" />
                        )}
                      </span>
                    )}
                  </div>
                  {showModelList
                    ? <ChevronUp size={14} className="text-gray-500 shrink-0" />
                    : <ChevronDown size={14} className="text-gray-500 shrink-0" />}
                </button>
                {showModelList && (
                  <div className="space-y-2 mt-3">
                    {[...models].sort((a, b) => {
                      const aFav = favorites.includes(a.id) ? 0 : 1;
                      const bFav = favorites.includes(b.id) ? 0 : 1;
                      if (aFav !== bFav) return aFav - bFav;
                      return a.name.localeCompare(b.name);
                    }).map((m) => {
                      const isSelected = config.model_path === m.path;
                      const hasVision = m.is_vision && !!m.mmproj_path;
                      return (
                        <button key={m.id}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 border text-left transition-colors ${
                            isSelected ? "border-primary/60 bg-primary/10" : "border-border hover:border-border-strong hover:bg-surface-3"
                          }`}
                          onClick={() => { handleModelChange(m); setShowModelList(false); }}>
                          <div className={`w-3 h-3 rounded-full border-2 shrink-0 ${isSelected ? "border-primary bg-primary" : "border-gray-600"}`} />
                          <HardDrive size={13} className="text-gray-500 shrink-0" />
                          <span className="flex-1 text-sm text-gray-200 truncate">{m.name}</span>
                          {hasVision && (
                            <span className="badge-blue text-[10px]" title={`Vision: ${m.mmproj_path}`}>
                              <Eye size={9} className="mr-0.5" /> {t("server.vision")}
                            </span>
                          )}
                          {m.is_vision && !m.mmproj_path && (
                            <span className="badge-gray text-[10px]" title={t("server.noMmproj")}>
                              <Eye size={9} className="mr-0.5 opacity-50" /> {t("server.noMmproj")}
                            </span>
                          )}
                          {m.quant && <span className="badge-purple text-[10px]">{m.quant}</span>}
                          <span className="text-xs text-gray-500">{(m.size_bytes / 1024 ** 3).toFixed(1)} GB</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border -mb-3">
          {TABS.map((tab) => (
            <button key={tab.key}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.key ? "text-primary-light border-b-2 border-primary" : "text-gray-500 hover:text-gray-300"
              }`}
              onClick={() => setActiveTab(tab.key)}>
              {t(`server.tabs.${tab.key}`)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="card space-y-4">

          {/* ════════════════════════ CONTEXT ════════════════════════ */}
          {activeTab === "context" && <>
            <Section title={t("server.sections.contextAndPrediction")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.contextSize")} hint={t("server.labels.contextSizeHint")} value={config.n_ctx} min={0} max={1048576} step={512}
                onChange={(v) => setConfig((c) => ({ ...c, n_ctx: v ?? 0 }))} />
              <NumberInput label={t("server.labels.maxTokens")} hint={t("server.labels.maxTokensHint")} value={config.n_predict} min={-1}
                onChange={(v) => setConfig((c) => ({ ...c, n_predict: v ?? -1 }))} />
              <NumberInput label={t("server.labels.batchSize")} hint={t("server.labels.batchSizeHint")} value={config.n_batch} min={1} max={16384} step={32}
                onChange={(v) => setConfig((c) => ({ ...c, n_batch: v ?? 2048 }))} />
              <NumberInput label={t("server.labels.microBatchSize")} hint={t("server.labels.microBatchSizeHint")} value={config.n_ubatch} min={1} max={16384} step={32}
                onChange={(v) => setConfig((c) => ({ ...c, n_ubatch: v ?? 512 }))} />
              <NumberInput label={t("server.labels.keepTokens")} hint={t("server.labels.keepTokensHint")} value={getEpNum("keep")}
                onChange={(v) => setEpNum("keep", v)} />
            </div>

            <Section title={t("server.sections.attentionAndKvCache")} />
            <div className="grid grid-cols-2 gap-3">
              <SelectInput label={t("server.labels.flashAttention")} value={config.flash_attn}
                options={[
                  { value: "auto", label: t("server.options.auto") },
                  { value: "on", label: t("server.options.on") },
                  { value: "off", label: t("server.options.off") }
                ]}
                onChange={(v) => setConfig((c) => ({ ...c, flash_attn: v }))} />
              <div /> {/* spacer */}
              <SelectInput label={t("server.labels.kvCacheTypeK")} value={config.cache_type_k}
                options={KV_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => setConfig((c) => ({ ...c, cache_type_k: v }))} />
              <SelectInput label={t("server.labels.kvCacheTypeV")} value={config.cache_type_v}
                options={KV_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => setConfig((c) => ({ ...c, cache_type_v: v }))} />
              <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                💡 {t("server.labels.kvCacheTypeHint")}
              </div>
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.swaFull")} hint={t("server.labels.swaFullHint")} checked={hasFlag("swa-full")} onChange={(v) => setFlag("swa-full", v)} />
              <Toggle label={t("server.labels.kvOffload")} hint={t("server.labels.kvOffloadHint")} checked={!hasFlag("no-kv-offload")} onChange={(v) => setFlag("no-kv-offload", !v)} />
              <Toggle label={t("server.labels.kvUnified")} hint={t("server.labels.kvUnifiedHint")} checked={hasFlag("kv-unified") || (!hasFlag("no-kv-unified") && config.parallel <= 1)}
                onChange={(v) => { setFlag("kv-unified", v); setFlag("no-kv-unified", !v); }} />
              <Toggle label={t("server.labels.contextShift")} hint={t("server.labels.contextShiftHint")} checked={hasFlag("context-shift")} onChange={(v) => { setFlag("context-shift", v); setFlag("no-context-shift", !v); }} />
              <Toggle label={t("server.labels.cachePrompt")} hint={t("server.labels.cachePromptHint")} checked={!hasFlag("no-cache-prompt")} onChange={(v) => setFlag("no-cache-prompt", !v)} />
              <Toggle label={t("server.labels.cacheIdleSlots")} hint={t("server.labels.cacheIdleSlotsHint")}
                checked={!hasFlag("no-cache-idle-slots")} onChange={(v) => setFlag("no-cache-idle-slots", !v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <NumberInput label={t("server.labels.cacheReuse")} hint={t("server.labels.cacheReuseHint")} value={getEpNum("cache-reuse")} min={0}
                onChange={(v) => setEpNum("cache-reuse", v)} />
              <NumberInput label={t("server.labels.cacheRam")} hint={t("server.labels.cacheRamHint")} value={getEpNum("cache-ram")}
                onChange={(v) => setEpNum("cache-ram", v)} />
              <NumberInput label={t("server.labels.ctxCheckpoints")} hint={t("server.labels.ctxCheckpointsHint")} value={getEpNum("ctx-checkpoints")} min={0}
                onChange={(v) => setEpNum("ctx-checkpoints", v)} />
              <NumberInput label={t("server.labels.checkpointInterval")} hint={t("server.labels.checkpointIntervalHint")} value={getEpNum("checkpoint-every-n-tokens")}
                onChange={(v) => setEpNum("checkpoint-every-n-tokens", v)} />
            </div>
          </>}

          {/* ════════════════════════ HARDWARE ════════════════════════ */}
          {activeTab === "hardware" && <>
            <Section title={t("server.sections.gpu")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.gpuLayers")} hint={t("server.labels.gpuLayersHint")} value={config.n_gpu_layers} min={-1}
                onChange={(v) => setConfig((c) => ({ ...c, n_gpu_layers: v ?? -1 }))} />
              <SelectInput label={t("server.labels.splitMode")} hint={t("server.labels.splitModeHint")} value={getEp("split-mode") || "layer"}
                options={[
                  { value: "none", label: t("server.options.none") },
                  { value: "layer", label: t("server.options.layer") },
                  { value: "row", label: t("server.options.row") }
                ]}
                onChange={(v) => setEp("split-mode", v === "layer" ? "" : v)} />
              <TextInput label={t("server.labels.tensorSplit")} hint={t("server.labels.tensorSplitHint")} value={getEp("tensor-split")} placeholder="e.g. 3,1"
                onChange={(v) => setEp("tensor-split", v)} />
              <NumberInput label={t("server.labels.mainGpu")} hint={t("server.labels.mainGpuHint")} value={getEpNum("main-gpu")} min={0}
                onChange={(v) => setEpNum("main-gpu", v)} />
              <TextInput label={t("server.labels.device")} hint={t("server.labels.deviceHint")} value={getEp("device")}
                onChange={(v) => setEp("device", v)} />
              <SelectInput label={t("server.labels.fit")} hint={t("server.labels.fitHint")} value={getEp("fit") || "on"}
                options={[
                  { value: "on", label: t("server.options.onDefault") },
                  { value: "off", label: t("server.options.off") }
                ]}
                onChange={(v) => setEp("fit", v === "on" ? "" : v)} />
              <TextInput label={t("server.labels.fitTarget")} hint={t("server.labels.fitTargetHint")} value={getEp("fit-target")} placeholder="1024"
                onChange={(v) => setEp("fit-target", v)} />
              <NumberInput label={t("server.labels.fitMinCtx")} hint={t("server.labels.fitMinCtxHint")} value={getEpNum("fit-ctx")} min={0}
                onChange={(v) => setEpNum("fit-ctx", v)} />
            </div>

            <Section title={t("server.sections.cpu")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.threads")} hint={t("server.labels.threadsHint")} value={config.n_threads}
                onChange={(v) => setConfig((c) => ({ ...c, n_threads: v }))} />
              <NumberInput label={t("server.labels.threadsBatch")} hint={t("server.labels.threadsBatchHint")} value={getEpNum("threads-batch")}
                onChange={(v) => setEpNum("threads-batch", v)} />
              <SelectInput label={t("server.labels.numa")} hint={t("server.labels.numaHint")} value={getEp("numa") || ""}
                options={[
                  { value: "", label: t("server.options.disabled") },
                  { value: "distribute", label: t("server.options.distribute") },
                  { value: "isolate", label: t("server.options.isolate") },
                  { value: "numactl", label: t("server.options.numactl") }
                ]}
                onChange={(v) => setEp("numa", v)} />
            </div>

            <Section title={t("server.sections.memory")} />
            <div className="space-y-3">
              <Toggle label={t("server.labels.mlock")} hint={t("server.labels.mlockHint")} checked={config.mlock}
                onChange={(v) => setConfig((c) => ({ ...c, mlock: v }))} />
              <Toggle label={t("server.labels.memoryMap")} hint={t("server.labels.memoryMapHint")} checked={!config.no_mmap}
                onChange={(v) => setConfig((c) => ({ ...c, no_mmap: !v }))} />
              <Toggle label={t("server.labels.directIo")} hint={t("server.labels.directIoHint")} checked={hasFlag("direct-io")} onChange={(v) => setFlag("direct-io", v)} />
              <Toggle label={t("server.labels.cpuMoe")} hint={t("server.labels.cpuMoeHint")} checked={hasFlag("cpu-moe")} onChange={(v) => setFlag("cpu-moe", v)} />
              <Toggle label={t("server.labels.cpuMoeDraft")} hint={t("server.labels.cpuMoeDraftHint")} checked={hasFlag("spec-draft-cpu-moe")} onChange={(v) => setFlag("spec-draft-cpu-moe", v)} />
              <Toggle label={t("server.labels.repack")} hint={t("server.labels.repackHint")} checked={!hasFlag("no-repack")} onChange={(v) => setFlag("no-repack", !v)} />
              <Toggle label={t("server.labels.opOffload")} hint={t("server.labels.opOffloadHint")} checked={!hasFlag("no-op-offload")} onChange={(v) => setFlag("no-op-offload", !v)} />
              <Toggle label={t("server.labels.noHostBuffer")} hint={t("server.labels.noHostBufferHint")} checked={hasFlag("no-host")} onChange={(v) => setFlag("no-host", v)} />
              <Toggle label={t("server.labels.checkTensors")} hint={t("server.labels.checkTensorsHint")} checked={hasFlag("check-tensors")} onChange={(v) => setFlag("check-tensors", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <NumberInput label={t("server.labels.nCpuMoeLayers")} hint={t("server.labels.nCpuMoeLayersHint")} value={getEpNum("n-cpu-moe")} min={0}
                onChange={(v) => setEpNum("n-cpu-moe", v)} />
              <NumberInput label={t("server.labels.nCpuMoeLayersDraft")} hint={t("server.labels.nCpuMoeLayersDraftHint")} value={getEpNum("spec-draft-n-cpu-moe")} min={0}
                onChange={(v) => setEpNum("spec-draft-n-cpu-moe", v)} />
            </div>

            <Section title={t("server.sections.overrides")} />
            <div className="grid grid-cols-1 gap-3">
              <TextInput label={t("server.labels.overrideTensor")} hint={t("server.labels.overrideTensorHint")} value={getEp("override-tensor")}
                onChange={(v) => setEp("override-tensor", v)} />
              <TextInput label={t("server.labels.overrideTensorDraft")} hint={t("server.labels.overrideTensorDraftHint")} value={getEp("spec-draft-override-tensor")}
                onChange={(v) => setEp("spec-draft-override-tensor", v)} />
              <TextInput label={t("server.labels.overrideKv")} hint={t("server.labels.overrideKvHint")} value={getEp("override-kv")}
                onChange={(v) => setEp("override-kv", v)} />
            </div>
          </>}

          {/* ════════════════════════ SAMPLING ════════════════════════ */}
          {activeTab === "sampling" && <>
            <Section title={t("server.sections.basic")} />
            <Slider label={t("server.labels.temperature")} hint={t("server.labels.temperatureHint")} value={config.temperature} min={0} max={2} step={0.01}
              onChange={(v) => setConfig((c) => ({ ...c, temperature: v }))} format={(v) => v.toFixed(2)} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.seed")} hint={t("server.labels.seedHint")} value={config.seed !== null ? config.seed : -1}
                onChange={(v) => setConfig((c) => ({ ...c, seed: v !== null && v >= 0 ? v : null }))} />
              <TextInput label={t("server.labels.samplers")} hint={t("server.labels.samplersHint")} value={getEp("samplers")}
                placeholder="penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature"
                onChange={(v) => setEp("samplers", v)} />
            </div>

            <Section title={t("server.sections.nucleusTopKMinP")} />
            <Slider label={t("server.labels.topK")} hint={t("server.labels.topKHint")} value={config.top_k} min={0} max={200} step={1}
              onChange={(v) => setConfig((c) => ({ ...c, top_k: v }))} />
            <Slider label={t("server.labels.topP")} hint={t("server.labels.topPHint")} value={config.top_p} min={0} max={1} step={0.01}
              onChange={(v) => setConfig((c) => ({ ...c, top_p: v }))} format={(v) => v.toFixed(2)} />
            <Slider label={t("server.labels.minP")} hint={t("server.labels.minPHint")} value={config.min_p} min={0} max={1} step={0.001}
              onChange={(v) => setConfig((c) => ({ ...c, min_p: v }))} format={(v) => v.toFixed(3)} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.topNSigma")} hint={t("server.labels.topNSigmaHint")} value={getEpNum("top-n-sigma")}
                onChange={(v) => setEpNum("top-n-sigma", v)} />
              <NumberInput label={t("server.labels.typicalP")} hint={t("server.labels.typicalPHint")} value={getEpNum("typical")}
                onChange={(v) => setEpNum("typical", v)} />
            </div>

            <Section title={t("server.sections.penalties")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.repeatLastN")} hint={t("server.labels.repeatLastNHint")} value={getEpNum("repeat-last-n")}
                onChange={(v) => setEpNum("repeat-last-n", v)} />
              <NumberInput label={t("server.labels.repeatPenalty")} hint={t("server.labels.repeatPenaltyHint")} value={getEpNum("repeat-penalty")} step={0.01}
                onChange={(v) => setEpNum("repeat-penalty", v)} />
              <NumberInput label={t("server.labels.presencePenalty")} hint={t("server.labels.presencePenaltyHint")} value={getEpNum("presence-penalty")} step={0.01}
                onChange={(v) => setEpNum("presence-penalty", v)} />
              <NumberInput label={t("server.labels.frequencyPenalty")} hint={t("server.labels.frequencyPenaltyHint")} value={getEpNum("frequency-penalty")} step={0.01}
                onChange={(v) => setEpNum("frequency-penalty", v)} />
            </div>

            <Section title={t("server.sections.xtc")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.xtcProbability")} hint={t("server.labels.xtcProbabilityHint")} value={getEpNum("xtc-probability")} step={0.01}
                onChange={(v) => setEpNum("xtc-probability", v)} />
              <NumberInput label={t("server.labels.xtcThreshold")} hint={t("server.labels.xtcThresholdHint")} value={getEpNum("xtc-threshold")} step={0.01}
                onChange={(v) => setEpNum("xtc-threshold", v)} />
            </div>

            <Section title={t("server.sections.drySampling")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.dryMultiplier")} hint={t("server.labels.dryMultiplierHint")} value={getEpNum("dry-multiplier")} step={0.1}
                onChange={(v) => setEpNum("dry-multiplier", v)} />
              <NumberInput label={t("server.labels.dryBase")} hint={t("server.labels.dryBaseHint")} value={getEpNum("dry-base")} step={0.05}
                onChange={(v) => setEpNum("dry-base", v)} />
              <NumberInput label={t("server.labels.dryAllowedLength")} hint={t("server.labels.dryAllowedLengthHint")} value={getEpNum("dry-allowed-length")} min={0}
                onChange={(v) => setEpNum("dry-allowed-length", v)} />
              <NumberInput label={t("server.labels.dryPenaltyLastN")} hint={t("server.labels.dryPenaltyLastNHint")} value={getEpNum("dry-penalty-last-n")}
                onChange={(v) => setEpNum("dry-penalty-last-n", v)} />
            </div>

            <Section title={t("server.sections.adaptiveSampling")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.adaptiveTarget")} hint={t("server.labels.adaptiveTargetHint")} value={getEpNum("adaptive-target")} step={0.01}
                onChange={(v) => setEpNum("adaptive-target", v)} />
              <NumberInput label={t("server.labels.adaptiveDecay")} hint={t("server.labels.adaptiveDecayHint")} value={getEpNum("adaptive-decay")} step={0.01}
                onChange={(v) => setEpNum("adaptive-decay", v)} />
            </div>

            <Section title={t("server.sections.dynamicTemperature")} />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label={t("server.labels.dynatempRange")} hint={t("server.labels.dynatempRangeHint")} value={getEpNum("dynatemp-range")} step={0.1}
                onChange={(v) => setEpNum("dynatemp-range", v)} />
              <NumberInput label={t("server.labels.dynatempExp")} hint={t("server.labels.dynatempExpHint")} value={getEpNum("dynatemp-exp")} step={0.1}
                onChange={(v) => setEpNum("dynatemp-exp", v)} />
            </div>

            <Section title={t("server.sections.mirostat")} />
            <div className="grid grid-cols-2 gap-3">
              <SelectInput label={t("server.labels.mirostatMode")} value={getEp("mirostat") || "0"}
                options={[{ value: "0", label: t("server.options.disabled") }, { value: "1", label: "Mirostat 1" }, { value: "2", label: "Mirostat 2" }]}
                onChange={(v) => setEp("mirostat", v === "0" ? "" : v)} />
              <NumberInput label={t("server.labels.mirostatLr")} hint={t("server.labels.mirostatLrHint")} value={getEpNum("mirostat-lr")} step={0.01}
                onChange={(v) => setEpNum("mirostat-lr", v)} />
              <NumberInput label={t("server.labels.mirostatEnt")} hint={t("server.labels.mirostatEntHint")} value={getEpNum("mirostat-ent")} step={0.1}
                onChange={(v) => setEpNum("mirostat-ent", v)} />
            </div>

            <Section title={t("server.sections.misc")} />
            <div className="space-y-3">
              <Toggle label={t("server.labels.ignoreEos")} hint={t("server.labels.ignoreEosHint")} checked={hasFlag("ignore-eos")} onChange={(v) => setFlag("ignore-eos", v)} />
              <Toggle label={t("server.labels.backendSampling")} hint={t("server.labels.backendSamplingHint")} checked={hasFlag("backend-sampling")} onChange={(v) => setFlag("backend-sampling", v)} />
            </div>
          </>}

          {/* ════════════════════════ SERVER ════════════════════════ */}
          {activeTab === "server" && <>
            <Section title={t("server.sections.network")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.host")} value={config.host} onChange={(v) => setConfig((c) => ({ ...c, host: v }))} />
              <NumberInput label={t("server.labels.port")} value={config.port} min={1} max={65535}
                onChange={(v) => setConfig((c) => ({ ...c, port: v ?? 8080 }))} />
              <NumberInput label={t("server.labels.parallelSlots")} hint={t("server.labels.parallelSlotsHint")} value={config.parallel} min={-1} max={128}
                onChange={(v) => setConfig((c) => ({ ...c, parallel: v ?? 1 }))} />
              <NumberInput label={t("server.labels.timeout")} hint={t("server.labels.timeoutHint")} value={getEpNum("timeout")} min={0}
                onChange={(v) => setEpNum("timeout", v)} />
              <NumberInput label={t("server.labels.httpThreads")} hint={t("server.labels.httpThreadsHint")} value={getEpNum("threads-http")}
                onChange={(v) => setEpNum("threads-http", v)} />
              <NumberInput label={t("server.labels.sleepIdle")} hint={t("server.labels.sleepIdleHint")} value={getEpNum("sleep-idle-seconds")}
                onChange={(v) => setEpNum("sleep-idle-seconds", v)} />
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.reusePort")} hint={t("server.labels.reusePortHint")} checked={hasFlag("reuse-port")} onChange={(v) => setFlag("reuse-port", v)} />
            </div>

            <Section title={t("server.sections.api")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.apiKey")} hint={t("server.labels.apiKeyHint")} value={getEp("api-key")}
                onChange={(v) => setEp("api-key", v)} />
              <TextInput label={t("server.labels.apiKeyFile")} hint={t("server.labels.apiKeyFileHint")} value={getEp("api-key-file")}
                onChange={(v) => setEp("api-key-file", v)} />
              <TextInput label={t("server.labels.alias")} hint={t("server.labels.aliasHint")} value={getEp("alias")}
                onChange={(v) => setEp("alias", v)} />
              <TextInput label={t("server.labels.tags")} hint={t("server.labels.tagsHint")} value={getEp("tags")}
                onChange={(v) => setEp("tags", v)} />
              <TextInput label={t("server.labels.apiPrefix")} hint={t("server.labels.apiPrefixHint")} value={getEp("api-prefix")}
                onChange={(v) => setEp("api-prefix", v)} />
              <NumberInput label={t("server.labels.slotPromptSimilarity")} hint={t("server.labels.slotPromptSimilarityHint")} value={getEpNum("slot-prompt-similarity")} step={0.01}
                onChange={(v) => setEpNum("slot-prompt-similarity", v)} />
            </div>

            <Section title={t("server.sections.features")} />
            <div className="space-y-3">
              <Toggle label={t("server.labels.continuousBatching")} hint={t("server.labels.continuousBatchingHint")} checked={config.cont_batching}
                onChange={(v) => setConfig((c) => ({ ...c, cont_batching: v }))} />
              <Toggle label={t("server.labels.webui")} hint={t("server.labels.webuiHint")} checked={!hasFlag("no-webui")} onChange={(v) => setFlag("no-webui", !v)} />
              <Toggle label={t("server.labels.webuiMcpProxy")} hint={t("server.labels.webuiMcpProxyHint")} checked={hasFlag("webui-mcp-proxy")} onChange={(v) => setFlag("webui-mcp-proxy", v)} />
              <Toggle label={t("server.labels.metrics")} hint={t("server.labels.metricsHint")} checked={hasFlag("metrics")} onChange={(v) => setFlag("metrics", v)} />
              <Toggle label={t("server.labels.props")} hint={t("server.labels.propsHint")} checked={hasFlag("props")} onChange={(v) => setFlag("props", v)} />
              <Toggle label={t("server.labels.slotsEndpoint")} hint={t("server.labels.slotsEndpointHint")} checked={!hasFlag("no-slots")} onChange={(v) => setFlag("no-slots", !v)} />
              <Toggle label={t("server.labels.embedding")} hint={t("server.labels.embeddingHint")} checked={hasFlag("embedding")} onChange={(v) => setFlag("embedding", v)} />
              <Toggle label={t("server.labels.reranking")} hint={t("server.labels.rerankingHint")} checked={hasFlag("reranking")} onChange={(v) => setFlag("reranking", v)} />
              <Toggle label={t("server.labels.warmup")} hint={t("server.labels.warmupHint")} checked={!hasFlag("no-warmup")} onChange={(v) => setFlag("no-warmup", !v)} />
            </div>
            <div className="grid grid-cols-1 gap-3 mt-2">
              <TextInput label={t("server.labels.tools")} hint={t("server.labels.toolsHint")}
                value={getEp("tools")} onChange={(v) => setEp("tools", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <TextInput label={t("server.labels.embdSeparator")} hint={t("server.labels.embdSeparatorHint")} value={getEp("embd-separator")}
                onChange={(v) => setEp("embd-separator", v)} />
              <TextInput label={t("server.labels.clsSeparator")} hint={t("server.labels.clsSeparatorHint")} value={getEp("cls-separator")}
                onChange={(v) => setEp("cls-separator", v)} />
            </div>

            <Section title={t("server.sections.ssl")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.sslKeyFile")} value={getEp("ssl-key-file")} onChange={(v) => setEp("ssl-key-file", v)} />
              <TextInput label={t("server.labels.sslCertFile")} value={getEp("ssl-cert-file")} onChange={(v) => setEp("ssl-cert-file", v)} />
            </div>

            <Section title={t("server.sections.paths")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.staticFilesPath")} value={getEp("path")} onChange={(v) => setEp("path", v)} />
              <TextInput label={t("server.labels.slotSavePath")} hint={t("server.labels.slotSavePathHint")} value={getEp("slot-save-path")}
                onChange={(v) => setEp("slot-save-path", v)} />
              <TextInput label={t("server.labels.mediaPath")} hint={t("server.labels.mediaPathHint")} value={getEp("media-path")}
                onChange={(v) => setEp("media-path", v)} />
              <TextInput label={t("server.labels.webuiConfig")} hint={t("server.labels.webuiConfigHint")} value={getEp("webui-config")}
                onChange={(v) => setEp("webui-config", v)} />
              <TextInput label={t("server.labels.webuiConfigFile")} hint={t("server.labels.webuiConfigFileHint")} value={getEp("webui-config-file")}
                onChange={(v) => setEp("webui-config-file", v)} />
            </div>
          </>}

          {/* ════════════════════════ CHAT ════════════════════════ */}
          {activeTab === "chat" && <>
            <Section title={t("server.sections.chatTemplate")} />
            <div className="grid grid-cols-1 gap-3">
              <TextInput label={t("server.labels.chatTemplate")} hint={t("server.labels.chatTemplateHint")} value={getEp("chat-template")}
                onChange={(v) => setEp("chat-template", v)} />
              <TextInput label={t("server.labels.chatTemplateFile")} hint={t("server.labels.chatTemplateFileHint")} value={getEp("chat-template-file")}
                onChange={(v) => setEp("chat-template-file", v)} />
              <TextInput label={t("server.labels.chatTemplateKwargs")} hint={t("server.labels.chatTemplateKwargsHint")} value={getEp("chat-template-kwargs")}
                placeholder='{"key":"value"}' onChange={(v) => setEp("chat-template-kwargs", v)} />
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.jinja")} hint={t("server.labels.jinjaHint")} checked={!hasFlag("no-jinja")} onChange={(v) => setFlag("no-jinja", !v)} />
              <Toggle label={t("server.labels.prefillAssistant")} hint={t("server.labels.prefillAssistantHint")}
                checked={!hasFlag("no-prefill-assistant")} onChange={(v) => setFlag("no-prefill-assistant", !v)} />
              <Toggle label={t("server.labels.skipChatParsing")} hint={t("server.labels.skipChatParsingHint")}
                checked={hasFlag("skip-chat-parsing")} onChange={(v) => setFlag("skip-chat-parsing", v)} />
            </div>

            <Section title={t("server.sections.reasoning")} />
            <div className="grid grid-cols-2 gap-3">
              <SelectInput label={t("server.labels.reasoning")} hint={t("server.labels.reasoningHint")} value={getEp("reasoning") || "auto"}
                options={[{ value: "auto", label: t("server.options.auto") + " (default)" }, { value: "on", label: t("server.options.on") }, { value: "off", label: t("server.options.off") }]}
                onChange={(v) => setEp("reasoning", v === "auto" ? "" : v)} />
              <SelectInput label={t("server.labels.reasoningFormat")} value={getEp("reasoning-format") || "auto"}
                options={[{ value: "auto", label: t("server.options.auto") + " (default)" }, { value: "none", label: "None" }, { value: "deepseek", label: "DeepSeek" }, { value: "deepseek-legacy", label: "DeepSeek Legacy" }]}
                onChange={(v) => setEp("reasoning-format", v === "auto" ? "" : v)} />
              <NumberInput label={t("server.labels.reasoningBudget")} hint={t("server.labels.reasoningBudgetHint")} value={getEpNum("reasoning-budget")}
                onChange={(v) => setEpNum("reasoning-budget", v)} />
              <TextInput label={t("server.labels.budgetMessage")} hint={t("server.labels.budgetMessageHint")} value={getEp("reasoning-budget-message")}
                onChange={(v) => setEp("reasoning-budget-message", v)} />
            </div>

            <Section title={t("server.sections.output")} />
            <div className="space-y-3">
              <Toggle label={t("server.labels.escapeSequences")} hint={t("server.labels.escapeSequencesHint")} checked={!hasFlag("no-escape")} onChange={(v) => setFlag("no-escape", !v)} />
              <Toggle label={t("server.labels.specialTokens")} hint={t("server.labels.specialTokensHint")} checked={hasFlag("special")} onChange={(v) => setFlag("special", v)} />
              <Toggle label={t("server.labels.verbosePrompt")} hint={t("server.labels.verbosePromptHint")} checked={hasFlag("verbose-prompt")} onChange={(v) => setFlag("verbose-prompt", v)} />
              <Toggle label={t("server.labels.spmInfill")} hint={t("server.labels.spmInfillHint")} checked={hasFlag("spm-infill")} onChange={(v) => setFlag("spm-infill", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <SelectInput label={t("server.labels.pooling")} hint={t("server.labels.poolingHint")} value={getEp("pooling") || ""}
                options={[{ value: "", label: t("server.options.disabled") }, { value: "none", label: "None" }, { value: "mean", label: "Mean" }, { value: "cls", label: "CLS" }, { value: "last", label: "Last" }, { value: "rank", label: "Rank" }]}
                onChange={(v) => setEp("pooling", v)} />
            </div>
          </>}

          {/* ════════════════════════ ADVANCED ════════════════════════ */}
          {activeTab === "advanced" && <>
            <Section title={t("server.sections.rope")} />
            <div className="grid grid-cols-2 gap-3">
              <SelectInput label={t("server.labels.ropeScaling")} value={getEp("rope-scaling") || ""}
                options={[{ value: "", label: t("server.options.disabled") }, { value: "none", label: "None" }, { value: "linear", label: "Linear" }, { value: "yarn", label: "YaRN" }]}
                onChange={(v) => setEp("rope-scaling", v)} />
              <NumberInput label={t("server.labels.ropeScale")} hint={t("server.labels.ropeScaleHint")} value={getEpNum("rope-scale")} step={0.1}
                onChange={(v) => setEpNum("rope-scale", v)} />
              <NumberInput label={t("server.labels.ropeFreqBase")} value={config.rope_freq_base} step={1000}
                onChange={(v) => setConfig((c) => ({ ...c, rope_freq_base: v }))} />
              <NumberInput label={t("server.labels.ropeFreqScale")} value={config.rope_freq_scale} step={0.001}
                onChange={(v) => setConfig((c) => ({ ...c, rope_freq_scale: v }))} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <NumberInput label={t("server.labels.yarnOrigCtx")} value={getEpNum("yarn-orig-ctx")} onChange={(v) => setEpNum("yarn-orig-ctx", v)} />
              <NumberInput label={t("server.labels.yarnExtFactor")} hint={t("server.labels.yarnExtFactorHint")} value={getEpNum("yarn-ext-factor")} step={0.1}
                onChange={(v) => setEpNum("yarn-ext-factor", v)} />
              <NumberInput label={t("server.labels.yarnAttnFactor")} value={getEpNum("yarn-attn-factor")} step={0.1}
                onChange={(v) => setEpNum("yarn-attn-factor", v)} />
              <NumberInput label={t("server.labels.yarnBetaSlow")} value={getEpNum("yarn-beta-slow")} step={0.1}
                onChange={(v) => setEpNum("yarn-beta-slow", v)} />
              <NumberInput label={t("server.labels.yarnBetaFast")} value={getEpNum("yarn-beta-fast")} step={0.1}
                onChange={(v) => setEpNum("yarn-beta-fast", v)} />
            </div>

            <Section title={t("server.sections.speculativeDecoding")} />
            <div className="space-y-3">
              <Toggle label={t("server.labels.specDefault")}
                hint={t("server.labels.specDefaultHint")}
                checked={hasFlag("spec-default")} onChange={(v) => setFlag("spec-default", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <TextInput label={t("server.labels.draftModel")} hint={t("server.labels.draftModelHint")} value={getEp("spec-draft-model")}
                onChange={(v) => setEp("spec-draft-model", v)} />
              <SelectInput label={t("server.labels.specType")} hint={t("server.labels.specTypeHint")} value={getEp("spec-type") || ""}
                options={[{ value: "", label: t("server.options.none") },
                  { value: "draft-simple", label: "Draft Simple" }, { value: "draft-eagle3", label: "Draft EAGLE3" }, { value: "draft-mtp", label: "Draft MTP" },
                  { value: "ngram-cache", label: "N-gram Cache" }, { value: "ngram-simple", label: "N-gram Simple" },
                  { value: "ngram-map-k", label: "N-gram Map K" }, { value: "ngram-map-k4v", label: "N-gram Map K4V" }, { value: "ngram-mod", label: "N-gram Mod" }]}
                onChange={(v) => setEp("spec-type", v)} />
              <NumberInput label={t("server.labels.draftMax")} hint={t("server.labels.draftMaxHint")} value={getEpNum("spec-draft-n-max")} min={1}
                onChange={(v) => setEpNum("spec-draft-n-max", v)} />
              <NumberInput label={t("server.labels.draftMin")} hint={t("server.labels.draftMinHint")} value={getEpNum("spec-draft-n-min")} min={0}
                onChange={(v) => setEpNum("spec-draft-n-min", v)} />
              <NumberInput label={t("server.labels.draftPMin")} hint={t("server.labels.draftPMinHint")} value={getEpNum("spec-draft-p-min")} step={0.01}
                onChange={(v) => setEpNum("spec-draft-p-min", v)} />
              <NumberInput label={t("server.labels.draftPSplit")} hint={t("server.labels.draftPSplitHint")} value={getEpNum("spec-draft-p-split")} step={0.01}
                onChange={(v) => setEpNum("spec-draft-p-split", v)} />
              <NumberInput label={t("server.labels.draftCtxSize")} hint={t("server.labels.draftCtxSizeHint")} value={getEpNum("spec-draft-ctx-size")} min={0}
                onChange={(v) => setEpNum("spec-draft-ctx-size", v)} />
              <NumberInput label={t("server.labels.draftGpuLayers")} value={getEpNum("spec-draft-ngl")}
                onChange={(v) => setEpNum("spec-draft-ngl", v)} />
              <NumberInput label={t("server.labels.draftThreads")} hint={t("server.labels.draftThreadsHint")} value={getEpNum("spec-draft-threads")}
                onChange={(v) => setEpNum("spec-draft-threads", v)} />
              <NumberInput label={t("server.labels.draftBatchThreads")} hint={t("server.labels.draftBatchThreadsHint")} value={getEpNum("spec-draft-threads-batch")}
                onChange={(v) => setEpNum("spec-draft-threads-batch", v)} />
              <TextInput label={t("server.labels.draftDevice")} hint={t("server.labels.draftDeviceHint")} value={getEp("spec-draft-device")}
                onChange={(v) => setEp("spec-draft-device", v)} />
              <SelectInput label={t("server.labels.draftKvCacheTypeK")} hint={t("server.labels.draftKvCacheTypeKHint")} value={getEp("spec-draft-type-k") || "f16"}
                options={KV_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => setEp("spec-draft-type-k", v === "f16" ? "" : v)} />
              <SelectInput label={t("server.labels.draftKvCacheTypeV")} hint={t("server.labels.draftKvCacheTypeVHint")} value={getEp("spec-draft-type-v") || "f16"}
                options={KV_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => setEp("spec-draft-type-v", v === "f16" ? "" : v)} />
            </div>
            {/* Per-spec-type ngram controls — shown only for the selected type */}
            {getEp("spec-type") === "ngram-mod" && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <NumberInput label={t("server.labels.ngramModNMin")} hint={t("server.labels.ngramModNMinHint")} value={getEpNum("spec-ngram-mod-n-min")} min={0}
                onChange={(v) => setEpNum("spec-ngram-mod-n-min", v)} />
                <NumberInput label={t("server.labels.ngramModNMax")} hint={t("server.labels.ngramModNMaxHint")} value={getEpNum("spec-ngram-mod-n-max")} min={0}
                onChange={(v) => setEpNum("spec-ngram-mod-n-max", v)} />
                <NumberInput label={t("server.labels.ngramModMatch")} hint={t("server.labels.ngramModMatchHint")} value={getEpNum("spec-ngram-mod-n-match")} min={1}
                onChange={(v) => setEpNum("spec-ngram-mod-n-match", v)} />
              </div>
            )}
            {getEp("spec-type") === "ngram-simple" && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <NumberInput label={t("server.labels.ngramSimpleSizeN")} hint={t("server.labels.ngramSimpleSizeNHint")} value={getEpNum("spec-ngram-simple-size-n")} min={1}
                onChange={(v) => setEpNum("spec-ngram-simple-size-n", v)} />
                <NumberInput label={t("server.labels.ngramSimpleSizeM")} hint={t("server.labels.ngramSimpleSizeMHint")} value={getEpNum("spec-ngram-simple-size-m")} min={1}
                onChange={(v) => setEpNum("spec-ngram-simple-size-m", v)} />
                <NumberInput label={t("server.labels.ngramSimpleMinHits")} value={getEpNum("spec-ngram-simple-min-hits")} min={1}
                onChange={(v) => setEpNum("spec-ngram-simple-min-hits", v)} />
              </div>
            )}
            {getEp("spec-type") === "ngram-map-k" && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <NumberInput label={t("server.labels.ngramMapKSizeN")} hint={t("server.labels.ngramMapKSizeNHint")} value={getEpNum("spec-ngram-map-k-size-n")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k-size-n", v)} />
                <NumberInput label={t("server.labels.ngramMapKSizeM")} hint={t("server.labels.ngramMapKSizeMHint")} value={getEpNum("spec-ngram-map-k-size-m")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k-size-m", v)} />
                <NumberInput label={t("server.labels.ngramMapKMinHits")} value={getEpNum("spec-ngram-map-k-min-hits")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k-min-hits", v)} />
              </div>
            )}
            {getEp("spec-type") === "ngram-map-k4v" && (
              <div className="grid grid-cols-3 gap-3 mt-2">
                <NumberInput label={t("server.labels.ngramMapK4VSizeN")} hint={t("server.labels.ngramMapK4VSizeNHint")} value={getEpNum("spec-ngram-map-k4v-size-n")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k4v-size-n", v)} />
                <NumberInput label={t("server.labels.ngramMapK4VSizeM")} hint={t("server.labels.ngramMapK4VSizeMHint")} value={getEpNum("spec-ngram-map-k4v-size-m")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k4v-size-m", v)} />
                <NumberInput label={t("server.labels.ngramMapK4VMinHits")} value={getEpNum("spec-ngram-map-k4v-min-hits")} min={1}
                onChange={(v) => setEpNum("spec-ngram-map-k4v-min-hits", v)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mt-2">
              <TextInput label={t("server.labels.lookupCacheStatic")} hint={t("server.labels.lookupCacheStaticHint")} value={getEp("lookup-cache-static")}
                onChange={(v) => setEp("lookup-cache-static", v)} />
              <TextInput label={t("server.labels.lookupCacheDynamic")} hint={t("server.labels.lookupCacheDynamicHint")} value={getEp("lookup-cache-dynamic")}
                onChange={(v) => setEp("lookup-cache-dynamic", v)} />
            </div>

            <Section title={t("server.sections.loraAndControlVectors")} />
            <div className="grid grid-cols-1 gap-3">
              <TextInput label={t("server.labels.lora")} hint={t("server.labels.loraHint")} value={getEp("lora")}
                onChange={(v) => setEp("lora", v)} />
              <TextInput label={t("server.labels.loraScaled")} hint={t("server.labels.loraScaledHint")} value={getEp("lora-scaled")}
                onChange={(v) => setEp("lora-scaled", v)} />
              <TextInput label={t("server.labels.controlVector")} hint={t("server.labels.controlVectorHint")} value={getEp("control-vector")}
                onChange={(v) => setEp("control-vector", v)} />
              <TextInput label={t("server.labels.controlVectorScaled")} hint={t("server.labels.controlVectorScaledHint")} value={getEp("control-vector-scaled")}
                onChange={(v) => setEp("control-vector-scaled", v)} />
            </div>
            <Toggle label={t("server.labels.loraInitWithoutApply")} hint={t("server.labels.loraInitWithoutApplyHint")}
              checked={hasFlag("lora-init-without-apply")} onChange={(v) => setFlag("lora-init-without-apply", v)} />

            <Section title={t("server.sections.multimodal")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.mmprojUrl")} value={getEp("mmproj-url")}
                onChange={(v) => setEp("mmproj-url", v)} />
              <NumberInput label={t("server.labels.imageMinTokens")} value={getEpNum("image-min-tokens")} min={0}
                onChange={(v) => setEpNum("image-min-tokens", v)} />
              <NumberInput label={t("server.labels.imageMaxTokens")} value={getEpNum("image-max-tokens")} min={0}
                onChange={(v) => setEpNum("image-max-tokens", v)} />
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.mmprojOffload")} hint={t("server.labels.mmprojOffloadHint")}
                checked={!hasFlag("no-mmproj-offload")} onChange={(v) => setFlag("no-mmproj-offload", !v)} />
            </div>

            <Section title={t("server.sections.ttsAudio")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.vocoderModel")} hint={t("server.labels.vocoderModelHint")} value={getEp("model-vocoder")}
                onChange={(v) => setEp("model-vocoder", v)} />
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.ttsGuideTokens")} hint={t("server.labels.ttsGuideTokensHint")} checked={hasFlag("tts-use-guide-tokens")} onChange={(v) => setFlag("tts-use-guide-tokens", v)} />
            </div>

            <Section title={t("server.sections.cpuAffinity")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.cpuMask")} hint={t("server.labels.cpuMaskHint")} value={getEp("cpu-mask")} onChange={(v) => setEp("cpu-mask", v)} />
              <TextInput label={t("server.labels.cpuRange")} hint={t("server.labels.cpuRangeHint")} value={getEp("cpu-range")} onChange={(v) => setEp("cpu-range", v)} />
              <SelectInput label={t("server.labels.cpuStrict")} value={getEp("cpu-strict") || "0"}
                options={[{ value: "0", label: t("server.options.off") + " (default)" }, { value: "1", label: t("server.options.on") }]}
                onChange={(v) => setEp("cpu-strict", v === "0" ? "" : v)} />
              <SelectInput label={t("server.labels.priority")} value={getEp("prio") || "0"}
                options={[{ value: "-1", label: "Low" }, { value: "0", label: "Normal (default)" }, { value: "1", label: "Medium" }, { value: "2", label: "High" }, { value: "3", label: "Realtime" }]}
                onChange={(v) => setEp("prio", v === "0" ? "" : v)} />
              <NumberInput label={t("server.labels.poll")} hint={t("server.labels.pollHint")} value={getEpNum("poll")} min={0} max={100}
                onChange={(v) => setEpNum("poll", v)} />
            </div>

            <Section title={t("server.sections.logging")} />
            <div className="grid grid-cols-2 gap-3">
              <TextInput label={t("server.labels.logFile")} value={getEp("log-file")} onChange={(v) => setEp("log-file", v)} />
              <SelectInput label={t("server.labels.logColors")} value={getEp("log-colors") || "auto"}
                options={[{ value: "auto", label: t("server.options.auto") }, { value: "on", label: t("server.options.on") }, { value: "off", label: t("server.options.off") }]}
                onChange={(v) => setEp("log-colors", v === "auto" ? "" : v)} />
              <SelectInput label={t("server.labels.verbosity")} value={getEp("log-verbosity") || "3"}
                options={[{ value: "0", label: "0 - Generic" }, { value: "1", label: "1 - Error" }, { value: "2", label: "2 - Warning" }, { value: "3", label: "3 - Info (default)" }, { value: "4", label: "4 - Debug" }]}
                onChange={(v) => setEp("log-verbosity", v === "3" ? "" : v)} />
            </div>
            <div className="space-y-3 mt-2">
              <Toggle label={t("server.labels.verbose")} hint={t("server.labels.verboseHint")} checked={hasFlag("verbose")} onChange={(v) => setFlag("verbose", v)} />
              <Toggle label={t("server.labels.perfTimings")} hint={t("server.labels.perfTimingsHint")} checked={hasFlag("perf")} onChange={(v) => setFlag("perf", v)} />
              <Toggle label={t("server.labels.logPrefix")} hint={t("server.labels.logPrefixHint")} checked={hasFlag("log-prefix")} onChange={(v) => setFlag("log-prefix", v)} />
              <Toggle label={t("server.labels.logTimestamps")} hint={t("server.labels.logTimestampsHint")} checked={hasFlag("log-timestamps")} onChange={(v) => setFlag("log-timestamps", v)} />
              <Toggle label={t("server.labels.offline")} hint={t("server.labels.offlineHint")} checked={hasFlag("offline")} onChange={(v) => setFlag("offline", v)} />
              <Toggle label={t("server.labels.profile")} hint={t("server.labels.profileHint")} checked={hasFlag("profile")} onChange={(v) => setFlag("profile", v)} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <TextInput label={t("server.labels.profileOutput")} hint={t("server.labels.profileOutputHint")} value={getEp("profile-output")}
                onChange={(v) => setEp("profile-output", v)} />
            </div>

            <Section title={t("server.sections.extraArguments")} />
            <div>
              <label className="label">{t("server.labels.rawCliArgs")}</label>
              <p className="text-xs text-gray-600 mb-1">
                {t("server.labels.rawCliArgsHint")}
              </p>
              <input type="text" className="input font-mono text-xs"
                value={getEp("__raw__")} placeholder="e.g. --reverse-prompt '### Human:'"
                onChange={(e) => setEp("__raw__", e.target.value)} />
            </div>
          </>}
        </div>

        {/* Server logs */}
        <div className="card">
          <div className="w-full flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => setShowLogs(!showLogs)}
            >
              <Terminal size={15} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-300">{t("server.labels.serverLogs")}</span>
              {logs.length > 0 && <span className="badge-gray text-[10px]">{logs.length}</span>}
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t("server.labels.copyLogs")}
                title={t("server.labels.copyLogs")}
                disabled={logs.length === 0}
                onClick={async () => {
                  const text = logs.join("\n");
                  try {
                    await navigator.clipboard.writeText(text);
                  } catch {
                    // Fallback: temporary textarea (works in dev / Tauri webview)
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    ta.style.position = "fixed";
                    ta.style.opacity = "0";
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand("copy"); } catch {}
                    document.body.removeChild(ta);
                  }
                  setCopiedLogs(true);
                  window.setTimeout(() => setCopiedLogs(false), 1500);
                }}
                className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {copiedLogs
                  ? <CircleCheck size={13} className="text-primary" />
                  : <ClipboardCopy size={13} className="text-gray-500" />}
              </button>
              <button
                type="button"
                className="btn-ghost p-1"
                onClick={() => setShowLogs(!showLogs)}
                aria-label={showLogs ? t("server.labels.collapsePanel") : t("server.labels.expandPanel")}
              >
                {showLogs ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
              </button>
            </div>
          </div>
          {showLogs && (
            <div ref={logsRef} className="mt-3 bg-surface-0 p-3 h-48 overflow-y-auto font-mono text-xs text-gray-400 space-y-0.5">
              {logs.length === 0 ? (
                <span className="text-gray-600">No logs yet…</span>
              ) : logs.map((line, i) => (
                <div key={i} className={
                  line.toLowerCase().includes("error") ? "text-accent-red" :
                  line.toLowerCase().includes("warn") ? "text-accent-yellow" :
                  line.includes("[stderr]") ? "text-gray-600" : "text-gray-400"
                }>{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
