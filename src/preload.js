const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopPet", Object.freeze({
  getBootstrap: () => ipcRenderer.invoke("desktop-pet:get-bootstrap"),
  petAction: (action) => ipcRenderer.invoke("desktop-pet:action", action),
  openContextMenu: () => ipcRenderer.invoke("desktop-pet:open-context-menu")
}));
