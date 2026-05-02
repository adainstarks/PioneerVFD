# PioneerVFD

Miss the old 2000s Pioneer head units? Wish you could still have those dolphins swimming while you bump tunes? Maybe you never got to experience it and want to? Well, now you can!

A Spicetify theme and extension that turns Spotify desktop into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface.

## Preview

Fullscreen:

<img width="1800" height="900" alt="PioneerVFD fullscreen preview" src="https://github.com/user-attachments/assets/0e5f627e-85b9-4acf-80eb-4a386c23908d" />

Shrunken window:

<img width="900" height="900" alt="PioneerVFD shrunken window preview" src="https://github.com/user-attachments/assets/387de59b-2759-4f7b-bb47-61c08dc9d259" />

## What It Does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Adds a skinny metadata LCD for artist, title, and playtime above a compact OEL/VFD animation display.
- Uses packed Pioneer-style OEL/LKD frame data inline, with cached canvas playback for smoother animation.
- Adds live side LCD readouts, transport controls, tint modes, and a period-correct cyan, amber, and violet display treatment.
- Keeps the layout clean when the Spotify window is narrowed.

## Requirements

- Spotify desktop
- Spicetify CLI installed and initialized

## Install

### One-command Windows install

Run this from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

### Linux install

```bash
chmod +x ./install-linux.sh
./install-linux.sh
```

### macOS install

```bash
chmod +x ./install-macos.sh
./install-macos.sh
```

### Manual Windows install

```powershell
$spice = "$env:APPDATA\spicetify"
New-Item -ItemType Directory -Force -Path "$spice\Themes", "$spice\Extensions" | Out-Null
Copy-Item -Recurse -Force ".\Themes\PioneerVFD" "$spice\Themes\"
Copy-Item -Force ".\Extensions\pioneerVFD.js" "$spice\Extensions\"
spicetify config current_theme PioneerVFD color_scheme "Pioneer DEH-P7600MP"
spicetify config extensions pioneerVFD.js
spicetify apply
```

## Remove

```powershell
spicetify config extensions pioneerVFD.js-
spicetify config current_theme ""
spicetify apply
```

## Project Files

```text
PioneerVFD/
|-- Extensions/
|   `-- pioneerVFD.js
|-- Themes/
|   `-- PioneerVFD/
|       |-- color.ini
|       `-- user.css
|-- install-windows.ps1
|-- install-linux.sh
|-- install-macos.sh
`-- README.md
```

## Notes

- `Extensions/pioneerVFD.js` contains the packed LCD clip data inline, so there are no video assets to host.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD styling, typography, and Spotify layout overrides.
- `Themes/PioneerVFD/color.ini` defines the `Pioneer DEH-P7600MP` color scheme.
- The center OEL animation path caches rendered frames and draws a lightweight glass glow overlay for smoother playback.
- The Linux and macOS installers resolve the Spicetify config directory with `spicetify -c`, then copy the same theme and extension files used on Windows.

## Disclaimer

This project is for educational and personal use only. It is not affiliated with, endorsed by, or associated with Pioneer Corporation.
