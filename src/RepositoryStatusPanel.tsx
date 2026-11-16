import { useEffect, useState } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import type { RepositoryStatus, WorkspaceCommitResult, BranchSyncTarget } from "./storage";
import useGitOperation from "./useGitOperation";
import WorkspacePanel from "./WorkspacePanel";
import GitWorkflowPanel from "./GitWorkflowPanel";

const operationNames: Record<RepositoryStatus["operations"][number], string> = {
  merge: "合并",
  rebase: "Rebase / git am",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  sequencer: "Git 序列操作",
};

export default function RepositoryStatusPanel({ path, onCommitted, onRequestMR, inlineWorkspace = false }: { path?: string; onCommitted(result: WorkspaceCommitResult): Promise<void>; onRequestMR(target: BranchSyncTarget): Promise<void>; inlineWorkspace?: boolean }) {
  const operation = useGitOperation();
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  // 很快完成的操作可能合并为一次 React 渲染，仍以完成事件触发状态重读。
  useEffect(() => window.branchNote?.subscribeGitOperation(value => {
    if (value === null) setRevision(current => current + 1);
  }), []);
  useEffect(() => {
    const api = window.branchNote;
    setStatus(null);
    setError("");
    setLoading(false);
    if (!path || !api || operation) return;
    let active = true;
    setLoading(true);
    void api.readRepositoryStatus(path).then(value => {
      if (active) setStatus(value);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "无法读取仓库状态");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, operation, revision]);

  return (
    <section className="repository-status-panel" aria-label="仓库状态" aria-busy={loading || operation !== null}>
      {!path ? (
        <p className="picker-note">尚未关联仓库，请在「编辑项目」中选择本地 Git 仓库。</p>
      ) : !window.branchNote ? (
        <p className="picker-note">请在桌面应用中查看本地仓库状态。</p>
      ) : operation ? (
        <p className="picker-note" role="status">正在{operation}，结束后自动读取最新状态。</p>
      ) : loading ? (
        <p className="picker-note" role="status">正在读取仓库状态…</p>
      ) : error ? (
        <div className="repository-status-error">
          <p className="form-error" role="alert">{error}</p>
          <div className="heading-actions">
            <button type="button" className="secondary icon-button" aria-label="重试读取本地仓库状态" title="重试" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} aria-hidden="true" /></button>
          </div>
        </div>
      ) : status && (
        <>
          <div className="repository-summary-bar">
            <div className="repository-summary-main">
              <span className="repository-current-branch">
              <GitBranch size={15} aria-hidden="true" />
              {status.head === "detached" ? "分离 HEAD" : status.branch}
              {status.head === "unborn" && "（尚无首次提交）"}
              </span>
              {status.commit && <span className="repository-commit-id"><code>{status.commit.slice(0, 8)}</code></span>}
              <span className={`repository-state-tag ${status.clean ? "clean" : status.conflicts ? "conflict" : "changed"}`}>{status.conflicts ? "存在冲突" : status.clean ? "干净" : "有改动"}</span>
            </div>
            <span className="repository-upstream">{status.upstream ? `${status.upstream} · ↑${status.ahead} ↓${status.behind}` : "未设置上游"}</span>
            <div className="heading-actions">
              {!inlineWorkspace && <button type="button" className="secondary" disabled={!path || !window.branchNote || operation !== null} onClick={() => setWorkspaceOpen(true)}>工作区</button>}
              {!inlineWorkspace && <button type="button" className="secondary" disabled={!path || !window.branchNote || operation !== null} onClick={() => setWorkflowOpen(true)}>分支与同步</button>}
              <button type="button" className="secondary icon-button" aria-busy={loading} aria-label={loading ? "正在读取本地仓库状态" : "重新读取本地仓库状态"} disabled={!path || !window.branchNote || loading || operation !== null} title="读取本地仓库状态" onClick={() => setRevision(value => value + 1)}>
                <RefreshCw size={14} aria-hidden="true" className={loading ? "spin" : ""} />
              </button>
            </div>
          </div>
          {status.head === "detached" && (
            <p className="warning-panel">当前提交未附着在本地分支上。请先在外部 Git 工具中切回或创建分支，再刷新状态。</p>
          )}
          {status.operations.length > 0 && (
            <p className="warning-panel" role="status">
              尚未完成：{status.operations.map(value => operationNames[value]).join("、")}。
              {status.operations.every(value => value === "merge")
                ? "若为本应用发起的 MR 冲突会话，可从原目标的提交入口继续处理；其他合并请在外部 Git 工具中完成或中止。"
                : "当前应用不接管此类会话，请在外部 Git 工具中完成或中止，再刷新状态。"}
            </p>
          )}
        </>
      )}
      {inlineWorkspace && path && window.branchNote && <WorkspacePanel embedded path={path} close={() => {}} onCommitted={onCommitted} onRequestMR={onRequestMR} />}
      {workspaceOpen && path && <WorkspacePanel path={path} close={() => setWorkspaceOpen(false)} onCommitted={onCommitted} onRequestMR={async target => { await onRequestMR(target); setWorkspaceOpen(false); }} />}
      {workflowOpen && path && <GitWorkflowPanel path={path} close={() => setWorkflowOpen(false)} onRequestMR={onRequestMR} />}
    </section>
  );
}
