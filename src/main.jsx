import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { mark } from "./utils/startupPerf.js";
import "./index.css";
import "./styles/settings-dark.css";

// 陈旧 hash chunk 自愈：部署后旧入口引用的懒加载 chunk 可能已从当前
// 资源清单移除。捕获脚本错误和动态 import 的 rejected promise，带一次
// cache-busting 查询重新取得入口 HTML；短时间内最多尝试两次，避免循环刷新。
const CHUNK_RECOVERY_KEY = "marchcenter_chunk_recovery";
const STALE_CHUNK_ERROR = /failed to fetch dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|module script failed/i;

function isStaleChunkError(value) {
    const message = value instanceof Error ? value.message : String(value || "");
    return STALE_CHUNK_ERROR.test(message);
}

function recoverFromStaleChunk() {
    if (typeof window === "undefined") return;
    const now = Date.now();
    let state = { attempts: 0, startedAt: now };
    try {
        const stored = JSON.parse(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || "null");
        if (stored && now - Number(stored.startedAt) < 30000) state = stored;
        if (state.attempts >= 2) return;
        sessionStorage.setItem(CHUNK_RECOVERY_KEY, JSON.stringify({
            attempts: Number(state.attempts || 0) + 1,
            startedAt: Number(state.startedAt || now)
        }));
    } catch {
        // 隐私模式可能禁用 sessionStorage；仍尝试一次带查询的入口刷新。
        if (state.attempts >= 1) return;
    }

    const freshUrl = new URL(window.location.href);
    freshUrl.searchParams.set("__mc_chunk_reload", String(now));
    window.location.replace(freshUrl.toString());
}

if (typeof window !== "undefined") {
    const cleanRecoveryQuery = new URL(window.location.href);
    if (cleanRecoveryQuery.searchParams.has("__mc_chunk_reload")) {
        cleanRecoveryQuery.searchParams.delete("__mc_chunk_reload");
        window.history.replaceState(null, "", `${cleanRecoveryQuery.pathname}${cleanRecoveryQuery.search}${cleanRecoveryQuery.hash}`);
    }

    window.addEventListener("error", (event) => {
        const target = event.target;
        if (target?.tagName === "SCRIPT" && /\/assets\/[A-Za-z0-9_.-]+\.js$/.test(target.src || "")) {
            recoverFromStaleChunk();
        }
    }, true);
    window.addEventListener("unhandledrejection", (event) => {
        if (isStaleChunkError(event.reason)) {
            event.preventDefault();
            recoverFromStaleChunk();
        }
    });
}

mark('mainJsExecuted');
mark('reactStart');
ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
mark('reactRootMounted');
