const { test } = require("node:test");
const assert = require("node:assert/strict");

test("pause coordinator freezes and resumes only at empty-set transitions", () => {
  const { createPauseCoordinator } = require("../src/runtime/pause-coordinator");
  const calls = [];
  const pauses = createPauseCoordinator({
    freeze: () => calls.push("freeze"),
    resume: () => calls.push("resume")
  });

  assert.equal(pauses.set("rest", true), true);
  assert.equal(pauses.set("background", true), true);
  assert.equal(pauses.set("background", false), true);
  assert.deepEqual(calls, ["freeze"]);
  assert.deepEqual(pauses.snapshot(), { paused: true, reasons: ["rest"] });

  assert.equal(pauses.set("rest", false), true);
  assert.deepEqual(calls, ["freeze", "resume"]);
  assert.deepEqual(pauses.snapshot(), { paused: false, reasons: [] });
});

test("pause coordinator ignores duplicate states and unknown reasons", () => {
  const { createPauseCoordinator } = require("../src/runtime/pause-coordinator");
  const calls = [];
  const pauses = createPauseCoordinator({
    freeze: () => calls.push("freeze"),
    resume: () => calls.push("resume")
  });

  assert.equal(pauses.set("background", true), true);
  assert.equal(pauses.set("background", true), false);
  assert.equal(pauses.set("speech", true), false);
  assert.equal(pauses.set("rest", false), false);
  assert.equal(pauses.set("background", false), true);
  assert.equal(pauses.set("background", false), false);
  assert.deepEqual(calls, ["freeze", "resume"]);
});
