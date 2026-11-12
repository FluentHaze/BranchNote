import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, GitBranch, GitPullRequest, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import ConflictResolver from "./ConflictResolver";
import HostsPanel from "./HostsPanel";
import { rememberedTarget, projectTargets, targetState, withStageState, withTarget, type Project, type Stage, type Store } from "./model";
import type { MergeResult, MergeSession, Repository, PreflightResult, MRMetadata, MROptions } from "./storage";

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
  const [removeSourceBranch, setRemoveSourceBranch] = useState(false);
  const [optionsRequested, setOptionsRequested] = useState(false);
  const [metadata, setMetadata] = useState<MRMetadata>({});
  const [mrOptions, setMROptions] = useState<MROptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [provider, setProvider] = useState<"gitlab" | "github" | "other">("other");
  const requestKind = provider === "github" ? "PR" : provider === "gitlab" ? "MR" : "合并请求";
  const [configurationWarning, setConfigurationWarning] = useState("");
  const [mergeName, setMergeName] = useState(() => "mr/" + Date.now());
  const [resolveName, setResolveName] = useState(() => "resolve/" + Date.now());
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
  const metadataRemote = repository?.remotes.find(remote => target.startsWith(remote + "/")) || "";

  useEffect(() => { setMetadata({}); setMROptions(null); }, [path, metadataRemote]);
  useEffect(() => {
    setProvider("other");
    if (!metadataRemote || !window.branchNote) return;
    let active = true;
    window.branchNote.requestProvider(path, metadataRemote)
      .then(result => { if (active) setProvider(result); })
      .catch(reason => { if (active) setError(message(reason)); });
    return () => { active = false; };
  }, [path, metadataRemote]);
  useEffect(() => {
    if (!optionsRequested || !metadataRemote || !window.branchNote) return;
    let active = true;
    setOptionsLoading(true);
    setOptionsError("");
    window.branchNote.mergeRequestOptions(path, metadataRemote)
      .then(result => { if (active) setMROptions(result); })
      .catch(reason => { if (active) setOptionsError(message(reason)); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [optionsRequested, path, metadataRemote, optionsRetry]);

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
            setError("发现旧版直接合并会话。请先放弃旧会话，再重新提交合并请求。");
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
      setStep(`正在推送 ${requestKind} 源分支…`);
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
        plan.remote, removeSourceBranch, metadata);
      if ((result.status !== "created" && result.status !== "exists") || !result.url) {
        setNotice(result.message || `尚未创建 ${requestKind}，可打开创建页手动提交，然后重试以关联记录。`);
        return;
      }
      setMR({ url: result.url, number: result.number || "" });
      setConfigurationWarning(result.configurationWarning || "");
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
      if (await commit(next, `${requestKind} 已提交，等待在平台合并`)) ledger.current = next;
      else setError(`${requestKind} 已创建，但本地记录保存失败。请重试关联记录。`);
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
      setError(`请选择仓库中已有的远程目标分支。${requestKind} 需要一个已存在的目标。`);
      return;
    }
    if (!selection.length) { setError("请先选择功能分支"); return; }
    const sources: string[] = [];
    for (const branch of selection) {
      const info = repository.branches.find(b => b.name === branch.name);
      if (!info) { setError("找不到分支 " + branch.name + "，请重新选择"); return; }
      if (branch.name === target.slice(remote.length + 1)) {
        setError(`功能分支不能与 ${requestKind} 目标分支相同`); return;
      }
      sources.push(info.local && !(info.behind > 0 && !info.ahead) ? info.name : info.remoteRef!);
    }
    const source = mergeName.trim() || "mr/" + Date.now();
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
      setStep(`未发现冲突，正在汇总并提交 ${requestKind}…`);
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
  const showForm = preflight?.result.status !== "conflict" && !conflict && outcome?.status !== "success";
  const footer = showForm ? (
    <div className="modal-actions">
      <button className="secondary" disabled={busy} onClick={close}>取消</button>
      <button className="secondary" disabled={busy || !repository || !target || !!session} onClick={() => void start(true)}>
        检查冲突
      </button>
      <button className="primary" title="提交时自动检查冲突，发现冲突后需你确认" disabled={busy || !repository || !target || !!session} onClick={() => void start()}>
        <GitPullRequest size={16} />
        {busy ? "正在提交…" : `提交 ${requestKind}`}
      </button>
    </div>
  ) : undefined;
  return (
    <Modal title={conflict ? `解决冲突后提交 ${requestKind}` : mr ? `${requestKind} 已提交` : `提交${stageName(stage)} ${requestKind}`} close={() => { if (!busy) close(); }} wide footer={footer}>
      <div className="repository-body submit-dialog-body" aria-busy={busy}>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="warning-panel" role="status">{notice}</p>}
        {configurationWarning && <p className="warning-panel" role="status">{configurationWarning}</p>}
        {step && <p className="repository-loading" role="status">{step}</p>}
        {!window.branchNote && <p className="warning-panel">请在桌面应用中关联 Git 仓库并提交合并请求。</p>}
        {!mr && (
          <details className="submit-credentials">
            <summary>账号与令牌 · 配置 GitLab / GitHub</summary>
            <p className="credential-explanation">
              自动创建 {requestKind} 使用访问令牌；推送代码使用本机 Git 已配置的 SSH 或 HTTPS 登录。
              没有令牌时可在平台登录后手动创建 {requestKind}。
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
            <p>确认后创建 <code>{preflight.result.resolveBranch}</code>，在该分支解决冲突并提交 {requestKind}。
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
              冲突在临时分支 <code>{outcome.workingBranch}</code> 上解决。完成后继续汇总并创建 {requestKind}。
            </p>
            <ConflictResolver key={round} path={path} branch={outcome.workingBranch} conflicts={outcome.conflicts}
              busy={busy} setBusy={setBusy} onResolved={afterResolve}
              onAborted={() => { setOutcome(null); setSubmission(null); setSession(null); setNotice(`已放弃，本次没有提交 ${requestKind}`); }} />
          </>
        ) : outcome?.status === "success" && submission ? (
          <div className="merge-result">
            <div className="mr-result-icon"><GitPullRequest size={28} /></div>
            <h3>{mr ? "等待在平台审核、合并" : `功能分支已汇总，继续提交 ${requestKind}`}</h3>
            <p>源分支：<code>{submission.source}</code></p>
            <p>目标分支：<code>{submission.target}</code></p>
            <p className="picker-note">共 {submission.names.length} 个功能分支。目标分支保持原状，只有平台合并 {requestKind} 后才会更新。</p>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>关闭</button>
              {mr && <button className="secondary" disabled={busy} onClick={() => void copy(mr.url)}>
                <Copy size={15} />复制 {requestKind} 地址
              </button>}
              {mr && <button className="primary" disabled={busy} onClick={() => void window.branchNote?.openUrl(mr.url)}>
                <ExternalLink size={15} />打开 {requestKind} {mr.number && "#" + mr.number}
              </button>}
              {!mr && pageUrl && <button className="secondary" disabled={busy} onClick={() => void window.branchNote?.openUrl(pageUrl)}>打开 {requestKind} 创建页</button>}
              {!mr && openSettings && <button className="secondary" disabled={busy} onClick={openSettings}>配置令牌</button>}
              {(!mr || error || configurationWarning) && (
                <button className="secondary" disabled={busy} onClick={() => void publish(submission)}>
                  <RefreshCw size={15} />
                  {configurationWarning ? "重试保存配置" : mr ? "重新关联记录" : `重试提交 ${requestKind}`}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <details className="submit-selection">
              <summary>已选择 {selection.length} 个功能分支 · 展开查看</summary>
            <div className="submit-branches" aria-label="本次提交的功能分支">
              {selection.map(branch => (
                <div className="submit-branch" key={branch.id}>
                  <code>{branch.name}</code>
                  {branch.description && <span>{branch.description}</span>}
                </div>
              ))}
            </div>
            </details>
            <section className="submit-form-section" aria-label="分支配置">
              <div className="stage-toggle" role="group" aria-label="提交阶段">
                {destinations.map(destination => (
                  <button key={destination.id} className={stage === destination.id ? "selected" : ""} disabled={busy} onClick={() => {
                    setStage(destination.id); setTarget(destination.branch); setPreflight(null); setNotice("");
                  }}>{destination.name + " " + requestKind}</button>
                ))}
              </div>
              <div className="submit-destination" aria-label={`${requestKind} 目标分支`}>
                <span>合入目标</span>
                <GitBranch size={15} aria-hidden="true" />
                <code>{target || "请先在项目中配置该阶段的目标分支"}</code>
              </div>
              <div className="submit-branch-config">
              {selection.length > 1 && (
                <label className="host-field">
                  <span>无冲突合并分支</span>
                  <input aria-label="无冲突合并分支" value={mergeName} disabled={busy}
                    onChange={event => { setMergeName(event.target.value); setPreflight(null); }} placeholder="mr/时间戳" />
                </label>
              )}
              <label className="host-field">
                <span>冲突处理分支</span>
                <input aria-label="冲突处理分支" value={resolveName} disabled={busy}
                  onChange={event => { setResolveName(event.target.value); setPreflight(null); }} placeholder="resolve/时间戳" />
              </label>
              </div>
            </section>
            <section className="submit-form-section submit-content-fields" aria-label="标题与描述">
              <label className="host-field">
                <span>{requestKind} 标题</span>
                <input aria-label={`${requestKind} 标题`} value={title} disabled={busy} onChange={event => { titleEdited.current = true; setTitle(event.target.value); }} placeholder={`填写 ${requestKind} 标题`} />
              </label>
              <label className="host-field">
                <span>{requestKind} 描述（选填）</span>
                <textarea aria-label={`${requestKind} 描述`} value={description} rows={2} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="可留空" />
              </label>
            </section>
            {provider === "gitlab" && <div className="submit-delete-option">
              <label>
                <input type="checkbox" checked={removeSourceBranch} disabled={busy}
                  onChange={event => setRemoveSourceBranch(event.target.checked)} />
                <span>MR 合并后删除远程源分支（GitLab）</span>
              </label>
              <small>{selection.length > 1 ? "仅删除本次汇总或冲突处理分支，保留原功能分支。" : "无冲突时源分支为所选功能分支，请按需勾选。"}</small>
            </div>}
            {provider === "github" && <p className="picker-note submit-check-hint">PR 合并后是否自动删除源分支由 GitHub 仓库设置决定。{mrOptions?.provider === "github" && (mrOptions.deleteBranchOnMerge ? "当前已开启。" : "当前未开启。")}</p>}
            <details className="submit-options" onToggle={event => { if (event.currentTarget.open) setOptionsRequested(true); }}>
              <summary>更多 {requestKind} 配置 · 指派人、审核者、里程碑与标签</summary>
              <div className="submit-options-fields">
                {optionsLoading ? <p role="status">正在读取项目配置…</p> : optionsError ? (
                  <div>
                    <p className="form-error" role="alert">{optionsError}</p>
                    <button className="secondary" disabled={busy} onClick={() => setOptionsRetry(value => value + 1)}>重新加载</button>
                  </div>
                ) : mrOptions && (
                  <>
                    <div className="submit-branch-config">
                      <label className="host-field">
                        <span>指派人</span>
                        <Select searchable label="指派人" searchPlaceholder="搜索指派人姓名或账号…" value={String(metadata.assigneeId || "")} disabled={busy}
                          options={[{value: "", label: "未分配"}, ...mrOptions.members.map(item => ({value: String(item.id), label: item.name}))]}
                          onChange={value => setMetadata(current => ({...current, assigneeId: value ? Number(value) : undefined, assigneeLogin: mrOptions.members.find(item => String(item.id) === value)?.login}))} />
                      </label>
                      <label className="host-field">
                        <span>审核者</span>
                        <Select searchable label="审核者" searchPlaceholder="搜索审核者姓名或账号…" value={String(metadata.reviewerId || "")} disabled={busy}
                          options={[{value: "", label: "未分配"}, ...(mrOptions.reviewers || mrOptions.members).map(item => ({value: String(item.id), label: item.name}))]}
                          onChange={value => setMetadata(current => ({...current, reviewerId: value ? Number(value) : undefined, reviewerLogin: (mrOptions.reviewers || mrOptions.members).find(item => String(item.id) === value)?.login}))} />
                      </label>
                    </div>
                    <button className="secondary submit-assign-me" disabled={busy || !mrOptions.members.some(item => item.id === mrOptions.currentUser.id)}
                      onClick={() => setMetadata(current => ({...current, assigneeId: mrOptions.currentUser.id, assigneeLogin: mrOptions.currentUser.login}))}>分配给我</button>
                    <label className="host-field">
                      <span>里程碑</span>
                      <Select searchable label="里程碑" searchPlaceholder="搜索里程碑名称…" value={String(metadata.milestoneId || "")} disabled={busy}
                        options={[{value: "", label: mrOptions.milestones.length ? "不设置" : "暂无可用里程碑"}, ...mrOptions.milestones.map(item => ({value: String(item.id), label: item.name}))]}
                        onChange={value => setMetadata(current => ({...current, milestoneId: value ? Number(value) : undefined}))} />
                    </label>
                    <fieldset className="submit-labels" disabled={busy}>
                      <legend>标签（可多选）</legend>
                      {!mrOptions.labels.length && <p>暂无可用标签</p>}
                      {mrOptions.labels.map(item => (
                        <label key={item.id}>
                          <input type="checkbox" checked={metadata.labels?.includes(item.name) || false}
                            onChange={event => setMetadata(current => ({...current, labels: event.target.checked ? [...(current.labels || []), item.name] : current.labels?.filter(name => name !== item.name)}))} />
                          <span>{item.name}</span>
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
              </div>
            </details>
            {outcome?.status === "failed" && <p className="form-error">{outcome.message}</p>}
            {session && !session.mrTarget && <button className="secondary" disabled={busy} onClick={async () => {
              try { await window.branchNote!.abortConflict(path, ""); setSession(null); setError(""); }
              catch (reason) { setError(message(reason)); }
            }}>放弃旧版合并会话</button>}
          </>
        )}
      </div>
    </Modal>
  );
}
