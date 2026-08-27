const { spawn } = require("node:child_process");

const ALLOWED_TEXT = new Set(["爸爸", "我错了"]);
const RENDERER_COMMANDS = new Set(["kneel", "freeze", "resume", "recover"]);
const RECOVERY_ACTIONS = new Set([
  "idle",
  "crawl",
  "sit",
  "prone",
  "legs-dangle",
  "wall-grab",
  "wall-climb",
  "hang"
]);
const POWERSHELL_VOICE_SELECTOR = `function Select-FirstChineseVoice {
  param($Synth, $Voices)
  foreach ($voice in $Voices) {
    try {
      $Synth.SelectVoice($voice.Name)
    } catch {
      continue
    }
    return $voice
  }
  return $null
}`;
const POWERSHELL_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
${POWERSHELL_VOICE_SELECTOR}
$request = ([Console]::In.ReadToEnd() | ConvertFrom-Json)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  try {
    $voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Culture.Name -like 'zh-*' }
    $selectedVoice = Select-FirstChineseVoice -Synth $synth -Voices $voices
  } catch {
    $selectedVoice = $null
  }
  if ($null -eq $selectedVoice) {
    $comSynth = $null
    $comCulture = $null
    try {
      $comSynth = New-Object -ComObject SAPI.SpVoice
      foreach ($token in @($comSynth.GetVoices())) {
        foreach ($language in ([string]$token.GetAttribute('Language') -split ';')) {
          try {
            $culture = [Globalization.CultureInfo]::GetCultureInfo([Convert]::ToInt32($language, 16))
          } catch {
            continue
          }
          if ($culture.Name -notlike 'zh-*') { continue }
          $comSynth.Voice = $token
          $comSynth.Volume = [int]$request.volume
          $null = $comSynth.Speak([string]$request.text)
          $comCulture = $culture.Name
          break
        }
        if ($null -ne $comCulture) { break }
      }
    } catch {
      $comCulture = $null
    } finally {
      if ($null -ne $comSynth) {
        $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($comSynth)
      }
    }
    if ($null -ne $comCulture) {
      [Console]::Out.WriteLine((@{ spoken = $true; voiceCulture = $comCulture } | ConvertTo-Json -Compress))
      exit 0
    }
    [Console]::Out.WriteLine((@{ spoken = $false; reason = 'missing-zh-voice' } | ConvertTo-Json -Compress))
    exit 0
  }
  $synth.Volume = [int]$request.volume
  $synth.Speak([string]$request.text)
  [Console]::Out.WriteLine((@{ spoken = $true; voiceCulture = $selectedVoice.Culture.Name } | ConvertTo-Json -Compress))
} finally {
  $synth.Dispose()
}`;
const ENCODED_SCRIPT = Buffer.from(POWERSHELL_SCRIPT, "utf16le").toString("base64");

function normalizedResult(stdout) {
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed?.spoken === false && parsed.reason === "missing-zh-voice") {
      return { spoken: false, reason: "missing-zh-voice" };
    }
    if (parsed?.spoken === true && typeof parsed.voiceCulture === "string" && /^zh-/i.test(parsed.voiceCulture)) {
      return { spoken: true, voiceCulture: parsed.voiceCulture };
    }
  } catch {}
  return { spoken: false, reason: "tts-invalid-response" };
}

function speakChinese(text, volume, {
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = 30_000,
  signal,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  if (!ALLOWED_TEXT.has(text)) return Promise.resolve({ spoken: false, reason: "invalid-text" });
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    return Promise.resolve({ spoken: false, reason: "invalid-volume" });
  }
  if (platform !== "win32") return Promise.resolve({ spoken: false, reason: "unsupported-platform" });
  if (signal?.aborted) return Promise.resolve({ spoken: false, reason: "tts-cancelled" });

  return new Promise(resolve => {
    let child;
    let stdout = "";
    let settled = false;
    let timeoutId;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeoutImpl(timeoutId);
      signal?.removeEventListener?.("abort", abort);
      resolve(result);
    };
    const abort = () => {
      try { child?.kill(); } catch {}
      finish({ spoken: false, reason: "tts-cancelled" });
    };
    const failStdin = () => {
      if (child && child.exitCode == null && !child.killed) {
        try { child.kill(); } catch {}
      }
      finish({ spoken: false, reason: "tts-process-error" });
    };
    try {
      child = spawnImpl("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        ENCODED_SCRIPT
      ], {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch {
      finish({ spoken: false, reason: "tts-process-error" });
      return;
    }
    child.stdout?.on("data", chunk => {
      if (stdout.length < 16_384) stdout += chunk.toString("utf8");
    });
    child.stderr?.resume?.();
    child.stdin?.once?.("error", failStdin);
    child.once("error", () => finish({ spoken: false, reason: "tts-process-error" }));
    child.once("close", code => finish(code === 0
      ? normalizedResult(stdout)
      : { spoken: false, reason: "tts-process-error" }));
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    timeoutId = setTimeoutImpl(() => {
      try { child.kill(); } catch {}
      finish({ spoken: false, reason: "tts-timeout" });
    }, timeoutMs);
    try {
      child.stdin.end(JSON.stringify({ text, volume }), "utf8");
    } catch {
      failStdin();
    }
  });
}

function createSpeechFlow({
  beginSpeech,
  playKneel,
  showBubble,
  speak = speakChinese,
  pause = () => new Promise(resolve => setTimeout(resolve, 800)),
  hideBubble,
  recover,
  finishSpeech
}) {
  let generation = 0;
  let active = false;
  let bubbleVisible = false;
  let heldForMissingVoice = false;
  let activeSpeechAbort;

  async function restoreSpeech(recoverAnimation = true) {
    const action = finishSpeech();
    if (recoverAnimation && RECOVERY_ACTIONS.has(action)) await recover(action);
    return action;
  }

  async function dismiss({ recoverAnimation = true } = {}) {
    generation += 1;
    activeSpeechAbort?.abort();
    activeSpeechAbort = undefined;
    const wasActive = active;
    active = false;
    heldForMissingVoice = false;
    if (bubbleVisible || wasActive) {
      bubbleVisible = false;
      hideBubble();
    }
    if (wasActive) await restoreSpeech(recoverAnimation);
    return wasActive;
  }

  async function run(text, volume) {
    if (!ALLOWED_TEXT.has(text)) return { spoken: false, reason: "invalid-text" };
    if (active) await dismiss();
    if (!beginSpeech()) return { spoken: false, reason: "speech-unavailable" };
    active = true;
    const currentGeneration = ++generation;
    const kneeReady = await playKneel();
    if (currentGeneration !== generation) return { spoken: false, reason: "speech-cancelled" };
    if (!kneeReady) {
      active = false;
      finishSpeech();
      return { spoken: false, reason: "kneel-unavailable" };
    }
    let shown = false;
    try {
      shown = await showBubble(text) !== false;
    } catch {}
    if (currentGeneration !== generation) return { spoken: false, reason: "speech-cancelled" };
    if (!shown) {
      active = false;
      await restoreSpeech();
      return { spoken: false, reason: "bubble-unavailable" };
    }
    bubbleVisible = true;
    let result;
    try {
      activeSpeechAbort = new AbortController();
      result = await speak(text, volume, { signal: activeSpeechAbort.signal });
    } catch {
      result = { spoken: false, reason: "tts-process-error" };
    }
    activeSpeechAbort = undefined;
    if (currentGeneration !== generation) return { spoken: false, reason: "speech-cancelled" };
    if (result.reason === "missing-zh-voice") {
      heldForMissingVoice = true;
      return result;
    }
    await pause();
    if (currentGeneration !== generation) return { spoken: false, reason: "speech-cancelled" };
    bubbleVisible = false;
    hideBubble();
    active = false;
    await restoreSpeech();
    return result;
  }

  return Object.freeze({
    dismiss,
    run,
    snapshot: () => Object.freeze({ active, bubbleVisible, heldForMissingVoice })
  });
}

function validateRendererResult(value) {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value);
  const base = keys.length === 2 && keys.includes("id") && keys.includes("accepted");
  const withAction = keys.length === 3 && base === false
    && keys.includes("id") && keys.includes("accepted") && keys.includes("action");
  const withReason = keys.length === 3 && base === false
    && keys.includes("id") && keys.includes("accepted") && keys.includes("reason");
  if (!base && !withAction && !withReason) return null;
  if (!Number.isSafeInteger(value.id) || value.id <= 0 || typeof value.accepted !== "boolean") return null;
  if (withAction && !RECOVERY_ACTIONS.has(value.action) && value.action !== "kneel") return null;
  if (withReason && (value.accepted || value.reason !== "expired")) return null;
  if (withAction) return Object.freeze({ id: value.id, accepted: value.accepted, action: value.action });
  if (withReason) return Object.freeze({ id: value.id, accepted: false, reason: "expired" });
  return Object.freeze({ id: value.id, accepted: value.accepted });
}

function createRendererCommandBridge({
  send,
  timeoutMs = 5_000,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  if (typeof send !== "function") throw new TypeError("renderer command bridge requires send");
  let nextId = 1;
  const pending = new Map();
  return Object.freeze({
    request(type, recoveryAction) {
      if (!RENDERER_COMMANDS.has(type)) return Promise.resolve(Object.freeze({ id: 0, accepted: false }));
      if ((type === "recover") !== (recoveryAction !== undefined)
        || (type === "recover" && !RECOVERY_ACTIONS.has(recoveryAction))) {
        return Promise.resolve(Object.freeze({ id: 0, accepted: false }));
      }
      const issuedAt = now();
      const expiresAt = issuedAt + timeoutMs;
      if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
        return Promise.resolve(Object.freeze({ id: 0, accepted: false }));
      }
      const command = Object.freeze(type === "recover"
        ? { id: nextId, type, action: recoveryAction, expiresAt }
        : { id: nextId, type, expiresAt });
      let sent = false;
      try { sent = send(command) !== false; } catch {}
      if (!sent) return Promise.resolve(Object.freeze({ id: 0, accepted: false }));
      nextId += 1;
      return new Promise(resolve => {
        const timeoutId = setTimeoutImpl(() => {
          const entry = pending.get(command.id);
          if (!entry) return;
          pending.delete(command.id);
          entry.resolve(Object.freeze({ id: command.id, accepted: false, reason: "timeout" }));
        }, timeoutMs);
        timeoutId?.unref?.();
        pending.set(command.id, { resolve, timeoutId });
      });
    },
    complete(payload) {
      const result = validateRendererResult(payload);
      if (!result) return false;
      const entry = pending.get(result.id);
      if (!entry) return false;
      pending.delete(result.id);
      clearTimeoutImpl(entry.timeoutId);
      entry.resolve(result);
      return true;
    },
    dispose() {
      for (const [id, entry] of pending) {
        clearTimeoutImpl(entry.timeoutId);
        entry.resolve(Object.freeze({ id, accepted: false, reason: "disposed" }));
      }
      pending.clear();
    }
  });
}

module.exports = {
  ALLOWED_TEXT,
  POWERSHELL_SCRIPT,
  POWERSHELL_VOICE_SELECTOR,
  RECOVERY_ACTIONS,
  createRendererCommandBridge,
  createSpeechFlow,
  speakChinese,
  validateRendererResult
};
