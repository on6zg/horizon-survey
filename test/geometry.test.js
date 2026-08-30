import test from "node:test";
import assert from "node:assert/strict";

import { cameraAzEl, orientationToAzEl, normalizeAz, azDelta } from "../geometry.js";

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: got ${actual}, expected ~${expected}`);

test("phone upright and level reads 0 deg elevation on the alpha reference bearing", () => {
  const { az, el } = cameraAzEl(0, 90, 0);
  close(az, 0, 1e-9, "az");
  close(el, 0, 1e-9, "el");
});

test("with no roll, elevation is beta - 90", () => {
  for (const beta of [70, 90, 100, 120]) {
    close(cameraAzEl(0, beta, 0).el, beta - 90, 1e-9, `el at beta=${beta}`);
  }
});

test("alpha rotates the bearing the other way round", () => {
  // The pre-matrix code used (360 - alpha) % 360; that stays true at gamma=0.
  for (const alpha of [0, 40, 180, 350]) {
    close(cameraAzEl(alpha, 90, 0).az, (360 - alpha) % 360, 1e-9, `az at alpha=${alpha}`);
  }
});

test("roll changes the bearing, which reading alpha alone would miss", () => {
  // Reference values computed from R = Rz(a)Rx(b)Ry(g) applied to (0,0,-1).
  const cases = [
    { a: 0, b: 100, g: 15, az: 344.8, el: 9.7 },
    { a: 0, b: 100, g: 30, az: 329.6, el: 8.6 },
    { a: 0, b: 110, g: 45, az: 313.2, el: 14.0 },
    { a: 40, b: 100, g: 20, az: 299.7, el: 9.4 },
  ];
  for (const c of cases) {
    const got = cameraAzEl(c.a, c.b, c.g);
    close(got.az, c.az, 0.05, `az for ${JSON.stringify(c)}`);
    close(got.el, c.el, 0.05, `el for ${JSON.stringify(c)}`);
  }
});

test("held in landscape the camera still points at the horizon", () => {
  // gamma = 90 is the phone turned on its side. beta - 90 would claim
  // 5 deg of elevation here; the camera is actually level.
  const { az, el } = cameraAzEl(0, 95, 90);
  close(az, 270, 1e-6, "az");
  close(el, 0, 1e-6, "el");
});

test("azimuth is always in [0,360)", () => {
  for (let a = -720; a <= 720; a += 37) {
    for (const g of [-90, -30, 0, 30, 90]) {
      const { az } = cameraAzEl(a, 95, g);
      assert.ok(az >= 0 && az < 360, `az out of range: ${az} (alpha=${a}, gamma=${g})`);
    }
  }
});

test("elevation never leaves [-90,90] even for out-of-range input", () => {
  for (const b of [-180, -90, 0, 90, 180, 270]) {
    const { el } = cameraAzEl(0, b, 0);
    assert.ok(el >= -90 && el <= 90, `el out of range: ${el} (beta=${b})`);
    assert.ok(!Number.isNaN(el), `el is NaN at beta=${b}`);
  }
});

test("orientationToAzEl prefers webkitCompassHeading over alpha", () => {
  // alpha is deliberately nonsense here: on iOS it is referenced to
  // wherever the device happened to point when the page loaded.
  const withCompass = orientationToAzEl({ alpha: 123, beta: 90, gamma: 0, webkitCompassHeading: 90 });
  close(withCompass.az, 90, 1e-6, "az from webkitCompassHeading");
  assert.equal(withCompass.absolute, true);
});

test("orientationToAzEl rejects a relative-only event", () => {
  assert.equal(orientationToAzEl({ alpha: 10, beta: 90, gamma: 0, absolute: false }), null);
  assert.equal(orientationToAzEl({ alpha: 10, beta: 90, gamma: 0 }), null);
});

test("orientationToAzEl rejects an event with no tilt", () => {
  assert.equal(orientationToAzEl({ alpha: 10, beta: null, gamma: 0, absolute: true }), null);
});

test("orientationToAzEl treats a missing gamma as zero rather than NaN", () => {
  const got = orientationToAzEl({ alpha: 0, beta: 100, gamma: null, absolute: true });
  close(got.el, 10, 1e-9, "el");
  close(got.az, 0, 1e-9, "az");
});

test("normalizeAz folds into [0,360)", () => {
  assert.equal(normalizeAz(0), 0);
  assert.equal(normalizeAz(360), 0);
  assert.equal(normalizeAz(-1), 359);
  assert.equal(normalizeAz(721), 1);
});

test("azDelta takes the short way round the compass", () => {
  assert.equal(azDelta(350, 10), 20);
  assert.equal(azDelta(10, 350), -20);
  assert.equal(azDelta(0, 180), 180);
});
