const EVENT_MODES = Object.freeze({
  IDLE: "idle",
  CRAWL: "crawling",
  RANDOM_ROAM: "crawling",
  DRAG_START: "dragging",
  ATTACH: "attached",
  SUPPORT_LOST: "falling",
  FALL: "falling",
  SPEAK: "speaking",
  REST: "resting",
  DUEL_START: "dueling"
});

const PRIORITY = Object.freeze({
  idle: 0,
  crawling: 1,
  landing: 2,
  resting: 2,
  attached: 3,
  dueling: 4,
  speaking: 5,
  dragging: 6,
  falling: 7
});

function initialState() {
  return Object.freeze({ mode: "idle" });
}

function canInterrupt(state, eventType) {
  const nextMode = EVENT_MODES[eventType];
  return nextMode !== undefined && PRIORITY[nextMode] > PRIORITY[state.mode];
}

function reducePetState(state, event) {
  if (state.mode === "resting") {
    if (event?.type === "SUPPORT_LOST") return Object.freeze({ mode: "falling" });
    if (event?.type === "RESUME" && event.resumeState && typeof event.resumeState.mode === "string") {
      return Object.freeze({ mode: event.resumeState.mode });
    }
    return state;
  }
  if (event?.type === "REST" && !["dragging", "falling", "speaking", "dueling", "landing"].includes(state.mode)) {
    return Object.freeze({ mode: "resting" });
  }
  if (state.mode === "speaking" && event?.type === "SPEECH_COMPLETE"
    && event.resumeState && typeof event.resumeState.mode === "string") {
    return Object.freeze({ mode: event.resumeState.mode });
  }
  if (state.mode === "dragging" && event?.type === "DRAG_END_ATTACH") {
    return Object.freeze({ mode: "attached" });
  }
  if (state.mode === "dragging" && event?.type === "DRAG_END_OPEN") {
    if (event.pose === "crawl") return Object.freeze({ mode: "crawling" });
    if (event.pose === "land") return Object.freeze({ mode: "landing" });
    return state;
  }
  if (state.mode === "falling" && event?.type === "LAND") {
    return Object.freeze({ mode: "landing" });
  }
  if (state.mode === "landing" && event?.type === "ACTION_COMPLETE") {
    return initialState();
  }
  if (state.mode === "crawling" && event?.type === "CRAWL_COMPLETE") {
    return initialState();
  }
  if (!canInterrupt(state, event?.type)) return state;

  return Object.freeze({ mode: EVENT_MODES[event.type] });
}

module.exports = { canInterrupt, initialState, reducePetState };
