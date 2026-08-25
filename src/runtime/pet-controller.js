const {
  chooseReleasePose,
  createAttachment,
  findReleaseZone,
  resolveAttachment
} = require("../domain/attachment");
const { stepFall } = require("../domain/fall");
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

class PetController {
  constructor({
    obstacleIndex,
    animationBridge,
    body,
    renderWindow,
    hitWindow,
    choosePose = choices => choices[0],
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
    this.gravity = gravity;
    this.releaseThreshold = releaseThreshold;
    this.state = initialState();
    this.attachment = null;
    this.dragOffset = null;
    this.frameHitBox = null;
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
    this.#renderBody();
    if (this.frameHitBox && this.state.mode !== "falling") {
      this.#hideHitRegion();
      this.#showCurrentHitRegion();
    }
    return true;
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
    this.#moveBody(resolved.point.x, resolved.point.y);
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

  #startDrag(point) {
    const nextState = reducePetState(this.state, { type: "DRAG_START" });
    if (nextState.mode !== "dragging") return { accepted: false };
    this.state = nextState;
    this.attachment = null;
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
    this.state = reducePetState(this.state, { type: "DRAG_END_ATTACH" });
    this.syncObstacles();
    this.#playAnimation(pose);
    return { accepted: true, zone: release.zone, pose };
  }

  #playAnimation(action, onComplete, force = false) {
    return Boolean(this.animationBridge.play(action, { force, onComplete }));
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
