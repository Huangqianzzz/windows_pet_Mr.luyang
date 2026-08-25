const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { collectFrames } = require("./validate-action");

const MAX_SHEET_WIDTH = 16384;
const MAX_SHEET_HEIGHT = 8192;
const MAX_SHEET_PIXELS = 64 * 1024 * 1024;
const MAX_SHEET_BYTES = MAX_SHEET_PIXELS * 4;

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let row = 0; row < height; row += 1) rows.push(Buffer.from([0]), pixels.subarray(row * width * 4, (row + 1) * width * 4));
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function boundedProduct(values, limit, message) {
  let product = 1;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || product > Math.floor(limit / value)) throw new Error(message);
    product *= value;
  }
  return product;
}

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function canonicalPath(filePath) {
  let candidate = path.resolve(filePath);
  const suffix = [];
  while (true) {
    try {
      const real = await fs.realpath(candidate);
      return normalizePath(path.join(real, ...suffix));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`cannot resolve output path ${filePath}: ${error.message}`);
      const parent = path.dirname(candidate);
      if (parent === candidate) return normalizePath(path.join(candidate, ...suffix));
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isInside(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

async function assertSafeOutputs(actionDir, frames, outputPng, outputJson) {
  const actionPath = await canonicalPath(actionDir);
  const pngPath = await canonicalPath(outputPng);
  const jsonPath = await canonicalPath(outputJson);
  if (pngPath === jsonPath) throw new Error("PNG and JSON outputs must differ");
  const inputs = await Promise.all(frames.map((frame) => canonicalPath(path.join(actionDir, frame.name))));
  if (inputs.includes(pngPath) || inputs.includes(jsonPath)) throw new Error("output path collides with an input frame");
  if (isInside(actionPath, pngPath) || isInside(actionPath, jsonPath)) throw new Error("output path must not be inside the action directory");
}

async function replaceOutputs(outputPng, outputJson, png, json) {
  const finals = [path.resolve(outputPng), path.resolve(outputJson)];
  if (finals[0] === finals[1]) throw new Error("PNG and JSON outputs must differ");
  await Promise.all(finals.map((file) => fs.mkdir(path.dirname(file), { recursive: true })));
  const token = `${process.pid}-${Date.now()}`;
  const temps = finals.map((file) => `${file}.${token}.tmp`);
  const backups = finals.map((file) => `${file}.${token}.bak`);
  const replaced = [false, false];
  const backedUp = [false, false];
  try {
    await fs.writeFile(temps[0], png, { flag: "wx" });
    await fs.writeFile(temps[1], json, { flag: "wx" });
    for (let index = 0; index < finals.length; index += 1) {
      try {
        await fs.rename(finals[index], backups[index]);
        backedUp[index] = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (let index = 0; index < finals.length; index += 1) {
      await fs.rename(temps[index], finals[index]);
      replaced[index] = true;
    }
    await Promise.allSettled(backups.map((file) => fs.rm(file, { force: true })));
  } catch (error) {
    const recovered = await Promise.allSettled(finals.map(async (file, index) => {
      if (replaced[index]) await fs.rm(file, { force: true });
      if (backedUp[index]) await fs.rename(backups[index], file);
    }));
    await Promise.allSettled(temps.map((file) => fs.rm(file, { force: true })));
    const recoveryErrors = recovered.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (recoveryErrors.length) throw new AggregateError([error, ...recoveryErrors], "output publish failed and recovery was incomplete");
    throw error;
  }
}

async function packAction(actionDir, outputPng, outputJson) {
  const frames = await collectFrames(actionDir);
  await assertSafeOutputs(actionDir, frames, outputPng, outputJson);
  const width = frames[0].width;
  const height = frames[0].height;
  const sheetWidth = boundedProduct([width, frames.length], MAX_SHEET_WIDTH, "sheet width exceeds safety limit");
  if (height > MAX_SHEET_HEIGHT) throw new Error("sheet height exceeds safety limit");
  const sheetBytes = boundedProduct([sheetWidth, height, 4], MAX_SHEET_BYTES, "sheet pixel count exceeds safety limit");
  const pixels = Buffer.alloc(sheetBytes);
  frames.forEach((frame, frameIndex) => {
    for (let row = 0; row < height; row += 1) {
      frame.pixels.copy(pixels, (row * sheetWidth + frameIndex * width) * 4, row * width * 4, (row + 1) * width * 4);
    }
  });
  const manifest = {
    version: 1,
    sheet: { width: sheetWidth, height },
    frames: frames.map((frame, index) => ({ file: frame.name, source: { x: index * width, y: 0, width, height } }))
  };
  await replaceOutputs(outputPng, outputJson, encodePng(sheetWidth, height, pixels), `${JSON.stringify(manifest)}\n`);
}

async function main() {
  const [actionDir, outputPng, outputJson] = process.argv.slice(2);
  if (!actionDir || !outputPng || !outputJson) throw new Error("Usage: node pack-action.js <action-dir> <sheet.png> <sheet.json>");
  await packAction(actionDir, outputPng, outputJson);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { packAction };
