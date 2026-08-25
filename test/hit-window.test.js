const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { mountHitInput } = require("../src/render/hit-renderer");
const { isTrustedIpcSender } = require("../src/runtime/pet-controller");

function event(button, x, y) {
  return {
    button,
    screenX: x,
    screenY: y,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
}

test("hit renderer emits only drag lifecycle actions with finite screen coordinates", () => {
  const listeners = {};
  const calls = [];
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  mountHitInput({
    document,
    desktopPet: {
      petAction(action, payload) { calls.push({ action, payload }); },
      openContextMenu() { calls.push({ action: "context-menu" }); }
    }
  });

  listeners.mousemove(event(0, 1, 2));
  listeners.mousedown(event(2, 2, 3));
  listeners.mousedown(event(0, 10.5, -20));
  listeners.mousemove(event(0, 12, -18));
  listeners.mouseup(event(0, 13, -17));

  assert.deepEqual(calls, [
    { action: "drag-start", payload: { x: 10.5, y: -20 } },
    { action: "drag-move", payload: { x: 12, y: -18 } },
    { action: "drag-end", payload: { x: 13, y: -17 } }
  ]);
});

test("hit renderer routes right click only to the context-menu bridge", () => {
  const listeners = {};
  const calls = [];
  const document = { addEventListener(type, listener) { listeners[type] = listener; } };
  mountHitInput({
    document,
    desktopPet: {
      petAction(action) { calls.push(action); },
      openContextMenu() { calls.push("context-menu"); }
    }
  });
  const rightClick = event(2, 20, 30);

  listeners.contextmenu(rightClick);

  assert.equal(rightClick.prevented, true);
  assert.deepEqual(calls, ["context-menu"]);
});

test("IPC sender gate accepts only the live expected webContents", () => {
  const expected = {};
  const window = { isDestroyed: () => false, webContents: expected };

  assert.equal(isTrustedIpcSender({ sender: expected }, window), true);
  assert.equal(isTrustedIpcSender({ sender: {} }, window), false);
  assert.equal(isTrustedIpcSender({ sender: expected }, { ...window, isDestroyed: () => true }), false);
  assert.equal(isTrustedIpcSender({ sender: expected }, null), false);
});

test("hit document is local-only and loads no renderer dependencies beyond its bridge", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "render", "hit.html"), "utf8");

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /<script src="hit-renderer\.js"><\/script>/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("main configures a separate focusable hit window and a mouse-transparent render window", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");

  assert.match(main, /petWindow\.setIgnoreMouseEvents\(true\)/);
  assert.match(main, /hitWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?transparent:\s*true/);
  assert.match(main, /hitWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?frame:\s*false/);
  assert.match(main, /hitWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?alwaysOnTop:\s*true/);
  assert.match(main, /hitWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?skipTaskbar:\s*true/);
  assert.match(main, /hitWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?focusable:\s*true/);
  assert.match(main, /loadFile\(path\.join\(__dirname, "render", "hit\.html"\)\)/);
  assert.match(main, /isTrustedIpcSender/);
  assert.match(main, /validatePetAction/);
  assert.match(main, /createAnimationBridge/);
  assert.match(main, /ANIMATION_COMPLETE_CHANNEL/);
  assert.doesNotMatch(main, /AnimationPlayer/);
});

test("preload keeps three public APIs and validates internal animation and frame events", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const ipcHandlers = new Map();
  const localHandlers = new Map();
  const dispatched = [];
  const invokes = [];
  let publicApi;
  class LocalCustomEvent {
    constructor(type, { detail }) {
      this.type = type;
      this.detail = detail;
    }
  }
  const window = {
    addEventListener(type, listener) { localHandlers.set(type, listener); },
    dispatchEvent(event) { dispatched.push(event); }
  };
  vm.runInNewContext(source, {
    CustomEvent: LocalCustomEvent,
    window,
    require(id) {
      assert.equal(id, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            assert.equal(name, "desktopPet");
            publicApi = api;
          }
        },
        ipcRenderer: {
          invoke(...args) { invokes.push(args); return Promise.resolve({ accepted: true }); },
          on(channel, listener) { ipcHandlers.set(channel, listener); }
        }
      };
    }
  });

  assert.deepEqual(Object.keys(publicApi), ["getBootstrap", "petAction", "openContextMenu"]);
  assert.equal(ipcHandlers.has("desktop-pet:animation-command"), true);
  ipcHandlers.get("desktop-pet:animation-command")({}, { id: 1, action: "fall", force: true });
  ipcHandlers.get("desktop-pet:animation-command")({}, { id: 2, action: "crawl", force: true });
  ipcHandlers.get("desktop-pet:animation-command")({}, { id: 3, action: "sit", force: false, extra: true });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].type, "desktop-pet:animation-command");
  assert.deepEqual(JSON.parse(JSON.stringify(dispatched[0].detail)),
    { id: 1, action: "fall", force: true });

  assert.equal(ipcHandlers.has("desktop-pet:interaction-command"), true);
  ipcHandlers.get("desktop-pet:interaction-command")({}, {
    id: 4,
    type: "kneel",
    expiresAt: 10_000
  });
  ipcHandlers.get("desktop-pet:interaction-command")({}, {
    id: 5,
    type: "recover",
    action: "prone",
    expiresAt: 10_000
  });
  ipcHandlers.get("desktop-pet:interaction-command")({}, { id: 6, type: "kneel" });
  assert.deepEqual(dispatched.slice(1).map(event => JSON.parse(JSON.stringify(event.detail))), [
    { id: 4, type: "kneel", expiresAt: 10_000 },
    { id: 5, type: "recover", action: "prone", expiresAt: 10_000 }
  ]);

  localHandlers.get("desktop-pet:frame-hit-box")({
    detail: { x: 1, y: 2, width: 3, height: 4 }
  });
  localHandlers.get("desktop-pet:frame-hit-box")({
    detail: { x: 1, y: 2, width: 0, height: 4 }
  });
  localHandlers.get("desktop-pet:animation-complete")({ detail: { id: 1 } });
  localHandlers.get("desktop-pet:interaction-result")({
    detail: { id: 4, accepted: false, reason: "expired" }
  });
  await Promise.resolve();

  assert.deepEqual(invokes.slice(-4).map(args => JSON.parse(JSON.stringify(args))), [
    ["desktop-pet:update-hit-box", { x: 1, y: 2, width: 3, height: 4 }],
    ["desktop-pet:update-hit-box", null],
    ["desktop-pet:animation-complete", { id: 1 }],
    ["desktop-pet:interaction-result", { id: 4, accepted: false, reason: "expired" }]
  ]);
});
