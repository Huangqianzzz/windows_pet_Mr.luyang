const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  petScale: 1,
  autonomousActivity: true,
  autoDuel: false,
  speechVolume: 100,
  launchAtLogin: true,
  windowCollision: true,
  iconCollision: true,
  autoDuelCooldownMin: 30,
  autoDuelCooldownMax: 60
});

const VALIDATORS = Object.freeze({
  version: value => value === 1,
  petScale: value => Number.isFinite(value) && value >= 1 && value <= 2,
  autonomousActivity: value => typeof value === "boolean",
  autoDuel: value => typeof value === "boolean",
  speechVolume: value => Number.isInteger(value) && value >= 0 && value <= 100,
  launchAtLogin: value => typeof value === "boolean",
  windowCollision: value => typeof value === "boolean",
  iconCollision: value => typeof value === "boolean",
  autoDuelCooldownMin: value => Number.isInteger(value) && value >= 10 && value <= 120,
  autoDuelCooldownMax: value => Number.isInteger(value) && value >= 10 && value <= 120
});

function cloneFrozen(settings) {
  return Object.freeze({ ...settings });
}

function validateComplete(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expected = Object.keys(VALIDATORS);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every(key => actual.includes(key))) return false;
  if (!expected.every(key => VALIDATORS[key](value[key]))) return false;
  return value.autoDuelCooldownMin <= value.autoDuelCooldownMax;
}

function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("setting update must be an object");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(VALIDATORS, key)) throw new RangeError(`Unknown setting: ${key}`);
    if (key === "version" || !VALIDATORS[key](value)) throw new RangeError(`Invalid ${key} setting`);
  }
}

class SettingsStore {
  constructor(filePath, { fsImpl = fs, tempSuffix = () => randomUUID() } = {}) {
    if (typeof filePath !== "string" || filePath.length === 0) throw new TypeError("settings path is required");
    this.filePath = filePath;
    this.fs = fsImpl;
    this.tempSuffix = tempSuffix;
    this.current = cloneFrozen(DEFAULT_SETTINGS);
  }

  load() {
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
      this.current = validateComplete(parsed) ? cloneFrozen(parsed) : cloneFrozen(DEFAULT_SETTINGS);
    } catch {
      this.current = cloneFrozen(DEFAULT_SETTINGS);
    }
    return this.snapshot();
  }

  update(patch) {
    validatePatch(patch);
    const next = { ...this.current, ...patch };
    if (!validateComplete(next)) throw new RangeError("Invalid setting combination");
    const tempPath = `${this.filePath}.${this.tempSuffix()}.tmp`;
    let descriptor;
    let closed = false;
    let created = false;
    try {
      descriptor = this.fs.openSync(tempPath, "wx", 0o600);
      created = true;
      this.fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      this.fs.fsyncSync(descriptor);
      this.fs.closeSync(descriptor);
      closed = true;
      this.fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      if (descriptor !== undefined && !closed) {
        try { this.fs.closeSync(descriptor); } catch {}
      }
      if (created) {
        try { this.fs.unlinkSync(tempPath); } catch {}
      }
      throw error;
    }
    this.current = cloneFrozen(next);
    return this.snapshot();
  }

  snapshot() {
    return cloneFrozen(this.current);
  }
}

module.exports = { DEFAULT_SETTINGS, SettingsStore, validateComplete };
