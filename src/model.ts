export interface MRTarget {
  id: string;
  name: string;
  branch: string;
  color: string;
}
export interface TargetState {
  mergedAt: string | null;
  target?: string;
  mr?: BranchMR;
}
export interface Project {
  id: string;
  name: string;
  note: string;
  archived: boolean;
  repositoryPath?: string;
  targets?: MRTarget[];
  // 两个阶段各自记住上次用过的分支，避免每次重新挑
  testTarget?: string;
  releaseTarget?: string;
  // 兼容旧备份字段；当前所有目标均通过 MR 合入
  testProtected?: boolean;
  releaseProtected?: boolean;
}
export interface BranchMR {
  state?: "opened" | "closed" | "merged";
  url: string;
  number: string;
  source: string;
  target: string;
  submittedAt: string;
}
export interface Branch {
  id: string;
  projectId: string;
  name: string;
  description: string;
  note: string;
  // 最近一次合入的测试分支与时间；分支后续有修改时可以重置为待合并
  testTarget?: string;
  testMergedAt: string | null;
  // 最近一次合入的发布分支与时间
  releaseTarget?: string;
  releaseMergedAt: string | null;
  stages?: Record<string, TargetState>;
  testMR?: BranchMR;
  releaseMR?: BranchMR;
  createdAt: string;
  updatedAt: string;
}
export const mrRefreshIntervals = [30, 60, 120, 300, 600, 900] as const;
export const formatRefreshInterval = (seconds: number) =>
  seconds < 60 ? seconds + " 秒" : seconds / 60 + " 分钟";

export interface Store {
  mrRefreshSeconds?: number;
  version: 3;
  projects: Project[];
  branches: Branch[];
}
export const blankStore = (): Store => ({
  version: 3,
  projects: [],
  branches: [],
});
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();

// 周编号用于默认聚合分支名（release/week-XX）
export function weekNumber(date = new Date()): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(
    ((date.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7,
  );
}
// 用本地日期，避免东八区凌晨按 UTC 取到前一天
export const dateOnly = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export type Stage = string;

export function projectTargets(project: Project): MRTarget[] {
  return project.targets ?? [
    {id: "test", name: "测试", branch: project.testTarget || "", color: "#4263dc"},
    {id: "release", name: "发布", branch: project.releaseTarget || "", color: "#8b5bb5"},
  ];
}

export function targetState(branch: Branch, stage: Stage): TargetState {
  if (stage === "test") return {mergedAt: branch.testMergedAt, target: branch.testTarget, mr: branch.testMR};
  if (stage === "release") return {mergedAt: branch.releaseMergedAt, target: branch.releaseTarget, mr: branch.releaseMR};
  return branch.stages?.[stage] ?? {mergedAt: null};
}

export function withStageState(branch: Branch, stage: Stage, state: TargetState): Branch {
  if (stage === "test") return {...branch, testMergedAt: state.mergedAt, testTarget: state.target, ...(state.mr || branch.testMR ? {testMR: state.mr} : {})};
  if (stage === "release") return {...branch, releaseMergedAt: state.mergedAt, releaseTarget: state.target, ...(state.mr || branch.releaseMR ? {releaseMR: state.mr} : {})};
  return {...branch, stages: {...branch.stages, [stage]: state}};
}

// 两个阶段各自记住上次用过的分支：测试分支通常是 test/qa，发布分支通常是 release/week-XX
// resolve/** 只是冲突处理时的临时分支，不作为下次的默认目标
export function rememberedTarget(project: Project, stage: Stage): string {
  const value = projectTargets(project).find(target => target.id === stage)?.branch || "";
  return value.startsWith("resolve/") ? "" : value;
}
export function withTarget(
  project: Project,
  stage: Stage,
  target: string,
): Project {
  const value = target.trim();
  if (project.targets) return {...project, targets: project.targets.map(item => item.id === stage ? {...item, branch: value} : item)};
  return stage === "test"
    ? { ...project, testTarget: value }
    : { ...project, releaseTarget: value };
}

// 合并完成后的台账写回：按阶段记下目标分支与本次合入时间
export function markMerged(
  store: Store, projectId: string, names: string[], stage: Stage,
  target: string, when = new Date(),
): Store {
  const timestamp = when.toISOString();
  const selected = new Set(names);
  return {...store, branches: store.branches.map(branch =>
    branch.projectId === projectId && selected.has(branch.name)
      ? {...withStageState(branch, stage, {...targetState(branch, stage),
          mergedAt: timestamp, target: target.trim() || targetState(branch, stage).target}), updatedAt: timestamp}
      : branch)};
}

export function markStageMerged(store: Store, branchId: string, stage: Stage, when = new Date()): Store {
  const timestamp = when.toISOString();
  return {...store, branches: store.branches.map(branch => branch.id === branchId
    ? {...withStageState(branch, stage, {...targetState(branch, stage), mergedAt: timestamp}), updatedAt: timestamp}
    : branch)};
}

export function markModified(
  store: Store, branchId: string, stage: Stage | "both" = "both", when = new Date(),
): Store {
  return {...store, branches: store.branches.map(branch => {
    if (branch.id !== branchId) return branch;
    const stages = stage === "both" ? ["test", "release", ...Object.keys(branch.stages || {})] : [stage];
    let next = branch;
    for (const key of stages) next = withStageState(next, key, {...targetState(next, key), mergedAt: null, mr: undefined});
    return {...next, updatedAt: when.toISOString()};
  })};
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings<K extends string>(
  item: Record<string, unknown>,
  fields: K[],
): item is Record<string, unknown> & Record<K, string> {
  return fields.every((key) => typeof item[key] === "string");
}
function validTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function optionalTime(value: unknown): boolean {
  return value === undefined || value === null || validTime(value);
}
function validMR(value: unknown): boolean {
  return value === undefined || (
    object(value) &&
    strings(value, ["url", "number", "source", "target", "submittedAt"]) &&
    /^https?:\/\//.test(value.url) &&
    (value.state === undefined || typeof value.state === "string" && ["opened", "closed", "merged"].includes(value.state)) &&
    validTime(value.submittedAt)
  );
}
function validTargets(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value) &&
    value.every(target => object(target) && strings(target, ["id", "name", "branch", "color"]) &&
      target.id.trim() && target.id !== "both" && target.name.trim() && /^#[0-9a-f]{6}$/i.test(target.color)) &&
    new Set(value.map(target => target.id)).size === value.length
  );
}
function validStages(value: unknown): boolean {
  return value === undefined || (object(value) && Object.entries(value).every(([key, state]) =>
    key.trim() && object(state) && (state.mergedAt === null || validTime(state.mergedAt)) &&
    optionalTarget(state.target) && validMR(state.mr)));
}

function optionalTarget(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() !== "");
}

// All imported/persisted data enters through this boundary. Internal code uses Store directly.
// v1 备份带 batches/batchId/上线字段，v2 带 testAt/mergedAt/releaseTarget；
// 读取时统一迁移成 v3 的双合并状态：testAt→testMergedAt，mergedAt→releaseMergedAt。
export function parseStore(raw: string): Store {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    ![1, 2, 3].includes(value.version as number) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.branches)
  )
    throw new Error("不是有效的 BranchNote 备份");
  if (
    !value.projects.every(
      (p) =>
        object(p) &&
        strings(p, ["id", "name", "note"]) &&
        p.name.trim() &&
        validTargets(p.targets) &&
        typeof p.archived === "boolean" &&
        (p.repositoryPath === undefined ||
          typeof p.repositoryPath === "string") &&
        (p.testTarget === undefined || typeof p.testTarget === "string") &&
        (p.releaseTarget === undefined || typeof p.releaseTarget === "string") &&
        (p.testProtected === undefined || typeof p.testProtected === "boolean") &&
        (p.releaseProtected === undefined ||
          typeof p.releaseProtected === "boolean"),
    )
  )
    throw new Error("项目数据格式错误");
  if (
    !value.branches.every(
      (b) =>
        object(b) &&
        strings(b, ["id", "projectId", "name", "description", "note"]) &&
        b.name.trim() &&
        b.description.trim() &&
        validTime(b.createdAt) &&
        validTime(b.updatedAt) &&
        validMR(b.testMR) && validMR(b.releaseMR) &&
        validStages(b.stages) &&
        optionalTime(b.testMergedAt) &&
        optionalTime(b.releaseMergedAt) &&
        optionalTarget(b.testTarget) &&
        optionalTarget(b.releaseTarget) &&
        // v1/v2 的字段也按原样校验，迁移时丢弃不兼容的部分
        (b.mergedAt === undefined || optionalTime(b.mergedAt)) &&
        (b.testAt === undefined || optionalTime(b.testAt)) &&
        (b.releaseTarget === undefined || optionalTarget(b.releaseTarget)),
    )
  )
    throw new Error("分支数据格式错误");
  if (value.mrRefreshSeconds !== undefined &&
      (typeof value.mrRefreshSeconds !== "number" || !mrRefreshIntervals.some(seconds => seconds === value.mrRefreshSeconds)))
    throw new Error("MR 刷新周期格式错误");
  const source = value as unknown as {
    mrRefreshSeconds?: number;
    version: number;
    projects: Project[];
    branches: Record<string, unknown>[];
  };
  const store: Store = {
    version: 3,
    ...(source.mrRefreshSeconds !== undefined ? {mrRefreshSeconds: source.mrRefreshSeconds} : {}),
    projects: source.projects.map((item) => {
      // 读取时丢弃已移除的项目颜色和旧分支标签
      const { branchLabels: _legacy, color: _legacyColor, ...rest } = item as Project & {
        branchLabels?: unknown;
        color?: unknown;
      };
      return rest as Project;
    }),
    branches: source.branches.map((branch) => ({
      id: branch.id as string,
      projectId: branch.projectId as string,
      name: branch.name as string,
      description: branch.description as string,
      note: branch.note as string,
      testTarget: optionalTarget(branch.testTarget)
        ? (branch.testTarget as string | undefined)
        : undefined,
      testMergedAt:
        (branch.testMergedAt as string | null | undefined) ??
        (branch.testAt as string | null | undefined) ??
        null,
      releaseTarget: optionalTarget(branch.releaseTarget)
        ? (branch.releaseTarget as string | undefined)
        : undefined,
      releaseMergedAt:
        (branch.releaseMergedAt as string | null | undefined) ??
        (branch.mergedAt as string | null | undefined) ??
        null,
      ...(branch.stages ? {stages: branch.stages as Record<string, TargetState>} : {}),
      ...(branch.testMR ? {testMR: branch.testMR as BranchMR} : {}),
      ...(branch.releaseMR ? {releaseMR: branch.releaseMR as BranchMR} : {}),
      createdAt: branch.createdAt as string,
      updatedAt: branch.updatedAt as string,
    })),
  };
  for (const list of [store.projects, store.branches]) {
    if (
      new Set(list.map((item) => item.id)).size !== list.length ||
      list.some((item) => !item.id)
    )
      throw new Error("备份包含重复或空的标识");
  }
  if (
    store.branches.some(
      (b) => !store.projects.some((p) => p.id === b.projectId),
    )
  )
    throw new Error("分支引用的项目不存在");
  return store;
}

export function removeProject(store: Store, projectId: string): Store {
  return {...store, projects: store.projects.filter(p => p.id !== projectId), branches: store.branches.filter(b => b.projectId !== projectId)};
}
