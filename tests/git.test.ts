import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import type { Repository, MergePlan, MergeResult } from "../src/storage.ts";

const require = createRequire(import.meta.url);
const service = require("../electron/git.cjs") as {
  readRepository(directory: string): Promise<Repository>;
  prepareMerge(
    directory: string,
    target: string,
    sources: string[],
    resolveBranch: string,
    options?: { create?: boolean; base?: string },
  ): Promise<MergePlan>;
  executeMerge(plan: MergePlan): Promise<MergeResult>;
};
const run = promisify(execFile);
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "branchnote-git-test-"));
  const git = async (...args: string[]) =>
    (
      await run("git", ["-C", directory, ...args], {
        windowsHide: true,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "BranchNote test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "BranchNote test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        },
      })
    ).stdout.trim();
  await git("init", "--initial-branch=release");
  await git("config", "--local", "core.autocrlf", "false");
  await git("config", "--local", "user.name", "BranchNote test");
  await git("config", "--local", "user.email", "test@example.invalid");
  await writeFile(path.join(directory, "shared.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "initial");
  const change = async (branch: string, file: string, text: string) => {
    await git("switch", "-c", branch, "release");
    await writeFile(path.join(directory, file), text);
    await git("add", ".");
    await git("commit", "-m", `${branch} subject`);
    return git("rev-parse", "HEAD");
  };
  return {
    directory,
    git,
    change,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("读取本地分支、当前分支及最近提交，不包含远程跟踪分支", async () => {
  const f = await fixture();
  try {
    await f.change("feature/中文", "feature.txt", "hello\n");
    await f.git("update-ref", "refs/remotes/origin/remote-only", "HEAD");
    const result = await service.readRepository(f.directory);
    assert.equal(result.branches.length, 2);
    assert.equal(
      result.branches.find((branch) => branch.current)?.name,
      "feature/中文",
    );
    assert.equal(result.branches[0].subject, "feature/中文 subject");
    assert.ok(
      result.path.replaceAll("\\", "/").endsWith(path.basename(f.directory)),
    );
  } finally {
    await f.cleanup();
  }
});

test("干净仓库正常合并，保留功能分支指针", async () => {
  const f = await fixture();
  try {
    const head = await f.change("feature/one", "one.txt", "one\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one"],
      "resolve/test-success",
    );
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "success");
    assert.equal(result.workingBranch, "release");
    assert.equal(await f.git("rev-parse", "refs/heads/feature/one"), head);
    assert.equal(await f.git("rev-parse", "HEAD"), head);
  } finally {
    await f.cleanup();
  }
});

test("可以新建聚合分支再合并，起点分支保持不变", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await f.change("feature/two", "two.txt", "two\n");
    await f.git("switch", "release");
    const baseHead = await f.git("rev-parse", "refs/heads/release");
    const plan = await service.prepareMerge(
      f.directory,
      "integrate/week-46",
      ["feature/one", "feature/two"],
      "resolve/test-create",
      { create: true, base: "release" },
    );
    assert.equal(plan.create, true);
    assert.equal(plan.base, "release");
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "success");
    assert.equal(result.workingBranch, "integrate/week-46");
    // 两个功能提交 + 一次合并提交
    assert.equal(
      await f.git("rev-list", "--count", "release..integrate/week-46"),
      "3",
    );
    assert.equal(await f.git("rev-parse", "refs/heads/release"), baseHead);
    await assert.doesNotReject(
      () => f.git("merge-base", "--is-ancestor", "feature/one", "integrate/week-46"),
    );
    await assert.doesNotReject(
      () => f.git("merge-base", "--is-ancestor", "feature/two", "integrate/week-46"),
    );
  } finally {
    await f.cleanup();
  }
});

test("新建分支与已有本地分支重名时拒绝", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await f.git("switch", "release");
    await assert.rejects(
      () =>
        service.prepareMerge(
          f.directory,
          "release",
          ["feature/one"],
          "resolve/test-dup",
          { create: true, base: "release" },
        ),
      /已有同名分支/,
    );
  } finally {
    await f.cleanup();
  }
});

test("新分支名与已有分支形成 ref 前缀冲突时给出可读提示", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await f.git("switch", "release");
    await assert.rejects(
      () =>
        service.prepareMerge(
          f.directory,
          "release/week-46",
          ["feature/one"],
          "resolve/test-prefix",
          { create: true, base: "release" },
        ),
      /不允许同时存在 release 和 release\//,
    );
  } finally {
    await f.cleanup();
  }
});

test("拒绝有未提交文件的仓库，且不切换分支", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await writeFile(path.join(f.directory, "untracked.txt"), "keep this\n");
    await assert.rejects(
      () =>
        service.prepareMerge(
          f.directory,
          "release",
          ["feature/one"],
          "resolve/dirty",
        ),
      /未提交或未跟踪/,
    );
    assert.equal(await f.git("branch", "--show-current"), "feature/one");
    assert.equal(
      await readFile(path.join(f.directory, "untracked.txt"), "utf8"),
      "keep this\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("预览后目标变化会阻止执行", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one"],
      "resolve/changed",
    );
    await writeFile(path.join(f.directory, "new.txt"), "new\n");
    await f.git("add", ".");
    await f.git("commit", "-m", "changed target");
    await assert.rejects(() => service.executeMerge(plan), /已变化/);
  } finally {
    await f.cleanup();
  }
});

test("冲突时从发布分支建立 resolve，解决提交后可继续剩余合并", async () => {
  const f = await fixture();
  try {
    const oneHead = await f.change("feature/one", "shared.txt", "one\n");
    const twoHead = await f.change("feature/two", "shared.txt", "two\n");
    const threeHead = await f.change("feature/three", "three.txt", "three\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one", "feature/two", "feature/three"],
      "resolve/conflict",
    );
    const outcome = await service.executeMerge(plan);
    assert.equal(outcome.status, "conflict");
    assert.equal(outcome.workingBranch, "resolve/conflict");
    assert.deepEqual(outcome.merged, ["feature/one"]);
    assert.deepEqual(outcome.pending, ["feature/two", "feature/three"]);
    assert.deepEqual(outcome.conflicts, ["shared.txt"]);
    assert.equal(await f.git("rev-parse", "release"), oneHead);
    assert.equal(await f.git("rev-parse", "feature/one"), oneHead);
    assert.equal(await f.git("rev-parse", "feature/two"), twoHead);
    assert.equal(await f.git("rev-parse", "feature/three"), threeHead);
    await writeFile(path.join(f.directory, "shared.txt"), "resolved\n");
    await f.git("add", ".");
    await f.git("commit", "--no-edit");
    const resume = await service.prepareMerge(
      f.directory,
      "resolve/conflict",
      outcome.pending,
      "resolve/conflict",
    );
    const completed = await service.executeMerge(resume);
    assert.equal(completed.status, "success");
    assert.equal(completed.workingBranch, "resolve/conflict");
    assert.equal(
      await readFile(path.join(f.directory, "three.txt"), "utf8"),
      "three\n",
    );
    assert.equal(await f.git("rev-parse", "release"), oneHead);
    assert.equal(await f.git("rev-parse", "feature/two"), twoHead);
  } finally {
    await f.cleanup();
  }
});

test("非仓库文件夹返回可读错误", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "branchnote-empty-test-"),
  );
  try {
    await assert.rejects(
      () => service.readRepository(directory),
      /不属于 Git 仓库/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
