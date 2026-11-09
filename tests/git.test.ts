import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import type {
  AbortResult,
  CommitResult,
  ConflictFile,
  ConflictResolution,
  ContinueResult,
  FinalizeResult,
  Repository,
  MergePlan,
  MergeResult,
  MergeState,
  FetchResult,
  PushResult,
  PreflightResult,
} from "../src/storage.ts";

const require = createRequire(import.meta.url);
const service = require("../electron/git.cjs") as {
  readRepository(directory: string): Promise<Repository>;
  fetchRepository(directory: string): Promise<FetchResult>;
  prepareMerge(
    directory: string,
    target: string,
    sources: string[],
    resolveBranch: string,
    options?: { create?: boolean; base?: string; stage?: string; mrTarget?: string },
  ): Promise<MergePlan>;
  checkMerge(plan: MergePlan): Promise<PreflightResult>;
  executeMerge(plan: MergePlan, meta?: {resolveConflicts?: boolean; directSource?: boolean; integrateFirst?: boolean}): Promise<MergeResult>;
  pushBranch(
    directory: string,
    branch: string,
    remote?: string,
    checkedSource?: {ref: string; head: string},
  ): Promise<PushResult>;
  readMergeState(directory: string): Promise<MergeState>;
  readConflictFile(directory: string, file: string): Promise<ConflictFile>;
  resolveConflictFile(
    directory: string,
    file: string,
    content: string,
  ): Promise<ConflictResolution>;
  takeConflictSide(
    directory: string,
    file: string,
    side: "ours" | "theirs",
  ): Promise<ConflictResolution>;
  unionConflictFile(
    directory: string,
    file: string,
  ): Promise<{ file: string; content: string }>;
  commitResolution(directory: string, message: string): Promise<CommitResult>;
  abortMerge(directory: string, returnTo: string): Promise<AbortResult>;
  continueMerge(
    directory: string,
    branch: string,
    sources: string[],
  ): Promise<ContinueResult>;
  finalizeMerge(
    directory: string,
    targetLocal: string,
    from: string,
  ): Promise<FinalizeResult>;
};
const run = promisify(execFile);
const identity = {
  GIT_AUTHOR_NAME: "BranchNote test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "BranchNote test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
};
const gitIn = (directory: string) => async (...args: string[]) =>
  (
    await run("git", ["-C", directory, ...args], {
      windowsHide: true,
      env: { ...process.env, ...identity },
    })
  ).stdout.trim();
// Windows 克隆默认开启 core.autocrlf，比较文件内容时统一换行
const readText = async (file: string) =>
  (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
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

// 带远程仓库的沙箱：origin 为裸仓库，work / peer 是两套工作副本
async function remoteFixture() {
  const base = await mkdtemp(path.join(tmpdir(), "branchnote-remote-test-"));
  const origin = path.join(base, "origin.git");
  const seed = path.join(base, "seed");
  const work = path.join(base, "work");
  const peer = path.join(base, "peer");
  const seedGit = gitIn(seed);
  const workGit = gitIn(work);
  const peerGit = gitIn(peer);
  const originGit = gitIn(origin);
  const bare = (args: string[]) =>
    run("git", args, { windowsHide: true, env: { ...process.env, ...identity } });
  await mkdir(seed, { recursive: true });
  await seedGit("init", "--initial-branch=main");
  await seedGit("config", "user.name", "BranchNote test");
  await seedGit("config", "user.email", "test@example.invalid");
  await writeFile(path.join(seed, "app.txt"), "base\n");
  await seedGit("add", ".");
  await seedGit("commit", "-m", "初始提交");
  await seedGit("switch", "-c", "release/week-45");
  await writeFile(path.join(seed, "release.txt"), "v1\n");
  await seedGit("add", ".");
  await seedGit("commit", "-m", "发布分支初始内容");
  await seedGit("switch", "-c", "feature/remote-only");
  await writeFile(path.join(seed, "remote.txt"), "remote\n");
  await seedGit("add", ".");
  await seedGit("commit", "-m", "只在远程的功能分支");
  await seedGit("switch", "main");
  await bare(["init", "--bare", "--initial-branch=main", origin]);
  await seedGit("remote", "add", "origin", origin);
  await seedGit("push", "origin", "--all");
  for (const [directory, git] of [
    [work, workGit],
    [peer, peerGit],
  ] as const) {
    await bare(["clone", origin, directory]);
    await git("config", "user.name", "BranchNote test");
    await git("config", "user.email", "test@example.invalid");
  }
  return {
    origin,
    seed,
    work,
    peer,
    seedGit,
    workGit,
    peerGit,
    originGit,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

test("同时读取本地与远程分支，并标注当前分支和跟踪信息", async () => {
  const f = await fixture();
  try {
    await f.change("feature/中文", "feature.txt", "hello\n");
    await f.git("update-ref", "refs/remotes/origin/remote-only", "HEAD");
    const result = await service.readRepository(f.directory);
    assert.equal(result.branches.length, 3);
    const current = result.branches.find((branch) => branch.current);
    assert.equal(current?.name, "feature/中文");
    assert.equal(result.current, "feature/中文");
    assert.equal(current?.local, true);
    assert.equal(current?.subject, "feature/中文 subject");
    const remote = result.branches.find(
      (branch) => branch.name === "remote-only",
    );
    assert.equal(remote?.local, false);
    assert.equal(remote?.remote, "origin");
    assert.equal(remote?.remoteRef, "origin/remote-only");
    assert.equal(remote?.remoteCommit, remote?.commit);
    assert.deepEqual(result.remotes, ["origin"]);
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

test("更新分支拉取远程新提交，并清理已删除的远程分支", async () => {
  const f = await remoteFixture();
  try {
    const before = await service.readRepository(f.work);
    const release = before.branches.find(
      (branch) => branch.name === "release/week-45",
    );
    assert.equal(release?.local, false);
    assert.equal(release?.remoteRef, "origin/release/week-45");
    assert.equal(release?.remote, "origin");
    assert.deepEqual(before.remotes, ["origin"]);

    // 同伴推进发布分支，同时新增一条远程分支、删除一条
    await f.peerGit("fetch", "origin");
    await f.peerGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await writeFile(path.join(f.peer, "release.txt"), "v2\n");
    await f.peerGit("add", ".");
    await f.peerGit("commit", "-m", "远程新提交");
    await f.peerGit("push", "origin", "release/week-45");
    await f.seedGit("push", "origin", "--delete", "feature/remote-only");
    await f.seedGit("switch", "-c", "feature/added", "main");
    await writeFile(path.join(f.seed, "added.txt"), "added\n");
    await f.seedGit("add", ".");
    await f.seedGit("commit", "-m", "新增远程分支");
    await f.seedGit("push", "origin", "feature/added");
    await f.seedGit("switch", "main");

    const result = await service.fetchRepository(f.work);
    assert.deepEqual(result.errors, []);
    assert.ok(result.updated.some((item) => item.name === "release/week-45"));
    assert.ok(result.added.includes("feature/added"));
    assert.ok(result.removed.includes("feature/remote-only"));
    const after = result.repository.branches.find(
      (branch) => branch.name === "release/week-45",
    );
    assert.notEqual(after?.remoteCommit, release?.remoteCommit);
  } finally {
    await f.cleanup();
  }
});

test("以远程发布分支为目标时创建跟踪分支，远程引用保持不动", async () => {
  const f = await remoteFixture();
  try {
    await f.workGit("switch", "-c", "feature/login", "main");
    await writeFile(path.join(f.work, "login.txt"), "login\n");
    await f.workGit("add", ".");
    await f.workGit("commit", "-m", "登录功能");
    await f.workGit("switch", "main");
    const remoteBefore = await f.originGit(
      "rev-parse",
      "refs/heads/release/week-45",
    );
    const plan = await service.prepareMerge(
      f.work,
      "origin/release/week-45",
      ["feature/login"],
      "resolve/remote-target",
    );
    assert.equal(plan.targetMode, "remote");
    assert.equal(plan.targetLocal, "release/week-45");
    assert.equal(plan.targetRemoteRef, "origin/release/week-45");
    assert.equal(plan.localHead, null);

    const result = await service.executeMerge(plan);
    assert.equal(result.status, "success");
    assert.equal(result.workingBranch, "release/week-45");
    assert.equal(result.fastForwarded, false);
    assert.equal(result.remoteRef, "origin/release/week-45");
    assert.equal(
      await f.originGit("rev-parse", "refs/heads/release/week-45"),
      remoteBefore,
    );
    assert.equal(
      await f.workGit(
        "rev-parse",
        "--abbrev-ref",
        "release/week-45@{upstream}",
      ),
      "origin/release/week-45",
    );
    assert.equal(
      await readText(path.join(f.work, "login.txt")),
      "login\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("本地发布分支落后远程时先快进，再合入功能分支", async () => {
  const f = await remoteFixture();
  try {
    await f.workGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await f.workGit("switch", "main");
    await f.peerGit("fetch", "origin");
    await f.peerGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await writeFile(path.join(f.peer, "release.txt"), "v2\n");
    await f.peerGit("add", ".");
    await f.peerGit("commit", "-m", "远程新提交");
    await f.peerGit("push", "origin", "release/week-45");
    await service.fetchRepository(f.work);
    const behind = (await service.readRepository(f.work)).branches.find(
      (branch) => branch.name === "release/week-45",
    );
    assert.equal(behind?.behind, 1);

    await f.workGit("switch", "-c", "feature/other", "main");
    await writeFile(path.join(f.work, "other.txt"), "other\n");
    await f.workGit("add", ".");
    await f.workGit("commit", "-m", "另一个功能");
    await f.workGit("switch", "main");
    const plan = await service.prepareMerge(
      f.work,
      "origin/release/week-45",
      ["feature/other"],
      "resolve/fast-forward",
    );
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "success");
    assert.equal(result.fastForwarded, true);
    assert.equal(
      await readText(path.join(f.work, "release.txt")),
      "v2\n",
    );
    assert.equal(
      await readText(path.join(f.work, "other.txt")),
      "other\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("本地发布分支与远程分叉时拒绝合并", async () => {
  const f = await remoteFixture();
  try {
    await f.workGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await writeFile(path.join(f.work, "local-only.txt"), "local\n");
    await f.workGit("add", ".");
    await f.workGit("commit", "-m", "只在本地");
    await f.workGit("switch", "main");
    await f.peerGit("fetch", "origin");
    await f.peerGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await writeFile(path.join(f.peer, "release.txt"), "v2\n");
    await f.peerGit("add", ".");
    await f.peerGit("commit", "-m", "远程新提交");
    await f.peerGit("push", "origin", "release/week-45");
    await service.fetchRepository(f.work);

    await f.workGit("switch", "-c", "feature/one", "main");
    await writeFile(path.join(f.work, "one.txt"), "one\n");
    await f.workGit("add", ".");
    await f.workGit("commit", "-m", "功能提交");
    await f.workGit("switch", "main");
    const plan = await service.prepareMerge(
      f.work,
      "origin/release/week-45",
      ["feature/one"],
      "resolve/diverged",
    );
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "failed");
    assert.match(result.message, /不能自动快进/);
    assert.equal(await f.workGit("branch", "--show-current"), "main");
  } finally {
    await f.cleanup();
  }
});

test("可以直接合并只存在于远程的功能分支", async () => {
  const f = await remoteFixture();
  try {
    const plan = await service.prepareMerge(
      f.work,
      "main",
      ["origin/feature/remote-only"],
      "resolve/remote-source",
    );
    assert.equal(
      plan.sources[0].ref,
      "refs/remotes/origin/feature/remote-only",
    );
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "success");
    assert.equal(
      await readText(path.join(f.work, "remote.txt")),
      "remote\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("推送本地发布分支到远程仓库", async () => {
  const f = await remoteFixture();
  try {
    await f.workGit(
      "switch",
      "-c",
      "release/week-45",
      "--track",
      "origin/release/week-45",
    );
    await writeFile(path.join(f.work, "release.txt"), "v2\n");
    await f.workGit("add", ".");
    await f.workGit("commit", "-m", "准备发布");
    const result = await service.pushBranch(f.work, "release/week-45", "origin");
    assert.equal(result.remote, "origin");
    assert.equal(result.branch, "release/week-45");
    assert.equal(
      await f.originGit("rev-parse", "refs/heads/release/week-45"),
      await f.workGit("rev-parse", "HEAD"),
    );
  } finally {
    await f.cleanup();
  }
});

test("没有远程仓库时更新分支给出可读提示", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => service.fetchRepository(f.directory),
      /没有配置远程仓库/,
    );
  } finally {
    await f.cleanup();
  }
});

test("推送参数不合法时给出明确提示，而不是笼统的路径错误", async () => {
  const f = await remoteFixture();
  try {
    // 旧实现会把分支名当成仓库路径传进来，症状是“请选择有效的本地仓库文件夹”
    await assert.rejects(
      () => service.pushBranch("release/week-45", "origin"),
      /没有拿到仓库路径/,
    );
    await assert.rejects(
      () => service.pushBranch(f.work, ""),
      /没有指定要推送的本地分支/,
    );
    await assert.rejects(
      () => service.pushBranch(f.work, "feature/不存在", "origin"),
      /本地分支 feature\/不存在 不存在/,
    );
  } finally {
    await f.cleanup();
  }
});

test("冲突分支名留空时自动生成", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "one.txt", "one\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one"],
      "",
      { stage: "test" },
    );
    assert.match(plan.resolveBranch, /^resolve\/\d{14}$/);
    assert.equal(plan.stage, "test");
  } finally {
    await f.cleanup();
  }
});

test("应用内读取三方内容、编辑解决、提交并继续合并", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "shared.txt", "one\n");
    await f.change("feature/two", "shared.txt", "two\n");
    await f.change("feature/three", "three.txt", "three\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one", "feature/two", "feature/three"],
      "",
      { stage: "test" },
    );
    const outcome = await service.executeMerge(plan);
    assert.equal(outcome.status, "conflict");
    assert.deepEqual(outcome.conflicts, ["shared.txt"]);
    assert.deepEqual(outcome.pending, ["feature/two", "feature/three"]);

    const state = await service.readMergeState(f.directory);
    assert.equal(state.merging, true);
    assert.deepEqual(state.unmerged, ["shared.txt"]);
    assert.equal(state.session?.stage, "test");
    assert.deepEqual(state.session?.pending, ["feature/two", "feature/three"]);

    const file = await service.readConflictFile(f.directory, "shared.txt");
    assert.equal(file.base, "base\n");
    assert.equal(file.ours, "one\n");
    assert.equal(file.theirs, "two\n");
    assert.equal(file.binary, false);
    assert.match(file.working || "", /<{7}/);

    const resolved = await service.resolveConflictFile(
      f.directory,
      "shared.txt",
      "merged\n",
    );
    assert.deepEqual(resolved.unmerged, []);
    const commit = await service.commitResolution(f.directory, "");
    assert.match(commit.commit, /^[0-9a-f]{40}$/);

    const rest = await service.continueMerge(
      f.directory,
      outcome.workingBranch,
      outcome.pending,
    );
    assert.equal(rest?.status, "success");
    assert.deepEqual(rest?.merged, ["feature/two", "feature/three"]);

    const finalized = await service.finalizeMerge(
      f.directory,
      "release",
      outcome.workingBranch,
    );
    assert.equal(finalized.branch, "release");
    assert.deepEqual(finalized.removed, [outcome.workingBranch]);
    assert.equal(await readText(path.join(f.directory, "shared.txt")), "merged\n");
    assert.equal(await readText(path.join(f.directory, "three.txt")), "three\n");
    assert.equal(await f.git("branch", "--show-current"), "release");
    const finalState = await service.readMergeState(f.directory);
    assert.equal(finalState.session, null);
    assert.equal(finalState.merging, false);
    assert.ok(!(await f.git("branch", "--format=%(refname:short)")).includes("resolve/"));
  } finally {
    await f.cleanup();
  }
});

test("冲突文件可以整份采用对方版本", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "shared.txt", "one\n");
    await f.change("feature/two", "shared.txt", "two\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one", "feature/two"],
      "",
    );
    const outcome = await service.executeMerge(plan);
    assert.equal(outcome.status, "conflict");

    const state = await service.takeConflictSide(f.directory, "shared.txt", "theirs");
    assert.deepEqual(state.unmerged, []);
    assert.equal(await readText(path.join(f.directory, "shared.txt")), "two\n");
    await service.commitResolution(f.directory, "采用对方版本");
    await service.finalizeMerge(f.directory, "release", outcome.workingBranch);
    assert.equal(await readText(path.join(f.directory, "shared.txt")), "two\n");
  } finally {
    await f.cleanup();
  }
});

test("放弃合并会切回原分支并删除临时分支", async () => {
  const f = await fixture();
  try {
    await f.change("feature/one", "shared.txt", "one\n");
    await f.change("feature/two", "shared.txt", "two\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one", "feature/two"],
      "",
    );
    const outcome = await service.executeMerge(plan);
    assert.equal(outcome.status, "conflict");

    const result = await service.abortMerge(f.directory, "release");
    assert.equal(result.branch, "release");
    assert.ok(result.removed.includes(outcome.workingBranch));
    // 已经合入的目标分支提交会保留
    assert.equal(await readText(path.join(f.directory, "shared.txt")), "one\n");
    const state = await service.readMergeState(f.directory);
    assert.equal(state.merging, false);
    assert.equal(state.session, null);
    assert.ok(!(await f.git("branch", "--format=%(refname:short)")).includes("resolve/"));
  } finally {
    await f.cleanup();
  }
});

test("冲突文件路径不能越过仓库目录", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => service.readConflictFile(f.directory, "../outside.txt"),
      /仓库范围/,
    );
    await assert.rejects(
      () => service.resolveConflictFile(f.directory, "../outside.txt", "x"),
      /仓库范围/,
    );
    await assert.rejects(
      () => service.takeConflictSide(f.directory, "", "ours"),
      /路径为空/,
    );
  } finally {
    await f.cleanup();
  }
});

test("两边都要按三方合并，公共内容不会重复", async () => {
  const f = await fixture();
  try {
    // 两个分支都在同一行后面追加内容，构造真实的冲突
    await f.change("feature/one", "shared.txt", "base\n\n// one\n");
    await f.change("feature/two", "shared.txt", "base\n\n// two\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(
      f.directory,
      "release",
      ["feature/one", "feature/two"],
      "",
    );
    const outcome = await service.executeMerge(plan);
    assert.equal(outcome.status, "conflict");

    const union = await service.unionConflictFile(f.directory, "shared.txt");
    // 公共的 base 只出现一次，两边新增内容都保留
    assert.equal(union.content.match(/^base$/gm)?.length, 1);
    assert.match(union.content, /\/\/ one/);
    assert.match(union.content, /\/\/ two/);
    assert.ok(!/^<{7}|^={7}|^>{7}/m.test(union.content));

    // 合并结果可以正常写入并标记解决
    const state = await service.resolveConflictFile(
      f.directory,
      "shared.txt",
      union.content,
    );
    assert.deepEqual(state.unmerged, []);
  } finally {
    await f.cleanup();
  }
});

test("MR 批量汇总及冲突恢复不修改功能和目标分支", async () => {
  const f = await fixture();
  try {
    const targetHead = await f.git("rev-parse", "release");
    const a = await f.change("feature/mr-a", "shared.txt", "first\n");
    const b = await f.change("feature/mr-b", "shared.txt", "second\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(f.directory, "mr/test-batch",
      ["feature/mr-a", "feature/mr-b"], "", {create: true, base: "release", stage: "test", mrTarget: "origin/release"});
    const result = await service.executeMerge(plan);
    assert.equal(result.status, "conflict");
    assert.match(result.workingBranch, /^resolve\//);
    const state = await service.readMergeState(f.directory);
    assert.equal(state.session?.mrTarget, "origin/release");
    assert.equal(state.session?.targetLocal, "mr/test-batch");
    await service.takeConflictSide(f.directory, "shared.txt", "theirs");
    await service.commitResolution(f.directory, "");
    const continued = await service.continueMerge(f.directory, result.workingBranch, result.pending);
    assert.equal(continued.status, "success");
    await service.finalizeMerge(f.directory, "mr/test-batch", result.workingBranch);
    assert.equal(await f.git("rev-parse", "release"), targetHead);
    assert.equal(await f.git("rev-parse", "feature/mr-a"), a);
    assert.equal(await f.git("rev-parse", "feature/mr-b"), b);
    assert.equal(await readText(path.join(f.directory, "shared.txt")), "second\n");
  } finally { await f.cleanup(); }
});

test("MR 可以从非首选远程的目标分支建立集成分支", async () => {
  const f = await fixture();
  try {
    await f.git("remote", "add", "origin", f.directory);
    await f.git("remote", "add", "gitlab", f.directory);
    const head = await f.git("rev-parse", "release");
    await f.git("update-ref", "refs/remotes/origin/release", head);
    await f.git("update-ref", "refs/remotes/gitlab/release", head);
    await f.change("feature/secondary", "secondary.txt", "feature\n");
    await f.git("switch", "release");
    const plan = await service.prepareMerge(f.directory, "mr/secondary", ["feature/secondary"], "",
      {create:true, base:"gitlab/release", stage:"release", mrTarget:"gitlab/release"});
    assert.equal(plan.baseRef, "refs/remotes/gitlab/release");
    assert.equal((await service.executeMerge(plan)).status, "success");
    assert.equal(await f.git("rev-parse", "release"), head);
  } finally { await f.cleanup(); }
});

test("提交前冲突检查不切换当前分支、不改写功能分支或工作区", async () => {
  const f = await fixture();
  try {
    const base = await f.git("rev-parse", "release");
    const a = await f.change("feature/check-a", "shared.txt", "one\n");
    const b = await f.change("feature/check-b", "shared.txt", "two\n");
    const plan = await service.prepareMerge(f.directory, "mr/check", ["feature/check-a", "feature/check-b"], "",
      {create:true, base:"release", stage:"test", mrTarget:"origin/release"});
    const refs = await f.git("show-ref");
    const index = await f.git("ls-files", "--stage");
    const result = await service.checkMerge(plan);
    assert.equal(result.status, "conflict");
    assert.deepEqual(result.files, ["shared.txt"]);
    assert.equal(result.branch, "feature/check-b");
    assert.equal(await f.git("branch", "--show-current"), "feature/check-b");
    assert.equal(await f.git("show-ref"), refs);
    assert.equal(await f.git("ls-files", "--stage"), index);
    assert.equal(await f.git("status", "--porcelain"), "");
    assert.equal(await readText(path.join(f.directory,"shared.txt")), "two\n");
    // 用户确认后才在 resolve 分支上执行真实合并。
    const actual = await service.executeMerge(plan, {resolveConflicts:true});
    assert.equal(actual.status, "conflict");
    assert.equal(actual.targetLocal, plan.resolveBranch);
    assert.equal(actual.workingBranch, plan.resolveBranch);
    assert.equal(await f.git("rev-parse", "feature/check-a"), a);
    assert.equal(await f.git("rev-parse", "feature/check-b"), b);
    assert.equal(await f.git("rev-parse", "release"), base);
    await service.takeConflictSide(f.directory, "shared.txt", "theirs");
    await service.commitResolution(f.directory, "");
    const continued = await service.continueMerge(f.directory, actual.workingBranch, actual.pending);
    assert.equal(continued.status, "success");
    assert.equal(await f.git("status","--porcelain"), "");
    assert.equal(await f.git("rev-parse", "feature/check-a"), a);
    assert.equal(await f.git("rev-parse", "feature/check-b"), b);
  } finally { await f.cleanup(); }
});
test("无冲突的批量检查不会创建 mr 或 resolve 分支", async () => {
  const f = await fixture();
  try {
    await f.change("feature/clean-a","a.txt","a\n");
    await f.change("feature/clean-b","b.txt","b\n");
    await f.git("switch","release");
    const plan = await service.prepareMerge(f.directory,"mr/clean",["feature/clean-a","feature/clean-b"],"",
      {create:true,base:"release",stage:"release",mrTarget:"origin/release"});
    const refs=await f.git("show-ref");
    assert.equal((await service.checkMerge(plan)).status,"clean");
    assert.equal(await f.git("show-ref"),refs);
    assert.equal(await f.git("branch","--show-current"),"release");
    assert.equal(await f.git("status","--porcelain"),"");
  } finally { await f.cleanup(); }
});

test("确认创建 resolve 后仍可放弃，返回原功能分支且清理临时分支", async () => {
  const f = await fixture();
  try {
    await f.change("feature/abort-a","shared.txt","a\n");
    const head = await f.change("feature/abort-b","shared.txt","b\n");
    const plan = await service.prepareMerge(f.directory,"mr/abort-check",["feature/abort-a","feature/abort-b"],"",
      {create:true,base:"release",mrTarget:"origin/release"});
    assert.equal((await service.checkMerge(plan)).status,"conflict");
    const actual = await service.executeMerge(plan,{resolveConflicts:true});
    const aborted = await service.abortMerge(f.directory,"");
    assert.equal(aborted.branch,"feature/abort-b");
    assert.ok(aborted.removed.includes(actual.workingBranch));
    assert.equal(await f.git("status","--porcelain"),"");
    assert.equal(await f.git("rev-parse","feature/abort-b"),head);
  } finally { await f.cleanup(); }
});

test("自定义 MR 目标 ID 在冲突恢复会话中保留", async () => {
  const f = await fixture();
  try {
    await f.change("feature/custom-a","shared.txt","a\n");
    await f.change("feature/custom-b","shared.txt","b\n");
    const plan=await service.prepareMerge(f.directory,"mr/custom",["feature/custom-a","feature/custom-b"],"",
      {create:true,base:"release",stage:"qa-second",mrTarget:"origin/qa2"});
    assert.equal(plan.stage,"qa-second");
    assert.equal((await service.checkMerge(plan)).status,"conflict");
    await service.executeMerge(plan,{resolveConflicts:true});
    assert.equal((await service.readMergeState(f.directory)).session?.stage,"qa-second");
  } finally { await f.cleanup(); }
});

test("单分支无冲突直接作为 MR 源分支，不创建整合分支也不切换工作区", async () => {
  const f=await fixture();
  try {
    const head=await f.change("feature/direct","direct.txt","direct\n");
    const before=await f.git("show-ref");
    const plan=await service.prepareMerge(f.directory,"mr/unused",["feature/direct"],"resolve",{create:true,base:"release",mrTarget:"origin/release"});
    assert.equal((await service.checkMerge(plan)).status,"clean");
    const result=await service.executeMerge(plan,{directSource:true,integrateFirst:true});
    assert.equal(result.targetLocal,"feature/direct");
    assert.equal(result.sourceRef,"refs/heads/feature/direct");
    assert.equal(result.sourceHead,head);
    assert.equal(await f.git("show-ref"),before);
    assert.equal(await f.git("branch","--show-current"),"feature/direct");
    assert.equal(await f.git("status","--porcelain"),"");
  } finally { await f.cleanup(); }
});
test("远程单分支可直接推送到目标远程，不创建同名本地分支", async () => {
  const f=await remoteFixture();
  try {
    const plan=await service.prepareMerge(f.work,"mr/unused",["origin/feature/remote-only"],"resolve",
      {create:true,base:"origin/release/week-45",mrTarget:"origin/release/week-45"});
    assert.equal((await service.checkMerge(plan)).status,"clean");
    const result=await service.executeMerge(plan,{directSource:true,integrateFirst:true});
    await service.pushBranch(f.work,result.targetLocal,"origin",{ref:result.sourceRef!,head:result.sourceHead!});
    assert.equal(await gitIn(f.work)("branch","--list","feature/remote-only"),"");
    assert.equal(await gitIn(f.work)("status","--porcelain"),"");
  } finally { await f.cleanup(); }
});
test("多分支先整合，再在用户指定分支处理目标冲突，功能分支保持不变", async () => {
  const f=await fixture();
  try {
    const a=await f.change("feature/combined-a","shared.txt","feature\n");
    const b=await f.change("feature/combined-b","b.txt","b\n");
    await f.git("switch","release");
    await writeFile(path.join(f.directory,"shared.txt"),"target\n");
    await f.git("add",".");
    await f.git("commit","-m","target");
    const target=await f.git("rev-parse","HEAD");
    const plan=await service.prepareMerge(f.directory,"mr/batch","feature/combined-a,feature/combined-b".split(","),"fixes/review",
      {create:true,base:"release",mrTarget:"release"});
    const checked=await service.checkMerge(plan);
    assert.equal(checked.status,"conflict");
    assert.equal(checked.branch,"release");
    const result=await service.executeMerge(plan,{resolveConflicts:true,integrateFirst:true});
    assert.equal(result.workingBranch,"fixes/review");
    assert.equal(await readText(path.join(f.directory,"b.txt")),"b\n");
    await service.takeConflictSide(f.directory,"shared.txt","ours");
    await service.commitResolution(f.directory,"");
    assert.equal((await service.continueMerge(f.directory,result.workingBranch,result.pending)).status,"success");
    assert.equal(await f.git("rev-parse","feature/combined-a"),a);
    assert.equal(await f.git("rev-parse","feature/combined-b"),b);
    assert.equal(await f.git("rev-parse","release"),target);
  } finally { await f.cleanup(); }
});
