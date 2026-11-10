const { app } = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

(async () => {
  if (process.argv[2] !== "--run") {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), "branchnote-update-ui-"));
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
  app.setVersion(require("../package.json").version);
  const timeout = setTimeout(() => { console.error("更新界面验证超时"); app.exit(1); }, 30_000);
  app.on("browser-window-created", (_, win) => {
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once("did-finish-load", async () => {
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            const panel = document.querySelector('.app-update');
            if (panel && panel.textContent.includes('下载最新版')) {
              return { text: panel.textContent, state: await window.branchNote.getUpdate() };
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          throw new Error('未显示版本更新卡片');
        })()`);
        assert.equal(result.state.status, "manual");
        assert.match(result.text, /版本更新/);
        assert.equal(result.state.currentVersion, require("../package.json").version);
        const { autoUpdater } = require("electron-updater");
        autoUpdater.emit("update-available", { version: "0.3.0" });
        autoUpdater.emit("download-progress", { percent: 42 });
        const downloading = await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            const progress = document.querySelector('.app-update progress');
            if (progress?.value === 42 && document.querySelector('.update-notice')) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return false;
        })()`);
        assert.equal(downloading, true);
        autoUpdater.emit("update-downloaded", { version: "0.3.0" });
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 100; i++) {
            const panel = document.querySelector('.app-update');
            if (panel?.textContent.includes('重启并安装')) {
              panel.scrollIntoView({ block: 'center' });
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('未显示重启并安装');
        })()`);
        await fs.mkdir(path.join(__dirname, "../release/update-check"), { recursive: true });
        const screenshot = await win.webContents.capturePage();
        await fs.writeFile(path.join(__dirname, "../release/update-check/settings.png"), screenshot.toPNG());
        console.log("PASS: 真实 Electron IPC、手动更新入口、下载进度、侧栏提示和重启安装按钮");
        clearTimeout(timeout);
        win.destroy();
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  require("../electron/main.cjs");
})().catch(error => { console.error(error); app.exit(1); });
