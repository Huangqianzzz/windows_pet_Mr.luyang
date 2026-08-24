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
  if (!canInterrupt(state, event?.type)) return state;

  return Object.freeze({ mode: EVENT_MODES[event.type] });
}

module.exports = { canInterrupt, initialState, reducePetState };
