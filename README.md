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
