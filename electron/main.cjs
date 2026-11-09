const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const {
  readRepository,
  fetchRepository,
  prepareMerge,
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
  mergeRequestUrl,
} = require("./git.cjs");
const {
  listHosts,
  saveHost,
  removeHost,
  testHost,
  createMergeRequest,
} = require("./hosts.cjs");

let window;
let mergePlan;
let merging = false;
const dataPath = () => path.join(app.getPath("userData"), "branchnote.json");

app.whenReady().then(() => {
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
  ipcMain.handle("repository:execute-merge", async (_, planId) => {
    if (merging || !mergePlan || mergePlan.id !== planId)
      throw new Error("合并清单已失效，请重新预览");
    const plan = mergePlan;
    mergePlan = null;
    merging = true;
    try {
      return await executeMerge(plan);
    } finally {
      merging = false;
    }
  });
  ipcMain.handle("repository:push", async (_, { directory, branch, remote }) => {
    if (merging) throw new Error("正在合并，请等待当前操作结束");
    return pushBranch(directory, branch, remote);
  });
  // 冲突解决：这些操作本身就在合并中间态里进行，不受 merging 锁限制
  ipcMain.handle("repository:merge-state", (_, directory) =>
    readMergeState(directory),
  );
  ipcMain.handle("repository:conflict-read", (_, { directory, file }) =>
    readConflictFile(directory, file),
  );
  // 交给系统默认编辑器打开（通常是 VS Code / Cursor），便于直接用编辑器解决冲突
  ipcMain.handle("repository:conflict-open", async (_, { directory, file }) => {
    const target = await workingFile(directory, file);
    const failure = await shell.openPath(target.absolute);
    if (failure) throw new Error(`无法打开编辑器：${failure}`);
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
  ipcMain.handle("repository:mr-url", (_, { directory, source, target }) =>
    mergeRequestUrl(directory, source, target),
  );
  // 在系统浏览器里打开（用于 MR 创建页 / 已创建的 MR）
  ipcMain.handle("repository:open-url", (_, url) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url))
      throw new Error("链接格式不正确");
    return shell.openExternal(url);
  });
  // 用访问令牌调接口直接创建 MR / PR；失败时返回原因，由界面给兜底链接
  ipcMain.handle(
    "repository:create-mr",
    (_, { directory, source, target, title, description }) =>
      createMergeRequest({ directory, source, target, title, description }),
  );
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
      backgroundColor: "#f5f5f7",
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
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
