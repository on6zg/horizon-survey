// The overlay page, driven end to end.
//
// Two of the bugs this file covers were about a sequence of user actions
// rather than about a formula, so no unit test could have reached them: a CSV
// import overwriting the survey in local storage, and a calibration from one
// photo being reused for the next.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { loadPlaywright, SKIP, startServer, writePanorama, writeCsv, waitForCanvas } from "./helpers.mjs";

const chromium = await loadPlaywright();
const skip = chromium ? false : SKIP;

const MY_SURVEY = [
  { az: 10, el: 5, t: "2026-01-01T00:00:00.000Z", cal: true },
  { az: 20, el: 6, t: "2026-01-01T00:00:01.000Z", cal: true },
];

let server, browser, panoA, panoB, otherCsv;

before(async () => {
  if (!chromium) return;
  server = await startServer();
  browser = await chromium.launch();
  panoA = writePanorama("panoA.png", 1200, 400);
  panoB = writePanorama("panoB.png", 900, 300, [120, 60, 40]);
  otherCsv = writeCsv("other.csv", [
    "99.00,44.00,2026-02-02T00:00:00.000Z,1,sensor",
    "199.00,33.00,2026-02-02T00:00:01.000Z,1,sensor",
  ]);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function overlayPage({ survey = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept("145,3.5"));
  await page.goto(server.url("overlay.html"));
  if (survey) {
    await page.evaluate((v) => localStorage.setItem("horizonSurveyPoints", v), JSON.stringify(survey));
    await page.reload();
  }
  return { page, context };
}

/** Calibrate on two pixels whose real angles we choose, then wait for it. */
async function calibrate(page, photo, p1, p2) {
  await page.setInputFiles("#fileInput", photo);
  await waitForCanvas(page, 1200);
  page.removeAllListeners("dialog");
  const answers = [`${p1.az},${p1.el}`, `${p2.az},${p2.el}`];
  page.on("dialog", (d) => d.accept(answers.shift()));
  await page.click("#canvas", { position: { x: p1.x, y: p1.y } });
  await page.waitForTimeout(150);
  await page.click("#canvas", { position: { x: p2.x, y: p2.y } });
  await page.waitForTimeout(250);
}

test("a calibrated photo maps pixels back to the angles that were entered", { skip }, async () => {
  const { page, context } = await overlayPage();
  // 1200 px wide, and we declare 100 px = az 100 and 700 px = az 136, so the
  // scale is 0.06 deg/px. Halfway between them must read az 118.
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2 }, { x: 700, y: 200, az: 136, el: 2 });
  assert.match((await page.textContent("#calStatus")).trim(), /^calibrated on 2 points --/);

  const mid = await page.evaluate(() => {
    const cal = JSON.parse(localStorage.getItem("horizonSurveyCalibration"));
    return cal.aScale * 400 + cal.aOffset;
  });
  assert.ok(Math.abs(mid - 118) < 0.01, `midpoint azimuth was ${mid}`);
  await context.close();
});

test("the vertical scale comes from the horizontal one, not from two near-equal heights", { skip }, async () => {
  const { page, context } = await overlayPage();
  // The two points are 3 px apart vertically. Fitting a scale from that gave
  // an elevation roughly twice the truth.
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2.0 }, { x: 700, y: 197, az: 136, el: 2.4 });
  const cal = await page.evaluate(() => JSON.parse(localStorage.getItem("horizonSurveyCalibration")));
  assert.ok(Math.abs(Math.abs(cal.eScale) - Math.abs(cal.aScale)) < 1e-9,
    `eScale ${cal.eScale} should match aScale ${cal.aScale} in magnitude`);
  assert.ok(cal.eScale < 0, "elevation must grow upward");
  await context.close();
});

test("loading a CSV does not overwrite the survey in this browser", { skip }, async () => {
  const { page, context } = await overlayPage({ survey: MY_SURVEY });
  await page.setInputFiles("#csvInput", otherCsv);
  await page.waitForSelector("#importNote", { state: "visible", timeout: 5000 });

  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")));
  assert.deepEqual(stored, MY_SURVEY, "the survey recorded on this device must survive an import");
  await context.close();
});

test("adding a point while showing an imported CSV also leaves storage alone", { skip }, async () => {
  const { page, context } = await overlayPage({ survey: MY_SURVEY });
  await page.setInputFiles("#csvInput", otherCsv);
  await page.waitForSelector("#importNote", { state: "visible" });
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2 }, { x: 700, y: 210, az: 136, el: 2 });
  await page.click("#addPointModeBtn");
  await page.click("#canvas", { position: { x: 400, y: 250 } });
  await page.waitForTimeout(200);

  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("horizonSurveyPoints")));
  assert.deepEqual(stored, MY_SURVEY);
  await context.close();
});

test("a calibration is not reused for a different photo", { skip }, async () => {
  const { page, context } = await overlayPage();
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2 }, { x: 700, y: 210, az: 136, el: 2 });
  assert.match((await page.textContent("#calStatus")).trim(), /^calibrated on 2 points --/);

  await page.goto(server.url("overlay.html"));
  await page.setInputFiles("#fileInput", panoB);
  await page.waitForTimeout(400);

  assert.match((await page.textContent("#calStatus")).trim(), /click a known landmark/i);
  assert.equal(await page.isDisabled("#addPointModeBtn"), true,
    "no calibration should be in force for a photo that was never calibrated");
  await context.close();
});

test("a calibration is restored for the photo it was made for", { skip }, async () => {
  const { page, context } = await overlayPage();
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2 }, { x: 700, y: 210, az: 136, el: 2 });

  await page.goto(server.url("overlay.html"));
  await page.setInputFiles("#fileInput", panoA);
  await page.waitForTimeout(400);
  assert.match((await page.textContent("#calStatus")).trim(), /restored for this photo/i);
  await context.close();
});

test("a very large panorama is drawn into a bounded canvas", { skip }, async () => {
  const { page, context } = await overlayPage();
  const huge = writePanorama("huge.png", 5000, 2500);
  await page.setInputFiles("#fileInput", huge);
  await waitForCanvas(page, 4096);
  const size = await page.evaluate(() => {
    const c = document.getElementById("canvas");
    return { w: c.width, h: c.height };
  });
  assert.equal(size.w, 4096, "canvas width should be capped");
  assert.equal(size.h, 2048, "aspect ratio should be preserved");
  await context.close();
});

test("a file the browser cannot decode says so instead of doing nothing", { skip }, async () => {
  const { page, context } = await overlayPage();
  await page.setInputFiles("#fileInput", {
    name: "photo.heic", mimeType: "image/heic", buffer: Buffer.from("ftypheic not an image"),
  });
  await page.waitForTimeout(400);
  assert.match((await page.textContent("#calStatus")).trim(), /could not decode/i);
  await context.close();
});

// ---- The trim tool -------------------------------------------------------
//
// This flow reached users without a test and came back as a blank-canvas
// report. The unit tests cover trimBounds(); nothing covered two clicks
// turning into a cropped photo you can then calibrate.

/** Trim by clicking near both edges, and report what the canvas holds after. */
async function trimAcross(page, canvasWidth) {
  await page.click("#trimBtn");
  await page.click("#canvas", { position: { x: Math.round(canvasWidth * 0.04), y: 100 } });
  await page.waitForTimeout(120);
  await page.click("#canvas", { position: { x: Math.round(canvasWidth * 0.96), y: 100 } });
  // Wait on the status line, not on the canvas width. A photo wider than
  // MAX_CANVAS_WIDTH is re-capped to the same 4096 after trimming, so its
  // width does not change at all: only the height does, because the aspect
  // ratio did.
  await page.waitForFunction(
    () => /trimmed to \d+px/.test(document.getElementById("calStatus").textContent),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(() => {
    const c = document.getElementById("canvas");
    const ctx = c.getContext("2d");
    let drawn = 0, total = 0;
    for (let x = 4; x < c.width; x += Math.max(1, Math.floor(c.width / 20))) {
      for (let y = 4; y < c.height; y += Math.max(1, Math.floor(c.height / 10))) {
        total++;
        if (ctx.getImageData(x, y, 1, 1).data[3] !== 0) drawn++;
      }
    }
    return { w: c.width, h: c.height, drawn, total, status: document.getElementById("calStatus").textContent.trim() };
  });
}

test("trimming leaves a narrower photo that actually has pixels in it", { skip }, async () => {
  const { page, context } = await overlayPage();
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);

  const after = await trimAcross(page, 1200);
  assert.ok(after.w < 1200, `canvas should be narrower after trimming, was ${after.w}`);
  assert.equal(after.drawn, after.total, "every sampled pixel must be drawn, not a blank canvas");
  assert.match(after.status, /trimmed to \d+px/);
  await context.close();
});

test("a trimmed photo calibrates from one point at exactly 360 over its width", { skip }, async () => {
  const { page, context } = await overlayPage();
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);
  const after = await trimAcross(page, 1200);

  await page.check("#fixed360");
  await page.click("#recalBtn");
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => d.accept("100,2"));
  await page.click("#canvas", { position: { x: 200, y: 150 } });
  await page.waitForTimeout(300);

  const cal = await page.evaluate(() => JSON.parse(localStorage.getItem("horizonSurveyCalibration")));
  assert.ok(Math.abs(cal.aScale - 360 / after.w) < 1e-9,
    `aScale ${cal.aScale} should be 360/${after.w} = ${360 / after.w}`);
  await context.close();
});

test("a photo far larger than the display canvas still trims to something visible", { skip }, async () => {
  const { page, context } = await overlayPage();
  const big = writePanorama("bigtrim.png", 6000, 3000);
  await page.setInputFiles("#fileInput", big);
  await waitForCanvas(page, 4096);

  const after = await trimAcross(page, 4096);
  assert.equal(after.drawn, after.total, "a large photo must not trim to a blank canvas");
  // The width stays at the cap; the height is what records that a narrower
  // slice of the same photo is now being shown.
  assert.equal(after.w, 4096);
  assert.ok(after.h > 2048, `height should grow as the photo narrows, was ${after.h}`);
  await context.close();
});

test("two clicks too close together are refused rather than cropping the photo away", { skip }, async () => {
  const { page, context } = await overlayPage();
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);

  await page.click("#trimBtn");
  await page.click("#canvas", { position: { x: 300, y: 100 } });
  await page.waitForTimeout(120);
  await page.click("#canvas", { position: { x: 380, y: 100 } });
  await page.waitForTimeout(400);

  assert.match((await page.textContent("#calStatus")).trim(), /too close together/i);
  assert.equal(await page.evaluate(() => document.getElementById("canvas").width), 1200,
    "the photo must be left alone when the clicks are refused");
  await context.close();
});

test("calibrating reports how much of the horizon the photo covers", { skip }, async () => {
  const { page, context } = await overlayPage();
  // 1200 px wide, 100 px = az 100 and 700 px = az 136, so 0.06 deg/px and
  // the photo covers 1200 * 0.06 = 72 degrees.
  await calibrate(page, panoA, { x: 100, y: 200, az: 100, el: 2 }, { x: 700, y: 200, az: 136, el: 2 });
  assert.match((await page.textContent("#calStatus")).trim(), /this photo covers 72° of azimuth/);
  await context.close();
});

test("the reported span is what betrays a calibration that took the wrong way round", { skip }, async () => {
  const { page, context } = await overlayPage();
  // Two landmarks 300 degrees apart on a photo that really turns all the
  // way round. fitCalibration takes the 60 degree short way, and the span
  // it then reports is the visible symptom of that: nothing like a photo
  // you can see goes most of the way round.
  await calibrate(page, panoA, { x: 100, y: 200, az: 109, el: 2 }, { x: 1100, y: 200, az: 49, el: 2 });
  const status = (await page.textContent("#calStatus")).trim();
  const span = Number(status.match(/covers (\d+)°/)[1]);
  assert.ok(span < 120, `a mis-scaled fit should report a small span, reported ${span}`);
  await context.close();
});

// Three marked calibration points at az 130, 280 and 70, which on a 1200 px
// photo at 0.3 deg/px sit at x=100, 600 and 1100. The outer two are 300
// degrees apart, so a two-point fit would take the 60 degree short way; the
// middle one says otherwise.
const THREE_MARKED = [
  { az: 130, el: 2, t: "2026-01-01T00:00:00.000Z", cal: true },
  { az: 280, el: 2, t: "2026-01-01T00:00:01.000Z", cal: true },
  { az: 70, el: 2, t: "2026-01-01T00:00:02.000Z", cal: true },
];

/** Load a photo, then calibrate on the ticked marked points by clicking each. */
async function calibrateOnMarked(page, photo, xs) {
  await page.setInputFiles("#fileInput", photo);
  await waitForCanvas(page, 1200);
  await page.click("#useMarkedBtn");
  for (const x of xs) {
    await page.click("#canvas", { position: { x, y: 200 } });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(250);
}

test("every marked point is offered, and a fit over three takes the way round they agree on", { skip }, async () => {
  const { page, context } = await overlayPage({ survey: THREE_MARKED });
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);
  assert.equal(await page.locator("#calList input[type=checkbox]").count(), 3);
  assert.equal(await page.locator("#calList input[type=checkbox]:checked").count(), 3, "all ticked by default");

  await page.click("#useMarkedBtn");
  for (const x of [100, 600, 1100]) {
    await page.click("#canvas", { position: { x, y: 200 } });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(250);
  const status = (await page.textContent("#calStatus")).trim();
  assert.match(status, /^calibrated on 3 points --/);
  assert.match(status, /this photo covers 360° of azimuth/);
  await context.close();
});

test("a marked point recorded off its bearing is named with how far off it lands", { skip }, async () => {
  const survey = THREE_MARKED.map((p, i) => (i === 1 ? { ...p, az: 286 } : p));
  const { page, context } = await overlayPage({ survey });
  await calibrateOnMarked(page, panoA, [100, 600, 1100]);
  assert.match((await page.textContent("#calStatus")).trim(), /worst point 4\.0° off/);
  const residuals = (await page.textContent("#calResiduals")).replace(/\s+/g, " ");
  assert.match(residuals, /286\.0°\/2\.0°: -4\.0° az/);
  await context.close();
});

test("an unticked marked point is left out of the fit", { skip }, async () => {
  const { page, context } = await overlayPage({ survey: THREE_MARKED });
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);
  await page.locator("#calList input[type=checkbox]").nth(2).uncheck();
  await page.click("#useMarkedBtn");
  for (const x of [100, 600]) {
    await page.click("#canvas", { position: { x, y: 200 } });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(250);
  assert.match((await page.textContent("#calStatus")).trim(), /^calibrated on 2 points --/);
  await context.close();
});

test("in fixed-360 mode the marked list offers the points singly and calibrates from one", { skip }, async () => {
  const { page, context } = await overlayPage({ survey: THREE_MARKED });
  await page.setInputFiles("#fileInput", panoA);
  await waitForCanvas(page, 1200);
  await page.check("#fixed360");
  assert.equal(await page.locator("#calList input[type=checkbox]:checked").count(), 1, "one ticked by default");
  await page.click("#useMarkedBtn");
  await page.click("#canvas", { position: { x: 100, y: 200 } });
  await page.waitForTimeout(250);
  const status = (await page.textContent("#calStatus")).trim();
  assert.match(status, /^calibrated -- this photo covers 360° of azimuth/);
  assert.equal(await page.isVisible("#calResiduals"), false, "nothing to check from one point");
  await context.close();
});
