const {
  chooseReleasePose,
  createAttachment,
  findReleaseZone,
  resolveAttachment
} = require("../domain/attachment");
const { stepFall } = require("../domain/fall");
const { clampRect, intersects } = require("../domain/geometry");
const { initialState, reducePetState } = require("../domain/pet-state");

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

function overlapArea(first, second) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
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
    choosePose = choices => choices[0],
    poseAnchors = {},
    gravity,
    releaseThreshold = 24
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

    this.obstacleIndex = obstacleIndex;
    this.animationBridge = animationBridge;
    this.body = { ...body };
    this.baseSize = { width: body.width, height: body.height };
    this.currentScale = 1;
    this.renderWindow = renderWindow;
    this.hitWindow = hitWindow;
    this.choosePose = choosePose;
    this.poseAnchors = Object.freeze(Object.fromEntries(Object.entries(poseAnchors || {}).map(([pose, anchor]) => {
      if (!anchor || ![anchor.x, anchor.y].every(Number.isFinite)) {
        throw new TypeError(`pose anchor ${pose} must be finite`);
      }
      return [pose, Object.freeze({ x: anchor.x, y: anchor.y })];
    })));
    this.gravity = gravity;
    this.releaseThreshold = releaseThreshold;
    this.state = initialState();
    this.attachment = null;
    this.dragOffset = null;
    this.frameHitBox = null;
    this.frameSupportAnchor = null;
    this.restResumeState = null;
    this.speechResumeState = null;
  }

  snapshot() {
    return {
      state: this.state,
      body: { ...this.body },
      attachment: this.attachment
    };
  }

  handleInput(action, payload) {
    const input = validatePetAction(action, payload);
    if (!input) return { accepted: false };
    if (action === "drag-start") return this.#startDrag(input.point);
    if (action === "drag-move") return this.#moveDrag(input.point);
    return this.#endDrag(input.point);
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
    if (this.attachment) this.syncObstacles();
    else this.#renderBody();
    if (this.frameHitBox && this.state.mode !== "falling") {
      this.#hideHitRegion();
      this.#showCurrentHitRegion();
    }
    return true;
  }

  startCrawl(direction = "right") {
    if (!["left", "right"].includes(direction)) return false;
    const next = reducePetState(this.state, { type: "CRAWL" });
    if (next.mode !== "crawling" || this.state.mode === "crawling") return false;
    this.state = next;
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
    this.#playAnimation("idle");
    return true;
  }

  moveCrawl(dx, dy, workArea) {
    if (this.state.mode !== "crawling") return { moved: false, blocked: false };
    if (![dx, dy].every(Number.isFinite)
      || !workArea || ![workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)
      || workArea.width <= 0 || workArea.height <= 0) {
      throw new TypeError("crawl movement and work area must be finite");
    }
    const desired = { ...this.body, x: this.body.x + dx, y: this.body.y + dy };
    const candidate = clampRect(desired, workArea);
    const blockedByBounds = candidate.x !== desired.x || candidate.y !== desired.y;
    const blockedByObstacle = this.obstacleIndex.snapshot().some(obstacle => {
      if (!obstacle?.rect || !intersects(candidate, obstacle.rect)) return false;
      if (!intersects(this.body, obstacle.rect)) return true;
      if (canEscapeCoveredObstacle(this.body, obstacle.rect, candidate, workArea)) return false;
      return overlapArea(candidate, obstacle.rect) >= overlapArea(this.body, obstacle.rect);
    });
    if (blockedByObstacle) return { moved: false, blocked: true };
    const moved = candidate.x !== this.body.x || candidate.y !== this.body.y;
    if (moved) this.#moveBody(candidate.x, candidate.y);
    return { moved, blocked: blockedByBounds };
  }

  supportLost() {
    const previous = this.state;
    this.state = reducePetState(this.state, { type: "SUPPORT_LOST" });
    if (this.state.mode !== "falling") return false;
    this.attachment = null;
    this.frameHitBox = null;
    this.restResumeState = null;
    this.speechResumeState = null;
    this.#hideHitRegion();
    this.#playAnimation("fall", undefined, true);
    return previous !== this.state || previous.mode === "falling";
  }

  syncObstacles() {
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

  tick(dtMs) {
    if (this.state.mode !== "falling") {
      return { body: { ...this.body }, landing: null };
    }
    const options = this.gravity === undefined ? undefined : { gravity: this.gravity };
    const result = stepFall(this.body, this.obstacleIndex.snapshot(), dtMs, options);
    this.body = result.body;
    this.#renderBody();
    this.#hideHitRegion();
    if (result.landing) {
      this.state = reducePetState(this.state, { type: "LAND" });
      if (!this.#playAnimation("land", () => {
        this.state = reducePetState(this.state, { type: "ACTION_COMPLETE" });
      }, true)) {
        this.state = reducePetState(this.state, { type: "ACTION_COMPLETE" });
      }
    }
    return result;
  }

  setFrameHitBox(hitBox) {
    this.frameHitBox = null;
    this.#hideHitRegion();
    if (this.state.mode === "falling" || !validHitBox(hitBox)) return false;
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
    this.dragOffset = { x: this.body.x - point.x, y: this.body.y - point.y };
    this.#playAnimation("drag");
    return { accepted: true };
  }

  #moveDrag(point) {
    if (this.state.mode !== "dragging" || !this.dragOffset) return { accepted: false };
    this.#moveBody(point.x + this.dragOffset.x, point.y + this.dragOffset.y);
    return { accepted: true };
  }

  #endDrag(point) {
    if (this.state.mode !== "dragging") return { accepted: false };
    const release = findReleaseZone(point, this.obstacleIndex.snapshot(), this.releaseThreshold);
    const pose = chooseReleasePose(release.zone, this.choosePose);
    this.dragOffset = null;

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
    if (this.frameHitBox) {
      this.#hideHitRegion();
      this.#showCurrentHitRegion();
    }
  }

  #renderBody() {
    this.renderWindow?.setBounds?.({
      x: Math.round(this.body.x),
      y: Math.round(this.body.y),
      width: Math.max(1, Math.round(this.body.width)),
      height: Math.max(1, Math.round(this.body.height))
    });
  }

  #hideHitRegion() {
    this.hitWindow?.hide?.();
  }

  #showCurrentHitRegion() {
    if (!this.frameHitBox || this.state.mode === "falling") return;
    this.hitWindow?.setBounds?.({
      x: Math.round(this.body.x + this.frameHitBox.x * this.currentScale),
      y: Math.round(this.body.y + this.frameHitBox.y * this.currentScale),
      width: Math.max(1, Math.ceil(this.frameHitBox.width * this.currentScale)),
      height: Math.max(1, Math.ceil(this.frameHitBox.height * this.currentScale))
    });
    this.hitWindow?.showInactive?.();
  }
}

module.exports = { INPUT_ACTIONS, isTrustedIpcSender, PetController, validatePetAction };
