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
  assert.equal((await page.textContent("#calStatus")).trim(), "calibrated");

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
  assert.equal((await page.textContent("#calStatus")).trim(), "calibrated");

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
