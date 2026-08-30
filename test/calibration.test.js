import test from "node:test";
import assert from "node:assert/strict";

import { fitCalibration, fitCalibration360, trimBounds, azToX, xToAz, elToY, yToEl } from "../geometry.js";

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

test("two points with the same azimuth are refused, not silently scaled to zero", () => {
  // A typing slip during manual calibration. aScale would be 0, azToX()
  // would divide by it, every marker would fail the on-canvas bounds check
  // and the whole line would vanish while the status still read
  // "calibrated".
  assert.throws(
    () => fitCalibration(
      { x: 100, y: 500, az: 145, el: 2 },
      { x: 4000, y: 2500, az: 145, el: 20 },
      PANO,
    ),
    /same azimuth/i,
  );
});

test("an independent fit refuses two identical elevations too", () => {
  const cal = fitCalibration(
    { x: 100, y: 500, az: 100, el: 3 },
    { x: 700, y: 2500, az: 136, el: 3 },
    { ...PANO, verticalScale: "independent" },
  );
  assert.equal(cal.verticalScale, "isotropic");
  assert.match(cal.warning, /same elevation/i);
  assert.ok(Number.isFinite(cal.eScale) && cal.eScale !== 0, `eScale was ${cal.eScale}`);
  assert.ok(Number.isFinite(elToY(cal, 10)), "elToY must not divide by zero");
});

test("every fit that is returned produces finite pixels", () => {
  for (const opts of [PANO, { ...PANO, verticalScale: "independent" }]) {
    const cal = fitCalibration(...NEAR_HORIZON, opts);
    assert.ok(Number.isFinite(azToX(cal, 123, PANO.imageWidth)), "azToX finite");
    assert.ok(Number.isFinite(elToY(cal, 5)), "elToY finite");
  }
});

// ---- fitCalibration360 ---------------------------------------------------
//
// The bug this exists for: two calibration points spread genuinely wide
// apart on a near-360 photo (109 and 359 degrees, a real ~250 degree span
// along the photo) get silently folded to the "short way" (110 degrees) by
// fitCalibration()'s wraparound unwrap, which always picks whichever gap is
// under 180 degrees. That gives a scale roughly half of, and opposite in
// sign region to, the true one -- correct-looking near the calibration
// points, increasingly wrong toward the edges.

test("the scale is fixed at 360/width, not derived from the point at all", () => {
  const cal = fitCalibration360({ x: 500, y: 200, az: 145, el: 3 }, { imageWidth: 6000 });
  close(cal.aScale, 360 / 6000, 1e-9, "aScale");
});

test("the single point round-trips through its own calibration exactly", () => {
  const p = { x: 500, y: 200, az: 145, el: 3 };
  const cal = fitCalibration360(p, { imageWidth: 6000 });
  close(xToAz(cal, p.x), p.az, 1e-9, "az at the calibration point");
  close(yToEl(cal, p.y), p.el, 1e-9, "el at the calibration point");
});

test("direction flips which way azimuth runs across the photo", () => {
  const p = { x: 500, y: 200, az: 145, el: 3 };
  const forward = fitCalibration360(p, { imageWidth: 6000, direction: 1 });
  const reverse = fitCalibration360(p, { imageWidth: 6000, direction: -1 });
  assert.ok(forward.aScale > 0, "default direction increases left to right");
  assert.ok(reverse.aScale < 0, "reverse direction decreases left to right");
  // Both still pass through the same calibration point regardless.
  close(xToAz(forward, p.x), p.az, 1e-9, "forward still hits the point");
  close(xToAz(reverse, p.x), p.az, 1e-9, "reverse still hits the point");
});

test("a wide-apart pair that fitCalibration mis-scales is exact with fitCalibration360", () => {
  // Same shape as the real report: two landmarks a genuine ~250 degrees
  // apart along a 6000 px photo, at x=1000 (az 109) and x=5083 (az 359,
  // i.e. -1, reached by sweeping the long way round from 109).
  const width = 6000;
  const trueScale = 250 / (5083 - 1000); // the real degrees/px this photo has
  const p1 = { x: 1000, y: 300, az: 109, el: 5 };

  const wide = fitCalibration(p1, { x: 5083, y: 300, az: 359, el: 5 }, { imageWidth: width });
  // fitCalibration folds 109->359 to the short way (110 degrees), so it does
  // not recover the true ~250 degree scale.
  assert.ok(Math.abs(Math.abs(wide.aScale) - trueScale) > 0.01, "fitCalibration should NOT match the true scale here");

  const fixed = fitCalibration360(p1, { imageWidth: width });
  close(Math.abs(fixed.aScale), 360 / width, 1e-9, "fitCalibration360 uses the photo width directly");
});

// ---- trimBounds -----------------------------------------------------------

test("trimBounds spans exactly between the two clicks, regardless of click order", () => {
  assert.deepEqual(trimBounds(500, 5500, 6000), { left: 500, width: 5000 });
  assert.deepEqual(trimBounds(5500, 500, 6000), { left: 500, width: 5000 });
});

test("a span far narrower than the photo is refused as a mis-click, not silently cropped", () => {
  assert.throws(() => trimBounds(1000, 1200, 6000), /too close together/i);
});
