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
