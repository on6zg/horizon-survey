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
