import { useState } from "react";
import { FolderOpen } from "lucide-react";

export default function RepositoryPicker({
  initialPath = "",
}: {
  initialPath?: string;
}) {
  const [path, setPath] = useState(initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="repository-picker">
      <span className="field-label">
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
              const repository = await window.branchNote!.pickRepository();
              if (repository) setPath(repository.path);
            } catch (error) {
              setError(error instanceof Error ? error.message : "无法读取仓库");
            } finally {
              setBusy(false);
            }
          }}
        >
          <FolderOpen size={16} />
          {busy ? "读取中…" : "选择文件夹"}
        </button>
      </div>
      {!window.branchNote && (
        <p className="field-hint">请在桌面应用中选择本地文件夹。</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
