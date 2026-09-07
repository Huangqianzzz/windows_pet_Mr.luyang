function isFullyMoved(result) {
  if (result.fullyMoved !== undefined) return result.fullyMoved === true;
  return result.moved === true && result.blocked !== true;
}

function blockedHorizontally(result) {
  if (Array.isArray(result.blockedAxes)) return result.blockedAxes.includes("x");
  return result.blocked === true;
}

function runRuntimeTick({ controller, roam, settings, screen, dtMs, nowMs }) {
  controller.tick(dtMs);
  const snapshot = controller.snapshot();
  if (snapshot.state.mode === "behind-window") {
    controller.advanceBehindWindowEscape(dtMs);
    return { kind: "behind-window" };
  }
  if (snapshot.state.mode === "attached" && settings.autonomousActivity !== false
    && typeof controller.isAutoClimbing === "function" && controller.isAutoClimbing()) {
    const workArea = screen.getDisplayMatching(snapshot.body).workArea;
    const result = controller.advanceAutoClimb(dtMs, workArea);
    if (result.atEdge || result.stalled) {
      const plan = result.target ? controller.planBehindWindowEscape(result.target) : null;
      if (!plan || !controller.beginBehindWindowEscape(plan)) controller.supportLost();
    }
    return { kind: "auto-climb" };
  }
  const intent = roam.tick(dtMs, {
    enabled: settings.autonomousActivity,
    mode: snapshot.state.mode
  });

  if (intent.kind === "start") controller.startCrawl(intent.direction);
  else if (intent.kind === "stop") controller.stopCrawl();
  else if (intent.kind === "move") {
    const workArea = screen.getDisplayMatching(snapshot.body).workArea;
    const result = controller.moveCrawl(intent.dx, intent.dy, workArea, { dtMs, nowMs });
    if (isFullyMoved(result)) roam.cleared();
    else if (blockedHorizontally(result)) {
      const direction = roam.blocked(nowMs);
      if (direction) controller.setCrawlDirection(direction);
    }
    if (result.climbCandidate) controller.beginAutoClimb(result.climbCandidate);
  }
  return intent;
}

module.exports = { runRuntimeTick };
