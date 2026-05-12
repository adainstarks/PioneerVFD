<img width="2000" height="668" alt="PioneerVFD logo" src="https://github.com/user-attachments/assets/d84f1508-fee8-4ebd-b3b5-8600e1bec88e" />

> Unofficial fan-made Spicetify theme. Not affiliated with Pioneer Corporation.

Miss the old 2000s Pioneer head units? Wish you could still have those dolphins swimming while you bump tunes? Maybe you never got to experience it and want to? Well, now you can.

PioneerVFD is a Spicetify theme and extension that turns Spotify desktop into a 2000s Pioneer DEH-P7600MP-style VFD/LCD stereo interface. It replaces the stock lower player area with a chrome head-unit panel, WebM OEL animations, RGB-tinted display modes, hardware-style readouts, and live audio spectrum bars around the Pioneer logo.

This current build is the WebM/live-audio refactor. The old `.LKD` frame-by-frame read path has been removed from the production renderer.

## Preview

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/794cf0e6-9662-466f-af15-651180eb1334" />

##

<img width="1280" height="720" alt="Screenshot 2026-05-11 203645" src="https://github.com/user-attachments/assets/65cab486-6eeb-4be3-ad75-586955a808f6" />

##

<img width="800" height="185" alt="PioneerVFDRacing" src="https://github.com/user-attachments/assets/09dbbf09-c911-4304-bb53-dd0ef278480e" />


## What It Does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Uses real WebM OEL clips for the center animation display instead of packed `.LKD` frame reads.
- Ships the OEL media assets in `Themes/PioneerVFD/assets`.
- Adds metadata LCDs for artist, title, playtime, source state, tint, dim, mode, and playback readouts.
- Adds mirrored live spectrum bars around the Pioneer logo.
- Uses Chromium desktop audio capture for the `PULSE` live visualizer.
- Supports app-wide RGB tint treatment for cyan, amber, and violet modes.
- Adds route-aware Spotify styling for home, search, library, album, playlist, queue, lyrics, artist, and other views.
- Includes `FULL` and `ECO` performance modes for different machines.

## OEL And Media

The center OEL/VFD display is WebM-based. The current clip set includes:

- `movie5_longloop.webm`
- `movie1_longloop.webm`
- `movie6_longloop.webm`
- `movie10_f_longloop.webm`
- `diverdolphins_longloop.webm`
- `6_Racing_Cart_longloop.webm`
- `movie5.webm`

The installer builds the installed extension by injecting a WebM source map into `pioneerVFD.js`. This is intentional. A raw copy of the extension file is not enough for the full WebM OEL display, because the source file contains a placeholder until the installer writes the asset map.

## Controls

The Pioneer `MENU` button exposes the main runtime controls:

- `SRC` cycles the Spotify source view.
- `OEL` cycles the WebM OEL clip.
- `DEMO` auto-cycles OEL clips without changing the saved startup clip.
- `TINT` cycles cyan, amber, and violet display treatment.
- `TYPE` switches the Spotify content font preset.
- `PERF` switches between `FULL` and `ECO`.
- `PULSE` toggles Chromium live audio capture for the logo spectrum.
- `RACING` switches the racing clip between one-color tint mode and full-color mode.
- `VFD` toggles the large OEL display on and off.
- `DIM` toggles LCD brightness from the faceplate control row.

`PULSE` starts from `OFF` on launch so Spotify does not reopen desktop/system audio capture by itself. Turn it on from the menu when you want live bars, then select a capture source with audio when Chromium asks.

Saved preferences include `PERF`, `TINT`, `DIM`, `TYPE`, selected `OEL` clip, `VFD`, and racing color mode.

## Performance

`FULL` keeps the rich display treatment active.

`ECO` is the lower-cost mode. It keeps the main OEL display usable while reducing surrounding visual work, side-panel updates, high-cost glow treatment, side VU behavior, and app-side decorative styling. The player still shows enough status to explain what it is doing.

The CSS is split around a simple rule: Pioneer-owned UI can be rich; high-churn Spotify-owned UI has to stay cheap. The theme uses route attributes and RGB variables so the app-wide tinting can stay consistent without leaning on broad expensive selectors.

## Requirements

- Spotify desktop
- Spicetify CLI installed and initialized
- A Spotify/Chromium build that supports extension APIs through Spicetify
- For `PULSE`: Chromium desktop capture support with audio sharing

## Install

### Marketplace Install

If the Spicetify Marketplace package is available and up to date, install `PioneerVFD` from Marketplace.

If the OEL screen is blank or clips do not play, use one of the script installs below. The script installs are the reference path for the WebM build because they inject the installed WebM source map.

### Windows Quick Install

1. Download the latest release ZIP.
2. Extract it.
3. Open PowerShell inside the extracted `PioneerVFD` folder.
4. Confirm you can see:

```text
install-windows.ps1
Themes
Extensions
```

5. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

### Linux Install

Download the latest release ZIP, extract it, then open Terminal inside the extracted `PioneerVFD` folder.

You are in the right folder if you see `install-linux.sh`, `Themes`, and `Extensions`.

```bash
chmod +x ./install-linux.sh
./install-linux.sh
```

### macOS Install

Download the latest release ZIP, extract it, then open Terminal inside the extracted `PioneerVFD` folder.

You are in the right folder if you see `install-macos.sh`, `Themes`, and `Extensions`.

```bash
chmod +x ./install-macos.sh
./install-macos.sh
```

The macOS installer enables Spicetify DevTools by default because some Mac installs do not load exposed APIs or extensions reliably until Spicetify reapplies with developer tooling enabled. To skip that step:

```bash
PVFD_ENABLE_DEVTOOLS=0 ./install-macos.sh
```

## What The Installers Do

The Windows, Linux, and macOS installers:

- Locate the Spicetify config root.
- Copy the PioneerVFD theme files.
- Copy the WebM assets.
- Build the installed extension with injected WebM data URLs.
- Verify the installed extension contains WebM data URLs.
- Verify the source-map placeholder is gone.
- Configure Spicetify with `current_theme PioneerVFD`, `color_scheme PioneerVFD`, CSS injection, theme JS injection, color replacement, asset overwrite, and `expose_apis 1`.
- Enable `pioneerVFD.js`.
- Run `spicetify apply`.

## Remove

```bash
spicetify config extensions pioneerVFD.js-
spicetify config current_theme ""
spicetify apply
```

On Windows, run the same commands from PowerShell.

## Project Files

```text
PioneerVFD/
├── Extensions/
│   └── pioneerVFD.js
├── Themes/
│   └── PioneerVFD/
│       ├── assets/
│       │   ├── 6_Racing_Cart_longloop.webm
│       │   ├── diverdolphins_longloop.webm
│       │   ├── movie10_f_longloop.webm
│       │   ├── movie1_longloop.webm
│       │   ├── movie5.webm
│       │   ├── movie5_longloop.webm
│       │   └── movie6_longloop.webm
│       ├── fonts/
│       ├── color.ini
│       └── user.css
├── install-windows.ps1
├── install-linux.sh
├── install-macos.sh
└── README.md
```

## Notes

- `Extensions/pioneerVFD.js` owns the head-unit runtime, menu behavior, WebM OEL state, Chromium live audio capture, route state, and visualizer logic.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD/OEL styling, RGB tint variables, app-wide Spotify styling, route-specific layout, and performance gates.
- `Themes/PioneerVFD/color.ini` defines the `PioneerVFD` Spicetify color scheme.
- Manual raw-copy installs are not recommended for this build because the extension must be installed with the WebM source map injected.
- The old helper/audio-analysis path is not the supported visualizer path. `PULSE` uses Chromium live capture.
- If `PULSE` has no signal, turn it off and on again, then pick a capture source that includes audio.
- If the OEL screen is blank after a manual copy, rerun the platform installer.
- If macOS opens Spotify to a black screen or the Pioneer player appears without working JavaScript, fully quit Spotify and rerun:

```bash
spicetify backup
spicetify config expose_apis 1 inject_css 1 inject_theme_js 1 replace_colors 1 overwrite_assets 1
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

## License

MIT
