(function mountBubble(global) {
  const bubble = global.document?.getElementById("speech-bubble");
  if (!bubble) return;
  global.addEventListener("desktop-pet:bubble-update", event => {
    if (event.detail?.text === "爸爸" || event.detail?.text === "我错了") {
      bubble.textContent = event.detail.text;
    }
  });
}(typeof window === "undefined" ? globalThis : window));
