const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("node:path");
const { loadAnimationBootstrap } = require("./runtime/animation-bootstrap");
const {
  ANIMATION_COMMAND_CHANNEL,
  ANIMATION_COMPLETE_CHANNEL,
  createAnimationBridge
} = require("./runtime/animation-protocol");
const { ObstacleIndex } = require("./runtime/obstacle-index");
const {
  isTrustedIpcSender,
  PetController,
  validatePetAction
} = require("./runtime/pet-controller");
const { readTaskbarRects } = require("./windows/taskbar");
const { createWindowSensor } = require("./windows/window-sensor");

let petWindow;
let hitWindow;
let controller;
let animationBridge;
let windowSensor;
let fallTimer;

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: false
  };
}

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
    webPreferences: secureWebPreferences()
  });

  petWindow.setMenuBarVisibility(false);
  petWindow.setIgnoreMouseEvents(true);
  petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  petWindow.once("ready-to-show", () => petWindow.show());
  petWindow.on("closed", () => {
    petWindow = undefined;
    if (hitWindow && !hitWindow.isDestroyed()) hitWindow.close();
  });
  petWindow.loadFile(path.join(__dirname, "render", "pet.html"));
}

function createHitWindow() {
  hitWindow = new BrowserWindow({
    x: -32000,
    y: -32000,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    show: false,
    webPreferences: secureWebPreferences()
  });

  hitWindow.setMenuBarVisibility(false);
  hitWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  hitWindow.on("closed", () => {
    hitWindow = undefined;
  });
  hitWindow.loadFile(path.join(__dirname, "render", "hit.html"));
}

function liveWindowAdapter(getWindow) {
  return {
    setBounds(bounds) {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.setBounds(bounds, false);
    },
    hide() {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.hide();
    },
    showInactive() {
      const window = getWindow();
      if (window && !window.isDestroyed()) window.showInactive();
    }
  };
}

function createRuntime() {
  const obstacleIndex = new ObstacleIndex();
  windowSensor = createWindowSensor({
    onChange(obstacles) {
      obstacleIndex.replace("windows", obstacles);
      controller?.syncObstacles();
    }
  });
  obstacleIndex.replace("windows", windowSensor.snapshot());
  obstacleIndex.replace("taskbars", readTaskbarRects());

  animationBridge = createAnimationBridge({
    send(command) {
      if (!petWindow || petWindow.isDestroyed()) return false;
      petWindow.webContents.send(ANIMATION_COMMAND_CHANNEL, command);
      return true;
    }
  });
  const initialBounds = petWindow.getBounds();
  controller = new PetController({
    obstacleIndex,
    animationBridge,
    body: { ...initialBounds, vx: 0, vy: 0 },
    renderWindow: liveWindowAdapter(() => petWindow),
    hitWindow: liveWindowAdapter(() => hitWindow)
  });
  windowSensor.start();

  let previousTick = Date.now();
  fallTimer = setInterval(() => {
    const now = Date.now();
    const dtMs = Math.min(100, Math.max(0, now - previousTick));
    previousTick = now;
    controller?.tick(dtMs);
  }, 16);
}

function stopRuntime() {
  if (fallTimer) clearInterval(fallTimer);
  fallTimer = undefined;
  if (windowSensor && windowSensor.stop() === false) windowSensor.stop();
  windowSensor = undefined;
  controller = undefined;
  animationBridge = undefined;
}

ipcMain.handle("desktop-pet:get-bootstrap", () => ({
  appVersion: app.getVersion(),
  ...loadAnimationBootstrap()
}));

ipcMain.handle("desktop-pet:action", (event, action, payload) => {
  const validated = validatePetAction(action, payload);
  if (!isTrustedIpcSender(event, hitWindow) || !validated || !controller) {
    return { accepted: false };
  }
  return controller.handleInput(validated.action, validated.point);
});

ipcMain.handle("desktop-pet:update-hit-box", (event, hitBox) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(controller?.setFrameHitBox(hitBox))
}));

ipcMain.handle(ANIMATION_COMPLETE_CHANNEL, (event, completion) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(animationBridge?.complete(completion))
}));

ipcMain.handle("desktop-pet:open-context-menu", event => {
  if (isTrustedIpcSender(event, hitWindow) && petWindow && !petWindow.isDestroyed()) {
    Menu.buildFromTemplate([]).popup({ window: petWindow });
    return { accepted: true };
  }
  return { accepted: false };
});

app.whenReady().then(() => {
  createPetWindow();
  createHitWindow();
  createRuntime();

  app.on("activate", () => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
      createHitWindow();
      createRuntime();
    }
  });
});

app.on("before-quit", stopRuntime);

app.on("window-all-closed", () => {
  app.quit();
});
