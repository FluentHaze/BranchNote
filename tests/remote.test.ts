import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const service = require("../electron/git.cjs") as {
  parseRemoteUrl(value: string): {
    host: string;
    scheme: string;
    web: string;
    projectPath: string;
    owner: string;
    repo: string;
    provider: string;
  } | null;
  remoteInfo(directory: string): Promise<{
    name: string;
    url: string;
    host: string;
    projectPath: string;
    provider: string;
  } | null>;
  mergeRequestUrl(
    directory: string,
    source: string,
    target: string,
    provider?: string,
  ): Promise<string>;
};

const run = promisify(execFile);
const gitIn = (directory: string) => async (...args: string[]) =>
  (
    await run("git", ["-C", directory, ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
    })
  ).stdout.trim();

// 远程地址解析：GitLab 要完整子组路径，GitHub 要 owner/repo
test("解析 https 形式的 GitLab 子组地址", () => {
  const info = service.parseRemoteUrl("https://gitlab.com/group/sub/repo.git");
  assert.equal(info?.host, "gitlab.com");
  assert.equal(info?.scheme, "https");
  assert.equal(info?.projectPath, "group/sub/repo");
  assert.equal(info?.web, "https://gitlab.com/group/sub/repo");
  assert.equal(info?.provider, "gitlab");
  assert.equal(info?.repo, "repo");
});

test("解析 git@ 形式的自建 GitLab 地址", () => {
  const info = service.parseRemoteUrl("git@gitlab.company.com:team/app.git");
  assert.equal(info?.host, "gitlab.company.com");
  assert.equal(info?.projectPath, "team/app");
  assert.equal(info?.web, "https://gitlab.company.com/team/app");
  assert.equal(info?.provider, "gitlab");
  assert.equal(info?.owner, "team");
});

test("解析 ssh:// 带端口的 GitHub 地址", () => {
  const info = service.parseRemoteUrl("ssh://git@github.com:22/me/branchnote.git");
  assert.equal(info?.host, "github.com");
  assert.equal(info?.projectPath, "me/branchnote");
  assert.equal(info?.provider, "github");
});

test("无法识别的自建域名标记为 other，交由设置页决定平台类型", () => {
  const info = service.parseRemoteUrl("https://git.company.com:8443/team/repo");
  assert.equal(info?.host, "git.company.com:8443");
  assert.equal(info?.provider, "other");
  assert.equal(info?.projectPath, "team/repo");
});

test("本地路径与 file 协议不会被误判成托管平台", () => {
  for (const value of [
    "C:/work/origin.git",
    "c:\\work\\origin.git",
    "/srv/git/origin.git",
    "./relative/repo.git",
    "file:///srv/git/origin.git",
    "",
  ])
    assert.equal(service.parseRemoteUrl(value), null, value);
});

test("remoteInfo 读取 origin，并生成 GitLab MR 创建页", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "branchnote-remote-"));
  try {
    const git = gitIn(directory);
    await git("init", "--initial-branch=main");
    await git(
      "remote",
      "add",
      "origin",
      "git@gitlab.company.com:team/app.git",
    );
    const info = await service.remoteInfo(directory);
    assert.equal(info?.name, "origin");
    assert.equal(info?.provider, "gitlab");
    const url = await service.mergeRequestUrl(directory, "mr/test-1", "test");
    assert.equal(
      url,
      "https://gitlab.company.com/team/app/-/merge_requests/new?merge_request[source_branch]=mr%2Ftest-1&merge_request[target_branch]=test",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("自建 GitLab 域名可由设置声明平台类型，兜底创建页也按 GitLab 生成", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "branchnote-remote-"));
  try {
    const git = gitIn(directory);
    await git("init", "--initial-branch=main");
    await git("remote", "add", "origin", "http://localhost:8929/root/app.git");
    assert.equal((await service.remoteInfo(directory))?.provider, "other");
    assert.equal(await service.mergeRequestUrl(directory, "mr/test-1", "test"), "");
    assert.equal(
      await service.mergeRequestUrl(directory, "mr/test-1", "test", "gitlab"),
      "http://localhost:8929/root/app/-/merge_requests/new?merge_request[source_branch]=mr%2Ftest-1&merge_request[target_branch]=test",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("GitHub 远程给 compare 链接，本地裸仓库不给链接", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "branchnote-remote-"));
  try {
    const git = gitIn(directory);
    await git("init", "--initial-branch=main");
    await git("remote", "add", "origin", "https://github.com/me/app.git");
    assert.equal(
      await service.mergeRequestUrl(directory, "mr/release-1", "release"),
      "https://github.com/me/app/compare/release...mr%2Frelease-1?expand=1",
    );
    await git("remote", "set-url", "origin", path.join(directory, "origin.git"));
    assert.equal(await service.remoteInfo(directory), null);
    assert.equal(await service.mergeRequestUrl(directory, "a", "b"), "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
