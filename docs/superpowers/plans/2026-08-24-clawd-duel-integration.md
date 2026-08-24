# Clawd Duel Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated duel client and pixel wooden-sword animation states to Clawd on Desk without disrupting its AI-agent state priority, settings, themes, drag behavior, or updateable `main` branch.

**Architecture:** Work only in `E:\02_CodeBase\Fun\clawd-on-desk` on branch `codex/desktop-pet-duel`. Add pure protocol/state modules, a small main-process WebSocket client, and renderer visual overrides; keep the existing `state.js`, `pet-window-runtime.js`, and settings controller as the authorities for their current responsibilities.

**Tech Stack:** Existing Clawd 0.16.0 stack: Node.js 24, Electron 41.10.4, ws 8.21.0, CommonJS, SVG/CSS pixel animation, Node `node:test`.

## Global Constraints

- Read and follow `E:\02_CodeBase\Fun\clawd-on-desk\AGENTS.md` before every implementation session.
- Create `codex/desktop-pet-duel`; never commit these changes directly to `main`.
- Preserve all user settings, themes, Agent hooks/plugins/extensions, permission behavior, and AI status mapping.
- AI states and permissions always preempt/cancel entertainment; never fabricate an Agent state.
- External themes without duel assets fall back safely to the normal idle visual.
- Crab weapon is a pixel wooden sword; no blood, wounds, death, or copyrighted third-party asset copying.
- Keep `hitWin` focusable on Windows and do not bypass existing pet-window geometry APIs.
- Use existing test runner and one reviewable commit per task.

## Planned File Map

- `src/duel-protocol.js`: strict shared-message validation.
- `src/duel-client.js`: authenticated loopback WebSocket client and reconnect lifecycle.
- `src/duel-state.js`: invitation and timeline reducer with AI-priority gates.
- `src/duel-runtime.js`: composition around state, pet geometry, and renderer commands.
- `test/duel-protocol.test.js`, `test/duel-client.test.js`, `test/duel-state.test.js`, `test/duel-runtime.test.js`: contracts.
- `themes/clawd/assets/clawd-duel-*.svg`: original pixel duel animations.
- `themes/clawd/theme.json`: optional duel bindings and hit boxes.
- `src/main.js`: composition wiring only.
- `src/renderer.js`: accepts duel visual override and facing metadata.

---

### Task 1: Create the isolated branch and capture a clean baseline

**Files:**
- Modify: none

**Interfaces:**
- Produces: clean `codex/desktop-pet-duel` branch rooted at approved commit `c654e8da` or the user-approved rebased equivalent.

- [ ] **Step 1: Verify the exact repository and clean status**

Run: `git -C E:\02_CodeBase\Fun\clawd-on-desk status --short --branch`

Expected: `main...origin/main` and no changed paths.

- [ ] **Step 2: Verify baseline version and tests**

Run: `git -C E:\02_CodeBase\Fun\clawd-on-desk rev-parse --short HEAD`

Run: `npm test` from the Clawd repository.

Expected: commit `c654e8da` unless upstream movement was explicitly approved; test suite PASS with only documented environment skips.

- [ ] **Step 3: Create the branch**

Run: `git switch -c codex/desktop-pet-duel`

Expected: new branch, no file changes.

### Task 2: Add strict duel protocol validation

**Files:**
- Create: `src/duel-protocol.js`
- Create: `test/duel-protocol.test.js`

**Interfaces:**
- Consumes: protocol version 1 messages from the human pet server.
- Produces: `validateServerMessage(value,{token,lastSeq,now}): ValidatedMessage`.
- Produces: `makeClientMessage(type,payload,session): object`.

- [ ] **Step 1: Write failing validator tests**

```js
test("accepts authenticated presence and rejects replay", () => {
  const ctx = { token: "a".repeat(64), lastSeq: 4, now: 1000 };
  assert.equal(validateServerMessage(msg({ type: "presence", seq: 5 }), ctx).seq, 5);
  assert.throws(() => validateServerMessage(msg({ type: "presence", seq: 4 }), ctx), /replayed-sequence/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test test/duel-protocol.test.js`

Expected: FAIL because `src/duel-protocol.js` is absent.

- [ ] **Step 3: Implement the allowlisted schema**

Accept only `hello`, `presence`, `invite`, `cancel`, `timeline`, `checkpoint`, and `finish`; validate version 1, session ID, integer sequence, token, timestamps, known action IDs, finite geometry, and maximum serialized size 64 KiB.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/duel-protocol.test.js`

```bash
git add src/duel-protocol.js test/duel-protocol.test.js
git commit -m "feat: validate desktop pet duel protocol"
```

### Task 3: Implement reconnecting loopback duel client

**Files:**
- Create: `src/duel-client.js`
- Create: `test/duel-client.test.js`

**Interfaces:**
- Produces: `createDuelClient({readRuntime,WebSocketImpl,clock,onMessage,onStatus})`.
- Consumes: `%LOCALAPPDATA%\DesktopPetSuite\duel-runtime.json` containing `{port,token,protocolVersion}`.

- [ ] **Step 1: Write fake-WebSocket lifecycle tests**

Verify no connection is attempted for missing/corrupt runtime config, URL host is exactly `127.0.0.1`, every message carries the runtime token, and backoff follows 1s, 2s, 4s, 8s, capped at 30s.

- [ ] **Step 2: Implement client lifecycle**

Watch the runtime file's directory, debounce changes, connect only after validation, and dispose watchers/timers/sockets idempotently. Never scan ports 23333–23337 or reuse Clawd Agent HTTP credentials.

- [ ] **Step 3: Run tests**

Run: `node --test test/duel-client.test.js`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/duel-client.js test/duel-client.test.js
git commit -m "feat: connect Clawd to local duel bridge"
```

### Task 4: Add duel state with explicit AI-priority gates

**Files:**
- Create: `src/duel-state.js`
- Create: `test/duel-state.test.js`

**Interfaces:**
- Produces: `reduceDuelState(state,event): DuelState`.
- Produces: `isDuelEligible({displayState,hidden,mini,dragging,dnd,permissionCount}): boolean`.

- [ ] **Step 1: Write failing gate tests**

```js
for (const displayState of ["thinking", "working", "juggling", "permission", "attention", "error"]) {
  test(`blocks duel while ${displayState}`, () => {
    assert.equal(isDuelEligible(base({ displayState })), false);
  });
}
```

- [ ] **Step 2: Define states and terminal behavior**

Use exact phases `disconnected`, `idle`, `invited`, `approaching`, `ready`, `playing`, `finishing`, `recovering`. Any Agent state change, permission bubble, drag, mini transition, hide, DND, or socket close transitions through `cancelled` output and returns to `idle`/`disconnected`.

- [ ] **Step 3: Implement and run tests**

Run: `node --test test/duel-state.test.js`

Expected: PASS, including cancellation from every nonterminal duel phase.

- [ ] **Step 4: Commit**

```bash
git add src/duel-state.js test/duel-state.test.js
git commit -m "feat: gate Clawd duel states behind agent activity"
```

### Task 5: Add original pixel wooden-sword animations and theme bindings

**Files:**
- Create: `themes/clawd/assets/clawd-duel-ready.svg`
- Create: `themes/clawd/assets/clawd-duel-attack.svg`
- Create: `themes/clawd/assets/clawd-duel-block.svg`
- Create: `themes/clawd/assets/clawd-duel-dodge.svg`
- Create: `themes/clawd/assets/clawd-duel-hit.svg`
- Create: `themes/clawd/assets/clawd-duel-win.svg`
- Create: `themes/clawd/assets/clawd-duel-lose.svg`
- Modify: `themes/clawd/theme.json`
- Modify: `src/state-visual-resolver.js`
- Test: `test/duel-theme-assets.test.js`
- Test: `test/state-visual-resolver.test.js`

**Interfaces:**
- Produces theme bindings `duel-ready`, `duel-attack`, `duel-block`, `duel-dodge`, `duel-hit`, `duel-win`, `duel-lose`.

- [ ] **Step 1: Write failing asset coverage tests**

Assert every duel binding resolves to an existing sanitized SVG, includes the theme viewBox, contains no script/event/external URL, and has a file-specific hit box.

- [ ] **Step 2: Create `ready`, `attack`, and `hit` samples only**

Draw original pixel SVG animations using Clawd's existing palette and geometry conventions. The sword must read as wood through brown pixel fill and rounded/blunt silhouette; do not copy third-party sword art.

- [ ] **Step 3: Visual gate at 1×, 2×, and current Clawd size**

Confirm no clipping, correct crab identity, visible wooden sword, readable impact, and no blood. Correct the shared drawing recipe before producing the remaining four actions.

- [ ] **Step 4: Add optional bindings without making them required for external themes**

Extend the resolver so missing duel bindings fall back to `idle`. Do not add them to `REQUIRED_STATES` or external-theme validation requirements.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/duel-theme-assets.test.js test/state-visual-resolver.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add themes/clawd src/state-visual-resolver.js test/duel-theme-assets.test.js test/state-visual-resolver.test.js
git commit -m "art: add Clawd wooden-sword duel states"
```

### Task 6: Implement Clawd duel runtime and position synchronization

**Files:**
- Create: `src/duel-runtime.js`
- Create: `test/duel-runtime.test.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: existing `getPetWindowBounds`, `applyPetWindowBounds`, `_roam.cancelRoam`, `_state.applyState`, `resolveDisplayState`, mini/drag/permission gates.
- Produces: `duelRuntime.start()`, `dispose()`, `handleServerMessage(message)`, `onDisplayStateChanged(state)`.

- [ ] **Step 1: Write a dependency-injected runtime test**

Simulate invite while idle, approach target via existing window bounds API, start timeline, then inject `working`; assert one cancel message, no further duel visual, and restoration through `resolveDisplayState()`.

- [ ] **Step 2: Implement runtime without direct BrowserWindow writes**

All movement goes through `applyPetWindowBounds`; cancel existing free roam before approach; call existing reconcile-protection release paths after movement; never call `win.setBounds()` or `hitWin.setBounds()` directly.

- [ ] **Step 3: Wire composition in `main.js`**

Construct after `_roam`, `_state`, and `petWindowRuntime` exist. Subscribe to existing settings/state snapshots rather than modifying `state.js` session semantics. Dispose before windows and watchers during app shutdown.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/duel-runtime.test.js test/pet-window-runtime.test.js test/state.test.js`

Run: `npm test`

Expected: PASS; no change to existing Agent state snapshots.

- [ ] **Step 5: Commit**

```bash
git add src/duel-runtime.js src/main.js test/duel-runtime.test.js
git commit -m "feat: synchronize Clawd duel movement and visuals"
```

### Task 7: Run live bridge smoke and package the custom Clawd payload

**Files:**
- Create: `scripts/manual/duel-smoke.js`
- Modify: `package.json` only if a named build script is needed.

**Interfaces:**
- Produces: custom `win-unpacked` x64 payload consumed by the unified-installer plan.

- [ ] **Step 1: Run the human pet mock bridge**

Launch `scripts/manual/duel-smoke.js` with a temporary runtime file and deterministic timeline. It must exercise invitation, busy refusal, attack/block/hit, finish, and disconnect recovery.

- [ ] **Step 2: Launch Clawd from source**

Run: `npm start`

Expected: normal Agent states still work; idle Clawd connects to mock bridge; dragging or an injected working state cancels the duel.

- [ ] **Step 3: Run full verification**

Run: `npm test`

Run: `npm run verify:electron`

Run: `npm run audit:assets`

Expected: PASS.

- [ ] **Step 4: Build x64 directory payload**

Run: `npx electron-builder --win --x64 --dir`

Expected: one `win-unpacked` payload with exactly one x64 Koffi native binary after the existing audit.

- [ ] **Step 5: Commit smoke tooling**

```bash
git add scripts/manual/duel-smoke.js package.json
git commit -m "test: verify Clawd duel bridge integration"
```
