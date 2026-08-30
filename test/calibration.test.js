import test from "node:test";
import assert from "node:assert/strict";

import { fitCalibration, azToX, xToAz, elToY, yToEl } from "../geometry.js";

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: got ${actual}, expected ~${expected}`);

// A 6000x3000 equirectangular panorama covers 360 degrees across its width,
// so its true scale is 360/6000 = 0.06 deg/px on both axes.
const PANO = { imageWidth: 6000, imageHeight: 3000 };

// The realistic calibration: two landmarks near the horizon, 600 px apart
// horizontally and 3 px apart vertically.
const NEAR_HORIZON = [
  { x: 100, y: 1500, az: 100, el: 2.0 },
  { x: 700, y: 1497, az: 136, el: 2.4 },
];

test("two landmarks at the same height still give a usable elevation scale", () => {
  const cal = fitCalibration(...NEAR_HORIZON, PANO);
  // 200 px above the horizon on this photo is 200 * 0.06 = 12 degrees up.
  // Fitting the vertical scale from a 3 px difference gave 28.7 here.
  close(yToEl(cal, 1300), 14.0, 0.2, "elevation 200 px above the first point");
  close(cal.eScale, -0.06, 0.001, "eScale");
  assert.equal(cal.verticalScale, "isotropic");
});

test("the horizontal scale is unaffected by the vertical model", () => {
  const cal = fitCalibration(...NEAR_HORIZON, PANO);
  close(cal.aScale, 0.06, 1e-9, "aScale");
  close(xToAz(cal, 100), 100, 1e-9, "az back at the first point");
  close(xToAz(cal, 700), 136, 1e-9, "az back at the second point");
});

test("an independent vertical fit is available when the points support one", () => {
  const cal = fitCalibration(
    { x: 100, y: 500, az: 100, el: 20 },
    { x: 700, y: 2500, az: 136, el: -10 },
    { ...PANO, verticalScale: "independent" },
  );
  assert.equal(cal.verticalScale, "independent");
  assert.equal(cal.warning, null);
  close(cal.eScale, -0.015, 1e-9, "eScale");
});

test("an independent fit falls back rather than magnifying a 3 px difference", () => {
  const cal = fitCalibration(...NEAR_HORIZON, { ...PANO, verticalScale: "independent" });
  assert.equal(cal.verticalScale, "isotropic");
  assert.match(cal.warning, /too close together vertically/i);
  close(yToEl(cal, 1300), 14.0, 0.2, "elevation falls back to the isotropic answer");
});

test("two points too close together horizontally cannot be fitted at all", () => {
  assert.throws(
    () => fitCalibration({ x: 100, y: 500, az: 100, el: 2 }, { x: 140, y: 2500, az: 101, el: 2 }, PANO),
    /horizontally/i,
  );
});

test("a pair straddling north is unwrapped instead of read as a 340 degree span", () => {
  const cal = fitCalibration(
    { x: 100, y: 1500, az: 350, el: 2 },
    { x: 700, y: 1500, az: 10, el: 2 },
    PANO,
  );
  close(cal.aScale, 20 / 600, 1e-9, "aScale across the seam");
});

test("pixel and angle conversions are inverses of each other", () => {
  const cal = fitCalibration(...NEAR_HORIZON, PANO);
  for (const x of [0, 250, 1000, 3000, 5999]) {
    close(azToX(cal, xToAz(cal, x), PANO.imageWidth), x, 1e-6, `x roundtrip at ${x}`);
  }
  for (const y of [0, 700, 1500, 2999]) {
    close(elToY(cal, yToEl(cal, y)), y, 1e-6, `y roundtrip at ${y}`);
  }
});

test("azToX picks the wrap that lands inside the photo", () => {
  // This photo runs from az 100 at x=100 to az 460 (= 100) at x=6100, so
  // an azimuth of 20 degrees is only inside it as 380.
  const cal = fitCalibration(...NEAR_HORIZON, PANO);
  const x = azToX(cal, 20, PANO.imageWidth);
  assert.ok(x >= 0 && x <= PANO.imageWidth, `expected a pixel inside the photo, got ${x}`);
});

test("elevation grows upward, so the vertical scale is negative", () => {
  const cal = fitCalibration(...NEAR_HORIZON, PANO);
  assert.ok(cal.eScale < 0, `eScale should be negative, got ${cal.eScale}`);
  assert.ok(yToEl(cal, 1000) > yToEl(cal, 2000), "higher in the photo must mean higher elevation");
});
