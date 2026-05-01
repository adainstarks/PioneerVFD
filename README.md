# PioneerVFD testbuild v2.0-r1-oel-pixelgrid-sidebox-clearance-personal

A Spicetify theme + extension testbuild that turns Spotify into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface.

> Personal/local test branch only. This package includes converted Pioneer OEL/LKD animation data for local experimentation and should not be pushed to GitHub or publicly distributed.


## What it does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Adds a two-LCD prototype: a skinny metadata LCD for artist/title/time above a compact animation-only VFD display.
- Keeps all animations inside the compact LCD while the metadata stays readable in the skinny LCD.
- Removes the old ART mode path and uses packed LCD clip data instead of fragile embedded MP4 playback.
- Temporarily ignores the older user/video-style animation modes so the extracted OEL/LKD clips can define the whole center display.
- Raises the Pioneer logo by 2px and compresses the animation LCD with reference-style side glass/details.
- v0.4 tightens the responsive side LCDs, widens the top scrub meter, and makes the volume pointer act like a clock-style dial.
- v0.5-r2 fixes the package labeling, removes the boxed scrubber feel, restores directional right-knob hover shading, and tests the new 0-to-360 volume dial model.
- v1.9-r1-oel-glass-sidebox-hardfix-personal keeps the extracted Pioneer OEL/LKD clips as the centerpiece, but rebalances the top LCD so the song title wins when the window shrinks, shrinks/hides the scrub rail earlier, evens out the OEL glass surround, and tones down white clipping so the blue phosphor shows through.

- v2.0-r1-oel-pixelgrid-sidebox-clearance-personal restores uniform cyan dot-matrix separation across bright OEL regions and reflows the left LIVE/VFD badges so the bottom readout is no longer covered.

## Files

```text
PioneerVFD/
├─ Extensions/
│  └─ pioneerVFD.js
├─ Themes/
│  └─ PioneerVFD/
│     ├─ color.ini
│     └─ user.css
├─ install-windows.ps1
├─ PUSH_TO_GITHUB.md
└─ README.md
```

## Requirements

- Spotify desktop
- Spicetify CLI installed and initialized

## Manual install

### Windows PowerShell

Run these commands from the repo root:

```powershell
$spice = "$env:APPDATA\spicetify"
New-Item -ItemType Directory -Force -Path "$spice\Themes", "$spice\Extensions" | Out-Null
Copy-Item -Recurse -Force ".\Themes\PioneerVFD" "$spice\Themes\"
Copy-Item -Force ".\Extensions\pioneerVFD.js" "$spice\Extensions\"
spicetify config current_theme PioneerVFD color_scheme "Pioneer DEH-P7600MP"
spicetify config extensions pioneerVFD.js
spicetify apply
```

### One-command Windows install

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

## Remove

```powershell
spicetify config extensions pioneerVFD.js-
spicetify config current_theme ""
spicetify apply
```

## Development notes

- `Extensions/pioneerVFD.js` contains the packed LCD clip data inline, including the personal-only converted OEL/LKD test clips, so there are no video assets to host or load separately.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD styling, typography, and Spotify layout overrides.
- `Themes/PioneerVFD/color.ini` defines the `Pioneer DEH-P7600MP` color scheme.

## Release

Current testbuild: **v1.9-r1-oel-glass-sidebox-hardfix-personal**

Recommended initial commit message:

```bash
git commit -m "Personal testbuild v0.7 OEL centerpiece experiment"
```


## testbuild v0.2 notes
- Side LCD blocks now show live playback data instead of placeholder labels.
- Top metadata LCD has a clickable/draggable clean VFD-style progress meter for scrubbing.
- Repeat button labels/colors distinguish OFF, ALL, and ONE where Spotify exposes state.
- Volume and right-knob scrub controls use smoother pointer/wheel handling.


## testbuild v0.3 notes
- Replaced the literal ASCII scrub tracker with a clean segmented VFD progress meter.
- Scrub meter now follows the selected LCD tint correctly instead of rotating into weird off-colors.
- Tint now reaches major lighting elements: knob halos, LED arcs, nav arrows, open LED, and side LCD accents.
- Side LCD readouts use larger text for easier reading.
- Repeat button behavior from v0.2 is preserved.
