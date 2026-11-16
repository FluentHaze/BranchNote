import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { createGitOperation } = createRequire(import.meta.url)("../electron/git-operation.cjs") as {
  createGitOperation(onChange: (operation: string | null) => void): {
    current(): string | null;
    run<T>(label: string, action: () => T | Promise<T>): Promise<T>;
  };
};

test("Git 操作同步占锁，重复及其他写操作不会执行，完成后释放", async () => {
  const events: (string | null)[] = [];
  const operation = createGitOperation(value => events.push(value));
  let finish!: (value: string) => void;
  let writes = 0;
  const pushing = operation.run("推送分支", () => {
    writes++;
    return new Promise<string>(resolve => { finish = resolve; });
  });
  assert.equal(operation.current(), "推送分支");
  for (const label of ["推送分支", "更新远程引用", "保存冲突文件", "放弃合并"]) {
    await assert.rejects(operation.run(label, () => { writes++; }), /正在推送分支/);
  }
  assert.equal(writes, 1);
  assert.deepEqual(events, ["推送分支"]);
  finish("done");
  assert.equal(await pushing, "done");
  assert.equal(operation.current(), null);
  assert.deepEqual(events, ["推送分支", null]);
  await operation.run("更新远程引用", () => { writes++; });
  assert.equal(writes, 2);
});

test("Git 操作同步异常或异步失败后保留原错误，并恢复可操作状态", async () => {
  const operation = createGitOperation(() => {});
  const failure = new Error("认证未通过");
  for (const action of [() => { throw failure; }, () => Promise.reject(failure)]) {
    await assert.rejects(operation.run("推送分支", action), error => error === failure);
    assert.equal(operation.current(), null);
    assert.equal(await operation.run("重试", () => "ok"), "ok");
  }
});

test("等待冲突人工处理期间不持锁，后续提交和继续合并可依次执行", async () => {
  const operation = createGitOperation(() => {});
  await operation.run("执行合并", () => ({ status: "conflict" }));
  assert.equal(operation.current(), null);
  await operation.run("保存冲突文件", () => {});
  await operation.run("提交冲突解决", () => {});
  await operation.run("继续合并", () => {});
  assert.equal(operation.current(), null);
});
