import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Play, ExternalLink, RefreshCw } from "lucide-react";
import type { ServerStatus } from "../types";

export default function Chat() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ServerStatus>({ type: "stopped" });

  useEffect(() => {
    const poll = async () => {
      try {
        const s = await invoke<ServerStatus>("get_server_status");
        setStatus(s);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const port = status.type === "running" ? status.port : null;

  if (status.type === "starting") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
        <div className="text-center">
          <p className="text-base font-semibold text-gray-200">{t("chat.serverStarting")}</p>
          <p className="text-sm text-gray-500 mt-1">
            {t("chat.modelLoading")}
          </p>
        </div>
        <RefreshCw size={20} className="animate-spin text-gray-500" />
      </div>
    );
  }

  if (status.type !== "running" || !port) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
        <div className="text-center">
          <p className="text-base font-semibold text-gray-200">{t("chat.serverNotRunning")}</p>
          <p className="text-sm text-gray-500 mt-1">
            {t("chat.startServerFirst")}
          </p>
        </div>
        <button className="btn-primary" onClick={() => navigate("/server")}>
          <Play size={15} />
          {t("chat.goToRun")}
        </button>
      </div>
    );
  }

  const chatUrl = `http://127.0.0.1:${port}`;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs text-gray-500 font-mono">{chatUrl}</span>
        <button
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
          onClick={() => invoke("open_chat_window", { port })}
        >
          <ExternalLink size={12} />
          {t("chat.popOut")}
        </button>
      </div>
      <iframe
        src={chatUrl}
        className="flex-1 w-full border-0"
        allow="clipboard-write"
        title={t("chat.chatTitle")}
      />
    </div>
  );
}
