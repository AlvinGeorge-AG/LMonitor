const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lmWidget", {
  getPrefs: () => ipcRenderer.invoke("get-prefs"),
  setPrefs: (prefs) => ipcRenderer.send("set-prefs", prefs),
  closeWindow: () => ipcRenderer.send("close-window"),
  minimizeWindow: () => ipcRenderer.send("minimize-window"),
});
