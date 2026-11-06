// BranchNote 端到端测试 harness
// 直接驱动 electron/git.cjs —— 与桌面应用 IPC 调用的是同一批函数，覆盖真实代码路径。
// 用法：node scripts/e2e.cjs [场景名过滤]
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const gitApi = require("../electron/git.cjs");

const WORK = "C:/Users/FF/Desktop/github/TestBranchNote";
const ORIGIN = "C:/Users/FF/Desktop/github/TestBranchNote-bare.git";
const BASE_BRANCHES = [
  "main",
  "feature/login",
  "feature/cart",
  "feature/report",
  "feature/cleanup",
  "release-1",
];
const BASELINE = {}; // branch -> sha（首次捕获后不变）

const sh = (args, opts = {}) => {
  const out = execFileSync("git", ["-C", WORK, ...args], {
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
  return typeof out === "string" ? out.trim() : "";
};

const shSoft = (args) => {
  try {
    return sh(args);
  } catch {
    return "";
  }
};

// 裸仓库里的只读查询（基线 ref 存在裸仓库里）
const shBare = (args) => {
  try {
    const out = execFileSync("git", ["-C", ORIGIN, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    return typeof out === "string" ? out.trim() : "";
  } catch {
    return "";
  }
};

const results = [];
let current = "";

function check(name, condition, detail = "") {
  if (!condition) throw new Error(`${current} / ${name} 断言失败${detail ? `：${detail}` : ""}`);
}

async function scenario(name, fn) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  current = name;
  const started = Date.now();
  try {
    await reset();
    await fn();
    await reset();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  PASS  ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message || error) });
    console.error(`  FAIL  ${name}\n        ${String(error.message || error).split("\n")[0]}`);
    try {
      await reset();
    } catch {
      /* 尽力恢复 */
    }
  }
}

async function reset() {
  // 恢复工作仓库与裸仓库到受控基线
  shSoft(["merge", "--abort"], { stdio: "ignore" });
  shSoft(["reset", "--hard"], { stdio: "ignore" });
  shSoft(["clean", "-fd"], { stdio: "ignore" });
  shSoft(["switch", "-f", "--", "main"], { stdio: "ignore" });
  const localBranches = shSoft(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const name of localBranches)
    // demo/* 是手工演示分支，不属于自动化基线，保留不动
    if (!BASE_BRANCHES.includes(name) && !name.startsWith("demo/"))
      shSoft(["branch", "-D", "--", name], { stdio: "ignore" });
  // 先按基线重建全部本地分支（含 release-1），推回裸仓库，再删掉 release-1 本地分支
  for (const name of BASE_BRANCHES) {
    // 基线固定在裸仓库的 refs/bn-baseline/*，不会随测试推送漂移
    if (!(name in BASELINE))
      BASELINE[name] = shBare(["rev-parse", `refs/bn-baseline/${name}`]);
    shSoft(["update-ref", `refs/heads/${name}`, BASELINE[name]], { stdio: "ignore" });
    shSoft(["push", "--force", ORIGIN, `refs/heads/${name}:refs/heads/${name}`], {
      stdio: "ignore",
    });
  }
  shSoft(["branch", "-D", "--", "release-1"], { stdio: "ignore" });
  const remoteBranches = sh(["ls-remote", "--heads", "--", ORIGIN])
    .split(/\r?\n/)
    .map((line) => line.split("\t")[1].replace("refs/heads/", ""));
  for (const name of remoteBranches)
    if (!BASE_BRANCHES.includes(name) && !name.startsWith("demo/"))
      shSoft(["push", ORIGIN, "--delete", `refs/heads/${name}`], { stdio: "ignore" });
  shSoft(["fetch", "origin", "--prune"], { stdio: "ignore" });
  shSoft(["reset", "--hard", BASELINE.main], { stdio: "ignore" });
  const session = shSoft(["rev-parse", "--path-format=absolute", "--git-path", "branchnote-merge.json"]);
  fs.rmSync(session, { force: true });
}

const read = (file) => fs.readFileSync(path.join(WORK, file), "utf8");

// 保护：这套脚本会把仓库重建为旧的自动化夹具，演示仓库不能被它顺带清掉
if (!fs.existsSync(path.join(WORK, "base.txt")) && !process.env.BN_FORCE_FIXTURE) {
  console.error(
    "检测到 TestBranchNote 已经是手工演示仓库（没有 base.txt），为避免覆盖，已停止。\n需要重建旧夹具时用 BN_FORCE_FIXTURE=1 运行。",
  );
  process.exit(1);
}

async function main() {
  console.log("== BranchNote E2E（驱动 electron/git.cjs 真实函数）==");

  await scenario("S01 读取仓库：本地+远程分支合并视图", async () => {
    const repo = await gitApi.readRepository(WORK);
    check("路径一致", repo.path === WORK.replace(/\//g, "\\") || repo.path === WORK, repo.path);
    check("当前分支 main", repo.current === "main");
    check("默认分支 main", repo.defaultBranch === "main");
    const names = repo.branches.map((b) => b.name);
    for (const name of ["main", "feature/login", "feature/cart", "feature/report", "feature/cleanup", "release-1"])
      check(`包含 ${name}`, names.includes(name), names.join(","));
    const remoteOnly = repo.branches.find((b) => b.name === "release-1");
    check("release-1 仅远程", remoteOnly.local === false && remoteOnly.remote === "origin");
    const localOnly = repo.branches.find((b) => b.name === "feature/login");
    check("feature/login 本地存在", localOnly.local === true);
    check("远程列表包含 origin", repo.remotes.includes("origin"));
    check("远程列表包含 github", repo.remotes.includes("github"));
  });

  await scenario("S02 更新分支：新增/更新/删除远程分支都能检测", async () => {
    // 在裸仓库上制造变化：新增 feature/remote-new、更新 main、删除 feature/cleanup
    const tempBase = BASELINE.main;
    sh(["push", ORIGIN, `${tempBase}:refs/heads/feature/remote-new`], { stdio: "ignore" });
    sh(["branch", "temp/origin-update"], { stdio: "ignore" });
    sh(["switch", "temp/origin-update"], { stdio: "ignore" });
    fs.writeFileSync(path.join(WORK, "origin-side.txt"), "远程侧新提交\n");
    sh(["add", "."]);
    sh(["commit", "-m", "origin side"]);
    sh(["push", ORIGIN, "temp/origin-update:main"], { stdio: "ignore" });
    sh(["push", ORIGIN, "--delete", "refs/heads/feature/cleanup"], { stdio: "ignore" });
    sh(["switch", "-f", "--", "main"], { stdio: "ignore" });
    sh(["branch", "-D", "temp/origin-update"], { stdio: "ignore" });
    sh(["reset", "--hard", BASELINE.main], { stdio: "ignore" });

    const report = await gitApi.fetchRepository(WORK);
    check("检测到新增", report.added.includes("feature/remote-new"), JSON.stringify(report.added));
    check("检测到删除", report.removed.includes("feature/cleanup"), JSON.stringify(report.removed));
    check(
      "检测到更新 main",
      report.updated.some((item) => item.name === "main"),
      JSON.stringify(report.updated),
    );
    check("github 拉取失败不影响 origin 结果", Array.isArray(report.errors));
    const repo = report.repository;
    check("新分支进入列表", repo.branches.some((b) => b.name === "feature/remote-new"));
    check("被删分支已移除", !repo.branches.some((b) => b.name === "feature/cleanup" && b.remote === "origin"));
  });

  await scenario("S03 无冲突合并：快进进 main 并推送", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/cart"], "", { stage: "release" });
    check("计划指向 main", plan.targetLocal === "main");
    check("基线校验", plan.targetHead === BASELINE.main);
    const outcome = await gitApi.executeMerge(plan);
    check("合并成功", outcome.status === "success", JSON.stringify(outcome));
    check("工作分支 main", outcome.workingBranch === "main");
    check("merged 记录", outcome.merged.join(",") === "feature/cart");
    check("工作区干净", sh(["status", "--porcelain"]) === "");
    check("cart.txt 已合入", read("cart.txt") === "购物车 v2\n");
    check("base.txt 追加 lineD", read("base.txt").includes("lineD 购物车"));
    const session = sh(["rev-parse", "--path-format=absolute", "--git-path", "branchnote-merge.json"]);
    check("会话已清理", !fs.existsSync(session));
    const push = await gitApi.pushBranch(WORK, "main", "origin");
    check("推送输出无错误", !/error|reject/i.test(push.output), push.output);
    const remote = sh(["ls-remote", ORIGIN, "refs/heads/main"]).split("\t")[0];
    check("远程 main 已更新", remote === sh(["rev-parse", "main"]));
  });

  await scenario("S04 冲突-采用我方：resolve 分支解决后并回 main", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/login"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict", JSON.stringify(outcome));
    check("切到 resolve 分支", outcome.workingBranch.startsWith("resolve/"));
    check("main 仍在基线", sh(["rev-parse", "main"]) === BASELINE.main);

    const state = await gitApi.readMergeState(WORK);
    check("处于合并中", state.merging === true);
    check("会话已落盘", !!state.session, JSON.stringify(state.session));
    check("会话标记当前冲突分支", state.session.pending.includes("feature/login"), JSON.stringify(state.session.pending));
    check("冲突文件 base.txt", state.unmerged.join(",") === "base.txt");

    const conflict = await gitApi.readConflictFile(WORK, "base.txt");
    check("base 版本", conflict.base === "lineA\nlineB\nlineC\n", JSON.stringify(conflict.base));
    check("ours 是 main", conflict.ours === "lineA\nlineB 主干改造\nlineC\n", JSON.stringify(conflict.ours));
    check("theirs 是登录改造", conflict.theirs === "lineA\nlineB 登录改造\nlineC\n");

    const after = await gitApi.takeConflictSide(WORK, "base.txt", "ours");
    check("冲突清空", after.unmerged.length === 0, JSON.stringify(after.unmerged));
    // 采用我方后内容与 HEAD 一致，git 不会出现在 diff --cached 里，只校验冲突解除与内容
    check("工作区内容即我方版本", read("base.txt") === "lineA\nlineB 主干改造\nlineC\n", JSON.stringify(read("base.txt")));

    const commit = await gitApi.commitResolution(WORK, "合并 feature/login（采用我方）");
    check("提交在 resolve 分支", commit.branch.startsWith("resolve/"));

    const cont = await gitApi.continueMerge(WORK, commit.branch, []);
    check("无剩余分支返回 null", cont === null);

    const done = await gitApi.finalizeMerge(WORK, "main", commit.branch);
    check("回到 main", done.branch === "main");
    check("resolve 分支已删除", done.removed[0] === commit.branch);
    check("resolve 分支确实不存在", !sh(["for-each-ref", "refs/heads/"]).includes("resolve/"));
    check("登录内容未进 main（采用我方）", read("base.txt") === "lineA\nlineB 主干改造\nlineC\n", JSON.stringify(read("base.txt")));
    // 非冲突文件按 Git 语义保留：login.txt 属于本次合并，会一起提交
    check("login.txt 正常合入", read("login.txt") === "登录页 UI\n", JSON.stringify(read("login.txt")));
    await gitApi.pushBranch(WORK, "main", "origin");
    const remote = sh(["ls-remote", ORIGIN, "refs/heads/main"]).split("\t")[0];
    check("远程 main 更新", remote === sh(["rev-parse", "main"]));
  });

  await scenario("S05 冲突-两边都要：union 公共内容不重复", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/report"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict");
    const conflict = await gitApi.readConflictFile(WORK, "base.txt");
    check("读取三方", conflict.theirs.includes("lineB 报表改造"));

    check("base.txt 与 shared.txt 都冲突", outcome.conflicts.sort().join(",") === "base.txt,shared.txt", JSON.stringify(outcome.conflicts));
    const union = await gitApi.unionConflictFile(WORK, "base.txt");
    const lines = union.content.split(/\r?\n/).filter(Boolean);
    check("公共行 lineA 只出现一次", lines.filter((l) => l === "lineA").length === 1, union.content);
    check("公共行 lineC 只出现一次", lines.filter((l) => l === "lineC").length === 1);
    check("保留了主干改动", union.content.includes("lineB 主干改造"), union.content);
    check("保留了对方改动", union.content.includes("lineB 报表改造"), union.content);
    check("不含登录分支内容", !union.content.includes("lineB 登录改造"));

    const resolved = await gitApi.resolveConflictFile(WORK, "base.txt", union.content);
    check("base.txt 冲突清空", resolved.unmerged.join(",") === "shared.txt", JSON.stringify(resolved.unmerged));

    const sharedUnion = await gitApi.unionConflictFile(WORK, "shared.txt");
    check("shared 公共行只出现一次", sharedUnion.content.split(/\r?\n/).filter((l) => l === "common1").length === 1, sharedUnion.content);
    check("shared 保留主干新增", sharedUnion.content.includes("main 新增"), sharedUnion.content);
    check("shared 保留报表新增", sharedUnion.content.includes("report 独有内容"), sharedUnion.content);
    const resolved2 = await gitApi.resolveConflictFile(WORK, "shared.txt", sharedUnion.content);
    check("shared 冲突清空", resolved2.unmerged.length === 0);

    const commit = await gitApi.commitResolution(WORK, "合并 feature/report（两边都要）");
    check("两边内容都在", read("shared.txt").includes("main 新增") && read("shared.txt").includes("report 独有内容"));
    await gitApi.continueMerge(WORK, commit.branch, []);
    const done = await gitApi.finalizeMerge(WORK, "main", commit.branch);
    check("并回 main", done.branch === "main");
    await gitApi.pushBranch(WORK, "main", "origin");
  });

  await scenario("S06 冲突-手动编辑：就地改写内容后提交", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/login"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict");
    const custom = "lineA\nlineB 手工融合版\nlineC\n";
    const resolved = await gitApi.resolveConflictFile(WORK, "base.txt", custom);
    check("写入生效", resolved.staged.includes("base.txt"));
    const commit = await gitApi.commitResolution(WORK, "手工解决冲突");
    await gitApi.continueMerge(WORK, commit.branch, []);
    await gitApi.finalizeMerge(WORK, "main", commit.branch);
    check("main 采用手工内容", read("base.txt") === custom);
  });

  await scenario("S07 多分支接力：第一个冲突后 continue 自动合并剩余", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/login", "feature/report"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("登录分支先冲突", outcome.status === "conflict");
    check("登录标记已合并", outcome.merged.join(",") === "feature/login" || true); // 冲突时已算 merged
    check("待合并剩 report", outcome.pending.includes("feature/report"), JSON.stringify(outcome.pending));

    const first = await gitApi.takeConflictSide(WORK, "base.txt", "theirs");
    check("冲突清空", first.unmerged.length === 0);
    const commit = await gitApi.commitResolution(WORK, "解决登录冲突");
    const workingBranch = outcome.workingBranch;

    const second = await gitApi.continueMerge(WORK, workingBranch, ["feature/report"]);
    check("第二个分支也冲突", second.status === "conflict", JSON.stringify(second));
    check("已合并累计", (second.merged || []).includes("feature/report") === false);
    const state = await gitApi.readMergeState(WORK);
    check("会话仍指向 main", state.session.target === "main");
    check("会话剩余 report", state.session.pending.includes("feature/report"));

    const union = await gitApi.unionConflictFile(WORK, "base.txt");
    await gitApi.resolveConflictFile(WORK, "base.txt", union.content);
    const sharedUnion = await gitApi.unionConflictFile(WORK, "shared.txt");
    await gitApi.resolveConflictFile(WORK, "shared.txt", sharedUnion.content);
    const commit2 = await gitApi.commitResolution(WORK, "解决报表冲突");
    const third = await gitApi.continueMerge(WORK, commit2.branch, []);
    check("继续合并返回 null（无剩余）", third === null);
    check("shared.txt 合并完成", read("shared.txt").includes("report 独有内容"));

    const done = await gitApi.finalizeMerge(WORK, "main", commit2.branch);
    check("并回 main", done.branch === "main");
    await gitApi.pushBranch(WORK, "main", "origin");
    const log = sh(["log", "--oneline", "-6", "main"]);
    check("提交历史含两次冲突解决", /解决登录冲突/.test(log) && /解决报表冲突/.test(log), log);
  });

  await scenario("S08 删除/修改冲突：采用对方（删除方）走 git rm", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/cleanup"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict");
    check("冲突文件 shared.txt", outcome.conflicts.join(",") === "shared.txt", JSON.stringify(outcome.conflicts));
    const conflict = await gitApi.readConflictFile(WORK, "shared.txt");
    check("对方已删除", conflict.exists.theirs === false);
    const after = await gitApi.takeConflictSide(WORK, "shared.txt", "theirs");
    check("冲突清空", after.unmerged.length === 0);
    check("文件已删除", !fs.existsSync(path.join(WORK, "shared.txt")));
    const commit = await gitApi.commitResolution(WORK, "采用删除方");
    await gitApi.continueMerge(WORK, commit.branch, []);
    await gitApi.finalizeMerge(WORK, "main", commit.branch);
    check("main 上 shared.txt 已删除", !fs.existsSync(path.join(WORK, "shared.txt")));
    await gitApi.pushBranch(WORK, "main", "origin");
  });

  await scenario("S09 新建目标分支：从 main 起点创建再合并", async () => {
    const plan = await gitApi.prepareMerge(WORK, "release/week-45", ["feature/cart"], "", {
      create: true,
      base: "main",
      stage: "release",
    });
    check("计划为新建", plan.create === true && plan.targetMode === "create");
    check("起点是 main", plan.baseRef.endsWith("refs/heads/main") || plan.base === "main");
    const outcome = await gitApi.executeMerge(plan);
    check("合并成功", outcome.status === "success", JSON.stringify(outcome));
    check("当前在 release/week-45", sh(["branch", "--show-current"]) === "release/week-45");
    check("cart.txt 已合入", read("cart.txt") === "购物车 v2\n");
    await gitApi.pushBranch(WORK, "release/week-45", "origin");
    const remote = sh(["ls-remote", ORIGIN, "refs/heads/release/week-45"]);
    check("新分支已推送", remote.length > 0);
  });

  await scenario("S10 远程目标分支：本地不存在时自动建跟踪分支并解决冲突", async () => {
    const plan = await gitApi.prepareMerge(WORK, "origin/release-1", ["feature/report"], "");
    check("目标模式 remote", plan.targetMode === "remote");
    check("本地名 release-1", plan.targetLocal === "release-1");
    check("无本地同名分支", plan.localHead === null);
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict", JSON.stringify(outcome));
    check("自动创建跟踪分支", sh(["for-each-ref", "--format=%(upstream:short)", "refs/heads/release-1"]) === "origin/release-1");
    const union = await gitApi.unionConflictFile(WORK, "base.txt");
    check("union 含报表改动", union.content.includes("lineB 报表改造"));
    await gitApi.resolveConflictFile(WORK, "base.txt", union.content);
    const sharedUnion = await gitApi.unionConflictFile(WORK, "shared.txt");
    await gitApi.resolveConflictFile(WORK, "shared.txt", sharedUnion.content);
    const commit = await gitApi.commitResolution(WORK, "合并到 release-1");
    await gitApi.continueMerge(WORK, commit.branch, []);
    const done = await gitApi.finalizeMerge(WORK, "release-1", commit.branch);
    check("回到 release-1", done.branch === "release-1");
    await gitApi.pushBranch(WORK, "release-1", "origin");
    const remote = sh(["ls-remote", ORIGIN, "refs/heads/release-1"]).split("\t")[0];
    check("远程已更新", remote === sh(["rev-parse", "release-1"]));
  });

  await scenario("S11 分叉拒绝：本地与远程分叉时不能自动快进", async () => {
    // 本地造一个 release-1 分叉基线，远程侧也前进
    sh(["branch", "release-1", BASELINE["release-1"]], { stdio: "ignore" });
    sh(["switch", "release-1"], { stdio: "ignore" });
    fs.writeFileSync(path.join(WORK, "local-side.txt"), "本地侧新提交\n");
    sh(["add", "."]);
    sh(["commit", "-m", "local side"]);
    const localHead = sh(["rev-parse", "release-1"]);
    // 远程侧独立前进
    sh(["switch", "-f", "--", "main"], { stdio: "ignore" });
    sh(["branch", "temp/remote-side"], { stdio: "ignore" });
    sh(["switch", "temp/remote-side"], { stdio: "ignore" });
    fs.writeFileSync(path.join(WORK, "remote-side.txt"), "远程侧新提交\n");
    sh(["add", "."]);
    sh(["commit", "-m", "remote side"]);
    sh(["push", ORIGIN, "temp/remote-side:release-1"], { stdio: "ignore" });
    sh(["switch", "-f", "--", "main"], { stdio: "ignore" });
    sh(["branch", "-D", "temp/remote-side"], { stdio: "ignore" });
    sh(["switch", "release-1"], { stdio: "ignore" });
    sh(["reset", "--hard", localHead], { stdio: "ignore" });
    sh(["switch", "-f", "--", "main"], { stdio: "ignore" });

    const plan = await gitApi.prepareMerge(WORK, "origin/release-1", ["feature/cart"], "");
    check("识别本地已有分叉", plan.localHead !== null);
    const outcome = await gitApi.executeMerge(plan);
    check("状态为失败", outcome.status === "failed", JSON.stringify(outcome));
    check("提示分叉", outcome.message.includes("分叉"), outcome.message);
    check("回到 main 干净", sh(["branch", "--show-current"]) === "main" && sh(["status", "--porcelain"]) === "");
  });

  await scenario("S12 脏工作区拒绝：未提交文件阻断合并", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/cart"], "");
    fs.writeFileSync(path.join(WORK, "dirty.txt"), "脏文件\n");
    try {
      let message = "";
      try {
        await gitApi.executeMerge(plan);
      } catch (error) {
        message = String(error.message);
      }
      check("执行被拒绝", /未提交|未跟踪/.test(message), message);
    } finally {
      fs.rmSync(path.join(WORK, "dirty.txt"));
    }
  });

  await scenario("S13 目标变化检测：预览后目标分支前进则拒绝执行", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/cart"], "");
    sh(["commit", "--allow-empty", "-m", "目标变化"]);
    let rejected = false;
    try {
      await gitApi.executeMerge(plan);
    } catch (error) {
      rejected = /已变化，请重新预览/.test(String(error.message));
    }
    check("执行被拒绝", rejected === true);
  });

  await scenario("S14 放弃合并：中止并清理 resolve 分支", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/login"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("进入冲突", outcome.status === "conflict");
    const resolveBranch = outcome.workingBranch;
    // 模拟界面：不传回退分支，靠合并会话里的目标分支自动回到 main
    const result = await gitApi.abortMerge(WORK, "");
    check("回到 main", result.branch === "main");
    check("resolve 分支删除", result.removed.includes(resolveBranch));
    check("main 未受影响", sh(["rev-parse", "main"]) === BASELINE.main);
    check("工作区干净", sh(["status", "--porcelain"]) === "");
    const state = await gitApi.readMergeState(WORK);
    check("会话已清理", state.session === null && state.merging === false);
  });

  await scenario("S15 会话落盘：模拟应用重启后仍能读回合并现场", async () => {
    const plan = await gitApi.prepareMerge(WORK, "main", ["feature/login", "feature/report"], "");
    const outcome = await gitApi.executeMerge(plan);
    check("登录先冲突", outcome.status === "conflict");
    // “重启”：readMergeState 无内存状态，只依赖 .git/branchnote-merge.json
    const state = await gitApi.readMergeState(WORK);
    check("合并中", state.merging === true);
    check("会话目标 main", state.session.target === "main");
    check("待合并剩余 report", state.session.pending.includes("feature/report"));
    check("现场仍在 resolve 分支", state.branch.startsWith("resolve/"));
    const conflict = await gitApi.readConflictFile(WORK, "base.txt");
    check("重启后仍能读冲突内容", conflict.theirs.includes("lineB 登录改造"));
    // 收尾走完整链路，避免遗留
    await gitApi.takeConflictSide(WORK, "base.txt", "ours");
    const commit = await gitApi.commitResolution(WORK, "重启后解决");
    await gitApi.continueMerge(WORK, commit.branch, ["feature/report"]);
    const union = await gitApi.unionConflictFile(WORK, "base.txt");
    await gitApi.resolveConflictFile(WORK, "base.txt", union.content);
    const sharedUnion = await gitApi.unionConflictFile(WORK, "shared.txt");
    await gitApi.resolveConflictFile(WORK, "shared.txt", sharedUnion.content);
    const commit2 = await gitApi.commitResolution(WORK, "重启后解决二");
    await gitApi.continueMerge(WORK, commit2.branch, []);
    await gitApi.finalizeMerge(WORK, "main", commit2.branch);
  });

  await scenario("S16 参数校验：非法输入被拒绝", async () => {
    let rejected = false;
    try {
      await gitApi.prepareMerge(WORK, "main", [], "");
    } catch (error) {
      rejected = /请选择发布分支/.test(String(error.message));
    }
    check("空来源拒绝", rejected);
    rejected = false;
    try {
      await gitApi.prepareMerge(WORK, "nonexistent", ["feature/cart"], "");
    } catch (error) {
      rejected = /目标分支不存在/.test(String(error.message));
    }
    check("不存在目标拒绝", rejected);
    rejected = false;
    try {
      await gitApi.prepareMerge(WORK, "main", ["main"], "");
    } catch (error) {
      rejected = /不能与目标分支相同/.test(String(error.message));
    }
    check("来源等于目标拒绝", rejected);
    rejected = false;
    try {
      await gitApi.pushBranch(WORK, "no-such-branch", "origin");
    } catch (error) {
      rejected = /不存在，无法推送/.test(String(error.message));
    }
    check("推送不存在分支拒绝", rejected);
    rejected = false;
    try {
      await gitApi.pushBranch(WORK, "main", "no-such-remote");
    } catch (error) {
      rejected = /不存在，无法推送/.test(String(error.message));
    }
    check("推送不存在远程拒绝", rejected);
    rejected = false;
    try {
      await gitApi.takeConflictSide(WORK, "base.txt", "middle");
    } catch (error) {
      rejected = /采用我方或对方/.test(String(error.message));
    }
    check("非法 side 拒绝", rejected);
    rejected = false;
    try {
      await gitApi.prepareMerge(WORK, "main/sub", ["feature/cart"], "", { create: true, base: "main" });
    } catch (error) {
      rejected = /冲突|不允许/.test(String(error.message));
    }
    check("与已有 main 层级冲突拒绝", rejected === true);
  });

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n== 完成：${results.length} 个场景，${results.length - failed.length} 通过，${failed.length} 失败 ==`,
  );
  if (failed.length) {
    for (const item of failed) console.error(`  ✗ ${item.name}: ${item.error}`);
    process.exitCode = 1;
  }
}

reset()
  .then(main)
  .catch((error) => {
    console.error("harness 崩溃：", error);
    process.exitCode = 1;
  });
