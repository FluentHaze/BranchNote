const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("branchNote", {
  pickRepository: () => ipcRenderer.invoke("repository:pick"),
  readRepository: (directory) =>
    ipcRenderer.invoke("repository:read", directory),
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
  read: () => ipcRenderer.invoke("data:read"),
  write: (content) => ipcRenderer.invoke("data:write", content),
  backup: (content) => ipcRenderer.invoke("data:backup", content),
  export: (content, name) =>
    ipcRenderer.invoke("file:export", { content, name }),
});
