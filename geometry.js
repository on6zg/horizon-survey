// Pure geometry shared by index.html and overlay.html.
//
// Nothing here touches the DOM or any browser API, so every function in
// this file is exercised by `node --test test/` -- see CONTRIBUTING.md.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Direction the rear camera is pointing, from a DeviceOrientationEvent's
 * three Euler angles.
 *
 * The event describes the device as an intrinsic Z-X'-Y'' rotation:
 *
 *     R = Rz(alpha) * Rx(beta) * Ry(gamma)
 *
 * taking the device frame (x right across the screen, y up the screen,
 * z out through the screen toward the user) into the Earth frame
 * (x east, y north, z up). The rear camera looks out through the back of
 * the device, i.e. along device -z, so its world direction is R*(0,0,-1)
 * and azimuth/elevation follow from that vector.
 *
 * Deriving it this way instead of reading `beta` and `alpha` on their own
 * matters because the survey posture -- phone held upright, camera aimed
 * at the horizon -- sits at beta ~= 90, which is exactly the singularity
 * of the Z-X'-Y'' decomposition. There, alpha and gamma both turn the
 * device about the world vertical, so alpha alone is not the bearing.
 * Composing the full matrix is well behaved regardless.
 *
 * Returns azimuth in [0,360) measured clockwise from the alpha reference
 * direction, and elevation in [-90,90] above horizontal.
 */
export function cameraAzEl(alpha, beta, gamma) {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;

  // Ry(gamma) * (0,0,-1)
  let x = -Math.sin(g);
  let y = 0;
  let z = -Math.cos(g);

  // Rx(beta)
  [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];

  // Rz(alpha)
  [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  return { az: normalizeAz(Math.atan2(x, y) * DEG), el: Math.asin(clamp(z, -1, 1)) * DEG };
}

/**
 * Camera az/el straight from a DeviceOrientationEvent, or null when the
 * event carries no usable absolute heading.
 *
 * Two sources of an absolute (north-referenced) heading exist and they
 * are not interchangeable:
 *
 * - iOS Safari sets `webkitCompassHeading` and leaves `alpha` referenced
 *   to an arbitrary direction fixed when the page loaded. Reading `alpha`
 *   there gives a bearing that is wrong by a different constant on every
 *   page load. `webkitCompassHeading` is the compass bearing of the top
 *   of the device when it is held flat, which is the same convention as
 *   `360 - alpha` in the absolute frame, so it converts back into an
 *   equivalent alpha for the rotation above.
 * - Chrome/Android fires `deviceorientationabsolute` (or sets
 *   `event.absolute`) with `alpha` already north-referenced.
 *
 * Whether "north" here is true or magnetic north is not something the
 * event tells us and it varies by platform; see the `declination` note
 * in README.md.
 */
export function orientationToAzEl(event) {
  if (event.beta === null || event.beta === undefined) return null;
  const gamma = event.gamma === null || event.gamma === undefined ? 0 : event.gamma;

  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return { ...cameraAzEl(360 - event.webkitCompassHeading, event.beta, gamma), absolute: true };
  }
  if (event.absolute === true && typeof event.alpha === "number") {
    return { ...cameraAzEl(event.alpha, event.beta, gamma), absolute: true };
  }
  return null;
}

/** Fold any angle into [0,360). */
export function normalizeAz(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  // A tiny negative input (atan2 of a rounding-error x component) lands on
  // exactly 360 after that addition, since 360 - 1e-14 is not representable.
  return a >= 360 ? 0 : a;
}

/** Shortest signed difference b - a, in (-180,180]. */
export function azDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// ---- Panorama calibration ----------------------------------------------
//
// A photo carries no compass or scale reference, so the mapping from pixels
// to angles is derived from two points whose real azimuth and elevation the
// user supplies:
//
//     az = aScale * x + aOffset        el = eScale * y + eOffset
//
// The horizontal half of that is well conditioned: the two points are far
// apart in x because the user is told to spread them out.
//
// The vertical half is not. The natural pair of landmarks is two things near
// the horizon, which leaves only a few pixels of difference in y to divide
// by, and a fit from those few pixels can be wrong by a factor of two while
// looking entirely reasonable on screen. So by default the vertical scale is
// not fitted at all: an equirectangular panorama has the same degrees per
// pixel on both axes by construction, so it is taken from the horizontal
// scale, and the two points only set the offset.

/** Minimum separation between the two points, as a fraction of the image. */
export const MIN_SPREAD_FRACTION = 0.05;

/**
 * Derive the pixel-to-angle mapping from two points, each `{x, y, az, el}`.
 *
 * `verticalScale` is "isotropic" (default, vertical scale taken from the
 * horizontal one) or "independent" (fitted from the two elevations, for a
 * photo that has been scaled unevenly). An "independent" request whose
 * points are too close together vertically falls back to isotropic and
 * reports why in `warning` rather than returning a scale it cannot support.
 *
 * Throws when the two points are too close together horizontally, because
 * there is then no usable scale to derive at all.
 */
export function fitCalibration(p1, p2, { imageWidth, imageHeight, verticalScale = "isotropic" } = {}) {
  const dx = p2.x - p1.x;
  const minDx = imageWidth ? MIN_SPREAD_FRACTION * imageWidth : 0;
  if (dx === 0 || Math.abs(dx) < minDx) {
    throw new Error("those two points are too close together horizontally to derive a scale from");
  }

  // Unwrap a pair that straddles north, so 350 to 10 is a 20 degree span
  // rather than a 340 degree one in the other direction.
  let az2 = p2.az;
  if (Math.abs(az2 - p1.az) > 180) az2 += az2 < p1.az ? 360 : -360;

  const aScale = (az2 - p1.az) / dx;
  const aOffset = p1.az - aScale * p1.x;

  const dy = p2.y - p1.y;
  const minDy = imageHeight ? MIN_SPREAD_FRACTION * imageHeight : Infinity;
  let mode = verticalScale;
  let warning = null;
  if (mode === "independent" && Math.abs(dy) < minDy) {
    mode = "isotropic";
    warning =
      "those two points are too close together vertically to fit a separate vertical scale; " +
      "using the horizontal scale for both axes instead";
  }

  let eScale, eOffset;
  if (mode === "independent") {
    eScale = (p2.el - p1.el) / dy;
    eOffset = p1.el - eScale * p1.y;
  } else {
    // Negative because y grows downward while elevation grows upward.
    eScale = -Math.abs(aScale);
    // Both points contribute, so one imprecise click is halved rather than
    // carried whole.
    eOffset = ((p1.el - eScale * p1.y) + (p2.el - eScale * p2.y)) / 2;
  }

  return { aScale, aOffset, eScale, eOffset, verticalScale: mode, warning };
}

/** Real azimuth at a pixel column. */
export function xToAz(cal, x) {
  return normalizeAz(cal.aScale * x + cal.aOffset);
}

/** Real elevation at a pixel row. */
export function yToEl(cal, y) {
  return cal.eScale * y + cal.eOffset;
}

/** Pixel row for an elevation. */
export function elToY(cal, el) {
  return (el - cal.eOffset) / cal.eScale;
}

/**
 * Pixel column for an azimuth.
 *
 * A photo may straddle the 0/360 seam, so the same azimuth has several
 * candidate columns. Whichever lands inside the photo wins; if none does,
 * the nearest one is returned and the caller decides whether it is close
 * enough to draw.
 */
export function azToX(cal, az, width) {
  let best = null, bestOut = Infinity;
  for (const a of [az, az + 360, az - 360]) {
    const x = (a - cal.aOffset) / cal.aScale;
    const out = x < 0 ? -x : (x > width ? x - width : 0);
    if (out < bestOut) { bestOut = out; best = x; }
  }
  return best;
}

// ---- Sample averaging ---------------------------------------------------
//
// A phone magnetometer is noisy at the scale this tool cares about, and the
// tap that records a point moves the phone as well. Averaging a short window
// of samples removes most of that, and the spread of the window is worth
// showing on its own: a bearing that varies by ten degrees while you hold
// still is the signal that something nearby is disturbing the compass.

/**
 * Mean of a set of bearings, in [0,360).
 *
 * Bearings do not average arithmetically: 359 and 1 are two degrees apart
 * but their arithmetic mean is 180. Averaging the unit vectors instead gives
 * the answer that wraps correctly. Returns null for an empty set.
 */
export function circularMeanDeg(anglesDeg) {
  if (!anglesDeg.length) return null;
  let sx = 0, sy = 0;
  for (const a of anglesDeg) {
    sx += Math.cos(a * RAD);
    sy += Math.sin(a * RAD);
  }
  return normalizeAz(Math.atan2(sy, sx) * DEG);
}

/**
 * How far the worst sample sits from the circular mean, going the short way
 * round. Null for an empty set.
 */
export function circularSpreadDeg(anglesDeg) {
  const mean = circularMeanDeg(anglesDeg);
  if (mean === null) return null;
  let worst = 0;
  for (const a of anglesDeg) worst = Math.max(worst, Math.abs(azDelta(mean, a)));
  return worst;
}

/**
 * Middle value of a set, leaving the caller's array alone. Null when empty.
 *
 * Used for elevation rather than a mean, because one sample taken as the
 * finger lands is exactly the kind of outlier a median drops and a mean
 * carries.
 */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Export -------------------------------------------------------------

/**
 * Build the horizon_profile.json that vk5dj-tracker's sky plot reads, so
 * the CSV does not have to be run through a conversion script first.
 *
 * Calibration points are dropped: those are aimed at a landmark you can
 * recognise in a panorama photo, not at the top of an obstruction, so
 * feeding them in as horizon data puts the line somewhere nothing is
 * blocking. Points clicked on a photo are kept, because they are real
 * obstruction readings, but they keep a `source` key so a reader can still
 * tell them apart from sensor measurements.
 *
 * Throws when nothing is left to export.
 */
export function toHorizonProfile(points, { note = null } = {}) {
  const measured = points.filter((p) => !p.cal);
  if (!measured.length) throw new Error("no measured points to export (calibration points are not horizon data)");

  const out = measured
    .map((p) => {
      const row = { az: round2(p.az), el: round2(p.el) };
      if (p.source && p.source !== "sensor") row.source = p.source;
      return row;
    })
    .sort((a, b) => a.az - b.az);

  const stamps = measured.map((p) => p.t).filter(Boolean).sort();
  const fromPhoto = measured.filter((p) => p.source === "photo").length;

  return {
    surveyed_at: stamps.length ? stamps[0].slice(0, 10) : null,
    note:
      note ||
      `Elevation-only obstruction survey (buildings, trees, terrain): ${out.length} points` +
        (fromPhoto ? `, ${fromPhoto} read off a photo rather than measured with the phone` : "") +
        ". Tree lines may sit considerably lower in winter. Not a hard safety limit.",
    points: out,
  };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
