const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { tmpdir } = require("node:os");

const run = promisify(execFile);
const MAX_BUFFER = 32 * 1024 * 1024;
const FIELDS =
  "%(refname)%00%(refname:short)%00%(objectname:short)%00%(subject)%00%(committerdate:iso-strict)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(symref)";
// 合并会话落盘在 .git 里：应用重启后还能接着解决冲突、继续合并剩余分支
const SESSION_FILE = "branchnote-merge.json";

class UnsafeRepositoryError extends Error {
  constructor(repositoryPath) {
    const quotedPath = `'${repositoryPath.replace(/'/g, "'\\''")}'`;
    super(`Git 检测到仓库 ${repositoryPath} 的所有者与当前用户不同。确认信任此仓库后，请在 Git Bash 中执行以下命令：\ngit config --global --add safe.directory ${quotedPath}`);
    this.repositoryPath = repositoryPath;
  }
}

async function trustRepository(repositoryPath) {
  try {
    await exec(repositoryPath, ["config", "--global", "--add", "safe.directory", repositoryPath]);
  } catch (error) {
    throw new Error(`无法保存 Git 仓库信任设置：${describe(error)}`);
  }
}

function exec(directory, args, options = {}) {
  return run("git", ["-C", directory, ...args], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    ...options,
  });
}
const git = async (directory, args) =>
  (await exec(directory, args)).stdout.trimEnd();

// 联网操作禁用凭据交互：没有可用凭据时立即失败，避免进程挂在登录提示上
const networkExec = (directory, args) =>
  exec(directory, args, {
    timeout: 120000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

function describe(error) {
  const raw = String(error.stderr || error.message || "").trim();
  if (error.code === "ENOENT")
    return "未找到 Git，请安装 Git 并确保它位于 PATH 中，然后重启应用";
  if (error.killed || error.signal)
    return "Git 操作超时，请检查网络或代理设置后重试";
  if (
    /could not read (Username|Password)|Authentication failed|terminal prompts disabled|Permission denied \(publickey\)|returned error: 40[13]/i.test(
      raw,
    )
  )
    return "远程认证未通过。请先在终端执行一次 git fetch / git push 完成登录，或配置好凭据管理器后重试";
  if (
    /Could not resolve host|unable to access|Failed to connect|Connection timed out|Operation timed out/i.test(
      raw,
    )
  )
    return "无法连接远程仓库，请检查网络或代理设置";
  return raw || String(error.message);
}

function trackCounts(text) {
  const ahead = /ahead (\d+)/.exec(text || "");
  const behind = /behind (\d+)/.exec(text || "");
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
  };
}

async function repositoryRoot(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("请选择有效的本地仓库文件夹");
  try {
    return (await exec(directory, ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch (error) {
    const stderr = error.stderr || "";
    const unsafeRepository = /^fatal: detected dubious ownership in repository at '(.+)'\r?$/m.exec(stderr);
    if (unsafeRepository) throw new UnsafeRepositoryError(unsafeRepository[1]);
    if (/not a git repository/i.test(stderr))
      throw new Error("所选文件夹不属于 Git 仓库，请重新选择");
    throw new Error(describe(error));
  }
}

// 返回统一的“分支”视图：本地分支与远程分支按短名合并成一条，各自保留提交信息
async function readRepository(directory) {
  await repositoryRoot(directory);
  try {
    const root = (await exec(directory, ["rev-parse", "--show-toplevel"])).stdout.trim();
    const output = (
      await exec(root, [
        "for-each-ref",
        "--sort=-committerdate",
        `--format=${FIELDS}`,
        "refs/heads/",
        "refs/remotes/",
      ])
    ).stdout;
    const records = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [ref, short, commit, subject, updatedAt, head, upstream, track, symref] =
          line.split("\0");
        return {
          ref,
          short,
          commit,
          subject,
          updatedAt,
          head,
          upstream,
          track,
          symref,
        };
      });
    const locals = new Map();
    const remotes = new Map();
    // 同名分支可能在多个远程上都有（例如 origin 是本地裸仓库、github 是托管平台），
    // 全部记下来，界面上才能把目标分支指定到某一个远程
    const refsByBranch = new Map();
    const remoteNames = new Set();
    let defaultBranch = "";
    for (const record of records) {
      if (record.ref.startsWith("refs/heads/")) {
        locals.set(record.short, record);
        continue;
      }
      if (!record.ref.startsWith("refs/remotes/")) continue;
      // origin/HEAD 这类符号引用不当作分支，只用来推断默认分支
      if (record.symref) {
        if (record.symref.startsWith("refs/remotes/")) {
          const target = record.symref.slice("refs/remotes/".length);
          const cut = target.indexOf("/");
          remoteNames.add(target.slice(0, cut));
          if (!defaultBranch) defaultBranch = target.slice(cut + 1);
        }
        continue;
      }
      const cut = record.short.indexOf("/");
      const remote = record.short.slice(0, cut);
      const name = record.short.slice(cut + 1);
      remoteNames.add(remote);
      if (!refsByBranch.has(name)) refsByBranch.set(name, []);
      refsByBranch.get(name).push(record.short);
      // 存在多个远程时优先展示 origin 的同名分支
      if (!remotes.has(name) || remote === "origin")
        remotes.set(name, { ...record, remote, name, remoteRef: record.short });
    }
    if (!defaultBranch)
      defaultBranch =
        ["main", "master"].find((name) => locals.has(name)) || "";
    const branches = [...new Set([...locals.keys(), ...remotes.keys()])].map(
      (name) => {
        const local = locals.get(name);
        const remote = remotes.get(name);
        const counts = trackCounts(local?.track);
        return {
          name,
          local: !!local,
          remote: remote?.remote || null,
          remoteRef: remote?.remoteRef || null,
          // 这个分支在哪些远程上存在（origin 排最前），用于选目标分支
          remoteRefs: (refsByBranch.get(name) || []).sort((a, b) =>
            a === `origin/${name}` ? -1 : b === `origin/${name}` ? 1 : a.localeCompare(b),
          ),
          localCommit: local?.commit || null,
          remoteCommit: remote?.commit || null,
          commit: local?.commit || remote?.commit || "",
          subject: local?.subject || remote?.subject || "",
          updatedAt: local?.updatedAt || remote?.updatedAt || "",
          current: local?.head === "*",
          upstream: local?.upstream || "",
          ahead: counts.ahead,
          behind: counts.behind,
        };
      },
    );
    branches.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    // 让添加分支的弹窗能确认“这是哪个仓库、以谁的身份提交”
    const remoteUrls = {};
    try {
      const raw = (
        await exec(root, ["config", "--get-regexp", "^remote\\..*\\.url$"])
      ).stdout;
      for (const line of raw.split(/\r?\n/)) {
        const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
        if (!match) continue;
        if (!remoteUrls[match[1]]) remoteUrls[match[1]] = match[2].trim();
      }
    } catch {
      // 没有配置远程时 git config 会非零退出，忽略即可
    }
    const user = { name: "", email: "" };
    try {
      user.name = (await exec(root, ["config", "--get", "user.name"])).stdout.trim();
    } catch {}
    try {
      user.email = (await exec(root, ["config", "--get", "user.email"])).stdout.trim();
    } catch {}
    return {
      path: root,
      current: [...locals.values()].find((item) => item.head === "*")?.short || "",
      defaultBranch,
      remotes: [...remoteNames],
      remoteUrls,
      user,
      branches,
    };
  } catch (error) {
    throw new Error(`无法读取仓库：${describe(error)}`);
  }
}

// 逐个远程 fetch --prune，返回前后差异；单个远程失败不会影响其他远程
async function fetchRepository(directory) {
  const before = await readRepository(directory);
  if (!before.remotes.length)
    throw new Error("这个仓库还没有配置远程仓库，没有可更新的分支");
  const errors = [];
  for (const remote of before.remotes) {
    try {
      await networkExec(before.path, ["fetch", remote, "--prune", "--no-tags"]);
    } catch (error) {
      errors.push(`${remote}：${describe(error)}`);
    }
  }
  const after = await readRepository(before.path);
  const beforeMap = new Map(
    before.branches.map((branch) => [branch.name, branch.remoteCommit]),
  );
  const afterMap = new Map(
    after.branches.map((branch) => [branch.name, branch.remoteCommit]),
  );
  const updated = [];
  const added = [];
  const removed = [];
  for (const [name, commit] of afterMap) {
    if (!commit) continue;
    const previous = beforeMap.get(name);
    if (!previous) added.push(name);
    else if (previous !== commit) updated.push({ name, from: previous, to: commit });
  }
  for (const [name, commit] of beforeMap)
    if (commit && !afterMap.get(name)) removed.push(name);
  if (errors.length && errors.length === before.remotes.length)
    throw new Error(`更新分支失败：${errors.join("；")}`);
  return { repository: after, updated, added, removed, errors };
}

async function gitPath(directory, name) {
  return git(directory, ["rev-parse", "--path-format=absolute", "--git-path", name]);
}
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readSession(directory) {
  const file = await gitPath(directory, SESSION_FILE);
  try {
    const raw = await fs.readFile(file, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
async function writeSession(directory, session) {
  const file = await gitPath(directory, SESSION_FILE);
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(session, null, 2), "utf8");
  await fs.rename(temporary, file);
}
async function clearSession(directory) {
  const file = await gitPath(directory, SESSION_FILE);
  await fs.rm(file, { force: true });
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
    if (await exists(await gitPath(directory, name)))
      throw new Error(
        "仓库有尚未完成的合并、变基或拣选操作，请先在应用里继续解决冲突，或中止后再试",
      );
  }
}

const shortName = (ref) =>
  ref.startsWith("refs/heads/")
    ? ref.slice("refs/heads/".length)
    : ref.replace(/^refs\/remotes\/[^/]+\//, "");

async function canFastForward(directory, from, to) {
  try {
    await exec(directory, ["merge-base", "--is-ancestor", from, to]);
    return true;
  } catch {
    return false;
  }
}

// 自动生成的冲突分支名：resolve/20261106-120000，重名时追加序号
async function nextResolveBranch(directory) {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
  const stamp = parts.map((part) => String(part).padStart(2, "0")).join("");
  const local = new Set(
    (await git(directory, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]))
      .split(/\r?\n/)
      .filter(Boolean),
  );
  let name = `resolve/${stamp}`;
  let index = 2;
  while (local.has(name)) name = `resolve/${stamp}-${index++}`;
  return name;
}

async function prepareMerge(
  directory,
  target,
  sources,
  resolveBranch,
  { create = false, base = "", stage = "release", mrTarget = "" } = {},
) {
  const repository = await readRepository(directory);
  if (
    typeof target !== "string" ||
    !target.trim() ||
    !Array.isArray(sources) ||
    !sources.length ||
    !sources.every((name) => typeof name === "string" && name.trim())
  )
    throw new Error("请选择发布分支和待合并的分支");
  const localNames = new Set(
    repository.branches.filter((branch) => branch.local).map((branch) => branch.name),
  );
  const remoteRefs = new Set(
    repository.branches.flatMap((branch) => branch.remoteRefs || (branch.remoteRef ? [branch.remoteRef] : [])),
  );
  // 目标可以是本地分支、远程跟踪分支（如 origin/release/week-45），或新建分支
  const targetSpec = localNames.has(target)
    ? { mode: "local", local: target, ref: `refs/heads/${target}` }
    : remoteRefs.has(target)
      ? {
          mode: "remote",
          local: target.slice(target.indexOf("/") + 1),
          ref: `refs/remotes/${target}`,
        }
      : null;
  if (!targetSpec && !create)
    throw new Error("目标分支不存在，请先更新分支列表，或换一个分支");
  if (targetSpec?.mode === "remote" && !targetSpec.local)
    throw new Error("无法识别远程分支名称，请重新选择");
  const baseRef = create
    ? localNames.has(base)
      ? `refs/heads/${base}`
      : remoteRefs.has(base)
        ? `refs/remotes/${base}`
        : null
    : null;
  if (create) {
    await git(repository.path, ["check-ref-format", "--branch", target]);
    if (localNames.has(target))
      throw new Error(`本地已有同名分支 ${target}，请直接选择该分支作为目标`);
    // Git 的 ref 不能同时存在 release 与 release/xxx
    const clash = [...localNames].find(
      (name) => target.startsWith(`${name}/`) || name.startsWith(`${target}/`),
    );
    if (clash)
      throw new Error(
        `新分支名与已有分支 ${clash} 冲突：Git 不允许同时存在 ${clash} 和 ${clash}/…，请换一个名称`,
      );
    if (!baseRef)
      throw new Error("请选择新分支的起点分支（通常是 main 或上一个发布分支）");
  }
  // 冲突分支名可以不填，由应用自动生成，用户不必关心
  let destination = resolveBranch;
  if (typeof destination !== "string" || !destination.trim() || destination.trim() === "resolve")
    destination = await nextResolveBranch(repository.path);
  destination = destination.trim();
  await git(repository.path, ["check-ref-format", "--branch", destination]);
  if (
    !(targetSpec && targetSpec.local.startsWith("resolve/")) &&
    localNames.has(destination)
  )
    throw new Error("该 resolve 分支已经存在，请填写新的名称。");
  const resolved = sources.map((name) => {
    const ref = localNames.has(name)
      ? `refs/heads/${name}`
      : remoteRefs.has(name)
        ? `refs/remotes/${name}`
        : null;
    if (!ref)
      throw new Error(`分支 ${name} 在仓库中不存在，请更新分支列表后重试`);
    return { name, ref };
  });
  if (new Set(resolved.map((source) => shortName(source.ref))).size !== resolved.length)
    throw new Error("待合并分支存在重复项，请重新选择");
  const branchName = targetSpec ? targetSpec.local : target;
  if (
    resolved.some(
      (source) =>
        source.name === branchName || shortName(source.ref) === branchName,
    )
  )
    throw new Error("待合并的分支不能与目标分支相同");
  const targetHead = await git(repository.path, [
    "rev-parse",
    targetSpec ? targetSpec.ref : baseRef,
  ]);
  const localHead =
    targetSpec?.mode === "remote" && localNames.has(targetSpec.local)
      ? await git(repository.path, ["rev-parse", `refs/heads/${targetSpec.local}`])
      : null;
  await assertReady(repository.path);
  return {
    id: randomUUID(),
    path: repository.path,
    target,
    targetMode: targetSpec?.mode || "create",
    targetLocal: branchName,
    targetRef: targetSpec?.ref || baseRef,
    targetRemoteRef: targetSpec?.mode === "remote" ? target : "",
    create,
    base,
    baseRef,
    resolveBranch: destination,
    stage: typeof stage === "string" && stage.trim() ? stage : "release",
    mrTarget,
    currentBranch: repository.current || "（分离 HEAD）",
    targetHead,
    localHead,
    sources: await Promise.all(
      resolved.map(async source => {
        const head = await git(repository.path, ["rev-parse", source.ref]);
        return {...source, head, subject: await git(repository.path, ["log", "-1", "--format=%s", head])};
      }),
    ),
  };
}

// 只在独立的临时克隆中试合并，不切换原仓库、不写原索引或分支引用。
async function checkMerge(plan) {
  const temporary = await fs.mkdtemp(path.join(tmpdir(), "branchnote-preflight-"));
  const work = path.join(temporary, "repository");
  try {
    await exec(plan.path, ["clone", "--shared", "--no-checkout", "--local", "--", plan.path, work]);
    await git(work, ["config", "core.hooksPath", path.join(temporary, "no-hooks")]);
    await git(work, ["config", "user.name", "BranchNote preflight"]);
    await git(work, ["config", "user.email", "preflight@branchnote.invalid"]);
    await git(work, ["config", "commit.gpgSign", "false"]);
    await git(work, ["config", "rerere.enabled", "false"]);
    await git(work, ["checkout", "--detach", plan.sources[0].head]);
    const merged = [];
    const sequence = [...plan.sources.slice(1), {name: plan.base || plan.target, head: plan.targetHead}];
    for (const source of sequence) {
      try {
        await git(work, ["merge", "--no-edit", "--", source.head]);
        merged.push(source.name);
      } catch (error) {
        const files = await unmergedFiles(work);
        if (!files.length) throw new Error("冲突检查失败：" + describe(error));
        return {
          status: "conflict", branch: source.name, files, merged,
          pending: sequence.slice(merged.length).map(item => item.name),
          resolveBranch: plan.resolveBranch,
        };
      }
    }
    return {status: "clean", branch: "", files: [], merged, pending: [], resolveBranch: plan.resolveBranch};
  } finally {
    await fs.rm(temporary, {recursive: true, force: true});
  }
}

async function unmergedFiles(directory) {
  return (await git(directory, ["diff", "--name-only", "--diff-filter=U", "-z"]))
    .split("\0")
    .filter(Boolean);
}
async function stagedFiles(directory) {
  return (await git(directory, ["diff", "--cached", "--name-only", "-z"]))
    .split("\0")
    .filter(Boolean);
}

// 依次合并：第一次遇到冲突时切到 resolve 分支重试，保证目标分支不被留在半合并状态
async function mergeSources(
  directory,
  sources,
  { branch, resolveBranch, createResolve },
) {
  let working = branch;
  const merged = [];
  const logs = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const pending = sources.slice(index).map((item) => item.name);
    try {
      logs.push(await git(directory, ["merge", "--no-edit", "--", source.ref]));
      merged.push(source.name);
    } catch (error) {
      logs.push(String(error.stdout || ""), String(error.stderr || error.message));
      let conflicts = await unmergedFiles(directory);
      if (!conflicts.length)
        return {
          status: "failed",
          branch: working,
          merged,
          pending,
          conflicts: [],
          logs,
          message: "Git 合并未完成，请查看输出并检查仓库状态。",
        };
      if (createResolve && working !== resolveBranch) {
        try {
          await git(directory, ["merge", "--abort"]);
          await git(directory, [
            "switch",
            "-c",
            resolveBranch,
            `refs/heads/${working}`,
          ]);
          working = resolveBranch;
          try {
            logs.push(await git(directory, ["merge", "--no-edit", "--", source.ref]));
            merged.push(source.name);
            continue;
          } catch (retryError) {
            logs.push(
              String(retryError.stdout || ""),
              String(retryError.stderr || retryError.message),
            );
            conflicts = await unmergedFiles(directory);
            if (!conflicts.length)
              return {
                status: "failed",
                branch: working,
                merged,
                pending,
                conflicts: [],
                logs,
                message: "resolve 分支合并未完成，请查看 Git 输出。",
              };
          }
        } catch (resolveError) {
          return {
            status: "failed",
            branch: working,
            merged,
            pending,
            conflicts,
            logs,
            message: `无法建立 resolve 分支：${describe(resolveError)}。请检查当前仓库状态。`,
          };
        }
      }
      return {
        status: "conflict",
        branch: working,
        merged,
        pending,
        conflicts,
        logs,
        message: "请在应用内解决冲突并提交，剩余分支会自动接着合并。功能分支不会被修改。",
      };
    }
  }
  return {
    status: "success",
    branch: working,
    merged,
    pending: [],
    conflicts: [],
    logs,
    message: "",
  };
}

async function executeMerge(plan, meta = {}) {
  if (meta.resolveConflicts && plan.create) {
    plan = {...plan, target: plan.resolveBranch, targetLocal: plan.resolveBranch};
  }
  await assertReady(plan.path);
  const repository = await readRepository(plan.path);
  if ((repository.current || "（分离 HEAD）") !== plan.currentBranch)
    throw new Error("当前分支已变化，请重新核对合并清单");
  const headOf = async (ref) =>
    await git(plan.path, ["rev-parse", ref]).catch(() => "");
  if ((await headOf(plan.targetRef)) !== plan.targetHead)
    throw new Error(`分支 ${plan.target} 已变化，请重新预览后执行`);
  for (const source of plan.sources) {
    if ((await headOf(source.ref)) !== source.head)
      throw new Error(`分支 ${source.name} 已变化，请重新预览后执行`);
  }
  if (meta.directSource && plan.sources.length === 1) {
    const source = plan.sources[0];
    return {
      status: "success", workingBranch: shortName(source.ref), target: plan.mrTarget || plan.target,
      targetMode: plan.targetMode, targetLocal: shortName(source.ref), remoteRef: "",
      sourceRef: source.ref, sourceHead: source.head, fastForwarded: false,
      merged: [source.name], pending: [], conflicts: [], message: "",
      logs: ["无冲突，直接使用功能分支提交 MR"],
    };
  }
  const localNames = new Set(
    repository.branches.filter((branch) => branch.local).map((branch) => branch.name),
  );
  if (plan.targetMode === "remote") {
    if (plan.localHead) {
      if (!localNames.has(plan.targetLocal))
        throw new Error(`本地分支 ${plan.targetLocal} 已被删除，请重新预览`);
      if ((await headOf(`refs/heads/${plan.targetLocal}`)) !== plan.localHead)
        throw new Error(`本地分支 ${plan.targetLocal} 已变化，请重新预览后执行`);
    } else if (localNames.has(plan.targetLocal)) {
      throw new Error(`本地已出现同名分支 ${plan.targetLocal}，请重新预览`);
    }
  }
  let fastForwarded = false;
  const logs = [];
  const outcome = (result) => ({
    status: result.status,
    workingBranch: result.branch,
    target: plan.target,
    targetMode: plan.targetMode,
    targetLocal: plan.targetLocal,
    remoteRef: plan.targetRemoteRef || "",
    fastForwarded,
    merged: result.merged,
    pending: result.pending,
    conflicts: result.conflicts,
    message: result.message,
    logs: [...logs, ...(result.logs || [])],
  });
  try {
    if (plan.create)
      await git(plan.path, ["switch", "-c", plan.target, meta.integrateFirst ? plan.sources[0].ref : plan.baseRef]);
    else if (plan.targetMode === "remote") {
      if (plan.localHead) {
        if (plan.localHead !== plan.targetHead) {
          if (!(await canFastForward(plan.path, plan.localHead, plan.targetHead)))
            return outcome({
              status: "failed",
              branch: plan.targetLocal,
              merged: [],
              pending: plan.sources.map((source) => source.name),
              conflicts: [],
              message: `本地 ${plan.targetLocal} 与 ${plan.target} 已经分叉，不能自动快进。请先在开发工具中同步这个分支，再回来提交。`,
            });
          await git(plan.path, ["switch", "--no-guess", "--", plan.targetLocal]);
          // 本地落后远程时先快进，避免把新提交合进过期分支
          await git(plan.path, ["merge", "--ff-only", "--", plan.targetRef]);
          fastForwarded = true;
          logs.push(`本地 ${plan.targetLocal} 已快进到 ${plan.target}`);
        } else {
          await git(plan.path, ["switch", "--no-guess", "--", plan.targetLocal]);
        }
      } else {
        await git(plan.path, [
          "switch",
          "-c",
          plan.targetLocal,
          "--track",
          plan.target,
        ]);
      }
    } else await git(plan.path, ["switch", "--no-guess", "--", plan.target]);
  } catch (error) {
    return outcome({
      status: "failed",
      branch: plan.targetLocal,
      merged: [],
      pending: plan.sources.map((source) => source.name),
      conflicts: [],
      message: describe(error),
    });
  }
  const sequence = meta.integrateFirst ? [...plan.sources, {name: plan.mrTarget || plan.base, ref: plan.targetRef}] : plan.sources;
  const result = await mergeSources(plan.path, sequence, {
    branch: plan.targetMode === "create" ? plan.target : plan.targetLocal,
    resolveBranch: plan.resolveBranch,
    createResolve: true,
  });
  if (result.status === "success" || result.status === "failed") {
    await clearSession(plan.path);
  } else
    await writeSession(plan.path, {
      id: plan.id,
      stage: plan.stage || meta.stage || "release",
      mrTarget: plan.mrTarget || "",
      returnBranch: meta.resolveConflicts ? plan.currentBranch : "",
      sources: plan.sources.map(source => source.name),
      target: plan.target,
      targetMode: plan.targetMode,
      targetLocal: plan.targetLocal,
      remoteRef: plan.targetRemoteRef || "",
      branch: result.branch,
      merged: result.merged,
      pending: result.pending,
      startedAt: new Date().toISOString(),
    });
  return outcome(result);
}

// 继续合并剩余分支（冲突解决并提交后调用）
async function continueMerge(directory, branch, sources) {
  const root = await repositoryRoot(directory);
  const current = await git(root, ["branch", "--show-current"]);
  if (current !== branch)
    throw new Error(
      `当前分支已切到 ${current || "（分离 HEAD）"}，请回到 ${branch} 后再继续`,
    );
  if (await exists(await gitPath(root, "MERGE_HEAD")))
    throw new Error("还有未完成的合并，请先解决冲突并提交");
  if (!Array.isArray(sources) || !sources.length) return null;
  const repository = await readRepository(root);
  const localNames = new Set(
    repository.branches.filter((item) => item.local).map((item) => item.name),
  );
  const remoteRefs = new Set(
    repository.branches.flatMap((item) => item.remoteRefs || (item.remoteRef ? [item.remoteRef] : [])),
  );
  const resolved = sources.map((name) => ({
    name,
    ref: localNames.has(name)
      ? `refs/heads/${name}`
      : remoteRefs.has(name)
        ? `refs/remotes/${name}`
        : null,
  }));
  const missing = resolved.filter((item) => !item.ref);
  if (missing.length)
    throw new Error(`分支 ${missing.map((item) => item.name).join("、")} 在仓库中不存在`);
  const result = await mergeSources(root, resolved, {
    branch,
    resolveBranch: branch,
    createResolve: false,
  });
  const session = await readSession(root);
  if (result.status === "success" || result.status === "failed") {
    await clearSession(root);
  } else if (session) {
    await writeSession(root, {
      ...session,
      branch: result.branch,
      merged: [...(session.merged || []), ...result.merged],
      pending: result.pending,
    });
  }
  return {
    status: result.status,
    workingBranch: result.branch,
    merged: result.merged,
    pending: result.pending,
    conflicts: result.conflicts,
    message: result.message,
    logs: result.logs,
  };
}

// 一个文件安全地映射到仓库内路径，阻断 ../ 与绝对路径
function safeFile(root, file) {
  if (typeof file !== "string" || !file.trim()) throw new Error("文件路径为空");
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("文件路径超出了仓库范围");
  return { absolute, relative: relative.split(path.sep).join("/") };
}

// 外部编辑器解决冲突：给出文件绝对路径（交给系统默认编辑器打开）
async function workingFile(directory, file) {
  const root = await repositoryRoot(directory);
  const { absolute, relative } = safeFile(root, file);
  return { file: relative, absolute };
}

// 回读工作区文件：用户在编辑器里保存后，应用据此判断冲突是否已处理完
async function readWorkingFile(directory, file) {
  const target = await workingFile(directory, file);
  try {
    return {
      file: target.file,
      content: await fs.readFile(target.absolute, "utf8"),
    };
  } catch (error) {
    if (error.code === "ENOENT")
      return { file: target.file, content: null };
    throw error;
  }
}

async function readMergeState(directory) {
  const root = await repositoryRoot(directory);
  const branch = await git(root, ["branch", "--show-current"]);
  const merging = await exists(await gitPath(root, "MERGE_HEAD"));
  let session = await readSession(root);
  const unmerged = merging ? await unmergedFiles(root) : [];
  const staged = merging ? await stagedFiles(root) : [];
  // 合并已提交、也没有剩余分支时，会话已无意义，顺手清掉
  if (session && !merging && !unmerged.length && !(session.pending || []).length) {
    await clearSession(root);
    session = null;
  }
  return {
    path: root,
    branch,
    merging,
    unmerged,
    staged,
    session: session || null,
  };
}

// 读取冲突文件的三方内容，供应用内对比与编辑
async function readConflictFile(directory, file) {
  const root = await repositoryRoot(directory);
  const { absolute, relative } = safeFile(root, file);
  const version = async (stage) => {
    try {
      return (await exec(root, ["show", `:${stage}:${relative}`])).stdout;
    } catch {
      return null;
    }
  };
  let working = null;
  try {
    working = await fs.readFile(absolute, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const [base, ours, theirs] = await Promise.all([
    version(1),
    version(2),
    version(3),
  ]);
  const binary = [working, ours, theirs, base].some(
    (text) => typeof text === "string" && text.includes("\u0000"),
  );
  return {
    file: relative,
    binary,
    working,
    base,
    ours,
    theirs,
    exists: {
      working: working !== null,
      ours: ours !== null,
      theirs: theirs !== null,
    },
  };
}

async function conflictState(root) {
  return {
    unmerged: await unmergedFiles(root),
    staged: await stagedFiles(root),
  };
}

// 写入用户编辑后的内容并标记为已解决
async function resolveConflictFile(directory, file, content) {
  const root = await repositoryRoot(directory);
  const { absolute, relative } = safeFile(root, file);
  if (typeof content !== "string") throw new Error("解决内容必须是文本");
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
  await git(root, ["add", "--", relative]);
  return { file: relative, ...(await conflictState(root)) };
}

// 整份采用我方或对方版本；该侧已删除文件时用 git rm 收尾
async function takeConflictSide(directory, file, side) {
  const root = await repositoryRoot(directory);
  const { relative } = safeFile(root, file);
  if (side !== "ours" && side !== "theirs")
    throw new Error("请选择采用我方或对方版本");
  const stage = side === "ours" ? 2 : 3;
  // ls-files -u 每行形如 "100644 <sha> 2\tpath"，先看该侧是否还有内容
  const stages = new Set(
    (await exec(root, ["ls-files", "-u", "--", relative])
      .then((result) => result.stdout)
      .catch(() => ""))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => Number(line.split("\t")[0].split(" ").pop())),
  );
  if (stages.has(stage)) {
    await git(root, [
      "checkout",
      side === "ours" ? "--ours" : "--theirs",
      "--",
      relative,
    ]);
    // checkout --ours/--theirs 只改工作区，需要 add 才真正标记为已解决
    await git(root, ["add", "--", relative]);
  } else await git(root, ["rm", "-f", "--quiet", "--", relative]);
  return { file: relative, ...(await conflictState(root)) };
}

// 两边都要：用 git 的三方合并做 union，公共内容只保留一次
async function unionConflictFile(directory, file) {
  const root = await repositoryRoot(directory);
  const { relative } = safeFile(root, file);
  const version = async (stage) => {
    try {
      return (await exec(root, ["show", `:${stage}:${relative}`])).stdout;
    } catch {
      return null;
    }
  };
  const [base, ours, theirs] = await Promise.all([
    version(1),
    version(2),
    version(3),
  ]);
  if (ours === null && theirs === null)
    throw new Error("这个文件两边都没有内容，无法合并");
  if (
    [base, ours, theirs].some(
      (text) => typeof text === "string" && text.includes("\u0000"),
    )
  )
    throw new Error("二进制文件无法自动合并，请整份采用我方或对方版本");
  // 临时文件放在 .git 里，避免污染工作区
  const workdir = await gitPath(root, `branchnote-union-${randomUUID()}`);
  await fs.mkdir(workdir, { recursive: true });
  try {
    const write = async (name, text) => {
      const target = path.join(workdir, name);
      await fs.writeFile(target, text ?? "", "utf8");
      return target;
    };
    const [oursFile, baseFile, theirsFile] = await Promise.all([
      write("ours", ours),
      write("base", base),
      write("theirs", theirs),
    ]);
    const result = await exec(root, [
      "merge-file",
      "-p",
      "--union",
      oursFile,
      baseFile,
      theirsFile,
    ]).catch((error) => {
      // merge-file 用退出码表达冲突数，负值才是真正的执行失败
      if (typeof error.code === "number" && error.code > 0)
        throw new Error(`无法自动合并 ${relative}，请手动编辑后保存`);
      throw new Error(describe(error));
    });
    return { file: relative, content: result.stdout };
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

// 所有冲突解决完后提交本次合并
async function commitResolution(directory, message) {
  const root = await repositoryRoot(directory);
  const unmerged = await unmergedFiles(root);
  if (unmerged.length)
    throw new Error(`还有 ${unmerged.length} 个冲突文件未解决`);
  // 标记解决后用户可能又在外部编辑器里改过：提交以工作区最新内容为准
  // （合并开始前工作区必须是干净的，所以 -u 只会收进本次解决的结果）
  await git(root, ["add", "-u", "--", "."]);
  const staged = await stagedFiles(root);
  if (!staged.length && !(await exists(await gitPath(root, "MERGE_HEAD"))))
    throw new Error("没有需要提交的解决结果");
  const text = typeof message === "string" && message.trim() ? message.trim() : "";
  const args = text ? ["commit", "-m", text] : ["commit", "--no-edit"];
  const output = await exec(root, args).catch(async (error) => {
    // 合并内容与目标完全一致时 Git 会拒绝提交空合并
    if (/nothing to commit|no changes/i.test(String(error.stdout || error.message)))
      return { stdout: "" };
    throw error;
  });
  return {
    commit: await git(root, ["rev-parse", "HEAD"]),
    output: String(output.stdout || "").trim(),
    branch: await git(root, ["branch", "--show-current"]),
  };
}

// 放弃本次合并：中止、切回原分支并删掉自动生成的 resolve 分支
async function abortMerge(directory, returnTo) {
  const root = await repositoryRoot(directory);
  const current = await git(root, ["branch", "--show-current"]);
  if (await exists(await gitPath(root, "MERGE_HEAD")))
    await git(root, ["merge", "--abort"]).catch(() => {});
  // 界面没传回退分支时，从合并会话里找回目标分支，避免把用户留在 resolve/* 上
  const session = await readSession(root);
  const destination =
    (typeof returnTo === "string" && returnTo.trim()) || session?.returnBranch || session?.targetLocal || "";
  const localNames = new Set(
    (
      await git(root, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ])
    )
      .split(/\r?\n/)
      .filter(Boolean),
  );
  const removed = [];
  if (current && (current.startsWith("resolve/") || (session?.branch === current && session?.returnBranch))) {
    if (destination && destination !== current && localNames.has(destination))
      await git(root, ["switch", "--no-guess", "--", destination]).catch(() => {});
    if ((await git(root, ["branch", "--show-current"])) !== current) {
      await git(root, ["branch", "-D", current]).catch(() => {});
      removed.push(current);
    }
  }
  await clearSession(root);
  return {
    branch: await git(root, ["branch", "--show-current"]),
    removed,
  };
}

// 冲突在 resolve 分支解决完后，把结果并回目标分支并清理临时分支
async function finalizeMerge(directory, targetLocal, from) {
  const root = await repositoryRoot(directory);
  if (typeof targetLocal !== "string" || !targetLocal)
    throw new Error("缺少目标分支，无法完成合并");
  if (!from || from === targetLocal)
    return { branch: targetLocal, commit: await git(root, ["rev-parse", "HEAD"]), removed: [] };
  if (!from.startsWith("resolve/"))
    throw new Error("只能把 resolve 分支的结果并回目标分支");
  const current = await git(root, ["branch", "--show-current"]);
  if (current === from) await git(root, ["switch", "--no-guess", "--", targetLocal]);
  else if (current !== targetLocal)
    throw new Error(`当前分支是 ${current}，请回到 ${targetLocal} 后再收尾`);
  try {
    await git(root, ["merge", "--no-edit", "--", `refs/heads/${from}`]);
  } catch (error) {
    await git(root, ["merge", "--abort"]).catch(() => {});
    throw new Error(`把解决结果并回 ${targetLocal} 失败：${describe(error)}`);
  }
  await git(root, ["branch", "-D", from]).catch(() => {});
  await clearSession(root);
  return {
    branch: targetLocal,
    commit: await git(root, ["rev-parse", "HEAD"]),
    removed: [from],
  };
}

// 推算 MR / PR 创建页地址：按远程仓库的 web 地址与平台类型（GitLab / GitHub）生成预填链接。
// 远程不是 http(s) 或 git@ 的常见形式（比如本地裸仓库路径）时返回空串，由界面降级提示。
// 把 https / ssh / git@ 三种远程地址统一成「网页地址 + 项目路径」
// GitLab 的项目路径要保留子组（group/sub/repo），建 MR 的接口按它拼项目 ID
function parseRemoteUrl(value) {
  const url = String(value || "").trim();
  if (!url) return null;
  // 本地裸仓库 / 文件路径不是托管平台，直接当作无法识别
  if (
    /^file:\/\//i.test(url) ||
    /^[a-z]:[\\/]/i.test(url) ||
    /^[\\/]/.test(url) ||
    /^\.{1,2}[\\/]/.test(url)
  )
    return null;
  let scheme = "https";
  let host = "";
  let projectPath = "";
  if (/^https?:\/\//i.test(url)) {
    const match = /^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i.exec(url);
    if (!match) return null;
    scheme = match[1].toLowerCase();
    host = match[2];
    projectPath = match[3];
  } else if (/^ssh:\/\//i.test(url)) {
    const match = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(url);
    if (!match) return null;
    host = match[1];
    projectPath = match[2];
  } else {
    // scp 形式：git@host:group/repo.git
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
    if (!match) return null;
    host = match[1];
    projectPath = match[2];
  }
  const project = projectPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  if (!host || !project || !project.includes("/")) return null;
  const segments = project.split("/");
  return {
    host,
    scheme,
    web: `${scheme}://${host}/${project}`,
    projectPath: project,
    // owner/repo 供 GitHub 接口使用；GitLab 用完整 projectPath
    owner: segments[0],
    repo: segments[segments.length - 1],
    // 只是按域名猜，自建 GitLab 用别的域名时以设置里的配置为准
    provider: /gitlab/i.test(host)
      ? "gitlab"
      : /github/i.test(host)
        ? "github"
        : "other",
  };
}

// 读远程地址信息，供 MR / PR 创建与设置页预填使用。
// remote 指定时以它为准（目标分支在哪个远程，就去哪个平台建 MR）；
// 没指定时跳过本地裸仓库路径，优先选配了令牌的域名，其次 origin，再其次能识别的托管平台。
async function remoteInfo(directory, options = {}) {
  const root = await repositoryRoot(directory);
  const remotes = (await git(root, ["remote"]).catch(() => ""))
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (!remotes.length) return null;

  const inspect = async (name) => {
    let url = "";
    try {
      url = (await git(root, ["remote", "get-url", name])).trim();
    } catch {
      return null;
    }
    const parsed = parseRemoteUrl(url);
    if (!parsed) return null;
    return { name, url, ...parsed };
  };

  const wanted = typeof options.remote === "string" ? options.remote.trim() : "";
  if (wanted && remotes.includes(wanted)) {
    // 明确指定就只用它：哪怕它是本地路径，也如实返回 null，由调用方给手动提示
    return await inspect(wanted);
  }

  const candidates = [];
  for (const name of remotes) {
    const info = await inspect(name);
    if (info) candidates.push(info);
  }
  if (!candidates.length) return null;

  const hosts = Array.isArray(options.hosts)
    ? options.hosts.map((item) => String(item).toLowerCase())
    : [];
  const byToken = candidates.find((item) => hosts.includes(item.host.toLowerCase()));
  if (byToken) return byToken;
  const origin = candidates.find((item) => item.name === "origin");
  if (origin) return origin;
  return candidates.find((item) => item.provider !== "other") || candidates[0];
}

async function mergeRequestUrl(directory, source, target, provider = "", remote = "") {
  const info = await remoteInfo(directory, { remote }).catch(() => null);
  if (!info) return "";
  // 自建 GitLab 常用自定义域名，平台类型以设置里的声明为准
  const platform = provider || info.provider;
  if (platform === "gitlab")
    return `${info.web}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(source)}&merge_request[target_branch]=${encodeURIComponent(target)}`;
  if (platform === "github")
    return `${info.web}/compare/${encodeURIComponent(target)}...${encodeURIComponent(source)}?expand=1`;
  return "";
}

async function pushBranch(directory, branch, remote, checkedSource) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("推送失败：没有拿到仓库路径，请关闭后重新打开提交对话框");
  if (!branch) throw new Error("推送失败：没有指定要推送的本地分支");
  const repository = await readRepository(directory);
  const names = new Set(
    repository.branches.filter((item) => item.local).map((item) => item.name),
  );
  let sourceRef = "refs/heads/" + branch;
  if (checkedSource) {
    const refs = repository.branches.flatMap(item => [
      ...(item.local ? ["refs/heads/" + item.name] : []),
      ...(item.remoteRefs || (item.remoteRef ? [item.remoteRef] : [])).map(ref => "refs/remotes/" + ref),
    ]);
    if (!refs.includes(checkedSource.ref) || shortName(checkedSource.ref) !== branch)
      throw new Error("推送源分支无效，请重新检查");
    sourceRef = checkedSource.ref;
    if (await git(repository.path, ["rev-parse", sourceRef]) !== checkedSource.head)
      throw new Error("功能分支已有新提交，请重新检查后再提交 MR");
  } else if (!names.has(branch)) throw new Error("本地分支 " + branch + " 不存在，无法推送");

  if (!repository.remotes.length)
    throw new Error("仓库没有配置远程仓库，无法推送");
  const name = remote || repository.remotes[0];
  if (!repository.remotes.includes(name))
    throw new Error(`远程仓库 ${name} 不存在，无法推送`);
  try {
    const output = (
      await networkExec(repository.path, [
        "push",
        "--porcelain",
        name,
        sourceRef + ":refs/heads/" + branch,
      ])
    ).stdout;
    return { remote: name, branch, remoteBranch: branch, output: output.trim() };
  } catch (error) {
    throw new Error(`推送失败：${describe(error)}`);
  }
}

module.exports = {
  UnsafeRepositoryError,
  trustRepository,
  readRepository,
  fetchRepository,
  prepareMerge,
  checkMerge,
  executeMerge,
  continueMerge,
  finalizeMerge,
  pushBranch,
  readMergeState,
  readConflictFile,
  workingFile,
  readWorkingFile,
  resolveConflictFile,
  takeConflictSide,
  unionConflictFile,
  commitResolution,
  abortMerge,
  parseRemoteUrl,
  remoteInfo,
  mergeRequestUrl,
};
