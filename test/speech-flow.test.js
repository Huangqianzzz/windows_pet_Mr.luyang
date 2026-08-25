const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

function fakeSpeechProcess(output, calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    let stdin = "";
    child.stdin.on("data", chunk => { stdin += chunk; });
    child.stdin.on("finish", () => { calls.push({ command, args, options, stdin }); });
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.end(JSON.stringify(output));
      child.emit("close", 0);
    });
    return child;
  };
}

test("passes exact Chinese text over stdin to a static PowerShell command without a shell", async () => {
  const { speakChinese } = require("../src/runtime/speech");
  const calls = [];

  const result = await speakChinese("爸爸", 80, {
    platform: "win32",
    spawnImpl: fakeSpeechProcess({ spoken: true, voiceCulture: "zh-CN" }, calls)
  });

  assert.deepEqual(result, { spoken: true, voiceCulture: "zh-CN" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.toLowerCase(), "powershell.exe");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].args.join(" ").includes("爸爸"), false);
  assert.deepEqual(JSON.parse(calls[0].stdin), { text: "爸爸", volume: 80 });
});

test("allows only the two exact phrases and reports a missing Chinese voice", async () => {
  const { speakChinese } = require("../src/runtime/speech");
  let spawned = 0;
  const invalid = await speakChinese("爸爸; Stop-Computer", 100, {
    platform: "win32",
    spawnImpl() { spawned += 1; }
  });
  const missing = await speakChinese("我错了", 100, {
    platform: "win32",
    spawnImpl: fakeSpeechProcess({ spoken: false, reason: "missing-zh-voice" }, [])
  });

  assert.deepEqual(invalid, { spoken: false, reason: "invalid-text" });
  assert.deepEqual(missing, { spoken: false, reason: "missing-zh-voice" });
  assert.equal(spawned, 0);
});

test("continues to the second Chinese SAPI voice when the first cannot be selected", () => {
  const { POWERSHELL_SCRIPT } = require("../src/runtime/speech");
  const script = POWERSHELL_SCRIPT.toLowerCase();
  const loop = script.indexOf("foreach ($voice in $voices)");
  const selection = script.indexOf("$synth.selectvoice($voice.name)", loop);
  const continueAfterFailure = script.indexOf("continue", selection);
  const selected = script.indexOf("return $voice", continueAfterFailure);
  const fallback = script.indexOf("reason = 'missing-zh-voice'", selected);

  assert.ok(loop >= 0);
  assert.ok(selection > loop);
  assert.ok(continueAfterFailure > selection);
  assert.ok(selected > continueAfterFailure);
  assert.ok(fallback > selected);
  assert.match(POWERSHELL_SCRIPT, /voiceCulture\s*=\s*\$selectedVoice\.Culture\.Name/);
});

test("the PowerShell selector tries a second zh voice after the first SelectVoice failure", {
  skip: process.platform !== "win32"
}, () => {
  const { POWERSHELL_VOICE_SELECTOR } = require("../src/runtime/speech");
  const script = `class FakeSynth {
  [string[]] $Calls = @()
  [void] SelectVoice([string] $name) {
    $this.Calls += $name
    if ($name -eq 'disabled') { throw 'disabled' }
  }
}
${POWERSHELL_VOICE_SELECTOR}
$synth = [FakeSynth]::new()
$voices = @([pscustomobject]@{Name='disabled'}, [pscustomobject]@{Name='working'})
$selected = Select-FirstChineseVoice -Synth $synth -Voices $voices
[Console]::Out.WriteLine((@{ selected = $selected.Name; calls = $synth.Calls } | ConvertTo-Json -Compress))`;
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")
  ], { encoding: "utf8", windowsHide: true });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    selected: "working",
    calls: ["disabled", "working"]
  });
});

test("sets PowerShell 5.1 stdin to UTF-8 before reading Chinese JSON", () => {
  const { POWERSHELL_SCRIPT } = require("../src/runtime/speech");

  assert.ok(POWERSHELL_SCRIPT.indexOf("[Console]::InputEncoding") >= 0);
  assert.ok(POWERSHELL_SCRIPT.indexOf("[Console]::InputEncoding")
    < POWERSHELL_SCRIPT.indexOf("[Console]::In.ReadToEnd()"));
});

test("sanitizes process errors and terminates a timed-out local TTS process", async () => {
  const { speakChinese } = require("../src/runtime/speech");
  let timeoutCallback;
  let killed = false;
  const timeout = await speakChinese("爸爸", 50, {
    platform: "win32",
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => { killed = true; };
      process.nextTick(() => timeoutCallback());
      return child;
    },
    setTimeoutImpl(callback) { timeoutCallback = callback; return 9; },
    clearTimeoutImpl() {}
  });
  const failed = await speakChinese("爸爸", 50, {
    platform: "win32",
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      process.nextTick(() => child.emit("error", new Error("C:\\Users\\secret\\voice.dll")));
      return child;
    }
  });

  assert.deepEqual(timeout, { spoken: false, reason: "tts-timeout" });
  assert.equal(killed, true);
  assert.deepEqual(failed, { spoken: false, reason: "tts-process-error" });
});

test("handles an early stdin EPIPE and terminates the still-running TTS child", async () => {
  const { speakChinese } = require("../src/runtime/speech");
  let killed = false;
  const result = await speakChinese("爸爸", 50, {
    platform: "win32",
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.exitCode = null;
      child.kill = () => { killed = true; };
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        process.nextTick(() => child.stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" })));
      };
      return child;
    }
  });

  assert.deepEqual(result, { spoken: false, reason: "tts-process-error" });
  assert.equal(killed, true);
});

test("aborts the active local SAPI child when the next user action dismisses speech", async () => {
  const { speakChinese } = require("../src/runtime/speech");
  const controller = new AbortController();
  let killed = false;
  const speaking = speakChinese("爸爸", 50, {
    platform: "win32",
    signal: controller.signal,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => { killed = true; };
      return child;
    }
  });

  controller.abort();

  assert.deepEqual(await speaking, { spoken: false, reason: "tts-cancelled" });
  assert.equal(killed, true);
});

test("runs kneel-frame, pink bubble, TTS, pause, hide, and safe recovery in exact order", async () => {
  const { createSpeechFlow } = require("../src/runtime/speech");
  const events = [];
  const flow = createSpeechFlow({
    beginSpeech() { events.push("cancel-interruptible"); return true; },
    async playKneel() { events.push("kneel-first-frame"); return true; },
    showBubble(text) { events.push(`pink-bubble:${text}`); return true; },
    async speak(text, volume) { events.push(`tts:${text}:${volume}`); return { spoken: true, voiceCulture: "zh-CN" }; },
    async pause() { events.push("pause"); },
    hideBubble() { events.push("hide-bubble"); },
    async recover(action) { events.push(`recover-animation:${action}`); },
    finishSpeech() { events.push("finish-state"); return "idle"; }
  });

  const result = await flow.run("我错了", 75);

  assert.deepEqual(result, { spoken: true, voiceCulture: "zh-CN" });
  assert.deepEqual(events, [
    "cancel-interruptible",
    "kneel-first-frame",
    "pink-bubble:我错了",
    "tts:我错了:75",
    "pause",
    "hide-bubble",
    "finish-state",
    "recover-animation:idle"
  ]);
});

test("keeps the bubble and speaking state until the next action when zh voice is missing", async () => {
  const { createSpeechFlow } = require("../src/runtime/speech");
  const events = [];
  const flow = createSpeechFlow({
    beginSpeech() { events.push("begin"); return true; },
    async playKneel() { events.push("kneel"); return true; },
    showBubble() { events.push("show"); },
    async speak() { events.push("missing"); return { spoken: false, reason: "missing-zh-voice" }; },
    async pause() { events.push("pause"); },
    hideBubble() { events.push("hide"); },
    async recover(action) { events.push(`recover:${action}`); },
    finishSpeech() { events.push("finish"); return "crawl"; }
  });

  const result = await flow.run("爸爸", 100);
  assert.deepEqual(result, { spoken: false, reason: "missing-zh-voice" });
  assert.deepEqual(flow.snapshot(), { active: true, bubbleVisible: true, heldForMissingVoice: true });
  assert.deepEqual(events, ["begin", "kneel", "show", "missing"]);

  await flow.dismiss();
  assert.deepEqual(events, ["begin", "kneel", "show", "missing", "hide", "finish", "recover:crawl"]);
  assert.deepEqual(flow.snapshot(), { active: false, bubbleVisible: false, heldForMissingVoice: false });
});

test("recovers state without TTS when the bubble cannot be shown", async () => {
  const { createSpeechFlow } = require("../src/runtime/speech");
  const events = [];
  const flow = createSpeechFlow({
    beginSpeech() { events.push("begin"); return true; },
    async playKneel() { events.push("kneel"); return true; },
    async showBubble() { events.push("show-failed"); return false; },
    async speak() { events.push("tts"); return { spoken: true, voiceCulture: "zh-CN" }; },
    hideBubble() { events.push("hide"); },
    async recover(action) { events.push(`recover:${action}`); },
    finishSpeech() { events.push("finish"); return "idle"; }
  });

  assert.deepEqual(await flow.run("爸爸", 50), { spoken: false, reason: "bubble-unavailable" });
  assert.deepEqual(events, ["begin", "kneel", "show-failed", "finish", "recover:idle"]);
  assert.deepEqual(flow.snapshot(), { active: false, bubbleVisible: false, heldForMissingVoice: false });
});

test("renderer command bridge accepts only whitelisted commands and exact result payloads", async () => {
  const { createRendererCommandBridge } = require("../src/runtime/speech");
  const sent = [];
  const bridge = createRendererCommandBridge({
    send(command) { sent.push(command); return true; },
    now: () => 1_000,
    timeoutMs: 5_000
  });
  const response = bridge.request("kneel");

  assert.deepEqual(sent, [{ id: 1, type: "kneel", expiresAt: 6_000 }]);
  assert.equal(Object.isFrozen(sent[0]), true);
  assert.equal(bridge.complete({ id: 1, accepted: true, action: "idle", extra: true }), false);
  assert.equal(bridge.complete({ id: 1, accepted: true, action: "idle" }), true);
  assert.deepEqual(await response, { id: 1, accepted: true, action: "idle" });
  assert.deepEqual(await bridge.request("run-arbitrary-code"), { id: 0, accepted: false });
  assert.deepEqual(await bridge.request("recover", "fall"), { id: 0, accepted: false });
});

test("renderer command bridge times out and disposes pending requests", async () => {
  const { createRendererCommandBridge } = require("../src/runtime/speech");
  const timeouts = [];
  const bridge = createRendererCommandBridge({
    send() { return true; },
    setTimeoutImpl(callback) { timeouts.push(callback); return timeouts.length; },
    clearTimeoutImpl() {}
  });
  const timedOut = bridge.request("kneel");
  timeouts[0]();
  assert.deepEqual(await timedOut, { id: 1, accepted: false, reason: "timeout" });

  const disposed = bridge.request("freeze");
  bridge.dispose();
  assert.deepEqual(await disposed, { id: 2, accepted: false, reason: "disposed" });
});

test("a renderer command that times out before bootstrap ready expires without changing the player", async () => {
  const { createRendererCommandBridge } = require("../src/runtime/speech");
  const { mountPet } = require("../src/render/pet-renderer");
  class CustomEvent { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
  const listeners = new Map();
  const results = [];
  const eventTarget = {
    CustomEvent,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) {
      if (event.type === "desktop-pet:interaction-result") results.push(event.detail);
      listeners.get(event.type)?.(event);
    }
  };
  let releaseBootstrap;
  const bootstrap = new Promise(resolve => { releaseBootstrap = resolve; });
  let clock = 10_000;
  let timeout;
  class Player {
    constructor(manifest) { this.manifest = manifest; this.calls = []; }
    play(action, options = {}) {
      this.calls.push(action);
      const frame = this.manifest.actions[action].frames[0];
      options.onFrame?.(frame, 0, action);
      return true;
    }
  }
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: () => bootstrap },
    AnimationPlayer: Player,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget,
    now: () => clock
  });
  const bridge = createRendererCommandBridge({
    send(command) {
      eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: command }));
      return true;
    },
    now: () => clock,
    timeoutMs: 5_000,
    setTimeoutImpl(callback) { timeout = callback; return 1; },
    clearTimeoutImpl() {}
  });

  const response = bridge.request("kneel");
  clock = 15_000;
  timeout();
  assert.deepEqual(await response, { id: 1, accepted: false, reason: "timeout" });

  const frame = {
    source: { x: 0, y: 0, width: 10, height: 10 },
    faceBox: { x: 2, y: 1, width: 5, height: 4 },
    hitBox: { x: 1, y: 1, width: 8, height: 8 }
  };
  releaseBootstrap({
    manifest: {
      actions: {
        idle: { sheet: { file: "idle.png", width: 10, height: 10 }, frames: [frame] },
        kneel: { sheet: { file: "kneel.png", width: 10, height: 10 }, frames: [frame] }
      }
    }
  });
  const player = await mounted.ready;

  assert.deepEqual(player.calls, ["idle"]);
  assert.deepEqual(results, [{ id: 1, accepted: false, reason: "expired" }]);
  assert.equal(bridge.complete(results[0]), false);
});

test("menu keeps the exact preview labels and disables unfinished duel actions", () => {
  const { MENU_LABELS, createMenuTemplate, isMenuAction } = require("../src/runtime/menu");
  const template = createMenuTemplate({
    settings: {
      petScale: 1,
      speechVolume: 100,
      launchAtLogin: false,
      autonomousActivity: true,
      autoDuel: false
    },
    onAction() {}
  });

  assert.deepEqual(MENU_LABELS, [
    "叫“爸爸”",
    "说“我错了”",
    "原地休息/恢复活动",
    "挑战螃蟹",
    "自动约战",
    "自主活动",
    "桌宠大小",
    "语音音量",
    "开机启动",
    "设置",
    "退出"
  ]);
  assert.deepEqual(template.map(item => item.label), MENU_LABELS);
  assert.equal(template.find(item => item.label === "挑战螃蟹").enabled, false);
  assert.equal(template.find(item => item.label === "自动约战").enabled, false);
  assert.equal(isMenuAction("speak-father"), true);
  assert.equal(isMenuAction("quit; Remove-Item C:\\"), false);

  const restingTemplate = createMenuTemplate({
    settings: {
      petScale: 1,
      speechVolume: 100,
      launchAtLogin: false,
      autonomousActivity: true,
      autoDuel: false
    },
    resting: true,
    onAction() {}
  });
  assert.equal(restingTemplate.find(item => item.label === "原地休息/恢复活动").checked, true);
});

test("renderer owns the only player for kneel fallback and exact-frame rest freeze/resume", async () => {
  const { mountPet } = require("../src/render/pet-renderer");
  class CustomEvent {
    constructor(type, { detail }) { this.type = type; this.detail = detail; }
  }
  const listeners = new Map();
  const results = [];
  const eventTarget = {
    CustomEvent,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) {
      if (event.type === "desktop-pet:interaction-result") results.push(event.detail);
      listeners.get(event.type)?.(event);
    }
  };
  const manifest = {
    actions: {
      idle: {
        sheet: { file: "idle.png", width: 10, height: 10 },
        frames: [{
          source: { x: 0, y: 0, width: 10, height: 10 },
          faceBox: { x: 2, y: 1, width: 5, height: 4 },
          hitBox: { x: 1, y: 1, width: 8, height: 8 }
        }]
      }
    }
  };
  class Player {
    constructor(received) { this.manifest = received; this.calls = []; this.frame = 7; }
    play(action, options) {
      this.calls.push(["play", action]);
      options.onFrame?.(this.manifest.actions[action].frames[0], this.frame, action);
      return this;
    }
    freeze() { this.calls.push(["freeze", this.frame]); return this; }
    resume() { this.calls.push(["resume", this.frame]); return this; }
  }
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: async () => ({ manifest }) },
    AnimationPlayer: Player,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget
  });
  const player = await mounted.ready;

  eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: { id: 1, type: "kneel", expiresAt: Number.MAX_SAFE_INTEGER } }));
  eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: { id: 2, type: "freeze", expiresAt: Number.MAX_SAFE_INTEGER } }));
  eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: { id: 3, type: "resume", expiresAt: Number.MAX_SAFE_INTEGER } }));

  assert.deepEqual(player.calls, [["play", "idle"], ["play", "idle"], ["freeze", 7], ["resume", 7]]);
  assert.deepEqual(results, [
    { id: 1, accepted: true, action: "idle" },
    { id: 2, accepted: true },
    { id: 3, accepted: true }
  ]);
});

test("renderer force-recovers a non-interruptible kneel to the whitelisted controller action", async () => {
  const { mountPet } = require("../src/render/pet-renderer");
  class CustomEvent { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
  const listeners = new Map();
  const results = [];
  const eventTarget = {
    CustomEvent,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) {
      if (event.type === "desktop-pet:interaction-result") results.push(event.detail);
      listeners.get(event.type)?.(event);
    }
  };
  const frame = {
    source: { x: 0, y: 0, width: 10, height: 10 },
    faceBox: { x: 2, y: 1, width: 5, height: 4 },
    hitBox: { x: 1, y: 1, width: 8, height: 8 }
  };
  const action = { sheet: { file: "idle.png", width: 10, height: 10 }, frames: [frame] };
  class Player {
    constructor(manifest) { this.manifest = manifest; this.locked = false; this.calls = []; }
    play(name, options = {}) {
      if (this.locked && !options.force) return false;
      this.calls.push({ name, force: Boolean(options.force) });
      this.locked = name === "kneel";
      options.onFrame?.(frame, 0, name);
      return this;
    }
  }
  const mounted = mountPet({
    document: {
      getElementById: () => ({ append() {} }),
      createElement: () => ({ style: {}, setAttribute() {} })
    },
    desktopPet: { getBootstrap: async () => ({ manifest: { actions: { idle: action, kneel: action, prone: action } } }) },
    AnimationPlayer: Player,
    locationHref: "file:///C:/pet/src/render/pet.html",
    eventTarget
  });
  await mounted.ready;
  eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", { detail: { id: 1, type: "kneel", expiresAt: Number.MAX_SAFE_INTEGER } }));
  eventTarget.dispatchEvent(new CustomEvent("desktop-pet:interaction-command", {
    detail: { id: 2, type: "recover", action: "prone", expiresAt: Number.MAX_SAFE_INTEGER }
  }));

  assert.deepEqual(results.slice(-2), [
    { id: 1, accepted: true, action: "kneel" },
    { id: 2, accepted: true, action: "prone" }
  ]);
  assert.deepEqual((await mounted.ready).calls.at(-1), { name: "prone", force: true });
});

test("main declares a non-focusable unclipped bubble window and trusted internal IPC gates", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /bubbleWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?transparent:\s*true/);
  assert.match(main, /bubbleWindow\s*=\s*new BrowserWindow\(\{[\s\S]*?focusable:\s*false/);
  assert.match(main, /bubbleWindow\.setIgnoreMouseEvents\(true\)/);
  assert.match(main, /desktop-pet:interaction-result/);
  assert.match(main, /desktop-pet:update-face-box/);
  assert.match(main, /isTrustedIpcSender\(event, petWindow\)/);
  assert.match(main, /Menu\.buildFromTemplate\(createMenuTemplate\(/);
  assert.match(main, /did-finish-load/);
  assert.match(main, /activeBubbleText/);
  assert.match(main, /liveWindowAdapter\(\(\) => petWindow, \(\) => repositionSpeechBubble\(\)\)/);
  assert.match(main, /createBubbleDisplayMonitor\(\{[\s\S]*?screen,[\s\S]*?reposition:\s*repositionSpeechBubble/);
  assert.match(main, /bubbleDisplayMonitor\?\.stop\(\)/);
  assert.match(main, /request\("recover",\s*action\)/);
  assert.match(main, /app\.isPackaged[\s\S]*?setAutostart/);
});

test("bubble document is local-only and visibly renders the two pink speech phrases", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "render", "bubble.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "render", "bubble.css"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "render", "bubble-renderer.js"), "utf8");

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /id="speech-bubble"/);
  assert.match(html, /bubble-renderer\.js/);
  assert.match(css, /background:\s*#[fF][fF][89][aA][bB][bB]/);
  assert.match(renderer, /desktop-pet:bubble-update/);
  assert.match(renderer, /textContent/);
});
