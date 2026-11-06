import Sidebar, { type View } from "./Sidebar";
import BranchTable from "./BranchTable";
import BranchPicker from "./BranchPicker";
import SubmitDialog from "./SubmitDialog";
import TargetBar from "./TargetBar";
import Modal from "./Modal";
import EditorForm, { type Editor } from "./EditorForm";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ChevronRight,
  Circle,
  CircleCheck,
  Copy,
  FlaskConical,
  Folder,
  GitBranch,
  GitMerge,
  History,
  Layers3,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  blankStore,
  markModified,
  markStageMerged,
  parseStore,
  type Branch,
  type Stage,
  type Store,
} from "./model";
import * as storage from "./storage";

type Filter = "all" | "test-pending" | "release-pending" | "release-done";

export default function App() {
  const [store, setStore] = useState<Store>(blankStore);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: "settings" });
  const [query, setQuery] = useState("");
  const [repositoryProjectId, setRepositoryProjectId] = useState<string | null>(
    null,
  );
  const [submit, setSubmit] = useState<{
    projectId: string;
    branchIds: string[];
    stage: Stage;
  } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  // 待删除的记录（单条或批量）：只删台账记录，不碰仓库里的真实分支
  const [deleteQueue, setDeleteQueue] = useState<{
    ids: string[];
    names: string[];
  } | null>(null);
  const [toast, setToast] = useState("");
  const [restore, setRestore] = useState<Store | null>(null);
  const [fileError, setFileError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const restoreRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const canWrite = useRef(false);

  useEffect(() => {
    storage
      .load()
      .then((value) => {
        setStore(value);
        // 打开即进入第一个项目（未归档优先），侧边栏按项目区分
        const first =
          value.projects.find((p) => !p.archived) ?? value.projects[0];
        if (first) setView({ kind: "project", id: first.id });
        canWrite.current = true;
      })
      .catch((error) =>
        setLoadError(
          `无法读取本地数据：${error.message}。原文件未被覆盖。请检查权限，或从备份恢复。`,
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        openPicker();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [store.projects]);

  async function commit(
    next: Store,
    message = "已保存到本地",
    recovery = false,
  ) {
    if (writing.current || (!canWrite.current && !recovery)) return false;
    writing.current = true;
    setBusy(true);
    try {
      await storage.save(next);
      setStore(next);
      setToast(message);
      canWrite.current = true;
      return true;
    } catch (error) {
      setToast(
        `保存失败：${error instanceof Error ? error.message : "请检查存储权限"}`,
      );
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  function navigate(next: View) {
    setView(next);
    setQuery("");
    setFilter("all");
    setSelected([]);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制到剪贴板");
    } catch {
      setToast("复制失败，请检查剪贴板权限");
    }
  }
  // 列表里点击状态：已合并 → 分支有新修改，重置为待合并；未合并 → 手动标记已合并
  // 重置测试时一并重置发布，因为新提交同样还没进发布分支
  async function toggleMerged(branch: Branch, stage: Stage) {
    const merged = stage === "test" ? branch.testMergedAt : branch.releaseMergedAt;
    await commit(
      merged
        ? markModified(store, branch.id, stage === "test" ? "both" : "release")
        : markStageMerged(store, branch.id, stage),
      merged
        ? `已标记待重新合并${stage === "test" && branch.releaseMergedAt ? "（测试与发布）" : ""}`
        : "已标记合并",
    );
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    setFileError("");
    try {
      const raw = await file.text();
      setRestore(parseStore(raw));
    } catch (error) {
      setFileError(
        `文件读取失败：${error instanceof Error ? error.message : "请检查文件格式"}`,
      );
    }
  }

  const project =
    view.kind === "project"
      ? store.projects.find((p) => p.id === view.id)
      : undefined;
  const scope = store.branches.filter((b) =>
    project ? b.projectId === project.id : false,
  );
  const visible = scope.filter(
    (b) =>
      (!query ||
        `${b.name} ${b.description} ${b.note}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "test-pending" && !b.testMergedAt) ||
        (filter === "release-pending" && !b.releaseMergedAt) ||
        (filter === "release-done" && !!b.releaseMergedAt)),
  );

  // 用于空状态文案：这个项目里是否已经有过记录（而不是从来没记过）
  const hasAnyRecord = project
    ? store.branches.some((b) => b.projectId === project.id)
    : false;
  // 目标分支栏展示当前项目
  const targetProject = project && !project.archived ? project : undefined;
  const title = project?.name || "数据与设置";
  const selectedVisible = selected.filter((value) =>
    visible.some((b) => b.id === value),
  );
  // 主入口：先挑出这次要跟进的功能分支，再在列表里提交到测试或发布分支
  function openPicker() {
    const chosen =
      project && !project.archived
        ? project
        : store.projects.find((p) => !p.archived);
    if (chosen) setRepositoryProjectId(chosen.id);
    else {
      setToast("请先创建项目，再从仓库选择分支");
      setEditor({ kind: "project" });
    }
  }
  // 单条或批量：打开提交对话框，由它完成分支选择、合并与状态回写
  const openSubmit = (branchIds: string[], stage: Stage = "release") => {
    const chosen = store.branches.filter((b) => branchIds.includes(b.id));
    if (!chosen.length) {
      setToast("请选择要提交的分支");
      return;
    }
    const projectIds = new Set(chosen.map((b) => b.projectId));
    if (projectIds.size > 1) {
      setToast("一次只能提交同一个项目的分支，请分批操作");
      return;
    }
    const target = store.projects.find((p) => p.id === chosen[0].projectId);
    if (!target) return;
    if (!target.repositoryPath) {
      setToast("该项目还没有关联仓库，请先从全部分支中选择");
      setRepositoryProjectId(target.id);
      return;
    }
    setSubmit({
      projectId: target.id,
      branchIds: chosen.map((b) => b.id),
      stage,
    });
  };

  if (loading)
    return (
      <div className="loading">
        <GitBranch size={30} />
        <p>正在打开你的工作台…</p>
      </div>
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        跳到主内容
      </a>
      <Sidebar
        store={store}
        view={view}
        navigate={navigate}
        setEditor={setEditor}
      />

      <div className="main-shell">
        <header className="toolbar">
          <div className="breadcrumb">
            工作空间
            <ChevronRight size={13} />
            <span>{title}</span>
          </div>
          <div className="toolbar-actions">
            <label className="search">
              <Search size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索分支或功能…"
                aria-label="搜索分支或功能"
              />
              <kbd>⌘ K / Ctrl K</kbd>
            </label>
            <button className="primary compact" onClick={openPicker}>
              <GitBranch size={16} />
              从仓库添加分支
            </button>
          </div>
        </header>

        <main id="content">
          {loadError && (
            <div className="error-banner" role="alert">
              {loadError}
              <button onClick={() => restoreRef.current?.click()}>
                恢复备份
              </button>
            </div>
          )}
          {fileError && (
            <div className="error-banner" role="alert">
              {fileError}
              <button aria-label="关闭错误" onClick={() => setFileError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view.kind === "settings" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">属于你自己的工作空间</p>
                  <h1>数据与设置</h1>
                  <p>你的分支记录，只留在你的设备上。</p>
                </div>
              </div>
              <section className="settings-panel">
                <h2>数据管理</h2>
                <div className="setting-row">
                  <div>
                    <h3>导出完整备份</h3>
                    <p>包含所有项目、分支和状态，保存为 JSON。</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      void storage
                        .exportBackup(store)
                        .then((ok) => ok && setToast("备份已导出"))
                        .catch(() => setToast("导出失败，请检查保存位置"));
                    }}
                  >
                    <ArrowDownToLine size={16} />
                    导出备份
                  </button>
                </div>
                <div className="setting-row">
                  <div>
                    <h3>从备份恢复</h3>
                    <p>恢复前可预览摘要，并自动备份当前数据。</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => restoreRef.current?.click()}
                  >
                    <History size={16} />
                    恢复备份
                  </button>
                </div>
              </section>
              <section className="settings-panel">
                <h2>关于本地存储</h2>
                <p className="settings-copy">
                  {window.branchNote
                    ? "桌面版数据保存在应用专用目录，操作成功后自动保存。"
                    : "当前是浏览器预览版，数据保存在此浏览器的本地存储。桌面版使用应用专用数据目录。"}
                  建议在重要发布后导出一份 JSON 备份。
                </p>
                <p className="settings-copy">
                  点「提交测试 / 提交发布」即合并到对应分支并推送，冲突文件逐个由你决定取舍。合并状态由提交操作自动写入，应用不会自动部署。
                </p>
              </section>
            </>
          ) : project ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="heading-context">
                    <span className="eyebrow">
                      {project.archived ? "项目（已归档）" : "项目工作台"}
                    </span>
                    <span className="tag blue">{scope.length} 个分支</span>
                  </div>
                  <h1>{title}</h1>
                  <p>{project.note || "记录进展，安排下一次发布。"}</p>
                </div>
                <div className="heading-actions">
                  <button
                    className="secondary"
                    onClick={() => setEditor({ kind: "project", value: project })}
                  >
                    <Pencil size={15} />
                    编辑项目
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    title={project.archived ? "取消归档" : "归档项目（保留全部记录）"}
                    onClick={() => {
                      void commit({
                        ...store,
                        projects: store.projects.map((item) =>
                          item.id === project.id
                            ? { ...item, archived: !item.archived }
                            : item,
                        ),
                      });
                    }}
                  >
                    <Archive size={15} />
                    {project.archived ? "取消归档" : "归档"}
                  </button>
                </div>
              </div>

              {targetProject && (
                <TargetBar
                  key={targetProject.id}
                  project={targetProject}
                  store={store}
                  commit={commit}
                />
              )}

              <div className="overview" aria-label="分支进度统计">
                  {(
                    [
                      ["all", "全部分支", scope.length, Layers3, "neutral"],
                      [
                        "test-pending",
                        "待合并测试",
                        scope.filter((b) => !b.testMergedAt).length,
                        Circle,
                        "orange",
                      ],
                      [
                        "release-pending",
                        "待合并发布",
                        scope.filter((b) => !b.releaseMergedAt).length,
                        GitMerge,
                        "purple",
                      ],
                      [
                        "release-done",
                        "已合并发布",
                        scope.filter((b) => !!b.releaseMergedAt).length,
                        CircleCheck,
                        "green",
                      ],
                    ] as const
                  ).map(([key, label, count, Icon, color]) => (
                    <button
                      key={key}
                      className={`stat ${filter === key ? "chosen" : ""}`}
                      onClick={() => setFilter(key)}
                      aria-pressed={filter === key}
                    >
                      <span className="stat-label">
                        <Icon size={16} className={color} />
                        {label}
                      </span>
                      <strong>
                        {count}
                        <small>个分支</small>
                      </strong>
                    </button>
                  ))}
                </div>

              <section className="branch-section">
                <div className="list-toolbar">
                  <div className="tabs" aria-label="状态筛选">
                    {(
                      [
                        ["all", "全部"],
                        ["test-pending", "待合并测试"],
                        ["release-pending", "待合并发布"],
                        ["release-done", "已合并发布"],
                      ] as [Filter, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={filter === key ? "selected" : ""}
                        onClick={() => {
                          setFilter(key);
                          setSelected([]);
                        }}
                        aria-pressed={filter === key}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="list-filters">
                    <span className="result-count">
                      {visible.length} 条记录
                    </span>
                  </div>
                </div>
                {selectedVisible.length > 0 && (
                  <div className="selection-bar">
                    <span>已选择 {selectedVisible.length} 个分支</span>
                    <button
                      className="text-button selection-submit test"
                      onClick={() => openSubmit(selectedVisible, "test")}
                    >
                      <FlaskConical size={14} />
                      提交测试
                    </button>
                    <button
                      className="text-button selection-submit release"
                      onClick={() => openSubmit(selectedVisible, "release")}
                    >
                      <GitMerge size={14} />
                      提交发布
                    </button>
                    <button
                      className="text-button selection-submit danger"
                      disabled={busy}
                      title="只删除这些跟进记录，仓库里的分支不会被删除"
                      onClick={() => {
                        const chosen = store.branches.filter((b) =>
                          selectedVisible.includes(b.id),
                        );
                        setDeleteQueue({
                          ids: chosen.map((b) => b.id),
                          names: chosen.map((b) => b.name),
                        });
                      }}
                    >
                      <Trash2 size={14} />
                      删除记录
                    </button>
                    <button
                      className="icon-button"
                      aria-label="取消选择"
                      onClick={() => setSelected([])}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {!visible.length ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <GitBranch size={31} strokeWidth={1.6} />
                    </div>
                    <h2>
                      {scope.length
                        ? "这里已经清清爽爽"
                        : hasAnyRecord
                          ? "这个项目还没有待跟进的分支"
                          : "先挑出要跟进的功能分支"}
                    </h2>
                    <p>
                      {scope.length
                        ? "没有符合当前筛选条件的分支，试试其他条件。"
                        : hasAnyRecord
                          ? "需要继续跟进新功能时，从仓库里再挑几条。"
                          : "从仓库里选分支，点「提交」即可合并到测试或发布分支。"}
                    </p>
                    {scope.length ? (
                      <button
                        className="secondary"
                        onClick={() => {
                          setFilter("all");
                          setQuery("");
                        }}
                      >
                        清除筛选
                      </button>
                    ) : (
                      <div className="empty-actions">
                        <button className="primary" onClick={openPicker}>
                          <GitBranch size={16} />
                          从仓库添加分支
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <BranchTable
                    store={store}
                    visible={visible}
                    selected={selected}
                    busy={busy}
                    setSelected={setSelected}
                    setEditor={setEditor}
                    copy={copy}
                    submit={openSubmit}
                    toggleMerged={toggleMerged}
                    remove={(branch) =>
                      setDeleteQueue({ ids: [branch.id], names: [branch.name] })
                    }
                  />
                )}
              </section>

              <div className="workspace-note">
                <ShieldCheck size={14} />
                <span>
                  分支从本地或远程仓库挑选；合并状态由提交操作自动记录，分支有新修改时可随时重新标记。
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">工作空间</p>
                  <h1>还没有项目</h1>
                  <p>
                    {store.projects.length
                      ? "这个项目已经不存在，从侧边栏选一个，或新建一个。"
                      : "先创建一个项目并关联仓库，它的功能分支都会归到这里。"}
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="primary"
                    onClick={() => setEditor({ kind: "project" })}
                  >
                    <Plus size={16} />
                    新建项目
                  </button>
                </div>
              </div>
              <div className="empty-state">
                <div className="empty-icon">
                  <Folder size={31} strokeWidth={1.6} />
                </div>
                <h2>侧边栏按项目组织</h2>
                <p>一个项目对应一个仓库文件夹，点左侧的项目名即可切换。</p>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            <span className={`save-dot ${busy ? "saving" : ""}`} />
            {loadError
              ? "本地数据读取失败"
              : busy
                ? "正在保存…"
                : "已保存到本地"}
          </span>
          <span>
            {store.projects.length} 个项目
            <span className="footer-divider" />
            {store.branches.filter((b) => !b.testMergedAt).length} 个待合并测试
            <span className="footer-divider" />
            {store.branches.filter((b) => !b.releaseMergedAt).length} 个待合并发布
          </span>
        </footer>
      </div>

      <input
        ref={restoreRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {editor && (
        <EditorForm
          editor={editor}
          store={store}
          submit={(next) => commit(next)}
          close={() => setEditor(null)}
          remove={(branch) =>
            setDeleteQueue({ ids: [branch.id], names: [branch.name] })
          }
        />
      )}
      {repositoryProjectId && (
        <BranchPicker
          key={repositoryProjectId}
          project={store.projects.find((p) => p.id === repositoryProjectId)!}
          store={store}
          commit={commit}
          close={() => setRepositoryProjectId(null)}
          onProjectChange={setRepositoryProjectId}
        />
      )}
      {submit && (
        <SubmitDialog
          key={`${submit.projectId}-${submit.branchIds.join("-")}-${submit.stage}`}
          project={store.projects.find((p) => p.id === submit.projectId)!}
          branchIds={submit.branchIds}
          initialStage={submit.stage}
          store={store}
          commit={commit}
          close={() => setSubmit(null)}
        />
      )}
      {deleteQueue && (
        <Modal title="删除分支记录？" close={() => setDeleteQueue(null)}>
          <div className="confirm-body">
            {deleteQueue.names.length === 1 ? (
              <p>
                <strong>{deleteQueue.names[0]}</strong>
              </p>
            ) : (
              <p>
                将删除 <strong>{deleteQueue.names.length}</strong> 条分支记录：
                <span className="confirm-list">
                  {deleteQueue.names.join("、")}
                </span>
              </p>
            )}
            <p className="picker-note">
              只删除本应用里的跟进记录和合并状态，
              <strong>仓库里的真实分支不会被删除</strong>，随时可以从仓库重新添加。
            </p>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setDeleteQueue(null)}
              >
                保留记录
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={async () => {
                  const ids = new Set(deleteQueue.ids);
                  if (
                    await commit(
                      {
                        ...store,
                        branches: store.branches.filter((b) => !ids.has(b.id)),
                      },
                      `已删除 ${deleteQueue.names.length} 条分支记录`,
                    )
                  ) {
                    setSelected((prev) =>
                      prev.filter((value) => !ids.has(value)),
                    );
                    setDeleteQueue(null);
                    setEditor(null);
                  }
                }}
              >
                删除记录
              </button>
            </div>
          </div>
        </Modal>
      )}
      {restore && (
        <Modal title="从备份恢复工作空间" close={() => setRestore(null)}>
          <div className="confirm-body">
            <p>
              备份包含 <strong>{restore.projects.length}</strong> 个项目和{" "}
              <strong>{restore.branches.length}</strong> 条分支。
              旧备份里的发布批次与上线确认会被忽略，合并状态原样保留。
            </p>
            <div className="warning-panel">
              这将替换当前所有数据。替换前会自动保存当前数据的备份。
              {loadError && "现有数据读取失败，将保留原始文件内容的备份。"}
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setRestore(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  try {
                    if (loadError) {
                      const raw = window.branchNote
                        ? await window.branchNote.read()
                        : localStorage.getItem("branchnote-v1");
                      if (raw) {
                        if (window.branchNote)
                          await window.branchNote.backup(raw);
                        else
                          localStorage.setItem(
                            `branchnote-before-restore-${Date.now()}`,
                            raw,
                          );
                      }
                    } else await storage.backup(store);
                    if (await commit(restore, "备份恢复成功", true)) {
                      setRestore(null);
                      setLoadError("");
                      const first =
                        restore.projects.find((p) => !p.archived) ??
                        restore.projects[0];
                      navigate(
                        first
                          ? { kind: "project", id: first.id }
                          : { kind: "settings" },
                      );
                    }
                  } catch {
                    setFileError(
                      "恢复失败：无法备份当前数据，当前数据未被替换。",
                    );
                  }
                }}
              >
                备份并恢复
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
