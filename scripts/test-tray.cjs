const electron = require("electron");
const { app, BrowserWindow } = electron;
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Module = require("node:module");

// Run against a separate profile and the real Electron window / tray lifecycle.
(async () => {
  if (process.argv[2] === "--second") {
    app.setPath("userData", process.argv[3]);
    require("../electron/main.cjs");
    return;
  }
  if (process.argv[2] !== "--run") {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "branchnote-tray-"));
    await fs.writeFile(path.join(profile, "branchnote.json"), JSON.stringify({
      version: 3, projects: [{ id: "tray-project", name: "托盘测试项目", note: "", color: "#4263dc", archived: false, targets: [] }], branches: [],
    }));
    const child = spawn(process.execPath, [__filename, "--run", profile], {
      stdio: "inherit", windowsHide: true,
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 1));
    });
    await fs.rm(profile, { recursive: true, force: true });
    app.exit(code);
    return;
  }
  const profile = process.argv[3];
  app.setPath("userData", profile);
  let tray;
  let menu;
  const NativeTray = electron.Tray;
  class TestTray extends NativeTray {
    constructor(...args) {
      super(...args);
      tray = this;
    }
  }
  const timeout = setTimeout(() => { console.error("Tray test timed out"); app.exit(1); }, 30_000);
  const waitFor = async (condition) => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Tray lifecycle condition timed out");
  };
  app.on("browser-window-created", (_, win) => {
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once("did-finish-load", async () => {
      if (win.webContents.getURL().endsWith("/tray.html")) return;
      try {
        assert.ok(tray && !tray.isDestroyed());
        const item = label => menu.items.find(entry => entry.label === label);
        assert.deepEqual(menu.items.filter(item => item.type !== "separator").map(item => item.label),
          ["刷新当前项目 MR", "打开 BranchNote", "打开设置", "隐藏窗口", "退出 BranchNote"]);
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            if (document.querySelector('.page-heading h1')?.textContent === '托盘测试项目') return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('应用尚未加载完成');
        })()`);
        item("刷新当前项目 MR").click();
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            if (document.body.textContent.includes('暂无需要同步的 MR')) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('未执行当前项目 MR 刷新');
        })()`);
        item("打开设置").click();
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            if (document.querySelector('.app-update')) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('未打开设置');
        })()`);
        item("刷新当前项目 MR").click();
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            if (document.body.textContent.includes('请先选择需要刷新的项目')) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('未收到托盘刷新操作');
        })()`);
        item("隐藏窗口").click();
        assert.equal(win.isVisible(), false);
        item("打开设置").click();
        await waitFor(() => win.isVisible());
        win.close();
        assert.equal(win.isDestroyed(), false);
        assert.equal(win.isVisible(), false);
        tray.emit("click");
        await waitFor(() => win.isVisible());
        win.minimize();
        await waitFor(() => win.isMinimized());
        item("打开 BranchNote").click();
        await waitFor(() => !win.isMinimized() && win.isVisible());
        win.close();
        app.emit("activate");
        assert.equal(win.isVisible(), true);
        win.close();
        const second = spawn(process.execPath, [__filename, "--second", profile], {
          stdio: "ignore", windowsHide: true,
        });
        await new Promise((resolve, reject) => {
          second.once("error", reject);
          second.once("exit", code => code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`)));
        });
        await waitFor(() => win.isVisible());
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        if (process.platform === "win32") {
          tray.emit("right-click");
          await waitFor(() => BrowserWindow.getAllWindows().some(entry => entry !== win && entry.isVisible()));
          const popup = BrowserWindow.getAllWindows().find(entry => entry !== win);
          const alignment = await popup.webContents.executeJavaScript("getComputedStyle(document.querySelector('button')).textAlign");
          assert.equal(alignment, "left");
          const appearance = await popup.webContents.executeJavaScript(`(() => {
            const button = document.querySelector('[data-action=quit]');
            button.focus();
            return { background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color,
              radius: getComputedStyle(document.querySelector('nav')).borderRadius,
              canvas: getComputedStyle(document.body).backgroundColor,
              inset: document.querySelector('nav').getBoundingClientRect().left,
              pin: !!document.querySelector('[data-action=pin]') };
          })()`);
          assert.deepEqual(appearance, { background: "rgb(66, 99, 220)", color: "rgb(255, 255, 255)", radius: "12px", canvas: "rgba(0, 0, 0, 0)", inset: 8, pin: false });
          await popup.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
          await fs.writeFile(path.join(__dirname, "../release/tray-menu.png"), (await popup.webContents.capturePage()).toPNG());
          await popup.webContents.executeJavaScript("document.querySelector('[data-action=hide]').click()");
          await waitFor(() => popup.isDestroyed());
          assert.equal(win.isVisible(), false);
          tray.emit("click");
          await waitFor(() => win.isVisible());
        }
        let closed = false;
        win.once("closed", () => { closed = true; });
        app.once("will-quit", () => {
          assert.equal(closed, true, "explicit quit must close the window rather than hide it");
          assert.equal(tray.isDestroyed(), true);
          clearTimeout(timeout);
          console.log("PASS: tray actions, left alignment, brand blue highlight, rounded corners, close-to-hide, restore, single-instance and explicit quit");
        });
        // before-quit is also used by both platform update installers.
        item("退出 BranchNote").click();
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  const load = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "electron" && parent.filename === path.join(__dirname, "../electron/main.cjs"))
      return { ...electron, Tray: TestTray, Menu: {
        buildFromTemplate(template) {
          menu = electron.Menu.buildFromTemplate(template);
          return menu;
        },
      } };
    return load.call(this, request, parent, isMain);
  };
  try {
    require("../electron/main.cjs");
  } finally {
    Module._load = load;
  }
})().catch(error => { console.error(error); app.exit(1); });
