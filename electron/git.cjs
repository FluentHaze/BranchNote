const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const run = promisify(execFile);
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");

const git = async (directory, args) =>
  (
    await run("git", ["-C", directory, ...args], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout.trimEnd();

async function readRepository(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("请选择有效的本地仓库文件夹");
  const query = (args) =>
    run("git", ["-C", directory, ...args], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  try {
    const root = (await query(["rev-parse", "--show-toplevel"])).stdout.trim();
    const output = (
      await query([
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:lstrip=2)%00%(objectname:short)%00%(subject)%00%(committerdate:iso-strict)%00%(HEAD)",
        "refs/heads/",
      ])
    ).stdout;
    return {
      path: root,
      branches: output
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [name, commit, subject, updatedAt, head] = line.split("\0");
          return { name, commit, subject, updatedAt, current: head === "*" };
        }),
    };
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(
        "未找到 Git，请安装 Git 并确保它位于 PATH 中，然后重启应用",
      );
    if (/not a git repository/i.test(error.stderr || ""))
      throw new Error("所选文件夹不属于 Git 仓库，请重新选择");
    throw new Error(
      `无法读取仓库：${String(error.stderr || error.message).trim()}`,
    );
  }
}
async function assertReady(directory) {
  if ((await git(directory, ["status", "--porcelain"])).trim())
    throw new Error(
      "工作区存在未提交或未跟踪的文件，请先提交，或使用 stash 保存改动后重试",
    );
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
  ]) {
    const statePath = await git(directory, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      name,
    ]);
    let exists = false;
    try {
      await fs.access(statePath);
      exists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (exists)
      throw new Error(
        "仓库有尚未完成的合并、变基或拣选操作，请先在开发工具中完成或中止",
      );
  }
}

async function prepareMerge(
  directory,
  target,
  sources,
  resolveBranch,
  { create = false, base = "" } = {},
) {
  const repository = await readRepository(directory);
  if (
    typeof target !== "string" ||
    !Array.isArray(sources) ||
    !sources.length ||
    !sources.every((name) => typeof name === "string")
  )
    throw new Error("请选择目标和待合并的本地分支");
  const names = new Set(repository.branches.map((branch) => branch.name));
  if (sources.some((name) => !names.has(name) || name === target))
    throw new Error("待合并的本地分支无效，请刷新分支列表后重新选择");
  if (new Set(sources).size !== sources.length)
    throw new Error("待合并分支存在重复项，请重新选择");
  if (create) {
    await git(repository.path, ["check-ref-format", "--branch", target]);
    if (names.has(target))
      throw new Error(`本地已有同名分支 ${target}，请直接选择该分支作为目标`);
    // Git 的 ref 不能同时存在 release 与 release/xxx
    const clash = [...names].find(
      (name) => target.startsWith(`${name}/`) || name.startsWith(`${target}/`),
    );
    if (clash)
      throw new Error(
        `新分支名与已有分支 ${clash} 冲突：Git 不允许同时存在 ${clash} 和 ${clash}/…，请换一个名称`,
      );
    if (!names.has(base))
      throw new Error("请选择新分支的起点分支（通常是 main 或上一个发布分支）");
  } else if (!names.has(target)) {
    throw new Error("目标分支不存在，请刷新分支列表后重新选择");
  }
  if (
    typeof resolveBranch !== "string" ||
    !resolveBranch.startsWith("resolve/")
  )
    throw new Error("冲突分支必须以 resolve/ 开头");
  await git(repository.path, ["check-ref-format", "--branch", resolveBranch]);
  if (!target.startsWith("resolve/") && names.has(resolveBranch))
    throw new Error("该 resolve 分支已经存在，请填写新的名称");
  await assertReady(repository.path);
  return {
    id: randomUUID(),
    path: repository.path,
    target,
    create,
    base,
    resolveBranch,
    currentBranch:
      repository.branches.find((branch) => branch.current)?.name ||
      "（分离 HEAD）",
    targetHead: await git(repository.path, [
      "rev-parse",
      `refs/heads/${create ? base : target}`,
    ]),
    sources: await Promise.all(
      sources.map(async (name) => ({
        name,
        head: await git(repository.path, ["rev-parse", `refs/heads/${name}`]),
      })),
    ),
  };
}

async function executeMerge(plan) {
  await assertReady(plan.path);
  const repository = await readRepository(plan.path);
  if (
    (repository.branches.find((branch) => branch.current)?.name ||
      "（分离 HEAD）") !== plan.currentBranch
  )
    throw new Error("当前分支已变化，请重新核对合并清单");
  for (const branch of [
    plan.create
      ? { name: plan.base, head: plan.targetHead }
      : { name: plan.target, head: plan.targetHead },
    ...plan.sources,
  ]) {
    if (
      (await git(plan.path, ["rev-parse", `refs/heads/${branch.name}`])) !==
      branch.head
    )
      throw new Error(`分支 ${branch.name} 已变化，请重新预览后执行`);
  }
  let workingBranch = plan.target;
  const merged = [];
  const logs = [];
  const outcome = (status, pending, conflicts = [], message = "") => ({
    status,
    workingBranch,
    merged,
    pending,
    conflicts,
    message,
    logs,
  });
  try {
    if (plan.create)
      await git(plan.path, [
        "switch",
        "-c",
        plan.target,
        `refs/heads/${plan.base}`,
      ]);
    else await git(plan.path, ["switch", "--no-guess", "--", plan.target]);
  } catch (error) {
    return outcome(
      "failed",
      plan.sources.map((source) => source.name),
      [],
      String(error.stderr || error.message),
    );
  }
  for (let index = 0; index < plan.sources.length; index++) {
    const source = plan.sources[index];
    const pending = plan.sources.slice(index).map((branch) => branch.name);
    try {
      logs.push(
        await git(plan.path, [
          "merge",
          "--no-edit",
          "--",
          `refs/heads/${source.name}`,
        ]),
      );
      merged.push(source.name);
    } catch (error) {
      logs.push(
        String(error.stdout || ""),
        String(error.stderr || error.message),
      );
      let conflicts = (
        await git(plan.path, ["diff", "--name-only", "--diff-filter=U", "-z"])
      )
        .split("\0")
        .filter(Boolean);
      if (!conflicts.length)
        return outcome(
          "failed",
          pending,
          [],
          "Git 合并未完成，请查看输出并检查仓库状态。",
        );
      if (!workingBranch.startsWith("resolve/")) {
        try {
          await git(plan.path, ["merge", "--abort"]);
          await git(plan.path, [
            "switch",
            "-c",
            plan.resolveBranch,
            `refs/heads/${plan.target}`,
          ]);
          workingBranch = plan.resolveBranch;
          try {
            logs.push(
              await git(plan.path, [
                "merge",
                "--no-edit",
                "--",
                `refs/heads/${source.name}`,
              ]),
            );
            merged.push(source.name);
            continue;
          } catch (retryError) {
            logs.push(
              String(retryError.stdout || ""),
              String(retryError.stderr || retryError.message),
            );
            conflicts = (
              await git(plan.path, [
                "diff",
                "--name-only",
                "--diff-filter=U",
                "-z",
              ])
            )
              .split("\0")
              .filter(Boolean);
            if (!conflicts.length)
              return outcome(
                "failed",
                pending,
                [],
                "resolve 分支合并未完成，请查看 Git 输出。",
              );
          }
        } catch (resolveError) {
          return outcome(
            "failed",
            pending,
            conflicts,
            `无法建立 resolve 分支：${String(resolveError.stderr || resolveError.message)}。请检查当前仓库状态。`,
          );
        }
      }
      return outcome(
        "conflict",
        pending,
        conflicts,
        "请在开发工具中解决冲突并提交，再继续合并剩余分支。功能分支未被修改。",
      );
    }
  }
  return outcome(
    "success",
    [],
    [],
    workingBranch.startsWith("resolve/")
      ? "所选分支已合入 resolve 分支，可使用此分支进行后续发布。"
      : "所选分支已合入目标发布分支。",
  );
}
module.exports = { readRepository, prepareMerge, executeMerge };
