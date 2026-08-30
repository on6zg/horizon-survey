import test from "node:test";
import assert from "node:assert/strict";

import { toHorizonProfile } from "../geometry.js";

const P = (az, el, extra = {}) => ({ az, el, t: "2026-08-30T10:00:00.000Z", cal: false, ...extra });

test("points come out sorted by azimuth", () => {
  const profile = toHorizonProfile([P(200, 4), P(10, 8), P(95, 6)]);
  assert.deepEqual(profile.points.map((p) => p.az), [10, 95, 200]);
});

test("calibration points are left out", () => {
  // They are aimed at a landmark you can recognise in a photo, not at the
  // top of an obstruction, so including them puts the horizon somewhere
  // nothing is actually blocking.
  const profile = toHorizonProfile([P(10, 8), P(20, 45, { cal: true }), P(30, 7)]);
  assert.deepEqual(profile.points.map((p) => p.az), [10, 30]);
});

test("points clicked on a photo are kept but stay identifiable", () => {
  const profile = toHorizonProfile([P(10, 8), P(20, 9, { source: "photo" })]);
  assert.equal(profile.points.length, 2);
  assert.equal(profile.points[0].source, undefined, "a sensor point carries no source key");
  assert.equal(profile.points[1].source, "photo");
});

test("angles are rounded to two decimals, matching the CSV", () => {
  const profile = toHorizonProfile([P(10.123456, 8.987654)]);
  assert.equal(profile.points[0].az, 10.12);
  assert.equal(profile.points[0].el, 8.99);
});

test("surveyed_at is the date of the earliest point", () => {
  const profile = toHorizonProfile([
    { az: 10, el: 8, t: "2026-08-30T10:00:00.000Z", cal: false },
    { az: 20, el: 7, t: "2026-08-28T09:00:00.000Z", cal: false },
  ]);
  assert.equal(profile.surveyed_at, "2026-08-28");
});

test("surveyed_at is null when nothing carries a timestamp", () => {
  assert.equal(toHorizonProfile([{ az: 10, el: 8, cal: false }]).surveyed_at, null);
});

test("the note records where the points came from", () => {
  const profile = toHorizonProfile([P(10, 8), P(20, 9, { source: "photo" }), P(30, 45, { cal: true })]);
  assert.match(profile.note, /2 points/);
  assert.match(profile.note, /1 read off a photo/);
});

test("a set with nothing but calibration points is refused", () => {
  assert.throws(() => toHorizonProfile([P(10, 8, { cal: true })]), /no measured points/i);
  assert.throws(() => toHorizonProfile([]), /no measured points/i);
});
