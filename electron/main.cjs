const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Tray, Menu, nativeImage, screen } = require("electron");
const path = require("node:path");
const { initializeUpdater } = require("./updater.cjs");
const { autoUpdater } = require("electron-updater");
const { fetchUpdate } = require("../dist-electron/update-fetch.cjs");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const runApplication = promisify(execFile);
const {
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
} = require("./git.cjs");
const {
  listHosts,
  saveHost,
  removeHost,
  testHost,
  createMergeRequest,
  syncMergeRequests,
} = require("./hosts.cjs");

let window;
let tray;
let trayMenuWindow;
let quitting = false;
let mergePlan;
let merging = false;
const dataPath = () => path.join(app.getPath("userData"), "branchnote.json");

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

if (primaryInstance) app.whenReady().then(() => {
  initializeUpdater({ app, BrowserWindow, ipcMain, shell, autoUpdater, fetchUpdate, canInstall: () => !merging });
  // 页面目前使用浅色主题，原生标题栏和系统对话框与其保持一致。
  nativeTheme.themeSource = "light";
  ipcMain.handle("repository:pick", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "选择本地 Git 仓库",
      properties: ["openDirectory"],
    });
    return result.canceled ? null : readRepository(result.filePaths[0]);
  });
  ipcMain.handle("repository:read", (_, directory) =>
    readRepository(directory),
  );
  ipcMain.handle("repository:fetch", (_, directory) =>
    fetchRepository(directory),
  );
  ipcMain.handle(
    "repository:prepare-merge",
    async (_, { directory, target, sources, resolveBranch, options }) => {
      if (merging) throw new Error("正在合并，请等待当前操作结束");
      mergePlan = await prepareMerge(
        directory,
        target,
        sources,
        resolveBranch,
        options || {},
      );
      return mergePlan;
    },
  );
  ipcMain.handle("repository:check-merge", async (_, planId) => {
    if (merging || !mergePlan || mergePlan.id !== planId)
      throw new Error("检查清单已失效，请重新检查");
    const plan = mergePlan;
    merging = true;
    try {
      const result = await checkMerge(plan);
      plan.preflight = result;
      return result;
    } finally {
      merging = false;
    }
  });
  ipcMain.handle("repository:execute-merge", async (_, planId, confirmed = false) => {
    if (merging || !mergePlan || mergePlan.id !== planId)
      throw new Error("合并清单已失效，请重新预览");
    const plan = mergePlan;
    if (!plan.preflight) throw new Error("请先检查冲突");
    if (plan.preflight.status === "conflict" && confirmed !== true)
      throw new Error("发现冲突，请确认后再创建 resolve 分支");
    mergePlan = null;
    merging = true;
    try {
      return await executeMerge(plan, {
        resolveConflicts: plan.preflight.status === "conflict",
        directSource: plan.preflight.status === "clean" && plan.sources.length === 1,
        integrateFirst: true,
      });
    } finally {
      merging = false;
    }
  });
  ipcMain.handle("repository:push", async (_, { directory, branch, remote, checkedSource }) => {
    if (merging) throw new Error("正在合并，请等待当前操作结束");
    return pushBranch(directory, branch, remote, checkedSource);
  });
  // 冲突解决：这些操作本身就在合并中间态里进行，不受 merging 锁限制
  ipcMain.handle("repository:merge-state", (_, directory) =>
    readMergeState(directory),
  );
  ipcMain.handle("repository:conflict-read", (_, { directory, file }) =>
    readConflictFile(directory, file),
  );
  // 选择应用打开冲突文件，便于直接用编辑器解决冲突
  ipcMain.handle("repository:conflict-open", async (_, { directory, file }) => {
    const target = await workingFile(directory, file);
    if (process.platform === "win32") {
      // 显式弹出“打开方式”，避免 .ts 等扩展名被关联到播放器。
      await runApplication("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", target.absolute], {
        windowsHide: true,
      });
    } else {
      const failure = await shell.openPath(target.absolute);
      if (failure) throw new Error("无法打开编辑器：" + failure);
    }
    return { file: target.file, path: target.absolute };
  });
  ipcMain.handle("repository:conflict-read-file", (_, { directory, file }) =>
    readWorkingFile(directory, file),
  );
  ipcMain.handle(
    "repository:conflict-resolve",
    (_, { directory, file, content }) =>
      resolveConflictFile(directory, file, content),
  );
  ipcMain.handle("repository:conflict-side", (_, { directory, file, side }) =>
    takeConflictSide(directory, file, side),
  );
  ipcMain.handle("repository:conflict-union", (_, { directory, file }) =>
    unionConflictFile(directory, file),
  );
  ipcMain.handle("repository:conflict-commit", (_, { directory, message }) =>
    commitResolution(directory, message),
  );
  ipcMain.handle("repository:conflict-abort", (_, { directory, returnTo }) =>
    abortMerge(directory, returnTo),
  );
  // 受保护目标分支：生成预填好的 MR / PR 创建页链接（GitLab / GitHub）
  // 自建 GitLab 的域名不一定含 gitlab，能匹配到设置里的域名就用它声明的平台类型
  ipcMain.handle("repository:mr-url", async (_, { directory, source, target, remote }) => {
    let provider = "";
    try {
      const hosts = await listHosts();
      const info = await remoteInfo(directory, {
        remote,
        hosts: hosts.map((item) => item.host),
      });
      if (info) {
        const saved = hosts.find((item) => item.host === info.host.toLowerCase());
        if (saved) provider = saved.provider;
      }
    } catch {
      // 拿不到仓库或令牌配置时退回按域名猜测
    }
    return mergeRequestUrl(directory, source, target, provider, remote);
  });
  // 在系统浏览器里打开（用于 MR 创建页 / 已创建的 MR）
  ipcMain.handle("repository:open-url", (_, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
      throw new Error("链接格式不正确");
    return shell.openExternal(url);
  });
  // 用访问令牌调接口直接创建 MR / PR；失败时返回原因，由界面给兜底链接
  ipcMain.handle(
    "repository:create-mr",
    (_, { directory, source, target, title, description, remote }) =>
      createMergeRequest({ directory, source, target, title, description, remote }),
  );
  ipcMain.handle("repository:sync-mrs", (_, urls) => syncMergeRequests(urls));
  // 令牌管理：只把域名与掩码返回给界面，令牌原文不出主进程
  ipcMain.handle("hosts:list", () => listHosts());
  ipcMain.handle("hosts:save", (_, payload) => saveHost(payload || {}));
  ipcMain.handle("hosts:remove", (_, host) => removeHost(host));
  ipcMain.handle("hosts:test", (_, payload) => testHost(payload || {}));
  ipcMain.handle(
    "repository:continue-merge",
    async (_, { directory, branch, sources }) => {
      if (merging) throw new Error("正在合并，请等待当前操作结束");
      merging = true;
      try {
        return await continueMerge(directory, branch, sources);
      } finally {
        merging = false;
      }
    },
  );
  ipcMain.handle(
    "repository:finalize-merge",
    async (_, { directory, targetLocal, from }) => {
      if (merging) throw new Error("正在合并，请等待当前操作结束");
      merging = true;
      try {
        return await finalizeMerge(directory, targetLocal, from);
      } finally {
        merging = false;
      }
    },
  );
  ipcMain.handle("data:read", async () => {
    try {
      return await fs.readFile(dataPath(), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  });
  ipcMain.handle("data:write", async (_, content) => {
    if (typeof content !== "string") throw new Error("数据格式错误");
    const temporary = `${dataPath()}.tmp`;
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, dataPath());
  });
  ipcMain.handle("data:backup", async (_, content) => {
    if (typeof content !== "string") throw new Error("数据格式错误");
    const destination = path.join(
      app.getPath("userData"),
      `before-restore-${Date.now()}.json`,
    );
    await fs.writeFile(destination, content, "utf8");
  });
  ipcMain.handle("file:export", async (_, { content, name }) => {
    const result = await dialog.showSaveDialog(window, {
      defaultPath: name,
      filters: [{ name: "JSON 备份", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, content, "utf8");
    return true;
  });
  function createWindow() {
    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 880,
      minHeight: 650,
      title: "BranchNote",
      icon: path.join(__dirname, "../dist/icon.png"),
      backgroundColor: "#f3f6f7",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.setZoomFactor(1);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (!quitting && tray && !tray.isDestroyed()) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on("closed", () => { window = null; });
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  function showWindow() {
    if (!window || window.isDestroyed()) createWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  function trayAction(action) {
    showWindow();
    window.webContents.send("tray:action", action);
  }
  const trayIcon = path.join(__dirname, "../dist", process.platform === "win32" ? "icon.ico" : "icon.png");
  tray = new Tray(process.platform === "win32"
    ? trayIcon
    : nativeImage.createFromPath(trayIcon).resize({ width: 16, height: 16 }));
  tray.setToolTip("BranchNote");
  const trayMenu = Menu.buildFromTemplate([
    { label: "刷新当前项目 MR", click: () => trayAction("refresh") },
    { label: "打开 BranchNote", click: showWindow },
    { label: "打开设置", click: () => trayAction("settings") },
    { type: "separator" },
    { label: "隐藏窗口", click: () => window?.hide() },
    { type: "separator" },
    { label: "退出 BranchNote", click: () => app.quit() },
  ]);
  if (process.platform === "win32") {
    ipcMain.handle("tray-menu:action", (event, action) => {
      if (event.sender !== trayMenuWindow?.webContents) throw new Error("无效的托盘请求");
      trayMenuWindow.close();
      if (action === "refresh" || action === "settings") trayAction(action);
      else if (action === "open") showWindow();
      else if (action === "hide") window?.hide();
      else if (action === "quit") app.quit();
    });
    tray.on("right-click", () => {
      if (trayMenuWindow && !trayMenuWindow.isDestroyed()) { trayMenuWindow.focus(); return; }
      const point = screen.getCursorScreenPoint();
      const area = screen.getDisplayNearestPoint(point).workArea;
      const width = 232, height = 224;
      trayMenuWindow = new BrowserWindow({
        width, height,
        x: Math.max(area.x, Math.min(point.x - width / 2, area.x + area.width - width)),
        y: Math.max(area.y, Math.min(point.y - height, area.y + area.height - height)),
        frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: true,
        resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
        webPreferences: { preload: path.join(__dirname, "tray-preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const popup = trayMenuWindow;
      popup.setMenuBarVisibility(false);
      popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      popup.webContents.on("will-navigate", event => event.preventDefault());
      popup.once("ready-to-show", () => popup.show());
      popup.on("blur", () => { if (!popup.isDestroyed()) popup.close(); });
      popup.on("closed", () => { trayMenuWindow = null; });
      popup.loadFile(path.join(__dirname, "tray.html"));
    });
  } else tray.setContextMenu(trayMenu);
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  createWindow();
  app.on("activate", showWindow);
  app.on("second-instance", showWindow);
});
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { tray?.destroy(); });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && (!tray || tray.isDestroyed())) app.quit();
});
