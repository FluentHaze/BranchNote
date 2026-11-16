import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import type { GitWorkflow, BranchSyncTarget, FetchResult } from "../src/storage.ts";

const service = createRequire(import.meta.url)("../electron/git.cjs") as {
  readGitWorkflow(directory: string): Promise<GitWorkflow>;
  createLocalBranch(directory: string, name: string, source: string, checkout: boolean): Promise<void>;
  switchLocalBranch(directory: string, ref: string): Promise<void>;
  syncCurrentBranch(directory: string, action: "pull" | "push", target: BranchSyncTarget): Promise<BranchSyncTarget>;
  fetchRepository(directory: string): Promise<FetchResult>;
};
const run = promisify(execFile);
const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_AUTHOR_NAME: "Workflow test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Workflow test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const gitAt = (directory: string) => async (...args: string[]) => (await run("git", ["-C", directory, ...args], { windowsHide: true, env: environment })).stdout.trim();
async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "branchnote-workflow-"));
  const work = path.join(base, "work");
  await mkdir(work);
  const git = gitAt(work);
  const baseGit = gitAt(base);
  await baseGit("init", "--bare", "--initial-branch=main", "origin.git");
  await baseGit("init", "--bare", "--initial-branch=main", "second.git");
  await git("init", "--initial-branch=main");
  await git("config", "core.autocrlf", "false");
  await git("config", "user.name", "Workflow test");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await writeFile(path.join(work, "base.txt"), "base\n");
  await git("add", ".");
  await git("commit", "-m", "base");
  await git("remote", "add", "origin", path.join(base, "origin.git"));
  await git("remote", "add", "second", path.join(base, "second.git"));
  return {base, work, git, baseGit, origin: gitAt(path.join(base, "origin.git")), second: gitAt(path.join(base, "second.git")), cleanup: () => rm(base, {recursive: true, force: true})};
}

test("创建中文及斜杠分支，支持明确起点、仅创建、切换与远程跟踪", async () => {
  const f = await fixture();
  try {
    const head = await f.git("rev-parse", "HEAD");
    await service.createLocalBranch(f.work, "feature/中文", "HEAD", false);
    assert.equal((await service.readGitWorkflow(f.work)).status.branch, "main");
    await service.switchLocalBranch(f.work, "refs/heads/feature/中文");
    assert.equal((await service.readGitWorkflow(f.work)).status.branch, "feature/中文");
    await assert.rejects(service.createLocalBranch(f.work, "feature", "HEAD", true), /前缀冲突/);
    await assert.rejects(service.createLocalBranch(f.work, "feature/中文", "HEAD", false), /已存在/);
    await assert.rejects(service.createLocalBranch(f.work, "bad name", "HEAD", false), /不合法/);
    await assert.rejects(service.createLocalBranch(f.work, "other", "refs/heads/missing", false), /起点已失效/);
    await f.git("push", "origin", "HEAD:refs/heads/remote-only");
    await service.fetchRepository(f.work);
    await service.switchLocalBranch(f.work, "refs/remotes/origin/remote-only");
    const tracking = await service.readGitWorkflow(f.work);
    assert.equal(tracking.status.branch, "remote-only");
    assert.deepEqual(tracking.upstream, { remote: "origin", branch: "remote-only" });
    assert.equal(tracking.status.commit, head);
    await service.createLocalBranch(f.work, "from/remote", "refs/remotes/origin/remote-only", true);
    assert.deepEqual((await service.readGitWorkflow(f.work)).upstream, {remote: "origin", branch: "remote-only"});
    await service.createLocalBranch(f.work, "from/local", "refs/heads/main", true);
    assert.equal((await service.readGitWorkflow(f.work)).upstream, null);
    await f.git("switch", "--detach");
    await service.createLocalBranch(f.work, "from-detached", "HEAD", true);
    assert.equal((await service.readGitWorkflow(f.work)).status.branch, "from-detached");
    await f.baseGit("init", "--initial-branch=unborn", "unborn");
    const unbornPath = path.join(f.base, "unborn");
    await assert.rejects(service.createLocalBranch(unbornPath, "new", "HEAD", true), /尚无首次提交/);
    await gitAt(unbornPath)("remote", "add", "origin", path.join(f.base, "origin.git"));
    await service.fetchRepository(unbornPath);
    await service.createLocalBranch(unbornPath, "bootstrap", "refs/remotes/origin/remote-only", true);
    assert.equal((await service.readGitWorkflow(unbornPath)).status.branch, "bootstrap");
  } finally { await f.cleanup(); }
});

test("脏工作区、未跟踪和未完成操作阻止切换且保留文件", async () => {
  const f = await fixture();
  try {
    await service.createLocalBranch(f.work, "feature", "HEAD", false);
    await writeFile(path.join(f.work, "base.txt"), "working\n");
    await f.git("add", "base.txt");
    const index = await readFile(path.join(f.work, ".git", "index"));
    await assert.rejects(service.switchLocalBranch(f.work, "refs/heads/feature"), /未提交|不干净/);
    await assert.rejects(service.createLocalBranch(f.work, "new", "HEAD", true), /不干净/);
    assert.equal(await readFile(path.join(f.work, "base.txt"), "utf8"), "working\n");
    assert.deepEqual(await readFile(path.join(f.work, ".git", "index")), index);
    await service.createLocalBranch(f.work, "create-only", "HEAD", false);
    assert.equal((await service.readGitWorkflow(f.work)).status.branch, "main");
    await f.git("reset", "--hard", "HEAD");
    await mkdir(path.join(f.work, ".git", "sequencer"));
    await assert.rejects(service.switchLocalBranch(f.work, "refs/heads/feature"), /外部 Git/);
  } finally { await f.cleanup(); }
});

test("首次推送明确指定远程并建立上游，空远程也能 Fetch", async () => {
  const f = await fixture();
  try {
    const fetch = await service.fetchRepository(f.work);
    assert.deepEqual(fetch.remoteResults.map(item => [item.remote, item.success]), [["origin", true], ["second", true]]);
    const target = {branch: "main", remote: "second", target: "main"};
    await service.syncCurrentBranch(f.work, "push", target);
    assert.deepEqual((await service.readGitWorkflow(f.work)).upstream, {remote: "second", branch: "main"});
    assert.equal(await f.second("rev-parse", "refs/heads/main"), await f.git("rev-parse", "HEAD"));
    await assert.rejects(f.origin("rev-parse", "refs/heads/main"));
    await assert.rejects(service.syncCurrentBranch(f.work, "push", {...target, remote: "origin"}), /上游.*变化/);
    await assert.rejects(service.syncCurrentBranch(f.work, "push", {...target, branch: "stale"}), /分支已变化/);
    await f.git("push", "-u", "origin", "main:alias");
    assert.deepEqual((await service.readGitWorkflow(f.work)).upstream, {remote: "origin", branch: "alias"});
    await service.syncCurrentBranch(f.work, "push", {branch: "main", remote: "origin", target: "alias"});
    await f.git("remote", "add", "broken", path.join(f.base, "not-a-remote"));
    const partial = await service.fetchRepository(f.work);
    assert.equal(partial.remoteResults.find(item => item.remote === "broken")?.success, false);
    assert.equal(partial.remoteResults.find(item => item.remote === "origin")?.success, true);
  } finally { await f.cleanup(); }
});

test("快进拉取正确更新，脏工作区与分叉停止，拒绝推送不改写远程", async () => {
  const f = await fixture();
  try {
    const target = {branch: "main", remote: "origin", target: "main"};
    await service.syncCurrentBranch(f.work, "push", target);
    await f.baseGit("clone", path.join(f.base, "origin.git"), "peer");
    const peerPath = path.join(f.base, "peer");
    const peer = gitAt(peerPath);
    await peer("config", "core.autocrlf", "false");
    await writeFile(path.join(peerPath, "remote.txt"), "remote\n");
    await peer("add", "."); await peer("commit", "-m", "remote update"); await peer("push");
    const before = await f.git("rev-parse", "HEAD");
    await service.fetchRepository(f.work);
    assert.equal(await f.git("rev-parse", "HEAD"), before);
    assert.equal((await service.readGitWorkflow(f.work)).status.behind, 1);
    await writeFile(path.join(f.work, "untracked.txt"), "keep\n");
    await assert.rejects(service.syncCurrentBranch(f.work, "pull", target), /不干净/);
    await rm(path.join(f.work, "untracked.txt"));
    await service.syncCurrentBranch(f.work, "pull", target);
    assert.equal(await f.git("rev-parse", "HEAD"), await peer("rev-parse", "HEAD"));
    await writeFile(path.join(f.work, "local.txt"), "local\n");
    await f.git("add", "."); await f.git("commit", "-m", "local");
    const localHead = await f.git("rev-parse", "HEAD");
    await writeFile(path.join(peerPath, "remote.txt"), "another remote\n");
    await peer("commit", "-am", "remote again"); await peer("push");
    const remoteHead = await peer("rev-parse", "HEAD");
    await assert.rejects(service.syncCurrentBranch(f.work, "push", target), /远端已有新提交/);
    await assert.rejects(service.syncCurrentBranch(f.work, "pull", target), /分叉/);
    assert.equal(await f.git("rev-parse", "HEAD"), localHead);
    assert.equal(await f.origin("rev-parse", "refs/heads/main"), remoteHead);
    assert.equal((await service.readGitWorkflow(f.work)).status.operations.length, 0);
  } finally { await f.cleanup(); }
});
