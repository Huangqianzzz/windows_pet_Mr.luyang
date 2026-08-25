const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("loads browser-safe animation dependencies before the renderer", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "render", "pet.html"), "utf8");

  assert.ok(html.indexOf("../domain/animation-manifest.js") < html.indexOf("../runtime/animation-player.js"));
  assert.ok(html.indexOf("../runtime/animation-player.js") < html.indexOf("pet-renderer.js"));
});

test("bootstraps idle and applies its first sprite-sheet frame", async () => {
  const root = { children: [], append(child) { this.children.push(child); } };
  const rendererPath = path.join(__dirname, "..", "src", "render", "pet-renderer.js");
  const previousWindow = global.window;
  const previousDocument = global.document;
  const manifest = {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "sheets/idle.png", width: 30, height: 10 },
        fps: 10,
        loop: true,
        interruptible: true,
        frames: [{
          source: { x: 10, y: 0, width: 10, height: 10 },
          faceBox: { x: 2, y: 2, width: 4, height: 4 },
          hitBox: { x: 1, y: 1, width: 8, height: 8 },
          contacts: [{ x: 5, y: 10 }],
          supportAnchor: { x: 5, y: 10 }
        }]
      }
    }
  };
  let playedAction;
  class FakePlayer {
    constructor(receivedManifest) {
      this.manifest = receivedManifest;
    }

    play(actionName, { onFrame }) {
      playedAction = actionName;
      onFrame(this.manifest.actions[actionName].frames[0], 0, actionName);
    }
  }
  global.window = {
    location: { href: "file:///C:/pet/src/render/pet.html" },
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    DesktopPetAnimationPlayer: { AnimationPlayer: FakePlayer }
  };
  global.document = {
    getElementById: (id) => (id === "pet-root" ? root : null),
    createElement: (tagName) => ({
      tagName,
      attributes: {},
      style: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    })
  };

  delete require.cache[require.resolve(rendererPath)];
  const renderer = require(rendererPath);
  assert.equal(typeof renderer.mountPet, "function");
  const mounted = renderer.mountPet({
    document: global.document,
    desktopPet: global.window.desktopPet,
    AnimationPlayer: FakePlayer,
    locationHref: global.window.location.href
  });
  await mounted.ready;

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].className, "pet-sprite");
  assert.equal(root.children[0].attributes["aria-hidden"], "true");
  assert.equal(playedAction, "idle");
  assert.equal(root.children[0].style.width, "10px");
  assert.equal(root.children[0].style.height, "10px");
  assert.equal(root.children[0].style.backgroundPosition, "-10px 0px");
  assert.equal(root.children[0].style.backgroundSize, "30px 10px");
  assert.equal(root.children[0].style.backgroundImage, "url(\"file:///C:/pet/assets/animations/sheets/idle.png\")");
  global.window = previousWindow;
  global.document = previousDocument;
});

test("renders from the player's frozen manifest after bootstrap data is tampered", async () => {
  const { AnimationPlayer } = require("../src/runtime/animation-player");
  const root = { children: [], append(child) { this.children.push(child); } };
  const renderer = require("../src/render/pet-renderer");
  const manifest = {
    version: 1,
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 20, height: 10 },
        fps: 10,
        loop: true,
        interruptible: true,
        frames: [{
          source: { x: 10, y: 0, width: 10, height: 10 },
          faceBox: { x: 2, y: 2, width: 4, height: 4 },
          hitBox: { x: 1, y: 1, width: 8, height: 8 },
          contacts: [{ x: 5, y: 10 }],
          supportAnchor: { x: 5, y: 10 }
        }]
      }
    }
  };
  class TamperingPlayer extends AnimationPlayer {
    constructor(bootstrapManifest) {
      super(bootstrapManifest, {
        clock: () => 0,
        scheduler: { request: () => 1, cancel: () => {} }
      });
      this.bootstrapManifest = bootstrapManifest;
    }

    play(actionName, options) {
      delete this.bootstrapManifest.actions.idle.sheet;
      return super.play(actionName, options);
    }
  }
  const document = {
    getElementById: () => root,
    createElement: () => ({ style: {}, setAttribute() {} })
  };
  const mounted = renderer.mountPet({
    document,
    desktopPet: { getBootstrap: () => Promise.resolve({ manifest }) },
    AnimationPlayer: TamperingPlayer,
    locationHref: "file:///C:/pet/src/render/pet.html"
  });

  await mounted.ready;

  assert.equal(root.children[0].style.backgroundImage, "url(\"file:///C:/pet/assets/animations/idle.png\")");
  assert.equal(root.children[0].style.backgroundPosition, "-10px 0px");
});
