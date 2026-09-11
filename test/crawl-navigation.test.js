const { test } = require("node:test");
const assert = require("node:assert/strict");
const { intersects } = require("../src/domain/geometry");
const { resolveCrawlStep, planBehindWindowEscape } = require("../src/runtime/crawl-navigation");

function rect(x, y, width = 10, height = 10) {
  return { x, y, width, height };
}

function obstacle(id, source, obstacleRect, hwnd) {
  return hwnd === undefined
    ? { id, source, rect: obstacleRect }
    : { id, source, hwnd, rect: obstacleRect };
}

const workArea = rect(0, 0, 200, 200);

test("moves an unobstructed diagonal vector completely", () => {
  const body = rect(20, 30);
  const result = resolveCrawlStep({ body, dx: 12, dy: -8, workArea, obstacles: [] });

  assert.deepEqual(result.body, rect(32, 22));
  assert.equal(result.moved, true);
  assert.equal(result.fullyMoved, true);
  assert.deepEqual(result.blockedAxes, []);
  assert.equal(result.contactCandidate, null);
  assert.equal(Object.isFrozen(result.body), true);
  assert.equal(Object.isFrozen(result.blockedAxes), true);
  assert.deepEqual(body, rect(20, 30));
});

test("falls back to the larger legal axis with a deterministic x tie break", () => {
  const corner = obstacle("window:corner", "window", rect(15, 15, 20, 20), 11);
  const result = resolveCrawlStep({ body: rect(0, 0), dx: 12, dy: 8, workArea, obstacles: [corner] });
  assert.deepEqual(result.body, rect(12, 0));
  assert.equal(result.moved, true);
  assert.equal(result.fullyMoved, false);
  assert.deepEqual(result.blockedAxes, ["y"]);

  const tie = resolveCrawlStep({ body: rect(0, 0), dx: 10, dy: 10, workArea, obstacles: [corner] });
  assert.deepEqual(tie.body, rect(10, 0));
  assert.deepEqual(tie.blockedAxes, ["y"]);

  const mirrored = resolveCrawlStep({
    body: rect(40, 0), dx: -8, dy: 12, workArea,
    obstacles: [obstacle("window:mirror", "window", rect(15, 15, 20, 20), 12)]
  });
  assert.deepEqual(mirrored.body, rect(40, 12));
  assert.deepEqual(mirrored.blockedAxes, ["x"]);
});

test("reports both requested axes when no continuous step is legal", () => {
  const result = resolveCrawlStep({
    body: rect(0, 0), dx: 10, dy: 10, workArea,
    obstacles: [
      obstacle("window:right", "window", rect(15, 0, 20, 30), 1),
      obstacle("window:down", "window", rect(0, 15, 30, 20), 2)
    ]
  });

  assert.deepEqual(result.body, rect(0, 0));
  assert.equal(result.moved, false);
  assert.equal(result.fullyMoved, false);
  assert.deepEqual(result.blockedAxes, ["x", "y"]);
});

test("does not tunnel through a one DIP window", () => {
  const thinWindow = obstacle("window:thin", "window", rect(50, 0, 1, 100), 7);
  const result = resolveCrawlStep({
    body: rect(0, 20), dx: 100, dy: 0, workArea, obstacles: [thinWindow]
  });

  assert.deepEqual(result.body, rect(0, 20));
  assert.equal(result.fullyMoved, false);
  assert.deepEqual(result.blockedAxes, ["x"]);
  assert.ok(result.body.x + result.body.width <= thinWindow.rect.x);
});

test("only permits a pre-overlapped body to reduce overlap", () => {
  const blockingWindow = obstacle("window:overlap", "window", rect(10, 0, 20, 20), 9);
  const body = rect(5, 0);

  const leaving = resolveCrawlStep({ body, dx: -5, dy: 0, workArea, obstacles: [blockingWindow] });
  assert.deepEqual(leaving.body, rect(0, 0));
  assert.equal(leaving.fullyMoved, true);

  const deeper = resolveCrawlStep({ body, dx: 5, dy: 0, workArea, obstacles: [blockingWindow] });
  assert.deepEqual(deeper.body, body);
  assert.deepEqual(deeper.blockedAxes, ["x"]);

  const across = resolveCrawlStep({ body, dx: 30, dy: 0, workArea, obstacles: [blockingWindow] });
  assert.deepEqual(across.body, body);
  assert.deepEqual(across.blockedAxes, ["x"]);
});

test("rejects a diagonal escape that initially increases overlap", () => {
  const body = rect(65, 65, 50, 50);
  const blocker = obstacle("window:overlap", "window", rect(100, 100, 100, 100), 10);
  const result = resolveCrawlStep({ body, dx: -10, dy: 20, workArea, obstacles: [blocker] });

  assert.equal(result.fullyMoved, false);
  assert.deepEqual(result.body, rect(55, 65, 50, 50));
});

test("clamps one work-area axis without losing the legal other axis", () => {
  const result = resolveCrawlStep({ body: rect(85, 20), dx: 10, dy: 10, workArea: rect(0, 0, 100, 100), obstacles: [] });

  assert.deepEqual(result.body, rect(90, 30));
  assert.equal(result.moved, true);
  assert.equal(result.fullyMoved, false);
  assert.deepEqual(result.blockedAxes, ["x"]);
});

test("returns only the currently contacted window edge candidate", () => {
  const target = obstacle("window:contact", "window", rect(15, 0, 100, 100), 42);
  const result = resolveCrawlStep({ body: rect(0, 30), dx: 10, dy: 0, workArea, obstacles: [target] });

  assert.deepEqual(result.blockedAxes, ["x"]);
  assert.deepEqual(result.contactCandidate, {
    target,
    edge: "left",
    t: 0.35
  });
  assert.equal(Object.isFrozen(result.contactCandidate), true);
  assert.equal(Object.isFrozen(result.contactCandidate.target), true);
});

test("never promotes taskbar or desktop icon to a climb target", () => {
  for (const source of ["taskbar", "desktop-icon"]) {
    const result = resolveCrawlStep({
      body: rect(0, 30), dx: 10, dy: 0, workArea,
      obstacles: [
        obstacle(`${source}:blocker`, source, rect(15, 0, 100, 100)),
        obstacle("window:far", "window", rect(100, 0, 20, 100), 99)
      ]
    });
    assert.deepEqual(result.blockedAxes, ["x"]);
    assert.equal(result.contactCandidate, null);
  }
});

test("uses a stable candidate tie break", () => {
  const obstacles = [
    obstacle("window:beta", "window", rect(15, 20, 40, 40), 2),
    obstacle("window:alpha", "window", rect(15, 20, 40, 40), 1)
  ];
  const first = resolveCrawlStep({ body: rect(0, 30), dx: 10, dy: 0, workArea, obstacles });
  const second = resolveCrawlStep({ body: rect(0, 30), dx: 10, dy: 0, workArea, obstacles: obstacles.slice().reverse() });

  assert.equal(first.contactCandidate.target.id, "window:alpha");
  assert.deepEqual(second.contactCandidate, first.contactCandidate);
});

test("plans a behind-window route from the current point to a clear external edge", () => {
  const target = obstacle("window:target", "window", rect(100, 100, 50, 50), 123);
  const body = rect(110, 110);
  const plan = planBehindWindowEscape({ body, target, obstacles: [target], clearance: 5 });

  assert.deepEqual(plan.points[0], { x: 110, y: 110 });
  assert.ok(plan.points.length <= 3);
  assert.equal(plan.exitEdge, "left");
  assert.equal(intersects({ ...plan.points.at(-1), width: body.width, height: body.height }, target.rect), false);
  assert.deepEqual(plan.target, target);
  assert.equal(Object.isFrozen(plan), true);
});

test("keeps a behind-window escape endpoint inside the work area", () => {
  const target = obstacle("window:target", "window", rect(0, 100, 200, 100), 123);
  const body = rect(50, 180);
  const plan = planBehindWindowEscape({
    body, target, obstacles: [target], clearance: 5, workArea
  });

  assert.notEqual(plan.exitEdge, "bottom");
  for (const point of plan.points) {
    assert.ok(point.x >= workArea.x && point.y >= workArea.y);
    assert.ok(point.x + body.width <= workArea.x + workArea.width);
    assert.ok(point.y + body.height <= workArea.y + workArea.height);
  }
});

test("refuses a behind-window route when all exits are blocked or target identity is stale", () => {
  const target = obstacle("window:target", "window", rect(100, 100, 50, 50), 123);
  const body = rect(110, 110);
  const blocked = [
    target,
    obstacle("window:left", "window", rect(70, 0, 30, 200), 1),
    obstacle("window:right", "window", rect(150, 0, 30, 200), 2),
    obstacle("window:top", "window", rect(0, 70, 200, 30), 3),
    obstacle("window:bottom", "window", rect(0, 150, 200, 30), 4)
  ];
  assert.equal(planBehindWindowEscape({ body, target, obstacles: blocked, clearance: 5 }), null);
  assert.equal(planBehindWindowEscape({ body, target, obstacles: [], clearance: 5 }), null);
  assert.equal(planBehindWindowEscape({
    body,
    target: { ...target, hwnd: 999 },
    obstacles: [target],
    clearance: 5
  }), null);
});

test("does not promote a distant window when taskbar or desktop icon is the first horizontal contact", () => {
  for (const source of ["taskbar", "desktop-icon"]) {
    const result = resolveCrawlStep({
      body: rect(0, 30), dx: 120, dy: 0, workArea,
      obstacles: [
        obstacle(`${source}:near`, source, rect(15, 0, 10, 100)),
        obstacle("window:far", "window", rect(100, 0, 20, 100), 71)
      ]
    });
    assert.equal(result.contactCandidate, null, source);
  }
});

test("never proposes a climb candidate outside the work area when pinned against its edge", () => {
  const body = rect(190, 10);
  const result = resolveCrawlStep({
    body, dx: 10, dy: 0, workArea,
    obstacles: [
      obstacle("window:overlap", "window", rect(192, 0, 50, 50), 81),
      obstacle("window:outside", "window", rect(205, 0, 30, 100), 82)
    ]
  });

  assert.equal(result.contactCandidate, null);
  assert.equal(result.moved, false);
});

test("rejects an initially overlapping path that would exit and cross the expanded obstacle", () => {
  const target = obstacle("window:target", "window", rect(0, 0, 100, 100), 72);
  const body = rect(-9, -9);
  const result = resolveCrawlStep({ body, dx: 118, dy: -1, workArea: rect(-100, -100, 400, 400), obstacles: [target] });

  assert.equal(result.fullyMoved, false);
  assert.equal(result.body.x, body.x);
  assert.equal(result.body.y, -10);
  assert.deepEqual(result.blockedAxes, ["x"]);
  assert.equal(intersects(result.body, target.rect), false);
});

test("fails fast for malformed navigation geometry while permitting negative coordinates", () => {
  const negative = resolveCrawlStep({
    body: rect(-30, -40), dx: 5, dy: 6, workArea: rect(-100, -100, 200, 200), obstacles: []
  });
  assert.deepEqual(negative.body, rect(-25, -34));

  const valid = { body: rect(0, 0), dx: 1, dy: 1, workArea, obstacles: [] };
  assert.throws(() => resolveCrawlStep({ ...valid, body: rect(0, 0, 0, 10) }), /positive/);
  assert.throws(() => resolveCrawlStep({ ...valid, workArea: rect(0, 0, 0, 10) }), /positive/);
  assert.throws(() => resolveCrawlStep({ ...valid, body: { ...valid.body, x: Number.NaN } }), /finite/);
  assert.throws(() => resolveCrawlStep({ ...valid, dx: Number.NaN }), /finite/);
  assert.throws(() => resolveCrawlStep({ ...valid, obstacles: {} }), /array/);
  assert.throws(() => resolveCrawlStep({ ...valid, obstacles: [obstacle("window:bad", "window", rect(0, 0, -1, 10), 1)] }), /positive/);
  assert.throws(() => resolveCrawlStep({ ...valid, body: rect(0, 0, 201, 10) }), /fit/);

  const target = obstacle("window:target", "window", rect(0, 0, 20, 20), 73);
  assert.throws(() => planBehindWindowEscape({
    body: rect(1, 1), target: { ...target, rect: rect(0, 0, 0, 20) }, obstacles: [target], clearance: 1
  }), /positive/);
  assert.throws(() => planBehindWindowEscape({
    body: rect(1, 1), target, obstacles: [target], clearance: Number.NaN
  }), /finite/);
});
