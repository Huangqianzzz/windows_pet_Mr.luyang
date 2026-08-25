const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ObstacleIndex } = require("../src/runtime/obstacle-index");
const { PetController } = require("../src/runtime/pet-controller");
const {
  ANIMATION_COMMAND_EVENT,
  ANIMATION_COMPLETE_EVENT,
  createAnimationBridge,
  validateAnimationCommand
} = require("../src/runtime/animation-protocol");
const { mountPet } = require("../src/render/pet-renderer");

class LocalCustomEvent {
  constructor(type, { detail }) {
    this.type = type;
    this.detail = detail;
  }
}

class LocalEventTarget {
  constructor() {
    this.CustomEvent = LocalCustomEvent;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

function action(hitBox) {
  return {
    sheet: { file: "idle.png", width: 10, height: 10 },
    frames: [{
      source: { x: 0, y: 0, width: 10, height: 10 },
      hitBox,
      faceBox: { x: 2, y: 2, width: 4, height: 4 },
      contacts: [{ x: 5, y: 10 }],
      supportAnchor: { x: 5, y: 10 }
    }]
  };
}

test("animation bridge validates force policy and completes a command once", () => {
  const sent = [];
  let completions = 0;
  const bridge = createAnimationBridge({ send(command) { sent.push(command); return true; } });

  assert.equal(bridge.play("sit", { onComplete: () => { completions += 1; } }), true);
  assert.equal(bridge.play("sit", { force: true }), false);
  assert.equal(bridge.play("fall", { force: true }), true);
  assert.equal(bridge.play("unknown-action"), false);
  assert.deepEqual(sent, [
    { id: 1, action: "sit", force: false },
    { id: 2, action: "fall", force: true }
  ]);
  assert.deepEqual(validateAnimationCommand(sent[0]), sent[0]);
  assert.equal(validateAnimationCommand({ id: 3, action: "crawl", force: true }), null);

  assert.equal(bridge.complete({ id: 1 }), true);
  assert.equal(bridge.complete({ id: 1 }), false);
  assert.equal(completions, 1);
});

test("controller commands the sole renderer player and restores hit input only on a landing frame", async () => {
  const eventTarget = new LocalEventTarget();
  const manifest = {
    actions: {
      idle: action({ x: 0, y: 0, width: 4, height: 4 }),
      sit: action({ x: 1, y: 1, width: 5, height: 5 }),
      fall: action({ x: 2, y: 2, width: 6, height: 6 }),
      land: action({ x: 3, y: 3, width: 7, height: 7 })
    }
  };
  class FakeAnimationPlayer {
    constructor(receivedManifest) {
      this.manifest = receivedManifest;
      this.calls = [];
    }

    play(actionName, options = {}) {
      this.calls.push({ action: actionName, options });
      options.onFrame?.(this.manifest.actions[actionName].frames[0], 0, actionName);
      return this;
    }

    completeLast() {
      this.calls.at(-1).options.onComplete?.(this.calls.at(-1).action);
    }
  }
  const root = { append() {} };
  const mounted = mountPet({
    document: {
      getElementById: () => root,
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    AnimationPlayer: FakeAnimationPlayer,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget
  });
  const player = await mounted.ready;
  const commands = [];
  const bridge = createAnimationBridge({
    send(command) {
      commands.push(command);
      eventTarget.dispatchEvent(new LocalCustomEvent(ANIMATION_COMMAND_EVENT, { detail: command }));
      return true;
    }
  });
  const index = new ObstacleIndex();
  const target = {
    source: "window",
    id: "window:1",
    hwnd: 1,
    rect: { x: 0, y: 20, width: 100, height: 20 }
  };
  const floor = {
    source: "taskbar",
    id: "taskbar:primary",
    rect: { x: 0, y: 50, width: 200, height: 20 }
  };
  index.replace("windows", [target]);
  index.replace("taskbars", [floor]);
  const hitEvents = [];
  const controller = new PetController({
    obstacleIndex: index,
    animationBridge: bridge,
    body: { x: 0, y: 0, width: 10, height: 10, vx: 0, vy: 0 },
    renderWindow: { setBounds() {} },
    hitWindow: {
      hide() { hitEvents.push("hide"); },
      setBounds(bounds) { hitEvents.push({ bounds }); },
      showInactive() { hitEvents.push("show"); }
    },
    gravity: 1000,
    releaseThreshold: 12
  });
  eventTarget.addEventListener("desktop-pet:frame-hit-box", event => {
    controller.setFrameHitBox(event.detail);
  });
  eventTarget.addEventListener(ANIMATION_COMPLETE_EVENT, event => {
    bridge.complete(event.detail);
  });

  controller.handleInput("drag-start", { x: 0, y: 0 });
  controller.handleInput("drag-end", { x: 10, y: 20 });
  assert.equal(controller.snapshot().state.mode, "attached");
  assert.equal(commands.at(-1).action, "sit");
  assert.equal(commands.at(-1).force, false);

  index.replace("windows", []);
  const boundsBeforeFall = hitEvents.filter(item => typeof item === "object").length;
  controller.syncObstacles();
  assert.equal(controller.snapshot().state.mode, "falling");
  assert.equal(commands.at(-1).action, "fall");
  assert.equal(commands.at(-1).force, true);
  assert.equal(hitEvents.filter(item => typeof item === "object").length, boundsBeforeFall);
  assert.equal(hitEvents.at(-1), "hide");

  controller.tick(200);
  assert.equal(controller.snapshot().state.mode, "landing");
  assert.equal(commands.at(-1).action, "land");
  assert.equal(commands.at(-1).force, true);
  assert.ok(hitEvents.filter(item => typeof item === "object").length > boundsBeforeFall);

  player.completeLast();
  assert.equal(controller.snapshot().state.mode, "idle");
  assert.deepEqual(player.calls.map(call => call.action), ["idle", "idle", "sit", "fall", "land"]);
});

test("renderer falls back a validated command missing from the manifest to idle", async () => {
  const eventTarget = new LocalEventTarget();
  const completions = [];
  eventTarget.addEventListener(ANIMATION_COMPLETE_EVENT, event => completions.push(event.detail));
  class FakeAnimationPlayer {
    constructor(manifest) {
      this.manifest = manifest;
      this.calls = [];
    }

    play(actionName, options) {
      this.calls.push({ action: actionName, options });
      options.onFrame?.(this.manifest.actions[actionName].frames[0], 0, actionName);
      return this;
    }
  }
  const manifest = { actions: { idle: action({ x: 0, y: 0, width: 4, height: 4 }) } };
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    AnimationPlayer: FakeAnimationPlayer,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget
  });
  const player = await mounted.ready;

  eventTarget.dispatchEvent(new LocalCustomEvent(ANIMATION_COMMAND_EVENT, {
    detail: { id: 9, action: "fall", force: true }
  }));

  assert.deepEqual(player.calls.map(call => call.action), ["idle", "idle"]);
  assert.equal(player.calls.at(-1).options.force, true);
  assert.deepEqual(completions, [{ id: 9 }]);
});
