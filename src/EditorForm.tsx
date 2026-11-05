import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import {
  id,
  now,
  updateTarget,
  type Batch,
  type Branch,
  type Project,
  type Store,
} from "./model";
import Modal from "./Modal";
import Select from "./Select";
import RepositoryPicker from "./RepositoryPicker";

const colors = [
  "#007aff",
  "#af52de",
  "#e58b20",
  "#299765",
  "#e65a66",
  "#64748b",
];

export type Editor =
  | { kind: "branch"; value?: Branch }
  | { kind: "project"; value?: Project }
  | { kind: "batch"; value?: Batch };
export default function EditorForm({
  editor,
  store,
  submit,
  close,
  remove,
}: {
  editor: Editor;
  store: Store;
  submit(store: Store): Promise<boolean>;
  close(): void;
  remove?(branch: Branch): void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const value = editor.value;
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) || "").trim();
    const name = text("name");
    if (!name) {
      setError("请填写名称");
      return;
    }
    let next = store;
    if (editor.kind === "branch") {
      const projectId = text("projectId");
      const description = text("description");
      if (!projectId || !description) {
        setError("请选择项目并填写功能说明");
        return;
      }
      if (
        store.branches.some(
          (b) =>
            b.projectId === projectId &&
            b.name === name &&
            !b.released &&
            b.id !== value?.id,
        )
      ) {
        setError("该项目已有同名未上线分支，请先检查现有记录");
        return;
      }
      const timestamp = now();
      const previous = editor.value;
      const branch: Branch = {
        ...(previous || {
          id: id(),
          tested: false,
          released: false,
          releasedAt: null,
          createdAt: timestamp,
        }),
        projectId,
        name,
        description,
        note: text("note"),
        batchId: text("batchId"),
        updatedAt: timestamp,
        mergedAt:
          previous &&
          previous.projectId === projectId &&
          previous.batchId === text("batchId")
            ? previous.mergedAt
            : null,
      };
      next = {
        ...store,
        branches: previous
          ? store.branches.map((b) => (b.id === previous.id ? branch : b))
          : [...store.branches, branch],
      };
    } else if (editor.kind === "project") {
      if (store.projects.some((p) => p.name === name && p.id !== value?.id)) {
        setError("项目名称已存在");
        return;
      }
      const project: Project = {
        id: value?.id || id(),
        name,
        note: text("note"),
        color: text("color"),
        archived: editor.value?.archived || false,
        repositoryPath: text("repositoryPath") || undefined,
      };
      next = {
        ...store,
        projects: value
          ? store.projects.map((p) => (p.id === value.id ? project : p))
          : [...store.projects, project],
      };
    } else {
      const batch: Batch = {
        id: value?.id || id(),
        name,
        date: text("date"),
        note: text("note"),
        completed: editor.value?.completed || false,
        targets: editor.value?.targets || {},
      };
      next = {
        ...store,
        batches: value
          ? store.batches.map((b) => (b.id === value.id ? batch : b))
          : [...store.batches, batch],
      };
      for (const project of store.projects)
        next = updateTarget(
          next,
          batch.id,
          project.id,
          text(`target-${project.id}`),
        );
    }
    setBusy(true);
    if (await submit(next)) close();
    else {
      setError("保存失败，请检查磁盘空间或存储权限后重试。输入已保留。");
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${value ? "编辑" : "新建"}${editor.kind === "branch" ? "分支记录" : editor.kind === "project" ? "项目" : "发布批次"}`}
      close={close}
    >
      <form onSubmit={onSubmit} className="form">
        {editor.kind === "branch" && (
          <label>
            所属项目
            <Select
              label="所属项目"
              name="projectId"
              defaultValue={
                editor.value?.projectId ||
                store.projects.find((p) => !p.archived)?.id
              }
              disabled={editor.value?.released}
              options={store.projects
                .filter((p) => !p.archived || p.id === editor.value?.projectId)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.archived ? "（已归档）" : ""}`,
                }))}
            />
          </label>
        )}
        <label>
          {editor.kind === "branch"
            ? "分支名称"
            : editor.kind === "project"
              ? "项目名称"
              : "批次名称"}
          <input
            name="name"
            autoFocus
            required
            maxLength={200}
            defaultValue={value?.name}
            placeholder={
              editor.kind === "branch"
                ? "feature/your-next-idea"
                : editor.kind === "project"
                  ? "例如：主项目"
                  : "例如：第 46 周发布"
            }
          />
        </label>
        {editor.kind === "branch" && (
          <>
            <label>
              功能说明
              <input
                name="description"
                required
                maxLength={500}
                defaultValue={editor.value?.description}
                placeholder="这个分支实现了什么？"
              />
            </label>
            <label>
              计划发布批次
              <Select
                label="计划发布批次"
                name="batchId"
                defaultValue={editor.value?.batchId || ""}
                disabled={editor.value?.released}
                options={[
                  { value: "", label: "待安排" },
                  ...store.batches
                    .filter(
                      (b) => !b.completed || b.id === editor.value?.batchId,
                    )
                    .map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
            </label>
            {editor.value?.mergedAt && (
              <p className="field-hint">
                更改项目或发布批次后，需要重新确认合入发布分支。
              </p>
            )}
          </>
        )}
        {editor.kind === "project" && (
          <RepositoryPicker initialPath={editor.value?.repositoryPath} />
        )}
        {editor.kind === "project" && (
          <fieldset className="color-picker">
            <legend>项目颜色</legend>
            {colors.map((color) => (
              <label
                key={color}
                style={{ "--project-color": color } as React.CSSProperties}
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={(editor.value?.color || colors[0]) === color}
                  aria-label={`颜色 ${color}`}
                />
                <span />
              </label>
            ))}
          </fieldset>
        )}
        {editor.kind === "batch" && (
          <>
            <label>
              计划发布日期
              <input
                type="date"
                name="date"
                defaultValue={editor.value?.date}
              />
            </label>
            <div className="target-fields">
              <h3>各项目的发布分支</h3>
              <p className="field-hint">
                调整目标分支后，未上线记录需要重新确认合并。
              </p>
              {store.projects
                .filter((p) => !p.archived || editor.value?.targets[p.id])
                .map((p) => (
                  <label key={p.id}>
                    {p.name}
                    <input
                      name={`target-${p.id}`}
                      defaultValue={editor.value?.targets[p.id] || ""}
                      placeholder="例如：release/week-46"
                    />
                  </label>
                ))}
            </div>
          </>
        )}
        <label>
          备注 <span className="optional">选填</span>
          <textarea
            name="note"
            rows={3}
            defaultValue={value?.note}
            placeholder="留下一点需要记住的事…"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {editor.kind === "branch" && editor.value && (
            <button
              type="button"
              className="danger ghost"
              onClick={() => remove?.(editor.value!)}
            >
              <Trash2 size={15} />
              删除记录
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="secondary" onClick={close}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
