# Horizon Survey

A two-page, no-backend web tool for surveying the real visible horizon
around an antenna site -- for each direction you point your phone, it
records the compass azimuth and the elevation angle (tilt above horizontal)
of whatever obstruction (building, tree, terrain) you're aiming at, and
can overlay that data on a panorama photo of the site. Built for mapping
directional elevation limits for Moon/EME tracking, where a single flat
elevation floor either wastes visible sky in open directions or risks
pointing at obstructions in blocked ones.

No app install, no backend, no build step -- open `index.html` on your
phone, walk around, tap Record at each obstruction, download a CSV when
done. The angle maths in `geometry.js` is covered by unit tests
(`npm test`); the sensor path itself still needs confirming against a
real compass on your own phone, see Compass heading below.

## Surveying (`index.html`)

1. Open the page on your phone (needs HTTPS -- see Hosting below).
2. Tap **Start**, grant camera and motion-sensor permission.
3. Aim the crosshair at the top edge of an obstruction in some direction
   (use the zoom controls if it's small/distant), tap **Record point**.
   Use **Mark calibration point** instead for a couple of landmarks
   you'll recognize in a panorama photo later (shown starred in the
   list) -- see Panorama overlay below for why.
4. Repeat every 10-30 degrees of azimuth as you walk/turn around the
   site. A short cooldown after each tap (with a "Recorded" confirmation
   on the button) stops an accidental double-tap from recording the same
   spot twice.

   Each point is the average of the readings from the last second, not
   the single reading at the moment of the tap, so aim and pause a beat
   before tapping. The HUD shows the spread of that second underneath the
   elevation; it turns amber past 3 degrees, which means the compass is
   being pulled around by something and the reading is not worth
   recording where you are standing.
5. Tap **Download CSV** when done -- gives you
   `azimuth_deg,elevation_deg,timestamp,is_calibration,source` rows you
   can open in a spreadsheet or feed into other tools.

   **Download JSON** gives the same survey as a `horizon_profile.json`,
   which is what [vk5dj-tracker](https://github.com/on6zg/vk5dj-tracker)
   reads for its sky-plot horizon overlay; drop it straight into that
   project's `vk5dj_tracker/static/` and no conversion step is needed.
   Calibration points are left out of it, since those are aimed at a
   landmark rather than at the top of an obstruction. Points you added
   from a photo are kept and keep a `source` key so they stay
   distinguishable.

Points are also saved to the browser's local storage as you go, so an
accidental reload mid-survey doesn't lose your progress -- but the CSV
download is the actual durable copy; don't rely on browser storage
alone. The recorded-points list is collapsed by default (tap to expand)
so it can't grow up over the camera view and block your aim as points
accumulate.

**Compass heading**: azimuth and elevation are both derived from the
device's full orientation matrix in `geometry.js`, so holding the phone
rolled or sideways no longer skews the reading. What the code cannot do
is invent a compass reference that the device never supplied: if the
browser reports no north-referenced heading, the HUD stays blank and the
status line says so, rather than showing a plausible-looking number with
an arbitrary offset in it.

Before a real survey, still point the phone at a known direction (a real
compass) and confirm the on-screen azimuth matches, and hold it level to
confirm elevation reads ~0 degrees. Two things this tool has no way to
correct for you:

- **Magnetic declination.** Whether the browser's heading is referenced
  to true or magnetic north is not stated in the event and differs by
  platform, so a survey may carry a constant offset the size of your
  local declination (a degree or two in western Europe, much more
  elsewhere).
- **Local distortion.** Large nearby metal (a mast, guy wires) pulls the
  magnetometer around. If readings look erratic specifically near such an
  object, that is the likely cause, not a tool bug.

## Panorama overlay (`overlay.html`)

Upload a panorama photo of the site (any width/height -- a full 360&deg;
equirectangular "Photo Sphere" or a normal narrower-FOV cylindrical
panorama both work, and the photo doesn't need to cover exactly 360&deg;
either) and it draws your recorded horizon line on top. By default it
uses the points saved by the survey page in that browser's local storage
(same device) -- or load the CSV you downloaded, which is how to view
this on a different device (e.g. record on your phone, view on a PC).

A photo has no built-in compass/scale reference, so it needs a two-point
calibration: click two points in the photo spread apart **horizontally**,
and enter each one's real azimuth and elevation. From those the tool
derives the actual degrees-per-pixel scale for that specific photo,
rather than guessing a field of view. If you marked calibration points
while surveying (see above), a picker appears letting you select which
two those were instead of typing numbers -- their az/el come from your
recorded data.

The vertical scale is taken from the horizontal one rather than fitted
separately, which is exact for an equirectangular panorama (the usual
phone "Photo Sphere") since it has the same degrees per pixel on both
axes by construction. That is why the two points only have to be spread
apart horizontally: two landmarks at the same height calibrate just as
well as two at different heights. If your photo has been scaled unevenly
so that is no longer true, tick **fit vertical scale separately** before
calibrating, and pick points well apart vertically too.

After calibrating, the status line reports **how much of the horizon the
photo covers** according to that calibration. That number is the sanity
check worth looking at every time: the fit is exact at the two points you
clicked no matter how wrong the scale between them is, so a bad
calibration looks right where you looked and is wrong everywhere else.
You can see with your own eyes roughly how far round a photo turns, so if
a photo that plainly covers most of the horizon reports 72&deg;, the
calibration is wrong and the next paragraph is why.

**A pitfall with two widely-spread calibration points.** Two azimuths on
their own don't say which way around the circle they're apart -- 109&deg;
to 359&deg; could be a 110&deg; gap or a 250&deg; one. The tool always
picks the shorter one, which is the right guess when your two points are
naturally close together, and the wrong one if you deliberately spread
them far apart on a photo that itself covers most of a full circle: the
fit then comes out with a scale that looks fine near your two points and
drifts further wrong the closer you get to the photo's edges. If your
photo has visible overlap (the same feature appears near both the left
and right edges), use one of the two options below instead of a normal
two-point calibration.

**Photo covers exactly 360&deg;.** Tick this and calibration needs only
**one** point -- the scale is fixed at 360&deg; / photo width instead of
derived from two azimuths, so there's no wraparound direction to get
wrong. Only accurate for a genuine closed-loop capture (a proper "Photo
Sphere," or a photo trimmed with the tool below), and needs one more
thing you have to tell it: whether azimuth increases or decreases moving
left to right across the photo (**azimuth decreases left&rarr;right**,
unticked by default, covers a sweep panned the other way).

**Trim overlap&hellip;** For an ordinary sweep-panorama app (no Photo
Sphere mode) that leaves visible overlap at the seam: click the same
landmark twice -- once where it first appears, once where it appears
again -- and the photo is cropped to exactly the span between those two
clicks, discarding the repeated portion. What's left covers exactly one
sweep with nothing duplicated, ready for the exactly-360&deg; calibration
above. **Download trimmed photo** saves the cropped result so you don't
have to re-trim every time you reopen it. Trimming clears the current
calibration (the pixel positions all changed) but keeps your recorded
points, since those are already in real-world azimuth/elevation and
don't depend on the photo at all.

Like the survey page, this page has to be **served** rather than opened
from disk: both import `geometry.js` as a module, and browsers block
module imports over `file://`. Unlike the survey page it does not need
HTTPS, since it touches no camera or sensor; any local HTTP server will
do if that is all you have.

What this does assume is that both axes are linear in angle, which is
what equirectangular means. A cylindrical panorama is linear in azimuth
but not in elevation, and a rectilinear (ordinary wide-angle) photo is
linear in neither, so the further off the horizon you read such a photo
the more the overlay drifts.

Once calibrated:
- **Click any marker** to see its exact azimuth/elevation in a popup
  (and a **Delete selected point** button appears) -- useful for
  checking whether a spike in the line is a real obstruction (e.g. a
  narrow nearby object like the mast, which legitimately produces a
  big elevation swing over a tiny azimuth range) or a bad reading worth
  removing.
- **"Add point from photo"** mode: click anywhere on the photo to add a
  new point computed directly from the calibration, no phone sensor
  needed -- useful for obstruction points you can see clearly in the
  photo but didn't separately walk out and measure. These are tagged
  `source=photo` (shown as blue markers, vs. green for sensor-measured
  ones) so the two stay distinguishable, including in the CSV.
- Calibration points (the landmarks used to align the photo) show as
  **amber** markers and stay clickable/deletable, but are left out of
  the green horizon line itself -- a calibration point marks something
  recognisable in the photo, not necessarily the top of an obstruction,
  so including it in the line would put a kink somewhere nothing is
  actually blocking.
- **Download CSV** / **Download image** export the current point set,
  or the photo with the calibrated overlay baked in as a PNG.

The connecting line extends (dashed, marking it as an approximation) from
your first/last real point out to the photo's edges, since there's
otherwise no data right at the edge azimuth.

**Shooting the panorama**: don't stand right against the antenna mast --
most panorama apps need a clear, unobstructed pivot to stitch correctly,
and a large nearby object in the way will break the capture. Stand a
meter or two off to the side instead; over that short a distance,
anything more than a few meters away barely shifts in apparent bearing,
so it won't meaningfully throw off the alignment. Whatever part of the
photo the mast/antenna itself still blocks is fine to leave as-is -- the
recorded horizon-line data comes from your walk-around survey, not the
photo, so it stays accurate there regardless of what the photo shows in
that slice.

## Camera zoom

Uses real hardware zoom if the browser/device exposes it (`MediaTrackCapabilities.zoom`),
falling back to CSS digital zoom otherwise. Either way, zoom is purely a
visual aid for aiming precisely -- the crosshair stays screen-centered and
the recorded elevation/azimuth come from the orientation sensors, not the
zoom level, so zooming never affects the actual recorded angle.

## Hosting

The survey page needs HTTPS: `getUserMedia` (camera) and
`DeviceOrientationEvent` sensor access are both blocked on plain HTTP by
browser security policy. The overlay page only needs to be served at all,
over http or https, because both pages import `geometry.js` as a module
and browsers block module imports over `file://`.

There is still nothing to build and no server-side logic: `index.html`,
`overlay.html` and `geometry.js` are the whole deployment, so any static
host works.

### Running your own copy (Raspberry Pi or Windows)

`serve_https.py` is a small self-contained server included in this repo
for exactly this -- no nginx, no separate certificate tooling, works the
same way on a Pi and on Windows. It generates its own self-signed
certificate on first run and serves this folder over HTTPS.

Two things worth knowing before you run it. It serves **every** file in
the folder to anyone on your network, so don't drop anything private in
there. And its certificate and private key go to `~/.horizon-survey/`,
not into the folder being served; the certificate is reissued
automatically when your LAN address changes, since a certificate that
doesn't name the address you typed is rejected by every current
browser.

**Upgrading from an earlier version**: that version wrote its key into
this folder, which is the folder it publishes, so anyone on your network
could download it. Delete `horizon_survey_cert.pem` and
`horizon_survey_key.pem` from here if they are still lying around; a
fresh pair is generated in `~/.horizon-survey/` on the next run. Nothing
deletes them for you, and an abandoned key sitting in a served directory
stays downloadable for as long as you keep running a server there.

**Raspberry Pi (or any Linux box):**
```bash
git clone https://github.com/on6zg/horizon-survey.git
cd horizon-survey
python3 -m venv .venv
.venv/bin/pip install -r requirements-serve.txt
.venv/bin/python serve_https.py
```

**Windows:**
1. Install [Python 3](https://www.python.org/downloads/windows/) (check
   "Add python.exe to PATH" during setup).
2. Download this repo (Code -> Download ZIP on GitHub, or `git clone` if
   you have Git installed) and extract it.
3. Open PowerShell in that folder, then:
   ```powershell
   py -m venv .venv
   .venv\Scripts\pip install -r requirements-serve.txt
   .venv\Scripts\python serve_https.py
   ```
4. Windows will likely prompt to allow the app through the firewall the
   first time -- allow it for **private networks**, or phones on the
   same Wi-Fi won't be able to reach it.

Either way, the script prints a URL like `https://<your-IP>:8443/index.html`
-- open that from a phone on the same Wi-Fi/LAN. The browser will warn
the certificate isn't trusted; that's expected for a self-signed cert
and fine to accept/proceed through -- this isn't a public-trust
situation, just your own phone talking to your own laptop/Pi on your
own network. `Ctrl+C` stops the server -- no persistent install needed
for a one-off site survey.

## Contributing

Bug reports and pull requests are welcome. `CONTRIBUTING.md` covers how
to send one and how the review works; `AGENTS.md` has the rules for
changing the code itself.

## License

MIT, see `LICENSE`.
