(function mountRenderer(global) {
  function isLocalAnimationAsset(file) {
    return typeof file === "string"
      && file.length > 0
      && !file.includes("\\")
      && !file.includes("%")
      && !file.includes(":")
      && !file.startsWith("/")
      && file.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
  }

  function animationAssetUrl(file, locationHref) {
    if (!isLocalAnimationAsset(file)) throw new TypeError("Sprite sheet must be a local animation asset");
    const url = new URL(`../../assets/animations/${file}`, locationHref);
    if (url.protocol !== "file:") throw new TypeError("Sprite sheet must resolve to a local file URL");
    return url.href;
  }

  function applyFrame(sprite, action, frame, locationHref) {
    const { source } = frame;
    sprite.style.width = `${source.width}px`;
    sprite.style.height = `${source.height}px`;
    sprite.style.backgroundImage = `url("${animationAssetUrl(action.sheet.file, locationHref)}")`;
    sprite.style.backgroundPosition = `${-source.x}px ${-source.y}px`;
    sprite.style.backgroundSize = `${action.sheet.width}px ${action.sheet.height}px`;
  }

  function mountPet({ document, desktopPet, AnimationPlayer, locationHref }) {
    const root = document.getElementById("pet-root");
    const sprite = document.createElement("div");
    sprite.className = "pet-sprite";
    sprite.setAttribute("aria-hidden", "true");
    root.append(sprite);

    const ready = desktopPet.getBootstrap()
      .then(({ manifest }) => {
        const player = new AnimationPlayer(manifest);
        player.play("idle", {
          onFrame: (frame, _frameIndex, actionName) => {
            applyFrame(sprite, player.manifest.actions[actionName], frame, locationHref);
          }
        });
        return player;
      })
      .catch(() => undefined);
    return { sprite, ready };
  }

  const api = { animationAssetUrl, applyFrame, mountPet };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  global.DesktopPetRenderer = api;
  if (global.document && global.desktopPet && global.DesktopPetAnimationPlayer) {
    mountPet({
      document: global.document,
      desktopPet: global.desktopPet,
      AnimationPlayer: global.DesktopPetAnimationPlayer.AnimationPlayer,
      locationHref: global.location.href
    });
  }
}(window));
