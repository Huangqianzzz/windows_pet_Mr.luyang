const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { collectFrames } = require("./validate-action");

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
    await Promise.all(backups.map((file) => fs.rm(file, { force: true })));
  } catch (error) {
    await Promise.all(temps.map((file) => fs.rm(file, { force: true })));
    for (let index = 0; index < finals.length; index += 1) {
      if (replaced[index]) await fs.rm(finals[index], { force: true });
      if (backedUp[index]) await fs.rename(backups[index], finals[index]);
    }
    throw error;
  }
}

async function packAction(actionDir, outputPng, outputJson) {
  const frames = await collectFrames(actionDir);
  const width = frames[0].width;
  const height = frames[0].height;
  const sheetWidth = width * frames.length;
  const pixels = Buffer.alloc(sheetWidth * height * 4);
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
