const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("inkApi", {
  chooseExportDirectory: () => ipcRenderer.invoke("export:choose-directory"),
  writeFrame: (payload) => ipcRenderer.invoke("export:write-frame", payload),
  writeManifest: (payload) => ipcRenderer.invoke("export:write-manifest", payload),
  reveal: (directory) => ipcRenderer.invoke("app:reveal", directory)
});
