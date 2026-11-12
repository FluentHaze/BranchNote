import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { id, now, projectTargets, type Branch, type Project, type Store } from "./model";
import Modal from "./Modal";
import Select from "./Select";
import RepositoryPicker from "./RepositoryPicker";
import TargetBar from "./TargetBar";

export type Editor =
  | { kind: "branch"; value?: Branch }
  | { kind: "project"; value?: Project };
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
  const [targets, setTargets] = useState(() => editor.kind === "project" && editor.value ? projectTargets(editor.value) : []);
  const [repositoryPath, setRepositoryPath] = useState(editor.kind === "project" ? editor.value?.repositoryPath : undefined);
  const draftProject: Project = {id: value?.id || "project-draft", name: value?.name || "新项目", note: "", archived: false, repositoryPath, targets};
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
            b.id !== value?.id,
        )
      ) {
        setError("该项目已有同名分支，请先检查现有记录");
        return;
      }
      const timestamp = now();
      const previous = editor.value;
      const branch: Branch = {
        ...(previous || {
          id: id(),
          // 合并状态由「提交到测试/发布分支」写入，手工新建时都是待合并
          testMergedAt: null,
          releaseMergedAt: null,
          createdAt: timestamp,
        }),
        projectId,
        name,
        description,
        note: text("note"),
        stages: previous?.projectId === projectId ? previous.stages : undefined,
        updatedAt: timestamp,
        // 换项目后原来的合并记录不再成立
        testMergedAt:
          previous && previous.projectId === projectId
            ? previous.testMergedAt
            : null,
        releaseMergedAt:
          previous && previous.projectId === projectId
            ? previous.releaseMergedAt
            : null,
      };
      next = {
        ...store,
        branches: previous
          ? store.branches.map((b) => (b.id === previous.id ? branch : b))
          : [...store.branches, branch],
      };
    } else {
      const current = editor.kind === "project" ? editor.value : undefined;
      if (store.projects.some((p) => p.name === name && p.id !== current?.id)) {
        setError("项目名称已存在");
        return;
      }
      const project: Project = {
        id: current?.id || id(),
        name,
        note: text("note"),
        archived: current?.archived || false,
        repositoryPath: text("repositoryPath") || undefined,
        targets,
        testTarget: current?.testTarget,
        releaseTarget: current?.releaseTarget,
      };
      next = {
        ...store,
        projects: current
          ? store.projects.map((p) => (p.id === current.id ? project : p))
          : [...store.projects, project],
      };
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
      title={`${value ? "编辑" : "新建"}${editor.kind === "branch" ? "分支记录" : "项目"}`}
      close={close}
    >
      <form onSubmit={onSubmit} className={`form ${editor.kind === "project" ? "project-editor-form" : ""}`}>
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
              options={store.projects
                .filter((p) => !p.archived || p.id === editor.value?.projectId)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.archived ? "（已归档）" : ""}`,
                }))}
            />
          </label>
        )}
        {editor.kind === "project" && editor.value && (
          <div className="project-editor-overview">
            <strong>{store.branches.filter(branch => branch.projectId === editor.value?.id).length} 个功能分支</strong>
            <span>管理项目资料、关联仓库与合并目标</span>
          </div>
        )}
        <label>
          {editor.kind === "branch" ? "分支名称" : "项目名称"}
          <input
            name="name"
            autoFocus
            required
            maxLength={200}
            defaultValue={value?.name}
            placeholder={
              editor.kind === "branch" ? "输入分支名称" : "输入项目名称"
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
                placeholder="填写分支的改动内容"
              />
            </label>
            {(editor.value?.testMergedAt || editor.value?.releaseMergedAt) && (
              <p className="field-hint">
                这个分支已经合并过
                {editor.value?.releaseTarget || editor.value?.testTarget || "目标分支"}
                ，改项目后需要重新合并。
              </p>
            )}
          </>
        )}
        {editor.kind === "project" && (
          <RepositoryPicker initialPath={editor.value?.repositoryPath} onPathChange={setRepositoryPath} />
        )}
        {editor.kind === "project" && (
          <section className="project-editor-targets" aria-label="项目合并目标">
            <TargetBar project={draftProject} store={{...store, projects: [draftProject]}}
              commit={async next => { setTargets(next.projects[0].targets || []); return true; }} />
            <p className="field-hint">配置测试、发布等阶段的远程分支，保存项目后生效。</p>
          </section>
        )}
        <label>
          <span className="form-label-inline">
          {editor.kind === "branch" ? "改动备注" : "备注"}
            <span className="optional">选填</span>
          </span>
          <textarea
            name="note"
            rows={3}
            defaultValue={value?.note}
            placeholder={editor.kind === "branch" ? "说明本次改了什么，会直接显示在功能分支列表中" : "填写项目说明或需要记录的信息"}
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
