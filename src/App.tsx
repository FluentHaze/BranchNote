import Sidebar, { type View } from "./Sidebar";
import BranchTable from "./BranchTable";
import Select from "./Select";
import RepositoryDialog from "./RepositoryDialog";
import Modal from "./Modal";
import EditorForm, { type Editor } from "./EditorForm";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Copy,
  Folder,
  GitBranch,
  GitMerge,
  History,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  blankStore,
  demoStore,
  id,
  now,
  parseStore,
  parseTxt,
  releaseChecklist,
  type Branch,
  type ImportRow,
  type Store,
} from "./model";
import * as storage from "./storage";

type Filter = "all" | "untested" | "unmerged" | "ready" | "released";
const colors = [
  "#007aff",
  "#af52de",
  "#e58b20",
  "#299765",
  "#e65a66",
  "#64748b",
];
const formatDate = (value: string) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString("zh-CN", {
        month: "long",
        day: "numeric",
      })
    : "日期待定";

export default function App() {
  const [store, setStore] = useState<Store>(blankStore);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [repositoryProjectId, setRepositoryProjectId] = useState<string | null>(
    null,
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [projectFilter, setProjectFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [releaseIds, setReleaseIds] = useState<string[] | null>(null);
  const [deleteBranch, setDeleteBranch] = useState<Branch | null>(null);
  const [toast, setToast] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [importError, setImportError] = useState("");
  const [restore, setRestore] = useState<Store | null>(null);
  const [fileError, setFileError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const canWrite = useRef(false);

  useEffect(() => {
    storage
      .load()
      .then((value) => {
        setStore(value);
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
        setEditor(
          store.projects.some((p) => !p.archived)
            ? { kind: "branch" }
            : { kind: "project" },
        );
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
    setProjectFilter("");
    setBatchFilter("");
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
  async function toggle(
    branch: Branch,
    field: "tested" | "mergedAt" | "released",
  ) {
    if (field === "released" && !branch.released) {
      setReleaseIds([branch.id]);
      return;
    }
    const batch = store.batches.find((b) => b.id === branch.batchId);
    if (
      field === "mergedAt" &&
      !branch.mergedAt &&
      !batch?.targets[branch.projectId]?.trim()
    ) {
      setToast("请先在发布批次中填写该项目的目标发布分支");
      return;
    }
    const timestamp = now();
    const changed = { ...branch, updatedAt: timestamp };
    if (field === "tested") changed.tested = !branch.tested;
    if (field === "mergedAt")
      changed.mergedAt = branch.mergedAt ? null : timestamp;
    if (field === "released") {
      changed.released = false;
      changed.releasedAt = null;
    }
    await commit({
      ...store,
      branches: store.branches.map((b) => (b.id === branch.id ? changed : b)),
      batches:
        field === "released"
          ? store.batches.map((b) =>
              b.id === branch.batchId ? { ...b, completed: false } : b,
            )
          : store.batches,
    });
  }
  async function readFile(file: File | undefined, kind: "txt" | "json") {
    if (!file) return;
    setFileError("");
    try {
      const raw = await file.text();
      if (kind === "json") setRestore(parseStore(raw));
      else {
        setRows(parseTxt(raw));
        setImportError("");
      }
    } catch (error) {
      setFileError(
        `文件读取失败：${error instanceof Error ? error.message : "请检查文件格式"}`,
      );
    }
  }
  async function confirmImport() {
    const included = rows!.filter((row) => row.include);
    if (!included.length) {
      setImportError("请至少选择一条记录");
      return;
    }
    if (
      included.some(
        (row) =>
          !row.project.trim() || !row.name.trim() || !row.description.trim(),
      )
    ) {
      setImportError(
        "请补全选中行的项目、分支名称和说明；无法识别的内容也可以取消勾选",
      );
      return;
    }
    const next: Store = {
      ...store,
      projects: [...store.projects],
      branches: [...store.branches],
    };
    for (const row of included) {
      let project = next.projects.find((p) => p.name === row.project.trim());
      if (project?.archived) {
        setImportError(
          `项目“${project.name}”已归档，请先取消归档或修改导入项目名称`,
        );
        return;
      }
      if (!project) {
        project = {
          id: id(),
          name: row.project.trim(),
          note: "",
          archived: false,
          color: colors[next.projects.length % colors.length],
        };
        next.projects.push(project);
      }
      if (
        next.branches.some(
          (b) =>
            b.projectId === project.id &&
            b.name === row.name.trim() &&
            !b.released,
        )
      ) {
        setImportError(
          `项目“${project.name}”中分支“${row.name.trim()}”重复，请修正或取消勾选`,
        );
        return;
      }
      const timestamp = now();
      next.branches.push({
        id: id(),
        projectId: project.id,
        name: row.name.trim(),
        description: row.description.trim(),
        note: row.note,
        batchId: "",
        tested: false,
        released: false,
        mergedAt: null,
        releasedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (await commit(next, `已导入 ${included.length} 条分支记录`))
      setRows(null);
  }

  const batch =
    view.kind === "batch"
      ? store.batches.find((b) => b.id === view.id)
      : undefined;
  const project =
    view.kind === "project"
      ? store.projects.find((p) => p.id === view.id)
      : undefined;
  const pending = store.branches.filter((b) => !b.released);
  const scope = store.branches.filter((b) =>
    batch
      ? b.batchId === batch.id
      : project
        ? b.projectId === project.id && !b.released
        : view.kind === "history"
          ? b.released
          : !b.released,
  );
  const visible = scope.filter(
    (b) =>
      (!projectFilter || b.projectId === projectFilter) &&
      (!batchFilter ||
        (batchFilter === "none" ? !b.batchId : b.batchId === batchFilter)) &&
      (!query ||
        `${b.name} ${b.description} ${b.note}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "untested" && !b.tested) ||
        (filter === "unmerged" && !b.mergedAt && !b.released) ||
        (filter === "ready" && !!b.mergedAt && !b.released) ||
        (filter === "released" && b.released)),
  );

  const releasedCount = scope.filter((b) => b.released).length;
  const title =
    batch?.name ||
    project?.name ||
    (
      {
        all: "全部未上线",
        history: "上线历史",
        projects: "项目管理",
        settings: "数据与设置",
      } as Record<string, string>
    )[view.kind];
  const selectedVisible = selected.filter((value) =>
    visible.some((b) => b.id === value && !b.released),
  );
  const newBranch = () =>
    setEditor(
      store.projects.some((p) => !p.archived)
        ? { kind: "branch" }
        : { kind: "project" },
    );
  // 主入口：读取本地分支（顺带可合并），而不是手工新增记录
  const openRepository = () => {
    const chosen =
      project && !project.archived
        ? project
        : store.projects.find((p) => !p.archived);
    if (chosen) setRepositoryProjectId(chosen.id);
    else {
      setToast("请先创建项目，再关联本地 Git 仓库");
      setEditor({ kind: "project" });
    }
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
            <button
              className="primary compact"
              onClick={openRepository}
            >
              <GitBranch size={16} />
              本地分支
            </button>
            <button
              className="secondary compact"
              onClick={() => setEditor({ kind: "batch" })}
            >
              <Plus size={15} />
              新建批次
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
                    <p>包含所有项目、分支、发布批次和状态，保存为 JSON。</p>
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
                <div className="setting-row">
                  <div>
                    <h3>导入 TXT 记录</h3>
                    <p>先预览、修正，再导入。历史状态一律由你重新确认。</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => fileRef.current?.click()}
                  >
                    <ArrowUpFromLine size={16} />
                    导入 TXT
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
                  提测、合并与上线状态由你确认。本地合并需在“本地分支”中核对后执行，不自动推送或部署。
                </p>
              </section>
            </>
          ) : view.kind === "projects" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">不同项目，井井有条</p>
                  <h1>项目管理</h1>
                  <p>按仓库组织分支，保留每一次发布的来路。</p>
                </div>
                <button
                  className="primary"
                  onClick={() => setEditor({ kind: "project" })}
                >
                  <Plus size={16} />
                  新建项目
                </button>
              </div>
              <div className="project-grid">
                {store.projects.map((p) => (
                  <article
                    className={`project-card ${p.archived ? "archived" : ""}`}
                    key={p.id}
                  >
                    <div className="project-card-head">
                      <Folder size={25} style={{ color: p.color }} />
                      <button
                        className="icon-button"
                        aria-label={`编辑${p.name}`}
                        onClick={() => setEditor({ kind: "project", value: p })}
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                    <h2>
                      {p.name}
                      {p.archived && <span className="tag">已归档</span>}
                    </h2>
                    <p>{p.note || "还没有添加项目备注"}</p>
                    <div className="project-card-footer">
                      <button
                        className="text-button"
                        onClick={() => navigate({ kind: "project", id: p.id })}
                      >
                        {pending.filter((b) => b.projectId === p.id).length}{" "}
                        个未上线分支
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={
                          p.archived ? `取消归档${p.name}` : `归档${p.name}`
                        }
                        title={
                          p.archived ? "取消归档" : "归档项目（保留全部记录）"
                        }
                        disabled={busy}
                        onClick={() => {
                          void commit({
                            ...store,
                            projects: store.projects.map((item) =>
                              item.id === p.id
                                ? { ...item, archived: !item.archived }
                                : item,
                            ),
                          });
                        }}
                      >
                        <Archive size={16} />
                      </button>
                    </div>
                  </article>
                ))}
                <button
                  className="project-card add-project"
                  onClick={() => setEditor({ kind: "project" })}
                >
                  <Plus size={26} />
                  添加一个项目
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="heading-context">
                    <span className="eyebrow">
                      {batch
                        ? "发布工作台"
                        : project
                          ? "项目工作台"
                          : view.kind === "history"
                            ? "每一次完成，都值得记录"
                            : "让发布，心中有数"}
                    </span>
                    {batch && (
                      <span
                        className={`tag ${batch.completed ? "green" : "blue"}`}
                      >
                        {batch.completed ? "已完成" : "进行中"}
                      </span>
                    )}
                  </div>
                  <h1>{title}</h1>
                  <p>
                    {batch ? (
                      <>
                        <Clock3 size={14} />
                        计划于 {formatDate(batch.date)} 发布
                        <span className="heading-divider" />
                        {batch.note || "逐项核对，安心上线。"}
                      </>
                    ) : project ? (
                      project.note || "记录进展，安排下一次发布。"
                    ) : view.kind === "history" ? (
                      "已上线的功能在这里归档，随时回看。"
                    ) : (
                      "从开发到上线，清楚掌握每一个分支的进展。"
                    )}
                  </p>
                </div>
                <div className="heading-actions">
                  {batch ? (
                    <>
                      <button
                        className="secondary"
                        onClick={() => copy(releaseChecklist(store, batch.id))}
                      >
                        <Copy size={15} />
                        复制发布清单
                      </button>
                      <button
                        className="icon-button bordered"
                        aria-label="编辑发布批次"
                        onClick={() =>
                          setEditor({ kind: "batch", value: batch })
                        }
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </>
                  ) : project ? (
                    <button
                      className="secondary"
                      onClick={() =>
                        setEditor({ kind: "project", value: project })
                      }
                    >
                      <Pencil size={15} />
                      编辑项目
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() => fileRef.current?.click()}
                    >
                      <ArrowUpFromLine size={15} />
                      导入 TXT
                    </button>
                  )}
                </div>
              </div>

              {view.kind !== "history" && (
                <div className="overview" aria-label="分支进度统计">
                  {(
                    [
                      [
                        "all",
                        batch ? "计划发布" : "未上线分支",
                        scope.length,
                        Layers3,
                        "neutral",
                      ],
                      [
                        "untested",
                        "尚未部署测试",
                        scope.filter((b) => !b.tested).length,
                        Circle,
                        "orange",
                      ],
                      [
                        "unmerged",
                        "尚未合入发布分支",
                        scope.filter((b) => !b.mergedAt && !b.released).length,
                        GitMerge,
                        "purple",
                      ],
                      [
                        "ready",
                        "已合并，等待上线",
                        scope.filter((b) => !!b.mergedAt && !b.released).length,
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
              )}

              {batch && (
                <div className="release-progress">
                  <div>
                    <span>上线进度</span>
                    <strong>
                      {releasedCount} <span>/ {scope.length}</span>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${scope.length ? (releasedCount / scope.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span>
                    {scope.length
                      ? Math.round((releasedCount / scope.length) * 100)
                      : 0}
                    %
                  </span>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (!batch.completed && scope.some((b) => !b.released)) {
                        setToast(
                          "仍有未上线分支，请先确认上线或将其移出本批次",
                        );
                        return;
                      }
                      void commit({
                        ...store,
                        batches: store.batches.map((b) =>
                          b.id === batch.id
                            ? { ...b, completed: !b.completed }
                            : b,
                        ),
                      });
                    }}
                  >
                    {batch.completed ? "重新打开批次" : "完成批次"}
                    <CheckCheck size={15} />
                  </button>
                </div>
              )}

              <section className="branch-section">
                <div className="list-toolbar">
                  <div className="tabs" aria-label="状态筛选">
                    {(
                      [
                        ["all", "全部分支"],
                        ["unmerged", "待合并"],
                        ["ready", "待上线"],
                        ...(batch ? [["released", "已上线"]] : []),
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
                    {!project && (
                      <div className="filter-select">
                        <Folder size={14} />
                        <Select
                          value={projectFilter}
                          label="筛选项目"
                          onChange={setProjectFilter}
                          options={[
                            { value: "", label: "所有项目" },
                            ...store.projects.map((p) => ({
                              value: p.id,
                              label: p.name,
                            })),
                          ]}
                        />
                      </div>
                    )}
                    {!batch && (
                      <div className="filter-select">
                        <Layers3 size={14} />
                        <Select
                          value={batchFilter}
                          label="筛选批次"
                          onChange={setBatchFilter}
                          options={[
                            { value: "", label: "所有批次" },
                            { value: "none", label: "待安排" },
                            ...store.batches.map((b) => ({
                              value: b.id,
                              label: b.name,
                            })),
                          ]}
                        />
                      </div>
                    )}
                    <span className="result-count">
                      {visible.length} 条记录
                    </span>
                  </div>
                </div>
                {selectedVisible.length > 0 && (
                  <div className="selection-bar">
                    <span>已选择 {selectedVisible.length} 个分支</span>
                    <button
                      className="text-button"
                      onClick={() => setReleaseIds(selectedVisible)}
                    >
                      批量确认上线
                      <ArrowUpRight size={14} />
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
                        : view.kind === "history"
                          ? "下一次上线，值得期待"
                          : "好想法，从一个分支开始"}
                    </h2>
                    <p>
                      {scope.length
                        ? "没有符合当前筛选条件的分支，试试其他条件。"
                        : view.kind === "history"
                          ? "确认上线的分支会保存在这里。"
                          : "记下正在做的事，让每次发布都少一点遗漏。"}
                    </p>
                    {scope.length ? (
                      <button
                        className="secondary"
                        onClick={() => {
                          setFilter("all");
                          setQuery("");
                          setProjectFilter("");
                          setBatchFilter("");
                        }}
                      >
                        清除筛选
                      </button>
                    ) : (
                      view.kind !== "history" && (
                        <div className="empty-actions">
                          <button className="primary" onClick={openRepository}>
                            <GitBranch size={16} />
                            读取本地分支
                          </button>
                          <button
                            className="text-button"
                            onClick={newBranch}
                          >
                            <Plus size={15} />
                            手动记一条
                          </button>
                          {!store.projects.length && (
                            <button
                              className="text-button"
                              disabled={busy || !!loadError}
                              onClick={() => {
                                void commit(demoStore(), "已载入示例数据").then(
                                  (ok) => {
                                    if (ok)
                                      navigate({ kind: "batch", id: "week45" });
                                  },
                                );
                              }}
                            >
                              <Sparkles size={15} />
                              体验示例工作台
                            </button>
                          )}
                        </div>
                      )
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
                    navigate={navigate}
                    copy={copy}
                    toggle={toggle}
                    commit={commit}
                  />
                )}
                {visible.length > 0 && (
                  <button className="add-row" onClick={newBranch}>
                    <Plus size={16} />
                    手动添加一条分支记录<span>⌘ / Ctrl N</span>
                  </button>
                )}
              </section>

              {batch && (
                <div className="batch-destinations">
                  <GitMerge size={16} />
                  <span>目标发布分支</span>
                  {store.projects
                    .filter((p) => scope.some((b) => b.projectId === p.id))
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() =>
                          setEditor({ kind: "batch", value: batch })
                        }
                      >
                        {p.name}
                        <code>{batch.targets[p.id] || "待填写"}</code>
                      </button>
                    ))}
                  {!scope.length && (
                    <button
                      onClick={() => setEditor({ kind: "batch", value: batch })}
                    >
                      设置各项目的发布分支
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
              )}
              <div className="workspace-note">
                <ShieldCheck size={14} />
                <span>状态由你手动确认，每一次核对都让发布更安心。</span>
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
            {pending.length} 个未上线分支
          </span>
        </footer>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={(e) => {
          void readFile(e.target.files?.[0], "txt");
          e.target.value = "";
        }}
      />
      <input
        ref={restoreRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void readFile(e.target.files?.[0], "json");
          e.target.value = "";
        }}
      />
      {editor && (
        <EditorForm
          editor={editor}
          store={store}
          submit={(next) => commit(next)}
          close={() => setEditor(null)}
          remove={(branch) => setDeleteBranch(branch)}
        />
      )}
      {repositoryProjectId && (
        <RepositoryDialog
          key={repositoryProjectId}
          project={store.projects.find((p) => p.id === repositoryProjectId)!}
          store={store}
          commit={commit}
          close={() => setRepositoryProjectId(null)}
          onProjectChange={setRepositoryProjectId}
        />
      )}
      {deleteBranch && (
        <Modal title="删除这条分支记录？" close={() => setDeleteBranch(null)}>
          <div className="confirm-body">
            <p>
              <strong>{deleteBranch.name}</strong>
            </p>
            <p>记录及其发布状态将被删除，此操作无法撤销。</p>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setDeleteBranch(null)}
              >
                保留记录
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await commit(
                      {
                        ...store,
                        branches: store.branches.filter(
                          (b) => b.id !== deleteBranch.id,
                        ),
                      },
                      "分支记录已删除",
                    )
                  ) {
                    setDeleteBranch(null);
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
      {releaseIds && (
        <Modal title="确认这些分支已经上线？" close={() => setReleaseIds(null)}>
          <div className="confirm-body">
            <p>
              请核对线上实际部署结果。本次将更新 {releaseIds.length}{" "}
              条分支记录。
            </p>
            <div className="release-review">
              {store.branches
                .filter((b) => releaseIds.includes(b.id))
                .map((b) => (
                  <div key={b.id}>
                    <span>
                      {store.projects.find((p) => p.id === b.projectId)?.name}
                    </span>
                    <strong>{b.name}</strong>
                    <p>{b.description}</p>
                    {(!b.tested || !b.mergedAt) && (
                      <small className="warning">
                        请核对：{!b.tested ? "尚未确认部署测试 " : ""}
                        {!b.mergedAt ? "尚未确认合入发布分支" : ""}
                      </small>
                    )}
                  </div>
                ))}
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setReleaseIds(null)}>
                再检查一下
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const timestamp = now();
                  if (
                    await commit(
                      {
                        ...store,
                        branches: store.branches.map((b) =>
                          releaseIds.includes(b.id)
                            ? {
                                ...b,
                                released: true,
                                releasedAt: timestamp,
                                updatedAt: timestamp,
                              }
                            : b,
                        ),
                      },
                      "已确认上线，记录已保留",
                    )
                  ) {
                    setReleaseIds(null);
                    setSelected([]);
                  }
                }}
              >
                <Check size={16} />
                确认已上线
              </button>
            </div>
          </div>
        </Modal>
      )}
      {rows && (
        <Modal title="预览 TXT 导入" close={() => setRows(null)} wide>
          <div className="import-body">
            <p>
              支持“[项目名]”或“项目：名称”分组，分支与说明用空格或制表符分隔。所有状态保持未确认。
            </p>
            <div className="import-rows">
              {rows.map((row, index) => (
                <div className="import-row" key={index}>
                  <input
                    type="checkbox"
                    checked={row.include}
                    aria-label={`导入第 ${index + 1} 行`}
                    onChange={(e) =>
                      setRows(
                        rows.map((r, i) =>
                          i === index ? { ...r, include: e.target.checked } : r,
                        ),
                      )
                    }
                  />
                  {(["project", "name", "description", "note"] as const).map(
                    (key) => (
                      <input
                        key={key}
                        value={row[key]}
                        aria-label={`第 ${index + 1} 行${{ project: "项目", name: "分支", description: "说明", note: "备注" }[key]}`}
                        placeholder={
                          {
                            project: "项目",
                            name: "分支名称",
                            description: "功能说明",
                            note: "备注",
                          }[key]
                        }
                        onChange={(e) =>
                          setRows(
                            rows.map((r, i) =>
                              i === index ? { ...r, [key]: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
            {!rows.length && (
              <p className="warning">文件中没有可导入的内容。</p>
            )}
            {importError && (
              <p role="alert" className="form-error">
                {importError}
              </p>
            )}
            <div className="modal-actions">
              <span className="field-hint">
                已选择 {rows.filter((r) => r.include).length} 条
              </span>
              <span className="spacer" />
              <button className="secondary" onClick={() => setRows(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !rows.length}
                onClick={confirmImport}
              >
                确认导入
              </button>
            </div>
          </div>
        </Modal>
      )}
      {restore && (
        <Modal title="从备份恢复工作空间" close={() => setRestore(null)}>
          <div className="confirm-body">
            <p>
              备份包含 <strong>{restore.projects.length}</strong> 个项目、
              <strong>{restore.branches.length}</strong> 条分支和{" "}
              <strong>{restore.batches.length}</strong> 个发布批次。
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
                      navigate({ kind: "all" });
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
