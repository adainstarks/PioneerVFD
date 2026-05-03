# <img width="2000" height="668" alt="b3df3279-12e4-486c-bf3d-d48a01d7d1d0-Photoroom (1)" src="https://github.com/user-attachments/assets/d84f1508-fee8-4ebd-b3b5-8600e1bec88e" />
> Unofficial fan-made Spicetify theme. Not affiliated with Pioneer Corporation.

Miss the old 2000s Pioneer head units? Wish you could still have those dolphins swimming while you bump tunes? Maybe you never got to experience it and want to? Well, now you can!

This is a Spicetify theme and extension that turns Spotify desktop into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface.

## Preview

<img width="1600" height="800" alt="Screenshot 2026-05-03 010912" src="https://github.com/user-attachments/assets/abc092f2-59ab-4b71-bcbd-7d3099be92f5" />

##

<img width="1600" height="800" alt="Screenshot 2026-05-03 010732" src="https://github.com/user-attachments/assets/7d4b5fa7-dd82-494b-a4be-ffb7cf1874f8" />


## What It Does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Adds a skinny metadata LCD for artist, title, and playtime above a compact OEL/VFD animation display.
- Uses packed Pioneer-style OEL/LKD frame data inline, with cached canvas playback for smoother animation.
- Adds live side LCD readouts, transport controls, tint modes, and a period-correct cyan, amber, and violet display treatment.
- Keeps the layout clean when the Spotify window is narrowed.

## Controls And Performance

The Pioneer `MENU` button exposes the core runtime controls:

- `SRC` cycles home, now playing, search, and library.
- `OEL` cycles the center LCD/OEL animation.
- `DEMO` cycles OEL animations automatically without changing the saved startup animation.
- `TINT` switches the display treatment between cyan, amber, and violet.
- `TYPE` switches the Spotify content font preset.
- `PERF` switches between `FULL` and `ECO`, which are your performance settings.
- `PULSE` toggles the beat-synced Pioneer logo glow.

`ECO` is a low-end-system mode that prioritizes smooth center LCD/OEL animation over visual elements. It caps OEL canvas cost, reduces display pixel density on high-DPI screens, releases inactive clip frame memory, throttles nonessential side-panel updates, disables the side VU meter, and strips decorative LCD/glow treatment from the side panels. Steady state readouts such as volume, repeat, shuffle, tint, and an `ECO` indicator remain visible so the player still explains what it is doing.

The extension saves the preferences users are likely to expect across Spotify launches: `PERF`, `PULSE`, `TINT`, `DIM`, `TYPE`, and the selected `OEL` animation.

## Requirements

- Spotify desktop
- Spicetify CLI installed and initialized

## Install

### Windows quick install

1. Download the latest release ZIP.
2. Extract it.
3. Open PowerShell inside the extracted `PioneerVFD` folder.
4. Run:

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

The macOS installer enables Spicetify DevTools by default because some Mac installs do not load exposed APIs or extensions reliably until Spicetify reapplies with developer tooling enabled. To skip that step:

```bash
PVFD_ENABLE_DEVTOOLS=0 ./install-macos.sh
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
├── Extensions/
│   └── pioneerVFD.js
├── Themes/
│   └── PioneerVFD/
│       ├── fonts/
│       ├── color.ini
│       └── user.css
├── install-windows.ps1
├── install-linux.sh
├── install-macos.sh
└── README.md
```

## Notes

- `Extensions/pioneerVFD.js` contains the packed LCD clip data inline, so there are no video assets to host.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD styling, typography, and Spotify layout overrides.
- `Themes/PioneerVFD/color.ini` defines the `Pioneer DEH-P7600MP` color scheme.
- The center OEL animation path caches rendered frames for smoother playback. This may mean that when you first open Spotify, the animations could lag until the frames are cached.
- The Linux and macOS installers resolve the Spicetify config directory with `spicetify -c`, then copy the same theme and extension files used on Windows. Also, it is not completely necessary to `chmod +x` but may help if you experience file permission issues.
- If macOS opens Spotify to a black screen or the Pioneer player appears without working JavaScript, fully quit Spotify and rerun:

```bash
spicetify backup
spicetify config expose_apis 1 inject_css 1 replace_colors 1 overwrite_assets 1
spicetify enable-devtools
spicetify apply
```

If `spicetify enable-devtools` is unavailable, use:

```bash
spicetify config always_enable_devtools 1
spicetify apply
```

## Disclaimer

This project is for educational and personal use only. It is not affiliated with, endorsed by, or associated with Pioneer Corporation.
