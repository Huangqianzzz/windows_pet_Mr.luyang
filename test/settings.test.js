const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

test("loads frozen defaults when settings are absent or corrupted", () => {
  const { DEFAULT_SETTINGS, SettingsStore } = require("../src/runtime/settings");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-settings-"));
  const file = path.join(directory, "settings.json");
  const store = new SettingsStore(file);

  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  fs.writeFileSync(file, "{definitely-not-json", "utf8");
  const corrupted = fs.readFileSync(file, "utf8");
  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  assert.equal(fs.readFileSync(file, "utf8"), corrupted);
  assert.equal(Object.isFrozen(store.snapshot()), true);
});

test("rejects invalid persisted schema and invalid updates", () => {
  const { DEFAULT_SETTINGS, SettingsStore } = require("../src/runtime/settings");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-pet-settings-"));
  const file = path.join(directory, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ ...DEFAULT_SETTINGS, speechVolume: 101 }), "utf8");
  const store = new SettingsStore(file);

  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  assert.throws(() => store.update({ speechVolume: -1 }), /speechVolume/);
  assert.throws(() => store.update({ arbitraryCommand: "quit" }), /setting/);
});

test("updates through sibling temp, flush, fsync, close, and rename in that order", () => {
  const { SettingsStore } = require("../src/runtime/settings");
  const calls = [];
  let written;
  const fakeFs = {
    readFileSync() { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    openSync(file, flags, mode) { calls.push(["open", file, flags, mode]); return 17; },
    writeFileSync(fd, data, encoding) { calls.push(["write", fd, encoding]); written = data; },
    fsyncSync(fd) { calls.push(["fsync", fd]); },
    closeSync(fd) { calls.push(["close", fd]); },
    renameSync(from, to) { calls.push(["rename", from, to]); },
    unlinkSync(file) { calls.push(["unlink", file]); }
  };
  const store = new SettingsStore("C:\\Users\\me\\settings.json", {
    fsImpl: fakeFs,
    tempSuffix: () => "fixed"
  });
  store.load();

  const result = store.update({ petScale: 1.5, speechVolume: 75 });

  assert.equal(result.petScale, 1.5);
  assert.equal(result.speechVolume, 75);
  assert.deepEqual(calls.map(call => call[0]), ["open", "write", "fsync", "close", "rename"]);
  assert.equal(calls[0][1], "C:\\Users\\me\\settings.json.fixed.tmp");
  assert.deepEqual(JSON.parse(written), result);
});

test("cleans the sibling temp and preserves the previous snapshot when atomic rename fails", () => {
  const { SettingsStore } = require("../src/runtime/settings");
  const calls = [];
  const fakeFs = {
    readFileSync() { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    openSync() { return 4; },
    writeFileSync() {},
    fsyncSync() {},
    closeSync() {},
    renameSync() { throw new Error("disk failure"); },
    unlinkSync(file) { calls.push(file); }
  };
  const store = new SettingsStore("C:\\settings.json", {
    fsImpl: fakeFs,
    tempSuffix: () => "failed"
  });
  const before = store.load();

  assert.throws(() => store.update({ speechVolume: 25 }), /disk failure/);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(calls, ["C:\\settings.json.failed.tmp"]);
});

test("does not delete a sibling temp file that this update failed to create", () => {
  const { SettingsStore } = require("../src/runtime/settings");
  let unlinked = false;
  const fakeFs = {
    readFileSync() { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
    openSync() { const error = new Error("exists"); error.code = "EEXIST"; throw error; },
    unlinkSync() { unlinked = true; }
  };
  const store = new SettingsStore("C:\\settings.json", {
    fsImpl: fakeFs,
    tempSuffix: () => "owned-by-other-writer"
  });
  store.load();

  assert.throws(() => store.update({ speechVolume: 25 }), /exists/);
  assert.equal(unlinked, false);
});

function successfulSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => child.emit("close", 0));
    return child;
  };
}

test("registers and cancels only the suite launcher in the unelevated HKCU Run key", async () => {
  const { setAutostart } = require("../src/runtime/autostart");
  const calls = [];
  const launcher = "C:\\Program Files\\人物桌宠\\人物桌宠.exe";

  assert.deepEqual(await setAutostart(true, launcher, {
    platform: "win32",
    spawnImpl: successfulSpawn(calls)
  }), { updated: true, enabled: true });
  assert.deepEqual(await setAutostart(false, launcher, {
    platform: "win32",
    spawnImpl: successfulSpawn(calls)
  }), { updated: true, enabled: false });

  assert.equal(calls[0].command.toLowerCase(), "reg.exe");
  assert.deepEqual(calls[0].args.slice(0, 6), [
    "ADD",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    "人物桌宠",
    "/t",
    "REG_SZ"
  ]);
  assert.equal(calls[0].args.includes(`"${launcher}" --autostart`), true);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[1].args.slice(0, 4), [
    "DELETE",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "/v",
    "人物桌宠"
  ]);
});

test("rejects arbitrary executables and unsafe startup arguments", async () => {
  const { setAutostart } = require("../src/runtime/autostart");
  let spawned = false;
  const result = await setAutostart(true, "C:\\Windows\\System32\\powershell.exe", {
    platform: "win32",
    spawnImpl() { spawned = true; }
  });

  assert.deepEqual(result, { updated: false, reason: "invalid-suite-launcher" });
  assert.equal(spawned, false);
});

test("rolls back HKCU when persisting the startup preference fails", async () => {
  const { updateAutostartPreference } = require("../src/runtime/autostart");
  const enabledCalls = [];
  const result = await updateAutostartPreference(true, "C:\\Desktop Pet Suite.exe", {
    update() { throw new Error("settings disk full"); }
  }, {
    async setAutostartImpl(enabled) {
      enabledCalls.push(enabled);
      return { updated: true, enabled };
    }
  });

  assert.deepEqual(result, {
    updated: false,
    reason: "settings-write-failed",
    rolledBack: true
  });
  assert.deepEqual(enabledCalls, [true, false]);
});
