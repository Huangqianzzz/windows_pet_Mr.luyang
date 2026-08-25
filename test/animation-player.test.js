const { test } = require("node:test");
const assert = require("node:assert/strict");

function makeManifest() {
  const frame = (x) => ({
    source: { x, y: 0, width: 10, height: 10 },
    faceBox: { x: 2, y: 2, width: 4, height: 4 },
    hitBox: { x: 1, y: 1, width: 8, height: 8 },
    contacts: [{ x: 5, y: 10 }],
    supportAnchor: { x: 5, y: 10 }
  });
  return {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 30, height: 10 },
        fps: 10,
        loop: true,
        interruptible: true,
        frames: [frame(0), frame(10), frame(20)]
      },
      locked: {
        sheet: { file: "locked.png", width: 30, height: 10 },
        fps: 10,
        loop: false,
        interruptible: false,
        frames: [frame(0), frame(10), frame(20)]
      }
    }
  };
}

function createRig() {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map();
  return {
    clock: () => now,
    scheduler: {
      request(callback) {
        nextId += 1;
        callbacks.set(nextId, callback);
        return nextId;
      },
      cancel(id) {
        callbacks.delete(id);
      }
    },
    setTime(value) {
      now = value;
    },
    runScheduled() {
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      scheduled.forEach((callback) => callback());
    }
  };
}

test("plays the first frame immediately", () => {
  const frames = [];
  const rig = createRig();

  assert.doesNotThrow(() => {
    const { AnimationPlayer } = require("../src/runtime/animation-player");
    const player = new AnimationPlayer(makeManifest(), rig);
    player.play("idle", { onFrame: (_frame, index) => frames.push(index) });
  });

  assert.deepEqual(frames, [0]);
});

test("uses elapsed monotonic time so a delayed callback skips frames", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const frames = [];
  const rig = createRig();
  const player = new AnimationPlayer(makeManifest(), rig);

  player.play("idle", { onFrame: (_frame, index) => frames.push(index) });
  rig.setTime(250);
  rig.runScheduled();

  assert.deepEqual(frames, [0, 2]);
  assert.equal(player.currentFrameIndex, 2);
});

test("freezes the exact frame and excludes frozen time after resume", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const frames = [];
  const rig = createRig();
  const player = new AnimationPlayer(makeManifest(), rig);

  player.play("idle", { onFrame: (_frame, index) => frames.push(index) });
  rig.setTime(150);
  rig.runScheduled();
  player.freeze();
  rig.setTime(10_000);
  rig.runScheduled();
  player.resume();
  rig.setTime(10_050);
  rig.runScheduled();

  assert.equal(player.currentFrameIndex, 2);
  assert.deepEqual(frames, [0, 1, 2]);
});

test("calls onComplete once when a non-looping action ends", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const rig = createRig();
  const frames = [];
  let completed = 0;
  const player = new AnimationPlayer(makeManifest(), rig);

  player.play("idle", {
    loop: false,
    onFrame: (_frame, index) => frames.push(index),
    onComplete: () => { completed += 1; }
  });
  rig.setTime(900);
  rig.runScheduled();
  rig.setTime(2_000);
  rig.runScheduled();

  assert.deepEqual(frames, [0, 2]);
  assert.equal(completed, 1);
});

test("does not resume a non-looping action that completed while freezing", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const rig = createRig();
  let completed = 0;
  const player = new AnimationPlayer(makeManifest(), rig);

  player.play("idle", { loop: false, onComplete: () => { completed += 1; } });
  rig.setTime(900);
  player.freeze().resume();
  rig.setTime(2_000);
  rig.runScheduled();

  assert.equal(player.running, false);
  assert.equal(player.frozen, false);
  assert.equal(completed, 1);
});

test("rejects an invalid manifest at the player boundary", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const manifest = makeManifest();
  manifest.actions.idle.fps = 0;

  assert.throws(() => new AnimationPlayer(manifest, createRig()), /action "idle", frame index n\/a:.*greater than zero/);
});

test("does not replace an unfinished non-interruptible action", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const player = new AnimationPlayer(makeManifest(), createRig());

  player.play("locked");

  assert.equal(player.play("idle"), false);
  assert.equal(player.actionName, "locked");
});

test("does not replace a frozen unfinished non-interruptible action", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const player = new AnimationPlayer(makeManifest(), createRig());

  player.play("locked").freeze();

  assert.equal(player.play("idle"), false);
  assert.equal(player.actionName, "locked");
});

test("allows replacing a completed non-interruptible action", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const rig = createRig();
  const player = new AnimationPlayer(makeManifest(), rig);

  player.play("locked");
  rig.setTime(900);
  rig.runScheduled();

  assert.notEqual(player.play("idle"), false);
  assert.equal(player.actionName, "idle");
});

test("ignores a callback retained by a cancelled action", () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  let now = 0;
  const callbacks = [];
  const scheduler = {
    request(callback) {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancel() {}
  };
  const player = new AnimationPlayer(makeManifest(), { clock: () => now, scheduler });

  player.play("locked");
  const staleCallback = callbacks[0];
  player.play("idle", { force: true });
  now = 200;
  staleCallback();

  assert.equal(player.actionName, "idle");
  assert.equal(player.currentFrameIndex, 0);
});
