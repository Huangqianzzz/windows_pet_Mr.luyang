const {
  chooseReleasePose,
  createAttachment,
  findReleaseZone,
  resolveAttachment
} = require("../domain/attachment");
const { stepFall } = require("../domain/fall");
const { intersects } = require("../domain/geometry");
const { initialState, reducePetState } = require("../domain/pet-state");
const { resolveCrawlStep, planBehindWindowEscape } = require("./crawl-navigation");

const AUTO_CLIMB_THRESHOLD_MS = 2000;
const AUTO_CLIMB_SPEED = 60;
// 覆盖首次锚点对齐差（生产 wall-climb 锚点 {69,8} 相对 body 中心的偏移）。
const AUTO_CLIMB_ANCHOR_TOLERANCE = 128;

const INPUT_ACTIONS = Object.freeze(["drag-start", "drag-move", "drag-end"]);
const ATTACHED_RECOVERY_ACTIONS = new Set([
  "sit",
  "prone",
  "legs-dangle",
  "wall-grab",
  "wall-climb",
  "hang"
]);

function validatePetAction(action, payload) {
  if (!INPUT_ACTIONS.includes(action) || !payload || typeof payload !== "object") return null;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) return null;
  if (![payload.x, payload.y].every(Number.isFinite)) return null;
  return Object.freeze({
    action,
    point: Object.freeze({ x: payload.x, y: payload.y })
  });
}

function isTrustedIpcSender(event, expectedWindow) {
  return Boolean(
    event?.sender
    && expectedWindow
    && typeof expectedWindow.isDestroyed === "function"
    && !expectedWindow.isDestroyed()
    && event.sender === expectedWindow.webContents
  );
}

function validHitBox(hitBox) {
  return Boolean(hitBox) && [hitBox.x, hitBox.y, hitBox.width, hitBox.height].every(Number.isFinite)
    && hitBox.width > 0 && hitBox.height > 0;
}

function sameIdentity(first, second) {
  return first.source === second.source && first.id === second.id
    && Object.hasOwn(first, "hwnd") === Object.hasOwn(second, "hwnd")
    && (!Object.hasOwn(first, "hwnd") || first.hwnd === second.hwnd);
}

function cloneRect(rect) {
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function canEscapeCoveredObstacle(body, obstacle, candidate, workArea) {
  const contains = obstacle.x <= body.x
    && obstacle.y <= body.y
    && obstacle.x + obstacle.width >= body.x + body.width
    && obstacle.y + obstacle.height >= body.y + body.height;
  if (!contains) return false;

  const movedX = candidate.x - body.x;
  const movedY = candidate.y - body.y;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  if (movedX < 0 && obstacle.x - body.width >= workArea.x) return true;
  if (movedX > 0 && obstacle.x + obstacle.width + body.width <= workRight) return true;
  if (movedY < 0 && obstacle.y - body.height >= workArea.y) return true;
  if (movedY > 0 && obstacle.y + obstacle.height + body.height <= workBottom) return true;
  return false;
}

class PetController {
  constructor({
    obstacleIndex,
    animationBridge,
    body,
    renderWindow,
    hitWindow,
    layerCoordinator,
    hideBubble = () => {},
    isBackgroundPaused = () => false,
    choosePose = choices => choices[0],
    poseAnchors = {},
    gravity,
    releaseThreshold = 24,
    autoClimbThresholdMs = AUTO_CLIMB_THRESHOLD_MS,
    autoClimbSpeed = AUTO_CLIMB_SPEED,
    autoClimbAnchorTolerance = AUTO_CLIMB_ANCHOR_TOLERANCE
  }) {
    if (!obstacleIndex || typeof obstacleIndex.snapshot !== "function") {
      throw new TypeError("PetController requires an ObstacleIndex");
    }
    if (!animationBridge || typeof animationBridge.play !== "function") {
      throw new TypeError("PetController requires an animation bridge");
    }
    if (!body || ![body.x, body.y, body.width, body.height, body.vx, body.vy].every(Number.isFinite)) {
      throw new TypeError("PetController requires a finite fall body");
    }
    if (body.width <= 0 || body.height <= 0) throw new RangeError("pet body must have positive area");
    if (typeof choosePose !== "function") throw new TypeError("choosePose must be a function");
    if (!Number.isFinite(releaseThreshold) || releaseThreshold < 0) {
      throw new RangeError("releaseThreshold must be non-negative");
    }
    if (!Number.isFinite(autoClimbThresholdMs) || autoClimbThresholdMs < 0) {
      throw new RangeError("autoClimbThresholdMs must be non-negative");
    }
    if (!Number.isFinite(autoClimbSpeed) || autoClimbSpeed <= 0) {
      throw new RangeError("autoClimbSpeed must be positive");
    }
    if (!Number.isFinite(autoClimbAnchorTolerance) || autoClimbAnchorTolerance < 0) {
      throw new RangeError("autoClimbAnchorTolerance must be non-negative");
    }

    this.obstacleIndex = obstacleIndex;
    this.animationBridge = animationBridge;
    this.body = { ...body };
    this.baseSize = { width: body.width, height: body.height };
    this.currentScale = 1;
    this.renderWindow = renderWindow;
    this.hitWindow = hitWindow;
    this.layerCoordinator = layerCoordinator;
    this.hideBubble = hideBubble;
    this.isBackgroundPaused = isBackgroundPaused;
    this.behindEscape = null;
    this.choosePose = choosePose;
    this.poseAnchors = Object.freeze(Object.fromEntries(Object.entries(poseAnchors || {}).map(([pose, anchor]) => {
      if (!anchor || ![anchor.x, anchor.y].every(Number.isFinite)) {
        throw new TypeError(`pose anchor ${pose} must be finite`);
      }
      return [pose, Object.freeze({ x: anchor.x, y: anchor.y })];
    })));
    this.gravity = gravity;
    this.releaseThreshold = releaseThreshold;
    this.autoClimbThresholdMs = autoClimbThresholdMs;
    this.autoClimbSpeed = autoClimbSpeed;
    this.autoClimbAnchorTolerance = autoClimbAnchorTolerance;
    this.state = initialState();
    this.attachment = null;
    this.dragOffset = null;
    this.frameHitBox = null;
    this.hitRegionVisible = false;
    this.inputBlocks = new Set();
    this.frameSupportAnchor = null;
    this.restResumeState = null;
    this.speechResumeState = null;
    this.autoClimb = null;
    this.autoClimbBlockedMs = 0;
  }

  snapshot() {
    return {
      state: this.state,
      body: { ...this.body },
      attachment: this.attachment
    };
  }

  handleInput(action, payload) {
    if (!this.inputEnabled) return { accepted: false };
    const input = validatePetAction(action, payload);
    if (!input) return { accepted: false };
    if (action === "drag-start") return this.#startDrag(input.point);
    if (action === "drag-move") return this.#moveDrag(input.point);
    return this.#endDrag(input.point);
  }

  setInputEnabled(enabled) {
    if (typeof enabled !== "boolean") return false;
    return this.setInputBlocked("legacy", !enabled);
  }

  get inputEnabled() {
    return this.inputBlocks.size === 0;
  }

  setInputBlocked(reason, blocked) {
    if (typeof reason !== "string" || !reason.trim() || typeof blocked !== "boolean") return false;
    if (blocked) this.inputBlocks.add(reason);
    else this.inputBlocks.delete(reason);
    if (this.inputEnabled) this.#showCurrentHitRegion();
    else {
      this.#cancelDrag();
      this.#hideHitRegion();
    }
    return true;
  }

  rest() {
    if (this.state.mode === "resting") return false;
    const previous = this.state;
    const next = reducePetState(previous, { type: "REST" });
    if (next.mode !== "resting") return false;
    this.restResumeState = previous;
    this.state = next;
    return true;
  }

  resume() {
    if (this.state.mode !== "resting" || !this.restResumeState) return false;
    this.state = reducePetState(this.state, { type: "RESUME", resumeState: this.restResumeState });
    this.restResumeState = null;
    return true;
  }

  beginSpeech() {
    if (this.state.mode === "speaking") return false;
    const previous = this.state;
    const next = reducePetState(previous, { type: "SPEAK" });
    if (next.mode !== "speaking") return false;
    if (previous.mode === "attached" && ATTACHED_RECOVERY_ACTIONS.has(this.attachment?.pose)) {
      this.speechResumeState = Object.freeze({ state: previous, action: this.attachment.pose });
    } else if (previous.mode === "crawling") {
      this.speechResumeState = Object.freeze({ state: previous, action: "crawl" });
    } else {
      this.speechResumeState = Object.freeze({ state: initialState(), action: "idle" });
    }
    this.state = next;
    return true;
  }

  finishSpeech() {
    if (this.state.mode !== "speaking" || !this.speechResumeState) return false;
    const recovery = this.speechResumeState;
    this.state = reducePetState(this.state, {
      type: "SPEECH_COMPLETE",
      resumeState: recovery.state
    });
    this.speechResumeState = null;
    return recovery.action;
  }

  setScale(scale) {
    if (!Number.isFinite(scale) || scale < 1 || scale > 2) return false;
    this.body = {
      ...this.body,
      width: this.baseSize.width * scale,
      height: this.baseSize.height * scale
    };
    this.currentScale = scale;
    if (this.attachment && !this.behindEscape) this.syncObstacles();
    else this.#renderBody();
    if (this.frameHitBox && this.state.mode !== "falling") {
      this.#showCurrentHitRegion();
    }
    return true;
  }

  startCrawl(direction = "right") {
    if (!["left", "right"].includes(direction)) return false;
    const next = reducePetState(this.state, { type: "CRAWL" });
    if (next.mode !== "crawling" || this.state.mode === "crawling") return false;
    this.state = next;
    this.#clearAutoClimb();
    this.#playAnimation("crawl", undefined, false, direction);
    return true;
  }

  setCrawlDirection(direction) {
    if (this.state.mode !== "crawling" || !["left", "right"].includes(direction)) return false;
    return this.#playAnimation("crawl", undefined, false, direction);
  }

  stopCrawl() {
    if (this.state.mode !== "crawling") return false;
    this.state = reducePetState(this.state, { type: "CRAWL_COMPLETE" });
    this.#clearAutoClimb();
    this.#playAnimation("idle");
    return true;
  }

  moveCrawl(dx, dy, workArea, { dtMs = 0, nowMs = 0 } = {}) {
    if (this.state.mode !== "crawling") {
      return { body: { ...this.body }, moved: false, fullyMoved: false, blockedAxes: [], climbCandidate: null };
    }
    if (![dx, dy, dtMs, nowMs].every(Number.isFinite) || dtMs < 0
      || !workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)
      || workArea.width <= 0 || workArea.height <= 0) {
      throw new TypeError("crawl movement, timing and work area must be finite");
    }
    const obstacles = this.obstacleIndex.snapshot();
    const result = resolveCrawlStep({ body: this.body, dx, dy, workArea, obstacles });
    if (!result.moved) {
      // 被障碍完全覆盖时，允许朝能最终离开该障碍的方向移动，避免永久卡死。
      // 其余障碍仍保持实体：终点不得撞入任何非覆盖源障碍。
      const candidate = {
        x: Math.min(Math.max(this.body.x + dx, workArea.x), workArea.x + workArea.width - this.body.width),
        y: Math.min(Math.max(this.body.y + dy, workArea.y), workArea.y + workArea.height - this.body.height),
        width: this.body.width,
        height: this.body.height
      };
      const coveredSource = obstacles.some(obstacle =>
        canEscapeCoveredObstacle(this.body, obstacle.rect, candidate, workArea));
      const clearOfOthers = obstacles.every(obstacle =>
        canEscapeCoveredObstacle(this.body, obstacle.rect, candidate, workArea)
        || !intersects(candidate, obstacle.rect));
      if (coveredSource && clearOfOthers) {
        const xClamped = candidate.x !== this.body.x + dx;
        const yClamped = candidate.y !== this.body.y + dy;
        const blockedAxes = Object.freeze([
          xClamped && dx !== 0 ? "x" : null,
          yClamped && dy !== 0 ? "y" : null
        ].filter(Boolean));
        const fullyMoved = !xClamped && !yClamped;
        this.#moveBody(candidate.x, candidate.y);
        if (fullyMoved) this.autoClimbBlockedMs = 0;
        else if (blockedAxes.includes("x")) this.autoClimbBlockedMs += dtMs;
        return Object.freeze({
          body: { ...candidate },
          moved: candidate.x !== result.body.x || candidate.y !== result.body.y,
          fullyMoved,
          blockedAxes,
          climbCandidate: null
        });
      }
    } else {
      this.#moveBody(result.body.x, result.body.y);
    }

    if (result.fullyMoved) {
      this.autoClimbBlockedMs = 0;
    } else if (result.blockedAxes.includes("x")) {
      this.autoClimbBlockedMs += dtMs;
    }
    const climbCandidate = result.contactCandidate !== null && this.autoClimbBlockedMs >= this.autoClimbThresholdMs
      ? result.contactCandidate
      : null;
    return Object.freeze({
      body: { ...result.body },
      moved: result.moved,
      fullyMoved: result.fullyMoved,
      blockedAxes: result.blockedAxes,
      climbCandidate
    });
  }

  beginAutoClimb(candidate) {
    if (this.state.mode !== "crawling" || !candidate || typeof candidate !== "object") return false;
    const { target, edge, t } = candidate;
    if (!target || typeof target !== "object"
      || target.source !== "window" || typeof target.id !== "string") return false;
    if (edge !== "left" && edge !== "right") return false;
    if (!Number.isFinite(t) || t < 0 || t > 1) return false;

    const current = this.obstacleIndex.snapshot().find(obstacle => sameIdentity(obstacle, target));
    if (!current || current.source !== "window") return false;
    let attachment;
    try {
      attachment = createAttachment(current, edge, t, "wall-climb");
    } catch {
      return false;
    }

    const previousState = this.state;
    const previousAttachment = this.attachment;
    const previousBody = this.body;
    const nextState = reducePetState(previousState, { type: "AUTO_ATTACH" });
    if (nextState.mode !== "attached") return false;

    this.state = nextState;
    this.attachment = attachment;
    this.autoClimb = { entryBody: { ...previousBody } };
    this.autoClimbBlockedMs = 0;
    if (!this.#playAnimation("wall-climb", undefined, false, this.#attachmentFacing())) {
      this.state = previousState;
      this.attachment = previousAttachment;
      this.body = previousBody;
      this.autoClimb = null;
      return false;
    }
    return true;
  }

  isAutoClimbing() {
    return Boolean(this.autoClimb && this.state.mode === "attached");
  }

  planBehindWindowEscape(target, workArea) {
    if (!target || !Number.isSafeInteger(target.hwnd) || target.hwnd <= 0) return null;
    try {
      return planBehindWindowEscape({ body: this.body, target,
        obstacles: this.obstacleIndex.snapshot(), clearance: 1, workArea });
    } catch {
      return null;
    }
  }

  beginBehindWindowEscape(plan, workArea) {
    if (this.behindEscape || this.isBackgroundPaused() || !this.layerCoordinator || !plan) return false;
    const next = reducePetState(this.state, { type: "ENTER_BEHIND_WINDOW", automatic: this.isAutoClimbing() });
    if (next.mode !== "behind-window") return false;
    const currentPlan = this.planBehindWindowEscape(plan.target, workArea);
    const speed = plan.speed ?? this.autoClimbSpeed / 1000;
    if (!currentPlan || !Number.isFinite(speed) || speed <= 0
      || !Array.isArray(plan.points) || plan.points.length !== currentPlan.points.length
      || !plan.points.every((point, index) => point && point.x === currentPlan.points[index].x
        && point.y === currentPlan.points[index].y)) return false;

    this.behindEscape = { target: currentPlan.target, lastRect: currentPlan.target.rect,
      points: currentPlan.points, segmentIndex: 1, speed,
      bodySize: { width: this.body.width, height: this.body.height }, workArea };
    try {
      this.setInputBlocked("behind-window", true);
      this.hideBubble();
      if (!this.layerCoordinator.apply({ backgroundPaused: false, behindTarget: currentPlan.target })) {
        throw new Error("behind layer rejected");
      }
      this.state = next;
      return true;
    } catch {
      this.behindEscape = null;
      try { this.layerCoordinator.restoreNormal(); } catch {}
      this.setInputBlocked("behind-window", false);
      return false;
    }
  }

  #refreshBehindTarget() {
    const session = this.behindEscape;
    if (!session) return false;
    const current = this.obstacleIndex.snapshot().find(obstacle => sameIdentity(obstacle, session.target));
    if (!current) return false;
    if (["x", "y", "width", "height"].some(key => current.rect[key] !== session.lastRect[key])
      || this.body.width !== session.bodySize.width || this.body.height !== session.bodySize.height) {
      if (!intersects(this.body, current.rect)) return false;
      const plan = this.planBehindWindowEscape(current, session.workArea);
      if (!plan) return false;
      session.target = plan.target;
      session.lastRect = plan.target.rect;
      session.points = plan.points;
      session.segmentIndex = 1;
      session.bodySize = { width: this.body.width, height: this.body.height };
    }
    return true;
  }

  reapplyLayer(backgroundPaused = this.isBackgroundPaused()) {
    if (!backgroundPaused && this.behindEscape && !this.#refreshBehindTarget()) {
      this.supportLost();
      return this.layerCoordinator.restoreNormal();
    }
    let applied = false;
    try {
      applied = this.layerCoordinator.apply({ backgroundPaused, behindTarget: this.behindEscape?.target });
    } catch {}
    if (!applied && !backgroundPaused && this.behindEscape) this.supportLost();
    return applied;
  }

  advanceBehindWindowEscape(dtMs) {
    const idle = { moved: false, completed: false, targetInvalid: false };
    if (!this.behindEscape || this.isBackgroundPaused()) return idle;
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError("dtMs must be non-negative");
    if (!this.#refreshBehindTarget()) {
      this.supportLost();
      return { ...idle, targetInvalid: true };
    }
    const session = this.behindEscape;
    let remaining = session.speed * dtMs;
    let moved = false;
    while (session.segmentIndex < session.points.length) {
      const point = session.points[session.segmentIndex];
      const dx = point.x - this.body.x;
      const dy = point.y - this.body.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) { session.segmentIndex++; continue; }
      if (remaining <= 0) break;
      const step = Math.min(remaining, distance);
      const previousBody = this.body;
      try {
        this.#moveBody(step === distance ? point.x : this.body.x + dx / distance * step,
          step === distance ? point.y : this.body.y + dy / distance * step);
      } catch {
        this.body = previousBody;
        try { this.#renderBody(); } catch {}
        this.supportLost();
        return { ...idle, moved };
      }
      moved = true;
      remaining -= step;
      if (step === distance) session.segmentIndex++;
    }
    const completed = session.segmentIndex === session.points.length;
    if (completed) this.supportLost();
    return { moved, completed, targetInvalid: false };
  }

  advanceAutoClimb(dtMs, workArea) {
    const idle = { moved: false, stalled: false, target: null, atEdge: false };
    if (!this.autoClimb || this.state.mode !== "attached") return idle;
    if (!Number.isFinite(dtMs) || dtMs < 0) throw new RangeError("dtMs must be non-negative");
    if (!workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)) {
      throw new TypeError("work area must be finite");
    }

    const obstacles = this.obstacleIndex.snapshot();
    const current = obstacles.find(obstacle =>
      this.attachment && sameIdentity(obstacle, this.attachment.target));
    if (!current || !this.attachment) {
      return { moved: false, stalled: true, target: null, atEdge: false };
    }
    const edgeLength = current.rect.height;
    if (edgeLength <= 0) return { moved: false, stalled: true, target: null, atEdge: false };

    const direction = this.attachment.t < 0.5 ? -1 : 1;
    const nextT = Math.min(1, Math.max(0,
      this.attachment.t + direction * this.autoClimbSpeed * (dtMs / 1000) / edgeLength));
    const resolved = resolveAttachment({ ...this.attachment, t: nextT }, current.rect);
    const point = this.#attachedBodyPoint(resolved.point);
    const nextBody = { ...this.body, x: point.x, y: point.y };

    if (this.autoClimb.firstStep !== false) {
      const jump = Math.hypot(nextBody.x - this.autoClimb.entryBody.x, nextBody.y - this.autoClimb.entryBody.y);
      if (jump > this.autoClimbSpeed * (dtMs / 1000) + this.autoClimbAnchorTolerance) {
        return { moved: false, stalled: true, target: this.#targetInfo(current), atEdge: false };
      }
      this.autoClimb.firstStep = false;
    }
    const intersectsWindow = obstacles.some(obstacle =>
      !sameIdentity(obstacle, current) && intersects(nextBody, obstacle.rect));
    if (intersectsWindow) {
      return { moved: false, stalled: true, target: this.#targetInfo(current), atEdge: false };
    }

    const moved = nextBody.x !== this.body.x || nextBody.y !== this.body.y;
    this.attachment = resolved.anchor;
    if (moved) this.#moveBody(nextBody.x, nextBody.y);
    return {
      moved,
      stalled: false,
      target: this.#targetInfo(current),
      atEdge: nextT <= 0 || nextT >= 1
    };
  }

  #targetInfo(obstacle) {
    const target = {
      id: obstacle.id,
      source: obstacle.source,
      rect: cloneRect(obstacle.rect)
    };
    if (Object.hasOwn(obstacle, "hwnd")) target.hwnd = obstacle.hwnd;
    return Object.freeze(target);
  }

  #clearAutoClimb() {
    this.autoClimb = null;
    this.autoClimbBlockedMs = 0;
  }

  supportLost() {
    if (this.behindEscape) {
      this.behindEscape = null;
      this.attachment = null;
      this.frameHitBox = null;
      try { this.layerCoordinator.restoreNormal(); } catch {}
      this.setInputBlocked("behind-window", false);
      this.body = { ...this.body, vx: 0, vy: 0 };
    }
    const previous = this.state;
    this.state = reducePetState(this.state, { type: "SUPPORT_LOST" });
    if (this.state.mode !== "falling") return false;
    this.attachment = null;
    this.frameHitBox = null;
    this.restResumeState = null;
    this.speechResumeState = null;
    this.#clearAutoClimb();
    this.#hideHitRegion();
    this.#playAnimation("fall", undefined, true);
    return previous !== this.state || previous.mode === "falling";
  }

  syncObstacles() {
    if (this.behindEscape) {
      if (this.isBackgroundPaused()) return true;
      return !this.advanceBehindWindowEscape(0).targetInvalid;
    }
    if (!this.attachment?.target?.id) return false;
    const target = this.obstacleIndex.snapshot().find(obstacle =>
      obstacle.id === this.attachment.target.id
      && (!this.attachment.target.source || obstacle.source === this.attachment.target.source)
      && (!Object.hasOwn(this.attachment.target, "hwnd")
        || obstacle.hwnd === this.attachment.target.hwnd)
    );
    if (!target) {
      this.supportLost();
      return false;
    }

    let resolved;
    try {
      resolved = resolveAttachment(this.attachment, target.rect);
    } catch {
      this.supportLost();
      return false;
    }
    this.attachment = resolved.anchor;
    const point = this.#attachedBodyPoint(resolved.point);
    this.#moveBody(point.x, point.y);
    return true;
  }

  tick(dtMs, workArea) {
    if (this.state.mode !== "falling") {
      return { body: { ...this.body }, landing: null };
    }
    const options = { ...(this.gravity === undefined ? {} : { gravity: this.gravity }),
      ...(workArea === undefined ? {} : { workArea }) };
    const result = stepFall(this.body, this.obstacleIndex.snapshot(), dtMs, options);
    this.body = result.body;
    this.#renderBody();
    this.#hideHitRegion();
    if (result.landing) {
      this.state = reducePetState(this.state, { type: "LAND" });
      this.#clearAutoClimb();
      if (!this.#playAnimation("land", () => {
        this.state = reducePetState(this.state, { type: "ACTION_COMPLETE" });
      }, true)) {
        this.state = reducePetState(this.state, { type: "ACTION_COMPLETE" });
      }
    }
    return result;
  }

  setFrameHitBox(hitBox) {
    if (this.state.mode === "falling" || !validHitBox(hitBox)) {
      this.frameHitBox = null;
      this.#hideHitRegion();
      return false;
    }
    this.frameHitBox = {
      x: hitBox.x,
      y: hitBox.y,
      width: hitBox.width,
      height: hitBox.height
    };
    this.#showCurrentHitRegion();
    return true;
  }

  setFrameSupportAnchor(action, anchor) {
    if (this.state.mode !== "attached" || action !== this.attachment?.pose
      || !anchor || ![anchor.x, anchor.y].every(Number.isFinite)
      || anchor.x < 0 || anchor.y < 0) {
      return false;
    }
    this.frameSupportAnchor = { x: anchor.x, y: anchor.y };
    return this.syncObstacles();
  }

  #startDrag(point) {
    const nextState = reducePetState(this.state, { type: "DRAG_START" });
    if (nextState.mode !== "dragging") return { accepted: false };
    this.state = nextState;
    this.attachment = null;
    this.frameSupportAnchor = null;
    this.#clearAutoClimb();
    this.dragOffset = { x: this.body.x - point.x, y: this.body.y - point.y };
    this.#playAnimation("drag");
    return { accepted: true };
  }

  #cancelDrag() {
    if (this.state.mode !== "dragging") return false;
    this.state = initialState();
    this.dragOffset = null;
    this.attachment = null;
    this.frameSupportAnchor = null;
    this.#playAnimation("idle");
    return true;
  }

  #moveDrag(point) {
    if (this.state.mode !== "dragging" || !this.dragOffset) return { accepted: false };
    this.#moveBody(point.x + this.dragOffset.x, point.y + this.dragOffset.y);
    return { accepted: true };
  }

  #endDrag(point) {
    if (this.state.mode !== "dragging") return { accepted: false };
    const release = findReleaseZone(point, this.obstacleIndex.snapshot(), this.releaseThreshold);
    const pose = chooseReleasePose(release.zone, this.choosePose, release.t);
    this.dragOffset = null;
    this.#clearAutoClimb();

    if (release.zone === "open") {
      this.attachment = null;
      this.state = reducePetState(this.state, { type: "DRAG_END_OPEN", pose });
      const completed = pose === "land"
        ? () => { this.state = reducePetState(this.state, { type: "ACTION_COMPLETE" }); }
        : undefined;
      if (!this.#playAnimation(pose, completed, pose === "land") && completed) completed();
      return { accepted: true, zone: release.zone, pose };
    }

    this.attachment = createAttachment(release.target, release.edge, release.t, pose);
    this.frameSupportAnchor = null;
    this.state = reducePetState(this.state, { type: "DRAG_END_ATTACH" });
    this.syncObstacles();
    this.#playAnimation(pose, undefined, false, this.#attachmentFacing());
    return { accepted: true, zone: release.zone, pose };
  }

  #playAnimation(action, onComplete, force = false, facing) {
    return Boolean(this.animationBridge.play(action, { force, onComplete, facing }));
  }

  #attachmentFacing() {
    return this.attachment?.edge === "right" ? "left" : "right";
  }

  #attachedBodyPoint(edgePoint) {
    const anchor = this.frameSupportAnchor || this.poseAnchors[this.attachment?.pose];
    if (!anchor) return edgePoint;
    const scaledX = anchor.x * this.currentScale;
    const anchorX = this.#attachmentFacing() === "left" ? this.body.width - scaledX : scaledX;
    return {
      x: edgePoint.x - anchorX,
      y: edgePoint.y - anchor.y * this.currentScale
    };
  }

  #moveBody(x, y) {
    this.body = { ...this.body, x, y };
    this.#renderBody();
    if (this.frameHitBox) this.#showCurrentHitRegion();
  }

  #renderBody() {
    if (this.renderWindow?.render) {
      this.renderWindow.render({ ...this.body }, { dragging: this.state.mode === "dragging" });
      return;
    }
    this.renderWindow?.setBounds?.({
      x: Math.round(this.body.x),
      y: Math.round(this.body.y),
      width: Math.max(1, Math.round(this.body.width)),
      height: Math.max(1, Math.round(this.body.height))
    });
  }

  #hideHitRegion() {
    if (!this.hitRegionVisible) return false;
    this.hitWindow?.hide?.();
    this.hitRegionVisible = false;
    return true;
  }

  #showCurrentHitRegion() {
    if (!this.frameHitBox || this.state.mode === "falling" || !this.inputEnabled) return false;
    this.hitWindow?.setBounds?.({
      x: Math.round(this.body.x + this.frameHitBox.x * this.currentScale),
      y: Math.round(this.body.y + this.frameHitBox.y * this.currentScale),
      width: Math.max(1, Math.ceil(this.frameHitBox.width * this.currentScale)),
      height: Math.max(1, Math.ceil(this.frameHitBox.height * this.currentScale))
    });
    if (!this.hitRegionVisible) {
      this.hitWindow?.showInactive?.();
      this.hitRegionVisible = true;
    }
    return true;
  }
}

module.exports = { INPUT_ACTIONS, isTrustedIpcSender, PetController, validatePetAction };
