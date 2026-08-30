import test from "node:test";
import assert from "node:assert/strict";

import { circularMeanDeg, circularSpreadDeg, median } from "../geometry.js";

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: got ${actual}, expected ~${expected}`);

test("averaging bearings works across the 0/360 seam", () => {
  // The reason this cannot be a plain arithmetic mean: that would say 180.
  close(circularMeanDeg([359, 1]), 0, 1e-9, "mean of 359 and 1");
  close(circularMeanDeg([350, 355, 5, 10]), 0, 1e-9, "mean straddling north");
});

test("away from the seam it agrees with the obvious answer", () => {
  close(circularMeanDeg([10, 20, 30]), 20, 1e-9, "mean of 10, 20, 30");
  close(circularMeanDeg([180]), 180, 1e-9, "mean of one value");
});

test("the mean is returned in [0,360)", () => {
  for (const set of [[359, 1], [350, 10], [1, 359], [270, 280]]) {
    const m = circularMeanDeg(set);
    assert.ok(m >= 0 && m < 360, `${JSON.stringify(set)} gave ${m}`);
  }
});

test("spread measures how far the worst sample is from the mean, the short way", () => {
  close(circularSpreadDeg([359, 1]), 1, 1e-9, "spread of 359 and 1");
  close(circularSpreadDeg([10, 10, 10]), 0, 1e-9, "spread of identical samples");
  close(circularSpreadDeg([350, 10]), 10, 1e-9, "spread across the seam");
});

test("spread is what tells the user the compass is being disturbed", () => {
  // Standing next to a mast: readings jump around.
  assert.ok(circularSpreadDeg([100, 118, 95, 130, 104]) > 10, "a disturbed set should read as wide");
  assert.ok(circularSpreadDeg([100, 100.4, 99.7, 100.2]) < 1, "a settled set should read as narrow");
});

test("median ignores a single wild sample in a way a mean does not", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5, 5, 5, 5, 90]), 5);
});

test("empty input gives null rather than NaN", () => {
  assert.equal(circularMeanDeg([]), null);
  assert.equal(circularSpreadDeg([]), null);
  assert.equal(median([]), null);
});

test("median does not disturb the caller's array", () => {
  const xs = [3, 1, 2];
  median(xs);
  assert.deepEqual(xs, [3, 1, 2]);
});
