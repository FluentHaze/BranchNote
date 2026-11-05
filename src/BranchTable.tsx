import {
  Circle,
  CircleCheck,
  Copy,
  GitBranch,
  MoreHorizontal,
} from "lucide-react";
import { moveBranch, type Store, type Branch } from "./model";
import type { Editor } from "./EditorForm";
import Select from "./Select";

interface Props {
  store: Store;
  visible: Branch[];
  selected: string[];
  busy: boolean;
  setSelected(ids: string[]): void;
  setEditor(editor: Editor): void;
  navigate(view: { kind: "project"; id: string }): void;
  copy(text: string): Promise<void>;
  toggle(
    branch: Branch,
    field: "tested" | "mergedAt" | "released",
  ): Promise<void>;
  commit(store: Store): Promise<boolean>;
}
export default function BranchTable({
  store,
  visible,
  selected,
  busy,
  setSelected,
  setEditor,
  navigate,
  copy,
  toggle,
  commit,
}: Props) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="选择当前列表的全部未上线分支"
                checked={
                  visible.some((b) => !b.released) &&
                  visible
                    .filter((b) => !b.released)
                    .every((b) => selected.includes(b.id))
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? visible.filter((b) => !b.released).map((b) => b.id)
                      : [],
                  )
                }
              />
            </th>
            <th>分支与功能说明</th>
            <th>项目</th>
            <th>部署测试</th>
            <th>合入发布分支</th>
            <th>上线状态</th>
            <th>发布批次</th>
            <th className="action-cell">
              <span className="sr-only">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((branch) => {
            const p = store.projects.find((p) => p.id === branch.projectId)!;
            const b = store.batches.find((b) => b.id === branch.batchId);
            return (
              <tr
                key={branch.id}
                className={selected.includes(branch.id) ? "row-selected" : ""}
              >
                <td className="select-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${branch.name}`}
                    disabled={branch.released}
                    checked={selected.includes(branch.id) && !branch.released}
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
                      onClick={() =>
                        setEditor({
                          kind: "branch",
                          value: branch,
                        })
                      }
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
                  <p title={branch.description}>{branch.description}</p>
                </td>
                <td>
                  <button
                    className="project-pill"
                    onClick={() => navigate({ kind: "project", id: p.id })}
                  >
                    <span style={{ background: p.color }} />
                    {p.name}
                  </button>
                </td>
                <td>
                  <button
                    className={`status ${branch.tested ? "done" : ""}`}
                    disabled={busy}
                    aria-pressed={branch.tested}
                    onClick={() => toggle(branch, "tested")}
                    title="手动切换部署测试状态"
                  >
                    {branch.tested ? (
                      <CircleCheck size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {branch.tested ? "已部署测试" : "待部署测试"}
                  </button>
                </td>
                <td>
                  <button
                    className={`status ${branch.mergedAt ? "done" : ""}`}
                    disabled={busy || branch.released}
                    aria-pressed={!!branch.mergedAt}
                    onClick={() => toggle(branch, "mergedAt")}
                    title={
                      branch.mergedAt
                        ? `合入 ${b?.targets[p.id]} · ${new Date(branch.mergedAt).toLocaleString("zh-CN")}`
                        : "确认已合入当前目标发布分支"
                    }
                  >
                    {branch.mergedAt ? (
                      <CircleCheck size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {branch.mergedAt ? "已合入发布分支" : "待合并"}
                  </button>
                </td>
                <td>
                  <button
                    className={`status ${branch.released ? "done" : "release-status"}`}
                    disabled={busy}
                    aria-pressed={branch.released}
                    onClick={() => toggle(branch, "released")}
                    title={branch.released ? "点击撤销上线确认" : "确认上线"}
                  >
                    {branch.released ? (
                      <CircleCheck size={15} />
                    ) : (
                      <Circle size={15} />
                    )}
                    {branch.released ? "已上线" : "未上线"}
                  </button>
                </td>
                <td>
                  <Select
                    className="batch-select"
                    label={`${branch.name} 的发布批次`}
                    value={branch.batchId}
                    disabled={busy || branch.released}
                    onChange={(batchId) => {
                      void commit({
                        ...store,
                        branches: store.branches.map((item) =>
                          item.id === branch.id
                            ? moveBranch(item, batchId)
                            : item,
                        ),
                      });
                    }}
                    options={[
                      { value: "", label: "待安排" },
                      ...store.batches
                        .filter(
                          (item) =>
                            !item.completed || item.id === branch.batchId,
                        )
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                </td>
                <td className="action-cell">
                  <button
                    className="icon-button"
                    aria-label={`编辑 ${branch.name}`}
                    onClick={() => setEditor({ kind: "branch", value: branch })}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
