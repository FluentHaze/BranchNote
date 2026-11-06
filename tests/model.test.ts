import test from "node:test";
import assert from "node:assert/strict";
import {
  markMerged,
  markModified,
  markStageMerged,
  parseStore,
  rememberedTarget,
  withTarget,
  type Branch,
  type Project,
  type Store,
} from "../src/model.ts";

const project = (id: string): Project => ({
  id,
  name: id,
  note: "",
  color: "#007aff",
  archived: false,
});
const emptyStore = (): Store => ({
  version: 3,
  projects: [project("main"), project("activity")],
  branches: [],
});
const THURSDAY = new Date("2026-11-06T10:00:00");
const STAMP = THURSDAY.toISOString();

const branchRecord = (
  id: string,
  name: string,
  overrides: Partial<Branch> = {},
): Branch => ({
  id,
  projectId: "main",
  name,
  description: name,
  note: "",
  testMergedAt: null,
  releaseMergedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

test("合并测试分支只写测试阶段的字段", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [
      branchRecord("r1", "feature/login"),
      branchRecord("r2", "feature/cart", { releaseMergedAt: STAMP }),
      branchRecord("r3", "feature/other", { projectId: "activity" }),
    ],
  };
  const next = markMerged(store, "main", ["feature/login"], "test", "origin/test", THURSDAY);
  const login = next.branches.find((b) => b.id === "r1")!;
  assert.equal(login.testMergedAt, STAMP);
  assert.equal(login.testTarget, "origin/test");
  assert.equal(login.releaseMergedAt, null);
  // 其他分支与发布阶段不受影响
  assert.equal(next.branches.find((b) => b.id === "r2")!.testMergedAt, null);
  assert.equal(next.branches.find((b) => b.id === "r3")!.testMergedAt, null);
});

test("合并发布分支只写发布阶段的字段", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [
      branchRecord("r1", "feature/login", { testMergedAt: STAMP, testTarget: "origin/test" }),
    ],
  };
  const next = markMerged(store, "main", ["feature/login"], "release", " release/week-45 ", THURSDAY);
  const login = next.branches[0];
  assert.equal(login.releaseMergedAt, STAMP);
  assert.equal(login.releaseTarget, "release/week-45");
  assert.equal(login.testMergedAt, STAMP);
  assert.equal(login.testTarget, "origin/test");
});

test("再次合并会更新时间与目标，支持分支修改后的重新提交", () => {
  const first = markMerged(
    { ...emptyStore(), branches: [branchRecord("r1", "feature/login")] },
    "main",
    ["feature/login"],
    "release",
    "release/week-45",
    THURSDAY,
  );
  assert.equal(first.branches[0].releaseMergedAt, STAMP);

  const later = new Date("2026-11-10T10:00:00");
  const again = markMerged(first, "main", ["feature/login"], "release", "release/week-46", later);
  assert.equal(again.branches[0].releaseMergedAt, later.toISOString());
  assert.equal(again.branches[0].releaseTarget, "release/week-46");
  assert.equal(again.branches[0].updatedAt, later.toISOString());
});

test("分支有新修改时可以重置对应阶段的合并状态", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [
      branchRecord("r1", "feature/login", {
        testMergedAt: STAMP,
        testTarget: "origin/test",
        releaseMergedAt: STAMP,
        releaseTarget: "release/week-45",
      }),
      branchRecord("r2", "feature/cart"),
    ],
  };
  // 只重置测试阶段，发布状态保留
  const resetTest = markModified(store, "r1", "test", THURSDAY);
  const login = resetTest.branches.find((b) => b.id === "r1")!;
  assert.equal(login.testMergedAt, null);
  assert.equal(login.testTarget, "origin/test");
  assert.equal(login.releaseMergedAt, STAMP);
  // both：两个阶段都回到待合并
  const resetBoth = markModified(store, "r1", "both", THURSDAY);
  const both = resetBoth.branches.find((b) => b.id === "r1")!;
  assert.equal(both.testMergedAt, null);
  assert.equal(both.releaseMergedAt, null);
  // 其他分支不受影响
  assert.equal(resetBoth.branches.find((b) => b.id === "r2")!.releaseMergedAt, null);
});

test("列表里可以手动标记某个阶段已合并", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [branchRecord("r1", "feature/login")],
  };
  const next = markStageMerged(store, "r1", "test", THURSDAY);
  assert.equal(next.branches[0].testMergedAt, STAMP);
  assert.equal(next.branches[0].releaseMergedAt, null);
});

test("备份读写保持结构一致", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [
      branchRecord("r1", "feature/login", {
        testMergedAt: STAMP,
        testTarget: "origin/test",
        releaseMergedAt: STAMP,
        releaseTarget: "release/week-45",
      }),
    ],
  };
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
});

test("v2 备份迁移：testAt→testMergedAt，mergedAt→releaseMergedAt", () => {
  const legacy = {
    version: 2,
    projects: [project("main")],
    branches: [
      {
        id: "r1",
        projectId: "main",
        name: "feature/login",
        description: "登录",
        note: "",
        tested: true,
        released: true,
        testAt: STAMP,
        mergedAt: "2026-11-01T10:00:00.000Z",
        releasedAt: STAMP,
        releaseTarget: "release/week-45",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  };
  const store = parseStore(JSON.stringify(legacy));
  assert.equal(store.version, 3);
  const branch = store.branches[0];
  assert.equal(branch.testMergedAt, STAMP);
  assert.equal(branch.testTarget, undefined);
  assert.equal(branch.releaseMergedAt, "2026-11-01T10:00:00.000Z");
  assert.equal(branch.releaseTarget, "release/week-45");
  assert.ok(!("released" in branch));
  assert.ok(!("tested" in branch));
});

test("v1 备份迁移：丢掉批次并补全缺失字段", () => {
  const legacy = {
    version: 1,
    projects: [project("main")],
    batches: [
      {
        id: "week45",
        name: "第 45 周发布",
        date: "2026-11-06",
        note: "",
        completed: false,
        targets: { main: "release/week-45" },
      },
    ],
    branches: [
      {
        id: "r1",
        projectId: "main",
        name: "feature/login",
        description: "登录",
        note: "",
        tested: true,
        released: false,
        batchId: "week45",
        mergedAt: STAMP,
        releasedAt: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ],
  };
  const store = parseStore(JSON.stringify(legacy));
  assert.equal(store.version, 3);
  assert.ok(!("batches" in store));
  assert.ok(!("batchId" in store.branches[0]));
  assert.equal(store.branches[0].testMergedAt, null);
  assert.equal(store.branches[0].releaseMergedAt, STAMP);
  assert.equal(store.branches[0].releaseTarget, undefined);
});

test("无效备份会被拒绝", () => {
  const store: Store = {
    ...emptyStore(),
    branches: [branchRecord("r1", "feature/login")],
  };
  assert.throws(() => parseStore('{"version":4}'), /不是有效/);
  assert.throws(
    () =>
      parseStore(
        JSON.stringify({
          ...store,
          branches: [{ ...store.branches[0], projectId: "missing" }],
        }),
      ),
    /项目不存在/,
  );
  assert.throws(
    () =>
      parseStore(
        JSON.stringify({
          ...store,
          branches: [{ ...store.branches[0], testMergedAt: "昨天" }],
        }),
      ),
    /分支数据格式错误/,
  );
  assert.throws(
    () =>
      parseStore(
        JSON.stringify({
          ...store,
          projects: [{ ...store.projects[0], testTarget: 1 }],
        }),
      ),
    /项目数据格式错误/,
  );
  assert.throws(
    () =>
      parseStore(
        JSON.stringify({
          ...store,
          branches: [{ ...store.branches[0], releaseTarget: 2 }],
        }),
      ),
    /分支数据格式错误/,
  );
  assert.throws(
    () =>
      parseStore(
        JSON.stringify({
          ...store,
          projects: [store.projects[0], store.projects[0]],
        }),
      ),
    /重复/,
  );
});

test("两个阶段各自记住目标分支，互不覆盖", () => {
  const base = project("main");
  const tested = withTarget(base, "test", " origin/test ");
  const released = withTarget(tested, "release", "origin/release/week-45");
  assert.equal(rememberedTarget(released, "test"), "origin/test");
  assert.equal(rememberedTarget(released, "release"), "origin/release/week-45");
  assert.equal(rememberedTarget(base, "test"), "");
  assert.equal(withTarget(base, "test", "  ").testTarget, "");
});

// 分支标签已废弃（统一由分支备注承担说明），旧备份里的字段读取时直接丢弃
test("旧备份里的 branchLabels 读取时被丢弃", () => {
  const raw = JSON.stringify({
    version: 3,
    projects: [
      {
        id: "main",
        name: "main",
        note: "",
        color: "#007aff",
        archived: false,
        branchLabels: { "origin/test": " 测试分支 ", blank: "  " },
      },
    ],
    branches: [],
  });
  const store = parseStore(raw);
  assert.equal("branchLabels" in store.projects[0], false);
});
