<img width="2000" height="668" alt="PioneerVFD logo" src="https://github.com/user-attachments/assets/d84f1508-fee8-4ebd-b3b5-8600e1bec88e" />

> Unofficial fan-made Spicetify theme. Not affiliated with Pioneer Corporation. May break on non-English Spotify.
> If you enjoy PioneerVFD, a star helps more people find it.

<p align="center">
  <a href="https://ko-fi.com/adainstarks">
    <img src="https://img.shields.io/badge/Support-PioneerVFD-00e5ff?style=for-the-badge&logo=ko-fi&logoColor=white&labelColor=101010" alt="Support PioneerVFD on Ko-fi">
  </a>
</p>

Miss the old 2000s Pioneer head units, dolphins swimming while you bump tunes? Now your Spotify can have them.

PioneerVFD turns Spotify desktop into a 2000s Pioneer-style VFD/LCD car stereo. It replaces the stock lower player with a chrome head-unit: WebM OEL animations, RGB and mono display modes, hardware-style readouts, ATT muting, and live spectrum bars around the center badge.

**v4.0.6:** truer blue/indigo tints ([#28](https://github.com/adainstarks/PioneerVFD/issues/28)), the first audio-reactive OEL clip (`GAUGES`), the `PIONEERVFD` clip, and a leaner runtime.

Import your own clips: https://www.youtube.com/watch?v=QuRZPHMGhso

## Preview

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/7da1f0dc-0cf9-4fdf-b556-beff8cc96820" />

> Default state with PULSE = ON, LCD = DSEG14

<img width="1280" height="720" alt="image2" src="https://github.com/user-attachments/assets/ec5bfeba-57eb-4d52-8b5d-5f984c0f6055" />

> TINT = LIME, DARK = ON, PULSE = ON, SCROLL = LOOP, LCD = DSEG14

<p align="center">
<img width="800" height="450" alt="PVFDGIFloop" src="https://github.com/user-attachments/assets/e515bd3e-10eb-4e24-86eb-c2729c28aedf" />
</p>

## Features

- Chrome Pioneer head-unit panel replacing Spotify's lower player.
- WebM OEL center display with authentic Pioneer clips, streamed from GitHub Pages and cached in IndexedDB after first play.
- **`GAUGES`**: audio-reactive twin VFD needles, driven by `PULSE`. *(new)*
- **`PIONEERVFD`**: signature clip, the Night Cruising loop with an animated logo sting. *(new)*
- Metadata LCDs: artist, title, playtime, ATT, tint, dim, mode, clip, and playback.
- 15 tints: cyan, teal, lime, amber, orange, red, pink, magenta, violet, blue, green, yellow, indigo, black-on-white, white-on-black.
- `PULSE` live spectrum bars via Chromium desktop audio capture (Windows/macOS) or a Linux helper bridge.
- `ATT` instant mute/restore, `LST` queue, `BAND` archive.org radio broadcasts, fullscreen mode (click the center wordmark).
- `FULL` / `ECO` performance modes.
- Import your own `.webm` OEL clip (up to 25 MB).

## OEL clips

The center display rotates through a set of authentic Pioneer OEL clips, including the new `GAUGES` and `PIONEERVFD`, plus an `EJECTING` easter egg. All load from GitHub Pages and cache in IndexedDB after a successful play. `GAUGES` reacts to live audio, so turn on `PULSE` to drive the needles.

**Custom clip.** `CUSTOMIZE > OEL` imports a local `.webm` (25 MB max) as an extra clip. It joins the rotation, cycles in `DEMO`, and persists in IndexedDB. One slot, replace or remove anytime. Convert GIFs to WebM first; hosted URLs and multiple custom clips aren't supported.

**Color toggle.** The racing and custom clips follow the current tint by default. `CUSTOMIZE > COLOR = ON` (or clicking the OEL display) keeps them full-color while the rest of the theme stays tint-aware.

## Controls

**`MENU`**: `OEL` (cycle clip), `DEMO` (auto-cycle without changing the saved startup clip), `PERF` (FULL/ECO), `PULSE` (live audio), `VFD` (display on/off), `CUSTOMIZE`.

**`CUSTOMIZE`**: `TINT` (15-mode picker), `TYPE` (Spotify content font), `COLOR` (tint vs full-color clips), `BUTTON` (LED glow: SOFT/HARD/OFF), `OEL` (import/replace/remove custom clip), `DARK` (dark chrome).

**Faceplate**: `ATT` (instant mute, restores on next press; exits when you adjust volume), `DIM` (LCD brightness), `LST` (queue), `EEQ` (click to tint-match), lyrics button (opens Spotify lyrics, avoids Beautiful/Spicy Lyrics takeover).

Saved across restarts: `PERF`, `TINT`, `DIM`, `TYPE`, selected clip (incl. custom), `VFD`, `COLOR`, dark chrome, EEQ tint, button glow. `PULSE` always boots `OFF` so Spotify doesn't reopen audio capture on its own.

## PULSE (live audio)

- **Windows / macOS:** Chromium desktop capture. Press `PULSE`, then pick a capture source that shares audio.
- **Linux:** Chromium usually won't expose Spotify audio to the picker. Install [PVFD-Linux-Helper](https://github.com/adainstarks/PVFD-Linux-Helper), run it, then press `PULSE`; the menu row switches to `HLPR` when it's receiving helper audio.

## Performance

- `FULL`: full display treatment.
- `ECO`: lower-cost. Keeps the OEL display usable while trimming surrounding glow, side-panel updates, VU behavior, and decorative app-side styling.

## Requirements

- Spotify desktop + Spicetify CLI (installed and initialized)
- A Spotify/Chromium build that exposes extension APIs through Spicetify
- PULSE on Windows/macOS: Chromium desktop capture with audio sharing
- PULSE on Linux: optional [PVFD-Linux-Helper](https://github.com/adainstarks/PVFD-Linux-Helper) plus PipeWire/PulseAudio tools (`pactl`/`parec` or `pw-record`)

## Install

### Marketplace

Install `PioneerVFD` from the Spicetify Marketplace. It fetches the versioned CSS/JS published in this repo, pulls clips from GitHub Pages, and caches them in IndexedDB. Linux users who want `PULSE` also need the helper (below).

If the OEL screen is blank or the extension APIs aren't exposed, use a script install instead; they set the correct Spicetify config and preserve your existing extensions.

### Windows

Download and extract the latest release ZIP. Open PowerShell inside the `PioneerVFD` folder (you should see `install-windows.ps1`, `Themes`, `Extensions`):

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

### Linux

Extract the ZIP, open Terminal in the `PioneerVFD` folder (`install-linux.sh`, `Themes`, `Extensions`):

```bash
chmod +x ./install-linux.sh
./install-linux.sh
```

### macOS

Extract the ZIP, open Terminal in the `PioneerVFD` folder (`install-macos.sh`, `Themes`, `Extensions`):

```bash
chmod +x ./install-macos.sh
./install-macos.sh
```

The macOS installer enables Spicetify DevTools by default (some Mac installs need it to load APIs/extensions). Skip it with `PVFD_ENABLE_DEVTOOLS=0 ./install-macos.sh`.

### Linux PULSE helper

```bash
pipx install git+https://github.com/adainstarks/PVFD-Linux-Helper.git
pvfd-hlpr --with-spotify
```

`--with-spotify` starts the helper alongside Spotify. Or run `pvfd-hlpr` in a terminal and leave it open. Debug detection with `pvfd-hlpr --probe`.

### What the installers do

Locate the Spicetify config root, copy the theme and extension, configure `current_theme`/`color_scheme PioneerVFD` with CSS/JS injection, color replacement, asset overwrite, and `expose_apis 1`, preserve existing enabled extensions, then run `spicetify apply`.

## Remove

```bash
spicetify config extensions pioneerVFD.js-
spicetify config current_theme ""
spicetify apply
```

On Windows, run the same commands from PowerShell.

## Troubleshooting

- **PULSE silent (Windows/macOS):** toggle it off/on, then pick a capture source that includes audio.
- **PULSE silent (Linux):** run `pvfd-hlpr`, confirm the menu row reads `HLPR`; use `pvfd-hlpr --probe` to debug sink/source detection.
- **Blank OEL screen:** rerun the platform installer and open Spotify once while online.
- **macOS black screen / no JavaScript:** fully quit Spotify, then:

  ```bash
  spicetify backup
  spicetify config expose_apis 1 inject_css 1 inject_theme_js 1 replace_colors 1 overwrite_assets 1
  spicetify enable-devtools
  spicetify apply
  ```

  If `enable-devtools` is unavailable: `spicetify config always_enable_devtools 1 && spicetify apply`.
- Manual raw-copy installs aren't recommended; the theme depends on several Spicetify config flags and exposed APIs.

## Special thanks

Anyone who opens an issue or PR with a meaningful improvement.

- [@syzyxy](https://github.com/syzyxy)

## Disclaimer

Unofficial, fan-made Spicetify theme inspired by early-2000s car-stereo VFD/LCD interfaces. Not affiliated with, endorsed by, or associated with Pioneer Corporation or Spotify. Pioneer and the Pioneer logo are trademarks of Pioneer Corporation; Spotify is a trademark of Spotify AB. All trademarks belong to their respective owners. Free and open source under the MIT License. Optional donations support development and grant no licensing, support, or affiliation.

## License

MIT, see LICENSE.
