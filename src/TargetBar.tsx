import { useEffect, useState, type CSSProperties } from "react";
import { GitPullRequest, Pencil, Plus, Trash2 } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import { id, projectTargets, type MRTarget, type Project, type Store } from "./model";

const colors = ["#4263dc", "#2b8b83", "#8b5bb5", "#bd7833", "#b85475", "#66758d"];
export default function TargetBar({ project, store, commit }: {
  project: Project;
  store: Store;
  commit(next: Store, message?: string): Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<{value: string; label: string}[]>([]);
  const [targets, setTargets] = useState<MRTarget[]>(() => projectTargets(project));
  useEffect(() => {
    if (!editing || !project.repositoryPath || !window.branchNote) return;
    let active = true;
    setBusy(true);
    window.branchNote.readRepository(project.repositoryPath).then(repo => {
      if (active) setOptions([...new Set(repo.branches.flatMap(branch =>
        branch.remoteRefs?.length ? branch.remoteRefs : branch.remoteRef ? [branch.remoteRef] : []
      ))].map(value => ({value, label: value})));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "读取失败"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [editing, project.repositoryPath]);
  function update(key: string, change: Partial<MRTarget>) {
    setTargets(current => current.map(target => target.id === key ? {...target, ...change} : target));
  }
  async function save() {
    const next = targets.map(target => ({...target, name: target.name.trim()}));
    if (next.some(target => !target.name || !target.branch)) {
      setError("请填写每个目标的名称和远程分支");
      return;
    }
    if (new Set(next.map(target => target.name)).size !== next.length) {
      setError("目标名称不能重复，请使用不同名称");
      return;
    }
    setBusy(true);
    const ok = await commit({...store, projects: store.projects.map(item =>
      item.id === project.id ? {...item, targets: next} : item
    )}, "MR 目标已更新");
    setBusy(false);
    if (ok) setEditing(false);
  }
  function open() {
    setTargets(projectTargets(project));
    setError("");
    setEditing(true);
  }
  return (
    <>
      <div className="target-bar" aria-label="MR 目标分支">
        <span className="target-bar-caption">MR 目标</span>
        {!projectTargets(project).length && <span className="target-bar-caption">尚未配置，点击 ＋ 添加目标</span>}
        {projectTargets(project).map(target => (
          <button
            key={target.id}
            className="target-chip custom"
            style={{"--target-color": target.color, "--target-tint": target.color + "12"} as CSSProperties}
            title={target.name + " · " + (target.branch || "选择目标分支")}
            onClick={open}
          >
            <GitPullRequest size={15} />
            <span className="target-chip-name">{target.name}</span>
            <Pencil size={12} />
          </button>
        ))}
        <button className="icon-button" aria-label="管理 MR 目标" title="添加、改名或删除 MR 目标" onClick={open}>
          <Plus size={16} />
        </button>
      </div>
      {editing && (
        <Modal title="设置 MR 目标" close={() => { if (!busy) setEditing(false); }} wide>
          <div className="target-form">
            <p className="picker-note">为每个合并目标设置名称、颜色和远程分支，MR 与合并状态分别记录。</p>
            {!project.repositoryPath && (
              <p className="warning-panel">请先关联项目仓库。</p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="target-config-head" aria-hidden="true">
              <span>颜色</span>
              <span>目标名称</span>
              <span>远程分支</span>
              <span />
            </div>
            <div className="target-config-list">
              {!targets.length && <p className="target-config-empty">尚未添加合并目标</p>}
              {targets.map((target, index) => (
                <div className="target-config-row" key={target.id}>
                  <label className="target-color-field">
                    <span className="sr-only">颜色</span>
                    <input
                      type="color"
                      aria-label={target.name + "目标颜色"}
                      value={target.color}
                      disabled={busy}
                      onChange={event => update(target.id, {color: event.target.value})}
                    />
                  </label>
                  <label className="host-field target-name-field">
                    <span className="sr-only">目标名称</span>
                    <input
                      aria-label={"目标名称 " + (index + 1)}
                      value={target.name}
                      maxLength={24}
                      placeholder="输入目标名称"
                      disabled={busy}
                      onChange={event => update(target.id, {name: event.target.value})}
                    />
                  </label>
                  <label className="host-field target-branch-field">
                    <span className="sr-only">远程分支</span>
                    <Select
                      searchable
                      label={target.name + " MR 目标"}
                      value={target.branch}
                      options={options}
                      disabled={busy || !options.length}
                      onChange={value => update(target.id, {branch: value})}
                    />
                  </label>
                  <button
                    className="icon-button danger"
                    aria-label={"删除目标 " + target.name}
                    title="仅移除配置，仓库分支与历史记录保留"
                    disabled={busy}
                    onClick={() => setTargets(current => current.filter(item => item.id !== target.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="target-config-footer">
            <button
              className="secondary add-target"
              disabled={busy}
              onClick={() => setTargets(current => [...current, {
                id: id(), name: "", branch: "", color: colors.find(color => !current.some(target => target.color === color)) || colors[current.length % colors.length],
              }])}
            >
              <Plus size={15} />
              添加目标
            </button>
            <div className="modal-actions">
              <button className="secondary" disabled={busy} onClick={() => setEditing(false)}>取消</button>
              <button className="primary" disabled={busy || (targets.length > 0 && !options.length)} onClick={() => void save()}>保存目标</button>
            </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
