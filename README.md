# PioneerVFD testbuild v2.0

A Spicetify theme + extension testbuild that turns Spotify into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface.

> This package includes converted Pioneer OEL/LKD animation data for local experimentation.
<img width="1620" height="900" alt="Screenshot 2026-04-30 203400" src="https://github.com/user-attachments/assets/0e5f627e-85b9-4acf-80eb-4a386c23908d" />
<img width="1000" height="1000" alt="Screenshot 2026-04-30 184451" src="https://github.com/user-attachments/assets/387de59b-2759-4f7b-bb47-61c08dc9d259" />


## What it does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Adds a two-LCD prototype: a skinny metadata LCD for artist/title/time above a compact animation-only VFD display.
- Keeps all animations inside the compact LCD while the metadata stays readable in the skinny LCD.

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
- `Themes/PioneerVFD/color.ini` defines the color scheme.

## testbuild notes
- REAL PIONEER STEREO ANIMATIONS!
- Side LCD blocks now show live playback data instead of placeholder labels.
- Top metadata LCD has a clickable/draggable clean VFD-style progress meter for scrubbing.
- Repeat button labels/colors distinguish OFF, ALL, and ONE where Spotify exposes state.
- Volume and right-knob scrub controls use smoother pointer/wheel handling.

## Disclaimer
This project is for educational and personal use only. It is not affiliated with, 
endorsed by, or associated with Pioneer Corporation.
