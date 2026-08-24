const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("node:path");

let petWindow;

function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false
    }
  });

  petWindow.setMenuBarVisibility(false);
  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.once("ready-to-show", () => petWindow.show());
  petWindow.on("closed", () => {
    petWindow = undefined;
  });
  petWindow.loadFile(path.join(__dirname, "render", "pet.html"));
}

ipcMain.handle("desktop-pet:get-bootstrap", () => ({
  appVersion: app.getVersion()
}));

ipcMain.handle("desktop-pet:action", (_event, action) => ({
  accepted: typeof action === "string"
}));

ipcMain.handle("desktop-pet:open-context-menu", () => {
  if (petWindow && !petWindow.isDestroyed()) {
    Menu.buildFromTemplate([]).popup({ window: petWindow });
  }
});

app.whenReady().then(() => {
  createPetWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
