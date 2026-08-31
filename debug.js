// Packaging a diagnostic bundle: everything someone would otherwise have to
// be asked for, one question at a time, in one file they can attach.
//
// A browser cannot send mail with an attachment. `mailto:` has no parameter
// for one and no client implements it, and actually sending mail needs a
// server, which this project does not have and says so on both pages. So the
// bundle is a download: the user gets the file, sees exactly what is in it,
// and decides who to give it to. That is the same promise the rest of the
// tool makes, rather than an exception to it.
//
// Nothing here touches the DOM, so it is all tested in test/debug.test.js.

/**
 * A ZIP archive of `files`, as bytes.
 *
 * Entries are stored uncompressed. The bulk of a bundle is a photo that is
 * already JPEG, which deflate cannot improve on, and stored entries need no
 * compression library to write or to read.
 *
 * `files` is `[{ name, data }]`, where `data` is a Uint8Array.
 */
export function buildZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(8, 0, true);          // method 0 = stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory signature
    dv.setUint16(4, 20, true);         // version made by
    dv.setUint16(6, 20, true);         // version needed
    dv.setUint16(10, 0, true);         // method 0 = stored
    dv.setUint32(16, crc, true);
    dv.setUint32(20, file.data.length, true);
    dv.setUint32(24, file.data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);    // offset of the local header
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);   // end of central directory signature
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return concat([...locals, ...central, end]);
}

/** CRC-32 as ZIP defines it. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The facts worth having about a survey, as a plain object.
 *
 * Deliberately not everything available: what goes in is what someone would
 * otherwise be asked for by hand, and each field is here because not having
 * it has cost a round of questions. `orientationSamples` in particular is
 * the raw event stream, which is the only way to tell a compass that is
 * biased from one that is being disturbed, and nothing else records it.
 */
export function debugBundle({ page, points = [], calibration = null, photo = null, device = {}, orientationSamples = [], notes = {} }) {
  return {
    schema: 1,
    page,
    generated_at: new Date().toISOString(),
    device,
    photo,
    calibration,
    counts: {
      points: points.length,
      calibration_points: points.filter((p) => p.cal).length,
      from_photo: points.filter((p) => p.source === "photo").length,
    },
    azimuth_range: azimuthRange(points),
    orientation_samples: orientationSamples,
    notes,
    points,
  };
}

/**
 * The span of azimuths a set of points covers, taking the long way round if
 * that is the smaller gap.
 *
 * Worth having in the bundle on its own: calibration points spread over most
 * of a circle is the condition under which a two-point fit picks the wrong
 * way round, so this number says at a glance whether that is in play.
 */
export function azimuthRange(points) {
  if (points.length < 2) return null;
  const sorted = [...points].map((p) => p.az).sort((a, b) => a - b);
  let widestGap = 360 - sorted[sorted.length - 1] + sorted[0];
  for (let i = 1; i < sorted.length; i++) widestGap = Math.max(widestGap, sorted[i] - sorted[i - 1]);
  return {
    min: +sorted[0].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    covered_deg: +(360 - widestGap).toFixed(2),
  };
}

/** CSV in the same shape both pages already export. */
export function pointsToCsv(points) {
  let csv = "azimuth_deg,elevation_deg,timestamp,is_calibration,source\n";
  for (const p of [...points].sort((a, b) => a.az - b.az)) {
    csv += `${p.az.toFixed(2)},${p.el.toFixed(2)},${p.t || ""},${p.cal ? 1 : 0},${p.source || "sensor"}\n`;
  }
  return csv;
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
