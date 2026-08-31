import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { buildZip, crc32, debugBundle, azimuthRange, pointsToCsv } from "../debug.js";

const bytes = (s) => new TextEncoder().encode(s);
const P = (az, el, extra = {}) => ({ az, el, t: "2026-08-30T10:00:00.000Z", cal: false, ...extra });

// A reader written against the ZIP spec rather than against buildZip(), so a
// mistake shared by both would have to be made twice, independently.
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50, "end-of-central-directory signature");
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50, "central directory signature");
    const nameLen = dv.getUint16(at + 28, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const size = dv.getUint32(at + 24, true);
    const crc = dv.getUint32(at + 16, true);
    const localAt = dv.getUint32(at + 42, true);
    assert.equal(dv.getUint32(localAt, true), 0x04034b50, "local header signature");
    const localNameLen = dv.getUint16(localAt + 26, true);
    const extraLen = dv.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localNameLen + extraLen;
    entries.push({ name, crc, data: buf.subarray(dataAt, dataAt + size) });
    at += 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true);
  }
  return entries;
}

test("a bundle round-trips through an independent reader", () => {
  const zip = buildZip([
    { name: "debug.json", data: bytes('{"schema":1}') },
    { name: "points.csv", data: bytes("azimuth_deg\n10.00\n") },
  ]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ["debug.json", "points.csv"]);
  assert.equal(new TextDecoder().decode(entries[0].data), '{"schema":1}');
  assert.equal(new TextDecoder().decode(entries[1].data), "azimuth_deg\n10.00\n");
});

test("the checksums are the ones a real unzip will check", () => {
  // Against node's own zlib, not against this file's table.
  for (const s of ["", "a", "horizon", "the quick brown fox"]) {
    assert.equal(crc32(bytes(s)), zlib.crc32(Buffer.from(s)), `crc32 of ${JSON.stringify(s)}`);
  }
  const zip = buildZip([{ name: "x.txt", data: bytes("horizon") }]);
  assert.equal(readZip(zip)[0].crc, zlib.crc32(Buffer.from("horizon")));
});

test("binary content survives, which is the whole point of the photo", () => {
  const photo = new Uint8Array(1024);
  for (let i = 0; i < photo.length; i++) photo[i] = (i * 37) & 0xff;
  const entries = readZip(buildZip([{ name: "photo.jpg", data: photo }]));
  assert.deepEqual([...entries[0].data], [...photo]);
});

test("an empty archive is still a valid one", () => {
  assert.deepEqual(readZip(buildZip([])), []);
});

test("the bundle counts the three kinds of point apart", () => {
  const b = debugBundle({
    page: "overlay",
    points: [P(10, 5), P(20, 6, { cal: true }), P(30, 7, { source: "photo" })],
  });
  assert.equal(b.counts.points, 3);
  assert.equal(b.counts.calibration_points, 1);
  assert.equal(b.counts.from_photo, 1);
  assert.equal(b.schema, 1);
});

test("the bundle records how much of the circle the points cover", () => {
  // Points at 10, 20 and 30 degrees sit inside a 20 degree arc, however the
  // gap the other way round looks.
  assert.equal(azimuthRange([P(10, 0), P(20, 0), P(30, 0)]).covered_deg, 20);
  // Two points either side of north cover 40 degrees, not 320.
  assert.equal(azimuthRange([P(340, 0), P(20, 0)]).covered_deg, 40);
  // Spread over most of a circle: the condition a two-point fit gets wrong.
  assert.equal(azimuthRange([P(0, 0), P(120, 0), P(240, 0)]).covered_deg, 240);
});

test("a range needs at least two points", () => {
  assert.equal(azimuthRange([]), null);
  assert.equal(azimuthRange([P(10, 0)]), null);
});

test("the CSV in the bundle is the same one the download button produces", () => {
  const csv = pointsToCsv([P(20, 6, { cal: true }), P(10, 5)]);
  assert.match(csv, /^azimuth_deg,elevation_deg,timestamp,is_calibration,source$/m);
  assert.match(csv, /^10\.00,5\.00,[^,]*,0,sensor$/m);
  assert.match(csv, /^20\.00,6\.00,[^,]*,1,sensor$/m);
  assert.ok(csv.indexOf("10.00") < csv.indexOf("20.00"), "sorted by azimuth");
});
