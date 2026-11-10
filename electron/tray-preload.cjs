const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("trayMenu", {
  action: (action) => ipcRenderer.invoke("tray-menu:action", action),
});
