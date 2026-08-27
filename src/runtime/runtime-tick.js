function runRuntimeTick({ controller, roam, settings, screen, dtMs }) {
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
    if (result.blocked) {
      const direction = roam.blocked();
      if (direction) controller.setCrawlDirection(direction);
    }
  }
  return intent;
}

module.exports = { runRuntimeTick };
