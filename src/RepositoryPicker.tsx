import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { Repository } from "./storage";

export default function RepositoryPicker({initialPath = ""}: {initialPath?: string}) {
  const [path, setPath] = useState(initialPath);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!path || !window.branchNote || repository?.path === path) return;
    let active = true;
    setBusy(true);
    window.branchNote.readRepository(path)
      .then(value => { if (active) setRepository(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取仓库"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path]);
  return (
    <div className="repository-picker">
      <span className="field-label form-label-inline">
        本地 Git 仓库 <span className="optional">选填</span>
      </span>
      <input type="hidden" name="repositoryPath" value={path} />
      <div className="repository-path">
        <span title={path}>{path || "尚未关联文件夹"}</span>
        <button
          type="button"
          className="secondary"
          disabled={busy || !window.branchNote}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const value = await window.branchNote!.pickRepository();
              if (value) { setRepository(value); setPath(value.path); }
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "无法读取仓库");
            } finally { setBusy(false); }
          }}
        >
          <FolderOpen size={16} />
          {busy ? "读取中…" : "选择文件夹"}
        </button>
      </div>
      {repository && (
        <div className="project-repository-summary">
          <span>当前分支 <code>{repository.current || "分离 HEAD"}</code></span>
          <span>{repository.branches.length} 个仓库分支</span>
          {Object.entries(repository.remoteUrls || {}).map(([name, url]) => (
            <span key={name} title={url}>{name} <code>{url}</code></span>
          ))}
        </div>
      )}
      {!window.branchNote && <p className="field-hint">请在桌面应用中选择本地文件夹。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
