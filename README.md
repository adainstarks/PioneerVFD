# PioneerVFD v0.3.2

A Spicetify theme + extension that turns Spotify into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface.

## What it does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Adds a cyan/teal VFD/LCD display with spectrum, demo, galaxy, dolphin, and packed clip modes.
- Keeps all animations inside the LCD window so the rest of the Spotify layout stays readable.
- Removes the old ART mode path and uses packed LCD clip data instead of fragile embedded MP4 playback.
- Keeps the DOLPHIN clip full-panel and renders the RACING clip in a tighter contained viewport so it does not stretch.

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

- `Extensions/pioneerVFD.js` contains the packed LCD clip data inline, so there are no video assets to host or load separately.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD styling, typography, and Spotify layout overrides.
- `Themes/PioneerVFD/color.ini` defines the `Pioneer DEH-P7600MP` color scheme.

## Release

Current release: **v0.3.2**

Recommended initial commit message:

```bash
git commit -m "Initial release v0.3.2"
```
