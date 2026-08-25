(function animationPlayerModule(global) {
  const validateManifest = typeof module === "object" && module.exports
    ? require("../domain/animation-manifest").validateManifest
    : global.DesktopPetAnimationManifest?.validateManifest;

  function defaultScheduler() {
    if (typeof globalThis.requestAnimationFrame === "function") {
      return {
        request: (callback) => globalThis.requestAnimationFrame(callback),
        cancel: (id) => globalThis.cancelAnimationFrame(id)
      };
    }
    return {
      request: (callback) => setTimeout(callback, 16),
      cancel: (id) => clearTimeout(id)
    };
  }

  class AnimationPlayer {
    constructor(manifest, { clock, scheduler } = {}) {
      if (!validateManifest) throw new Error("Animation manifest validator is unavailable");
      this.manifest = validateManifest(manifest);
      this.clock = clock || (() => performance.now());
      this.scheduler = scheduler || defaultScheduler();
      this.action = undefined;
      this.actionName = undefined;
      this.currentFrame = undefined;
      this.currentFrameIndex = undefined;
      this.frozen = false;
      this.running = false;
      this.scheduledId = undefined;
      this.scheduleToken = 0;
    }

    play(actionName, { loop, onFrame, onComplete, force = false } = {}) {
      const action = this.manifest.actions[actionName];
      if (!action) throw new RangeError(`Unknown animation action: ${actionName}`);
      if (this.action && !this.completed && !this.action.interruptible && !force) return false;

      this.#cancelScheduled();
      this.action = action;
      this.actionName = actionName;
      this.shouldLoop = loop ?? action.loop;
      this.onFrame = onFrame;
      this.onComplete = onComplete;
      this.startedAt = this.clock();
      this.frozenElapsed = 0;
      this.currentFrameIndex = undefined;
      this.completed = false;
      this.frozen = false;
      this.running = true;
      this.#advance(0);
      this.#scheduleNext();
      return this;
    }

    freeze() {
      if (!this.running || this.frozen) return this;
      this.frozenElapsed = this.#elapsedAt(this.clock());
      this.#advance(this.frozenElapsed);
      if (!this.running) return this;
      this.frozen = true;
      this.running = false;
      this.#cancelScheduled();
      return this;
    }

    resume() {
      if (!this.frozen) return this;
      this.startedAt = this.clock() - this.frozenElapsed;
      this.frozen = false;
      this.running = true;
      this.#scheduleNext();
      return this;
    }

    #elapsedAt(now) {
      return Math.max(0, now - this.startedAt);
    }

    #advance(elapsed) {
      const rawIndex = Math.floor((elapsed * this.action.fps) / 1000);
      const frameCount = this.action.frames.length;
      const frameIndex = this.shouldLoop
        ? rawIndex % frameCount
        : Math.min(rawIndex, frameCount - 1);
      if (frameIndex !== this.currentFrameIndex) {
        this.currentFrameIndex = frameIndex;
        this.currentFrame = this.action.frames[frameIndex];
        this.onFrame?.(this.currentFrame, frameIndex, this.actionName);
      }
      if (!this.shouldLoop && rawIndex >= frameCount && !this.completed) {
        this.completed = true;
        this.running = false;
        this.#cancelScheduled();
        this.onComplete?.(this.actionName);
      }
    }

    #scheduleNext() {
      if (!this.running || this.frozen || this.scheduledId !== undefined) return;
      const token = ++this.scheduleToken;
      this.scheduledId = this.scheduler.request(() => {
        if (token !== this.scheduleToken) return;
        this.scheduledId = undefined;
        this.#advance(this.#elapsedAt(this.clock()));
        this.#scheduleNext();
      });
    }

    #cancelScheduled() {
      this.scheduleToken += 1;
      if (this.scheduledId !== undefined) {
        this.scheduler.cancel(this.scheduledId);
        this.scheduledId = undefined;
      }
    }
  }

  const api = { AnimationPlayer };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.DesktopPetAnimationPlayer = api;
}(typeof window === "undefined" ? globalThis : window));
