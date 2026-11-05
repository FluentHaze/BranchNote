export interface Project {
  id: string;
  name: string;
  note: string;
  color: string;
  archived: boolean;
  repositoryPath?: string;
}
export interface Batch {
  id: string;
  name: string;
  date: string;
  note: string;
  completed: boolean;
  targets: Record<string, string>;
}
export interface Branch {
  id: string;
  projectId: string;
  name: string;
  description: string;
  note: string;
  tested: boolean;
  released: boolean;
  batchId: string;
  mergedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Store {
  version: 1;
  projects: Project[];
  batches: Batch[];
  branches: Branch[];
}
export const blankStore = (): Store => ({
  version: 1,
  projects: [],
  batches: [],
  branches: [],
});
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();

export function moveBranch(branch: Branch, batchId: string): Branch {
  return {
    ...branch,
    batchId,
    mergedAt: branch.batchId === batchId ? branch.mergedAt : null,
    updatedAt: now(),
  };
}

export function updateTarget(
  store: Store,
  batchId: string,
  projectId: string,
  target: string,
): Store {
  const batch = store.batches.find((item) => item.id === batchId)!;
  if ((batch.targets[projectId] || "") === target) return store;
  return {
    ...store,
    batches: store.batches.map((item) =>
      item.id === batchId
        ? { ...item, targets: { ...item.targets, [projectId]: target } }
        : item,
    ),
    branches: store.branches.map((item) =>
      item.batchId === batchId && item.projectId === projectId && !item.released
        ? { ...item, mergedAt: null, updatedAt: now() }
        : item,
    ),
  };
}

export function releaseChecklist(store: Store, batchId: string): string {
  const batch = store.batches.find((item) => item.id === batchId)!;
  return [
    batch.name,
    batch.date ? `计划发布日期：${batch.date}` : "",
    ...store.projects.flatMap((project) => {
      const branches = store.branches.filter(
        (item) => item.batchId === batchId && item.projectId === project.id,
      );
      return branches.length
        ? [
            `\n${project.name} → ${batch.targets[project.id] || "未填写发布分支"}`,
            ...branches.map(
              (item) =>
                `- ${item.name}：${item.description}\n  ${item.tested ? "已部署测试" : "未部署测试"} / ${item.mergedAt ? "已合入发布分支" : "未合入发布分支"} / ${item.released ? "已上线" : "未上线"}`,
            ),
          ]
        : [];
    }),
  ]
    .filter(Boolean)
    .join("\n");
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

// All imported/persisted data enters through this boundary. Internal code uses Store directly.
export function parseStore(raw: string): Store {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.batches) ||
    !Array.isArray(value.branches)
  )
    throw new Error("不是有效的 BranchNote v1 备份");
  if (
    !value.projects.every(
      (p) =>
        object(p) &&
        strings(p, ["id", "name", "note", "color"]) &&
        p.name.trim() &&
        /^#[0-9a-f]{6}$/i.test(p.color as string) &&
        typeof p.archived === "boolean" &&
        (p.repositoryPath === undefined ||
          typeof p.repositoryPath === "string"),
    )
  )
    throw new Error("项目数据格式错误");
  if (
    !value.batches.every(
      (b) =>
        object(b) &&
        strings(b, ["id", "name", "date", "note"]) &&
        b.name.trim() &&
        typeof b.completed === "boolean" &&
        object(b.targets) &&
        Object.values(b.targets).every((t) => typeof t === "string"),
    )
  )
    throw new Error("发布批次格式错误");
  if (
    !value.branches.every(
      (b) =>
        object(b) &&
        strings(b, [
          "id",
          "projectId",
          "name",
          "description",
          "note",
          "batchId",
        ]) &&
        b.name.trim() &&
        b.description.trim() &&
        typeof b.tested === "boolean" &&
        typeof b.released === "boolean" &&
        validTime(b.createdAt) &&
        validTime(b.updatedAt) &&
        (b.mergedAt === null || validTime(b.mergedAt)) &&
        (b.releasedAt === null || validTime(b.releasedAt)),
    )
  )
    throw new Error("分支数据格式错误");
  const store = value as unknown as Store;
  for (const list of [store.projects, store.batches, store.branches]) {
    if (
      new Set(list.map((item) => item.id)).size !== list.length ||
      list.some((item) => !item.id)
    )
      throw new Error("备份包含重复或空的标识");
  }
  if (
    store.branches.some(
      (b) =>
        !store.projects.some((p) => p.id === b.projectId) ||
        (b.batchId && !store.batches.some((batch) => batch.id === b.batchId)),
    )
  )
    throw new Error("分支引用的项目或批次不存在");
  if (
    store.branches.some(
      (b) =>
        b.mergedAt &&
        (!b.batchId ||
          !store.batches
            .find((batch) => batch.id === b.batchId)
            ?.targets[b.projectId]?.trim()),
    )
  )
    throw new Error("合并记录缺少目标发布分支");
  if (
    store.batches.some(
      (batch) =>
        batch.completed &&
        store.branches.some((b) => b.batchId === batch.id && !b.released),
    )
  )
    throw new Error("已完成批次包含未上线分支");
  return store;
}

export interface ImportRow {
  project: string;
  name: string;
  description: string;
  note: string;
  include: boolean;
}
export function parseTxt(raw: string): ImportRow[] {
  let project = "";
  return raw.split(/\r?\n/).flatMap((line) => {
    const text = line.trim();
    if (!text) return [];
    if (/^\[.+\]$/.test(text) || /^项目[：:]/.test(text)) {
      project = text.startsWith("[")
        ? text.slice(1, -1)
        : text.replace(/^项目[：:]\s*/, "");
      return [];
    }
    const match = text.match(/^([^\s]+\/[^\s]+)\s+(.+)$/);
    return [
      {
        project,
        name: match?.[1] || "",
        description: match?.[2] || "",
        note: match
          ? /已发|已上线|已合并|已提测/.test(text)
            ? `原始内容（状态待确认）：${text}`
            : ""
          : `未识别内容：${text}`,
        include: true,
      },
    ];
  });
}

export function demoStore(): Store {
  const time = now();
  const projects: Project[] = [
    {
      id: "main",
      name: "主项目",
      note: "核心产品与用户体验",
      color: "#007aff",
      archived: false,
    },
    {
      id: "activity",
      name: "活动项目",
      note: "运营活动与任务系统",
      color: "#af52de",
      archived: false,
    },
    {
      id: "landing",
      name: "落地页",
      note: "增长与渠道归因",
      color: "#e58b20",
      archived: false,
    },
  ];
  const batches: Batch[] = [
    {
      id: "week45",
      name: "第 45 周发布",
      date: "2026-11-06",
      note: "周五常规发布，上线前确认测试结果。",
      completed: false,
      targets: {
        main: "release/week-45",
        activity: "release/week-45",
        landing: "main",
      },
    },
  ];
  const entries = [
    [
      "main",
      "feature/pwa-task",
      "PWA 任务入口与安装引导",
      true,
      true,
      "week45",
    ],
    [
      "main",
      "fix/provider-games",
      "修复厂商游戏列表筛选",
      true,
      false,
      "week45",
    ],
    [
      "activity",
      "feature/task-carousel",
      "任务卡片轮播与奖励领取",
      true,
      true,
      "week45",
    ],
    [
      "activity",
      "fix/reward-refresh",
      "领取奖励后刷新任务状态",
      false,
      false,
      "week45",
    ],
    [
      "landing",
      "feature/adjust-tracking",
      "支持渠道归因参数透传",
      true,
      false,
      "week45",
    ],
    ["main", "feature/profile", "个人资料页体验优化", false, false, ""],
    ["activity", "feature/check-in", "连续签到活动", false, false, ""],
  ] as const;
  return {
    version: 1,
    projects,
    batches,
    branches: entries.map((e, index) => ({
      id: `demo-${index}`,
      projectId: e[0],
      name: e[1],
      description: e[2],
      tested: e[3],
      mergedAt: e[4] ? time : null,
      batchId: e[5],
      released: false,
      releasedAt: null,
      note: "",
      createdAt: time,
      updatedAt: time,
    })),
  };
}
