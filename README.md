<img width="2000" height="668" alt="PioneerVFD logo" src="https://github.com/user-attachments/assets/d84f1508-fee8-4ebd-b3b5-8600e1bec88e" />

> Unofficial fan-made Spicetify theme. Not affiliated with Pioneer Corporation.
> ENGLISH Spotify Only! Will break on other languages!
> If you enjoy PioneerVFD, starring the repo helps more people find it.

<p align="center">
  <a href="https://ko-fi.com/adainstarks">
    <img src="https://img.shields.io/badge/Support-PioneerVFD-00e5ff?style=for-the-badge&logo=ko-fi&logoColor=white&labelColor=101010" alt="Support PioneerVFD on Ko-fi">
  </a>
</p>

Miss the old 2000s Pioneer head units? Wish you could still have those dolphins swimming while you bump tunes? Maybe you never got to experience it and want to? Well, now you can.

PioneerVFD is a Spicetify theme and extension that turns Spotify desktop into a 2000s Pioneer-style VFD/LCD stereo interface. It replaces the stock lower player area with a chrome head-unit panel, WebM OEL animations, expanded RGB and mono display modes, hardware-style readouts, ATT-style muting, and live audio spectrum bars around the center badge.

v4.0.5 - Import your own OEL .webm clips! + Bug fixes and issues addressed
How to import your own clips: https://www.youtube.com/watch?v=QuRZPHMGhso

## Preview

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/7da1f0dc-0cf9-4fdf-b556-beff8cc96820" />

> Default state with PULSE = ON, LCD = DSEG14

##

<img width="1280" height="720" alt="image2" src="https://github.com/user-attachments/assets/ec5bfeba-57eb-4d52-8b5d-5f984c0f6055" />

> TINT = LIME, DARK = ON, PULSE = ON, SCROLL = LOOP, LCD = DSEG14

##
<p align="center">
<img width="800" height="450" alt="PVFDGIFloop" src="https://github.com/user-attachments/assets/e515bd3e-10eb-4e24-86eb-c2729c28aedf" />
</p>

## What It Does

- Replaces Spotify's lower player area with a custom chrome Pioneer-style head-unit panel.
- Uses authentic Pioneer OEL clips for the center animation display.
- Streams OEL media from the published project assets and caches clips in the browser when available.
- Adds metadata LCDs for artist, title, playtime, ATT state, tint, dim, mode, clip, and playback readouts.
- Adds an `ATT` button for instant mute/restore behavior.
- Uses `LST` for the queue/list control.
- Adds mirrored live spectrum bars around the center badge logo.
- Uses Chromium desktop audio capture for the `PULSE` live visualizer on Windows/macOS, with an optional Linux helper bridge.
- Adds a two-page `PIONEER MENU` / `CUSTOMIZE MENU` layout.
- Includes 15 tint modes: cyan, teal, lime, amber, orange, red, pink, magenta, violet, blue, green, yellow, indigo, black-on-white, and white-on-black.
- Includes `FULL` and `ECO` performance modes for different machines.
- Includes period-correct BAND button to cycle through old archive.org radio broadcasts.
- Includes a full-screen display mode. Click on the center pioneer wordmark to access.

## OEL And Media

The center OEL/VFD display is WebM-based. The current clip set includes:

- `movie5_longloop.webm`
- `movie1_longloop.webm`
- `movie6_longloop.webm`
- `movie10_f_longloop.webm`
- `diverdolphins_longloop.webm`
- `6_Racing_Cart_longloop.webm`
- `EJECTING.webm`

All builds load the clips from the published GitHub Pages asset paths. PioneerVFD stores successful clip fetches in IndexedDB, so clips can continue working from cache when the browser has already seen them.

You can also bring your own clip. In the `CUSTOMIZE MENU`, the `OEL` control opens an importer for a local `.webm` file (up to 25 MB) that becomes an extra OEL clip. It joins the normal clip rotation, cycles in `DEMO`, persists across restarts, and is stored locally in IndexedDB. Animated GIFs must be converted to WebM first; hosted URLs and multiple custom clips are not supported. There is one custom slot, which you can replace or remove.

The racing clip and an imported custom clip honor a `COLOR` toggle in the `CUSTOMIZE MENU`. By default they follow the current VFD tint; switching `COLOR` to `ON` lets them keep their full-color look while the rest of the theme stays tint-aware. You can also click the OEL display to toggle it.

## Controls

The Pioneer `MENU` button opens the main runtime controls:

- `OEL` cycles the WebM OEL clip.
- `DEMO` auto-cycles OEL clips without changing the saved startup clip.
- `PERF` switches between `FULL` and `ECO`.
- `PULSE` toggles live audio capture for the logo spectrum.
- `VFD` toggles the large OEL display on and off.
- `CUSTOMIZE` opens the appearance controls.

The `CUSTOMIZE MENU` contains:

- `TINT` opens the 15-mode tint picker.
- `TYPE` switches the Spotify content font preset.
- `COLOR` switches the racing and custom OEL clips between one-color tint mode and full-color mode.
- `BUTTON` cycles transport button LED glow: `SOFT`, `HARD`, or `OFF`.
- `OEL` imports, replaces, or removes your custom WebM clip.
- `DARK` toggles dark chrome plastic.

Faceplate and transport controls include:
- `OEL`, `DEMO`, `TINT`, `MENU`, with the above-mentioned functionality.
- `ATT` mutes instantly and restores the previous volume on the next press.
- Volume wheel/drag exits `ATT` when the user starts adjusting volume.
- `DIM` toggles LCD brightness from the faceplate control row.
- `LST` opens Spotify's queue/list control.
- The `EEQ` silk label can tint-match now by clicking it.
- The lyrics button opens Spotify lyrics while avoiding Beautiful Lyrics / Spicy Lyrics takeover routes.

On Windows and macOS, `PULSE` uses Chromium desktop audio capture. Turn it on from the menu when you want live bars, then select a capture source with audio when Chromium asks.

On Linux, Chromium/Spotify often does not expose Spotify audio through the capture picker. PioneerVFD v4.0.3 includes the `HLPR` bridge for [PVFD-Linux-Helper](https://github.com/adainstarks/PVFD-Linux-Helper). Install and run the helper, then press `PULSE`; the menu row switches to `HLPR` when PioneerVFD is receiving helper audio.

`PULSE` starts from `OFF` on launch so Spotify does not reopen desktop/system audio capture or reconnect the Linux helper by itself.

Saved preferences include `PERF`, `TINT`, `DIM`, `TYPE`, selected `OEL` clip (including an imported custom clip), `VFD`, `COLOR` mode, dark chrome, EEQ tint, and transport button glow. `PULSE` intentionally boots idle even if it was previously enabled.

## Performance

`FULL` keeps the rich display treatment active.

`ECO` is the lower-cost mode. It keeps the main OEL display usable while reducing surrounding visual work, side-panel updates, high-cost glow treatment, side VU behavior, and app-side decorative styling. The player still shows enough status to explain what it is doing.

## Requirements

- Spotify desktop
- Spicetify CLI installed and initialized
- A Spotify/Chromium build that supports extension APIs through Spicetify
- For `PULSE` on Windows/macOS: Chromium desktop capture support with audio sharing
- For `PULSE` on Linux: optional [PVFD-Linux-Helper](https://github.com/adainstarks/PVFD-Linux-Helper), plus PipeWire/PulseAudio capture tools such as `pactl`/`parec` or `pw-record`

## Install

### Marketplace Install

If the Spicetify Marketplace package is available and up to date, install `PioneerVFD` from Marketplace.

Marketplace currently points at the versioned marketplace CSS/JS files published through this repository. The marketplace path fetches WebM clips from the GitHub Pages asset paths and caches them in IndexedDB after successful playback.

Linux Marketplace users who want `PULSE` should also install the Linux helper below. Marketplace installs the PioneerVFD bridge, but the helper itself runs locally on your machine.

If the OEL screen is blank, clips do not play, or Spotify/Spicetify does not expose the APIs the extension needs, use one of the script installs below. The script installs are the reference path for setting the correct Spicetify config and preserving any existing extensions already enabled.

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

### Linux PULSE Helper

After installing PioneerVFD from Marketplace or the Linux installer, install the helper separately if you want `PULSE`:

```bash
pipx install git+https://github.com/adainstarks/PVFD-Linux-Helper.git
pvfd-hlpr --with-spotify
```

`pvfd-hlpr --with-spotify` hooks your user-level Spotify launcher so the helper starts with Spotify in the background. If you prefer a manual terminal session, run `pvfd-hlpr` and leave it open while Spotify is running. Use `pvfd-hlpr --probe` when debugging sink/source detection.

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
- Copy the PioneerVFD extension.
- Configure Spicetify with `current_theme PioneerVFD`, `color_scheme PioneerVFD`, CSS injection, theme JS injection, color replacement, asset overwrite, and `expose_apis 1`.
- Preserve existing enabled Spicetify extensions where possible, then add `pioneerVFD.js`.
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
│       │   ├── movie5_longloop.webm
│       │   └── movie6_longloop.webm
│       ├── fonts/
│       ├── color.ini
│       └── user.css
├── manifest.json
├── install-windows.ps1
├── install-linux.sh
├── install-macos.sh
└── README.md
```

## Notes

- The Marketplace and script installs fetch OEL/WebM clips over the network on first use. Once a clip has loaded successfully, PioneerVFD attempts to reuse the cached IndexedDB copy.
- `Extensions/pioneerVFD.js` owns the head-unit runtime, ATT state, menu behavior, WebM OEL state, Chromium/HLPR live audio capture, route state, and visualizer logic.
- `Themes/PioneerVFD/user.css` owns the chrome body, LCD/OEL styling, tint and mono palettes, app-wide Spotify styling, route-specific layout, and performance gates.
- `Themes/PioneerVFD/color.ini` defines the `PioneerVFD` Spicetify color scheme.
- Manual raw-copy installs are not recommended because the theme depends on several Spicetify config flags and exposed APIs.
- If `PULSE` has no signal on Windows/macOS, turn it off and on again, then pick a capture source that includes audio.
- If `PULSE` has no signal on Linux, install/run `pvfd-hlpr`, then check that the `PULSE` menu row says `HLPR`. Run `pvfd-hlpr --probe` if it does not detect Spotify audio.
- If the OEL screen is blank after a manual copy, rerun the platform installer and open Spotify once while online.
- `DISP` is implemented as the Pioneer-logo fullscreen display prompt. `ATT`, `LST`, `SRC`, `EJECT`, and `BAND/FM` behavior live in the extension runtime.
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

## Special Thanks
A thank you to any user who opens an issue / creates a PR with significant enhancements.

* [@syzyxy](https://github.com/syzyxy)

## Disclaimer

PioneerVFD is an unofficial, fan-made Spicetify theme inspired by early-2000s car stereo VFD/LCD interfaces. It is not affiliated with, endorsed by, sponsored by, or associated with Pioneer Corporation or Spotify.

Pioneer and the Pioneer logo are trademarks of Pioneer Corporation. Spotify is a trademark of Spotify AB. All trademarks belong to their respective owners.

This project is free and open source under the MIT License. Optional donations support continued development and do not purchase access, licensing rights, official support, or affiliation with any trademark holder.

## License

MIT, Check LICENSE.
