(function mountBubble(global) {
  const bubble = global.document?.getElementById("speech-bubble");
  if (!bubble) return;
  global.addEventListener("desktop-pet:bubble-update", event => {
    if (["爸爸", "我错了", "爸爸，我错了"].includes(event.detail?.text)) {
      bubble.textContent = event.detail.text;
    }
  });
}(typeof window === "undefined" ? globalThis : window));
