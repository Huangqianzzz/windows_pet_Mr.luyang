const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canInterrupt, initialState, reducePetState } = require("../src/domain/pet-state");

test("initialState creates a frozen idle state", () => {
  const state = initialState();

  assert.deepEqual(state, { mode: "idle" });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.getPrototypeOf(state), Object.prototype);
});

test("reducePetState maps each known event to its mode", () => {
  const cases = [
    ["CRAWL", "crawling"],
    ["RANDOM_ROAM", "crawling"],
    ["DRAG_START", "dragging"],
    ["ATTACH", "attached"],
    ["FALL", "falling"],
    ["SUPPORT_LOST", "falling"],
    ["SPEAK", "speaking"],
    ["REST", "resting"],
    ["DUEL_START", "dueling"]
  ];

  for (const [type, mode] of cases) {
    assert.equal(reducePetState(initialState(), { type }).mode, mode);
  }
});

test("support loss overrides rest while random behavior does not", () => {
  const resting = reducePetState(initialState(), { type: "REST" });

  assert.equal(reducePetState(resting, { type: "RANDOM_ROAM" }).mode, "resting");
  assert.equal(reducePetState(resting, { type: "DRAG_START" }).mode, "resting");
  assert.equal(reducePetState(resting, { type: "SUPPORT_LOST" }).mode, "falling");
  assert.equal(reducePetState(resting, { type: "RESUME", resumeState: { mode: "attached" } }).mode, "attached");
});

test("canInterrupt requires a strictly higher-priority target mode", () => {
  const attached = reducePetState(initialState(), { type: "ATTACH" });

  assert.equal(canInterrupt(attached, "SPEAK"), true);
  assert.equal(canInterrupt(attached, "ATTACH"), false);
  assert.equal(canInterrupt(attached, "CRAWL"), false);
  assert.equal(canInterrupt(attached, "UNKNOWN"), false);
});

test("reducePetState returns the original state for unknown and non-interrupting events", () => {
  const resting = reducePetState(initialState(), { type: "REST" });

  assert.equal(reducePetState(resting, { type: "RANDOM_ROAM" }), resting);
  assert.equal(reducePetState(resting, { type: "UNKNOWN" }), resting);
});

test("reducePetState creates a frozen plain object when an event interrupts", () => {
  const next = reducePetState(initialState(), { type: "SPEAK" });

  assert.deepEqual(next, { mode: "speaking" });
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
});

test("drag release has explicit attached and open-area lifecycle exits", () => {
  const dragging = reducePetState(initialState(), { type: "DRAG_START" });

  assert.equal(reducePetState(dragging, { type: "DRAG_END_ATTACH" }).mode, "attached");
  assert.equal(reducePetState(dragging, { type: "DRAG_END_OPEN", pose: "crawl" }).mode, "crawling");
  assert.equal(reducePetState(dragging, { type: "DRAG_END_OPEN", pose: "land" }).mode, "landing");
});

test("landing and action completion are explicit lifecycle transitions", () => {
  const falling = reducePetState(initialState(), { type: "FALL" });
  const landing = reducePetState(falling, { type: "LAND" });

  assert.equal(landing.mode, "landing");
  assert.equal(reducePetState(landing, { type: "ACTION_COMPLETE" }).mode, "idle");
  assert.equal(reducePetState(falling, { type: "ACTION_COMPLETE" }), falling);
});

test("support loss remains an explicit high-priority exit from attachment", () => {
  const attached = reducePetState(initialState(), { type: "ATTACH" });

  assert.equal(reducePetState(attached, { type: "SUPPORT_LOST" }).mode, "falling");
});

test("autonomous crawl completes explicitly back to idle", () => {
  const crawling = reducePetState(initialState(), { type: "CRAWL" });
  assert.equal(crawling.mode, "crawling");
  assert.deepEqual(reducePetState(crawling, { type: "CRAWL_COMPLETE" }), { mode: "idle" });
});
