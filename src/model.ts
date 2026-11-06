export interface Project {
  id: string;
  name: string;
  note: string;
  color: string;
  archived: boolean;
  repositoryPath?: string;
  // 两个阶段各自记住上次用过的分支，避免每次重新挑
  testTarget?: string;
  releaseTarget?: string;
  // 目标分支受保护（平台禁止直接推送）时，合并自动改为：集成分支 + MR
  testProtected?: boolean;
  releaseProtected?: boolean;
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
  createdAt: string;
  updatedAt: string;
}
export interface Store {
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

export type Stage = "test" | "release";

// 两个阶段各自记住上次用过的分支：测试分支通常是 test/qa，发布分支通常是 release/week-XX
// resolve/** 只是冲突处理时的临时分支，不作为下次的默认目标
export function rememberedTarget(project: Project, stage: Stage): string {
  const value = (stage === "test" ? project.testTarget : project.releaseTarget) || "";
  return value.startsWith("resolve/") ? "" : value;
}
export function withTarget(
  project: Project,
  stage: Stage,
  target: string,
): Project {
  const value = target.trim();
  return stage === "test"
    ? { ...project, testTarget: value }
    : { ...project, releaseTarget: value };
}

// 合并完成后的台账写回：按阶段记下目标分支与本次合入时间
export function markMerged(
  store: Store,
  projectId: string,
  names: string[],
  stage: Stage,
  target: string,
  when = new Date(),
): Store {
  const timestamp = when.toISOString();
  const destination = target.trim();
  const targets = new Set(names);
  return {
    ...store,
    branches: store.branches.map((branch) =>
      branch.projectId === projectId && targets.has(branch.name)
        ? {
            ...branch,
            ...(stage === "test"
              ? {
                  testMergedAt: timestamp,
                  testTarget: destination || branch.testTarget,
                }
              : {
                  releaseMergedAt: timestamp,
                  releaseTarget: destination || branch.releaseTarget,
                }),
            updatedAt: timestamp,
          }
        : branch,
    ),
  };
}

// 列表里的手动标记：把某个阶段标成已合并（沿用已记录的目标分支）
export function markStageMerged(
  store: Store,
  branchId: string,
  stage: Stage,
  when = new Date(),
): Store {
  const timestamp = when.toISOString();
  return {
    ...store,
    branches: store.branches.map((branch) =>
      branch.id === branchId
        ? {
            ...branch,
            ...(stage === "test"
              ? { testMergedAt: timestamp }
              : { releaseMergedAt: timestamp }),
            updatedAt: timestamp,
          }
        : branch,
    ),
  };
}

// 分支有了新修改：重置对应阶段的合并状态，回到待合并
export function markModified(
  store: Store,
  branchId: string,
  stage: Stage | "both" = "both",
  when = new Date(),
): Store {
  const timestamp = when.toISOString();
  return {
    ...store,
    branches: store.branches.map((branch) =>
      branch.id === branchId
        ? {
            ...branch,
            ...(stage === "test" || stage === "both"
              ? { testMergedAt: null }
              : {}),
            ...(stage === "release" || stage === "both"
              ? { releaseMergedAt: null }
              : {}),
            updatedAt: timestamp,
          }
        : branch,
    ),
  };
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
        strings(p, ["id", "name", "note", "color"]) &&
        p.name.trim() &&
        /^#[0-9a-f]{6}$/i.test(p.color as string) &&
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
  const source = value as unknown as {
    version: number;
    projects: Project[];
    branches: Record<string, unknown>[];
  };
  const store: Store = {
    version: 3,
    projects: source.projects.map((item) => {
      // 旧数据里的 branchLabels（已废弃，只保留分支备注）在读取时丢弃
      const { branchLabels: _legacy, ...rest } = item as Project & {
        branchLabels?: unknown;
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
