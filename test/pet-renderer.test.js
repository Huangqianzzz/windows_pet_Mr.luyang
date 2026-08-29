const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

class LocalCustomEvent {
  constructor(type, { detail }) {
    this.type = type;
    this.detail = detail;
  }
}

function localEventTarget(onEvent = () => {}) {
  const listeners = new Map();
  return {
    CustomEvent: LocalCustomEvent,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) {
      onEvent(event);
      listeners.get(event.type)?.(event);
    }
  };
}

test("loads browser-safe animation dependencies before the renderer", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "render", "pet.html"), "utf8");

  assert.ok(html.indexOf("../domain/animation-manifest.js") < html.indexOf("../runtime/animation-protocol.js"));
  assert.ok(html.indexOf("../runtime/animation-protocol.js") < html.indexOf("../runtime/animation-player.js"));
  assert.ok(html.indexOf("../domain/animation-manifest.js") < html.indexOf("../runtime/animation-player.js"));
  assert.ok(html.indexOf("../runtime/animation-player.js") < html.indexOf("pet-renderer.js"));
});

test("left-facing crawl mirrors the sprite and frame geometry inside its source width", () => {
  const { applyFrame, mirrorBox } = require("../src/render/pet-renderer");
  const sprite = { style: {} };
  const action = { sheet: { file: "crawl.png", width: 20, height: 10 } };
  const frame = { source: { x: 0, y: 0, width: 10, height: 10 } };

  applyFrame(sprite, action, frame, "file:///C:/pet/src/render/pet.html", "left");

  assert.equal(sprite.style.transform, "scaleX(-1)");
  assert.equal(sprite.style.transformOrigin, "center");
  assert.deepEqual(mirrorBox({ x: 1, y: 2, width: 3, height: 4 }, 10), {
    x: 6, y: 2, width: 3, height: 4
  });
  assert.throws(() => mirrorBox({ x: 9, y: 0, width: 2, height: 1 }, 10), /inside/);
});

test("bootstraps idle and applies its first sprite-sheet frame", async () => {
  const root = { children: [], append(child) { this.children.push(child); } };
  const rendererPath = path.join(__dirname, "..", "src", "render", "pet-renderer.js");
  const previousWindow = global.window;
  const previousDocument = global.document;
  const manifest = {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "sheets/idle.png", width: 30, height: 10 },
        fps: 10,
        loop: true,
        interruptible: true,
        frames: [{
          source: { x: 10, y: 0, width: 10, height: 10 },
          faceBox: { x: 2, y: 2, width: 4, height: 4 },
          hitBox: { x: 1, y: 1, width: 8, height: 8 },
          contacts: [{ x: 5, y: 10 }],
          supportAnchor: { x: 5, y: 10 }
        }]
      }
    }
  };
  let playedAction;
  const hitBoxes = [];
  const supportAnchors = [];
  class FakePlayer {
    constructor(receivedManifest) {
      this.manifest = receivedManifest;
    }

    play(actionName, { onFrame }) {
      playedAction = actionName;
      onFrame(this.manifest.actions[actionName].frames[0], 0, actionName);
    }
  }
  global.window = {
    location: { href: "file:///C:/pet/src/render/pet.html" },
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    DesktopPetAnimationPlayer: { AnimationPlayer: FakePlayer }
  };
  global.document = {
    getElementById: (id) => (id === "pet-root" ? root : null),
    createElement: (tagName) => ({
      tagName,
      attributes: {},
      style: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    })
  };

  delete require.cache[require.resolve(rendererPath)];
  const renderer = require(rendererPath);
  assert.equal(typeof renderer.mountPet, "function");
  const eventTarget = localEventTarget(event => {
    if (event.type === "desktop-pet:frame-hit-box") hitBoxes.push(event.detail);
    if (event.type === "desktop-pet:frame-support-anchor") supportAnchors.push(event.detail);
  });
  const mounted = renderer.mountPet({
    document: global.document,
    desktopPet: global.window.desktopPet,
    AnimationPlayer: FakePlayer,
    locationHref: global.window.location.href,
    eventTarget
  });
  await mounted.ready;

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].className, "pet-sprite");
  assert.equal(root.children[0].attributes["aria-hidden"], "true");
  assert.equal(playedAction, "idle");
  assert.equal(root.children[0].style.width, "10px");
  assert.equal(root.children[0].style.height, "10px");
  assert.equal(root.children[0].style.backgroundPosition, "-10px 0px");
  assert.equal(root.children[0].style.backgroundSize, "30px 10px");
  assert.equal(root.children[0].style.backgroundImage, "url(\"file:///C:/pet/assets/animations/sheets/idle.png\")");
  assert.deepEqual(hitBoxes, [{ x: 1, y: 1, width: 8, height: 8 }]);
  assert.deepEqual(supportAnchors, [{ action: "idle", x: 5, y: 10 }]);
  global.window = previousWindow;
  global.document = previousDocument;
});

test("renders from the player's frozen manifest after bootstrap data is tampered", async () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const root = { children: [], append(child) { this.children.push(child); } };
  const renderer = require("../src/render/pet-renderer");
  const manifest = {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 20, height: 10 },
        fps: 10,
        loop: true,
        interruptible: true,
        frames: [{
          source: { x: 10, y: 0, width: 10, height: 10 },
          faceBox: { x: 2, y: 2, width: 4, height: 4 },
          hitBox: { x: 1, y: 1, width: 8, height: 8 },
          contacts: [{ x: 5, y: 10 }],
          supportAnchor: { x: 5, y: 10 }
        }]
      }
    }
  };
  class TamperingPlayer extends AnimationPlayer {
    constructor(bootstrapManifest) {
      super(bootstrapManifest, {
        clock: () => 0,
        scheduler: { request: () => 1, cancel: () => {} }
      });
      this.bootstrapManifest = bootstrapManifest;
    }

    play(actionName, options) {
      delete this.bootstrapManifest.actions.idle.sheet;
      return super.play(actionName, options);
    }
  }
  const document = {
    getElementById: () => root,
    createElement: () => ({ style: {}, setAttribute() {} })
  };
  const mounted = renderer.mountPet({
    document,
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    AnimationPlayer: TamperingPlayer,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget: localEventTarget()
  });

  await mounted.ready;

  assert.equal(root.children[0].style.backgroundImage, "url(\"file:///C:/pet/assets/animations/idle.png\")");
  assert.equal(root.children[0].style.backgroundPosition, "-10px 0px");
});

test("preload forwards only the exact desktop-pet background mode payload", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const ipcHandlers = new Map();
  const localHandlers = new Map();
  const dispatched = [];
  class CustomEvent {
    constructor(type, { detail }) { this.type = type; this.detail = detail; }
  }
  vm.runInNewContext(source, {
    CustomEvent,
    window: {
      addEventListener(type, listener) { localHandlers.set(type, listener); },
      dispatchEvent(event) { dispatched.push(event); }
    },
    require(id) {
      assert.equal(id, "electron");
      return {
        contextBridge: { exposeInMainWorld() {} },
        ipcRenderer: {
          invoke: () => Promise.resolve(),
          on(channel, listener) { ipcHandlers.set(channel, listener); }
        }
      };
    }
  });

  const receive = ipcHandlers.get("desktop-pet:background-mode");
  assert.equal(typeof receive, "function");
  receive({}, { paused: true });
  receive({}, { paused: false });
  receive({}, {});
  receive({}, { paused: "true" });
  receive({}, { paused: true, extra: true });
  localHandlers.get("DOMContentLoaded")();

  assert.deepEqual(dispatched.map(event => ({
    type: event.type,
    detail: JSON.parse(JSON.stringify(event.detail))
  })), [
    { type: "desktop-pet:background-mode", detail: { paused: true } },
    { type: "desktop-pet:background-mode", detail: { paused: false } },
    { type: "desktop-pet:background-mode", detail: { paused: false } }
  ]);
});

test("renderer combines rest and background pause reasons across bootstrap and play", async () => {
  const { mountPet } = require("../src/render/pet-renderer");
  let resolveBootstrap;
  const bootstrap = new Promise(resolve => { resolveBootstrap = resolve; });
  const eventTarget = localEventTarget();
  const frame = {
    source: { x: 0, y: 0, width: 10, height: 10 },
    faceBox: { x: 2, y: 1, width: 5, height: 4 },
    hitBox: { x: 1, y: 1, width: 8, height: 8 }
  };
  const action = {
    sheet: { file: "idle.png", width: 10, height: 10 },
    loop: true,
    frames: [frame]
  };
  const manifest = { actions: { idle: action, crawl: action } };
  class Player {
    constructor(received) { this.manifest = received; this.calls = []; }
    play(name, options = {}) {
      this.calls.push(["play", name]);
      options.onFrame?.(frame, 0, name);
      return this;
    }
    freeze() { this.calls.push(["freeze"]); return this; }
    resume() { this.calls.push(["resume"]); return this; }
  }
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: () => bootstrap },
    AnimationPlayer: Player,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget
  });

  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:background-mode", {
    detail: { paused: true }
  }));
  resolveBootstrap({ manifest });
  const player = await mounted.ready;
  assert.deepEqual(player.calls, [["play", "idle"], ["freeze"]]);

  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:interaction-command", {
    detail: { id: 1, type: "freeze", expiresAt: Number.MAX_SAFE_INTEGER }
  }));
  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:background-mode", {
    detail: { paused: false }
  }));
  assert.deepEqual(player.calls, [["play", "idle"], ["freeze"]]);

  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:interaction-command", {
    detail: { id: 2, type: "resume", expiresAt: Number.MAX_SAFE_INTEGER }
  }));
  assert.deepEqual(player.calls.at(-1), ["resume"]);

  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:background-mode", {
    detail: { paused: true }
  }));
  eventTarget.dispatchEvent(new LocalCustomEvent("desktop-pet:animation-command", {
    detail: { id: 3, action: "crawl", force: false }
  }));
  assert.deepEqual(player.calls.slice(-3), [["freeze"], ["play", "crawl"], ["freeze"]]);
});

test("renderer freezes from bootstrap truth when the initial background IPC was completely missed", async () => {
  const { mountPet } = require("../src/render/pet-renderer");
  const frame = {
    source: { x: 0, y: 0, width: 10, height: 10 },
    faceBox: { x: 2, y: 1, width: 5, height: 4 },
    hitBox: { x: 1, y: 1, width: 8, height: 8 }
  };
  const manifest = {
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 10, height: 10 },
        loop: true,
        frames: [frame]
      }
    }
  };
  class Player {
    constructor(received) { this.manifest = received; this.calls = []; }
    play(name, options = {}) {
      this.calls.push(["play", name]);
      options.onFrame?.(frame, 0, name);
      return this;
    }
    freeze() { this.calls.push(["freeze"]); return this; }
    resume() { this.calls.push(["resume"]); return this; }
  }
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: async () => ({ manifest, backgroundPaused: true }) },
    AnimationPlayer: Player,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget: localEventTarget()
  });

  assert.deepEqual((await mounted.ready).calls, [["play", "idle"], ["freeze"]]);
});
