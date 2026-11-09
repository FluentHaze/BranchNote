import { useEffect, useState } from "react";
import {
  Circle,
  CircleCheck,
  Copy,
  GitBranch,
  GitPullRequest,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { targetState, type Store, type Branch, type Stage, type MRTarget } from "./model";
import type { CSSProperties } from "react";
import type { Editor } from "./EditorForm";

interface Props {
  store: Store;
  targets: MRTarget[];
  visible: Branch[];
  selected: string[];
  busy: boolean;
  setSelected(ids: string[]): void;
  setEditor(editor: Editor): void;
  copy(text: string): Promise<void>;
  submit(branchIds: string[], stage: Stage): void;
  toggleMerged(branch: Branch, stage: Stage): Promise<void>;
  remove(branch: Branch): void;
}
const formatTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function BranchTable({
  store,
  targets,
  visible,
  selected,
  busy,
  setSelected,
  setEditor,
  copy,
  submit,
  toggleMerged,
  remove,
}: Props) {
  const manyTargets = targets.length > 2;
  const TargetCell = manyTargets ? "div" : "td";
  // 「更多」菜单：用视口坐标固定定位，避免被表格的滚动容器裁切
  const [menu, setMenu] = useState<{
    branch: Branch;
    top: number;
    right: number;
  } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  return (
    <>
      <div className="table-scroll">
        <table className={manyTargets ? "many-targets" : undefined}>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="选择当前列表的全部分支"
                disabled={busy}
                ref={input => {
                  if (input) input.indeterminate = visible.some(branch => selected.includes(branch.id)) &&
                    !visible.every(branch => selected.includes(branch.id));
                }}
                checked={
                  visible.length > 0 &&
                  visible.every((b) => selected.includes(b.id))
                }
                onChange={(e) =>
                  setSelected(e.target.checked ? visible.map((b) => b.id) : [])
                }
              />
            </th>
            <th>功能与分支</th>
            {manyTargets ? <th className="targets-summary-heading">合并目标</th> : targets.map(target => (
              <th className="target-status-cell" key={target.id}>
                <span
                  className="target-status-heading"
                  style={{"--target-color": target.color, "--target-tint": target.color + "12"} as CSSProperties}
                  title={target.branch}
                >
                  {target.name}
                </span>
              </th>
            ))}
            <th className="action-cell">
              <span className="sr-only">更多操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((branch) => {
            const toggle = () => setSelected(selected.includes(branch.id) ? selected.filter(value => value !== branch.id) : [...selected, branch.id]);
            const statuses = targets.map(target => {
                  const state = targetState(branch, target.id);
                  const destination = state.target || target.branch;
                  return (
                    <TargetCell className="target-status-cell" key={target.id}>
                      {manyTargets && (
                        <span className="target-status-heading" style={{"--target-color": target.color, "--target-tint": target.color + "12"} as CSSProperties} title={target.branch}>{target.name}</span>
                      )}
                      <button
                        className={"status " + (state.mergedAt ? "done" : state.mr && state.mr.state !== "closed" ? "pending" : "")}
                        disabled={busy}
                        aria-pressed={!!state.mergedAt}
                        onClick={() => void toggleMerged(branch, target.id)}
                        title={state.mergedAt
                          ? "已合入 " + destination + " · " + formatTime(state.mergedAt) + "\n点击重新标记为待提交"
                          : "MR 状态自动同步；也可点击手动确认已合入" + target.name}
                      >
                        {state.mergedAt ? <CircleCheck size={15} /> : <Circle size={15} />}
                        {state.mergedAt ? "已合并" : state.mr?.state === "closed" ? "MR 已关闭" : state.mr ? "MR 待合并" : "待提交"}
                      </button>
                      {state.mr && (
                        <button className="mr-link" onClick={() => void window.branchNote?.openUrl(state.mr!.url)}>
                          打开 MR {state.mr.number && "#" + state.mr.number}
                        </button>
                      )}
                      {state.mergedAt && destination && (
                        <span className="status-target" title={destination}>{destination}</span>
                      )}
                    </TargetCell>
                  );
                });
            return (
              <tr
                key={branch.id}
                className={selected.includes(branch.id) ? "row-selected" : ""}
                tabIndex={busy ? -1 : 0}
                aria-selected={selected.includes(branch.id)}
                onClick={event => {
                  if (!busy && !(event.target as HTMLElement).closest("button, input, a, label")) toggle();
                }}
                onKeyDown={event => {
                  if (event.target === event.currentTarget && !busy && (event.key === " " || event.key === "Enter")) {
                    event.preventDefault();
                    toggle();
                  }
                }}
              >
                <td className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${branch.name}`}
                    checked={selected.includes(branch.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, branch.id]
                          : selected.filter((value) => value !== branch.id),
                      )
                    }
                  />
                </td>
                <td className="branch-cell">
                  <span
                    className="feature-title"
                    title={branch.description || branch.name}
                  >
                    {branch.description || branch.name}
                  </span>
                  <div className="branch-name">
                    <GitBranch size={15} />
                    <code className="branch-code" title={branch.name}>{branch.name}</code>
                    <button
                      className="copy-button"
                      aria-label={`复制 ${branch.name}`}
                      onClick={() => copy(branch.name)}
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  {branch.note && (
                    <p className="branch-change-note">{branch.note}</p>
                  )}
                </td>
                {manyTargets ? <td className="targets-summary"><div className="target-status-grid">{statuses}</div></td> : statuses}
                <td className="action-cell">
                  <div className="row-actions">
                    <div className="row-more">
                      <button
                        className="icon-button"
                        aria-label={`更多操作 ${branch.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menu?.branch.id === branch.id}
                        title="提交 MR、编辑备注或删除记录"
                        onClick={(event) => {
                          if (menu?.branch.id === branch.id) {
                            setMenu(null);
                            return;
                          }
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          setMenu({
                            branch,
                            top: rect.bottom + 6,
                            right: window.innerWidth - rect.right,
                          });
                        }}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div
            className="row-menu"
            role="menu"
            style={{ top: menu.top, right: menu.right }}
          >
            {targets.map(target => (
              <button
                key={target.id}
                role="menuitem"
                disabled={busy}
                className="target-menu-item"
                style={{"--target-color": target.color, "--target-tint": target.color + "12"} as CSSProperties}
                onClick={() => { submit([menu.branch.id], target.id); setMenu(null); }}
              >
                <GitPullRequest size={14} />
                {"提交" + target.name}
              </button>
            ))}
            <button
              role="menuitem"
              onClick={() => {
                setEditor({ kind: "branch", value: menu.branch });
                setMenu(null);
              }}
            >
              <Pencil size={14} />
              编辑备注
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                remove(menu.branch);
                setMenu(null);
              }}
            >
              <Trash2 size={14} />
              删除记录
            </button>
          </div>
        </>
      )}
    </>
  );
}
