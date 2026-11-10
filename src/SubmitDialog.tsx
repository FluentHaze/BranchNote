import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, GitPullRequest, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import ConflictResolver from "./ConflictResolver";
import HostsPanel from "./HostsPanel";
import { rememberedTarget, projectTargets, targetState, withStageState, withTarget, type Project, type Stage, type Store } from "./model";
import type { MergeResult, MergeSession, Repository, PreflightResult } from "./storage";

const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
interface Submission {
  source: string;
  target: string;
  remote: string;
  names: string[];
  stage: Stage;
  checkedSource?: {ref: string; head: string};
  title?: string;
}
export default function SubmitDialog({ project, branchIds, initialStage, store, commit, copy, close, openSettings }: {
  project: Project;
  branchIds: string[];
  initialStage?: Stage;
  store: Store;
  commit(next: Store, text?: string): Promise<boolean>;
  copy(text: string): Promise<void>;
  close(): void;
  openSettings?(): void;
}) {
  const destinations = projectTargets(project);
  const initial = initialStage ?? destinations[0]?.id ?? "";
  const stageName = (key: Stage) => destinations.find(item => item.id === key)?.name || key;
  const [repository, setRepository] = useState<Repository | null>(null);
  const [stage, setStage] = useState<Stage>(initial);
  const [target, setTarget] = useState(rememberedTarget(project, initial));
  const [title, setTitle] = useState("");
  const titleEdited = useRef(false);
  const [description, setDescription] = useState("");
  const [resolveName, setResolveName] = useState("resolve");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState<MergeResult | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [mr, setMR] = useState<{ url: string; number: string } | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [session, setSession] = useState<MergeSession | null>(null);
  const [round, setRound] = useState(0);
  const [preflight, setPreflight] = useState<{id: string; result: PreflightResult; plan: Submission} | null>(null);
  const ledger = useRef(store);
  const path = project.repositoryPath || "";
  const selection = store.branches.filter(b => branchIds.includes(b.id));
  const options = [...new Set((repository?.branches || []).flatMap(b => b.remoteRefs?.length ? b.remoteRefs : b.remoteRef ? [b.remoteRef] : []))]
    .map(value => ({ value, label: value }));

  useEffect(() => {
    let active = true;
    if (!path || !window.branchNote) return;
    setBusy(true);
    Promise.all([window.branchNote.readRepository(path), window.branchNote.mergeState(path)])
      .then(([repo, state]) => {
        if (!active) return;
        setRepository(repo);
        const selected = store.branches.filter(branch => branchIds.includes(branch.id));
        const last = selected.at(-1);
        setTitle(repo.branches.find(branch => branch.name === last?.name)?.subject?.trim() || last?.name || "");
        if (state.session) {
          setSession(state.session);
          setStage(state.session.stage);
          setTarget(state.session.mrTarget || "");
          if (!state.session.mrTarget) {
            setError("发现旧版直接合并会话。请先放弃旧会话，再重新提交 MR。");
            return;
          }
          setSubmission({
            source: state.session.targetLocal,
            target: state.session.mrTarget,
            remote: repo.remotes.find(r => state.session!.mrTarget!.startsWith(r + "/")) || "",
            names: state.session.sources || [...state.session.merged, ...state.session.pending].filter(name => name !== state.session!.mrTarget),
            stage: state.session.stage,
          });
          setOutcome({
            status: "conflict", workingBranch: state.session.branch,
            target: state.session.target, targetMode: state.session.targetMode,
            targetLocal: state.session.targetLocal, remoteRef: state.session.remoteRef,
            merged: state.session.merged, pending: state.session.pending,
            conflicts: state.unmerged, fastForwarded: false, message: "", logs: [],
          });
        }
      })
      .catch(reason => { if (active) setError(message(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path]);

  async function publish(plan: Submission) {
    const api = window.branchNote!;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setStep("正在推送 MR 源分支…");
      await api.pushBranch(path, plan.source, plan.remote, plan.checkedSource);
      const shortTarget = plan.target.slice(plan.remote.length + 1);
      setPageUrl(await api.mergeRequestUrl(path, plan.source, shortTarget, plan.remote));
      setStep("正在创建合并请求…");
      const names = plan.names.map(name => {
        const remote = repository?.remotes.find(r => name.startsWith(r + "/"));
        return remote ? name.slice(remote.length + 1) : name;
      });
      const result = await api.createMergeRequest(path, plan.source, shortTarget,
        plan.title || title.trim() || names.at(-1) || plan.source,
        description.trim(),
        plan.remote);
      if ((result.status !== "created" && result.status !== "exists") || !result.url) {
        setNotice(result.message || "尚未创建 MR，可打开创建页手动提交，然后重试以关联记录。");
        return;
      }
      setMR({ url: result.url, number: result.number || "" });
      const current = ledger.current;
      const next: Store = {
        ...current,
        projects: current.projects.map(p => p.id === project.id ? withTarget(p, plan.stage, plan.target) : p),
        branches: current.branches.map(branch =>
          branch.projectId === project.id && names.includes(branch.name) ? {
            ...withStageState(branch, plan.stage, {
              ...targetState(branch, plan.stage),
              mergedAt: null,
              target: plan.target,
              mr: {
                url: result.url!, number: result.number || "", source: plan.source,
                target: plan.target, submittedAt: new Date().toISOString(),
              },
            }),
            updatedAt: new Date().toISOString(),
          } : branch),

      };
      if (await commit(next, "MR 已提交，等待在平台合并")) ledger.current = next;
      else setError("MR 已创建，但本地记录保存失败。请重试关联 MR。");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function finish(result: MergeResult, plan: Submission) {
    if (result.status !== "success") { setOutcome(result); return; }
    if (result.workingBranch !== plan.source) {
      setStep("正在整理冲突解决结果…");
      await window.branchNote!.finalizeMerge(path, plan.source, result.workingBranch);
    }
    setOutcome(result);
    setSession(null);
    await publish(plan);
  }

  async function start(checkOnly = false) {
    const api = window.branchNote;
    if (!api || !repository) return;
    const remote = repository.remotes.find(r => target.startsWith(r + "/"));
    if (!remote || !options.some(o => o.value === target)) {
      setError("请选择仓库中已有的远程目标分支。MR 需要一个已存在的目标。");
      return;
    }
    if (!selection.length) { setError("请先选择功能分支"); return; }
    const sources: string[] = [];
    for (const branch of selection) {
      const info = repository.branches.find(b => b.name === branch.name);
      if (!info) { setError("找不到分支 " + branch.name + "，请重新选择"); return; }
      if (branch.name === target.slice(remote.length + 1)) {
        setError("功能分支不能与 MR 目标分支相同"); return;
      }
      sources.push(info.local && !(info.behind > 0 && !info.ahead) ? info.name : info.remoteRef!);
    }
    const source = "mr/" + stage + "-" + Date.now();
    const plan: Submission = { source, target, remote, names: sources, stage };
    setPreflight(null);
    setBusy(true);
    setError("");
    setNotice("");
    setStep("正在隔离环境中检查冲突…");
    try {
      const merge = await api.prepareMerge(path, source, sources, resolveName.trim() || "resolve", {
        create: true, base: target, stage, mrTarget: target,
      });
      const fallback = selection.at(-1)?.name || source;
      plan.title = titleEdited.current ? title.trim() || fallback : merge.sources?.at(-1)?.subject?.trim() || title.trim() || fallback;
      if (!titleEdited.current) setTitle(plan.title);
      const checked = await api.checkMerge(merge.id);
      setPreflight({id: merge.id, result: checked, plan});
      if (checked.status === "conflict") return;
      if (checkOnly) {
        setNotice("检查完成，未发现合并冲突。当前工作区和功能分支未修改；提交时会再次检查。");
        return;
      }
      setStep("未发现冲突，正在汇总并提交 MR…");
      const result = await api.executeMerge(merge.id);
      const actual = {...plan, source: result.targetLocal, checkedSource: result.sourceRef && result.sourceHead ? {ref: result.sourceRef, head: result.sourceHead} : undefined};
      setSubmission(actual);
      await finish(result, actual);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function confirmConflict() {
    if (!preflight || !window.branchNote) return;
    setBusy(true);
    setError("");
    setStep("正在创建 resolve 分支并合并…");
    try {
      const result = await window.branchNote.executeMerge(preflight.id, true);
      const plan = {...preflight.plan, source: result.targetLocal};
      setSubmission(plan);
      setPreflight(null);
      await finish(result, plan);
    } catch (reason) {
      setError(message(reason));
      setPreflight(null);
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  async function afterResolve() {
    if (!outcome || !submission || !window.branchNote) return;
    setBusy(true);
    setError("");
    try {
      // 会话 pending 包含刚解决的分支，重新合并会返回 already up to date 并正确记入结果。
      const state = await window.branchNote.mergeState(path);
      const merged = state.session?.merged || outcome.merged;
      const pending = state.session?.pending || [];
      if (pending.length) {
        const continued = await window.branchNote.continueMerge(path, outcome.workingBranch, pending);
        await finish({ ...outcome, ...continued, merged: [...merged, ...continued.merged] }, submission);
        setRound(r => r + 1);
      } else {
        await finish({ ...outcome, status: "success", merged, pending: [], conflicts: [] }, submission);
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  const conflict = outcome?.status === "conflict";
  return (
    <Modal title={conflict ? "解决冲突后提交 MR" : mr ? "MR 已提交" : "提交" + stageName(stage) + " MR"} close={() => { if (!busy) close(); }} wide={!!conflict}>
      <div className="repository-body submit-dialog-body" aria-busy={busy}>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="warning-panel" role="status">{notice}</p>}
        {step && <p className="repository-loading" role="status">{step}</p>}
        {!window.branchNote && <p className="warning-panel">请在桌面应用中关联 Git 仓库并提交 MR。</p>}
        {!mr && (
          <details className="submit-credentials">
            <summary>账号与令牌 · 配置 GitLab / GitHub</summary>
            <p className="credential-explanation">
              自动创建 MR 使用访问令牌；推送代码使用本机 Git 已配置的 SSH 或 HTTPS 登录。
              没有令牌时可在平台登录后手动创建 MR。
            </p>
            <HostsPanel notify={setNotice} />
          </details>
        )}
        {preflight?.result.status === "conflict" ? (
          <div className="preflight-conflict">
            <h3>发现冲突，尚未修改当前仓库</h3>
            <p>合入 <code>{preflight.result.branch}</code> 时发现冲突。
              {preflight.result.pending.length > 1 && " 后续分支将在解决本轮冲突后继续检查与合并。"}
            </p>
            <ul>{preflight.result.files.map(file => <li key={file}><code>{file}</code></li>)}</ul>
            <p>确认后创建 <code>{preflight.result.resolveBranch}</code>，在该分支解决冲突并提交 MR。
              功能分支和目标分支保持不变。</p>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={() => { setPreflight(null); setNotice("已取消，当前仓库没有发生变更"); }}>
                取消此次提交
              </button>
              <button className="primary" disabled={busy} onClick={() => void confirmConflict()}>
                确认，创建 resolve 分支继续
              </button>
            </div>
          </div>
        ) : conflict && outcome ? (
          <>
            <p className="resolve-summary">
              冲突在临时分支 <code>{outcome.workingBranch}</code> 上解决。完成后继续汇总并创建 MR。
            </p>
            <ConflictResolver key={round} path={path} branch={outcome.workingBranch} conflicts={outcome.conflicts}
              busy={busy} setBusy={setBusy} onResolved={afterResolve}
              onAborted={() => { setOutcome(null); setSubmission(null); setSession(null); setNotice("已放弃，本次没有提交 MR"); }} />
          </>
        ) : outcome?.status === "success" && submission ? (
          <div className="merge-result">
            <div className="mr-result-icon"><GitPullRequest size={28} /></div>
            <h3>{mr ? "等待在平台审核、合并" : "功能分支已汇总，继续提交 MR"}</h3>
            <p>源分支：<code>{submission.source}</code></p>
            <p>目标分支：<code>{submission.target}</code></p>
            <p className="picker-note">共 {submission.names.length} 个功能分支。目标分支保持原状，只有平台合并 MR 后才会更新。</p>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>关闭</button>
              {mr && <button className="secondary" disabled={busy} onClick={() => void copy(mr.url)}>
                <Copy size={15} />复制 MR 地址
              </button>}
              {mr && <button className="primary" disabled={busy} onClick={() => void window.branchNote?.openUrl(mr.url)}>
                <ExternalLink size={15} />打开 MR {mr.number && "#" + mr.number}
              </button>}
              {!mr && pageUrl && <button className="secondary" disabled={busy} onClick={() => void window.branchNote?.openUrl(pageUrl)}>打开 MR 创建页</button>}
              {!mr && openSettings && <button className="secondary" disabled={busy} onClick={openSettings}>配置令牌</button>}
              {(!mr || error) && (
                <button className="secondary" disabled={busy} onClick={() => void publish(submission)}>
                  <RefreshCw size={15} />
                  {mr ? "重新关联记录" : "重试提交 MR"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <p className="submit-summary">已选择 {selection.length} 个功能分支。{selection.length === 1 ? "无冲突时直接以该功能分支提交 MR。" : "先整合为一个分支，再提交一条 MR。"}</p>
            <div className="submit-branches" aria-label="本次提交的功能分支">
              {selection.map(branch => (
                <div className="submit-branch" key={branch.id}>
                  <span>{branch.description || branch.name}</span>
                  <code>{branch.name}</code>
                </div>
              ))}
            </div>
            <div className="stage-toggle" role="group" aria-label="提交阶段">
              {destinations.map(destination => (
                <button key={destination.id} className={stage === destination.id ? "selected" : ""} disabled={busy} onClick={() => {
                  setStage(destination.id); setTarget(destination.branch); setPreflight(null); setNotice("");
                }}>{destination.name + " MR"}</button>
              ))}
            </div>
            <label className="host-field">
              <span>MR 目标分支</span>
              <Select searchable label="MR 目标分支" value={target} options={options} disabled={busy} onChange={value => { setTarget(value); setPreflight(null); setNotice(""); }} />
            </label>
            <label className="host-field">
              <span>MR 标题</span>
              <input aria-label="MR 标题" value={title} disabled={busy} onChange={event => { titleEdited.current = true; setTitle(event.target.value); }} placeholder="填写 MR 标题" />
            </label>
            <details className="submit-options">
              <summary>更多选项 · 描述与冲突处理</summary>
              <div className="submit-options-fields">
            <label className="host-field">
              <span className="form-label-inline">MR 描述 <span className="optional">选填</span></span>
              <textarea aria-label="MR 描述" value={description} rows={2} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="可留空" />
            </label>
            <label className="host-field">
              <span>冲突处理分支</span>
              <input aria-label="冲突处理分支" value={resolveName} disabled={busy} onChange={event => { setResolveName(event.target.value); setPreflight(null); }} placeholder="resolve" />
              <small>默认 resolve 自动生成 resolve/时间戳；也可填写完整的新分支名。</small>
            </label>
              </div>
            </details>
            <p className="picker-note submit-check-hint">提交时自动检查冲突，发现冲突后需你确认。</p>
            {outcome?.status === "failed" && <p className="form-error">{outcome.message}</p>}
            {session && !session.mrTarget && <button className="secondary" disabled={busy} onClick={async () => {
              try { await window.branchNote!.abortConflict(path, ""); setSession(null); setError(""); }
              catch (reason) { setError(message(reason)); }
            }}>放弃旧版合并会话</button>}
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>取消</button>
              <button className="secondary" disabled={busy || !repository || !target || !!session} onClick={() => void start(true)}>
                检查冲突
              </button>
              <button className="primary" disabled={busy || !repository || !target || !!session} onClick={() => void start()}>
                <GitPullRequest size={16} />{busy ? "正在提交…" : "提交 MR"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
