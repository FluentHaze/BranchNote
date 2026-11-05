const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { readRepository, prepareMerge, executeMerge } = require("./git.cjs");

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
