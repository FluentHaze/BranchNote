import { useEffect, useState } from "react";
import { version } from "../package.json";
import type { UpdateAction, UpdateState } from "./update";

export default function AppUpdate({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState("");
  useEffect(() => {
    const api = window.branchNote;
    if (!api) return;
    let alive = true;
    let received = false;
    const unsubscribe = api.subscribeUpdate(value => {
      received = true;
      if (alive) setState(value);
    });
    void api.getUpdate().then(value => {
      if (alive && !received) setState(value);
    }).catch(() => {
      if (alive) setError("无法读取更新状态，请重新打开设置");
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const run = async (action: UpdateAction) => {
    setError("");
    try {
      await window.branchNote?.update(action);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新操作失败，请重试");
    }
  };
  const status = state?.status;
  const dmg = state?.installMode === "dmg";
  const message = !window.branchNote ? "浏览器预览版不支持应用更新"
    : status === "manual" ? "当前平台或开发版请前往下载页面安装更新"
    : status === "checking" ? "正在检查新版本…"
    : status === "downloading" ? `正在下载更新… ${Math.floor(state?.percent ?? 0)}%`
    : status === "downloaded" ? dmg ? "安装包已就绪，点击后自动安装并重启" : "更新已就绪，重启后生效"
    : status === "installing" ? "正在准备安装，完成后将自动重启…"
    : status === "latest" ? "当前已是最新版本"
    : status === "error" ? state?.error
    : dmg ? "发现新版后自动后台下载，点击安装更新" : "发现新版后自动后台下载，点击重启更新";
  const failed = error || state?.error;
  if (compact) {
    if (!failed && !["downloading", "downloaded", "installing"].includes(status ?? "")) return null;
    return (
      <section className="update-notice" aria-label="版本更新">
        <strong>{failed ? "更新失败，点击重试" : status === "downloaded" ? "新版本已就绪" : status === "installing" ? "安装中…" : "发现新版本"}</strong>
        <span role="status" aria-live="polite">
          {state?.version && `v${state.version} · `}
          {failed || message}
        </span>
        {status === "downloading" && !failed && (
          <progress aria-label="更新下载进度" max={100} value={state?.percent ?? 0} />
        )}
        <button
          disabled={status === "installing"}
          onClick={() => status === "downloaded" && !failed ? void run("install") : onOpen?.()}
        >
          {status === "installing" ? "安装中…" : status === "downloaded" && !failed ? "重启并安装" : "查看更新"}
        </button>
      </section>
    );
  }
  const busy = !window.branchNote || (!state && !error) || ["checking", "downloading", "installing"].includes(status ?? "");
  return (
    <section className="settings-panel app-update">
      <h2>版本更新 · v{state?.currentVersion ?? version}</h2>
      <p className="settings-copy" role="status">
        {message}
        {state?.version && ` · v${state.version}`}
      </p>
      {status === "downloading" && (
        <progress aria-label="更新下载进度" max={100} value={state?.percent ?? 0} />
      )}
      {failed && <p className="update-error" role="alert">{failed}</p>}
      <div className="update-actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void run(status === "downloaded" ? "install" : status === "manual" ? "manual" : "check")}
        >
          {status === "downloaded" ? "重启并安装" : status === "manual" ? "下载最新版" : status === "checking" ? "检查中…" : status === "downloading" ? "下载中…" : status === "installing" ? "安装中…" : "检查更新"}
        </button>
        {status === "error" && (
          <button onClick={() => void run("manual")}>前往下载页面</button>
        )}
      </div>
      {status === "downloaded" && (
        <p className="settings-copy">
          {dmg ? "安装时会自动退出 BranchNote、替换应用并重新打开。系统需要授权时按提示操作，应用数据和令牌配置会保留。" : "重启会关闭当前窗口，请先完成 Git 操作。应用数据和令牌配置会保留。"}
        </p>
      )}
    </section>
  );
}
