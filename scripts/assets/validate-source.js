const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function parseManifest(contents, manifestPath) {
  const entries = contents.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([a-fA-F0-9]{64}) {2}([^\\/]+)$/);
    if (!match) throw new Error(`Invalid SHA256 entry in ${manifestPath}: ${line}`);
    return { expectedHash: match[1].toLowerCase(), filename: match[2] };
  });

  if (entries.length === 0) throw new Error(`No source files recorded in ${manifestPath}`);
  if (new Set(entries.map((entry) => entry.filename)).size !== entries.length) {
    throw new Error(`Duplicate source filename in ${manifestPath}`);
  }
  return entries;
}

async function fileHash(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function validateSources(manifestFile) {
  const manifestPath = path.resolve(manifestFile);
  const sourceDirectory = path.dirname(manifestPath);
  const entries = parseManifest(await fs.readFile(manifestPath, "utf8"), manifestPath);
  const expectedNames = new Set(entries.map((entry) => entry.filename));
  const files = entries.map((entry) => ({ ...entry, path: path.join(sourceDirectory, entry.filename) }));
  const changed = [];
  const missing = [];

  for (const file of files) {
    try {
      if (!(await fs.stat(file.path)).isFile()) throw new Error("not a file");
      if ((await fileHash(file.path)) !== file.expectedHash) changed.push(file.path);
    } catch (error) {
      if (error.code === "ENOENT" || error.message === "not a file") missing.push(file.path);
      else throw error;
    }
  }

  const directoryEntries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  const unexpected = directoryEntries
    .filter((entry) => entry.isFile() && /\.jpe?g$/i.test(entry.name) && !expectedNames.has(entry.name))
    .map((entry) => path.join(sourceDirectory, entry.name));

  return { files, changed, missing, unexpected };
}

async function main() {
  const manifestPath = process.argv[2] || "assets/source/person/SHA256SUMS.txt";
  const result = await validateSources(manifestPath);
  const problems = [...result.changed, ...result.missing, ...result.unexpected];

  if (problems.length > 0) {
    console.error(`Source integrity check failed:\n${problems.join("\n")}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { validateSources };
