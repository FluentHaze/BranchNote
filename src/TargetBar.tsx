import { useEffect, useState } from "react";
import {
  FlaskConical,
  GitMerge,
  Lock,
  Pencil,
  RefreshCw,
} from "lucide-react";
import Modal from "./Modal";
import Select from "./Select";
import {
  weekNumber,
  type Project,
  type Stage,
  type Store,
} from "./model";
import type { Repository } from "./storage";

const NEW_TARGET = "__new__";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

// 主界面顶部的目标分支条：醒目显示本版本要合入的测试/发布分支，点开即可修改。
// 每个版本换分支名时不用进提交对话框找：在这里改一次，提交时直接沿用。
export default function TargetBar({
  project,
  store,
  commit,
}: {
  project: Project;
  store: Store;
  commit(next: Store, message?: string): Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [repository, setRepository] = useState<Repository | null>(null);
  const [inited, setInited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Select 当前选中的值：已有分支的 ref / NEW_TARGET（新建）/ 空（不指定）
  const [values, setValues] = useState<Record<Stage, string>>({
    test: "",
    release: "",
  });
  // 选「新建分支」时填写的名字
  const [names, setNames] = useState<Record<Stage, string>>({
    test: "",
    release: "",
  });
  // 目标分支是否受保护（平台禁止直接推送，只能走 MR）
  const [guards, setGuards] = useState<Record<Stage, boolean>>({
    test: false,
    release: false,
  });

  const testTarget = project.testTarget || "";
  const releaseTarget = project.releaseTarget || "";
  const branches = repository?.branches || [];

  const optionsFor = (stage: Stage) => [
    {
      value: NEW_TARGET,
      label: `新建${stage === "test" ? "测试" : "发布"}分支（合并时创建）…`,
    },
    ...branches
      .filter((branch) => branch.remoteRef)
      .map((branch) => ({
        value: branch.remoteRef!,
        label: `${branch.remoteRef}（远程）`,
      })),
    ...branches
      .filter((branch) => branch.local && !branch.remoteRef)
      .map((branch) => ({
        value: branch.name,
        label: `${branch.name}（本地）`,
      })),
  ];

  // 打开编辑：读取仓库分支。
  // 注意：busy 不能进依赖数组——setBusy 会触发清理把 active 置 false，
  // 加载结果被丢弃，弹窗会永远卡在“正在读取仓库分支…”
  useEffect(() => {
    if (
      !editing ||
      repository ||
      !window.branchNote ||
      !project.repositoryPath
    )
      return;
    let active = true;
    setBusy(true);
    setError("");
    window.branchNote
      .readRepository(project.repositoryPath)
      .then((repo) => {
        if (active) setRepository(repo);
      })
      .catch((reason) => {
        if (active) setError(message(reason));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [editing, repository, project.repositoryPath]);

  // 分支列表到位（或确认读不到）后初始化表单：已设置的分支仓库里没有时按「新建」预填名字
  useEffect(() => {
    if (!editing || inited) return;
    if (busy || (repository === null && !error && project.repositoryPath)) return;
    const refs = new Set(
      branches.flatMap((branch) =>
        [branch.remoteRef, branch.name].filter(Boolean) as string[],
      ),
    );
    setValues({
      test: testTarget ? (refs.has(testTarget) ? testTarget : NEW_TARGET) : "",
      release: releaseTarget
        ? refs.has(releaseTarget)
          ? releaseTarget
          : NEW_TARGET
        : "",
    });
    setNames({
      test: testTarget && !refs.has(testTarget) ? testTarget : "",
      release: releaseTarget && !refs.has(releaseTarget) ? releaseTarget : "",
    });
    setGuards({
      test: !!project.testProtected,
      release: !!project.releaseProtected,
    });
    setInited(true);
  }, [editing, inited, busy, repository, error, testTarget, releaseTarget]);

  function open() {
    setEditing(true);
    setInited(false);
    setError("");
  }

  async function save() {
    const pick = (stage: Stage) => {
      const value = values[stage];
      if (value !== NEW_TARGET) return value;
      return names[stage].trim();
    };
    const test = pick("test");
    const release = pick("release");
    if ((values.test === NEW_TARGET && !test) ||
      (values.release === NEW_TARGET && !release)) {
      setError("选了「新建分支」时，请填写分支名称");
      return;
    }
    const ok = await commit(
      {
        ...store,
        projects: store.projects.map((item) =>
          item.id === project.id
            ? {
                ...item,
                testTarget: test || undefined,
                releaseTarget: release || undefined,
                testProtected: guards.test,
                releaseProtected: guards.release,
              }
            : item,
        ),
      },
      "目标分支已更新",
    );
    if (ok) setEditing(false);
  }

  return (
    <>
      <div className="target-bar" aria-label="目标分支">
        <span className="target-bar-caption">本版本目标</span>
        <button
          type="button"
          className={`target-chip test ${testTarget ? "" : "missing"}`}
          onClick={open}
          title="点击修改测试分支"
        >
          <FlaskConical size={15} />
          <span className="target-chip-name">测试分支</span>
          <code>{testTarget || "未设置"}</code>
          {project.testProtected && (
            <Lock size={13} className="target-lock" aria-label="受保护" />
          )}
        </button>
        <button
          type="button"
          className={`target-chip release ${releaseTarget ? "" : "missing"}`}
          onClick={open}
          title="点击修改发布分支"
        >
          <GitMerge size={15} />
          <span className="target-chip-name">发布分支</span>
          <code>{releaseTarget || "未设置"}</code>
          {project.releaseProtected && (
            <Lock size={13} className="target-lock" aria-label="受保护" />
          )}
        </button>
        <button
          className="icon-button"
          aria-label="修改目标分支"
          title="修改测试 / 发布分支"
          onClick={open}
        >
          <Pencil size={15} />
        </button>
      </div>

      {editing && (
        <Modal
          title="修改目标分支"
          close={() => {
            if (!busy) setEditing(false);
          }}
        >
          <div className="target-form">
            <p className="picker-note">
              每个版本换分支名时在这里改，提交合并会直接使用这两条分支。
              名字在仓库里还不存在时，合并时会从起点分支新建。
            </p>
            {!window.branchNote && (
              <div className="warning-panel">
                浏览器预览无法访问本地 Git，请在桌面应用中修改。
              </div>
            )}
            {!project.repositoryPath && (
              <div className="warning-panel">
                这个项目还没有关联仓库，先从「全部分支」里选择一次仓库。
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {busy && <p className="picker-note">正在读取仓库分支…</p>}
            <div className="target-form-tools">
              <span className="field-hint">
                仓库里找不到目标分支时，选「新建」填名字即可。
              </span>
              <button
                className="icon-button"
                aria-label="重新读取分支"
                title="重新读取仓库分支"
                disabled={busy || !project.repositoryPath}
                onClick={() => {
                  setRepository(null);
                  setInited(false);
                  setError("");
                }}
              >
                <RefreshCw size={15} className={busy ? "spin" : ""} />
              </button>
            </div>
            {/* 表单初始化完成前不渲染选择器：避免加载完成时把用户已选的值覆盖回去 */}
            {inited &&
              (["test", "release"] as Stage[]).map((stage) => (
              <div className="target-form-row" key={stage}>
                <label>
                  {stage === "test" ? "测试分支" : "发布分支"}
                  <Select
                    label={stage === "test" ? "测试分支" : "发布分支"}
                    value={values[stage]}
                    disabled={busy || !branches.length}
                    onChange={(value) =>
                      setValues((prev) => ({ ...prev, [stage]: value }))
                    }
                    options={optionsFor(stage)}
                  />
                </label>
                {values[stage] === NEW_TARGET && (
                  <input
                    value={names[stage]}
                    disabled={busy}
                    onChange={(event) =>
                      setNames((prev) => ({
                        ...prev,
                        [stage]: event.target.value,
                      }))
                    }
                    placeholder={
                      stage === "test"
                        ? "test"
                        : `release/week-${String(weekNumber()).padStart(2, "0")}`
                    }
                    aria-label={
                      stage === "test" ? "新测试分支名称" : "新发布分支名称"
                    }
                  />
                )}
                <label className="guard-field">
                  <input
                    type="checkbox"
                    checked={guards[stage]}
                    disabled={busy}
                    onChange={(event) =>
                      setGuards((prev) => ({
                        ...prev,
                        [stage]: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    这条{stage === "test" ? "测试" : "发布"}分支受保护（只能通过 MR
                    合入）：提交时不直接推送，改为推送集成分支并打开 MR 创建页
                  </span>
                </label>
              </div>
            ))}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void save()}
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
