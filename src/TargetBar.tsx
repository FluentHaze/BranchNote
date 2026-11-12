import { useEffect, useState, type CSSProperties } from "react";
import { GitPullRequest, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import { id, projectTargets, type MRTarget, type Project, type Store } from "./model";

const colors = ["#4263dc", "#2b8b83", "#8b5bb5", "#bd7833", "#b85475", "#66758d"];
export default function TargetBar({ project, store, commit }: {
  project: Project;
  store: Store;
  commit(next: Store, message?: string): Promise<boolean>;
}) {
  const {repositoryPath} = project;
  const [editing, setEditing] = useState(false);
  const [operation, setOperation] = useState<"read" | "refresh" | "save" | null>(null);
  const busy = operation !== null;
  const [refreshRequest, setRefreshRequest] = useState<{path: string} | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [options, setOptions] = useState<{value: string; label: string}[]>([]);
  const [targets, setTargets] = useState<MRTarget[]>(() => projectTargets(project));
  useEffect(() => {
    const path = project.repositoryPath;
    const api = window.branchNote;
    if (!editing || !path || !api) {
      setOptions([]);
      setOperation(null);
      return;
    }
    let active = true;
    const refreshing = refreshRequest?.path === path;
    setOperation(refreshing ? "refresh" : "read");
    setError("");
    setNotice("");
    if (!refreshing) setOptions([]);
    const request = refreshing
      ? api.fetchRepository(path).then(({repository, errors}) => {
        if (active) {
          if (errors.length) setError("部分远程更新失败：" + errors.join("；"));
          else setNotice("远程分支已更新");
        }
        return repository;
      })
      : api.readRepository(path);
    request.then(repo => {
      if (active) setOptions([...new Set(repo.branches.flatMap(branch =>
        branch.remoteRefs?.length ? branch.remoteRefs : branch.remoteRef ? [branch.remoteRef] : []
      ))].map(value => ({value, label: value})));
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : refreshing ? "更新远程分支失败" : "读取失败");
    }).finally(() => { if (active) setOperation(null); });
    return () => { active = false; };
  }, [editing, project.repositoryPath, refreshRequest]);
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
    setOperation("save");
    const ok = await commit({...store, projects: store.projects.map(item =>
      item.id === project.id ? {...item, targets: next} : item
    )}, "合并请求 目标已更新");
    setOperation(null);
    if (ok) setEditing(false);
  }
  function open() {
    setTargets(projectTargets(project));
    setError("");
    setNotice("");
    setRefreshRequest(null);
    setEditing(true);
  }
  return (
    <>
      <div className="target-bar" aria-label="合并请求 目标分支">
        <span className="target-bar-caption">合并请求 目标</span>
        {!projectTargets(project).length && <span className="target-bar-caption">尚未配置，点击 ＋ 添加目标</span>}
        {projectTargets(project).map(target => (
          <button type="button"
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
        <button type="button" className="icon-button" aria-label="管理 合并请求 目标" title="添加、改名或删除 合并请求 目标" onClick={open}>
          <Plus size={16} />
        </button>
      </div>
      {editing && (
        <Modal title="设置 合并请求 目标" close={() => { if (!busy) setEditing(false); }} wide>
          <div className="target-form">
            <div className="target-config-toolbar">
              <p className="picker-note">为每个合并目标设置名称、颜色和远程分支，合并请求 与合并状态分别记录。</p>
              {repositoryPath && window.branchNote && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setRefreshRequest({path: repositoryPath})}
                >
                  <RefreshCw size={15} aria-hidden="true" className={operation === "refresh" ? "spin" : ""} />
                  {operation === "refresh" ? "更新中…" : "更新远程分支"}
                </button>
              )}
            </div>
            {!project.repositoryPath && (
              <p className="warning-panel">请先关联项目仓库。</p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="picker-note" role="status">{notice}</p>}
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
                      label={target.name + " 合并请求 目标"}
                      value={target.branch}
                      options={options}
                      disabled={busy || !options.length}
                      onChange={value => update(target.id, {branch: value})}
                    />
                  </label>
                  <button type="button"
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
            <button type="button"
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
              <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" disabled={busy || (targets.length > 0 && !options.length)} onClick={() => void save()}>保存目标</button>
            </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
