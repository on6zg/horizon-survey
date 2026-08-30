# Working on this repo

Instructions for anyone, human or AI assistant, changing code here. Read
this before the first edit.

## What this project is

Two static pages and one helper script, nothing else:

| File | Role |
|---|---|
| `index.html` | the survey page: camera, sensors, record points |
| `overlay.html` | the panorama page: draw recorded points on a photo |
| `geometry.js` | every angle calculation both pages share, pure functions |
| `serve_https.py` | optional local HTTPS server for testing on a phone |
| `test/` | `node --test` suite for `geometry.js` |

Constraints that are deliberate and should not be traded away without
saying so explicitly in the pull request:

- **No build step.** The pages are opened as they are. No bundler, no
  transpiler, no framework.
- **No runtime dependencies.** `package.json` exists only so `node --test`
  can import `geometry.js` as an ES module. `npm install` installs
  nothing. `serve_https.py` depends on `cryptography` and nothing else.
- **No backend.** Recorded points live in the browser's local storage and
  in the CSV the user downloads. Nothing is ever uploaded.

## Rules

**Angle maths goes in `geometry.js`, with a test.** Not inline in a
`<script>` block. This is not a style preference: the two worst bugs this
project has had were an elevation formula that ignored device roll and a
calibration fit that silently doubled the elevation scale, and neither
was visible by reading the page. If a change computes an angle, a
distance, or a pixel-to-degree scale, it needs a case in `test/`.

**Run `npm test` before saying anything works.** "This works" is a claim
about something you ran. If you did not run it, write what you did not
run instead. Nothing in this repo can test the actual sensors, the
camera, or a real phone, so any change to those paths ships as untested
by definition and the pull request has to say so.

**No debug UI on `master`.** The red click-position cross in
`overlay.html` shipped to users because it was added as "temporary" and
never removed. If you need a debug aid, put it behind a flag that
defaults to off, or take it out before opening the pull request.

**The README describes what the code does today.** Every claim in it has
to survive someone checking it against the source. When a change makes a
README sentence untrue, fix the sentence in the same commit; a later
cleanup commit does not happen. The same goes for comments that name a
variable or a formula that no longer exists.

**Say what a change does not cover.** Skipped scope, assumptions you did
not verify, cases you deliberately left alone: put them at the bottom of
the commit message. A pull request that reads as if it handled everything
is worse than one that lists what it missed.

## Sensor and geometry conventions

Both pages assume the W3C `DeviceOrientationEvent` frame, and getting
this wrong is the easiest way to introduce a bug that looks plausible on
screen:

- Device axes: `x` right across the screen, `y` up the screen, `z` out
  through the screen toward the user. The rear camera therefore points
  along device `-z`.
- World axes: `x` east, `y` north, `z` up.
- The event is an intrinsic Z-X'-Y'' rotation,
  `R = Rz(alpha) Rx(beta) Ry(gamma)`.
- Azimuth and elevation come from `R * (0,0,-1)`. Do not read them off
  `beta` and `alpha` directly. The survey posture is `beta ~= 90`, which
  is exactly where that decomposition is singular.
- `alpha` is north-referenced only when `event.absolute` is true. On iOS
  Safari it is not, and `event.webkitCompassHeading` carries the bearing
  instead.

Whether the device reports true or magnetic north is not stated by the
API and varies by platform. Do not write code or documentation that
assumes one of them.

## Commits and pull requests

- One logical change per commit; one topic per pull request.
- Branch from `master`: `fix/...`, `feat/...`, `chore/...`.
- The commit message explains why the old code was wrong, with the
  evidence: the numbers you measured, the request you made, the test that
  failed. Not just what you changed.
- Do not reformat files you are not otherwise touching.
