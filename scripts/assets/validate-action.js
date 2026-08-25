const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const FRAME_NAME = /^frame-(\d{4})\.png$/;

function fail(message) {
  throw new Error(message);
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterPng(data, width, height) {
  const stride = width * 4;
  const expected = height * (stride + 1);
  if (data.length !== expected) fail("PNG pixel data length is invalid");
  const pixels = Buffer.alloc(width * height * 4);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = data[source++];
    for (let column = 0; column < stride; column += 1) {
      const value = data[source++];
      const offset = row * stride + column;
      const left = column >= 4 ? pixels[offset - 4] : 0;
      const above = row > 0 ? pixels[offset - stride] : 0;
      const upperLeft = row > 0 && column >= 4 ? pixels[offset - stride - 4] : 0;
      if (filter === 0) pixels[offset] = value;
      else if (filter === 1) pixels[offset] = (value + left) & 0xff;
      else if (filter === 2) pixels[offset] = (value + above) & 0xff;
      else if (filter === 3) pixels[offset] = (value + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) pixels[offset] = (value + paeth(left, above, upperLeft)) & 0xff;
      else fail(`PNG uses unsupported filter ${filter}`);
    }
  }
  return pixels;
}

async function readPng(filePath) {
  const file = await fs.readFile(filePath);
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) fail(`${filePath}: invalid PNG signature`);
  let offset = 8;
  let header;
  const parts = [];
  while (offset < file.length) {
    if (offset + 12 > file.length) fail(`${filePath}: truncated PNG chunk`);
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > file.length) fail(`${filePath}: truncated PNG chunk`);
    const data = file.subarray(start, end);
    if (type === "IHDR") header = data;
    if (type === "IDAT") parts.push(data);
    if (type === "IEND") break;
    offset = end + 4;
  }
  if (!header || header.length !== 13 || parts.length === 0) fail(`${filePath}: incomplete PNG`);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (!width || !height || header[8] !== 8 || header[9] !== 6 || header[10] !== 0 || header[11] !== 0 || header[12] !== 0) {
    fail(`${filePath}: requires non-interlaced 8-bit RGBA PNG`);
  }
  const pixels = unfilterPng(zlib.inflateSync(Buffer.concat(parts)), width, height);
  return { width, height, pixels, hasVisibleAlpha: pixels.some((_, index) => index % 4 === 3 && pixels[index] !== 0) };
}

function frameIndex(fileName) {
  const match = FRAME_NAME.exec(fileName);
  return match ? Number(match[1]) : null;
}

async function collectFrames(actionDir) {
  const entries = await fs.readdir(actionDir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && /\.png$/i.test(entry.name)).map((entry) => entry.name);
  if (names.length === 0) fail(`${actionDir}: no PNG frames`);
  const invalid = names.find((name) => frameIndex(name) === null);
  if (invalid) fail(`${actionDir}: invalid frame filename ${invalid}`);
  names.sort((left, right) => frameIndex(left) - frameIndex(right));
  names.forEach((name, index) => {
    const expected = `frame-${String(index + 1).padStart(4, "0")}.png`;
    if (name !== expected) fail(`${actionDir}: missing ${expected}`);
  });

  const frames = [];
  for (const name of names) {
    const image = await readPng(path.join(actionDir, name));
    if (!image.hasVisibleAlpha) fail(`${name}: empty alpha`);
    if (frames.length && (image.width !== frames[0].width || image.height !== frames[0].height)) fail(`${name}: dimension drift`);
    frames.push({ name, ...image });
  }
  return frames;
}

async function loadMetadata(metadata) {
  if (typeof metadata === "string") return JSON.parse(await fs.readFile(metadata, "utf8"));
  return metadata;
}

function point(value, label, frameNumber, width, height) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || value.x < 0 || value.y < 0 || value.x > width || value.y > height) {
    fail(`frame ${frameNumber}: ${label} is out of bounds`);
  }
}

function box(value, label, frameNumber, width, height) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    fail(`frame ${frameNumber}: ${label} is required`);
  }
  if (value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0 || value.x + value.width > width || value.y + value.height > height) {
    fail(`frame ${frameNumber}: ${label} is out of bounds`);
  }
}

async function validateAction(actionDir, metadata) {
  const action = await loadMetadata(metadata);
  if (!action || typeof action !== "object" || Array.isArray(action)) fail("metadata must be an object");
  if (typeof action.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(action.name)) fail("action name is required");
  if (action.static !== true && action.fps !== 30) fail("action must use 30 FPS unless static");
  if (typeof action.loop !== "boolean") fail("loop flag is required");
  if (typeof action.interruptible !== "boolean") fail("interruptible flag is required");
  if (!Array.isArray(action.frames) || action.frames.length === 0) fail("frames are required");

  const frames = await collectFrames(actionDir);
  if (action.frames.length !== frames.length) fail("metadata frame count does not match PNG frames");
  const fileNames = new Set();
  let previousContacts;
  for (let index = 0; index < action.frames.length; index += 1) {
    const frame = action.frames[index];
    const image = frames[index];
    const frameNumber = index + 1;
    if (!frame || typeof frame.file !== "string") fail(`frame ${frameNumber}: frame filename is required`);
    if (fileNames.has(frame.file)) fail(`frame ${frameNumber}: duplicate frame filename ${frame.file}`);
    if (frame.file !== image.name) fail(`frame ${frameNumber}: expected ${image.name}`);
    fileNames.add(frame.file);
    box(frame.faceBox, "faceBox", frameNumber, image.width, image.height);
    box(frame.hitBox, "hitBox", frameNumber, image.width, image.height);
    if (!Array.isArray(frame.contacts) || frame.contacts.length === 0) fail(`frame ${frameNumber}: contacts are required`);
    frame.contacts.forEach((contact) => point(contact, "contact", frameNumber, image.width, image.height));
    point(frame.supportAnchor, "supportAnchor", frameNumber, image.width, image.height);
    if (previousContacts) {
      if (previousContacts.length !== frame.contacts.length || frame.contacts.some((contact, contactIndex) => Math.hypot(contact.x - previousContacts[contactIndex].x, contact.y - previousContacts[contactIndex].y) > Math.max(image.width, image.height))) {
        fail(`contact discontinuity between frame ${frameNumber - 1} and frame ${frameNumber}`);
      }
    }
    previousContacts = frame.contacts;
  }
  return { name: action.name, width: frames[0].width, height: frames[0].height, frames: frames.map((frame) => frame.name) };
}

async function main() {
  const [actionDir, metadata] = process.argv.slice(2);
  if (!actionDir || !metadata) fail("Usage: node validate-action.js <action-dir> <metadata.json>");
  console.log(JSON.stringify(await validateAction(actionDir, metadata)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { collectFrames, readPng, validateAction };
