// 真实 BranchNote 桌面应用 UI 全场景测试（Electron + CDP）
// 每个场景都通过软件界面操作，并在磁盘 / 数据文件上核对真实结果。
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const APP = "C:/Users/FF/Desktop/github/BranchNote";
const WORK = "C:/Users/FF/Desktop/github/TestBranchNote";
const ORIGIN = "C:/Users/FF/Desktop/github/TestBranchNote-bare.git";
const DATA = path.join(process.env.APPDATA, "branchnote/branchnote.json");
const SHOTS = path.join(APP, "docs/e2e");
const PORT = 9333;

const sh = (args) => {
  try {
    const out = execFileSync("git", ["-C", WORK, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    return typeof out === "string" ? out.trim() : "";
  } catch {
    return "";
  }
};
const read = (file) => fs.readFileSync(path.join(WORK, file), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildStore() {
  const project = {
    id: "e2e-project-0001",
    name: "测试仓库",
    note: "TestBranchNote 全流程验证",
    color: "#007aff",
    archived: false,
    repositoryPath: WORK,
    testTarget: "",
    releaseTarget: "origin/main",
  };
  const branch = (id, name, description, merged) => ({
    id,
    projectId: project.id,
    name,
    description,
    note: "",
    testMergedAt: null,
    releaseMergedAt: merged ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return {
    version: 3,
    projects: [project],
    branches: [
      branch("e2e-b1", "feature/login", "登录页与验证码", false),
      branch("e2e-b2", "feature/report", "报表页改造", false),
      branch("e2e-b3", "feature/cart", "购物车第二阶段", true),
      branch("e2e-b4", "feature/cleanup", "清理旧文件", true),
    ],
  };
}

function baseline() {
  return execFileSync("git", ["-C", ORIGIN, "rev-parse", "refs/bn-baseline/main"], {
    encoding: "utf8",
  }).trim();
}

function resetRepo() {
  const base = baseline();
  sh(["merge", "--abort"]);
  sh(["reset", "--hard"]);
  sh(["clean", "-fd"]);
  sh(["switch", "-f", "--", "main"]);
  sh(["reset", "--hard", base]);
  const local = sh(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const name of local)
    // demo/* 是手工演示分支，自动化跑完也要保留
    if (name !== "main" && !name.startsWith("feature/") && !name.startsWith("demo/"))
      sh(["branch", "-D", "--", name]);
  sh(["push", "--force", ORIGIN, "refs/heads/main:refs/heads/main"]);
  sh(["fetch", "origin", "--prune"]);
  sh(["reset", "--hard", base]);
  fs.rmSync(path.join(WORK, ".git", "branchnote-merge.json"), { force: true });
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
  for (let i = 0; i < 100; i++) {
    try {
      const list = JSON.parse(await request(`http://127.0.0.1:${PORT}/json/list`));
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
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
      payload.error ? reject(new Error(payload.error.message)) : resolve(payload.result);
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

async function main() {
  // 保护：脚本会重建旧夹具并覆盖应用数据，演示仓库下必须显式确认
  if (!fs.existsSync(path.join(WORK, "base.txt")) && !process.env.BN_FORCE_FIXTURE) {
    console.error(
      "检测到 TestBranchNote 已经是手工演示仓库（没有 base.txt），为避免覆盖，已停止。\n需要重建旧夹具时用 BN_FORCE_FIXTURE=1 运行。",
    );
    process.exit(1);
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  const backup = path.join(path.dirname(DATA), "branchnote.e2e-backup.json");
  if (fs.existsSync(DATA) && !fs.existsSync(backup)) fs.copyFileSync(DATA, backup);

  const electron = path.join(APP, "node_modules/electron/dist/electron.exe");
  const env = { ...process.env };
  // 当前 shell 里 ELECTRON_RUN_AS_NODE=1，会让 Electron 退化成 Node，必须去掉
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
    const waitFor = async (expression, label, timeout = 25000) => {
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
    const resetAll = async () => {
      resetRepo();
      fs.writeFileSync(DATA, JSON.stringify(buildStore(), null, 2), "utf8");
      await send("Page.reload");
      await waitFor("document.querySelectorAll('.nav-item').length>0", "应用重新加载", 30000);
      await evaluate(
        `(()=>{const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.includes('测试仓库'));b&&b.click();return !!b})()`,
      );
      await waitFor("!!document.querySelector('table')", "分支表格");
    };
    // 一键提交：勾选分支后点「提交所选分支」，记住过目标就直接开跑
    const openSubmit = async (names, shotName) => {
      for (const name of names)
        await evaluate(
          `(()=>{const i=document.querySelector('input[aria-label="选择 ${name}"]');if(!i)return false;i.click();return true})()`,
        );
      await clickText("提交所选分支");
      if (shotName) {
        await sleep(400);
        await shot(shotName);
      }
      await waitFor(
        `document.body.innerText.includes('合并遇到冲突') || document.body.innerText.includes('已合入发布分支') || document.body.innerText.includes('合并已停止')`,
        "自动开始合并",
        40000,
      );
      await sleep(600);
    };
    // 冲突文件：点一下「两边都要」即解决并自动进入下一个文件/分支
    const resolveUnion = async (file) => {
      const clicked = await evaluate(
        `(()=>{const b=[...document.querySelectorAll('.resolve-file')].find(x=>x.textContent.includes(${JSON.stringify(file)}));if(!b)return false;b.click();return true})()`,
      );
      if (!clicked) throw new Error(`冲突列表里没有 ${file}`);
      await clickText("两边都要");
      await sleep(1100);
      return read(file);
    };
    const only = process.argv[2] || "";
    const case_ = async (name, fn) => {
      if (only && !name.includes(only)) return;
      const started = Date.now();
      try {
        await resetAll();
        await fn();
        results.push({ name, ok: true });
        console.log(`  PASS  ${name} (${Date.now() - started}ms)`);
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
        console.error(`  FAIL  ${name}\n        ${error.message.split("\n")[0]}`);
        try {
          fs.writeFileSync(
            path.join(SHOTS, "failure.png"),
            Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"),
          );
        } catch {}
      }
    };

    // 1. 冲突 → 两边都要 → 自动继续下一个分支 → 收尾并推送
    await case_("U01 冲突全链路：两边都要 + 多分支接力 + 推送", async () => {
      const before = await text();
      if (!before.includes("feature/login") || !/登录/.test(before))
        throw new Error("列表或标签没有渲染");
      await shot("01-branch-table");
      await openSubmit(["feature/login", "feature/report"], "02-submit-dialog");
      await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 30000);
      await sleep(600);
      await shot("03-conflict");
      // 点一次「两边都要」后应自动继续到第二个分支的冲突
      await resolveUnion("base.txt");
      await waitFor(
        `document.body.innerText.includes('shared.txt') && document.body.innerText.includes('合并遇到冲突')`,
        "第二轮冲突",
        40000,
      );
      await sleep(700);
      await shot("04-conflict-round2");
      await resolveUnion("base.txt");
      await waitFor(
        `(()=>{const t=document.body.innerText;return t.includes('shared.txt')&&!!document.querySelector('.resolve-file.active')})()`,
        "自动跳到 shared.txt",
        20000,
      );
      const sharedText = await resolveUnion("shared.txt");
      await shot("05-union-shared");
      await waitFor(`document.body.innerText.includes('已合入发布分支')`, "合并完成", 40000);
      await waitFor(
        `document.body.innerText.includes('已推送') || document.body.innerText.includes('还没有这次合并的提交')`,
        "推送结果",
        30000,
      );
      await shot("07-done");
      const base = read("base.txt");
      if (!base.includes("lineB 主干改造") || !base.includes("lineB 报表改造"))
        throw new Error(`base.txt 不对：${JSON.stringify(base)}`);
      if (!sharedText.includes("main 新增") || !sharedText.includes("report 独有内容"))
        throw new Error(`shared.txt 不对：${JSON.stringify(sharedText)}`);
      if (!read("login.txt").includes("登录页 UI")) throw new Error("login.txt 未合入");
      if (sh(["for-each-ref", "refs/heads/"]).includes("resolve/"))
        throw new Error("临时 resolve 分支未清理");
      const remote = sh(["ls-remote", ORIGIN, "refs/heads/main"]).split("\t")[0];
      if (remote !== sh(["rev-parse", "main"])) throw new Error("远程 main 未同步");
      await clickText("关闭");
      await sleep(1000);
      await shot("08-table-after");
      const saved = JSON.parse(fs.readFileSync(DATA, "utf8"));
      for (const name of ["feature/login", "feature/report"]) {
        const item = saved.branches.find((b) => b.name === name);
        if (!item.releaseMergedAt) throw new Error(`${name} 状态未写回`);
      }
    });

    // 2. 无冲突合并：直接成功 + 推送
    await case_("U02 无冲突合并：干净合入并推送", async () => {
      await openSubmit(["feature/cart"]);
      await waitFor(`document.body.innerText.includes('已合入发布分支')`, "合并完成", 30000);
      await sleep(1500);
      await shot("09-clean-merge");
      if (read("cart.txt") !== "购物车 v2\n") throw new Error("cart.txt 未合入");
      if (!read("base.txt").includes("lineD 购物车")) throw new Error("base.txt 未追加 lineD");
      const remote = sh(["ls-remote", ORIGIN, "refs/heads/main"]).split("\t")[0];
      if (remote !== sh(["rev-parse", "main"])) throw new Error("远程 main 未同步");
    });

    // 3. 冲突采用我方
    await case_("U03 冲突采用我方：保留主干版本", async () => {
      await openSubmit(["feature/login"]);
      await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 30000);
      await waitFor(
        `(()=>{const t=document.querySelector('textarea.resolve-text');const b=[...document.querySelectorAll('.resolve-toolbar button')].find(x=>x.textContent.includes('采用我方'));return !!t&&t.value.length>0&&!!b&&!b.disabled})()`,
        "冲突内容就绪",
      );
      await clickText("采用我方");
      await waitFor(`document.body.innerText.includes('已合入发布分支')`, "合并完成", 30000);
      const base = read("base.txt");
      if (!base.includes("lineB 主干改造") || base.includes("lineB 登录改造"))
        throw new Error(`采用我方结果不对：${JSON.stringify(base)}`);
    });

    // 4. 冲突采用对方
    await case_("U04 冲突采用对方：整份换成被合入版本", async () => {
      await openSubmit(["feature/login"]);
      await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 30000);
      await waitFor(
        `(()=>{const t=document.querySelector('textarea.resolve-text');const b=[...document.querySelectorAll('.resolve-toolbar button')].find(x=>x.textContent.includes('采用对方'));return !!t&&t.value.length>0&&!!b&&!b.disabled})()`,
        "冲突内容就绪",
      );
      await clickText("采用对方");
      await waitFor(`document.body.innerText.includes('已合入发布分支')`, "合并完成", 30000);
      if (!read("base.txt").includes("lineB 登录改造"))
        throw new Error(`采用对方结果不对：${JSON.stringify(read("base.txt"))}`);
    });

    // 5. 冲突手动编辑
    await case_("U05 冲突手动编辑：自定义内容保存后生效", async () => {
      await openSubmit(["feature/login"]);
      await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 30000);
      await sleep(600);
      const custom = "lineA\nlineB 手工融合版\nlineC\n";
      await evaluate(
        `(()=>{const t=document.querySelector('textarea.resolve-text');const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(t,${JSON.stringify(
          custom,
        )});t.dispatchEvent(new Event('input',{bubbles:true}));return t.value})()`,
      );
      await sleep(400);
      await shot("10-manual-edit");
      await clickText("保存并标记已解决");
      await waitFor(`document.body.innerText.includes('已合入发布分支')`, "合并完成", 30000);
      if (read("base.txt") !== custom)
        throw new Error(`手动内容未生效：${JSON.stringify(read("base.txt"))}`);
    });

    // 6. 放弃本次合并
    await case_("U06 放弃合并：恢复原分支并清理临时分支", async () => {
      await openSubmit(["feature/login"]);
      await waitFor(`document.body.innerText.includes('合并遇到冲突')`, "冲突界面", 30000);
      await sleep(600);
      await clickText("放弃本次合并");
      await clickText("确认放弃本次合并");
      await waitFor(`document.body.innerText.includes('已放弃本次合并')`, "放弃提示", 20000);
      await shot("11-aborted");
      if (sh(["branch", "--show-current"]) !== "main") throw new Error("没有回到 main");
      if (sh(["status", "--porcelain"])) throw new Error("工作区不干净");
      if (sh(["for-each-ref", "refs/heads/"]).includes("resolve/"))
        throw new Error("resolve 分支未删除");
      if (sh(["rev-parse", "main"]) !== baseline()) throw new Error("main 被改动");
    });

    // 7. 展开高级选项即暂停自动合并，可在里面更新远程分支
    await case_("U07 高级选项：展开后先更新远程，再取消合并", async () => {
      await evaluate(
        `(()=>{const i=document.querySelector('input[aria-label="选择 feature/cart"]');if(!i)return false;i.click();return true})()`,
      );
      await clickText("提交所选分支");
      await waitFor(`!!document.querySelector('.advanced-options')`, "一键提交面板", 30000);
      const opened = await evaluate(
        `(()=>{const s=document.querySelector('.advanced-options>summary');if(!s)return false;s.click();return true})()`,
      );
      if (!opened) throw new Error("没有高级选项折叠区");
      await sleep(300);
      await evaluate(
        `(()=>{const b=document.querySelector('button[aria-label="更新远程分支"]');if(!b)return false;b.click();return true})()`,
      );
      await waitFor(`document.body.innerText.includes('更新完成')`, "更新提示", 40000);
      await sleep(1500);
      // 展开高级选项后不应再自动开始合并
      const merging = await evaluate(
        `document.body.innerText.includes('合并遇到冲突') || document.body.innerText.includes('已合入发布分支')`,
      );
      if (merging) throw new Error("展开高级选项后仍然自动合并了");
      await shot("06-advanced-options");
      await clickText("取消");
    });

    // 8. 分支选择器：给分支加标签并添加为功能分支
    await case_("U08 从仓库添加分支：release-1 加入列表", async () => {
      await clickText("从仓库添加分支");
      await waitFor(`document.body.innerText.includes('从仓库添加功能分支')`, "选择器");
      await sleep(800);
      // 分支标签已移除，弹窗里不应再有标签入口
      const hasLabel = await evaluate(
        `!!document.querySelector('button[aria-label="给 release-1 设置标签"]')`,
      );
      if (hasLabel) throw new Error("分支标签入口应已移除");
      await evaluate(`document.querySelector('input[aria-label="选择分支 release-1"]').click()`);
      await sleep(300);
      await clickText("添加为功能分支");
      await waitFor(`document.body.innerText.includes('release-1')`, "列表新增分支", 20000);
      const saved = JSON.parse(fs.readFileSync(DATA, "utf8"));
      if (!saved.branches.some((b) => b.name === "release-1"))
        throw new Error("release-1 没有添加为功能分支");
      if (saved.projects[0].branchLabels)
        throw new Error("旧的分支标签不应再写入数据文件");
      await shot("13-list-with-new-branch");
    });

    // 9. 列表里点击状态列切换
    await case_("U09 状态列点击切换：发布状态可回退", async () => {
      const clicked = await evaluate(
        `(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('feature/cart'));if(!row)return 'no-row';const b=[...row.querySelectorAll('button')].find(x=>x.textContent.includes('已合并'));if(!b)return 'no-button';b.click();return 'ok'})()`,
      );
      if (clicked !== "ok") throw new Error(`点击状态失败：${clicked}`);
      await sleep(1000);
      const saved = JSON.parse(fs.readFileSync(DATA, "utf8"));
      const cart = saved.branches.find((b) => b.name === "feature/cart");
      if (cart.releaseMergedAt !== null) throw new Error("点击状态没有重置发布状态");
      await shot("14-status-toggle");
    });

    close();
    finish();
    const failed = results.filter((item) => !item.ok);
    console.log(
      `\n== UI 场景：${results.length} 个，${results.length - failed.length} 通过，${failed.length} 失败 ==`,
    );
    if (failed.length) {
      for (const item of failed) console.error(`  ✗ ${item.name}: ${item.error}`);
      process.exitCode = 1;
    }
  } catch (error) {
    finish();
    console.error("UI E2E 崩溃：", error.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("UI E2E 崩溃：", error);
  process.exitCode = 1;
});
