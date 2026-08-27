const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ObstacleIndex } = require("../src/runtime/obstacle-index");
const { PetController, validatePetAction } = require("../src/runtime/pet-controller");

function obstacle(id, rect, source = "window") {
  return { source, id, rect };
}

function createHarness(overrides = {}) {
  const obstacleIndex = overrides.obstacleIndex || new ObstacleIndex();
  const renderBounds = [];
  const hitEvents = [];
  const played = [];
  const animationBridge = overrides.animationBridge || {
    play(action, options) {
      played.push({ action, options });
      return true;
    }
  };
  const controller = new PetController({
    obstacleIndex,
    animationBridge,
    body: { x: 0, y: 0, width: 20, height: 30, vx: 0, vy: 0 },
    renderWindow: {
      setBounds(bounds) { renderBounds.push(bounds); }
    },
    hitWindow: {
      hide() { hitEvents.push({ type: "hide" }); },
      setBounds(bounds) { hitEvents.push({ type: "bounds", bounds }); },
      showInactive() { hitEvents.push({ type: "show" }); }
    },
    choosePose: overrides.choosePose || (choices => choices[0]),
    poseAnchors: overrides.poseAnchors,
    gravity: overrides.gravity ?? 1000,
    releaseThreshold: 12
  });
  return { animationBridge, controller, hitEvents, obstacleIndex, played, renderBounds };
}

function attachToTop(harness, target) {
  harness.obstacleIndex.replace("windows", [target]);
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-move", { x: 200, y: 101 });
  return harness.controller.handleInput("drag-end", { x: 200, y: 101 });
}

test("drag release attaches with an injected pose and follows target move and resize", () => {
  const harness = createHarness({ choosePose: choices => choices[0] });
  const target = obstacle("window:42", { x: 100, y: 100, width: 400, height: 300 });

  const release = attachToTop(harness, target);

  assert.deepEqual(release, { accepted: true, zone: "top", pose: "sit" });
  assert.equal(harness.controller.snapshot().state.mode, "attached");
  assert.equal(harness.controller.snapshot().attachment.target.id, "window:42");
  assert.equal(harness.controller.snapshot().attachment.t, 0.25);
  assert.deepEqual(harness.renderBounds.at(-1), { x: 200, y: 100, width: 20, height: 30 });

  harness.obstacleIndex.replace("windows", [
    obstacle("window:42", { x: 200, y: 80, width: 800, height: 500 })
  ]);
  assert.equal(harness.controller.syncObstacles(), true);

  assert.deepEqual(harness.renderBounds.at(-1), { x: 400, y: 80, width: 20, height: 30 });
  assert.deepEqual(harness.controller.snapshot().attachment.lastRect,
    { x: 200, y: 80, width: 800, height: 500 });
});

test("attachment support anchors place top, side, and bottom poses on the window edge", () => {
  const target = obstacle("window:anchor", { x: 100, y: 100, width: 400, height: 300 });
  const poseAnchors = {
    sit: { x: 10, y: 20 },
    "wall-climb": { x: 18, y: 15 },
    hang: { x: 10, y: 2 }
  };

  const top = createHarness({ poseAnchors });
  top.obstacleIndex.replace("windows", [target]);
  top.controller.handleInput("drag-start", { x: 0, y: 0 });
  top.controller.handleInput("drag-end", { x: 200, y: 101 });
  assert.deepEqual(top.renderBounds.at(-1), { x: 190, y: 80, width: 20, height: 30 });

  const right = createHarness({ poseAnchors });
  right.obstacleIndex.replace("windows", [target]);
  right.controller.handleInput("drag-start", { x: 0, y: 0 });
  const sideRelease = right.controller.handleInput("drag-end", { x: 501, y: 200 });
  assert.equal(sideRelease.pose, "wall-climb");
  assert.deepEqual(right.renderBounds.at(-1), { x: 498, y: 185, width: 20, height: 30 });
  assert.equal(right.played.at(-1).options.facing, "left");

  const bottom = createHarness({ poseAnchors });
  bottom.obstacleIndex.replace("windows", [target]);
  bottom.controller.handleInput("drag-start", { x: 0, y: 0 });
  const bottomRelease = bottom.controller.handleInput("drag-end", { x: 200, y: 399 });
  assert.equal(bottomRelease.pose, "hang");
  assert.deepEqual(bottom.renderBounds.at(-1), { x: 190, y: 398, width: 20, height: 30 });
});

test("resizing an attached pose keeps its support anchor fixed to the window edge", () => {
  const harness = createHarness({ poseAnchors: { sit: { x: 10, y: 20 } } });
  harness.obstacleIndex.replace("windows", [
    obstacle("window:scale-anchor", { x: 100, y: 100, width: 400, height: 300 })
  ]);
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 200, y: 101 });

  assert.equal(harness.controller.setScale(2), true);
  assert.deepEqual(harness.renderBounds.at(-1), { x: 180, y: 60, width: 40, height: 60 });
});

test("every wall-climb frame support anchor stays fixed to either window side at every scale", () => {
  const anchors = [
    { x: 69, y: 8 },
    { x: 96, y: 80 },
    { x: 121, y: 8 }
  ];
  for (const { releaseX, facing } of [
    { releaseX: 99, facing: "right" },
    { releaseX: 501, facing: "left" }
  ]) {
    for (const scale of [1, 1.5, 2]) {
      const harness = createHarness({ poseAnchors: { "wall-climb": anchors[0] } });
      const target = obstacle("window:wall", { x: 100, y: 100, width: 400, height: 300 });
      harness.obstacleIndex.replace("windows", [target]);
      harness.controller.handleInput("drag-start", { x: 0, y: 0 });
      harness.controller.handleInput("drag-end", { x: releaseX, y: 200 });
      harness.controller.setScale(scale);

      for (const anchor of anchors) {
        assert.equal(harness.controller.setFrameSupportAnchor("wall-climb", anchor), true);
        const body = harness.controller.snapshot().body;
        const renderedAnchorX = facing === "left"
          ? body.x + body.width - anchor.x * scale
          : body.x + anchor.x * scale;
        assert.equal(renderedAnchorX, releaseX < 100 ? 100 : 500);
        assert.equal(body.y + anchor.y * scale, 200);
      }
    }
  }
});

test("a minimized or closed target disappears and starts falling without stale hit input", () => {
  for (const reason of ["minimized", "closed"]) {
    const harness = createHarness();
    attachToTop(harness, obstacle(`window:${reason}`, { x: 100, y: 100, width: 400, height: 300 }));
    harness.controller.setFrameHitBox({ x: 2, y: 3, width: 10, height: 12 });
    const hideCount = harness.hitEvents.filter(event => event.type === "hide").length;

    harness.obstacleIndex.replace("windows", []);
    assert.equal(harness.controller.syncObstacles(), false, reason);

    const snapshot = harness.controller.snapshot();
    assert.equal(snapshot.state.mode, "falling", reason);
    assert.equal(snapshot.attachment, null, reason);
    assert.ok(harness.hitEvents.filter(event => event.type === "hide").length > hideCount, reason);
  }
});

test("same source and id with a different hwnd is treated as lost support", () => {
  const harness = createHarness();
  const target = {
    ...obstacle("window:reused", { x: 100, y: 100, width: 400, height: 300 }),
    hwnd: 42
  };
  attachToTop(harness, target);
  harness.controller.setFrameHitBox({ x: 2, y: 3, width: 10, height: 12 });

  harness.obstacleIndex.replace("windows", [{
    ...obstacle("window:reused", { x: 200, y: 80, width: 800, height: 500 }),
    hwnd: 43
  }]);

  assert.equal(harness.controller.syncObstacles(), false);
  assert.equal(harness.controller.snapshot().state.mode, "falling");
  assert.equal(harness.controller.snapshot().attachment, null);
  assert.equal(harness.hitEvents.at(-1).type, "hide");
});

test("an attachment without hwnd follows by source and id", () => {
  const harness = createHarness();
  attachToTop(harness, obstacle("window:no-hwnd", { x: 100, y: 100, width: 400, height: 300 }));

  harness.obstacleIndex.replace("windows", [
    obstacle("window:no-hwnd", { x: 200, y: 80, width: 800, height: 500 })
  ]);

  assert.equal(harness.controller.syncObstacles(), true);
  assert.equal(harness.controller.snapshot().state.mode, "attached");
  assert.deepEqual(harness.renderBounds.at(-1), { x: 400, y: 80, width: 20, height: 30 });
});

test("support loss interrupts rest and landing completes through explicit lifecycle events", () => {
  const harness = createHarness();
  const target = obstacle("window:rest", { x: 0, y: 20, width: 100, height: 20 });
  const floor = obstacle("taskbar:primary", { x: 0, y: 50, width: 200, height: 20 }, "taskbar");
  harness.obstacleIndex.replace("windows", [target]);
  harness.obstacleIndex.replace("taskbars", [floor]);
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 10, y: 20 });
  assert.equal(harness.controller.rest(), true);
  assert.equal(harness.controller.snapshot().state.mode, "resting");
  assert.deepEqual(harness.controller.handleInput("drag-start", { x: 0, y: 0 }), { accepted: false });

  harness.obstacleIndex.replace("windows", []);
  harness.controller.syncObstacles();
  assert.equal(harness.controller.snapshot().state.mode, "falling");

  const result = harness.controller.tick(200);
  assert.deepEqual(result.landing, floor);
  assert.equal(harness.controller.snapshot().state.mode, "landing");
  assert.equal(harness.played.at(-1).action, "land");

  harness.played.at(-1).options.onComplete();
  assert.equal(harness.controller.snapshot().state.mode, "idle");
});

test("explicit resume restores the safe state captured before exact-frame rest", () => {
  const harness = createHarness();
  const target = obstacle("window:resume", { x: 0, y: 20, width: 100, height: 20 });
  harness.obstacleIndex.replace("windows", [target]);
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 10, y: 20 });

  assert.equal(harness.controller.rest(), true);
  assert.equal(harness.controller.snapshot().state.mode, "resting");
  assert.equal(harness.controller.resume(), true);
  assert.equal(harness.controller.snapshot().state.mode, "attached");
  assert.equal(harness.controller.resume(), false);
});

test("speech has an explicit safe recovery state and support loss overrides it", () => {
  const harness = createHarness({ choosePose: choices => choices[0] });
  const target = obstacle("window:speech", { x: 0, y: 20, width: 100, height: 20 });
  harness.obstacleIndex.replace("windows", [target]);
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 10, y: 20 });

  assert.equal(harness.controller.beginSpeech(), true);
  assert.equal(harness.controller.snapshot().state.mode, "speaking");
  assert.equal(harness.controller.finishSpeech(), "sit");
  assert.equal(harness.controller.snapshot().state.mode, "attached");

  assert.equal(harness.controller.beginSpeech(), true);
  harness.obstacleIndex.replace("windows", []);
  harness.controller.syncObstacles();
  assert.equal(harness.controller.snapshot().state.mode, "falling");
  assert.equal(harness.controller.finishSpeech(), false);
});

test("speech recovery returns crawl and restores crawling state deterministically", () => {
  const harness = createHarness({ choosePose: choices => choices.at(-1) });
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 300, y: 300 });
  assert.equal(harness.controller.snapshot().state.mode, "crawling");

  assert.equal(harness.controller.beginSpeech(), true);
  assert.equal(harness.controller.finishSpeech(), "crawl");
  assert.equal(harness.controller.snapshot().state.mode, "crawling");
});

test("attached and crawling speech flows recover controller state with the matching animation", async () => {
  const { createSpeechFlow } = require("../src/runtime/speech");
  const cases = [
    {
      expectedMode: "attached",
      expectedAction: "sit",
      prepare(harness) {
        attachToTop(harness, obstacle("window:flow", { x: 100, y: 100, width: 400, height: 300 }));
      }
    },
    {
      expectedMode: "crawling",
      expectedAction: "crawl",
      prepare(harness) {
        harness.controller.handleInput("drag-start", { x: 0, y: 0 });
        harness.controller.handleInput("drag-end", { x: 300, y: 300 });
      }
    }
  ];

  for (const scenario of cases) {
    const harness = createHarness({ choosePose: choices => choices.at(-1) });
    scenario.prepare(harness);
    const recovered = [];
    const flow = createSpeechFlow({
      beginSpeech: () => harness.controller.beginSpeech(),
      async playKneel() { return true; },
      async showBubble() { return true; },
      async speak() { return { spoken: true, voiceCulture: "zh-CN" }; },
      async pause() {},
      hideBubble() {},
      finishSpeech: () => harness.controller.finishSpeech(),
      async recover(action) { recovered.push(action); }
    });

    await flow.run("爸爸", 50);

    assert.equal(harness.controller.snapshot().state.mode, scenario.expectedMode);
    assert.deepEqual(recovered, [scenario.expectedAction]);
  }
});

test("applies a validated 100-200 percent size from immutable base dimensions", () => {
  const harness = createHarness();
  harness.controller.setFrameHitBox({ x: 2, y: 3, width: 8, height: 9 });

  assert.equal(harness.controller.setScale(1.5), true);
  assert.deepEqual(harness.hitEvents.slice(-2), [
    { type: "bounds", bounds: { x: 3, y: 5, width: 12, height: 14 } },
    { type: "show" }
  ]);
  assert.equal(harness.controller.setScale(2), true);
  assert.deepEqual(harness.controller.snapshot().body, {
    x: 0,
    y: 0,
    width: 40,
    height: 60,
    vx: 0,
    vy: 0
  });
  assert.equal(harness.controller.setScale(2.1), false);
  assert.deepEqual(harness.renderBounds.at(-1), { x: 0, y: 0, width: 40, height: 60 });

  assert.deepEqual(harness.hitEvents.slice(-2), [
    { type: "bounds", bounds: { x: 4, y: 6, width: 16, height: 18 } },
    { type: "show" }
  ]);
});

test("open-area release uses only the injected open pose and clears attachment", () => {
  const harness = createHarness({ choosePose: choices => choices.at(-1) });

  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  const result = harness.controller.handleInput("drag-end", { x: 300, y: 300 });

  assert.deepEqual(result, { accepted: true, zone: "open", pose: "crawl" });
  assert.equal(harness.controller.snapshot().state.mode, "crawling");
  assert.equal(harness.controller.snapshot().attachment, null);
});

test("open-area land is a forced safety lifecycle animation", () => {
  const harness = createHarness();

  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-end", { x: 300, y: 300 });

  assert.equal(harness.played.at(-1).action, "land");
  assert.equal(harness.played.at(-1).options.force, true);
});

test("hit input tracks only the current valid frame box and clears on every switch", () => {
  const harness = createHarness();
  harness.controller.handleInput("drag-start", { x: 0, y: 0 });
  harness.controller.handleInput("drag-move", { x: 100, y: 200 });

  assert.equal(harness.controller.setFrameHitBox({ x: 5, y: 6, width: 20, height: 30 }), true);
  assert.deepEqual(harness.hitEvents.slice(-3), [
    { type: "hide" },
    { type: "bounds", bounds: { x: 105, y: 206, width: 20, height: 30 } },
    { type: "show" }
  ]);

  assert.equal(harness.controller.setFrameHitBox({ x: 1, y: 2, width: 8, height: 9 }), true);
  assert.deepEqual(harness.hitEvents.slice(-3), [
    { type: "hide" },
    { type: "bounds", bounds: { x: 101, y: 202, width: 8, height: 9 } },
    { type: "show" }
  ]);

  const boundsCount = harness.hitEvents.filter(event => event.type === "bounds").length;
  assert.equal(harness.controller.setFrameHitBox({ x: 0, y: 0, width: 0, height: 10 }), false);
  assert.equal(harness.hitEvents.at(-1).type, "hide");
  assert.equal(harness.hitEvents.filter(event => event.type === "bounds").length, boundsCount);
});

test("falling suppresses even a newly supplied valid hit box", () => {
  const harness = createHarness();
  attachToTop(harness, obstacle("window:1", { x: 100, y: 100, width: 400, height: 300 }));
  harness.obstacleIndex.replace("windows", []);
  harness.controller.syncObstacles();
  const boundsCount = harness.hitEvents.filter(event => event.type === "bounds").length;

  assert.equal(harness.controller.setFrameHitBox({ x: 0, y: 0, width: 10, height: 10 }), false);
  assert.equal(harness.hitEvents.at(-1).type, "hide");
  assert.equal(harness.hitEvents.filter(event => event.type === "bounds").length, boundsCount);
});

test("input action validator accepts only exact drag actions and finite screen points", () => {
  assert.deepEqual(validatePetAction("drag-start", { x: 1.25, y: -20 }),
    { action: "drag-start", point: { x: 1.25, y: -20 } });
  assert.equal(validatePetAction("duel-start", { x: 0, y: 0 }), null);
  assert.equal(validatePetAction("drag-move", { x: Number.NaN, y: 0 }), null);
  assert.equal(validatePetAction("drag-end", { x: 0, y: 0, command: "quit" }), null);
});

test("autonomous crawl starts, moves inside the work area, blocks on obstacles, and stops", () => {
  const harness = createHarness();
  const workArea = { x: 0, y: 0, width: 100, height: 100 };

  assert.equal(harness.controller.startCrawl("left"), true);
  assert.equal(harness.controller.snapshot().state.mode, "crawling");
  assert.equal(harness.played.at(-1).action, "crawl");
  assert.equal(harness.played.at(-1).options.facing, "left");
  assert.equal(harness.controller.setCrawlDirection("right"), true);
  assert.equal(harness.played.at(-1).options.facing, "right");
  assert.equal(harness.controller.setCrawlDirection("up"), false);
  assert.deepEqual(harness.controller.moveCrawl(10, 5, workArea), { moved: true, blocked: false });
  assert.deepEqual(harness.controller.snapshot().body, {
    x: 10, y: 5, width: 20, height: 30, vx: 0, vy: 0
  });

  harness.obstacleIndex.replace("windows", [
    obstacle("window:block", { x: 35, y: 0, width: 20, height: 100 })
  ]);
  assert.deepEqual(harness.controller.moveCrawl(10, 0, workArea), { moved: false, blocked: true });
  assert.equal(harness.controller.snapshot().body.x, 10);

  harness.obstacleIndex.replace("windows", [
    obstacle("window:under-pet", { x: 0, y: 0, width: 30, height: 100 })
  ]);
  assert.deepEqual(harness.controller.moveCrawl(5, 0, workArea), { moved: true, blocked: false });
  assert.equal(harness.controller.snapshot().body.x, 15);

  harness.obstacleIndex.replace("windows", [
    obstacle("window:covers-pet", { x: 0, y: 0, width: 80, height: 100 })
  ]);
  for (let step = 0; step < 13; step += 1) {
    assert.deepEqual(harness.controller.moveCrawl(5, 0, workArea), { moved: true, blocked: false });
  }
  assert.equal(harness.controller.snapshot().body.x, 80);

  harness.obstacleIndex.replace("windows", []);
  assert.deepEqual(harness.controller.moveCrawl(-100, 0, workArea), { moved: true, blocked: true });
  assert.equal(harness.controller.snapshot().body.x, 0);
  assert.equal(harness.controller.stopCrawl(), true);
  assert.equal(harness.controller.snapshot().state.mode, "idle");
  assert.equal(harness.played.at(-1).action, "idle");
  assert.equal(harness.controller.startCrawl("up"), false);
});
