import { useEffect, useRef, useState } from "react";
import { FolderOpen, GitBranch, GitMerge, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import { id, now, type Project, type Store } from "./model";
import type { MergePlan, MergeResult, Repository } from "./storage";

function resolveName() {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
  return `resolve/${parts.map((part) => String(part).padStart(2, "0")).join("")}`;
}

// 周四整理分支时的默认聚合分支名，按周编号；避开 Git 的 ref 前缀冲突
function suggestTarget(existing: string[]) {
  const date = new Date();
  const start = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((date.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7,
  );
  const suffix = String(week).padStart(2, "0");
  const clash = (name: string) =>
    existing.some(
      (item) => name.startsWith(`${item}/`) || item.startsWith(`${name}/`),
    );
  return (
    [`release/week-${suffix}`, `release-${suffix}`, `week-${suffix}`].find(
      (name) => !clash(name),
    ) || `week-${suffix}`
  );
}

const NEW_TARGET = "__new__";
export default function RepositoryDialog({
  project,
  store,
  commit,
  close,
  onProjectChange,
}: {
  project: Project;
  store: Store;
  commit(store: Store, message?: string): Promise<boolean>;
  close(): void;
  onProjectChange(id: string): void;
}) {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"import" | "merge">("merge");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [target, setTarget] = useState("");
  const [createTarget, setCreateTarget] = useState(false);
  const [newTarget, setNewTarget] = useState("");
  const [base, setBase] = useState("");
  const [resolveBranch, setResolveBranch] = useState(resolveName);
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const initialPath = useRef(project.repositoryPath).current;
  useEffect(() => {
    if (!initialPath || !window.branchNote) return;
    let active = true;
    setBusy(true);
    window.branchNote
      .readRepository(initialPath)
      .then((repo) => {
        if (active) setRepository(repo);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialPath]);
  // 只在本地分支里挑默认值：优先 main/master，其次上一个 release 分支
  const localNames = (repository?.branches || []).map((branch) => branch.name);
  const preferredTarget =
    ["main", "master"].find((name) => localNames.includes(name)) ||
    localNames.find((name) => /^release\//.test(name)) ||
    "";
  useEffect(() => {
    if (!repository || target || createTarget) return;
    if (preferredTarget) setTarget(preferredTarget);
    else setCreateTarget(true);
    if (!base) {
      setBase(
        preferredTarget ||
          repository.branches.find((branch) => branch.current)?.name ||
          "",
      );
    }
  }, [repository, preferredTarget, target, createTarget, base]);
  const recorded = new Set(
    store.branches
      .filter((branch) => branch.projectId === project.id && !branch.released)
      .map((branch) => branch.name),
  );
  const branches = repository?.branches || [];
  const destination = createTarget ? newTarget.trim() : target;
  const chosen = branches.filter(
    (branch) =>
      selected.includes(branch.name) &&
      (mode === "merge"
        ? branch.name !== destination
        : !recorded.has(branch.name)),
  );
  async function read(choose: boolean) {
    setBusy(true);
    setError("");
    try {
      const repo = choose
        ? await window.branchNote!.pickRepository()
        : await window.branchNote!.readRepository(repository!.path);
      if (repo) {
        setRepository(repo);
        setSelected([]);
        setDescriptions({});
        setPlan(null);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "读取仓库失败");
    } finally {
      setBusy(false);
    }
  }
  async function saveAssociation() {
    if (project.repositoryPath === repository!.path) return true;
    return commit(
      {
        ...store,
        projects: store.projects.map((p) =>
          p.id === project.id ? { ...p, repositoryPath: repository!.path } : p,
        ),
      },
      "已关联本地仓库",
    );
  }
  async function prepare(
    sources = chosen.map((branch) => branch.name),
    dest = destination,
    options: { create?: boolean; base?: string } = {
      create: createTarget,
      base,
    },
  ) {
    setBusy(true);
    setError("");
    try {
      if (!(await saveAssociation())) {
        setError("无法保存仓库关联，请检查本地存储后重试");
        return;
      }
      const preview = await window.branchNote!.prepareMerge(
        repository!.path,
        dest,
        sources,
        resolveBranch,
        options,
      );
      setPlan(preview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法准备合并");
    } finally {
      setBusy(false);
    }
  }
  // 合并成功后把参与的分支直接写进台账，省掉周四重复的手工录入
  async function recordMerged(names: string[]) {
    if (!names.length) return;
    const timestamp = now();
    const known = new Set(
      store.branches
        .filter((branch) => branch.projectId === project.id && !branch.released)
        .map((branch) => branch.name),
    );
    const additions = names
      .filter((name) => !known.has(name))
      .map((name) => {
        const info = branches.find((branch) => branch.name === name);
        return {
          id: id(),
          projectId: project.id,
          name,
          description: info?.subject?.trim() || "本地合并分支",
          note: info ? `本地合并，最近提交：${info.commit}` : "",
          tested: false,
          released: false,
          batchId: "",
          mergedAt: timestamp,
          releasedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      });
    await commit(
      {
        ...store,
        branches: [
          ...store.branches.map((branch) =>
            branch.projectId === project.id &&
            !branch.released &&
            names.includes(branch.name)
              ? { ...branch, mergedAt: branch.mergedAt || timestamp, updatedAt: timestamp }
              : branch,
          ),
          ...additions,
        ],
      },
      `已合入 ${names.length} 个本地分支`,
    );
  }
  async function importBranches() {
    if (
      chosen.some(
        (branch) => !(descriptions[branch.name] ?? branch.subject).trim(),
      )
    ) {
      setError("请填写每个选中分支的功能说明");
      return;
    }
    setBusy(true);
    const timestamp = now();
    const added = chosen.map((branch) => ({
      id: id(),
      projectId: project.id,
      name: branch.name,
      description: (descriptions[branch.name] ?? branch.subject).trim(),
      note: `从本地仓库读取，最近提交：${branch.commit}`,
      tested: false,
      released: false,
      batchId: "",
      mergedAt: null,
      releasedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const saved = await commit(
      {
        ...store,
        projects: store.projects.map((p) =>
          p.id === project.id ? { ...p, repositoryPath: repository!.path } : p,
        ),
        branches: [...store.branches, ...added],
      },
      `已导入 ${added.length} 个本地分支`,
    );
    setBusy(false);
    if (saved) close();
    else setError("保存失败，当前选择与输入已保留，请重试");
  }
  return (
    <Modal
      title="本地分支与合并"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <div className="repository-body" aria-busy={busy}>
        <div className="repository-top">
          <label>
            所属项目
            <Select
              label="所属项目"
              value={project.id}
              disabled={busy || !!plan || !!result}
              options={store.projects
                .filter((p) => !p.archived)
                .map((p) => ({ value: p.id, label: p.name }))}
              onChange={onProjectChange}
            />
          </label>
          <div className="repository-location">
            <span>本地仓库</span>
            <strong title={repository?.path || project.repositoryPath}>
              {repository?.path ||
                project.repositoryPath ||
                "选择仓库文件夹开始"}
            </strong>
          </div>
          <button
            className="secondary"
            disabled={!window.branchNote || busy || !!plan || !!result}
            onClick={() => read(true)}
          >
            <FolderOpen size={16} />
            选择文件夹
          </button>
          {repository && (
            <button
              className="icon-button bordered"
              title="重新读取本地分支"
              aria-label="刷新本地分支"
              disabled={busy || !!plan || !!result}
              onClick={() => read(false)}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>
        <p className="field-hint">
          只读取本地分支（refs/heads），不拉取远程分支、不联网；合并也只发生在本地。
        </p>
        {!window.branchNote && (
          <div className="warning-panel">
            浏览器预览无法访问本地 Git。请在 BranchNote 桌面应用中使用此功能。
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="repository-loading">
            {plan ? "正在执行 Git 合并，请勿关闭应用…" : "正在读取本地分支…"}
          </p>
        )}
        {plan ? (
          <div className="merge-preview">
            <h3>确认本次本地合并</h3>
            <p>
              {plan.create ? (
                <>
                  当前分支：<code>{plan.currentBranch}</code>。将从{" "}
                  <code>{plan.base}</code> 新建 <code>{plan.target}</code>
                  ，按以下顺序合并：
                </>
              ) : (
                <>
                  当前分支：<code>{plan.currentBranch}</code>。将切换到{" "}
                  <code>{plan.target}</code>，按以下顺序合并：
                </>
              )}
            </p>
            <ol>
              {plan.sources.map((source) => (
                <li key={source.name}>
                  <code>{source.name}</code>
                  <span>{source.head.slice(0, 8)}</span>
                </li>
              ))}
            </ol>
            <div className="warning-panel">
              遇到冲突时，中止发布分支上本次未完成的合并，创建{" "}
              <code>{plan.resolveBranch}</code>{" "}
              并在那里继续处理。此前已成功合入发布分支的提交会保留。功能分支不变，不推送、不部署。
            </div>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setPlan(null)}
              >
                返回调整
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const outcome = await window.branchNote!.executeMerge(
                      plan.id,
                    );
                    setResult(outcome);
                    setPlan(null);
                    await recordMerged(outcome.merged);
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : "合并失败",
                    );
                    setPlan(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <GitMerge size={16} />
                {busy ? "正在合并…" : "确认并执行合并"}
              </button>
            </div>
          </div>
        ) : result ? (
          <div className="merge-result">
            <h3>
              {result.status === "success"
                ? "合并完成"
                : result.status === "conflict"
                  ? "已停在冲突解决分支"
                  : "合并已停止"}
            </h3>
            <p>
              当前工作分支：<code>{result.workingBranch}</code>
            </p>
            <p>{result.message}</p>
            {result.merged.length > 0 && (
              <div>
                <h4>本次已成功合并</h4>
                <ul>
                  {result.merged.map((name) => (
                    <li key={name}>
                      <code>{name}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.conflicts.length > 0 && (
              <div className="warning-panel">
                <strong>需要解决的冲突文件</strong>
                <ul>
                  {result.conflicts.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.pending.length > 0 && (
              <p>待完成：{result.pending.join("、")}</p>
            )}
            <details>
              <summary>查看 Git 输出</summary>
              <pre>{result.logs.join("\n")}</pre>
            </details>
            <p className="field-hint">
              本次仅执行本地 Git 合并；发布批次中的状态仍需按实际目标确认。
            </p>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={close}>
                关闭
              </button>
              {result.status === "conflict" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => prepare(result.pending, result.workingBranch)}
                >
                  已解决并提交，继续核对剩余合并
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="repository-controls">
              <div className="tabs">
                <button
                  aria-pressed={mode === "merge"}
                  className={mode === "merge" ? "selected" : ""}
                  onClick={() => setMode("merge")}
                  disabled={busy}
                >
                  合并本地分支
                </button>
                <button
                  aria-pressed={mode === "import"}
                  className={mode === "import" ? "selected" : ""}
                  onClick={() => setMode("import")}
                  disabled={busy}
                >
                  同步分支记录
                </button>
              </div>
              <input
                className="repository-search"
                aria-label="搜索本地分支"
                placeholder="搜索本地分支…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {mode === "merge" && (
              <div className="merge-fields">
                <label>
                  合并到
                  <Select
                    label="合并到的分支"
                    value={createTarget ? NEW_TARGET : target}
                    disabled={busy}
                    onChange={(value) => {
                      if (value === NEW_TARGET) {
                        setCreateTarget(true);
                        setNewTarget((current) => current || suggestTarget(localNames));
                      } else {
                        setCreateTarget(false);
                        setTarget(value);
                      }
                    }}
                    options={[
                      { value: NEW_TARGET, label: "新建一个分支…" },
                      ...branches.map((branch) => ({
                        value: branch.name,
                        label: branch.name,
                      })),
                    ]}
                  />
                </label>
                {createTarget ? (
                  <>
                    <label>
                      新分支名称
                      <input
                        value={newTarget}
                        onChange={(event) => setNewTarget(event.target.value)}
                        disabled={busy}
                        aria-label="新分支名称"
                        placeholder="release/week-46"
                      />
                    </label>
                    <label>
                      起点分支
                      <Select
                        label="新分支的起点"
                        value={base}
                        disabled={busy}
                        onChange={setBase}
                        options={[
                          { value: "", label: "请选择起点分支" },
                          ...branches.map((branch) => ({
                            value: branch.name,
                            label: branch.name,
                          })),
                        ]}
                      />
                    </label>
                  </>
                ) : null}
                <label>
                  冲突解决分支
                  <input
                    value={resolveBranch}
                    onChange={(event) => setResolveBranch(event.target.value)}
                    disabled={busy}
                    aria-label="冲突解决分支"
                  />
                </label>
                <p>
                  {createTarget
                    ? "从起点分支新建一个分支，把勾选的分支依次合并进去；起点分支本身不变。"
                    : "把勾选的分支依次合并到所选本地分支，目标分支会前移。"}
                  出现冲突时在 resolve/**
                  中处理，功能分支保持不变；全程只在本地操作，不推送、不部署。
                </p>
              </div>
            )}
            <div className="repository-branches">
              {branches
                .filter((branch) =>
                  `${branch.name} ${branch.subject}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((branch) => {
                  const disabled =
                    busy ||
                    (mode === "import"
                      ? recorded.has(branch.name)
                      : branch.name === destination);
                  return (
                    <div className="repository-branch" key={branch.name}>
                      <input
                        type="checkbox"
                        aria-label={`选择本地分支 ${branch.name}`}
                        disabled={disabled}
                        checked={!disabled && selected.includes(branch.name)}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, branch.name]
                              : selected.filter((name) => name !== branch.name),
                          )
                        }
                      />
                      <div>
                        <div className="repository-branch-name">
                          <GitBranch size={16} />
                          <code>{branch.name}</code>
                          {branch.current && (
                            <span className="tag blue">当前分支</span>
                          )}
                          {recorded.has(branch.name) && (
                            <span className="tag">已记录</span>
                          )}
                        </div>
                        {mode === "import" ? (
                          <input
                            aria-label={`${branch.name} 的功能说明`}
                            value={descriptions[branch.name] ?? branch.subject}
                            disabled={disabled}
                            placeholder="填写功能说明"
                            onChange={(event) =>
                              setDescriptions({
                                ...descriptions,
                                [branch.name]: event.target.value,
                              })
                            }
                          />
                        ) : (
                          <p>{branch.subject || "无提交说明"}</p>
                        )}
                      </div>
                      <span className="repository-commit">{branch.commit}</span>
                    </div>
                  );
                })}
              {!branches.length && (
                <div className="repository-empty">
                  {repository
                    ? "该仓库没有本地分支。新仓库需要先创建一次提交。"
                    : "选择本地 Git 仓库文件夹，即可读取本地分支。"}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <span className="field-hint">
                已选择 {chosen.length} 个分支
                {mode === "import"
                  ? "，同步后需确认发布状态"
                  : createTarget
                    ? `，将新建 ${newTarget.trim() || "目标分支"} 并合并`
                    : "，只在本地合并，不推送"}
              </span>
              <span className="spacer" />
              <button className="secondary" disabled={busy} onClick={close}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !chosen.length ||
                  (mode === "merge" &&
                    (createTarget ? !newTarget.trim() || !base : !target))
                }
                onClick={() =>
                  mode === "import" ? importBranches() : prepare()
                }
              >
                {mode === "import" ? "同步所选分支" : "预览合并清单"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
