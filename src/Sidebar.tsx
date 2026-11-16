import {
  Folder,
  Plus,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { projectName, type Store } from "./model";
import type { Editor } from "./EditorForm";
import { version } from "../package.json";
import AppUpdate from "./AppUpdate";
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
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("branchnote-sidebar-width"));
      return saved >= 200 && saved <= 360 ? saved : 224;
    } catch { return 224; }
  });
  const drag = useRef<{x: number; width: number} | null>(null);
  function saveWidth(value: number) {
    try { localStorage.setItem("branchnote-sidebar-width", String(value)); } catch { /* 当前会话仍可调整宽度 */ }
  }
  const [providers, setProviders] = useState<Record<string, "gitlab" | "github" | "other">>({});
  const providerCache = useRef(new Map<string, Promise<"gitlab" | "github" | "other">>());
  useEffect(() => {
    const api = window.branchNote;
    if (!api) return;
    let active = true;
    Promise.all(store.projects.map(async project => {
      const path = project.repositoryPath;
      if (!path) return [project.id, "other"] as const;
      let pending = providerCache.current.get(path);
      if (!pending) {
        pending = api.requestProvider(path, "").catch(() => "other" as const);
        providerCache.current.set(path, pending);
      }
      return [project.id, await pending] as const;
    })).then(entries => { if (active) setProviders(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [store.projects]);
  return (
    <aside className="sidebar" style={{width}}>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={200}
        aria-valuemax={360}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = {x: event.clientX, width};
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current) setWidth(Math.min(360, Math.max(200, drag.current.width + event.clientX - drag.current.x)));
        }}
        onPointerUp={() => { if (drag.current) saveWidth(width); drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 200 : event.key === "End" ? 360 : Math.min(360, Math.max(200, width + (event.key === "ArrowRight" ? 10 : -10)));
          setWidth(next);
          saveWidth(next);
        }}
      />
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
        {store.projects.map((p) => {
          const folderName = projectName(p);
          return (
            <button
              key={p.id}
              className={`nav-item project-nav-item ${view.kind === "project" && view.id === p.id ? "active" : ""} ${p.archived ? "archived" : ""}`}
              onClick={() => navigate({ kind: "project", id: p.id })}
            >
              <span className="project-provider-icon">
                {providers[p.id] === "github" ? (
                  <img src="./brands/github.svg" width="18" height="18" alt="GitHub 仓库" />
                ) : providers[p.id] === "gitlab" ? (
                  <img src="./brands/gitlab.svg" width="20" height="20" alt="GitLab 仓库" />
                ) : (
                  <Folder size={16} aria-label="本地项目" />
                )}
              </span>
              <span className="project-nav-text">
                <span className="nav-name" title={folderName}>
                  {folderName}
                  {p.archived ? "（已归档）" : ""}
                </span>
                {p.note && (
                  <span className="project-nav-note" title={p.note}>
                    {p.note}
                  </span>
                )}
              </span>
              <span className="count">
                {store.branches.filter((b) => b.projectId === p.id).length || ""}
              </span>
            </button>
          );
        })}
        {!store.projects.length && (
          <p className="nav-empty">把你的第一个项目放在这里</p>
        )}
      </nav>
      <div className="sidebar-bottom">
        <AppUpdate compact onOpen={() => navigate({ kind: "settings" })} />
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
