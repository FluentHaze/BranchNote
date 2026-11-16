import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import useGitOperation from "./useGitOperation";
import type { BranchSyncTarget, GitWorkflow } from "./storage";

export default function GitWorkflowPanel({ path, close, onRequestMR }: {
  path: string;
  close(): void;
  onRequestMR(target: BranchSyncTarget): Promise<void>;
}) {
  const operation = useGitOperation();
  const [data, setData] = useState<GitWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const lock = useRef(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("HEAD");
  const [checkout, setCheckout] = useState(true);
  const [ref, setRef] = useState("");
  const [remote, setRemote] = useState("");
  const [pushed, setPushed] = useState<BranchSyncTarget | null>(null);
  const [fetchResults, setFetchResults] = useState<string[]>([]);
  useEffect(() => window.branchNote?.subscribeGitOperation(value => {
    if (value === null) setRevision(current => current + 1);
  }), []);
  useEffect(() => {
    if (operation) return;
    let active = true;
    setLoading(true);
    setReadError("");
    void window.branchNote!.readGitWorkflow(path).then(value => {
      if (active) setData(value);
    }).catch(reason => {
      if (active) setReadError(reason instanceof Error ? reason.message : "读取分支与同步状态失败");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, operation, revision]);
  const busy = loading || writing || operation !== null;
  const blocked = !data || !!readError || data.status.operations.length > 0 || data.status.conflicts;
  const refs = data?.repository.branches.flatMap(branch => [
    ...(branch.local ? [{value: `refs/heads/${branch.name}`, label: `本地 · ${branch.name}`}] : []),
    ...(branch.remoteRefs || []).map(value => ({value: `refs/remotes/${value}`, label: `远程 · ${value}`})),
  ]) || [];
  const destination = data?.upstream || (remote && data?.status.branch ? {remote, branch: data.status.branch} : null);
  async function act(action: () => Promise<void>, message: string) {
    if (lock.current || operation) return;
    lock.current = true;
    setWriting(true);
    setError("");
    setNotice("");
    setPushed(null);
    try { await action(); setNotice(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Git 操作失败"); }
    finally { lock.current = false; setWriting(false); setRevision(current => current + 1); }
  }
  async function sync(action: "pull" | "push") {
    if (!data?.status.branch || !destination) return;
    await act(async () => {
      const result = await window.branchNote!.syncCurrentBranch(path, action, {
        branch: data.status.branch!, remote: destination.remote, target: destination.branch,
      });
      if (action === "push") setPushed(result);
    }, action === "pull" ? "当前分支已完成快进拉取" : "普通推送成功，上游已确认");
  }
  return (
    <Modal title="分支与远程同步" close={() => { if (!lock.current) close(); }} wide>
      <div className="git-workflow-body">
        <div className="workspace-toolbar">
          <p className="picker-note">当前分支：{data?.status.branch || "无本地分支"} · {data?.status.clean ? "工作区干净" : "工作区有改动"}</p>
        </div>
        {readError && <p className="form-error" role="alert">{readError}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="picker-note" role="status">{notice}</p>}
        {operation && <p className="picker-note" role="status">正在{operation}…</p>}
        {data && !data.status.clean && <p className="warning-panel">切换分支、创建并切换、拉取前请先提交改动。应用不会自动 Stash 或丢弃文件。</p>}
        {blocked && data && <p className="warning-panel">存在未完成 Git 操作或冲突时，请先处理原会话再操作。</p>}
        <div className="git-workflow-grid">
          <section>
            <h3>切换分支</h3>
            <Select searchable label="切换分支" value={ref} options={[{value: "", label: "选择本地或明确的远程引用"}, ...refs]} disabled={busy || blocked} onChange={setRef} />
            <p className="picker-note">远程分支会创建同名本地跟踪分支；不会修改 MR 目标或台账。</p>
            <button type="button" className="secondary" disabled={busy || blocked || !ref || !data?.status.clean} onClick={() => void act(() => window.branchNote!.switchLocalBranch(path, ref), "分支已切换")}>切换到所选分支</button>
            <h3>创建本地分支</h3>
            <label className="host-field">
              分支名称
              <input aria-label="新分支名称" value={name} disabled={busy || blocked} onChange={event => setName(event.target.value)} placeholder="feature/功能名称" />
            </label>
            <span className="field-label">创建起点</span>
            <Select searchable label="创建分支起点" value={source} options={[{value: "HEAD", label: "当前 HEAD"}, ...refs]} disabled={busy || blocked} onChange={setSource} />
            <label className="git-workflow-checkbox">
              <input type="checkbox" checked={checkout} disabled={busy} onChange={event => setCheckout(event.target.checked)} />
              创建后立即切换
            </label>
            <button type="button" className="primary" disabled={busy || blocked || !name.trim() || (data?.status.head === "unborn" && source === "HEAD") || (checkout && !data?.status.clean)} onClick={() => void act(async () => {
              await window.branchNote!.createLocalBranch(path, name.trim(), source, checkout);
              setName("");
            }, "本地分支已创建；可在原分支选择入口按需加入台账")}>创建分支</button>
          </section>
          <section>
            <h3>获取远程引用</h3>
            <p className="picker-note">Fetch 只更新远程引用，不合入当前分支。</p>
            <button type="button" className="secondary" aria-busy={operation === "更新远程引用"} disabled={busy || !data?.repository.remotes.length} onClick={() => void act(async () => {
              setFetchResults([]);
              const result = await window.branchNote!.fetchRepository(path);
              setFetchResults(result.remoteResults.map(item => `${item.remote} · ${item.success ? "成功" : "失败"}：${item.message}`));
            }, "远程引用获取完成，请查看各远程结果")}>
              <RefreshCw size={14} className={operation === "更新远程引用" ? "spin" : ""} aria-hidden="true" />
              获取远程引用（Fetch）
            </button>
            {fetchResults.map(result => <p className="picker-note" key={result}>{result}</p>)}
            <h3>当前分支同步</h3>
            {data?.upstream ? <p className="picker-note">目标：{data.upstream.remote} → {data.upstream.branch}</p> : (
              <>
                <Select label="首次推送远程" value={remote} options={[{value: "", label: "选择首次推送的远程"}, ...(data?.repository.remotes || []).map(value => ({value, label: value}))]} disabled={busy} onChange={value => { setRemote(value); setPushed(null); }} />
                <p className="picker-note">首次推送到同名分支 {data?.status.branch || "—"}，并建立上游。</p>
              </>
            )}
            <p className="picker-note">领先 {data?.status.ahead ?? 0} / 落后 {data?.status.behind ?? 0}，基于最近获取的远程引用。</p>
            <p className="picker-note">普通推送只发送已提交内容，不包含未暂存或未提交的修改。</p>
            {data?.upstream?.remote === "." && <p className="warning-panel">当前上游为本地分支，无法直接进行远程拉取或推送；请先在外部 Git 工具中配置远程上游。</p>}
            <div className="heading-actions">
              <button type="button" className="secondary" disabled={busy || blocked || !data?.status.clean || !data.upstream || data.upstream.remote === "." || data.status.head !== "branch"} onClick={() => void sync("pull")}>快进拉取到当前分支</button>
              <button type="button" className="primary" disabled={busy || blocked || !destination || destination.remote === "." || data?.status.head !== "branch"} onClick={() => void sync("push")}>普通推送</button>
            </div>
            {pushed && pushed.branch === data?.status.branch && destination?.remote === pushed.remote && destination.branch === pushed.target && (
              <button type="button" className="secondary" disabled={busy} onClick={() => void act(async () => { await onRequestMR(pushed); close(); }, "")}>为已推送分支提交 MR / PR</button>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
