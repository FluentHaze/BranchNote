const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("branchNote", {
  pickRepository: () => ipcRenderer.invoke("repository:pick"),
  readRepository: (directory) =>
    ipcRenderer.invoke("repository:read", directory),
  fetchRepository: (directory) =>
    ipcRenderer.invoke("repository:fetch", directory),
  prepareMerge: (directory, target, sources, resolveBranch, options) =>
    ipcRenderer.invoke("repository:prepare-merge", {
      directory,
      target,
      sources,
      resolveBranch,
      options,
    }),
  executeMerge: (planId) =>
    ipcRenderer.invoke("repository:execute-merge", planId),
  pushBranch: (directory, branch, remote) =>
    ipcRenderer.invoke("repository:push", { directory, branch, remote }),
  mergeState: (directory) =>
    ipcRenderer.invoke("repository:merge-state", directory),
  readConflict: (directory, file) =>
    ipcRenderer.invoke("repository:conflict-read", { directory, file }),
  // 在外部编辑器里解决冲突：打开文件 + 回读保存后的内容
  openConflictInEditor: (directory, file) =>
    ipcRenderer.invoke("repository:conflict-open", { directory, file }),
  readWorkingFile: (directory, file) =>
    ipcRenderer.invoke("repository:conflict-read-file", { directory, file }),
  resolveConflict: (directory, file, content) =>
    ipcRenderer.invoke("repository:conflict-resolve", {
      directory,
      file,
      content,
    }),
  takeConflictSide: (directory, file, side) =>
    ipcRenderer.invoke("repository:conflict-side", { directory, file, side }),
  unionConflict: (directory, file) =>
    ipcRenderer.invoke("repository:conflict-union", { directory, file }),
  commitConflict: (directory, message) =>
    ipcRenderer.invoke("repository:conflict-commit", { directory, message }),
  abortConflict: (directory, returnTo) =>
    ipcRenderer.invoke("repository:conflict-abort", { directory, returnTo }),
  mergeRequestUrl: (directory, source, target) =>
    ipcRenderer.invoke("repository:mr-url", { directory, source, target }),
  openUrl: (url) => ipcRenderer.invoke("repository:open-url", url),
  continueMerge: (directory, branch, sources) =>
    ipcRenderer.invoke("repository:continue-merge", {
      directory,
      branch,
      sources,
    }),
  finalizeMerge: (directory, targetLocal, from) =>
    ipcRenderer.invoke("repository:finalize-merge", {
      directory,
      targetLocal,
      from,
    }),
  read: () => ipcRenderer.invoke("data:read"),
  write: (content) => ipcRenderer.invoke("data:write", content),
  backup: (content) => ipcRenderer.invoke("data:backup", content),
  export: (content, name) =>
    ipcRenderer.invoke("file:export", { content, name }),
});
