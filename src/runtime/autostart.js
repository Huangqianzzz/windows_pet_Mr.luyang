const path = require("node:path");
const { spawn } = require("node:child_process");

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "Desktop Pet Suite";
const SUITE_EXECUTABLES = new Set(["desktop pet suite.exe", "desktop-pet-suite.exe"]);

function validLauncher(launcherPath) {
  return typeof launcherPath === "string"
    && path.win32.isAbsolute(launcherPath)
    && !/[\r\n"]/.test(launcherPath)
    && SUITE_EXECUTABLES.has(path.win32.basename(launcherPath).toLowerCase());
}

function runRegistry(command, args, spawnImpl) {
  return new Promise(resolve => {
    let child;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawnImpl(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      finish({ updated: false, reason: "registry-process-error" });
      return;
    }
    child.once("error", () => finish({ updated: false, reason: "registry-process-error" }));
    child.once("close", code => finish(code === 0
      ? { updated: true }
      : { updated: false, reason: "registry-command-failed" }));
  });
}

async function setAutostart(enabled, launcherPath, {
  platform = process.platform,
  spawnImpl = spawn
} = {}) {
  if (platform !== "win32") return { updated: false, reason: "unsupported-platform" };
  if (typeof enabled !== "boolean" || !validLauncher(launcherPath)) {
    return { updated: false, reason: "invalid-suite-launcher" };
  }
  const args = enabled
    ? ["ADD", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", `"${launcherPath}" --autostart`, "/f"]
    : ["DELETE", RUN_KEY, "/v", VALUE_NAME, "/f"];
  const result = await runRegistry("reg.exe", args, spawnImpl);
  return result.updated ? { updated: true, enabled } : result;
}

async function updateAutostartPreference(enabled, launcherPath, settingsStore, {
  setAutostartImpl = setAutostart
} = {}) {
  const registryResult = await setAutostartImpl(enabled, launcherPath);
  if (!registryResult.updated) return registryResult;
  try {
    settingsStore.update({ launchAtLogin: enabled });
    return { updated: true, enabled };
  } catch {
    const rollback = await setAutostartImpl(!enabled, launcherPath);
    return {
      updated: false,
      reason: "settings-write-failed",
      rolledBack: Boolean(rollback.updated)
    };
  }
}

module.exports = {
  RUN_KEY,
  VALUE_NAME,
  setAutostart,
  updateAutostartPreference,
  validLauncher
};
