const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("branchNote", {
  platform: process.platform,
  subscribeTrayAction: (callback) => {
    const listener = (_, action) => callback(action);
    ipcRenderer.on("tray:action", listener);
    return () => ipcRenderer.removeListener("tray:action", listener);
  },
  getUpdate: () => ipcRenderer.invoke("update:get"),
  update: (action) => ipcRenderer.invoke("update:action", action),
  subscribeUpdate: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
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
  checkMerge: (planId) => ipcRenderer.invoke("repository:check-merge", planId),
  executeMerge: (planId, confirmed) =>
    ipcRenderer.invoke("repository:execute-merge", planId, confirmed),
  pushBranch: (directory, branch, remote, checkedSource) =>
    ipcRenderer.invoke("repository:push", { directory, branch, remote, checkedSource }),
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
  mergeRequestUrl: (directory, source, target, remote) =>
    ipcRenderer.invoke("repository:mr-url", { directory, source, target, remote }),
  mergeRequestOptions: (directory, remote) => ipcRenderer.invoke("repository:mr-options", {directory, remote}),
  requestProvider: (directory, remote) => ipcRenderer.invoke("repository:request-provider", {directory, remote}),
  createMergeRequest: (directory, source, target, title, description, remote, removeSourceBranch, metadata) =>
    ipcRenderer.invoke("repository:create-mr", {
      directory,
      source,
      target,
      title,
      description,
      remote,
      removeSourceBranch,
      metadata,
    }),
  syncMergeRequests: (urls) => ipcRenderer.invoke("repository:sync-mrs", urls),
  listHosts: () => ipcRenderer.invoke("hosts:list"),
  saveHost: (payload) => ipcRenderer.invoke("hosts:save", payload),
  removeHost: (host) => ipcRenderer.invoke("hosts:remove", host),
  testHost: (payload) => ipcRenderer.invoke("hosts:test", payload),
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
