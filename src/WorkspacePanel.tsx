import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileCode2, Folder, FolderTree, List, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import useGitOperation from "./useGitOperation";
import type { WorkspaceFile, WorkspaceDiff, WorkspaceGroup, WorkspaceCommitResult, BranchSyncTarget } from "./storage";
import GitWorkflowPanel from "./GitWorkflowPanel";

const groups: { key: WorkspaceGroup; label: string }[] = [
  { key: "unstaged", label: "未暂存" },
  { key: "staged", label: "已暂存" },
  { key: "untracked", label: "未跟踪" },
];
const labels: Record<string, string> = { M: "修改", A: "新增", D: "删除", R: "重命名", C: "复制", T: "类型变化", U: "冲突", "?": "新增" };
type FileTree = { files: WorkspaceFile[]; directories: Map<string, FileTree> };
function buildFileTree(files: WorkspaceFile[]) {
  const root: FileTree = {files: [], directories: new Map()};
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.directories.has(part)) node.directories.set(part, {files: [], directories: new Map()});
      node = node.directories.get(part)!;
    }
    node.files.push(file);
  }
  return root;
}

export default function WorkspacePanel({ path, close, onCommitted, onRequestMR, embedded = false }: { path: string; close(): void; onCommitted(result: WorkspaceCommitResult): Promise<void>; onRequestMR(target: BranchSyncTarget): Promise<void>; embedded?: boolean }) {
  const operation = useGitOperation();
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selected, setSelected] = useState<WorkspaceFile | null>(null);
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState("");
  const [diffError, setDiffError] = useState("");
  const [revision, setRevision] = useState(0);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [writing, setWriting] = useState(false);
  const writeLock = useRef(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<WorkspaceGroup, boolean>>>({});
  const [collapsedDirectories, setCollapsedDirectories] = useState<Record<string, boolean>>({});
  const [directoryViews, setDirectoryViews] = useState<Partial<Record<WorkspaceGroup, boolean>>>({});
  const busy = writing || loading || operation !== null;
  async function write(action: () => Promise<void>) {
    if (writeLock.current || operation) return;
    writeLock.current = true;
    setWriting(true);
    setActionError("");
    setNotice("");
    try { await action(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "操作失败，请重试"); }
    finally {
      writeLock.current = false;
      setWriting(false);
      setRevision(value => value + 1);
    }
  }
  const chosen = (staged: boolean) => [...new Set(files.filter(file => (file.group === "staged") === staged && checked.includes(`${file.group}:${file.path}`)).map(file => file.path))];
  const selectableFiles = (group?: WorkspaceGroup) => files.filter(file => (!group || file.group === group) && !file.submodule && file.status !== "U");
  const toggleSelection = (items: WorkspaceFile[]) => {
    const keys = items.map(file => `${file.group}:${file.path}`);
    setChecked(current => keys.every(key => current.includes(key)) ? current.filter(key => !keys.includes(key)) : [...new Set([...current, ...keys])]);
  };
  const indexAction = (action: "stage" | "unstage", paths: string[] | null) => write(async () => {
    await window.branchNote!.updateWorkspaceIndex(path, action, paths);
    setNotice(action === "stage" ? "文件已暂存" : "已取消暂存，工作区内容保留");
  });
  useEffect(() => window.branchNote?.subscribeGitOperation(value => {
    if (value === null) setRevision(current => current + 1);
  }), []);
  useEffect(() => {
    let active = true;
    setSelected(null);
    setChecked([]);
    setFiles([]);
    setError("");
    setLoading(false);
    if (operation || !window.branchNote) return;
    setLoading(true);
    void window.branchNote.readWorkspace(path).then(value => {
      if (active) setFiles(value.files);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "读取工作区失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, operation, revision]);
  useEffect(() => {
    let active = true;
    setDiff(null);
    setDiffError("");
    setDiffLoading(false);
    if (!selected || operation || !window.branchNote) return;
    setDiffLoading(true);
    void window.branchNote.readWorkspaceDiff(path, selected.path, selected.group).then(value => {
      if (active) setDiff(value);
    }).catch(reason => {
      if (active) setDiffError(reason instanceof Error ? reason.message : "读取差异失败");
    }).finally(() => { if (active) setDiffLoading(false); });
    return () => { active = false; };
  }, [path, selected, operation, revision]);
  let inHunk = false;
  const lines = (diff?.text ? diff.text.split("\n") : []).map(text => {
    if (text.startsWith("diff --git ")) inHunk = false;
    if (text.startsWith("@@")) {
      inHunk = true;
      return { text, kind: "diff-hunk" };
    }
    return { text, kind: inHunk && text.startsWith("+") ? "diff-added" : inHunk && text.startsWith("-") ? "diff-removed" : "" };
  });
  const added = lines.filter(line => line.kind === "diff-added").length;
  const removed = lines.filter(line => line.kind === "diff-removed").length;
  const renderFile = (file: WorkspaceFile) => (
    <div className="workspace-file-row" key={`${file.group}:${file.path}`}>
      <input type="checkbox" aria-label={`选择${groups.find(group => group.key === file.group)?.label || ""}文件 ${file.path}`} disabled={busy || file.submodule || file.status === "U"} checked={checked.includes(`${file.group}:${file.path}`)} onChange={event => setChecked(current => event.target.checked ? [...current, `${file.group}:${file.path}`] : current.filter(key => key !== `${file.group}:${file.path}`))} />
      <button type="button" className={`workspace-file ${selected?.path === file.path && selected.group === file.group ? "active" : ""}`} aria-pressed={selected?.path === file.path && selected.group === file.group} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} onClick={() => { setDiff(null); setSelected(file); }}>
        <FileCode2 size={14} aria-hidden="true" />
        <span>{file.originalPath ? `${file.originalPath} → ${file.path.split("/").at(-1)}` : file.path.split("/").at(-1)}</span>
        <small>{file.submodule ? "子模块" : labels[file.status] || file.status}</small>
      </button>
    </div>
  );
  const directoryKeys = (tree: FileTree, group: WorkspaceGroup, parent = ""): string[] => [...tree.directories.entries()].flatMap(([name, child]) => {
    const key = `${group}:${parent}${name}`;
    return [key, ...directoryKeys(child, group, `${parent}${name}/`)];
  });
  const toggleGroupDirectories = (group: WorkspaceGroup) => {
    const directories = directoryKeys(buildFileTree(files.filter(file => file.group === group)), group);
    const allCollapsed = directories.length > 0 && directories.every(key => collapsedDirectories[key]);
    setCollapsedDirectories(current => ({...current, ...Object.fromEntries(directories.map(key => [key, !allCollapsed]))}));
  };
  const fileCount = (tree: FileTree): number => tree.files.length + [...tree.directories.values()].reduce((count, child) => count + fileCount(child), 0);
  const renderTree = (tree: FileTree, group: WorkspaceGroup, parent = "") => <>
    {[...tree.directories.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => (
      <div className="workspace-directory" key={`${group}:${parent}${name}`}>
        <button type="button" className="workspace-directory-toggle" aria-expanded={!collapsedDirectories[`${group}:${parent}${name}`]} onClick={() => setCollapsedDirectories(current => ({...current, [`${group}:${parent}${name}`]: !current[`${group}:${parent}${name}`]}))}>
          {collapsedDirectories[`${group}:${parent}${name}`] ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          <Folder size={14} aria-hidden="true" />
          <span>{name}</span>
          <small>{fileCount(child)} 个文件</small>
        </button>
        {!collapsedDirectories[`${group}:${parent}${name}`] && <div className="workspace-directory-children">{renderTree(child, group, `${parent}${name}/`)}</div>}
      </div>
    ))}
    {tree.files.sort((a, b) => a.path.localeCompare(b.path)).map(renderFile)}
  </>;
  const selectedPaths = [...new Set(files.filter(file => checked.includes(`${file.group}:${file.path}`)).map(file => file.path))];
  const allSelectable = selectableFiles();
  const allSelected = allSelectable.length > 0 && allSelectable.every(file => checked.includes(`${file.group}:${file.path}`));
  const visibleGroups = groups.filter(group => files.some(file => file.group === group.key));
  async function submitCommit(mode: "selected" | "staged", pushAfterCommit: boolean) {
    await write(async () => {
      const result = mode === "selected"
        ? await window.branchNote!.commitWorkspaceFiles(path, title, body, selectedPaths)
        : await window.branchNote!.commitWorkspace(path, title, body);
      setTitle("");
      setBody("");
      try { await onCommitted(result); }
      catch (reason) { setActionError(`Git 提交已完成，但台账更新失败：${reason instanceof Error ? reason.message : "请检查本地存储"}`); }
      if (!pushAfterCommit) {
        setNotice(`提交成功 ${result.commit.slice(0, 8)}，仅包含${mode === "selected" ? "所选文件" : "暂存区内容"}`);
        return;
      }
      try {
        const workflow = await window.branchNote!.readGitWorkflow(path);
        if (!workflow.status.branch || !workflow.upstream || workflow.upstream.remote === ".")
          throw new Error("当前分支没有可用的远程上游，请在“切换分支 / 同步”中配置后再推送");
        await window.branchNote!.syncCurrentBranch(path, "push", {branch: workflow.status.branch, remote: workflow.upstream.remote, target: workflow.upstream.branch});
        setNotice(`提交并推送成功 ${result.commit.slice(0, 8)}`);
      } catch (reason) {
        setNotice(`提交成功 ${result.commit.slice(0, 8)}，但尚未推送到远程`);
        throw new Error(`提交已完成，但推送失败：${reason instanceof Error ? reason.message : "请检查远程仓库"}`);
      }
    });
  }
  const content = (
    <>
      <div className="workspace-body">
        <div className="workspace-toolbar">
          <p className="picker-note">管理本地改动 · 文本差异最多 512 KiB / 4000 行</p>
          <div className="workspace-toolbar-actions">
            <button type="button" className="secondary" aria-busy={loading} disabled={busy} title="重新读取外部 Git 改动" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true" className={loading ? "spin" : ""} />{loading ? "读取中…" : "重新读取"}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setWorkflowOpen(true)}>切换分支 / 同步</button>
          </div>
        </div>
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {notice && <p className="picker-note" role="status">{notice}</p>}
        <div className="workspace-actions">
          <button type="button" className="secondary" disabled={busy || !allSelectable.length} onClick={() => toggleSelection(allSelectable)}>{allSelected ? "清除全部选择" : "全选全部文件"}</button>
          <button type="button" className="secondary" disabled={busy || !chosen(false).length} onClick={() => void indexAction("stage", chosen(false))}>暂存所选</button>
          <button type="button" className="secondary" disabled={busy || !chosen(true).length} onClick={() => void indexAction("unstage", chosen(true))}>取消暂存所选</button>
        </div>
        <div className="workspace-content">
        {operation ? (
          <p className="picker-note" role="status">正在{operation}，结束后自动刷新工作区。</p>
        ) : loading ? (
          <p className="picker-note" role="status">正在读取工作区…</p>
        ) : error ? (
          <p className="form-error" role="alert">{error}</p>
        ) : (
          <div className="workspace-layout">
            <div className="workspace-files" aria-label="改动文件">
              {!files.length && <p className="picker-note">工作区干净，没有改动文件。</p>}
              {visibleGroups.map(group => {
                const groupFiles = files.filter(file => file.group === group.key);
                const selectable = selectableFiles(group.key);
                const groupSelected = selectable.length > 0 && selectable.every(file => checked.includes(`${file.group}:${file.path}`));
                return (
                <section key={group.key} aria-label={group.label}>
                  <div className="workspace-group-heading" onClick={() => setCollapsedGroups(current => ({...current, [group.key]: !current[group.key]}))}>
                    <button type="button" className="workspace-group-toggle" aria-expanded={!collapsedGroups[group.key]} onClick={event => { event.stopPropagation(); setCollapsedGroups(current => ({...current, [group.key]: !current[group.key]})); }}>{collapsedGroups[group.key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<strong>{group.label}</strong><span>{groupFiles.length}</span></button>
                    <div className="workspace-group-controls" onClick={event => event.stopPropagation()}>
                      <button type="button" className="workspace-icon-button" aria-label={directoryViews[group.key] !== false ? `将${group.label}切换为平铺查看` : `将${group.label}切换为按目录查看`} title={directoryViews[group.key] !== false ? "平铺查看" : "按目录查看"} aria-pressed={directoryViews[group.key] !== false} disabled={!groupFiles.length} onClick={() => setDirectoryViews(current => ({...current, [group.key]: current[group.key] === false}))}>{directoryViews[group.key] !== false ? <List size={15} aria-hidden="true" /> : <FolderTree size={15} aria-hidden="true" />}</button>
                      <button type="button" className="workspace-icon-button" aria-label={`展开或折叠${group.label}目录`} title="展开 / 折叠目录" disabled={!groupFiles.length} onClick={() => toggleGroupDirectories(group.key)}>{directoryKeys(buildFileTree(groupFiles), group.key).every(key => collapsedDirectories[key]) ? <ChevronsUpDown size={15} aria-hidden="true" /> : <ChevronsDownUp size={15} aria-hidden="true" />}</button>
                      <input className="workspace-select-all" type="checkbox" aria-label={`全选${group.label}文件`} title={`全选${group.label}文件`} checked={groupSelected} disabled={busy || !selectable.length} onChange={() => toggleSelection(selectable)} />
                    </div>
                  </div>
                  {!collapsedGroups[group.key] && <div className="workspace-tree">{directoryViews[group.key] !== false ? renderTree(buildFileTree(groupFiles), group.key) : groupFiles.sort((a, b) => a.path.localeCompare(b.path)).map(renderFile)}</div>}
                </section>
                );
              })}
            </div>
            <div className="workspace-preview" aria-label="文件差异" aria-busy={diffLoading}>
              {selected ? (
                <>
                  <h3>{selected.path}</h3>
                  <p className="picker-note">{groups.find(group => group.key === selected.group)?.label} · +{added} / −{removed}</p>
                  <button type="button" className="secondary" disabled={busy || selected.submodule || selected.status === "U"} onClick={() => void indexAction(selected.group === "staged" ? "unstage" : "stage", [selected.path])}>
                    {selected.group === "staged" ? "取消暂存此文件" : "暂存此文件"}
                  </button>
                  {diffLoading && <p role="status">正在读取差异…</p>}
                  {diffError && <p className="form-error" role="alert">{diffError}</p>}
                  {diff?.message && <p className="warning-panel" role="status">{diff.message}</p>}
                  {diff?.kind === "text" && (
                    <pre className="workspace-diff" tabIndex={0} aria-label="统一差异">
                      {lines.map((line, index) => (
                        <span key={index} className={line.kind}>
                          {line.text + "\n"}
                        </span>
                      ))}
                    </pre>
                  )}
                </>
              ) : <p className="picker-note">选择文件查看对应分组的差异。</p>}
            </div>
          </div>
        )}
        <form className="workspace-commit form" onSubmit={event => {
          event.preventDefault();
          void submitCommit("selected", false);
        }}>
          <p className="picker-note">勾选文件后可直接提交；未勾选文件和已有的其他暂存内容会保留。</p>
          <label>
            提交标题
            <input value={title} required disabled={busy} onChange={event => setTitle(event.target.value)} />
          </label>
          <label>
            正文（选填）
            <textarea rows={2} value={body} disabled={busy} onChange={event => setBody(event.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={busy || !!error || !title.trim() || !selectedPaths.length}>
            提交所选文件
          </button>
          <button type="button" className="secondary" disabled={busy || !!error || !title.trim() || !selectedPaths.length} onClick={() => void submitCommit("selected", true)}>提交并推送所选</button>
          <button type="button" className="text-button" disabled={busy || !!error || !title.trim() || !files.some(file => file.group === "staged")} onClick={() => void submitCommit("staged", false)}>改用暂存区提交</button>
        </form>
        </div>
      </div>
      {workflowOpen && <GitWorkflowPanel path={path} close={() => setWorkflowOpen(false)} onRequestMR={onRequestMR} />}
    </>
  );
  if (embedded) return <section className="workspace-inline" aria-label="Git 工作区">{content}</section>;
  return <Modal title="工作区" close={() => { if (!writeLock.current) close(); }} wide className="workspace-modal" autoFocusInput={false}>{content}</Modal>;
}
