import test from "node:test";
import assert from "node:assert/strict";
import {
  demoStore,
  moveBranch,
  parseStore,
  parseTxt,
  releaseChecklist,
  updateTarget,
} from "../src/model.ts";

test("移动批次会重置合并确认，同一批次保持确认", () => {
  const branch = demoStore().branches[0];
  assert.ok(moveBranch(branch, branch.batchId).mergedAt);
  assert.equal(moveBranch(branch, "").mergedAt, null);
});
test("目标分支变更仅重置对应项目的未上线记录", () => {
  const store = demoStore();
  const changed = updateTarget(store, "week45", "main", "release/next");
  assert.equal(changed.branches[0].mergedAt, null);
  assert.ok(changed.branches[2].mergedAt);
  assert.equal(updateTarget(store, "week45", "main", "release/week-45"), store);
});
test("已上线记录保留原来的合并确认时间", () => {
  const store = demoStore();
  store.branches[0].released = true;
  assert.equal(
    updateTarget(store, "week45", "main", "other").branches[0].mergedAt,
    store.branches[0].mergedAt,
  );
});
test("JSON 边界验证备份结构及引用完整性", () => {
  const store = demoStore();
  assert.deepEqual(parseStore(JSON.stringify(store)), store);
  assert.throws(() => parseStore('{"version":2}'));
  store.branches[0].projectId = "missing";
  assert.throws(() => parseStore(JSON.stringify(store)), /不存在/);
});
test("拒绝包含未上线分支的已完成批次和缺失目标的合并记录", () => {
  const store = demoStore();
  store.batches[0].completed = true;
  assert.throws(() => parseStore(JSON.stringify(store)), /未上线/);
  store.batches[0].completed = false;
  store.batches[0].targets.main = "";
  assert.throws(() => parseStore(JSON.stringify(store)), /目标/);
});
test("TXT 保留模糊状态和无法识别的行，支持不同空白", () => {
  const rows = parseTxt(
    "[主项目]\nfeature/login\t登录体验 已发\n\n无法识别的记录\n项目：活动项目\nfix/task   奖励刷新",
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[0].project, "主项目");
  assert.match(rows[0].note, /待确认/);
  assert.equal(rows[1].name, "");
  assert.match(rows[1].note, /无法识别/);
  assert.equal(rows[2].project, "活动项目");
});
test("发布清单按项目分组，包含目标与明确状态", () => {
  const text = releaseChecklist(demoStore(), "week45");
  assert.match(text, /主项目 → release\/week-45/);
  assert.match(text, /已部署测试 \/ 已合入发布分支 \/ 未上线/);
  assert.ok(!text.includes("feature/profile"));
});
