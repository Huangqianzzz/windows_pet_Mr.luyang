const { ObstacleIndex } = require("../src/runtime/obstacle-index");
const { readDesktopIconRects, getDesktopIconDiagnostic } = require("../src/windows/desktop-icons");
const { readScreenBounds, readTaskbarRects } = require("../src/windows/taskbar");
const { createWindowSensor } = require("../src/windows/window-sensor");

async function main() {
  const sensor = createWindowSensor({ onChange() {} });
  sensor.start();
  const windows = sensor.snapshot();
  if (!sensor.stop()) throw new Error("window-hook-cleanup-failed");
  const screen = readScreenBounds();
  const taskbars = readTaskbarRects();
  const desktopIcons = await readDesktopIconRects();

  const index = new ObstacleIndex();
  index.replace("screen", screen ? [screen] : []);
  index.replace("taskbars", taskbars);
  index.replace("windows", windows);
  index.replace("desktop-icons", desktopIcons);

  const complete = Boolean(screen && taskbars.length > 0 && windows.length > 0);
  const summary = {
    status: complete ? "ok" : "incomplete",
    screenBounds: screen?.rect ?? null,
    taskbar: taskbars.map(item => item.rect),
    visibleTopLevelWindow: windows[0]?.rect ?? null,
    counts: {
      windows: windows.length,
      taskbars: taskbars.length,
      desktopIcons: desktopIcons.length,
      obstacles: index.snapshot().length
    },
    desktopIconDiagnostic: getDesktopIconDiagnostic()
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!complete) process.exitCode = 1;
}

main().catch(() => {
  process.stdout.write(`${JSON.stringify({ status: "probe-failed" })}\n`);
  process.exitCode = 1;
});
