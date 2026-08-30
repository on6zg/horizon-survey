# Horizon Survey

A single-page, no-backend web tool for surveying the real visible horizon
around an antenna site -- for each direction you point your phone, it
records the compass azimuth and the elevation angle (tilt above horizontal)
of whatever obstruction (building, tree, terrain) you're aiming at. Built
for mapping directional elevation limits for Moon/EME tracking, where a
single flat elevation floor either wastes visible sky in open directions
or risks pointing at obstructions in blocked ones.

No app install, no backend, no build step -- open the page on your phone,
walk around, tap Record at each obstruction, download a CSV when done.

## How to use it

1. Open the page on your phone (needs HTTPS -- see Hosting below).
2. Tap **Start**, grant camera and motion-sensor permission.
3. Aim the crosshair at the top edge of an obstruction in some direction
   (use the zoom controls if it's small/distant), tap **Record point**.
4. Repeat every 10-30 degrees of azimuth as you walk/turn around the site.
5. Tap **Download CSV** when done -- gives you `azimuth_deg,elevation_deg`
   rows you can open in a spreadsheet or feed into other tools.

Points are also saved to the browser's local storage as you go, so an
accidental reload mid-survey doesn't lose your progress -- but the CSV
download is the actual durable copy; don't rely on browser storage alone.

## ⚠️ Verify the compass heading on your own device before trusting it

This has not yet been tested on real hardware. `alpha` (compass heading)
and `beta` (tilt) from the `DeviceOrientationEvent` API are notoriously
inconsistent across phones/browsers -- the heading correction formula in
`index.html` (search `HEADING_CORRECTION`) is the commonly-used convention,
not something verified against your specific phone. Before doing a real
survey: point the phone at a known direction (e.g. due north via a real
compass) and confirm the on-screen azimuth reading matches, adjusting the
formula if it's backwards or offset. Same idea for elevation -- hold the
phone level (aimed at the horizon) and confirm it reads ~0 degrees.

## Panorama overlay (`overlay.html`)

Upload a 360&deg; equirectangular panorama photo (e.g. your phone's Photo
Sphere mode) and it draws your recorded horizon line right on top. By
default it uses the points already saved by the survey page in that
browser's local storage (same device) -- but you can also load the CSV
you downloaded from the survey page directly, which is how to view this
on a different device (e.g. a PC): take the photo and record the survey
on your phone, download the CSV there, then open this page on your PC
and load both the photo and the CSV. A panorama photo has no built-in
compass reference, so there's a one-time calibration step: click any
point in the photo whose real-world bearing you know (a landmark, a
building corner), enter that bearing, and everything lines up from
there. Recalibrate any time from the button if a new photo is loaded.

**Shooting the panorama**: don't stand right against the antenna mast --
most panorama/Photo-Sphere apps need a clear, unobstructed pivot to
stitch correctly, and a large nearby object in the way will break the
capture. Stand a meter or two off to the side instead; over that short a
distance, anything more than a few meters away barely shifts in apparent
bearing, so it won't meaningfully throw off the alignment. Whatever part
of the photo the mast/antenna itself still blocks is fine to leave as-is
-- the recorded horizon-line data comes from your walk-around survey, not
from the photo, so it stays accurate there regardless of what the photo
shows in that slice.

Assumes a standard full-sphere equirectangular image (360&deg; horizontal,
180&deg; vertical) -- most phone panorama-sphere output matches this, but
hasn't been tested against a real photo yet.

## Camera zoom

Uses real hardware zoom if the browser/device exposes it (`MediaTrackCapabilities.zoom`),
falling back to CSS digital zoom otherwise. Either way, zoom is purely a
visual aid for aiming precisely -- the crosshair stays screen-centered and
the recorded elevation/azimuth come from the orientation sensors, not the
zoom level, so zooming never affects the actual recorded angle.

## Hosting

Needs HTTPS -- `getUserMedia` (camera) and `DeviceOrientationEvent` sensor
access are both blocked on plain HTTP by browser security policy. This is
a single static file with no server-side logic, so any HTTPS static host
works; it was built to deploy the same way as this station's other
`*.local` nginx vhosts (self-signed cert is fine, this isn't a
public-trust situation).

## License

No formal license file yet -- personal/amateur-radio use, forking, and PRs
are welcome.
