const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const path = require("node:path");
const { placeBubble } = require("./domain/bubble-placement");
const { setAutostart, updateAutostartPreference } = require("./runtime/autostart");
const {
  loadAnimationBootstrap,
  poseAnchorsFromManifest
} = require("./runtime/animation-bootstrap");
const { createAutonomousRoam } = require("./runtime/autonomous-roam");
const { createBubbleDisplayMonitor } = require("./runtime/bubble-display-monitor");
const { createDesktopIconMonitor } = require("./runtime/desktop-icon-monitor");
const {
  ANIMATION_COMMAND_CHANNEL,
  ANIMATION_COMPLETE_CHANNEL,
  createAnimationBridge
} = require("./runtime/animation-protocol");
const { createMenuTemplate, isMenuAction } = require("./runtime/menu");
const { ObstacleIndex } = require("./runtime/obstacle-index");
const {
  isTrustedIpcSender,
  PetController,
  validatePetAction
} = require("./runtime/pet-controller");
const { SettingsStore } = require("./runtime/settings");
const { runRuntimeTick } = require("./runtime/runtime-tick");
const {
  createRendererCommandBridge,
  createSpeechFlow,
  speakChinese
} = require("./runtime/speech");
const { readTaskbarRects } = require("./windows/taskbar");
const { getDesktopIconDiagnostic, readDesktopIconRects } = require("./windows/desktop-icons");
const { createWindowSensor } = require("./windows/window-sensor");

app.disableHardwareAcceleration();

const INTERACTION_COMMAND_CHANNEL = "desktop-pet:interaction-command";
const INTERACTION_RESULT_CHANNEL = "desktop-pet:interaction-result";
const BUBBLE_UPDATE_CHANNEL = "desktop-pet:bubble-update";
const BUBBLE_SIZE = Object.freeze({ width: 220, height: 90 });

let petWindow;
let hitWindow;
let bubbleWindow;
let controller;
let animationBridge;
let rendererCommandBridge;
let speechFlow;
let settingsStore;
let windowSensor;
let fallTimer;
let frameFaceBox;
let bubbleReadyPromise = Promise.resolve(false);
let activeBubbleText;
let bubbleDisplayMonitor;
let autonomousRoam;
let animationBootstrap;
let desktopIconMonitor;

function secureWebPreferences() {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    devTools: false
  };
}

function hardenWindow(window) {
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function createPetWindow() {
  petWindow = new BrowserWindow({
    width: 192,
    height: 208,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: secureWebPreferences()
  });

  hardenWindow(petWindow);
  petWindow.setIgnoreMouseEvents(true);
  petWindow.once("ready-to-show", () => petWindow.show());
  petWindow.on("closed", () => {
    petWindow = undefined;
    if (hitWindow && !hitWindow.isDestroyed()) hitWindow.close();
    if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.close();
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

  hardenWindow(hitWindow);
  hitWindow.on("closed", () => {
    hitWindow = undefined;
  });
  hitWindow.loadFile(path.join(__dirname, "render", "hit.html"));
}

function createBubbleWindow() {
  bubbleWindow = new BrowserWindow({
    x: -32000,
    y: -32000,
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: secureWebPreferences()
  });

  hardenWindow(bubbleWindow);
  bubbleWindow.setIgnoreMouseEvents(true);
  bubbleReadyPromise = new Promise(resolve => {
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true;
      resolve(ready);
    };
    bubbleWindow.webContents.once("did-finish-load", () => finish(true));
    bubbleWindow.webContents.once("did-fail-load", () => finish(false));
    bubbleWindow.once("closed", () => finish(false));
  });
  bubbleWindow.on("closed", () => {
    bubbleWindow = undefined;
  });
  bubbleWindow.loadFile(path.join(__dirname, "render", "bubble.html"));
}

function liveWindowAdapter(getWindow, onBoundsChanged) {
  return {
    setBounds(bounds) {
      const window = getWindow();
      if (window && !window.isDestroyed()) {
        window.setBounds(bounds, false);
        onBoundsChanged?.();
      }
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

function validRectangle(value) {
  return Boolean(value)
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.x >= 0
    && value.y >= 0
    && value.width > 0
    && value.height > 0;
}

function integerBounds(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  };
}

function repositionSpeechBubble() {
  const text = activeBubbleText;
  if (!text) return false;
  if (!petWindow || petWindow.isDestroyed() || !bubbleWindow || bubbleWindow.isDestroyed()) return false;
  const petRect = petWindow.getBounds();
  const scale = settingsStore?.snapshot().petScale || 1;
  const fallbackFaceBox = {
    x: Math.round(petRect.width * 0.35),
    y: 12,
    width: Math.round(petRect.width * 0.3),
    height: Math.round(petRect.height * 0.22)
  };
  const faceBox = frameFaceBox
    ? {
        x: frameFaceBox.x * scale,
        y: frameFaceBox.y * scale,
        width: frameFaceBox.width * scale,
        height: frameFaceBox.height * scale
      }
    : fallbackFaceBox;
  const display = screen.getDisplayMatching(petRect);
  let placement;
  try {
    placement = placeBubble({
      faceBox,
      petRect,
      bubbleSize: BUBBLE_SIZE,
      workArea: display.workArea,
      pointer: screen.getCursorScreenPoint()
    });
  } catch {
    return false;
  }
  bubbleWindow.setBounds(integerBounds(placement.rect), false);
  bubbleWindow.webContents.send(BUBBLE_UPDATE_CHANNEL, { text });
  bubbleWindow.showInactive();
  return placement;
}

async function showSpeechBubble(text) {
  activeBubbleText = text;
  if (!await bubbleReadyPromise || activeBubbleText !== text) {
    if (activeBubbleText === text) activeBubbleText = undefined;
    return false;
  }
  const placement = repositionSpeechBubble();
  if (!placement) activeBubbleText = undefined;
  return placement;
}

function hideSpeechBubble() {
  activeBubbleText = undefined;
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

function syncControllerObstacles() {
  const previousMode = controller?.snapshot().state.mode;
  const result = controller?.syncObstacles();
  if (["resting", "speaking"].includes(previousMode)
    && controller?.snapshot().state.mode === "falling") {
    void speechFlow?.dismiss({ recoverAnimation: false });
  }
  return result;
}

function createRuntime() {
  const obstacleIndex = new ObstacleIndex();
  windowSensor = createWindowSensor({
    onChange(obstacles) {
      obstacleIndex.replace("windows", obstacles);
      syncControllerObstacles();
    }
  });
  obstacleIndex.replace("windows", windowSensor.snapshot());
  obstacleIndex.replace("taskbars", readTaskbarRects());
  desktopIconMonitor = createDesktopIconMonitor({
    readRects: readDesktopIconRects,
    getDiagnostic: getDesktopIconDiagnostic,
    enabled: settingsStore.snapshot().iconCollision,
    onChange(obstacles) {
      obstacleIndex.replace("desktop-icons", obstacles);
      syncControllerObstacles();
    }
  });
  desktopIconMonitor.start();

  animationBridge = createAnimationBridge({
    send(command) {
      if (!petWindow || petWindow.isDestroyed()) return false;
      petWindow.webContents.send(ANIMATION_COMMAND_CHANNEL, command);
      return true;
    }
  });
  rendererCommandBridge = createRendererCommandBridge({
    send(command) {
      if (!petWindow || petWindow.isDestroyed()) return false;
      petWindow.webContents.send(INTERACTION_COMMAND_CHANNEL, command);
      return true;
    }
  });
  const initialBounds = petWindow.getBounds();
  controller = new PetController({
    obstacleIndex,
    animationBridge,
    poseAnchors: poseAnchorsFromManifest(animationBootstrap.manifest, ["sit", "wall-climb", "hang"]),
    body: { ...initialBounds, vx: 0, vy: 0 },
    renderWindow: liveWindowAdapter(() => petWindow, () => repositionSpeechBubble()),
    hitWindow: liveWindowAdapter(() => hitWindow)
  });
  controller.setScale(settingsStore.snapshot().petScale);
  autonomousRoam = createAutonomousRoam();
  petWindow.webContents.setZoomFactor(settingsStore.snapshot().petScale);
  speechFlow = createSpeechFlow({
    beginSpeech: () => Boolean(controller?.beginSpeech()),
    async playKneel() {
      const result = await rendererCommandBridge.request("kneel");
      return result.accepted;
    },
    showBubble: showSpeechBubble,
    speak: (text, volume) => speakChinese(text, volume),
    hideBubble: hideSpeechBubble,
    async recover(action) {
      await rendererCommandBridge.request("recover", action);
    },
    finishSpeech: () => controller?.finishSpeech()
  });
  bubbleDisplayMonitor = createBubbleDisplayMonitor({
    screen,
    reposition: repositionSpeechBubble
  });
  bubbleDisplayMonitor.start();
  windowSensor.start();

  let previousTick = Date.now();
  fallTimer = setInterval(() => {
    const now = Date.now();
    const dtMs = Math.min(100, Math.max(0, now - previousTick));
    previousTick = now;
    if (controller && autonomousRoam) {
      runRuntimeTick({
        controller,
        roam: autonomousRoam,
        settings: settingsStore.snapshot(),
        screen,
        dtMs
      });
    }
  }, 16);
}

function stopRuntime() {
  if (fallTimer) clearInterval(fallTimer);
  fallTimer = undefined;
  if (windowSensor && windowSensor.stop() === false) windowSensor.stop();
  windowSensor = undefined;
  bubbleDisplayMonitor?.stop();
  bubbleDisplayMonitor = undefined;
  void speechFlow?.dismiss({ recoverAnimation: false });
  rendererCommandBridge?.dispose();
  hideSpeechBubble();
  controller = undefined;
  animationBridge = undefined;
  rendererCommandBridge = undefined;
  speechFlow = undefined;
  autonomousRoam = undefined;
  desktopIconMonitor?.stop();
  desktopIconMonitor = undefined;
}

function updateSettings(patch) {
  try {
    return settingsStore.update(patch);
  } catch {
    return settingsStore.snapshot();
  }
}

async function toggleRest() {
  if (!controller || !rendererCommandBridge) return false;
  if (controller.snapshot().state.mode === "resting") {
    const result = await rendererCommandBridge.request("resume");
    return result.accepted && controller.resume();
  }
  await speechFlow?.dismiss();
  if (!controller.rest()) return false;
  const result = await rendererCommandBridge.request("freeze");
  if (result.accepted) return true;
  await rendererCommandBridge.request("resume");
  controller.resume();
  return false;
}

async function handleMenuAction(action, value) {
  if (!isMenuAction(action)) return false;
  if (action === "speak-father" || action === "speak-apology") {
    const text = action === "speak-father" ? "爸爸" : "我错了";
    void speechFlow?.run(text, settingsStore.snapshot().speechVolume);
    return true;
  }
  if (action === "toggle-rest") return toggleRest();
  await speechFlow?.dismiss();
  if (action === "toggle-autonomous") {
    const current = settingsStore.snapshot();
    updateSettings({ autonomousActivity: !current.autonomousActivity });
    return true;
  }
  if (action === "set-scale") {
    const updated = updateSettings({ petScale: value });
    controller?.setScale(updated.petScale);
    petWindow?.webContents.setZoomFactor(updated.petScale);
    return true;
  }
  if (action === "set-volume") {
    updateSettings({ speechVolume: value });
    return true;
  }
  if (action === "toggle-autostart") {
    const enabled = !settingsStore.snapshot().launchAtLogin;
    const result = await updateAutostartPreference(enabled, process.execPath, settingsStore);
    return result.updated;
  }
  if (action === "open-settings") return true;
  if (action === "quit") {
    app.quit();
    return true;
  }
  return false;
}

ipcMain.handle("desktop-pet:get-bootstrap", event => {
  if (!isTrustedIpcSender(event, petWindow)) return { accepted: false };
  return {
    appVersion: app.getVersion(),
    ...animationBootstrap
  };
});

ipcMain.handle("desktop-pet:action", async (event, action, payload) => {
  const validated = validatePetAction(action, payload);
  if (!isTrustedIpcSender(event, hitWindow) || !validated || !controller) {
    return { accepted: false };
  }
  await speechFlow?.dismiss();
  return controller.handleInput(validated.action, validated.point);
});

ipcMain.handle("desktop-pet:update-hit-box", (event, hitBox) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(controller?.setFrameHitBox(hitBox))
}));

ipcMain.handle("desktop-pet:update-face-box", (event, faceBox) => {
  if (!isTrustedIpcSender(event, petWindow) || !validRectangle(faceBox)) return { accepted: false };
  frameFaceBox = Object.freeze({ ...faceBox });
  repositionSpeechBubble();
  return { accepted: true };
});

ipcMain.handle("desktop-pet:update-support-anchor", (event, anchor) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(controller?.setFrameSupportAnchor(anchor?.action, anchor))
}));

ipcMain.handle(ANIMATION_COMPLETE_CHANNEL, (event, completion) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(animationBridge?.complete(completion))
}));

ipcMain.handle(INTERACTION_RESULT_CHANNEL, (event, result) => ({
  accepted: isTrustedIpcSender(event, petWindow)
    && Boolean(rendererCommandBridge?.complete(result))
}));

ipcMain.handle("desktop-pet:open-context-menu", event => {
  if (isTrustedIpcSender(event, hitWindow) && petWindow && !petWindow.isDestroyed()) {
    Menu.buildFromTemplate(createMenuTemplate({
      settings: settingsStore.snapshot(),
      resting: controller?.snapshot().state.mode === "resting",
      onAction(action, value) {
        if (isMenuAction(action)) void handleMenuAction(action, value);
      }
    })).popup({ window: petWindow });
    return { accepted: true };
  }
  return { accepted: false };
});

app.whenReady().then(() => {
  settingsStore = new SettingsStore(path.join(app.getPath("userData"), "settings.json"));
  settingsStore.load();
  animationBootstrap = loadAnimationBootstrap();
  if (app.isPackaged) {
    const enabled = settingsStore.snapshot().launchAtLogin;
    void setAutostart(enabled, process.execPath).then(result => {
      if (!result.updated && enabled) {
        try { settingsStore.update({ launchAtLogin: false }); } catch {}
      }
    });
  }
  createPetWindow();
  createHitWindow();
  createBubbleWindow();
  createRuntime();

  app.on("activate", () => {
    if (!petWindow || petWindow.isDestroyed()) {
      createPetWindow();
      createHitWindow();
      createBubbleWindow();
      createRuntime();
    }
  });
});

app.on("before-quit", stopRuntime);

app.on("window-all-closed", () => {
  app.quit();
});
