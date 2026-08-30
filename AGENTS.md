# AGENTS.md — horizon-survey contributor rules

Conventions for anyone, human or AI agent, changing code here. Read this
before the first edit and before opening a PR.

## What this is

A two-page static tool for surveying the visible horizon around an
antenna site, and a small helper script to serve it over HTTPS for
testing on a phone. No backend, no accounts, no telemetry.

| File | Role |
|---|---|
| `index.html` | survey page: camera, sensors, record points |
| `overlay.html` | panorama page: draw recorded points on a photo |
| `geometry.js` | every angle calculation both pages share, pure functions |
| `serve_https.py` | optional local HTTPS server for phone testing |
| `test/` | `node --test` suite for `geometry.js` |
| `test/browser/` | the same runner driving both pages in Chromium |

Constraints that are deliberate. Trading one away is allowed, but say so
explicitly in the PR rather than in passing:

- **No build step.** The pages are served as they are. No bundler, no
  transpiler, no framework.
- **No runtime dependencies.** Nothing the pages load comes from a
  package, and that is the part not to trade away. There is one
  devDependency, Playwright, for the browser tests in `test/browser/`; a
  clone without it still runs `npm test` in full and those tests skip
  themselves rather than fail. `serve_https.py` needs `cryptography` and
  nothing else.
- **No backend.** Points live in the browser's local storage and in the
  CSV the user downloads. Nothing is uploaded, ever, and both pages say
  so on screen.

## How we work

**problem or feature → issue → PR.** Open the issue first, with enough in
it to act on without guessing: what happens, what should happen, which
file, and how to reproduce it. Then one issue is one focused change. Put
`Closes #<n>` in the PR description so merging closes the issue and the
trail survives.

**Tests come with the logic change, not after it.** Write the failing
test first and confirm it fails for the right reason. Every angle,
distance, or pixel-to-degree calculation belongs in `geometry.js` with a
case in `test/`, never inline in a `<script>` block. This is not a style
preference: the two worst bugs this project has had were an elevation
formula that ignored device roll and a calibration fit that silently
doubled the elevation scale, and neither was visible by reading the page.

**Verify before claiming done.** Run `npm test` and confirm green output.
With Playwright installed that includes the browser tests, which are where
a change that is correct in `geometry.js` but wired up wrongly gets
caught.
"This works" is a claim about something you ran; if you did not run it,
write what you did not run instead. Nothing here can test the camera, the
compass, or a real phone, so any change to those paths ships untested by
definition and the PR has to say which ones it touched.

**A review lands on the pull request, not in a terminal.** Post the
outcome with `gh pr comment <n>`: per finding the file and line, what is
wrong, and whether it blocks the merge. Post a comment even when nothing
needs changing, so the contributor can tell a branch that was read from
one nobody has got to yet. A review that only ever existed in someone's
console did not happen. If the review was delegated to a subagent, that
applies to the subagent too: it posts, or you post what it hands back.

**Self-review the diff before pushing.** Three things that have already
gone wrong here:

- *Cause versus symptom.* Clamping a value that comes out wrong hides the
  formula that produced it. If you are knowingly treating a symptom, say
  so in the PR and link the cause.
- *Stale references after a removal.* Grep for what you deleted: element
  ids, comments naming a variable or formula that no longer exists,
  README passages describing the old behaviour.
- *Debug aids left in.* The red click marker in `overlay.html` reached
  users because it was added as "temporary". Behind a flag defaulting to
  off, or out before the PR.

## Hard rules

- **The README describes what the code does today.** Every claim has to
  survive someone checking it against the source. When a change makes a
  sentence untrue, fix the sentence in the same commit; a later cleanup
  commit does not happen.
- **Say what a change does not cover.** Skipped scope, unverified
  assumptions, cases deliberately left alone: at the bottom of the commit
  message.
- **Colours via CSS custom properties**, no new hardcoded hex or rgb in
  page styles. The existing pages predate this rule and still have
  literals throughout; a change that touches a block is a fine moment to
  lift those into variables, a repo-wide reformat is not.
- **Bump the `?v=` on the `geometry.js` import** in the same commit as any
  `geometry.js` change. The page and the module are cached separately, so
  without it a returning visitor can run an old module against a new page.
- **No speculative features, no defensive code for impossible states.**
  Sensor and file-read failures are real and must degrade visibly; an
  argument that cannot occur does not get a guard.
- **No emojis** in copy we write.
- **No docstrings, comments, or annotations added to code you did not
  otherwise change.**

## Sensor and geometry conventions

Both pages assume the W3C `DeviceOrientationEvent` frame. Getting this
wrong is the easiest way to produce a bug that looks plausible on screen:

- Device axes: `x` right across the screen, `y` up the screen, `z` out
  through the screen toward the user. The rear camera points along `-z`.
- World axes: `x` east, `y` north, `z` up.
- The event is an intrinsic Z-X'-Y'' rotation,
  `R = Rz(alpha) Rx(beta) Ry(gamma)`.
- Azimuth and elevation come from `R * (0,0,-1)`. Do not read them off
  `beta` and `alpha` directly: the survey posture is `beta ~= 90`, which
  is exactly where that decomposition is singular.
- `alpha` is north-referenced only when `event.absolute` is true. On iOS
  Safari it is not, and `event.webkitCompassHeading` carries the bearing.

Whether the device reports true or magnetic north is not stated by the
API and varies by platform. Do not write code or documentation that
assumes one of them.

## Git

- Branch from `master`: `fix/...`, `feat/...`, `chore/...`.
- **Explicit staging.** `git add <specific files>`, never `git add -A`
  or `git add .`.
- One commit per logical change, one topic per PR.
- The commit message explains why the old code was wrong, with the
  evidence: the numbers you measured, the request you made, the test that
  failed. Not just what you changed.
- Do not reformat files you are not otherwise touching.
- Never force-push a branch someone else may have pulled.
