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
done. Verified working live: camera, compass, and tilt sensors all
confirmed accurate on real hardware.

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
5. Tap **Download CSV** when done -- gives you
   `azimuth_deg,elevation_deg,timestamp,is_calibration,source` rows you
   can open in a spreadsheet or feed into other tools.

Points are also saved to the browser's local storage as you go, so an
accidental reload mid-survey doesn't lose your progress -- but the CSV
download is the actual durable copy; don't rely on browser storage
alone. The recorded-points list is collapsed by default (tap to expand)
so it can't grow up over the camera view and block your aim as points
accumulate.

**Compass heading**: `alpha`/`beta` from the `DeviceOrientationEvent` API
vary across phones/browsers -- before a real survey, point the phone at
a known direction (a real compass) and confirm the on-screen azimuth
matches; adjust the `HEADING_CORRECTION` formula in `index.html` if it's
backwards or offset. Same idea for elevation: hold the phone level and
confirm it reads ~0 degrees. Large nearby metal (a mast, guy wires) can
also distort the compass locally -- if readings look erratic specifically
near such an object, that's a likely cause, not a tool bug.

## Panorama overlay (`overlay.html`)

Upload a panorama photo of the site (any width/height -- a full 360&deg;
equirectangular "Photo Sphere" or a normal narrower-FOV cylindrical
panorama both work, and the photo doesn't need to cover exactly 360&deg;
either) and it draws your recorded horizon line on top. By default it
uses the points saved by the survey page in that browser's local storage
(same device) -- or load the CSV you downloaded, which is how to view
this on a different device (e.g. record on your phone, view on a PC).

A photo has no built-in compass/scale reference, so it needs a two-point
calibration: click two points in the photo spread apart from each other,
and enter each one's real azimuth and elevation. From those two points
the tool derives the actual pixel-to-degree scale for that specific
photo -- no assumption about its projection, width, or field of view.
If you marked calibration points while surveying (see above), a picker
appears letting you select which two those were instead of typing
numbers -- their az/el come from your recorded data.

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

Needs HTTPS -- `getUserMedia` (camera) and `DeviceOrientationEvent` sensor
access are both blocked on plain HTTP by browser security policy. Both
pages are single static files with no server-side logic, so any HTTPS
static host works.

### Running your own copy (Raspberry Pi or Windows)

`serve_https.py` is a small self-contained server included in this repo
for exactly this -- no nginx, no separate certificate tooling, works the
same way on a Pi and on Windows. It generates its own self-signed
certificate on first run and serves this folder over HTTPS.

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
