// 针对提交流程与目标分支管理的真实应用测试（Electron + CDP）
// 1) 操作列直接给出「提交测试 / 提交发布」，批量操作栏同样，点哪个合哪个
// 2) 冲突可以在外部编辑器里解决：保存后内容同步进应用，用户确认后才提交继续
// 3) 主界面目标分支条：醒目显示测试/发布分支，可修改；新名字合并时自动创建
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const APP = "C:/Users/FF/Desktop/github/BranchNote";
const WORK = "C:/Users/FF/Desktop/github/TestBranchNote";
const ORIGIN = "C:/Users/FF/Desktop/github/TestBranchNote-bare.git";
const DATA = path.join(process.env.APPDATA, "branchnote/branchnote.json");
const SHOTS = path.join(APP, "docs/e2e");
const PORT = 9334;
// 基线用完整 SHA：短名和 rev-parse 结果永远不相等，会误判
const BASE = execFileSync(
  "git",
  ["-C", "C:/Users/FF/Desktop/github/TestBranchNote", "rev-parse", "08bba0e^{commit}"],
  { encoding: "utf8" },
).trim();

const sh = (args, cwd = WORK) => {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    return typeof out === "string" ? out.trim() : "";
  } catch {
    return "";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 推送失败时把 stderr 打出来，避免静默失败把基线弄脏
const pushForce = (refspec) => {
  try {
    // 必须用远端名 origin 推送，直接推路径不会更新 origin/* 跟踪分支
    execFileSync("git", ["-C", WORK, "push", "--force", "origin", refspec], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.log("  push 失败：", refspec, String(error.stderr || error.message).trim());
  }
};

function resetRepo() {
  sh(["merge", "--abort"]);
  sh(["reset", "--hard"]);
  sh(["clean", "-fd"]);
  sh(["switch", "-f", "--", "main"]);
  try {
    fs.rmSync(path.join(WORK, ".git", "branchnote-merge.json"), { force: true });
  } catch {}
  for (const branch of ["release", "test", "main"])
    sh(["update-ref", `refs/heads/${branch}`, BASE]);
  sh(["fetch", "origin", "--prune"]);
  pushForce("refs/heads/main:refs/heads/main");
  pushForce("refs/heads/release:refs/heads/release");
  pushForce("refs/heads/test:refs/heads/test");
  sh(["fetch", "origin", "--prune"]);
  sh(["reset", "--hard", BASE]);
  for (const branch of ["main", "release", "test"]) {
    const local = sh(["rev-parse", branch]);
    const remote = sh(["rev-parse", `origin/${branch}`]);
    if (local !== BASE || remote !== BASE)
      console.log(
        `  reset 检查：${branch} 本地 ${local.slice(0, 7)} 远程 ${remote.slice(0, 7)} 基线 ${BASE.slice(0, 7)}`,
      );
  }
}

function seedData() {
  const now = new Date().toISOString();
  const project = {
    id: "e2e-project-0001",
    name: "测试仓库",
    note: "示例订单系统 · 合并演练",
    color: "#007aff",
    archived: false,
    repositoryPath: WORK,
    testTarget: "origin/test",
    releaseTarget: "origin/release",
  };
  const branch = (id, name, description) => ({
    id,
    projectId: project.id,
    name,
    description,
    note: "",
    testMergedAt: null,
    releaseMergedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  fs.writeFileSync(
    DATA,
    JSON.stringify(
      {
        version: 3,
        projects: [project],
        branches: [
          branch("b-1", "feature/login", "登录模块"),
          branch("b-2", "feature/cart", "购物车"),
          branch("b-3", "feature/discount", "会员日折扣"),
          branch("b-4", "feature/api-refactor", "计价重构"),
          branch("b-5", "feature/cleanup", "清理旧入口"),
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
}

const request = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });

async function findTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = JSON.parse(await request(`http://127.0.0.1:${PORT}/json/list`));
      const page = list.find(
        (item) => item.type === "page" && item.webSocketDebuggerUrl,
      );
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("无法连接到 Electron 调试端口");
}

function connect(url) {
  const socket = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      payload.error
        ? reject(new Error(payload.error.message))
        : resolve(payload.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { ready, send, close: () => socket.close() };
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok || !detail ? "" : ` :: ${detail}`}`);
};

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  // 旧实例会抢同一个 userData 和调试端口，必须先关掉
  try {
    execFileSync("taskkill", ["/IM", "electron.exe", "/F"], { stdio: "ignore" });
  } catch {}
  await sleep(800);
  resetRepo();
  seedData();

  const electron = path.join(APP, "node_modules/electron/dist/electron.exe");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electron,
    [`--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", "."],
    { cwd: APP, env, stdio: "ignore" },
  );
  let closing = false;
  const finish = () => {
    if (closing) return;
    closing = true;
    child.kill();
  };
  process.on("exit", finish);

  try {
    const page = await findTarget();
    const { ready, send, close } = connect(page.webSocketDebuggerUrl);
    await ready;
    await send("Runtime.enable");
    await send("Page.enable");

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          `页面脚本异常：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`,
        );
      return result.result.value;
    };
    const waitFor = async (expression, label, timeout = 30000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (await evaluate(expression)) return true;
        await sleep(250);
      }
      throw new Error(`等待超时：${label}`);
    };
    const shot = async (name) => {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
    };
    const text = () => evaluate("document.body.innerText");
    const clickText = async (label) => {
      const found = await evaluate(
        `(()=>{const t=${JSON.stringify(label.replace(/\s+/g, ""))};const b=[...document.querySelectorAll('button')].find(x=>x.textContent.replace(/\\s+/g,'').includes(t));if(!b)return false;b.click();return true})()`,
      );
      if (!found) {
        const labels = await evaluate(
          `[...document.querySelectorAll('button')].map(b=>b.textContent.replace(/\\s+/g,'')).filter(Boolean).join(' / ')`,
        );
        throw new Error(`找不到按钮：${label}\n现有按钮：${labels}`);
      }
    };
    const openRow = async (name, stage = "release") => {
      const label = `提交 ${name} 到${stage === "test" ? "测试" : "发布"}分支`;
      const ok = await evaluate(
        `(()=>{const b=document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});if(!b)return false;b.click();return true})()`,
      );
      if (!ok) throw new Error(`找不到 ${name} 的「${stage === "test" ? "提交测试" : "提交发布"}」按钮`);
    };
    const reload = async () => {
      await send("Page.reload");
      await waitFor("document.querySelectorAll('.nav-item').length>0", "应用重载", 30000);
      await evaluate(
        `(()=>{const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('测试仓库'));if(!b)return false;b.click();return true})()`,
      );
      await waitFor("!!document.querySelector('table')", "分支表格", 30000);
    };

    // ---- 用例 1：操作列直接给出「提交测试 / 提交发布」，点哪个合哪个 ----
    await waitFor("document.querySelectorAll('.nav-item').length>0", "应用加载", 40000);
    await reload();
    const rowButtons = await evaluate(
      `(()=>{const t=document.querySelector('button[aria-label="提交 feature/login 到测试分支"]');const r=document.querySelector('button[aria-label="提交 feature/login 到发布分支"]');return !!t&&!!r})()`,
    );
    check("操作列有「提交测试」「提交发布」两个入口", !!rowButtons);
    await shot("30-row-actions");

    // 点「提交测试」：不再有阶段选择页，直接开跑
    await openRow("feature/cart", "test");
    await waitFor(
      `document.body.innerText.includes('已合入测试分支')`,
      "测试合并完成",
      60000,
    );
    check("点「提交测试」直接合入测试分支（无需二次选择）", true);
    await waitFor(
      `document.body.innerText.includes('已推送') || document.body.innerText.includes('推送失败')`,
      "推送结束",
      40000,
    );
    check(
      "origin/test 前进",
      sh(["rev-parse", "origin/test"]) !== BASE,
      sh(["rev-parse", "origin/test"]),
    );
    check(
      "origin/release 没动",
      sh(["rev-parse", "origin/release"]) === BASE,
      sh(["rev-parse", "origin/release"]),
    );
    check("购物车文件已合入 test", fs.existsSync(path.join(WORK, "src/cart.js")));
    await shot("31-test-done");
    await clickText("关闭");
    const tableText = await text();
    check("列表测试列已写成已合并", tableText.includes("已合并"), tableText.slice(0, 300));

    // ---- 用例 2：点「提交发布」走发布分支 ----
    resetRepo();
    seedData();
    await reload();
    await openRow("feature/login", "release");
    await waitFor(`document.body.innerText.includes('已合入发布分支')`, "发布合并完成", 60000);
    await waitFor(
      `document.body.innerText.includes('已推送') || document.body.innerText.includes('推送失败')`,
      "推送结束",
      40000,
    );
    check(
      "完成页没有推送失败",
      !(await text()).includes("推送失败"),
      (await text()).slice(0, 200),
    );
    check("登录文件已合入 release", fs.existsSync(path.join(WORK, "src/login.js")));
    check(
      "origin/release 已推送新提交",
      sh(["rev-parse", "origin/release"]) !== BASE &&
        sh(["rev-parse", "origin/release"]) === sh(["rev-parse", "release"]),
      `${sh(["rev-parse", "origin/release"])} vs ${sh(["rev-parse", "release"])}`,
    );
    check("测试分支未被动过", sh(["rev-parse", "origin/test"]) === BASE);
    await shot("32-release-done");
    await clickText("关闭");

    // ---- 用例 3：批量勾选后同样可以直接提交测试/发布 ----
    resetRepo();
    seedData();
    await reload();
    const picked = await evaluate(
      `(()=>{for(const n of ['feature/login','feature/cart']){const c=document.querySelector('input[aria-label="选择 '+n+'"]');if(!c)return false;c.click()}return true})()`,
    );
    check("批量勾选两个分支", !!picked);
    await waitFor(`!!document.querySelector('.selection-bar')`, "批量操作栏", 20000);
    const selectionText = await evaluate(
      "document.querySelector('.selection-bar')?.innerText || ''",
    );
    check(
      "批量操作栏有「提交测试」「提交发布」",
      selectionText.includes("提交测试") && selectionText.includes("提交发布"),
      selectionText,
    );
    await shot("33-selection-bar");
    await evaluate(`document.querySelector('.selection-submit.release')?.click()`);
    await waitFor(`document.body.innerText.includes('已合入发布分支')`, "批量合并完成", 60000);
    check(
      "批量合并了 2 个分支",
      (await text()).includes("本次合入 2 个分支"),
      (await text()).slice(0, 200),
    );
    await waitFor(
      `document.body.innerText.includes('已推送') || document.body.innerText.includes('推送失败')`,
      "推送结束",
      40000,
    );
    check(
      "两个文件都进了 release",
      fs.existsSync(path.join(WORK, "src/login.js")) &&
        fs.existsSync(path.join(WORK, "src/cart.js")),
    );
    check(
      "批量提交没有顺带写 test",
      sh(["rev-parse", "origin/test"]) === BASE,
      sh(["rev-parse", "origin/test"]),
    );
    await shot("34-batch-done");
    await clickText("关闭");

    // ---- 用例 4：冲突在外部编辑器解决，保存后自动识别 ----
    resetRepo();
    seedData();
    await reload();
    await openRow("feature/discount", "release");
    await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 40000);
    await waitFor(
      `!!document.querySelector('.resolve-toolbar button')`,
      "冲突工具栏",
      20000,
    );
    const hasEditorButton = await evaluate(
      `[...document.querySelectorAll('.resolve-toolbar button')].some(b=>b.textContent.includes('用编辑器解决'))`,
    );
    check("冲突页有「用编辑器解决」入口", !!hasEditorButton);
    await clickText("用编辑器解决");
    try {
      await waitFor(
        `document.body.innerText.includes('已在编辑器打开')`,
        "编辑器打开提示",
        20000,
      );
    } catch (error) {
      console.log(
        "  编辑器打开失败，界面文字：",
        (await evaluate("document.querySelector('.modal')?.innerText || ''")).slice(0, 400),
      );
      throw error;
    }
    check("点击后提示已交给编辑器", true);
    await shot("35-editor-open");

    // 模拟用户在编辑器里改完保存：去掉冲突标记，保留两边改动
    const resolved = [
      "// 订单系统公共配置",
      "export const config = {",
      "  // 折扣率：会员日全场 75 折（合并后）",
      "  discountRate: 0.75,",
      "  // 包邮门槛（元）",
      "  freeShippingAt: 99,",
      '  currency: "CNY",',
      "};",
      "",
      "// 购物车单次最多 99 件",
      "export const cartLimit = 99;",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(WORK, "src/config.js"), resolved, "utf8");

    // 编辑器保存后：内容同步进编辑区并提示确认，但绝不自动提交
    await waitFor(
      `document.body.innerText.includes('已同步编辑器保存的')`,
      "编辑器保存后同步提示",
      20000,
    );
    const syncedDraft = await evaluate(
      "document.querySelector('.resolve-text')?.value || ''",
    );
    check("编辑器内容已同步进编辑区", syncedDraft.includes("discountRate: 0.75"));
    await sleep(4000);
    const jumpedEarly = await evaluate(
      `document.body.innerText.includes('已合入发布分支')`,
    );
    check("同步后不会自动提交（等用户确认）", !jumpedEarly);

    await clickText("保存并标记已解决");
    await waitFor(
      `document.body.innerText.includes('已合入发布分支')`,
      "确认后继续到完成",
      60000,
    );
    await waitFor(
      `document.body.innerText.includes('已推送') || document.body.innerText.includes('推送失败')`,
      "推送结束",
      40000,
    );
    const final = fs.readFileSync(path.join(WORK, "src/config.js"), "utf8");
    check("编辑器里的结果被采用", final.includes("discountRate: 0.75"));
    check("提交后无冲突标记", !/^(<{7}|={7}|>{7})/m.test(final), final.slice(0, 120));
    check(
      "release 已包含这次合并",
      sh(["rev-parse", "origin/release"]) === sh(["rev-parse", "release"]) &&
        sh(["rev-parse", "release"]) !== BASE,
    );
    await shot("36-editor-done");

    // ---- 用例 5：主界面目标分支条（醒目显示 + 可修改 + 新名字自动创建） ----
    resetRepo();
    seedData();
    await reload();
    await waitFor(`!!document.querySelector('.target-bar')`, "目标分支条", 20000);
    const barText = await evaluate(
      "document.querySelector('.target-bar')?.innerText || ''",
    );
    check("目标栏显示测试分支 origin/test", barText.includes("origin/test"), barText);
    check(
      "目标栏显示发布分支 origin/release",
      barText.includes("origin/release"),
      barText,
    );
    await shot("37-target-bar");

    // 点开编辑，把测试分支换成仓库里还不存在的新名字
    await evaluate(`document.querySelector('.target-chip.test')?.click()`);
    await waitFor(
      `document.body.innerText.includes('修改目标分支')`,
      "目标分支编辑弹窗",
      20000,
    );
    // 等表单初始化完成（选择器渲染出来）再操作，避开加载期
    await waitFor(
      `!!document.querySelector('.target-form .select-trigger')`,
      "目标表单就绪",
      20000,
    );
    await evaluate(
      `document.querySelector('.target-form .select-trigger')?.click()`,
    );
    await clickText("新建测试分支");
    await evaluate(
      `(()=>{const i=document.querySelector('.target-form input');if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'test-1106');i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await clickText("保存");
    await waitFor(
      `document.querySelector('.target-chip.test')?.innerText.includes('test-1106')`,
      "目标栏更新为新名字",
      20000,
    );
    check("目标栏已显示新测试分支", true);
    await shot("38-target-edited");

    // 重载后仍记住新名字
    await reload();
    const barAfter = await evaluate(
      "document.querySelector('.target-bar')?.innerText || ''",
    );
    check("重载后目标栏仍是新名字", barAfter.includes("test-1106"), barAfter);

    // 合并到测试分支：新名字仓库里没有，应自动从起点分支创建
    await openRow("feature/login", "test");
    await waitFor(
      `document.body.innerText.includes('已合入测试分支')`,
      "合入新测试分支",
      60000,
    );
    check(
      "结果页显示目标是 test-1106",
      (await text()).includes("test-1106"),
      (await text()).slice(0, 300),
    );
    check(
      "本地已创建 test-1106 分支",
      sh(["rev-parse", "--verify", "test-1106"]) !== "",
    );
    check(
      "test-1106 包含合并提交",
      sh(["rev-parse", "test-1106"]) !== BASE,
      sh(["rev-parse", "test-1106"]),
    );
    check(
      "origin/test 没被动过",
      sh(["rev-parse", "origin/test"]) === BASE,
    );
    await shot("39-target-merge");
    await clickText("关闭");

    // ---- 用例 6：受保护的发布分支只能走 MR，功能分支保持干净 ----
    resetRepo();
    sh(["branch", "-D", "test-1106"]);
    // 清理上次运行（异常中断）残留的 mr/* 分支
    for (const name of sh(["for-each-ref", "--format=%(refname:short)", "refs/heads/mr/*"])
      .split(/\r?\n/)
      .filter(Boolean))
      sh(["branch", "-D", name]);
    sh(["fetch", "origin", "--prune"]);
    seedData();
    // 发布分支标记为受保护
    const raw = JSON.parse(fs.readFileSync(DATA, "utf8"));
    raw.projects[0].releaseProtected = true;
    fs.writeFileSync(DATA, JSON.stringify(raw));
    await reload();
    await waitFor(
      `!!document.querySelector('.target-chip.release .target-lock')`,
      "目标栏发布分支显示锁标",
      20000,
    );
    check("受保护时目标栏显示锁标", true);
    await shot("40-protected-bar");

    const featureBefore = sh(["rev-parse", "feature/login"]);
    await openRow("feature/login", "release");
    await waitFor(
      `document.body.innerText.includes('等待创建 MR')`,
      "MR 完成页",
      60000,
    );
    const mrDone = await text();
    check("完成页说明目标分支未直接推送", mrDone.includes("受保护，未直接推送"), mrDone.slice(0, 300));
    // 测试仓库的 origin 是本地裸仓库，没有可调用的托管平台接口，应降级并说明原因
    check(
      "本地远程时说明无法自动创建 MR",
      mrDone.includes("无法自动创建 MR"),
      mrDone.slice(0, 400),
    );
    const mrBranch = sh(["for-each-ref", "--format=%(refname:short)", "refs/heads/mr/*"]).trim();
    check("创建了 mr/* 集成分支", mrBranch.startsWith("mr/"), mrBranch);
    await waitFor(
      `document.body.innerText.includes('已推送') || document.body.innerText.includes('推送失败')`,
      "推送结束",
      40000,
    );
    check(
      "origin/release 没有被直接推送",
      sh(["rev-parse", "origin/release"]) === BASE,
      sh(["rev-parse", "origin/release"]),
    );
    check(
      "本地 release 也没有被动过",
      sh(["rev-parse", "release"]) === BASE,
      sh(["rev-parse", "release"]),
    );
    check(
      "mr 分支已推送到远程",
      sh(["rev-parse", "refs/remotes/origin/" + mrBranch]) ===
        sh(["rev-parse", mrBranch]) &&
        sh(["rev-parse", "refs/remotes/origin/" + mrBranch]) !== "",
      mrBranch,
    );
    check(
      "功能分支保持干净（SHA 未变）",
      sh(["rev-parse", "feature/login"]) === featureBefore,
    );
    await shot("41-mr-done");
    await clickText("关闭");
    const afterMr = await text();
    check("列表已记录发布状态", afterMr.includes("已合并"), afterMr.slice(0, 300));

    // ---- 用例 7：删除分支记录（只删台账，不删真实分支） ----
    resetRepo();
    seedData();
    await reload();

    // 行内删除单条：删除收在「更多」菜单里
    await evaluate(
      `document.querySelector('button[aria-label="更多操作 feature/cleanup"]')?.click()`,
    );
    await waitFor(`!!document.querySelector('.row-menu')`, "更多菜单展开", 10000);
    const menuText = await evaluate(
      `document.querySelector('.row-menu').innerText.replace(/\s+/g,' ')`,
    );
    check(
      "更多菜单里有编辑备注与删除记录",
      menuText.includes("编辑备注") && menuText.includes("删除记录"),
      menuText,
    );
    await shot("42-row-menu");
    await evaluate(
      `[...document.querySelectorAll('.row-menu button')].find(b=>b.textContent.includes('删除记录'))?.click()`,
    );
    await waitFor(`document.body.innerText.includes('删除分支记录？')`, "删除确认弹窗", 20000);
    const confirmText = await text();
    check(
      "确认弹窗说明不会删除仓库分支",
      confirmText.includes("仓库里的真实分支不会被删除"),
      confirmText.slice(0, 300),
    );
    await shot("42-delete-confirm");
    await evaluate(`document.querySelector('dialog[open] .danger-button')?.click()`);
    await waitFor(`!document.querySelector('dialog[open]')`, "弹窗关闭", 20000);
    const afterRowDelete = await text();
    check(
      "feature/cleanup 记录已删除",
      !afterRowDelete.includes("feature/cleanup"),
      afterRowDelete.slice(0, 300),
    );
    check(
      "feature/cleanup 真实分支仍在",
      sh(["rev-parse", "--verify", "refs/heads/feature/cleanup"]) !== "",
    );

    // 批量删除两条
    await evaluate(`document.querySelector('input[aria-label="选择 feature/login"]')?.click()`);
    await evaluate(`document.querySelector('input[aria-label="选择 feature/cart"]')?.click()`);
    await waitFor(`document.body.innerText.includes('已选择 2 个分支')`, "批量选择", 20000);
    await evaluate(`document.querySelector('.selection-bar .selection-submit.danger')?.click()`);
    await waitFor(`document.body.innerText.includes('删除分支记录？')`, "批量删除确认弹窗", 20000);
    const batchText = await text();
    check(
      "批量确认列出两条分支",
      batchText.includes("2 条分支记录") &&
        batchText.includes("feature/login") &&
        batchText.includes("feature/cart"),
      batchText.slice(0, 300),
    );
    await evaluate(`document.querySelector('dialog[open] .danger-button')?.click()`);
    await waitFor(`!document.querySelector('dialog[open]')`, "批量删除完成", 20000);
    const afterBatch = await text();
    check(
      "两条记录都已删除",
      !afterBatch.includes("feature/login") && !afterBatch.includes("feature/cart"),
      afterBatch.slice(0, 300),
    );
    check(
      "两条真实分支仍在",
      sh(["rev-parse", "--verify", "refs/heads/feature/login"]) !== "" &&
        sh(["rev-parse", "--verify", "refs/heads/feature/cart"]) !== "",
    );
    await shot("43-delete-done");

    // ---- 用例 8：无手动添加、无分组折叠、弹窗显示远程地址与 Git 身份 ----
    resetRepo();
    seedData();
    await reload();
    await waitFor(`document.querySelectorAll('.nav-item').length>0`, "应用加载", 40000);
    const home = await text();
    check(
      "没有手动添加分支的入口",
      !home.includes("手动添加") && !home.includes("手动记一条"),
      home.slice(0, 200),
    );
    check(
      "页脚说明分支来自仓库",
      home.includes("分支从本地或远程仓库挑选"),
      home.slice(-300),
    );

    const rows = await evaluate(`document.querySelectorAll('.branch-cell').length`);
    check("列表平铺显示全部分支", rows === 5, String(rows));
    const noGroup = await evaluate(`document.querySelectorAll('.group-row').length`);
    check("不再有分组折叠行", noGroup === 0, String(noGroup));
    const columns = await evaluate(
      `[...document.querySelectorAll('thead th')].map(t=>t.innerText.trim()).join(' | ')`,
    );
    check("表头改为「分支与备注」", columns.includes("分支与备注"), columns);
    const pills = await evaluate(`document.querySelectorAll('.action-pill').length`);
    check("每行两个提交胶囊（共 10 个）", pills === 10, String(pills));

    // 弹窗：远程仓库地址 + 提交身份
    await clickText("从仓库添加分支");
    await waitFor(`!!document.querySelector('.repository-meta')`, "仓库元信息", 30000);
    const meta = await evaluate(`document.querySelector('.repository-meta').innerText.replace(/\\s+/g,' ')`);
    check("弹窗显示远程地址", meta.includes("origin") && meta.includes(".git"), meta);
    const gitUser = sh(["config", "user.name"]) || "未设置";
    check("弹窗显示 Git 提交身份", meta.includes("提交身份") && meta.includes(gitUser), meta);
    await shot("45-repo-meta");
    await clickText("取消");
    await waitFor(`!document.querySelector('dialog[open]')`, "关闭添加弹窗", 20000);

    // ---- 用例 9：设置页按域名保存代码托管令牌（脱敏显示、可删除） ----
    await evaluate(
      `(()=>{const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('数据与设置'));if(!b)return false;b.click();return true})()`,
    );
    await waitFor(`!!document.querySelector('.host-form')`, "令牌设置面板", 20000);
    const tokenPanel = await evaluate(
      `([...document.querySelectorAll('.settings-panel')].find(p=>p.innerText.includes('代码托管令牌'))||{}).innerText||''`,
    );
    check(
      "设置页说明令牌只留在本机",
      tokenPanel.includes("系统钥匙串") && tokenPanel.includes("不会写进台账"),
      tokenPanel.slice(0, 300),
    );
    const FAKE_HOST = "gitlab.branchnote-test.invalid";
    const FAKE_TOKEN = "glpat-fake-token-0123456789";
    await evaluate(
      `(()=>{const i=document.querySelector('.host-form input[aria-label="平台地址"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(FAKE_HOST)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await evaluate(
      `(()=>{const i=document.querySelector('.host-form input[aria-label="访问令牌"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(FAKE_TOKEN)});i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await shot("46-token-form");
    await clickText("保存令牌");
    await waitFor(`!!document.querySelector('.host-item')`, "令牌已保存", 20000);
    const hostRow = await evaluate(
      `document.querySelector('.host-item').innerText.replace(/\\s+/g,' ')`,
    );
    check(
      "令牌按域名保存并显示脱敏提示",
      hostRow.includes(FAKE_HOST) && hostRow.includes("••••••6789"),
      hostRow,
    );
    check(
      "界面不显示令牌原文",
      !(await text()).includes(FAKE_TOKEN),
      "页面出现了令牌原文",
    );
    const HOSTS = path.join(path.dirname(DATA), "hosts.json");
    const stored = JSON.parse(fs.readFileSync(HOSTS, "utf8"));
    const savedEntry = stored.hosts.find((item) => item.host === FAKE_HOST);
    check("令牌写入本地配置文件", !!savedEntry, JSON.stringify(stored.hosts));
    check(
      "令牌不以明文落盘（系统钥匙串可用时）",
      !savedEntry || savedEntry.encrypted === false || !JSON.stringify(stored).includes(FAKE_TOKEN),
      "hosts.json 里出现了明文令牌",
    );
    await shot("47-token-saved");
    // 删除要二次确认，确认后行消失、配置文件同步清掉
    await evaluate(`document.querySelector('.host-item .icon-button').click()`);
    await clickText("确认删除");
    await waitFor(`!document.querySelector('.host-item')`, "令牌已删除", 20000);
    const afterToken = JSON.parse(fs.readFileSync(HOSTS, "utf8"));
    check(
      "删除后配置文件里不再有该域名",
      !afterToken.hosts.some((item) => item.host === FAKE_HOST),
      JSON.stringify(afterToken.hosts),
    );

    // 收尾：清掉测试产生的 mr 分支，复位数据，给用户留一个干净基线
    resetRepo();
    for (const name of sh(["for-each-ref", "--format=%(refname:short)", "refs/heads/mr/*"])
      .split(/\r?\n/)
      .filter(Boolean))
      sh(["branch", "-D", name]);
    if (mrBranch) sh(["push", "origin", "--delete", mrBranch]);
    for (const name of sh(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin/mr/*"])
      .split(/\r?\n/)
      .map((name) => name.replace(/^origin\//, ""))
      .filter(Boolean))
      sh(["push", "origin", "--delete", name]);
    sh(["fetch", "origin", "--prune"]);
    seedData();
  } finally {
    await sleep(300);
    finish();
  }

  const passed = results.filter((item) => item.ok).length;
  console.log(`\n完成：${passed}/${results.length} 通过`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("崩溃：", error.message);
  process.exitCode = 1;
});
