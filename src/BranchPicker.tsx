import { useEffect, useState } from "react";
import {
  Cloud,
  FolderOpen,
  GitBranch,
  RefreshCw,
  UserRound,
} from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import { id, now, type Project, type Store } from "./model";
import type { Repository } from "./storage";

type Filter = "all" | "local" | "remote" | "new";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

export default function BranchPicker({
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
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const path = project.repositoryPath || "";

  useEffect(() => {
    let active = true;
    setRepository(null);
    setSelected([]);
    setError("");
    setNotice("");
    if (!path || !window.branchNote) return;
    setBusy(true);
    window.branchNote
      .readRepository(path)
      .then((repo) => {
        if (active) setRepository(repo);
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, project.id]);

  const recorded = new Set(
    store.branches
      .filter((branch) => branch.projectId === project.id)
      .map((branch) => branch.name),
  );
  const branches = repository?.branches || [];
  const visible = branches.filter((branch) => {
    if (
      !`${branch.name} ${branch.subject}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
      return false;
    if (filter === "local") return branch.local;
    if (filter === "remote") return !!branch.remoteRef;
    if (filter === "new") return !recorded.has(branch.name);
    return true;
  });
  const counts = {
    all: branches.length,
    local: branches.filter((branch) => branch.local).length,
    remote: branches.filter((branch) => branch.remoteRef).length,
    new: branches.filter((branch) => !recorded.has(branch.name)).length,
  };
  const chosen = branches.filter(
    (branch) => selected.includes(branch.name) && !recorded.has(branch.name),
  );

  async function choose() {
    if (!window.branchNote) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const repo = await window.branchNote.pickRepository();
      if (!repo) return;
      setRepository(repo);
      setSelected([]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!window.branchNote || !repository) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.branchNote.fetchRepository(repository.path);
      setRepository(result.repository);
      setSelected((current) =>
        current.filter((name) =>
          result.repository.branches.some((branch) => branch.name === name),
        ),
      );
      const changes = [
        result.updated.length ? `${result.updated.length} 个分支有新提交` : "",
        result.added.length ? `新增 ${result.added.length} 个` : "",
        result.removed.length ? `清理 ${result.removed.length} 个` : "",
      ].filter(Boolean);
      setNotice(
        `${changes.length ? `更新完成：${changes.join("，")}` : "更新完成，远程分支没有变化"}${
          result.errors.length ? `；部分远程更新失败：${result.errors.join("；")}` : ""
        }`,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    if (!repository || !chosen.length) {
      setError("请选择要添加的分支");
      return;
    }
    setBusy(true);
    setError("");
    const timestamp = now();
    const saved = await commit(
      {
        ...store,
        projects: store.projects.map((item) =>
          item.id === project.id
            ? { ...item, repositoryPath: repository.path }
            : item,
        ),
        branches: [
          ...store.branches,
          ...chosen.map((branch) => ({
            id: id(),
            projectId: project.id,
            name: branch.name,
            description:
              branch.subject.trim() ||
              (branch.local ? "本地功能分支" : "远程功能分支"),
            note: `${branch.remoteRef ? `来自 ${branch.remoteRef}` : "来自本地分支"}，最近提交 ${branch.commit}`,
            testMergedAt: null,
            releaseMergedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        ],
      },
      `已添加 ${chosen.length} 个功能分支`,
    );
    setBusy(false);
    if (saved) close();
    else setError("保存失败，当前选择与输入已保留，请重试");
  }

  return (
    <Modal
      title="从仓库添加功能分支"
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
              disabled={busy}
              options={store.projects
                .filter((item) => !item.archived)
                .map((item) => ({ value: item.id, label: item.name }))}
              onChange={onProjectChange}
            />
          </label>
          <div className="repository-location">
            <span>本地仓库</span>
            <strong title={repository?.path || path}>
              {repository?.path || path || "先选择仓库文件夹"}
            </strong>
          </div>
          <button
            className="secondary"
            disabled={!window.branchNote || busy}
            onClick={choose}
          >
            <FolderOpen size={16} />
            选择文件夹
          </button>
          {repository && (
            <button
              className="secondary"
              disabled={busy}
              onClick={refresh}
              title="执行 git fetch --prune，拉取所有远程分支的最新状态"
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
              更新分支
            </button>
          )}
        </div>
        {repository && (
          <div className="repository-meta">
            <div className="repository-meta-item">
              <Cloud size={14} />
              <span className="repository-meta-key">远程</span>
              {Object.keys(repository.remoteUrls || {}).length ? (
                Object.entries(repository.remoteUrls || {}).map(([name, url]) => (
                  <code key={name} title={url}>
                    {name} · {url}
                  </code>
                ))
              ) : (
                <em>未配置远程仓库</em>
              )}
            </div>
            <div className="repository-meta-item">
              <UserRound size={14} />
              <span className="repository-meta-key">提交身份</span>
              {repository.user?.name || repository.user?.email ? (
                <code>
                  {repository.user?.name || "未设置姓名"}
                  {repository.user?.email ? ` <${repository.user.email}>` : ""}
                </code>
              ) : (
                <em>未配置 user.name / user.email，提交会失败</em>
              )}
            </div>
          </div>
        )}
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
        {notice && (
          <p className="picker-note" role="status">
            {notice}
          </p>
        )}
        {busy && (
          <p role="status" className="repository-loading">
            {repository ? "正在更新分支…" : "正在读取分支…"}
          </p>
        )}
        {repository ? (
          <>
            <div className="repository-controls">
              <div className="tabs" role="group" aria-label="分支来源筛选">
                {(
                  [
                    ["all", "全部"],
                    ["local", "本地"],
                    ["remote", "远程"],
                    ["new", "未添加"],
                  ] as [Filter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={filter === key ? "selected" : ""}
                    aria-pressed={filter === key}
                    disabled={busy}
                    onClick={() => setFilter(key)}
                  >
                    {label} {counts[key]}
                  </button>
                ))}
              </div>
              <input
                className="repository-search"
                aria-label="搜索分支"
                placeholder="搜索分支名或提交说明…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="repository-branches">
              {visible.map((branch) => {
                const added = recorded.has(branch.name);
                const disabled = busy || added;
                return (
                  <label
                    className={`repository-branch branch-option ${added ? "is-recorded" : ""}`}
                    key={branch.name}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择分支 ${branch.name}`}
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
                        {branch.remoteRef ? (
                          <Cloud size={16} />
                        ) : (
                          <GitBranch size={16} />
                        )}
                        <code>{branch.name}</code>
                        {branch.current && (
                          <span className="tag blue">当前分支</span>
                        )}
                        {branch.local && !branch.current && (
                          <span className="tag">本地</span>
                        )}
                        {branch.remoteRef && (
                          <span className="tag">远程 {branch.remote}</span>
                        )}
                        {branch.ahead > 0 && (
                          <span className="tag">领先 {branch.ahead}</span>
                        )}
                        {branch.behind > 0 && (
                          <span className="tag">落后 {branch.behind}</span>
                        )}
                        {added && <span className="tag green">已添加</span>}
                      </div>
                      <p>{branch.subject || "无提交说明"}</p>
                    </div>
                    <span className="repository-commit">{branch.commit}</span>
                  </label>
                );
              })}
              {!visible.length && (
                <div className="repository-empty">
                  {branches.length
                    ? "没有符合当前筛选条件的分支。"
                    : "仓库里还没有分支。先提交一次，或点击“更新分支”拉取远程分支。"}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <span className="field-hint">
                已选择 {chosen.length} 个分支
                {chosen.length
                  ? "，添加后可在功能分支列表中提交到发布分支"
                  : "，已添加过的分支不会重复出现"}
              </span>
              <span className="spacer" />
              <button className="secondary" disabled={busy} onClick={close}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !chosen.length}
                onClick={add}
              >
                添加为功能分支
              </button>
            </div>
          </>
        ) : (
          !busy &&
          !error && (
            <div className="repository-empty">
              这个项目还没有关联仓库。选择项目所在的仓库文件夹后，会列出本地和全部远程分支。
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
