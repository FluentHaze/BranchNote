import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  ExternalLink,
  FileWarning,
  GitMerge,
  RefreshCw,
  Undo2,
} from "lucide-react";
import type { ConflictFile } from "./storage";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

// 冲突解决器：在应用内读三方内容、整份采用或直接编辑，提交后交给上层继续合并
export default function ConflictResolver({
  path,
  branch,
  conflicts,
  onResolved,
  onAborted,
  busy,
  setBusy,
}: {
  path: string;
  branch: string;
  conflicts: string[];
  onResolved(): void | Promise<void>;
  onAborted(branch: string): void;
  busy: boolean;
  setBusy(value: boolean): void;
}) {
  const [files, setFiles] = useState<string[]>(() => [...new Set(conflicts)]);
  const [unmerged, setUnmerged] = useState<string[]>(() => [...new Set(conflicts)]);
  const [active, setActive] = useState<string | null>(conflicts[0] || null);
  const [detail, setDetail] = useState<ConflictFile | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmAbort, setConfirmAbort] = useState(false);
  // 已把这个文件交给外部编辑器：轮询它的保存结果，标记清干净就自动算解决
  const [editorOpen, setEditorOpen] = useState(false);
  const draftRef = useRef("");

  const refresh = useCallback(async () => {
    if (!window.branchNote) return null;
    const state = await window.branchNote.mergeState(path);
    setUnmerged(state.unmerged);
    setFiles((prev) => [...new Set([...prev, ...state.unmerged])]);
    setActive((prev) => {
      if (prev && state.unmerged.includes(prev)) return prev;
      return state.unmerged[0] || prev;
    });
    return state;
  }, [path]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const state = await window.branchNote?.mergeState(path);
        if (!live || !state) return;
        setUnmerged(state.unmerged);
        setFiles([...new Set([...conflicts, ...state.unmerged])]);
        setActive(state.unmerged[0] || conflicts[0] || null);
      } catch (reason) {
        if (live) setError(message(reason));
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    if (!active || !window.branchNote) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    void window.branchNote
      .readConflict(path, active)
      .then((file) => {
        if (!live) return;
        setDetail(file);
        setDraft(file.working ?? file.ours ?? file.theirs ?? "");
      })
      .catch((reason) => {
        if (live) setError(message(reason));
      });
    return () => {
      live = false;
    };
  }, [path, active]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // 编辑器里保存后回读：内容稳定且不含冲突标记时，同步进编辑区等用户确认。
  // 不能自动提交——用户清掉冲突标记后往往还在继续改，抢着提交会把中间保存当成最终结果。
  useEffect(() => {
    if (!editorOpen || !active) return;
    const api = window.branchNote;
    if (!api) return;
    const file = active;
    let stop = false;
    let previous = "";
    let stable = 0;
    let synced = draftRef.current;
    const timer = window.setInterval(async () => {
      if (stop) return;
      try {
        const { content } = await api.readWorkingFile(path, file);
        if (stop || content === null) return;
        if (/^(<{7}|={7}|>{7})/m.test(content)) {
          previous = content;
          stable = 0;
          return;
        }
        if (content === previous) stable += 1;
        else {
          previous = content;
          stable = 1;
        }
        if (stable < 2 || content === synced) return;
        synced = content;
        setDraft(content);
        setNotice(
          `已同步编辑器保存的 ${file}（见下方编辑区）。确认无误后点「保存并标记已解决」；全部解决后会自动继续合并。`,
        );
      } catch {
        // 读不到文件时保持轮询，等下一次保存
      }
    }, 1200);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, active, path]);

  async function openInEditor() {
    if (!active || !window.branchNote) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target = await window.branchNote.openConflictInEditor(path, active);
      setEditorOpen(true);
      setNotice(
        `已在编辑器打开 ${target.file}：改完保存，这边会自动同步到下方编辑区；确认内容后点「保存并标记已解决」。`,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const resolvedCount = files.filter((file) => !unmerged.includes(file)).length;
  const remaining = unmerged.length;
  const markers = useMemo(
    () => /^(<{7}|={7}|>{7})/m.test(draft),
    [draft],
  );

  async function act(action: () => Promise<unknown>, done?: string) {
    if (!window.branchNote) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      const state = await refresh();
      // 全部解决：自动提交并继续合并剩余分支，不需要再点一次按钮
      if (state && !state.unmerged.length) {
        setNotice(
          done
            ? `${done}，所有冲突已解决，正在自动继续…`
            : "所有冲突已解决，正在自动继续…",
        );
        await window.branchNote.commitConflict(path, "");
        await onResolved();
        return;
      }
      if (done) setNotice(done);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function take(side: "ours" | "theirs") {
    if (!active) return;
    void act(
      () => window.branchNote!.takeConflictSide(path, active, side),
      `已采用${side === "ours" ? "我方" : "对方"}版本：${active}`,
    );
  }

  function applyContent(content: string | null) {
    setDraft(content ?? "");
    setNotice("");
  }

  // 两边都要：git 三方 union 合并（公共内容不重复），直接保存并标记已解决
  async function both() {
    if (!active || !window.branchNote) return;
    const api = window.branchNote;
    void act(async () => {
      const result = await api.unionConflict(path, active);
      await api.resolveConflict(path, active, result.content);
    }, `已两边都要并解决：${active}`);
  }

  function save() {
    if (!active) return;
    void act(
      () => window.branchNote!.resolveConflict(path, active, draft),
      `已标记为已解决：${active}`,
    );
  }

  async function commit() {
    if (!window.branchNote) return;
    setBusy(true);
    setError("");
    try {
      // 不传 message 时沿用 Git 生成的合并说明
      await window.branchNote.commitConflict(path, "");
      await onResolved();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  async function abort() {
    if (!window.branchNote) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.branchNote.abortConflict(path, "");
      onAborted(result.branch);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const current = detail && detail.file === active ? detail : null;
  return (
    <div className="resolve">
      <div className="resolve-head">
        <span className="resolve-title">
          <FileWarning size={16} />
          解决冲突
          <code>{branch}</code>
        </span>
        <span className="resolve-progress">
          {resolvedCount} / {files.length} 已解决
        </span>
        <button
          className="icon-button"
          aria-label="刷新冲突状态"
          title="如果在外部编辑器里已经解决，可以刷新状态"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await refresh();
            }, "已刷新冲突状态")
          }
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
        </button>
      </div>

      <div className="resolve-body">
        <aside className="resolve-files" aria-label="冲突文件">
          {files.map((file) => {
            const resolved = !unmerged.includes(file);
            return (
              <button
                key={file}
                className={`resolve-file ${file === active ? "active" : ""} ${resolved ? "resolved" : ""}`}
                onClick={() => {
                  setActive(file);
                  setEditorOpen(false);
                  setNotice("");
                }}
              >
                {resolved ? <Check size={14} /> : <CircleAlert size={14} />}
                <span title={file}>{file}</span>
              </button>
            );
          })}
        </aside>

        <section className="resolve-editor">
          {!current ? (
            <p className="resolve-empty">正在读取冲突内容…</p>
          ) : current.binary ? (
            <div className="resolve-binary">
              <p>这是二进制文件，无法直接编辑。</p>
              <p>请选择整份采用我方或对方版本。</p>
            </div>
          ) : (
            <>
              <div className="resolve-toolbar">
                <button
                  className="secondary compact"
                  disabled={busy}
                  onClick={() => void openInEditor()}
                  title="用系统默认编辑器（VS Code / Cursor 等）打开这个文件，保存后内容会同步到这里，确认后标记已解决"
                >
                  <ExternalLink size={14} />
                  {editorOpen ? "编辑器已打开" : "用编辑器解决"}
                </button>
                <span className="toolbar-divider" />
                <button
                  className="secondary compact"
                  disabled={busy || !current.exists.ours}
                  onClick={() => take("ours")}
                  title="整份采用当前分支（我方）的版本，并标记已解决"
                >
                  采用我方
                </button>
                <button
                  className="secondary compact"
                  disabled={busy || !current.exists.theirs}
                  onClick={() => take("theirs")}
                  title="整份采用被合入分支（对方）的版本，并标记已解决"
                >
                  采用对方
                </button>
                <button
                  className="secondary compact"
                  disabled={busy || !current.exists.ours || !current.exists.theirs}
                  onClick={() => void both()}
                  title="保留双方改动（公共内容自动去重），直接保存并标记已解决"
                >
                  两边都要
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    applyContent(current.working ?? current.ours ?? current.theirs)
                  }
                >
                  <Undo2 size={14} />
                  还原
                </button>
              </div>
              <textarea
                className="resolve-text mono"
                aria-label={`编辑 ${active} 的解决结果`}
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy}
              />
              <p className="field-hint">
                {editorOpen
                  ? "编辑器保存后这里会自动同步（不会自动提交，以你点「保存并标记已解决」为准）。"
                  : markers
                    ? "内容里还留着冲突标记（<<<<<<< / ======= / >>>>>>>），提交前建议手动清理。也可以点「用编辑器解决」到 VS Code 里改。"
                    : "直接编辑成最终内容，保存后会自动 git add 标记为已解决。"}
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="picker-note" role="status">
              {notice}
            </p>
          )}
        </section>
      </div>

      <div className="modal-actions resolve-actions">
        <button
          className="danger ghost"
          disabled={busy}
          onClick={() => {
            if (confirmAbort) void abort();
            else setConfirmAbort(true);
          }}
        >
          {confirmAbort ? "确认放弃本次合并？" : "放弃本次合并"}
        </button>
        <span className="spacer" />
        {current && !current.binary && (
          <button
            className="secondary"
            disabled={busy || !unmerged.includes(current.file)}
            onClick={save}
          >
            <Check size={15} />
            保存并标记已解决
          </button>
        )}
        <button
          className="primary"
          disabled={busy || remaining > 0}
          onClick={() => void commit()}
          title={
            remaining > 0 ? `还有 ${remaining} 个冲突文件未解决` : "提交解决结果"
          }
        >
          <GitMerge size={15} />
          {remaining > 0 ? `还有 ${remaining} 个文件` : "提交解决结果，继续合并"}
        </button>
      </div>
    </div>
  );
}
