import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import type { Workspace, WorkspaceDiff, WorkspaceGroup, WorkspaceCommitResult } from "../src/storage.ts";

const service = createRequire(import.meta.url)("../electron/git.cjs") as {
  readWorkspace(directory: string): Promise<Workspace>;
  readWorkspaceDiff(directory: string, file: string, group: WorkspaceGroup): Promise<WorkspaceDiff>;
  updateWorkspaceIndex(directory: string, action: "stage" | "unstage", files: string[] | null): Promise<void>;
  commitWorkspace(directory: string, title: string, body: string): Promise<WorkspaceCommitResult>;
};
const run = promisify(execFile);
async function fixture(initial = true) {
  const root = await mkdtemp(path.join(tmpdir(), "branchnote-workspace-"));
  const git = async (...args: string[]) => (await run("git", ["-C", root, ...args], {
    windowsHide: true,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_AUTHOR_NAME: "Workspace test", GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Workspace test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
  })).stdout;
  await git("init", "--initial-branch=main");
  await git("config", "core.autocrlf", "false");
  await git("config", "user.name", "Workspace test");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await writeFile(path.join(root, "中文 文件.txt"), "base\n");
  await writeFile(path.join(root, "removed.txt"), "delete me\n");
  if (initial) {
    await git("add", ".");
    await git("commit", "-m", "base");
  }
  return { root, git, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("工作区分组隔离暂存与未暂存差异，读取不修改 HEAD、索引或文件", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "中文 文件.txt"), "staged only\n");
    await f.git("add", "中文 文件.txt");
    await writeFile(path.join(f.root, "中文 文件.txt"), "worktree only\n");
    const head = await f.git("rev-parse", "HEAD");
    const index = await readFile(path.join(f.root, ".git", "index"));
    const workspace = await service.readWorkspace(f.root);
    assert.deepEqual(workspace.files.map(file => [file.path, file.group, file.status]), [
      ["中文 文件.txt", "staged", "M"], ["中文 文件.txt", "unstaged", "M"],
    ]);
    await f.git("config", "diff.external", "nonexistent-diff-command");
    const staged = await service.readWorkspaceDiff(f.root, "中文 文件.txt", "staged");
    const unstaged = await service.readWorkspaceDiff(f.root, "中文 文件.txt", "unstaged");
    assert.ok(staged.text.includes("+staged only"));
    assert.ok(!staged.text.includes("worktree only"));
    assert.ok(unstaged.text.includes("-staged only"));
    assert.ok(unstaged.text.includes("+worktree only"));
    assert.deepEqual(await readFile(path.join(f.root, ".git", "index")), index);
    assert.equal(await f.git("rev-parse", "HEAD"), head);
    assert.equal(await readFile(path.join(f.root, "中文 文件.txt"), "utf8"), "worktree only\n");
  } finally { await f.cleanup(); }
});

test("工作区正确解析重命名、删除和特殊路径，diff 路径不按通配符展开", async () => {
  const f = await fixture();
  try {
    await f.git("mv", "中文 文件.txt", "新 文件.txt");
    await rm(path.join(f.root, "removed.txt"));
    for (const file of ["[abc].txt", "a.txt", "-option.txt"]) await writeFile(path.join(f.root, file), file + "\n");
    await f.git("add", ".");
    const workspace = await service.readWorkspace(f.root);
    const renamed = workspace.files.find(file => file.status === "R");
    assert.equal(renamed?.path, "新 文件.txt");
    assert.equal(renamed?.originalPath, "中文 文件.txt");
    assert.ok(workspace.files.some(file => file.status === "D" && file.path === "removed.txt"));
    const rename = await service.readWorkspaceDiff(f.root, "新 文件.txt", "staged");
    assert.ok(rename.text.includes("rename from"));
    const literal = await service.readWorkspaceDiff(f.root, "[abc].txt", "staged");
    assert.ok(literal.text.includes("+[abc].txt"));
    assert.ok(!literal.text.includes("+a.txt"));
    assert.ok((await service.readWorkspaceDiff(f.root, "-option.txt", "staged")).text.includes("+-option.txt"));
    assert.ok((await service.readWorkspaceDiff(f.root, "removed.txt", "staged")).text.includes("-delete me"));
    await assert.rejects(service.readWorkspaceDiff(f.root, "../outside", "untracked"), /文件状态已变化/);
  } finally { await f.cleanup(); }
});

test("未跟踪文本、空文件、二进制及大文件有明确预览结果", async () => {
  const f = await fixture();
  try {
    const cases: [string, string | Buffer, string][] = [
      ["new.txt", "new content", "text"], ["..notes.txt", "hidden text\n", "text"], ["empty.txt", "", "empty"],
      ["binary.dat", Buffer.from([0, 1, 2]), "binary"], ["legacy.dat", Buffer.from([255, 254]), "binary"],
      ["large.txt", "x".repeat(512 * 1024 + 1), "limited"], ["lines.txt", "line\n".repeat(4001), "limited"],
    ];
    for (const [file, content, kind] of cases) {
      await writeFile(path.join(f.root, file), content);
      const preview = await service.readWorkspaceDiff(f.root, file, "untracked");
      assert.equal(preview.kind, kind, file);
      if (file === "new.txt") {
        assert.ok(preview.text.includes("+new content"));
        assert.ok(preview.text.includes("No newline at end of file"));
      }
    }
    await writeFile(path.join(f.root, "removed.txt"), "x".repeat(600 * 1024));
    assert.equal((await service.readWorkspaceDiff(f.root, "removed.txt", "unstaged")).kind, "limited");
    await writeFile(path.join(f.root, "removed.txt"), Buffer.from([0, 1, 2]));
    assert.equal((await service.readWorkspaceDiff(f.root, "removed.txt", "unstaged")).kind, "binary");
  } finally { await f.cleanup(); }
});

test("尚无提交的仓库可以查看已暂存新增文件，状态变化后拒绝旧选择", async () => {
  const f = await fixture(false);
  try {
    await f.git("add", ".");
    assert.ok((await service.readWorkspaceDiff(f.root, "中文 文件.txt", "staged")).text.includes("+base"));
    await writeFile(path.join(f.root, "fresh.txt"), "fresh\n");
    await f.git("add", "fresh.txt");
    await assert.rejects(service.readWorkspaceDiff(f.root, "fresh.txt", "untracked"), /文件状态已变化/);
  } finally { await f.cleanup(); }
});

test("子模块只展示状态，不进入内部预览", async () => {
  const f = await fixture();
  const child = await fixture();
  try {
    await f.git("-c", "protocol.file.allow=always", "submodule", "add", child.root, "module");
    await f.git("commit", "-am", "add module");
    await writeFile(path.join(f.root, "module", "中文 文件.txt"), "child changes\n");
    const entry = (await service.readWorkspace(f.root)).files.find(file => file.path === "module");
    assert.equal(entry?.submodule, true);
    assert.equal(entry?.group, "unstaged");
    assert.equal((await service.readWorkspaceDiff(f.root, "module", "unstaged")).kind, "submodule");
  } finally { await f.cleanup(); await child.cleanup(); }
});

test("未解决冲突显示冲突状态，不混入普通文本差异", async () => {
  const f = await fixture();
  try {
    await f.git("switch", "-c", "feature");
    await writeFile(path.join(f.root, "中文 文件.txt"), "feature\n");
    await f.git("commit", "-am", "feature");
    await f.git("switch", "main");
    await writeFile(path.join(f.root, "中文 文件.txt"), "main\n");
    await f.git("commit", "-am", "main");
    await assert.rejects(f.git("merge", "feature"));
    const entry = (await service.readWorkspace(f.root)).files.find(file => file.path === "中文 文件.txt");
    assert.equal(entry?.status, "U");
    assert.equal((await service.readWorkspaceDiff(f.root, "中文 文件.txt", "unstaged")).kind, "conflict");
  } finally { await f.cleanup(); }
});

test("单文件和全部暂存/取消暂存保留工作区，提交只包含暂存内容", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "中文 文件.txt"), "staged\n");
    await writeFile(path.join(f.root, "new.txt"), "untracked\n");
    await service.updateWorkspaceIndex(f.root, "stage", ["中文 文件.txt"]);
    await writeFile(path.join(f.root, "中文 文件.txt"), "working\n");
    await service.updateWorkspaceIndex(f.root, "unstage", ["中文 文件.txt"]);
    assert.equal(await f.git("diff", "--cached"), "");
    assert.equal(await readFile(path.join(f.root, "中文 文件.txt"), "utf8"), "working\n");
    await service.updateWorkspaceIndex(f.root, "stage", null);
    await service.updateWorkspaceIndex(f.root, "unstage", null);
    assert.equal(await f.git("diff", "--cached"), "");
    assert.equal(await readFile(path.join(f.root, "new.txt"), "utf8"), "untracked\n");
    await service.updateWorkspaceIndex(f.root, "stage", ["中文 文件.txt"]);
    await writeFile(path.join(f.root, "中文 文件.txt"), "after stage\n");
    const result = await service.commitWorkspace(f.root, "feat: staged only", "body line\nsecond line");
    assert.equal(result.branch, "main");
    assert.equal(result.commit, (await f.git("rev-parse", "HEAD")).trim());
    assert.equal(await f.git("show", "HEAD:中文 文件.txt"), "working\n");
    assert.equal(await readFile(path.join(f.root, "中文 文件.txt"), "utf8"), "after stage\n");
    assert.ok((await f.git("log", "-1", "--format=%B")).includes("body line\nsecond line"));
    await assert.rejects(service.commitWorkspace(f.root, "empty", ""), /暂存区为空/);
    assert.ok((await service.readWorkspace(f.root)).files.some(file => file.path === "new.txt" && file.group === "untracked"));
  } finally { await f.cleanup(); }
});

test("首次提交前取消暂存不删除文件，重命名和删除可提交", async () => {
  const f = await fixture(false);
  try {
    await service.updateWorkspaceIndex(f.root, "stage", null);
    await writeFile(path.join(f.root, "中文 文件.txt"), "modified after staging\n");
    await service.updateWorkspaceIndex(f.root, "unstage", ["中文 文件.txt"]);
    assert.equal(await readFile(path.join(f.root, "中文 文件.txt"), "utf8"), "modified after staging\n");
    await service.updateWorkspaceIndex(f.root, "unstage", null);
    assert.equal((await f.git("ls-files")).trim(), "");
    await service.updateWorkspaceIndex(f.root, "stage", null);
    await service.commitWorkspace(f.root, "initial", "");
    await f.git("mv", "中文 文件.txt", "新 文件.txt");
    await service.updateWorkspaceIndex(f.root, "unstage", ["新 文件.txt"]);
    assert.equal(await f.git("diff", "--cached"), "");
    await rm(path.join(f.root, "removed.txt"));
    await service.updateWorkspaceIndex(f.root, "stage", null);
    await service.commitWorkspace(f.root, "rename and delete", "");
    const files = await f.git("ls-tree", "--name-only", "HEAD");
    assert.ok(!files.includes("removed.txt"));
    assert.equal((await service.readWorkspace(f.root)).files.length, 0);
  } finally { await f.cleanup(); }
});

test("身份缺失、hook 和签名失败不产生提交或清空暂存区", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "new.txt"), "new\n");
    await service.updateWorkspaceIndex(f.root, "stage", ["new.txt"]);
    const head = await f.git("rev-parse", "HEAD");
    await f.git("config", "user.name", "");
    await f.git("config", "user.email", "");
    await assert.rejects(service.commitWorkspace(f.root, "title", "body"), /提交身份/);
    await f.git("config", "user.name", "Workspace test");
    await f.git("config", "user.email", "test@example.invalid");
    const hooks = path.join(f.root, "hooks");
    await mkdir(hooks);
    await f.git("config", "core.hooksPath", hooks);
    await writeFile(path.join(hooks, "pre-commit"), "#!/bin/sh\necho 'blocked hook' >&2\nexit 1\n", { mode: 0o755 });
    await assert.rejects(service.commitWorkspace(f.root, "title", "body"), /blocked hook/);
    await rm(path.join(hooks, "pre-commit"));
    await f.git("config", "commit.gpgsign", "true");
    await f.git("config", "gpg.program", "branchnote-nonexistent-gpg");
    await assert.rejects(service.commitWorkspace(f.root, "title", "body"), /提交失败/);
    assert.equal(await f.git("rev-parse", "HEAD"), head);
    assert.ok((await f.git("diff", "--cached")).includes("+new"));
  } finally { await f.cleanup(); }
});
