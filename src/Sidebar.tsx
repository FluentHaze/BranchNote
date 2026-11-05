import {
  CircleCheck,
  Folder,
  GitBranch,
  History,
  Inbox,
  Layers3,
  Plus,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { Store } from "./model";
import type { Editor } from "./EditorForm";
import { version } from "../package.json";
export type View =
  | { kind: "all" | "history" | "projects" | "settings" }
  | { kind: "project" | "batch"; id: string };
interface Props {
  store: Store;
  view: View;
  navigate(view: View): void;
  setEditor(editor: Editor): void;
}
export default function Sidebar({ store, view, navigate, setEditor }: Props) {
  const pending = store.branches.filter((b) => !b.released);
  const activeBatches = store.batches.filter((b) => !b.completed);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">
          <GitBranch size={24} strokeWidth={2.2} />
        </div>
        <span>
          BranchNote<small>每个分支，都有着落。</small>
        </span>
      </div>
      <div className="workspace-label">
        我的工作空间 <span>本地</span>
      </div>
      <nav aria-label="主导航">
        <button
          className={`nav-item ${view.kind === "all" ? "active" : ""}`}
          onClick={() => navigate({ kind: "all" })}
        >
          <Inbox size={18} />
          全部未上线 <span className="count">{pending.length}</span>
        </button>
        <button
          className={`nav-item ${view.kind === "history" ? "active" : ""}`}
          onClick={() => navigate({ kind: "history" })}
        >
          <History size={18} />
          上线历史{" "}
          <span className="count">
            {store.branches.filter((b) => b.released).length || ""}
          </span>
        </button>
        <div className="nav-section">
          <button onClick={() => navigate({ kind: "projects" })}>项目</button>
          <button
            aria-label="新建项目"
            onClick={() => setEditor({ kind: "project" })}
          >
            <Plus size={15} />
          </button>
        </div>
        {store.projects
          .filter((p) => !p.archived)
          .map((p) => (
            <button
              key={p.id}
              className={`nav-item ${view.kind === "project" && view.id === p.id ? "active" : ""}`}
              onClick={() => navigate({ kind: "project", id: p.id })}
            >
              <Folder size={17} style={{ color: p.color }} />
              {p.name}
              <span className="count">
                {pending.filter((b) => b.projectId === p.id).length || ""}
              </span>
            </button>
          ))}
        {!store.projects.length && (
          <p className="nav-empty">把你的第一个项目放在这里</p>
        )}
        <div className="nav-section">
          <span>发布批次</span>
          <button
            aria-label="新建发布批次"
            onClick={() => setEditor({ kind: "batch" })}
          >
            <Plus size={15} />
          </button>
        </div>
        {activeBatches.map((b) => (
          <button
            key={b.id}
            className={`nav-item ${view.kind === "batch" && view.id === b.id ? "active" : ""}`}
            onClick={() => navigate({ kind: "batch", id: b.id })}
          >
            <Layers3 size={18} />
            <span className="nav-name">{b.name}</span>
            <span className="batch-dot" />
          </button>
        ))}
        {store.batches
          .filter((b) => b.completed)
          .map((b) => (
            <button
              key={b.id}
              className={`nav-item ${view.kind === "batch" && view.id === b.id ? "active" : ""}`}
              onClick={() => navigate({ kind: "batch", id: b.id })}
            >
              <CircleCheck size={18} />
              <span className="nav-name">{b.name}</span>
            </button>
          ))}
        {!store.batches.length && (
          <button
            className="nav-add"
            onClick={() => setEditor({ kind: "batch" })}
          >
            <Plus size={14} />
            安排一次发布
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="local-card">
          <ShieldCheck size={18} />
          <div>
            只在你的设备上<small>无需登录，离线也能安心记录</small>
          </div>
        </div>
        <button
          className={`nav-item ${view.kind === "settings" ? "active" : ""}`}
          onClick={() => navigate({ kind: "settings" })}
        >
          <Settings2 size={18} />
          数据与设置<span className="version">v{version}</span>
        </button>
      </div>
    </aside>
  );
}
