#!/usr/bin/env node
// 在 gitlab.com 上准备一个用来验证 BranchNote 的私有项目：
//   1) 用你的 Personal Access Token 建项目
//   2) 把本地测试仓库（TestBranchNote）的全部分支推上去
//   3) 把 release 设成受保护分支（谁都不能直接 push，只能走 MR）
//   4) 在 ~/Desktop/github/GitLabDemo 留一份 origin 指向 GitLab 的克隆，供应用关联
//
// 用法（PowerShell，令牌不落进命令历史）：
//   $t = Read-Host "粘贴 GitLab PAT" -AsSecureString
//   $env:GITLAB_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
//     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($t))
//   node scripts/gitlab-demo.mjs
//
// PAT 需要 api + write_repository 两个 scope。令牌只在本次进程里用，不写入任何 git 配置。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const TOKEN = (process.env.GITLAB_TOKEN || "").trim();
const BASE = (process.env.GITLAB_URL || "https://gitlab.com").replace(/\/+$/, "");
const API = `${BASE}/api/v4`;
const SOURCE = process.env.SOURCE_REPO || "C:/Users/FF/Desktop/github/TestBranchNote";
const TARGET = process.env.DEMO_DIR || "C:/Users/FF/Desktop/github/GitLabDemo";
const PROJECT_PATH = process.env.DEMO_PROJECT || "branchnote-demo";
const PROJECT_NAME = "BranchNote Demo";
const PROTECTED = ["release"];

const log = (message) => console.log(message);
const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

if (!TOKEN) {
  fail(
    "没有拿到 GITLAB_TOKEN。请先在 gitlab.com 创建 Personal Access Token（scope: api、write_repository），再按脚本顶部注释里的 PowerShell 写法设置环境变量。",
  );
}

async function api(method, endpoint, body) {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      "PRIVATE-TOKEN": TOKEN,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data, text };
}

async function git(directory, args, options = {}) {
  return (
    await run("git", ["-C", directory, ...args], {
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    })
  ).stdout.trim();
}

// 把带令牌的地址临时拼出来，只传给单次 git 命令，不落盘、不打印
const withToken = (url) => url.replace(/^https:\/\//i, `https://oauth2:${TOKEN}@`);

async function main() {
  log(`目标平台：${BASE}`);

  const me = await api("GET", "/user");
  if (!me.ok)
    fail(
      me.status === 401
        ? "令牌无效或已过期（401）。请确认复制完整，且勾选了 api scope。"
        : `读取账号失败（${me.status}）：${me.data?.message || me.text.slice(0, 200)}`,
    );
  const user = me.data;
  log(`账号：@${user.username}（${user.name || "未填姓名"}）`);

  // ---- 1. 建项目（已存在就复用）----
  let project = null;
  const created = await api("POST", "/projects", {
    name: PROJECT_NAME,
    path: PROJECT_PATH,
    visibility: "private",
    initialize_with_readme: false,
  });
  if (created.ok) project = created.data;
  else if (/already been taken|has already been taken/i.test(created.text)) {
    const found = await api(
      "GET",
      `/projects/${encodeURIComponent(`${user.username}/${PROJECT_PATH}`)}`,
    );
    if (!found.ok) fail(`项目已存在但读取失败（${found.status}）：${found.text.slice(0, 200)}`);
    project = found.data;
    log(`项目已存在，复用：${project.path_with_namespace}`);
  } else {
    fail(`创建项目失败（${created.status}）：${created.data?.message || created.text.slice(0, 300)}`);
  }
  const projectUrl = project.web_url;
  const httpUrl = project.http_url_to_repo.replace(/\.git$/, ".git");
  log(`✓ 项目：${projectUrl}`);

  // ---- 2. 准备克隆（独立的目录，不动原来的测试仓库）----
  let cloned = true;
  try {
    await fs.access(path.join(TARGET, ".git"));
    cloned = false;
  } catch {
    await fs.mkdir(path.dirname(TARGET), { recursive: true });
  }
  if (cloned) {
    log(`正在从本地测试仓库克隆到 ${TARGET} …`);
    await run("git", ["clone", SOURCE, TARGET], { windowsHide: true, encoding: "utf8" });
  } else {
    log(`复用已有克隆：${TARGET}`);
  }

  // ---- 3. 推全部分支：逐条推送，失败立刻看得见（不再整体吞掉报错）----
  // 复跑时 release 可能已是受保护分支，先临时解除，推完再重新保护
  for (const name of PROTECTED) {
    const removed = await api(
      "DELETE",
      `/projects/${project.id}/protected_branches/${encodeURIComponent(name)}`,
    );
    if (removed.ok) log(`（复跑）临时解除 ${name} 的保护以便推送`);
  }

  const refs = (
    await git(TARGET, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/remotes/origin",
    ])
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((ref) => ref !== "origin/HEAD");
  if (!refs.length) fail("本地克隆里没有可推送的分支");

  log(`正在推送 ${refs.length} 个分支到 GitLab …`);
  const failed = [];
  for (const ref of refs) {
    const name = ref.replace(/^origin\//, "");
    try {
      await git(TARGET, [
        "push",
        "--force",
        withToken(httpUrl),
        `${ref}:refs/heads/${name}`,
      ]);
      log(`  ✓ ${name}`);
    } catch (error) {
      const raw = String(error.stderr || error.message || "")
        .replace(TOKEN, "***")
        .trim();
      failed.push({ name, raw });
      log(`  ✗ ${name}：${raw.split(/\r?\n/).slice(-2).join(" ").slice(0, 220)}`);
    }
  }
  if (failed.length === refs.length) {
    fail(
      `全部分支推送失败，GitLab 上没有可用的测试分支。\n最常见原因：令牌缺少 write_repository scope，或该账号对这个项目没有写权限。\n最后一条错误：\n${failed[0].raw.split(/\r?\n/).slice(0, 8).join("\n")}`,
    );
  }
  if (failed.length) log(`! ${failed.length} 个分支推送失败（其余已成功），详见上面的 ✗ 行`);

  // origin 指到 GitLab（不带令牌），提交身份用 GitLab 账号
  await git(TARGET, ["remote", "set-url", "origin", httpUrl]);
  await git(TARGET, ["config", "user.name", user.name || user.username]);
  await git(TARGET, [
    "config",
    "user.email",
    user.public_email || user.email || `${user.username}@users.noreply.gitlab.com`,
  ]);

  // ---- 4. 保护分支：谁都不能直接 push，只能通过 MR 合入 ----
  for (const name of PROTECTED) {
    const result = await api("POST", `/projects/${project.id}/protected_branches`, {
      name,
      push_access_level: 0, // No one
      merge_access_level: 40, // Maintainer 可合并
    });
    if (result.ok) log(`✓ 已保护分支 ${name}（禁止直接 push，只能走 MR）`);
    else if (result.status === 409 || /already protected/i.test(result.text))
      log(`✓ 分支 ${name} 已经是受保护状态`);
    else log(`! 保护 ${name} 失败（${result.status}）：${result.text.slice(0, 160)}`);
  }

  // ---- 5. 以 GitLab 的接口回读为准，确认分支真的在远端 ----
  const remote = await api(
    "GET",
    `/projects/${project.id}/repository/branches?per_page=100`,
  );
  if (remote.ok) {
    const names = (remote.data || []).map((item) => item.name);
    log(`✓ GitLab 上现有分支（${names.length}）：${names.join("、") || "（空）"}`);
    if (!names.length)
      fail("接口回读显示项目仍是空的：分支没有推上去，请看上面的 ✗ 原因");
  } else {
    log(`! 回读远端分支失败（${remote.status}）：${remote.text.slice(0, 160)}`);
  }

  // ---- 6. 打印下一步 ----
  log("\n================ 下一步在 BranchNote 里操作 ================");
  log(`1. 点「从仓库添加分支」→ 选择文件夹：${TARGET}`);
  log("2. 「本版本目标」栏：把发布分支改成 origin/release，并勾上「受保护」");
  log("3. 「数据与设置」→「代码托管令牌」：平台地址填 gitlab.com，类型 GitLab，");
  log("   粘贴同一个 PAT → 保存 → 点「测试连接」应显示当前账号");
  log("4. 回到列表，对 feature/login 点「提交发布」");
  log(`   → 完成页应显示「已创建合并请求（MR） #1」，浏览器打开 ${projectUrl}/-/merge_requests`);
  log("5. 在 GitLab 页面确认源分支是 mr/release-<时间戳>、目标是 release；");
  log("   再到分支列表看 release 仍是基线（没有新的合并提交）");
  log("=========================================================");
  log(`\n项目地址：${projectUrl}`);
  log("令牌只用于本次命令，没有写进仓库配置；验证完可以在 GitLab 里撤销该 PAT。");
}

main().catch((error) => fail(error.message));
