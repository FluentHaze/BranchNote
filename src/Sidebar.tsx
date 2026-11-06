import {
  Folder,
  GitBranch,
  Plus,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { Store } from "./model";
import type { Editor } from "./EditorForm";
import { version } from "../package.json";
export type View =
  | { kind: "settings" }
  | { kind: "project"; id: string };
interface Props {
  store: Store;
  view: View;
  navigate(view: View): void;
  setEditor(editor: Editor): void;
}
export default function Sidebar({ store, view, navigate, setEditor }: Props) {
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
      <nav aria-label="主导航">
        <div className="nav-section">
          <span>项目</span>
          <button
            aria-label="新建项目"
            onClick={() => setEditor({ kind: "project" })}
          >
            <Plus size={15} />
          </button>
        </div>
        {store.projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${view.kind === "project" && view.id === p.id ? "active" : ""} ${p.archived ? "archived" : ""}`}
            onClick={() => navigate({ kind: "project", id: p.id })}
          >
            <Folder size={17} style={{ color: p.color }} />
            <span className="nav-name">
              {p.name}
              {p.archived ? "（已归档）" : ""}
            </span>
            <span className="count">
              {store.branches.filter((b) => b.projectId === p.id).length || ""}
            </span>
          </button>
        ))}
        {!store.projects.length && (
          <p className="nav-empty">把你的第一个项目放在这里</p>
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
