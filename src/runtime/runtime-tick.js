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
  const intent = roam.tick(dtMs, {
    enabled: settings.autonomousActivity,
    mode: snapshot.state.mode
  });

  if (intent.kind === "start") controller.startCrawl(intent.direction);
  else if (intent.kind === "stop") controller.stopCrawl();
  else if (intent.kind === "move") {
    const workArea = screen.getDisplayMatching(snapshot.body).workArea;
    const result = controller.moveCrawl(intent.dx, intent.dy, workArea);
    if (isFullyMoved(result)) roam.cleared();
    else if (blockedHorizontally(result)) {
      const direction = roam.blocked(nowMs);
      if (direction) controller.setCrawlDirection(direction);
    }
  }
  return intent;
}

module.exports = { runRuntimeTick };
