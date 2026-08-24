# Person Animation Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the approved unbeautified, photorealistic, ugly-cute human animation set with transparent sprite sheets and verified per-frame geometry metadata.

**Architecture:** Preserve immutable copies of the two approved source photos, then create and approve three representative actions before any batch production. Every batch is validated for anatomy, identity, alpha, frame geometry, contact continuity, and face-box coverage before it can enter the runtime manifest.

**Tech Stack:** Built-in `imagegen` skill for identity-preserving drafts, motion-reference/rig rendering workflow, PNG sprite sheets, JSON metadata, Node.js validation scripts, SHA-256.

## Global Constraints

- Use only the two approved photos; all earlier person references are forbidden.
- No smoothing, face slimming, body slimming, height change, eye enlargement, heroic treatment, or sexualization.
- Preserve black medium-long hair, thin-frame glasses, white over-ear headphones, tan hoodie, gray sweatpants, and white footwear.
- Humor comes from timing and blank reactions; anatomy and weight bearing remain natural.
- Any batch write must first succeed on 2–3 sample assets and receive visual approval.
- Never edit the WeChat originals; copy, hash, and process project-owned copies only.
- A failed match or validator check exits non-zero; no silent fallback rewrites.

## Planned File Map

- `assets/source/person/front-standing.jpg`, `assets/source/person/arms-crossed.jpg`: immutable approved copies.
- `assets/source/person/SHA256SUMS.txt`: source integrity record.
- `assets/animations/raw/<action>/`: approved rendered frames before packing.
- `assets/animations/sheets/<action>.png`: packed transparent sprite sheets.
- `assets/animations/metadata/<action>.json`: action and per-frame geometry.
- `assets/animations/manifest.json`: runtime index.
- `scripts/assets/validate-source.js`: hash and dimension validation.
- `scripts/assets/validate-action.js`: alpha, frame, geometry, and continuity checks.
- `scripts/assets/pack-action.js`: deterministic frame packing.
- `test/assets/*.test.js`: validator tests and fixtures.

---

### Task 1: Intake and protect the approved source photos

**Files:**
- Create: `assets/source/person/front-standing.jpg`
- Create: `assets/source/person/arms-crossed.jpg`
- Create: `assets/source/person/SHA256SUMS.txt`
- Create: `scripts/assets/validate-source.js`
- Test: `test/assets/source-integrity.test.js`

**Interfaces:**
- Produces: stable project-owned image paths and verified SHA-256 values.

- [ ] **Step 1: Copy, do not move, the two approved originals**

Use `Copy-Item -LiteralPath` for each exact source path. Name `d998...jpg` as `front-standing.jpg` and `f4b2...jpg` as `arms-crossed.jpg`. Leave both originals untouched.

- [ ] **Step 2: Record hashes**

Run: `Get-FileHash -Algorithm SHA256 assets/source/person/*.jpg`

Write the exact two hashes and filenames to `SHA256SUMS.txt`.

- [ ] **Step 3: Write the failing integrity test**

```js
test("approved person sources match the recorded hashes", async () => {
  const result = await validateSources("assets/source/person/SHA256SUMS.txt");
  assert.deepEqual(result.changed, []);
  assert.equal(result.files.length, 2);
});
```

- [ ] **Step 4: Implement and run the validator**

Run: `node --test test/assets/source-integrity.test.js`

Expected: PASS; any missing, renamed, or changed source reports the exact path and exits non-zero.

- [ ] **Step 5: Visually compare the copies to the originals**

Open both copies with the image viewer. Confirm full dimensions and visible content match. Do not proceed if either differs.

- [ ] **Step 6: Commit**

```bash
git add assets/source/person scripts/assets/validate-source.js test/assets/source-integrity.test.js
git commit -m "chore: preserve approved person references"
```

### Task 2: Define and test the animation metadata contract

**Files:**
- Create: `scripts/assets/validate-action.js`
- Create: `scripts/assets/pack-action.js`
- Create: `test/assets/action-validator.test.js`
- Create: `test/assets/fixtures/valid-action.json`
- Create: `test/assets/fixtures/invalid-face-action.json`

**Interfaces:**
- Produces: `validateAction(actionDir,metadata): ValidationReport`.
- Produces: `packAction(actionDir,outputPng,outputJson)` with deterministic frame ordering.

- [ ] **Step 1: Write failing validator tests**

```js
test("rejects missing face boxes and discontinuous contacts", async () => {
  await assert.rejects(() => validateAction(fixture("invalid-face-action.json")), /frame 2.*faceBox/);
  await assert.rejects(() => validateAction(fixture("jumping-contact.json")), /contact.*discontinuity/);
});
```

- [ ] **Step 2: Implement strict validation**

Require action name, 30 FPS unless explicitly marked static, loop flag, interruptibility, ordered frame filenames, non-empty alpha, canvas bounds, face box, hit box, contacts, and support anchor. Reject duplicate filenames and dimension drift.

- [ ] **Step 3: Implement deterministic packing**

Sort only by the numeric frame index parsed from exact `frame-0001.png` names. If any filename fails the pattern or any index is missing, exit non-zero without writing a sheet.

- [ ] **Step 4: Run tests**

Run: `node --test test/assets/*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/assets test/assets
git commit -m "test: enforce animation asset contracts"
```

### Task 3: Produce three representative approval samples

**Files:**
- Create: `assets/animations/raw/idle/`
- Create: `assets/animations/raw/crawl-loop/`
- Create: `assets/animations/raw/kneel-speak/`
- Create: `assets/animations/metadata/idle.json`
- Create: `assets/animations/metadata/crawl-loop.json`
- Create: `assets/animations/metadata/kneel-speak.json`

**Interfaces:**
- Produces: the visual gate for identity, anatomy, transparency, and ugly-cute timing.

- [ ] **Step 1: Generate only the idle sample**

Invoke the `imagegen` skill with both approved images as identity references. Prompt invariants: unchanged face/body/clothes/accessories, transparent background, blank expression, natural stance, no beauty retouching, exactly two arms/two legs.

- [ ] **Step 2: Inspect identity before generating motion**

Compare face shape, glasses, hair, headphones, hoodie, trouser width, and body proportions side by side with both sources. Reject identity drift rather than compensating in later frames.

- [ ] **Step 3: Produce short crawl and kneel samples**

Create 8–12 frames per sample. Crawl must show alternating hand/knee contacts and stable weight transfer. Kneel must settle before speech and preserve face visibility for bubble placement.

- [ ] **Step 4: Run the validator on exactly these three samples**

Run: `node scripts/assets/validate-action.js assets/animations/raw/idle assets/animations/metadata/idle.json`

Repeat for `crawl-loop` and `kneel-speak`.

Expected: three PASS reports and no production of other actions.

- [ ] **Step 5: User visual gate**

Show the three samples at actual desktop-pet size and 2× zoom. Require explicit approval of identity, lack of beautification, crawl anatomy, and kneeling behavior before Task 4.

- [ ] **Step 6: Commit approved samples**

```bash
git add assets/animations/raw/idle assets/animations/raw/crawl-loop assets/animations/raw/kneel-speak assets/animations/metadata
git commit -m "art: approve core person animation samples"
```

### Task 4: Produce locomotion and orientation actions

**Files:**
- Create: `assets/animations/raw/crawl-start/`
- Create: `assets/animations/raw/crawl-stop/`
- Create: `assets/animations/raw/crawl-turn/`
- Create: `assets/animations/raw/climb-up/`
- Create: `assets/animations/raw/climb-down/`
- Create: `assets/animations/raw/wall-left/`
- Create: `assets/animations/raw/wall-right/`
- Create: matching `assets/animations/metadata/*.json`

**Interfaces:**
- Produces: locomotion actions consumed by `pet-controller`.

- [ ] **Step 1: Produce two actions only: `crawl-start` and `climb-up`**

Validate and visually inspect contact continuity, face consistency, hoodie folds, and headphone stability.

- [ ] **Step 2: Correct the production recipe, not individual bad frames**

If either sample fails, adjust the shared rig/reference/prompt and regenerate both. Do not patch identity or anatomy independently frame by frame unless the corrected rig still needs a local cleanup.

- [ ] **Step 3: Produce the remaining five actions using the approved recipe**

Every action must include start/end pose compatibility in metadata so the controller can reject illegal transitions.

- [ ] **Step 4: Validate the whole locomotion set**

Run: `Get-ChildItem assets/animations/metadata/*.json | ForEach-Object { node scripts/assets/validate-action.js assets/animations/raw/$($_.BaseName) $_.FullName; if ($LASTEXITCODE) { exit $LASTEXITCODE } }`

Expected: all PASS; first failure stops the loop.

- [ ] **Step 5: Commit**

```bash
git add assets/animations/raw assets/animations/metadata
git commit -m "art: add person locomotion animations"
```

### Task 5: Produce attachment, sitting, hanging, fall, and landing actions

**Files:**
- Create: raw frames and metadata for `wall-grab`, `wall-idle`, `hang`, `sit-top`, `prone-top`, `legs-dangle`, `fall-start`, `fall-loop`, `land`, `recover`.

**Interfaces:**
- Produces: actions with exact `supportAnchor` and contact metadata used by attachment/fall physics.

- [ ] **Step 1: Produce and approve `sit-top`, `wall-grab`, and `fall-loop` samples**

Render them against a temporary high-contrast edge guide that is not included in final alpha output. Confirm hands/seat align with the declared anchor.

- [ ] **Step 2: Test anchor projection**

Run: `node scripts/assets/render-anchor-preview.js sit-top wall-grab fall-loop`

Expected: preview crosshair falls exactly on the window edge/contact; no visible body part is clipped.

- [ ] **Step 3: Produce the remaining actions**

Maintain compatible start/end poses and preserve the current face direction needed for face-safe bubbles.

- [ ] **Step 4: Validate and commit**

Run all asset tests and validators, then:

```bash
git add assets/animations scripts/assets/render-anchor-preview.js
git commit -m "art: add attachment and fall animations"
```

### Task 6: Produce speech, idle-comedy, drag, and duel actions

**Files:**
- Create: raw frames and metadata for `dragged`, `idle-stare`, `idle-wrong-way`, `kneel-pause`, `kneel-recover`, `slipper-draw`, `duel-ready`, `duel-approach`, `duel-attack`, `duel-block`, `duel-dodge`, `duel-hit`, `duel-win`, `duel-lose`.
- Reuse without recreating: the approved `kneel-speak` sample from Task 3.

**Interfaces:**
- Produces: named action IDs shared with the duel protocol and Clawd timeline.

- [ ] **Step 1: Produce three duel samples**

Create `slipper-draw`, `duel-attack`, and `duel-hit`. The weapon is a household slipper; no blade, blood, injury, or heroic styling.

- [ ] **Step 2: Validate contact/timing against a mock crab timeline**

Use a generated test JSON with checkpoints `ready=0`, `impact=600`, `recover=1100`. Confirm the slipper reaches the impact point at the shared checkpoint and returns without limb interpolation artifacts.

- [ ] **Step 3: Produce the remaining speech/comedy/duel actions**

Keep humor in deadpan pauses and delayed reactions. `kneel-speak` remains the approved kneeling behavior; do not substitute lying down.

- [ ] **Step 4: Run validators and visual approval**

Show the two phrase sequences and one complete mock duel before integrating the batch.

- [ ] **Step 5: Commit**

```bash
git add assets/animations
git commit -m "art: add speech and slipper duel animations"
```

### Task 7: Pack, validate, and publish the runtime manifest

**Files:**
- Create: `assets/animations/sheets/*.png`
- Create: `assets/animations/manifest.json`
- Create: `test/assets/manifest-coverage.test.js`

**Interfaces:**
- Produces: final manifest consumed by `src/runtime/animation-player.js`.

- [ ] **Step 1: Write the failing coverage test**

Assert the manifest contains every action referenced by pet-state, attachment, speech, and duel allowlists; assert no unreferenced production action remains.

- [ ] **Step 2: Pack the first three actions and inspect output**

Run packer for `idle`, `crawl-loop`, and `kneel-speak`. Open each sheet and run the runtime manifest validator.

- [ ] **Step 3: Pack all actions only after the sample sheets pass**

The packer writes to a new sibling file and renames only after successful validation. It never overwrites the only good sheet on failure.

- [ ] **Step 4: Run full tests**

Run: `npm test`

Expected: manifest coverage, source integrity, alpha, geometry, and action validation all PASS.

- [ ] **Step 5: Commit**

```bash
git add assets/animations/sheets assets/animations/manifest.json test/assets
git commit -m "art: publish verified desktop pet animation set"
```
