import { useEffect, useState } from "react";
import {
  Circle,
  CircleCheck,
  Copy,
  FlaskConical,
  GitBranch,
  GitMerge,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Store, Branch, Stage } from "./model";
import type { Editor } from "./EditorForm";

interface Props {
  store: Store;
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
        <table>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="选择当前列表的全部分支"
                checked={
                  visible.length > 0 &&
                  visible.every((b) => selected.includes(b.id))
                }
                onChange={(e) =>
                  setSelected(e.target.checked ? visible.map((b) => b.id) : [])
                }
              />
            </th>
            <th>分支与备注</th>
            <th>测试分支</th>
            <th>发布分支</th>
            <th className="action-cell">
              <span>操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((branch) => {
            const p = store.projects.find((p) => p.id === branch.projectId)!;
            const testTarget = branch.testTarget || p.testTarget || "";
            const releaseTarget = branch.releaseTarget || p.releaseTarget || "";
            return (
              <tr
                key={branch.id}
                className={selected.includes(branch.id) ? "row-selected" : ""}
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
                  <div className="branch-name">
                    <GitBranch size={15} />
                    <button
                      title={branch.name}
                      onClick={() => setEditor({ kind: "branch", value: branch })}
                    >
                      {branch.name}
                    </button>
                    <button
                      className="copy-button"
                      aria-label={`复制 ${branch.name}`}
                      onClick={() => copy(branch.name)}
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  {branch.description && (
                    <p className="branch-note" title={branch.description}>
                      {branch.description}
                    </p>
                  )}
                </td>
                <td>
                  <button
                    className={`status ${branch.testMergedAt ? "done" : ""}`}
                    disabled={busy}
                    aria-pressed={!!branch.testMergedAt}
                    onClick={() => void toggleMerged(branch, "test")}
                    title={
                      branch.testMergedAt
                        ? `已合入 ${testTarget || "测试分支"} · ${formatTime(branch.testMergedAt)}\n分支有新修改？点击重新标记为待合并（发布列会一起重置）`
                        : "点击手动标记为已合入测试分支"
                    }
                  >
                    {branch.testMergedAt ? (
                      <CircleCheck size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {branch.testMergedAt ? "已合并" : "未合并"}
                  </button>
                  {branch.testMergedAt && testTarget && (
                    <span className="status-target" title={testTarget}>
                      {testTarget}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    className={`status ${branch.releaseMergedAt ? "done" : ""}`}
                    disabled={busy}
                    aria-pressed={!!branch.releaseMergedAt}
                    onClick={() => void toggleMerged(branch, "release")}
                    title={
                      branch.releaseMergedAt
                        ? `已合入 ${releaseTarget || "发布分支"} · ${formatTime(branch.releaseMergedAt)}\n分支有新修改？点击重新标记为待合并`
                        : "点「提交发布」后会写回这里；也可以直接点这里手动标记"
                    }
                  >
                    {branch.releaseMergedAt ? (
                      <CircleCheck size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {branch.releaseMergedAt ? "已合并" : "未合并"}
                  </button>
                  {branch.releaseMergedAt && releaseTarget && (
                    <span className="status-target" title={releaseTarget}>
                      {releaseTarget}
                    </span>
                  )}
                </td>
                <td className="action-cell">
                  <div className="row-actions">
                    <button
                      className="action-pill test"
                      aria-label={`提交 ${branch.name} 到测试分支`}
                      title={`合并到 ${testTarget || "测试分支"}${branch.testMergedAt ? "（分支有新修改时可再提交一次）" : ""}`}
                      disabled={busy}
                      onClick={() => submit([branch.id], "test")}
                    >
                      <FlaskConical size={14} />
                      提交测试
                    </button>
                    <button
                      className="action-pill release"
                      aria-label={`提交 ${branch.name} 到发布分支`}
                      title={`合并到 ${releaseTarget || "发布分支"}${branch.releaseMergedAt ? "（分支有新修改时可再提交一次）" : ""}`}
                      disabled={busy}
                      onClick={() => submit([branch.id], "release")}
                    >
                      <GitMerge size={14} />
                      提交发布
                    </button>
                    <div className="row-more">
                      <button
                        className="icon-button"
                        aria-label={`更多操作 ${branch.name}`}
                        aria-haspopup="menu"
                        aria-expanded={menu?.branch.id === branch.id}
                        title="更多：编辑备注 / 删除记录"
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
