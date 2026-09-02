// The survey page, driven end to end: camera permission, a sensor event, the
// HUD, Record, local storage, and the CSV that comes out.
//
// This is the seam the unit tests cannot reach. geometry.js can be perfect
// while nothing is wired to it, which is exactly what happened once: the page
// checked for `webkitCompassHeading` in one function and read `alpha` in the
// next, and both halves were correct on their own.

import fs from "node:fs";

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { loadPlaywright, SKIP, startServer, feedOrientation, readZipNames, readZipEntry } from "./helpers.mjs";

const chromium = await loadPlaywright();
const skip = chromium ? false : SKIP;

let server, browser;

before(async () => {
  if (!chromium) return;
  server = await startServer();
  browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function surveyPage() {
  const context = await browser.newContext({ permissions: ["camera"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(server.url("index.html"));
  return { page, context };
}

async function start(page) {
  await page.click("#startBtn");
  await page.waitForSelector("#stage", { state: "visible", timeout: 10_000 });
}

test("Start gets past the camera permission and shows the survey view", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  assert.equal(await page.isVisible("#stage"), true);
  assert.equal((await page.textContent("#startError")).trim(), "");
  await context.close();
});

test("an absolute orientation event reaches the HUD through geometry.js", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  // alpha=0 beta=100 gamma=30 is the roll case from test/geometry.test.js:
  // az 329.6, el 8.6. Reading beta and alpha directly would say az 0, el 10.
  await feedOrientation(page, 0, 100, 30);
  await page.waitForTimeout(100);
  assert.equal((await page.textContent("#azVal")).trim(), "329.6°");
  assert.equal((await page.textContent("#elVal")).trim(), "8.6°");
  await context.close();
});

test("Record stores what the HUD showed, and the CSV matches it", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  for (let i = 0; i < 5; i++) {
    await feedOrientation(page, 0, 100, 0);
    await page.waitForTimeout(40);
  }
  await page.click("#recordBtn");
  await page.waitForTimeout(200);

  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")));
  assert.equal(stored.length, 1);
  assert.ok(Math.abs(stored[0].az - 0) < 0.05, `az was ${stored[0].az}`);
  assert.ok(Math.abs(stored[0].el - 10) < 0.05, `el was ${stored[0].el}`);
  assert.equal(stored[0].cal, false);
  assert.equal((await page.textContent("#count")).trim(), "1 point");

  const download = page.waitForEvent("download");
  await page.click("#downloadBtn");
  const text = fs.readFileSync(await (await download).path(), "utf8");
  assert.match(text, /^azimuth_deg,elevation_deg,timestamp,is_calibration,source$/m);
  assert.match(text, /^0\.00,10\.00,[^,]+,0,sensor$/m);
  await context.close();
});

test("a calibration point is recorded as one, and the CSV says so", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  for (let i = 0; i < 5; i++) {
    await feedOrientation(page, 90, 95, 0);
    await page.waitForTimeout(40);
  }
  await page.click("#calBtn");
  await page.waitForTimeout(200);
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")));
  assert.equal(stored[0].cal, true);
  await context.close();
});

test("an event with no compass reference records nothing and says why", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  // absolute:false is what a device with no north reference delivers. The
  // page used to show a confident-looking bearing built from whatever
  // direction it happened to face when the page loaded.
  await page.evaluate(() => {
    const e = new Event("deviceorientation");
    Object.defineProperties(e, {
      alpha: { value: 42 }, beta: { value: 100 }, gamma: { value: 0 }, absolute: { value: false },
    });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(150);

  assert.equal((await page.textContent("#azVal")).trim(), "--.-°");
  assert.match((await page.textContent("#status")).trim(), /no compass-referenced heading/i);

  await page.click("#recordBtn");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")), null);
  await context.close();
});

test("a buffer that has gone stale refuses instead of averaging old readings", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  for (let i = 0; i < 4; i++) {
    await feedOrientation(page, 90, 100, 0);
    await page.waitForTimeout(40);
  }
  // Events stop arriving. Everything in the buffer is now older than the
  // one-second window, so there is nothing fresh to average.
  await page.waitForTimeout(1400);
  await page.click("#recordBtn");
  await page.waitForTimeout(200);

  assert.equal(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")), null);
  assert.match((await page.textContent("#status")).trim(), /no sensor reading yet/i);
  await context.close();
});

test("the spread readout warns while the compass is being pulled around", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  for (const alpha of [90, 78, 101, 85, 96]) {
    await feedOrientation(page, alpha, 100, 0);
    await page.waitForTimeout(40);
  }
  const spread = (await page.textContent("#spread")).trim();
  assert.match(spread, /^±\d+\.\d°/, `spread readout was ${JSON.stringify(spread)}`);
  assert.equal(await page.getAttribute("#spread", "class"), "wide");
  await context.close();
});

test("Send debug produces a bundle carrying the raw sensor events", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  for (const [alpha, beta, gamma] of [[0, 100, 0], [1, 100.2, 2], [359, 99.8, -1], [2, 100, 0], [0, 100.1, 1]]) {
    await feedOrientation(page, alpha, beta, gamma);
    await page.waitForTimeout(40);
  }
  await page.click("#recordBtn");
  await page.waitForTimeout(200);

  const download = page.waitForEvent("download");
  await page.click("#debugBtn");
  const d = await download;
  assert.match(d.suggestedFilename(), /^horizon_debug_.*\.zip$/);

  const zip = fs.readFileSync(await d.path());
  const entries = readZipNames(zip);
  assert.deepEqual(entries.sort(), ["debug.json", "points.csv"]);

  const bundle = JSON.parse(readZipEntry(zip, "debug.json"));
  assert.equal(bundle.page, "survey");
  assert.equal(bundle.counts.points, 1);
  // Chromium delivers orientation events of its own, with null angles,
  // alongside the ones dispatched here. That is what a real device does too,
  // and recording both is the point, so the assertions are about the usable
  // ones rather than about the total.
  const usable = bundle.orientation_samples.filter((r) => r.absolute && typeof r.alpha === "number");
  assert.ok(usable.length >= 5, `expected the five fed events, got ${usable.length}`);
  const raw = usable.at(-1);
  assert.equal(typeof raw.beta, "number");
  assert.equal(typeof raw.gamma, "number", "gamma is what a two-angle reading would have thrown away");
  assert.ok(bundle.notes.event_counts.total >= usable.length);
  assert.ok(bundle.device.user_agent.length > 0);
  await context.close();
});

test("a bundle from a device with no compass reference records that it had none", { skip }, async () => {
  const { page, context } = await surveyPage();
  await start(page);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const e = new Event("deviceorientation");
      Object.defineProperties(e, {
        alpha: { value: 42 }, beta: { value: 100 }, gamma: { value: 0 }, absolute: { value: false },
      });
      window.dispatchEvent(e);
    }
  });
  await page.waitForTimeout(150);

  const download = page.waitForEvent("download");
  await page.click("#debugBtn");
  const bundle = JSON.parse(readZipEntry(fs.readFileSync(await (await download).path()), "debug.json"));
  // What matters is that no event ever produced a usable heading, not the
  // exact tally: the browser contributes events of its own here.
  assert.equal(bundle.notes.have_absolute_heading, false);
  assert.ok(bundle.notes.event_counts.unusable >= 3, "the unusable events must be counted");
  assert.equal(bundle.orientation_samples.filter((r) => r.absolute && typeof r.alpha === "number").length, 0,
    "nothing in the bundle should look like a usable absolute reading");
  assert.equal(bundle.counts.points, 0);
  await context.close();
});
