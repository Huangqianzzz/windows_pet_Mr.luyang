# Unified Installer And E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine the verified human desktop pet and custom Clawd payload into one Windows 10/11 x64 installer with configuration preservation, startup registration, rollback, security checks, and end-to-end validation.

**Architecture:** The human pet repository owns the suite installer and a stable suite launcher. Build Clawd as an unpacked x64 payload, copy it into a versioned vendor directory, and let the launcher start both independent executables; transactional configuration backup and a current-version marker make upgrade rollback explicit.

**Tech Stack:** electron-builder 26.15.7 NSIS, Node.js 24, PowerShell 5.1-compatible smoke scripts, Electron 41.10.4 payloads, Git.

## Global Constraints

- Deliver exactly one Windows 10/11 x64 installer.
- Default to starting both pets with Windows; users can disable startup in settings.
- Preserve `%APPDATA%\clawd-on-desk` settings, user themes, and Agent integration data.
- Never delete or rewrite `E:\02_CodeBase\Fun\clawd-on-desk` during installation or uninstall.
- Upgrade failure restores the last good program payload and pre-upgrade Clawd configuration backup.
- Uninstall offers to keep personal configuration.
- Do not claim Windows 10/11 compatibility until both real-machine rows pass.
- Final security work includes local code scan, secret scan, asset/license audit, and loopback exposure validation.

## Planned File Map

- `src/runtime/suite-launcher.js`: starts, monitors, and stops both executables.
- `src/runtime/install-transaction.js`: config backup, migration, commit, rollback.
- `src/runtime/version-store.js`: versioned payload and last-good marker.
- `build/installer.nsh`: NSIS hooks and uninstall keep-data choice.
- `scripts/build-clawd-payload.ps1`: reproducible custom Clawd build/copy/audit.
- `scripts/build-suite.ps1`: ordered release build.
- `scripts/e2e/install-smoke.ps1`: install/launch/upgrade/uninstall checks.
- `test/install-transaction.test.js`, `test/suite-launcher.test.js`: pure contracts.
- `docs/superpowers/specs/2026-08-24-windows-desktop-pet-design.md`: approved acceptance source.

---

### Task 1: Add a stable two-process suite launcher

**Files:**
- Create: `src/runtime/suite-launcher.js`
- Create: `test/suite-launcher.test.js`
- Modify: `src/main.js`

**Interfaces:**
- Produces: `createSuiteLauncher({spawn,paths,clock}).startClawd()/stopClawd()/status()`.
- Consumes: packaged custom Clawd path resolved from `process.resourcesPath`.

- [ ] **Step 1: Write failing ownership tests**

```js
test("starts one owned Clawd and never kills a foreign process", async () => {
  const launcher = createSuiteLauncher(fakeDeps());
  await launcher.startClawd();
  await launcher.startClawd();
  assert.equal(fakeSpawn.calls.length, 1);
  await launcher.stopClawd();
  assert.equal(fakeSpawn.children[0].gracefulCloseCalls, 1);
});
```

- [ ] **Step 2: Implement explicit child ownership**

Track only the child object spawned by this launcher. Use an app-specific `--suite-child` marker and graceful IPC shutdown. Never terminate by process name, PID enumeration, wildcard, or `taskkill`.

- [ ] **Step 3: Run tests and commit**

Run: `node --test test/suite-launcher.test.js`

```bash
git add src/runtime/suite-launcher.js src/main.js test/suite-launcher.test.js
git commit -m "feat: launch both desktop pets safely"
```

### Task 2: Implement transactional configuration backup and rollback

**Files:**
- Create: `src/runtime/install-transaction.js`
- Create: `src/runtime/version-store.js`
- Create: `test/install-transaction.test.js`
- Create: `test/version-store.test.js`

**Interfaces:**
- Produces: `beginInstall({version,sourceConfig,payload}): Transaction`.
- Produces: `Transaction.verify()`, `commit()`, `rollback(reason)`.
- Stores: `%LOCALAPPDATA%\DesktopPetSuite\versions\<version>` and `%LOCALAPPDATA%\DesktopPetSuite\backups\<timestamp>`.

- [ ] **Step 1: Write failure-injection tests**

Test copy failure, invalid migrated JSON, missing payload executable, self-test failure, and interrupted commit. Each case must retain the previous `last-good.json` and exact original config bytes.

- [ ] **Step 2: Implement copy-verify-switch transaction**

Copy into a fresh version directory; hash every payload file; copy Clawd config into a fresh backup; validate copied JSON without rewriting it; run self-test; atomically replace `current.json`; only then mark the version good.

- [ ] **Step 3: Implement rollback**

Rollback restores the previous marker and config backup using temporary sibling directories and atomic renames. Matching or rename failure returns a hard error and leaves both old and new directories for manual recovery.

- [ ] **Step 4: Run tests and commit**

Run: `node --test test/install-transaction.test.js test/version-store.test.js`

```bash
git add src/runtime/install-transaction.js src/runtime/version-store.js test
git commit -m "feat: add transactional suite upgrades"
```

### Task 3: Build and vendor the custom Clawd payload reproducibly

**Files:**
- Create: `scripts/build-clawd-payload.ps1`
- Create: `vendor/clawd/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `vendor/clawd/win-unpacked/` plus `vendor/clawd/payload-sha256.json`.

- [ ] **Step 1: Add exact preflight gates**

The script verifies repository path, branch `codex/desktop-pet-duel`, clean status, expected package version, installed Node major 24, and passing `npm test`. Any mismatch exits before writing `vendor/clawd`.

- [ ] **Step 2: Build into a fresh staging directory**

Invoke `npx electron-builder --win --x64 --dir`, then `npm run audit:native-package -- --app-root <staging> --target win-x64`. Do not copy the payload until both commands pass.

- [ ] **Step 3: Test on 2–3 representative files before full copy**

Copy the Clawd executable, `resources/app.asar`, and the x64 `koffi.node` to a sample directory; verify hashes and architecture. Only then copy the entire staged payload to a new sibling directory and rename it to `vendor/clawd/win-unpacked`.

- [ ] **Step 4: Ignore generated payload, retain only manifest**

Add `vendor/clawd/win-unpacked/` to `.gitignore`; commit the build script and hash manifest format, not hundreds of generated binaries.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-clawd-payload.ps1 vendor/clawd/.gitkeep .gitignore
git commit -m "build: stage custom Clawd payload"
```

### Task 4: Configure the unified NSIS installer and startup behavior

**Files:**
- Create: `build/installer.nsh`
- Modify: `package.json`
- Modify: `src/runtime/autostart.js`
- Test: `test/installer-contract.test.js`

**Interfaces:**
- Produces: `dist/Desktop-Pet-Suite-Setup-<version>-x64.exe`.

- [ ] **Step 1: Write installer config contract tests**

Assert artifact name contains `${version}` and `${arch}`, target contains only x64, `extraResources` maps `vendor/clawd/win-unpacked` to `clawd`, and NSIS include path is `build/installer.nsh`.

- [ ] **Step 2: Add packaged Clawd payload**

```json
"extraResources": [
  { "from": "vendor/clawd/win-unpacked", "to": "clawd" }
]
```

The launcher resolves the exact packaged executable; it does not search PATH or an existing Clawd installation.

- [ ] **Step 3: Implement startup registration**

Register only the suite executable in HKCU Run. On startup it launches the human pet and its owned Clawd child. This produces two pets without duplicate startup entries or duplicate Clawd processes.

- [ ] **Step 4: Implement uninstall keep-data page**

Default to retaining `%APPDATA%\clawd-on-desk`, `%APPDATA%\desktop-pet-suite`, and backups. Delete them only after explicit checkbox confirmation; never touch the source repository.

- [ ] **Step 5: Run tests and build**

Run: `node --test test/installer-contract.test.js`

Run: `npm run build:win:x64`

Expected: one x64 installer.

- [ ] **Step 6: Commit**

```bash
git add build/installer.nsh package.json src/runtime/autostart.js test/installer-contract.test.js
git commit -m "build: create unified desktop pet installer"
```

### Task 5: Add end-to-end duel and failure-recovery harnesses

**Files:**
- Create: `scripts/e2e/duel-smoke.js`
- Create: `scripts/e2e/install-smoke.ps1`
- Create: `scripts/e2e/config-fixtures/`
- Create: `test/duel-e2e-contract.test.js`

**Interfaces:**
- Produces: deterministic acceptance reports without modifying a real user's config.

- [ ] **Step 1: Build a temporary-profile harness**

Set test-owned APPDATA/LOCALAPPDATA directories for both apps. Seed representative Clawd settings, user theme, and Agent integration JSON. Never point destructive cleanup at real profile directories.

- [ ] **Step 2: Test manual and automatic duel**

Run a deterministic timeline: invite, approach, ready, human slipper attack, crab wooden-sword block, crab attack, human hit, finish, recovery. Then inject Clawd `working` mid-duel and assert both cancel safely.

- [ ] **Step 3: Test install, upgrade failure, rollback, and uninstall**

Install silently into a test-owned directory, compare config hashes, inject self-test failure during a version upgrade, assert restoration, then uninstall once retaining and once deleting the test profile.

- [ ] **Step 4: Run the harness**

Run: `powershell -ExecutionPolicy Bypass -File scripts/e2e/install-smoke.ps1 -Installer dist\Desktop-Pet-Suite-Setup-0.1.0-x64.exe`

Expected: exit 0; report lists install, config-preserve, autostart, two-process launch, duel, rollback, retain-data, and delete-data as PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e test/duel-e2e-contract.test.js
git commit -m "test: cover desktop pet suite installation and duel"
```

### Task 6: Perform Windows interaction acceptance

**Files:**
- Create: `test-results/windows-acceptance-template.md`
- Create during execution: `test-results/windows-10-x64.md`
- Create during execution: `test-results/windows-11-x64.md`

**Interfaces:**
- Produces: evidence for every visual and OS integration acceptance criterion.

- [ ] **Step 1: Validate Windows 10 x64**

Test 100%, 125%, 150%, 175%, and 200% DPI; window top/side/bottom attachment; move/resize/minimize/close; taskbar; desktop icons; both speech actions; rest freeze; manual/auto duel; startup; uninstall.

- [ ] **Step 2: Validate Windows 11 x64**

Repeat the same matrix. Record OS build, monitor topology, screenshots, result, and residual risk for each row.

- [ ] **Step 3: Validate mixed-DPI dual monitors**

Drag both pets across displays in each direction while idle, attached, speaking, and dueling. Confirm face-safe bubble placement and no stale hit window.

- [ ] **Step 4: Reject unsupported claims**

If either OS cannot be tested, mark that row `PENDING` and do not label the installer compatible with that OS in the release notes.

- [ ] **Step 5: Commit acceptance evidence**

```bash
git add test-results
git commit -m "test: record Windows desktop pet acceptance"
```

### Task 7: Security, license, review, and final release verification

**Files:**
- Modify: only files required by concrete findings.
- Create: `test-results/release-verification.md`

**Interfaces:**
- Produces: final release candidate and documented verification.

- [ ] **Step 1: Run local secret and code scans**

Use `ghost:scan-secrets` and `ghost:scan-code`. Fail release on embedded tokens, source-photo leakage outside approved assets, unsafe WebSocket binding, command injection, or broad process termination.

- [ ] **Step 2: Run Clawd and suite audits**

In Clawd: `npm test`, `npm run verify:electron`, `npm run audit:assets`, and native package audit.

In suite: `npm test`, animation validators, installer contract, packaged smoke, and E2E install smoke.

- [ ] **Step 3: Review license boundaries**

Record that Clawd code modifications are AGPL-3.0-only, bundled Clawd artwork has separate rights, the new human photos/assets are private user-provided material, and the generated wooden-sword assets are original. Do not prepare public distribution without a separate rights review.

- [ ] **Step 4: Request code review**

Use `code-review` and `superpowers:requesting-code-review`. Fix concrete findings with focused tests; rerun affected and full suites.

- [ ] **Step 5: Verify release artifact**

Record SHA-256, file size, product version, architecture, clean-install result, upgrade result, rollback result, and both OS acceptance links in `test-results/release-verification.md`.

- [ ] **Step 6: Commit verification**

```bash
git add test-results/release-verification.md
git commit -m "chore: verify desktop pet suite release"
```
