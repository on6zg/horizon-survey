// Support for the browser tests: a static server, a panorama to feed the
// file inputs, and the check that decides whether these tests can run at all.
//
// Nothing here is specific to a test case. The cases themselves are in
// survey.test.js and overlay.test.js.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

/**
 * Playwright if it is installed, otherwise null.
 *
 * `npm install` in this repo installs nothing, so a fresh clone has no
 * browser to drive. The tests that need one skip themselves rather than
 * fail, which keeps `npm test` meaningful without a 300 MB download.
 */
export async function loadPlaywright() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    return null;
  }
}

export const SKIP = "playwright is not installed (npm install --include=dev && npx playwright install chromium)";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".csv": "text/csv",
};

/**
 * Serve the repo over http on a port the OS picks, so two test files can run
 * at once without agreeing on a number. The pages need an origin rather than
 * `file://` because they import geometry.js as a module.
 */
export function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: (page) => `http://127.0.0.1:${port}/${page}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * A PNG of the given size, written to a real file rather than handed over as
 * a buffer.
 *
 * The file matters: overlay.html identifies a photo partly by
 * `File.lastModified`, and a buffer passed to setInputFiles gets a fresh
 * timestamp on every call, so "the same photo again" would never look the
 * same. A path on disk behaves the way a user picking the same file twice
 * does.
 */
export function writePanorama(name, width, height, rgb = [30, 60, 90]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "horizon-survey-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, encodePng(width, height, rgb));
  return file;
}

export function writeCsv(name, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "horizon-survey-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, "azimuth_deg,elevation_deg,timestamp,is_calibration,source\n" + rows.join("\n") + "\n");
  return file;
}

/**
 * Wait until the canvas has been drawn at the width we expect.
 *
 * Not `width > 0`: an untouched canvas element already reports 300, so that
 * condition is true before any photo has been loaded and the test then clicks
 * at coordinates that mean nothing.
 */
export const waitForCanvas = (page, width) =>
  page.waitForFunction((w) => document.getElementById("canvas").width === w, width, { timeout: 30_000 });

/** Dispatch an orientation event the survey page will accept as absolute. */
export const feedOrientation = (page, alpha, beta, gamma = 0) =>
  page.evaluate(([a, b, g]) => {
    const e = new Event("deviceorientationabsolute");
    Object.defineProperties(e, {
      alpha: { value: a }, beta: { value: b }, gamma: { value: g }, absolute: { value: true },
    });
    window.dispatchEvent(e);
  }, [alpha, beta, gamma]);

// 8-bit truecolour PNG, one filter byte per scanline. Vertical stripes every
// 100 px so a failure screenshot is readable by a person.
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const stripe = x % 100 === 0;
      raw[o++] = stripe ? 220 : rgb[0];
      raw[o++] = stripe ? 220 : rgb[1];
      raw[o++] = stripe ? 220 : rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

// Minimal ZIP reading, so a browser test can look inside a downloaded debug
// bundle. Deliberately not importing debug.js: a test that reads with the
// same code that wrote would agree with itself about a mistake.
function zipEntries(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  if (dv.getUint32(end, true) !== 0x06054b50) throw new Error("not a zip (no end-of-central-directory)");
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(at + 28, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const size = dv.getUint32(at + 24, true);
    const localAt = dv.getUint32(at + 42, true);
    const dataAt = localAt + 30 + dv.getUint16(localAt + 26, true) + dv.getUint16(localAt + 28, true);
    out.push({ name, data: buf.subarray(dataAt, dataAt + size) });
    at += 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  return out;
}

export const readZipNames = (buf) => zipEntries(buf).map((e) => e.name);

export function readZipEntry(buf, name) {
  const entry = zipEntries(buf).find((e) => e.name === name);
  if (!entry) throw new Error(`no ${name} in the bundle, found: ${readZipNames(buf).join(", ")}`);
  return new TextDecoder().decode(entry.data);
}
