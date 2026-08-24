# Desktop Pet Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows 10/11 x64 human desktop-pet executable with transparent rendering, obstacle sensing, crawling/attachment/fall behavior, menu, pink speech bubble, Windows TTS, settings, and the authenticated duel-server boundary.

**Architecture:** Use Electron 41.10.4 so the new pet follows the proven transparent dual-window pattern already used by Clawd and builds with the installed Node 24 toolchain. Keep geometry, state, protocol, and placement logic as pure CommonJS modules tested with Node's built-in test runner; isolate Electron and Koffi calls behind adapters.

**Tech Stack:** Node.js 24, Electron 41.10.4, electron-builder 26.15.7, Koffi 2.16.3, ws 8.21.0, HTML/CSS/JavaScript, Node `node:test`.

## Global Constraints

- Target Windows 10/11 x64; runtime must not require a separately installed SDK or cloud service.
- Preserve the person's unretouched appearance; animation assets are supplied by the separate asset plan.
- Pink bubbles must never intersect per-frame face, glasses, or headphones metadata.
- Obstacles include visible app windows, taskbar, screen bounds, and desktop shortcut icons.
- Entertainment states never override dragging, falling, speech, or safety transitions.
- Duel transport binds only to `127.0.0.1` and authenticates every message with a per-user random token.
- Use TDD, focused CommonJS modules, Node's built-in test runner, and one reviewable commit per task.
- Do not add `.superpowers/` preview files to Git.

## Planned File Map

- `package.json`: scripts, pinned runtime dependencies, and x64 electron-builder settings.
- `src/main.js`: Electron composition root only.
- `src/preload.js`: narrow renderer bridge.
- `src/render/pet.html`, `src/render/pet.css`, `src/render/pet-renderer.js`: transparent visual surface.
- `src/render/hit.html`, `src/render/hit-renderer.js`: input-only hit window.
- `src/domain/geometry.js`: rectangles, contact points, edge zones, and clamping.
- `src/domain/pet-state.js`: pure state transition reducer.
- `src/domain/attachment.js`: attachment anchor creation and reflow.
- `src/domain/fall.js`: gravity integration and landing selection.
- `src/domain/bubble-placement.js`: face-safe bubble selection.
- `src/windows/window-sensor.js`: Win32/DWM window observation through Koffi.
- `src/windows/desktop-icons.js`: Explorer/UIA icon rectangle provider.
- `src/windows/taskbar.js`: taskbar and monitor work-area provider.
- `src/runtime/obstacle-index.js`: normalized obstacle snapshot owner.
- `src/runtime/animation-player.js`: manifest and sprite-sheet playback.
- `src/runtime/pet-controller.js`: behavior orchestration.
- `src/runtime/duel-server.js`, `src/runtime/duel-protocol.js`: authenticated loopback bridge.
- `src/runtime/speech.js`, `src/runtime/settings.js`, `src/runtime/autostart.js`: platform services.
- `assets/animations/manifest.json`: production animation contract.
- `test/*.test.js`: unit and contract tests.

---

### Task 1: Scaffold the Electron application and test runner

**Files:**
- Create: `package.json`
- Create: `src/main.js`
- Create: `src/preload.js`
- Create: `src/render/pet.html`
- Create: `src/render/pet.css`
- Create: `src/render/pet-renderer.js`
- Create: `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test`, `npm start`, and `npm run build:win:x64` commands.
- Produces: preload API `window.desktopPet.getBootstrap(): Promise<BootstrapPayload>`.

- [ ] **Step 1: Write the failing scaffold test**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../package.json");

test("pins the supported Windows runtime", () => {
  assert.equal(pkg.devDependencies.electron, "41.10.4");
  assert.equal(pkg.build.win.target[0].arch[0], "x64");
  assert.equal(pkg.main, "src/main.js");
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `node --test test/smoke.test.js`

Expected: FAIL with `Cannot find module '../package.json'`.

- [ ] **Step 3: Create the minimal package and secure Electron shell**

```json
{
  "name": "desktop-pet-suite",
  "version": "0.1.0",
  "private": true,
  "main": "src/main.js",
  "scripts": {
    "start": "electron .",
    "test": "node --test test/*.test.js",
    "build:win:x64": "electron-builder --win nsis:x64"
  },
  "devDependencies": {
    "electron": "41.10.4",
    "electron-builder": "26.15.7"
  },
  "dependencies": {
    "koffi": "2.16.3",
    "ws": "8.21.0"
  },
  "build": {
    "appId": "local.desktop.pet.suite",
    "productName": "Desktop Pet Suite",
    "win": {
      "artifactName": "Desktop-Pet-Suite-Setup-${version}-${arch}.${ext}",
      "target": [{ "target": "nsis", "arch": ["x64"] }]
    },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true },
    "files": ["src/**/*", "assets/**/*"]
  }
}
```

Create `src/main.js` with `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, a transparent frameless window, and no remote content. Expose only `getBootstrap`, `petAction`, and `openContextMenu` from `src/preload.js`.

- [ ] **Step 4: Install dependencies and run the scaffold tests**

Run: `npm install`

Run: `npm test`

Expected: PASS, one test.

- [ ] **Step 5: Launch the empty transparent shell**

Run: `npm start`

Expected: one transparent, taskbar-hidden, always-on-top window; DevTools stay closed; closing from Task Manager exits cleanly.

- [ ] **Step 6: Commit the scaffold**

```bash
git add package.json package-lock.json src test/smoke.test.js
git commit -m "feat: scaffold Windows desktop pet shell"
```

### Task 2: Implement pure geometry and state contracts

**Files:**
- Create: `src/domain/geometry.js`
- Create: `src/domain/pet-state.js`
- Test: `test/geometry.test.js`
- Test: `test/pet-state.test.js`

**Interfaces:**
- Produces: `intersects(a,b)`, `clampRect(rect,bounds)`, `nearestEdge(point,rect,threshold)`.
- Produces: `reducePetState(state,event): PetState` and `canInterrupt(state,eventType): boolean`.

- [ ] **Step 1: Write failing geometry tests**

```js
test("nearestEdge classifies top, side, bottom, and none", () => {
  const r = { x: 100, y: 100, width: 300, height: 200 };
  assert.deepEqual(nearestEdge({ x: 220, y: 104 }, r, 12), { edge: "top", t: 0.4 });
  assert.equal(nearestEdge({ x: 250, y: 180 }, r, 12), null);
});
```

- [ ] **Step 2: Write failing state-priority tests**

```js
test("support loss overrides rest while random behavior does not", () => {
  const resting = reducePetState(initialState(), { type: "REST" });
  assert.equal(reducePetState(resting, { type: "RANDOM_ROAM" }).mode, "resting");
  assert.equal(reducePetState(resting, { type: "SUPPORT_LOST" }).mode, "falling");
});
```

- [ ] **Step 3: Run both files and verify missing-module failures**

Run: `node --test test/geometry.test.js test/pet-state.test.js`

Expected: FAIL because both domain modules are absent.

- [ ] **Step 4: Implement minimal pure modules**

Use frozen plain objects. State modes are exactly `idle`, `crawling`, `dragging`, `attached`, `falling`, `speaking`, `resting`, and `dueling`. Enforce priority `falling > dragging > speaking > dueling > attached > resting > crawling > idle` for conflicting events.

- [ ] **Step 5: Run tests**

Run: `node --test test/geometry.test.js test/pet-state.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/geometry.js src/domain/pet-state.js test/geometry.test.js test/pet-state.test.js
git commit -m "feat: add pet geometry and state contracts"
```

### Task 3: Build the Windows obstacle snapshot adapters

**Files:**
- Create: `src/windows/window-sensor.js`
- Create: `src/windows/desktop-icons.js`
- Create: `src/windows/taskbar.js`
- Create: `src/runtime/obstacle-index.js`
- Create: `scripts/probe-obstacles.js`
- Test: `test/window-sensor.test.js`
- Test: `test/obstacle-index.test.js`

**Interfaces:**
- Produces: `createWindowSensor({ native, onChange }).start()/stop()/snapshot()`.
- Produces: `readDesktopIconRects(): Promise<Obstacle[]>`.
- Produces: `ObstacleIndex.replace(source, obstacles)` and `ObstacleIndex.snapshot()`.

- [ ] **Step 1: Write adapter contract tests with a fake native layer**

```js
test("filters invisible, cloaked, own, and zero-area windows", () => {
  const sensor = createWindowSensor({
    native: fakeNative([
      hwnd(1, { visible: true, rect: [10, 10, 210, 110] }),
      hwnd(2, { visible: false, rect: [0, 0, 10, 10] }),
      hwnd(3, { visible: true, cloaked: true, rect: [0, 0, 10, 10] })
    ]),
    ownProcessId: 99,
    onChange() {}
  });
  assert.deepEqual(sensor.snapshot().map(x => x.hwnd), [1]);
});
```

- [ ] **Step 2: Run the tests and verify missing-module failures**

Run: `node --test test/window-sensor.test.js test/obstacle-index.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement Win32/DWM enumeration behind injectable bindings**

Bind `EnumWindows`, `IsWindowVisible`, `GetWindowThreadProcessId`, `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`, `DwmGetWindowAttribute(DWMWA_CLOAKED)`, `SetWinEventHook`, and `UnhookWinEvent`. Never expose Koffi values outside this module; normalize to integer DIP-aware screen rectangles.

- [ ] **Step 4: Implement desktop icon and taskbar providers**

Resolve the Explorer desktop list view first; when unavailable, invoke the UI Automation fallback and return `{ source:"desktop-icon", id, rect }`. Fail closed by returning `[]` plus a diagnostic status, never guessed rectangles.

- [ ] **Step 5: Run unit tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Perform a read-only Windows smoke probe**

Run: `node scripts/probe-obstacles.js`

Expected: JSON containing at least the current taskbar, screen bounds, and one visible top-level window; no window titles or process arguments are persisted.

- [ ] **Step 7: Commit**

```bash
git add src/windows src/runtime/obstacle-index.js test scripts/probe-obstacles.js
git commit -m "feat: observe Windows desktop obstacles"
```

### Task 4: Add manifest-driven transparent animation playback

**Files:**
- Create: `src/runtime/animation-player.js`
- Create: `src/domain/animation-manifest.js`
- Create: `assets/animations/manifest.json`
- Modify: `src/render/pet-renderer.js`
- Modify: `src/render/pet.css`
- Test: `test/animation-manifest.test.js`
- Test: `test/animation-player.test.js`

**Interfaces:**
- Produces: `loadManifest(path): AnimationManifest`.
- Produces: `AnimationPlayer.play(action,{loop,onFrame,onComplete})`, `freeze()`, `resume()`.
- Consumes: sprite sheets and metadata created by the animation-assets plan.

- [ ] **Step 1: Write a failing manifest validation test**

```js
test("rejects a frame without face and hit metadata", () => {
  assert.throws(() => validateManifest({
    version: 1,
    actions: { idle: { fps: 30, frames: [{ x: 0, y: 0, w: 128, h: 128 }] } }
  }), /faceBox.*hitBox/);
});
```

- [ ] **Step 2: Define the manifest schema**

Each action declares `sheet`, `fps`, `loop`, `interruptible`, and frames containing `source`, `faceBox`, `hitBox`, `contacts`, and `supportAnchor`. Reject non-finite, negative, out-of-sheet, or missing values with the exact action and frame index.

- [ ] **Step 3: Implement playback with monotonic timestamps**

Use `performance.now()` and calculate the frame from elapsed time rather than incrementing counters, so a delayed render skips to the correct frame without slowing the action timeline. `freeze()` retains the exact current frame.

- [ ] **Step 4: Run tests**

Run: `node --test test/animation-manifest.test.js test/animation-player.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/animation-player.js src/domain/animation-manifest.js src/render assets/animations/manifest.json test
git commit -m "feat: play metadata-driven pet animations"
```

### Task 5: Implement drag, attachment, window following, and fall physics

**Files:**
- Create: `src/domain/attachment.js`
- Create: `src/domain/fall.js`
- Create: `src/runtime/pet-controller.js`
- Create: `src/render/hit.html`
- Create: `src/render/hit-renderer.js`
- Modify: `src/main.js`
- Test: `test/attachment.test.js`
- Test: `test/fall.test.js`
- Test: `test/pet-controller.test.js`

**Interfaces:**
- Produces: `createAttachment(targetRect, edge, t, pose)` and `resolveAttachment(anchor,nextRect)`.
- Produces: `stepFall(body, obstacles, dtMs): { body, landing }`.
- Consumes: `ObstacleIndex`, `AnimationPlayer`, and pure state reducer.

- [ ] **Step 1: Write edge-anchor reflow tests**

```js
test("keeps normalized top-edge position after resize", () => {
  const a = createAttachment({ x: 100, y: 100, width: 400, height: 300 }, "top", 0.25, "sit");
  assert.deepEqual(resolveAttachment(a, { x: 200, y: 80, width: 800, height: 500 }).point,
    { x: 400, y: 80 });
});
```

- [ ] **Step 2: Write deterministic fall tests**

Inject gravity and time. Verify support loss while resting transitions to falling, chooses the nearest obstacle below, and never tunnels through a thin window edge at a 100 ms test step.

- [ ] **Step 3: Implement swept vertical collision and attachment zones**

Use swept AABB for falls. Release zones map top to `sit|prone|legs-dangle`, side to `wall-grab|wall-climb`, bottom to `hang`, and open area to `land|crawl`.

- [ ] **Step 4: Wire the input-only hit window**

The render window ignores mouse input. The hit window tracks only the current per-frame `hitBox`, remains focusable on Windows, emits drag/right-click actions, and is kept out of the taskbar.

- [ ] **Step 5: Run unit tests and manual window-close smoke**

Run: `npm test`

Manual: drag the development rectangle to Notepad's top/side/bottom, move and resize Notepad, then close it.

Expected: follow while live; falling starts on minimize/close; no stale clickable hit region remains.

- [ ] **Step 6: Commit**

```bash
git add src/domain/attachment.js src/domain/fall.js src/runtime/pet-controller.js src/render/hit* src/main.js test
git commit -m "feat: attach pet to Windows obstacles"
```

### Task 6: Add menu, kneeling speech, pink face-safe bubble, and rest

**Files:**
- Create: `src/domain/bubble-placement.js`
- Create: `src/runtime/speech.js`
- Create: `src/runtime/settings.js`
- Create: `src/runtime/autostart.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/render/pet-renderer.js`
- Test: `test/bubble-placement.test.js`
- Test: `test/settings.test.js`
- Test: `test/speech-flow.test.js`

**Interfaces:**
- Produces: `placeBubble({faceBox,petRect,bubbleSize,workArea,pointer})`.
- Produces: `speakChinese(text,volume): Promise<{spoken:boolean,reason?:string}>`.
- Produces: `SettingsStore.load()/update()/snapshot()`.

- [ ] **Step 1: Write exhaustive bubble placement tests**

Test all four screen corners, 100–200% scaling, oversized bubbles, pointer avoidance, and assert `intersectionArea(result, faceRect) === 0`.

- [ ] **Step 2: Implement the menu and exact action flow**

Menu labels are exactly `叫“爸爸”`, `说“我错了”`, `原地休息/恢复活动`, `挑战螃蟹`, `自动约战`, `自主活动`, `桌宠大小`, `语音音量`, `开机启动`, `设置`, `退出`.

Speech sequence is exactly `cancel interruptible action -> kneel animation -> pink bubble -> Windows Chinese TTS -> pause -> safe recovery`. Rest calls `AnimationPlayer.freeze()` and only support loss may interrupt it.

- [ ] **Step 3: Implement Windows TTS with a visible fallback**

Invoke installed Windows SAPI voices locally. Prefer a voice whose language starts with `zh-`; if absent, return `{spoken:false,reason:"missing-zh-voice"}` and keep the bubble visible.

- [ ] **Step 4: Implement atomic settings and startup registration**

Write JSON to a sibling temporary file, flush, then rename. Register the suite launcher under `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`; never require elevation.

- [ ] **Step 5: Run tests and manual speech checks**

Run: `npm test`

Manual: trigger both phrases while the pet is at each screen corner and while attached to a window.

Expected: kneel first; pink bubble never covers the face; installed Chinese voice speaks; missing voice degrades to text only.

- [ ] **Step 6: Commit**

```bash
git add src test
git commit -m "feat: add desktop pet interactions"
```

### Task 7: Implement the authenticated duel-server boundary

**Files:**
- Create: `src/runtime/duel-protocol.js`
- Create: `src/runtime/duel-server.js`
- Create: `src/runtime/duel-token.js`
- Modify: `src/runtime/pet-controller.js`
- Test: `test/duel-protocol.test.js`
- Test: `test/duel-server.test.js`

**Interfaces:**
- Produces: `createDuelServer({host:"127.0.0.1",tokenStore,clock})`.
- Produces: messages `hello`, `presence`, `invite`, `accept`, `cancel`, `timeline`, `checkpoint`, `finish`.
- Consumes later: Clawd duel client from the Clawd plan.

- [ ] **Step 1: Write authentication and sequencing tests**

```js
test("rejects missing token, replayed sequence, and stale protocol", async () => {
  await assertRejectsMessage({ type: "hello", version: 1, seq: 1 }, "unauthorized");
  await assertRejectsMessage(auth({ type: "presence", seq: 1 }), "replayed-sequence");
  await assertRejectsMessage(auth({ type: "hello", version: 0, seq: 2 }), "unsupported-version");
});
```

- [ ] **Step 2: Implement strict message validation**

Reject unknown keys for control messages, bodies over 64 KiB, non-integer sequence values, expired session IDs, non-loopback peers, and action IDs absent from the shared timeline allowlist.

- [ ] **Step 3: Implement duel scheduling**

Manual invitations bypass auto cooldown. Automatic invitations require both peers idle and schedule the next attempt uniformly inside the configured 30–60 minute default range. Busy Clawd replies `busy`; manual invitation stays queued for at most five minutes.

- [ ] **Step 4: Run tests**

Run: `node --test test/duel-protocol.test.js test/duel-server.test.js`

Expected: PASS with real loopback sockets and deterministic fake timers.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/duel-* src/runtime/pet-controller.js test/duel-*.test.js
git commit -m "feat: add authenticated duel bridge server"
```

### Task 8: Verify and package the standalone core

**Files:**
- Create: `scripts/smoke-core.ps1`
- Modify: `package.json`
- Test: all `test/*.test.js`

**Interfaces:**
- Produces: `dist/Desktop-Pet-Suite-Setup-0.1.0-x64.exe` before Clawd payload integration.

- [ ] **Step 1: Add a PowerShell smoke script**

The script launches the packaged app with a test profile, waits for its readiness file, confirms only loopback listening sockets, sends shutdown through the test-only named event, and fails if the process remains.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all tests PASS, no skips for pure modules.

- [ ] **Step 3: Build x64 installer**

Run: `npm run build:win:x64`

Expected: one x64 NSIS installer; no arm64 or ia32 artifact.

- [ ] **Step 4: Run packaged smoke**

Run: `powershell -ExecutionPolicy Bypass -File scripts/smoke-core.ps1`

Expected: exit 0 and a diagnostics report proving startup, readiness, loopback-only bridge, and clean shutdown.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/smoke-core.ps1
git commit -m "build: package standalone desktop pet core"
```
