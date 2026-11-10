const { join } = require("node:path");
const { MacUpdateDownload, newerMacVersion } = require("../dist-electron/mac-update.cjs");
const { macInstallTarget, prepareMacInstall } = require("../dist-electron/mac-install.cjs");

function initializeUpdater({ app, BrowserWindow, ipcMain, shell, autoUpdater, canInstall, fetchUpdate }) {
  const isMac = process.platform === "darwin";
  const supported = app.isPackaged && (isMac || (process.platform === "win32" && !process.env.PORTABLE_EXECUTABLE_FILE));
  let state = { currentVersion: app.getVersion(), status: supported ? "idle" : "manual", installMode: isMac ? "dmg" : "restart" };
  let busy = false;
  const publish = (patch) => {
    state = { ...state, ...patch };
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send("update:state", state);
  };
  const fail = () => publish({ status: "error", error: "更新失败，请检查网络或前往下载页面" });
  const macDownload = supported && isMac
    ? new MacUpdateDownload(join(app.getPath("userData"), "mac-update"), process.arch, app.getVersion(), fetchUpdate,
      (percent) => publish({ status: "downloading", percent }))
    : undefined;
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on("checking-for-update", () => publish({ status: "checking", error: undefined, percent: undefined, version: undefined }));
  autoUpdater.on("update-available", (info) => publish({ status: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("update-not-available", () => publish({ status: "latest", version: undefined }));
  autoUpdater.on("download-progress", (info) => publish({ status: "downloading", percent: Math.max(0, Math.min(100, info.percent)) }));
  autoUpdater.on("update-downloaded", (info) => publish({ status: "downloaded", version: info.version, percent: 100, error: undefined }));
  autoUpdater.on("error", fail);
  const restored = macDownload
    ? macDownload.restore().then(version => {
      if (version) publish({ status: "downloaded", version, percent: 100 });
    })
    : Promise.resolve();
  const check = async () => {
    await restored;
    if (!supported || busy || ["downloading", "downloaded", "installing"].includes(state.status)) return;
    busy = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable && macDownload && newerMacVersion(result.updateInfo.version, app.getVersion())) {
        const version = await macDownload.download(result.updateInfo);
        publish({ status: "downloaded", version, percent: 100 });
      } else await result?.downloadPromise;
    } catch {
      fail();
    } finally {
      busy = false;
    }
  };
  ipcMain.handle("update:get", async () => {
    await restored;
    return state;
  });
  ipcMain.handle("update:action", async (event, action) => {
    if (!event.senderFrame?.url.startsWith("file:")) throw new Error("无效的更新请求");
    if (action === "manual") {
      await shell.openExternal("https://github.com/FluentHaze/BranchNote/releases/latest");
    } else if (action === "check") {
      await check();
    } else if (action === "install") {
      await restored;
      if (!supported || busy || state.status !== "downloaded") return;
      if (!canInstall()) throw new Error("正在执行 Git 操作，请完成后再重启更新");
      busy = true;
      publish({ status: "installing" });
      try {
        if (macDownload) {
          const prepared = await prepareMacInstall({
            dmg: await macDownload.installerPath(),
            destination: macInstallTarget(app.getPath("exe")),
            version: state.version,
            arch: process.arch,
            temp: app.getPath("temp"),
            failureTitle: "更新安装失败",
            failureMessage: "自动安装未完成。请重试或从下载页面手动安装。",
          });
          try {
            await prepared.start(process.pid);
          } catch (error) {
            await prepared.dispose();
            throw error;
          }
          app.quit();
        } else autoUpdater.quitAndInstall(true, true);
      } catch {
        busy = false;
        fail();
      }
    }
  });
  if (supported) {
    const startup = setTimeout(() => void check(), 15_000);
    const interval = setInterval(() => void check(), 6 * 60 * 60_000);
    startup.unref();
    interval.unref();
    app.once("before-quit", () => {
      clearTimeout(startup);
      clearInterval(interval);
      macDownload?.cancel();
    });
  }
}

module.exports = { initializeUpdater };
