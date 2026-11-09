import {
  Folder,
  Plus,
  Settings2,
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
          <img src="./logo.svg" alt="" width="42" height="42" />
        </div>
        <span>
          BranchNote

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
        <button
          className={`nav-item ${view.kind === "settings" ? "active" : ""}`}
          onClick={() => navigate({ kind: "settings" })}
        >
          <Settings2 size={18} />
          设置与令牌<span className="version">v{version}</span>
        </button>
      </div>
    </aside>
  );
}
