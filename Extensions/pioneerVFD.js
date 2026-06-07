// =====================================================================
// Pioneer VFD - DEH-P7600MP Spicetify extension
//   All animations strictly INSIDE the LCD window.
//   OEL/LKD clips are the main center display system.
// =====================================================================


(function PioneerVFD() {
  const bootStartedAt = window.__PVFD_BOOT_STARTED_AT || Date.now();
  window.__PVFD_BOOT_STARTED_AT = bootStartedAt;
  const playerReady = !!(
    window.Spicetify
    && Spicetify.Player
    && typeof Spicetify.Player.isPlaying === "function"
  );

  if (!playerReady) {
    if (!window.__PVFD_BOOT_WARNED__ && Date.now() - bootStartedAt > 10000) {
      window.__PVFD_BOOT_WARNED__ = true;
      console.warn("[PVFD] Waiting for Spicetify Player API. If this never loads, run `spicetify config expose_apis 1`, then `spicetify apply`.");
    }
    setTimeout(PioneerVFD, 300);
    return;
  }
  if (window.__PVFD_EXTENSION_RUNNING__) return;
  window.__PVFD_EXTENSION_RUNNING__ = true;

  const NUM_BARS = 48;
  const SMOOTHING = 0.72;
  const FRAME_INTERVAL_MS = 33;
  const PVFD_PROF_STORAGE_KEY = "pvfd-prof";
  const MEDIUM_LANE_INTERVAL_MS = 120;
  const SLOW_LANE_INTERVAL_MS = 320;
  const ROUTE_STATE_SAMPLE_MS = 240;
  const ROUTE_CHURN_SUPPRESS_MS = 700;
  const ROUTE_CHURN_SEARCH_DELAY_MS = 220;
  const VISUALIZER_EPSILON = 0.004;
  const SCRUB_MS_PER_TICK = 5000;

  // Lightweight perf diagnostic. Counters only — bumped at hot init/loop sites
  // and dumped by PioneerVFD.diagnosePerf(). Investigates progressive lag in
  // knob/scrubber drag + EJECT standby text that does NOT clear on window
  // close (Spotify backgrounds to tray on Windows, JS context survives) but
  // DOES clear on reinstall (spicetify apply restarts the renderer).
  const pvfdDiag = {
    bootAt: Date.now(),
    injectChassisCalls: 0,
    wireControlsCalls: 0,
    attachUnsafeCalls: 0,
    recoverFatals: 0,
    mutationObserversCreated: 0,
    loopFrames: 0,
    mutationQueues: 0,
    mutationFlushes: 0,
    listenersAdded: { lknob: 0, trackbar: 0, navring: 0 },
    pointerBubbleBlocks: 0,
  };

  // Default RGB values for the 4 main LCD color roles, used if CSS variable parsing fails.
  let lcdBackgroundCache = null;
  const clipColorCache = new Map();

  const PVFD_DEFAULT_COLORS = {
    lcdVoid: "#02060c",
    lcdDeep: "#06121e",
    lcdRim: "#1a2c3c",

    cyan: "#89e0f8",
    cyanMid: "#7ed4f0",
    cyanDeep: "#4eb4d8",
    cyanGlow: "#6ed4f8",

    textBright: "#effcff",
    chromeText: "#1a2030",
    green: "#b8e896",

    light: [137, 224, 248],
    mid: [126, 212, 240],
    deep: [78, 180, 216],
    accentDim: [26, 58, 92],
    lcdVoidRgb: [2, 6, 12],
    lcdDeepRgb: [6, 18, 30],
    lcdRimRgb: [26, 44, 60],
    textBrightRgb: [239, 252, 255],
    greenRgb: [184, 232, 150]
  };

  const pvfdCssPalette = {
    lcdVoid: PVFD_DEFAULT_COLORS.lcdVoid,
    lcdDeep: PVFD_DEFAULT_COLORS.lcdDeep,
    lcdRim: PVFD_DEFAULT_COLORS.lcdRim,

    cyan: PVFD_DEFAULT_COLORS.cyan,
    cyanMid: PVFD_DEFAULT_COLORS.cyanMid,
    cyanDeep: PVFD_DEFAULT_COLORS.cyanDeep,
    cyanGlow: PVFD_DEFAULT_COLORS.cyanGlow,

    textBright: PVFD_DEFAULT_COLORS.textBright,
    chromeText: PVFD_DEFAULT_COLORS.chromeText,
    green: PVFD_DEFAULT_COLORS.green,

    light: PVFD_DEFAULT_COLORS.light.slice(),
    mid: PVFD_DEFAULT_COLORS.mid.slice(),
    deep: PVFD_DEFAULT_COLORS.deep.slice(),
    accentDim: PVFD_DEFAULT_COLORS.accentDim.slice(),
    lcdVoidRgb: PVFD_DEFAULT_COLORS.lcdVoidRgb.slice(),
    lcdDeepRgb: PVFD_DEFAULT_COLORS.lcdDeepRgb.slice(),
    lcdRimRgb: PVFD_DEFAULT_COLORS.lcdRimRgb.slice(),
    textBrightRgb: PVFD_DEFAULT_COLORS.textBrightRgb.slice(),
    greenRgb: PVFD_DEFAULT_COLORS.greenRgb.slice()
  };

  let pvfdPaletteVersion = 0;

  function pvfdSameRgb(a, b) {
    return (
      a &&
      b &&
      a[0] === b[0] &&
      a[1] === b[1] &&
      a[2] === b[2]
    );
  }

  function pvfdNormalizeHexColor(value, fallback) {
    const raw = String(value || "").trim();

    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();

    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
    }

    return fallback;
  }

  function readCssColorVar(name, fallback) {
    const rootValue = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();

    const chassisValue = chassis
      ? getComputedStyle(chassis).getPropertyValue(name).trim()
      : "";

    return pvfdNormalizeHexColor(rootValue || chassisValue, fallback);
  }

  function readCssRgbVar(name, fallback) {
    const rootValue = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();

    const chassisValue = chassis
      ? getComputedStyle(chassis).getPropertyValue(name).trim()
      : "";

    const raw = rootValue || chassisValue;

    if (!raw) return fallback.slice();

    const parts = raw
      .split(",")
      .map((part) => Number(part.trim()));

    if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) {
      return fallback.slice();
    }

    return [
      Math.max(0, Math.min(255, Math.round(parts[0]))),
      Math.max(0, Math.min(255, Math.round(parts[1]))),
      Math.max(0, Math.min(255, Math.round(parts[2])))
    ];
  }

  function pvfdMixRgb(a, b, t) {
    const x = Math.max(0, Math.min(1, t));

    return [
      Math.round(a[0] + (b[0] - a[0]) * x),
      Math.round(a[1] + (b[1] - a[1]) * x),
      Math.round(a[2] + (b[2] - a[2]) * x)
    ];
  }

  function pvfdHexToRgb(hex, fallback) {
    const clean = pvfdNormalizeHexColor(hex, "");

    if (!clean) return fallback.slice();

    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16)
    ];
  }

  function pvfdRgb(rgb) {
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  function pvfdRgba(rgb, alpha) {
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  function refreshPvfdCssPalette() {
    const nextPalette = {
      lcdVoid: readCssColorVar("--pvfd-lcd-void", PVFD_DEFAULT_COLORS.lcdVoid),
      lcdDeep: readCssColorVar("--pvfd-lcd-deep", PVFD_DEFAULT_COLORS.lcdDeep),
      lcdRim: readCssColorVar("--pvfd-lcd-rim", PVFD_DEFAULT_COLORS.lcdRim),

      cyan: readCssColorVar("--pvfd-cyan", PVFD_DEFAULT_COLORS.cyan),
      cyanMid: readCssColorVar("--pvfd-cyan-mid", PVFD_DEFAULT_COLORS.cyanMid),
      cyanDeep: readCssColorVar("--pvfd-cyan-deep", PVFD_DEFAULT_COLORS.cyanDeep),
      cyanGlow: readCssColorVar("--pvfd-cyan-glow", PVFD_DEFAULT_COLORS.cyanGlow),

      textBright: readCssColorVar("--pvfd-text-bright", PVFD_DEFAULT_COLORS.textBright),
      chromeText: readCssColorVar("--pvfd-chrome-text", PVFD_DEFAULT_COLORS.chromeText),
      green: readCssColorVar("--pvfd-green", PVFD_DEFAULT_COLORS.green),

      light: readCssRgbVar("--pvfd-light-rgb", PVFD_DEFAULT_COLORS.light),
      mid: readCssRgbVar("--pvfd-light-mid-rgb", PVFD_DEFAULT_COLORS.mid),
      deep: readCssRgbVar("--pvfd-light-deep-rgb", PVFD_DEFAULT_COLORS.deep),
      accentDim: readCssRgbVar("--pvfd-accent-dim-rgb", PVFD_DEFAULT_COLORS.accentDim),
      lcdVoidRgb: readCssRgbVar("--pvfd-lcd-void-rgb", PVFD_DEFAULT_COLORS.lcdVoidRgb),
      lcdDeepRgb: readCssRgbVar("--pvfd-lcd-deep-rgb", PVFD_DEFAULT_COLORS.lcdDeepRgb),
      lcdRimRgb: readCssRgbVar("--pvfd-lcd-rim-rgb", PVFD_DEFAULT_COLORS.lcdRimRgb),
      textBrightRgb: readCssRgbVar("--pvfd-text-bright-rgb", PVFD_DEFAULT_COLORS.textBrightRgb),
      greenRgb: readCssRgbVar("--pvfd-green-rgb", PVFD_DEFAULT_COLORS.greenRgb)
    };

    const changed = (
      pvfdCssPalette.lcdVoid !== nextPalette.lcdVoid ||
      pvfdCssPalette.lcdDeep !== nextPalette.lcdDeep ||
      pvfdCssPalette.lcdRim !== nextPalette.lcdRim ||
      pvfdCssPalette.cyan !== nextPalette.cyan ||
      pvfdCssPalette.cyanMid !== nextPalette.cyanMid ||
      pvfdCssPalette.cyanDeep !== nextPalette.cyanDeep ||
      pvfdCssPalette.cyanGlow !== nextPalette.cyanGlow ||
      pvfdCssPalette.textBright !== nextPalette.textBright ||
      pvfdCssPalette.chromeText !== nextPalette.chromeText ||
      pvfdCssPalette.green !== nextPalette.green ||
      !pvfdSameRgb(pvfdCssPalette.light, nextPalette.light) ||
      !pvfdSameRgb(pvfdCssPalette.mid, nextPalette.mid) ||
      !pvfdSameRgb(pvfdCssPalette.deep, nextPalette.deep) ||
      !pvfdSameRgb(pvfdCssPalette.accentDim, nextPalette.accentDim) ||
      !pvfdSameRgb(pvfdCssPalette.lcdVoidRgb, nextPalette.lcdVoidRgb) ||
      !pvfdSameRgb(pvfdCssPalette.lcdDeepRgb, nextPalette.lcdDeepRgb) ||
      !pvfdSameRgb(pvfdCssPalette.lcdRimRgb, nextPalette.lcdRimRgb) ||
      !pvfdSameRgb(pvfdCssPalette.textBrightRgb, nextPalette.textBrightRgb) ||
      !pvfdSameRgb(pvfdCssPalette.greenRgb, nextPalette.greenRgb)
    );

    if (!changed) return false;

    pvfdCssPalette.lcdVoid = nextPalette.lcdVoid;
    pvfdCssPalette.lcdDeep = nextPalette.lcdDeep;
    pvfdCssPalette.lcdRim = nextPalette.lcdRim;
    pvfdCssPalette.cyan = nextPalette.cyan;
    pvfdCssPalette.cyanMid = nextPalette.cyanMid;
    pvfdCssPalette.cyanDeep = nextPalette.cyanDeep;
    pvfdCssPalette.cyanGlow = nextPalette.cyanGlow;
    pvfdCssPalette.textBright = nextPalette.textBright;
    pvfdCssPalette.chromeText = nextPalette.chromeText;
    pvfdCssPalette.green = nextPalette.green;

    pvfdCssPalette.light = nextPalette.light;
    pvfdCssPalette.mid = nextPalette.mid;
    pvfdCssPalette.deep = nextPalette.deep;
    pvfdCssPalette.accentDim = nextPalette.accentDim;
    pvfdCssPalette.lcdVoidRgb = nextPalette.lcdVoidRgb;
    pvfdCssPalette.lcdDeepRgb = nextPalette.lcdDeepRgb;
    pvfdCssPalette.lcdRimRgb = nextPalette.lcdRimRgb;
    pvfdCssPalette.textBrightRgb = nextPalette.textBrightRgb;
    pvfdCssPalette.greenRgb = nextPalette.greenRgb;

    pvfdPaletteVersion++;

    lcdBackgroundCache = null;
    lastCanvasFrameKey = "";

    return true;
  }

  // TINT cycle: full-color OEL/video keeps the old LCD hue-rotate path.
  // One-color WebM tint uses the CSS RGB tint wash directly so it is not
  // hue-rotated a second time.
  const TINT_LABELS = ["CYAN", "TEAL", "LIME", "AMBER", "ORANGE", "RED", "PINK", "MAGENTA", "VIOLET", "BLUE", "GREEN", "YELLOW", "INDIGO", "B ON W", "W ON B"];
  const TINT_LABELS_SHORT = ["CYAN", "TEAL", "LIME", "AMBER", "ORNGE", "RED", "PINK", "MGNTA", "VIOLET", "BLUE", "GREEN", "YELLW", "INDGO", "B ONW", "W ONB"];
  const TINT_HUE_DEG = [0, 335, 270, 225, 195, 170, 145, 115, 100, 25, 300, 250, 65, 0, 0];
  // Mono modes apply grayscale + an inverted chrome palette; the chassis attribute
  // data-pvfd-mono="bow"|"wob" drives the CSS. Color modes leave it unset.
  const TINT_MONO_MODE = ["", "", "", "", "", "", "", "", "", "", "", "", "", "bow", "wob"];
  function mapTintNameForCss(idx) {
    const mono = TINT_MONO_MODE[idx];
    if (mono) return mono;
    return TINT_LABELS[idx].toLowerCase();
  }
  const TINT_STORAGE_KEY = "pvfd-tint-mode";
  const DIM_STORAGE_KEY = "pvfd-dim-mode";
  const FONT_STORAGE_KEY = "pvfd-font-preset";
  const PERF_STORAGE_KEY = "pvfd-performance-mode";
  const LOGO_GLOW_STORAGE_KEY = "pvfd-logo-bpm-glow";
  const CLIP_STORAGE_KEY = "pvfd-oel-clip";
  const OEL_DISPLAY_STORAGE_KEY = "pvfd-oel-display";
  const RACING_COLOR_STORAGE_KEY = "pvfd-racing-color-mode";
  const LEGACY_RACING_COLOR_STORAGE_KEY = "pvfd-racing-color-breakout";
  const CHROME_STORAGE_KEY = "pvfd-chrome-mode";
  const LOGO_STYLE_STORAGE_KEY = "pvfd-logo-style";
  const LOGO_STYLES = ["MODERN", "CLASSIC"];
  const EVER_SCROLL_STORAGE_KEY = "pvfd-ever-scroll";
  const EVER_SCROLL_MODES = ["OFF", "ONCE", "LOOP", "BOUNCE"];
  const EVER_SCROLL_LOOP_SEPARATOR = "   •   ";
  const EEQ_TINT_STORAGE_KEY = "pvfd-eeq-tint";
  const LED_GLOW_STORAGE_KEY = "pvfd-led-glow";
  const KNOB_GLOW_STORAGE_KEY = "pvfd-knob-glow";
  const ATT_MODE_STORAGE_KEY = "pvfd-att-mode";
  // ATT modes: "mute" drops volume to 0; "soft" multiplies current volume by 0.1.
  const ATT_SOFT_MULTIPLIER = 0.1;
  const BAND_STORAGE_KEY = "pvfd-band-idx";
  const BAND_PRESETS = ["88.1", "89.9", "92.3", "94.7", "98.5", "102.5", "105.7", "107.9"];
  const BAND_TUNING_MS = 600;
  // Glyph pool for the tuning-static flicker. Mix of digits, separators, and
  // visual-noise punctuation that reads as "scrambled FM" on the skinny LCD.
  const BAND_NOISE_GLYPHS = "0123456789.-_=#*~|/\\";
  // Audio sources per BAND preset. Two flavors:
  //
  //   episodes: [...] — static curated list (small collections, hand-picked).
  //                     Each entry's cutInRange [start,end] in seconds
  //                     constrains the random mid-broadcast seek; null = first
  //                     half of duration. Useful for splitting one long file
  //                     into multiple logical "episodes" via different windows.
  //
  //   archiveCollection: "<id>" — fetch the collection's file manifest from
  //                     archive.org at first tune-in, cache it in memory, and
  //                     pick a random file matching fileExtensions. Best for
  //                     large collections (the Howard Stern 2006 archive has
  //                     179 episodes — hardcoding is absurd).
  const ARCHIVE_DL_BASE = "https://archive.org/download/";
  const ARCHIVE_META_BASE = "https://archive.org/metadata/";
  const BLOCKED_ARCHIVE_FILES = {
    "howard-stern-24k-complete-2006": new Set([
      "Howard_Stern_24k_09-13-06_cf.mp3"
    ])
  };
  const BAND_AUDIO_PRESETS = {
    // 88.1 — WLCE Big Ron classic hits (1h14m). Skip 2min cold-open intro.
    0: {
      episodes: [
        { label: "WLCE Big Ron 2001-04-18", path: "wlce-big-ron-04-18-2001-unscoped-hour/WLCE_Big_Ron_04-18-2001_unscoped_hour%2B.mp3", cutInRange: [120, 1800] }
      ]
    },
    // 89.9 — Ice Cream Pirate Show 1: Heavy Metal Thunder (60min).
    1: {
      episodes: [
        { label: "Heavy Metal Thunder", path: "radio-ice-cream-pirate-shortwave/01_Radio_Ice_Cream_Show_1_Heavy_Metal_Thunder.mp3", cutInRange: [300, 1800] }
      ]
    },
    // 92.3 — Democracy Now! (gain boost for quiet masters).
    2: {
      gain: 1.3,
      episodes: [
        { label: "DN! 2004-08-16", path: "dn2004-0816/dn2004-0816-1.mp3", cutInRange: null },
        { label: "DN! 2005-08-30", path: "dn2005-0830/dn2005-0830-1.mp3", cutInRange: null },
        { label: "DN! 2003-08-21", path: "dn2003-0821/dn2003-0821-1.mp3", cutInRange: null }
      ]
    },
    // 94.7 — Ice Cream Pirate Show 2: Ride The Rock Rocket (60min).
    3: {
      episodes: [
        { label: "Ride The Rock Rocket", path: "radio-ice-cream-pirate-shortwave/02_Radio_Ice_Cream_Show_2_Ride_The_Rock_Rocket.mp3", cutInRange: [300, 1800] }
      ]
    },
    // 98.5 — Bruce Dickinson Rock Show late 2006 (~170min each, 2 episodes).
    4: {
      episodes: [
        { label: "Bruce Dickinson late 2006 #2", path: "02-bruce-dickinson-rock-show-late-2006/02%20%20Bruce%20Dickinson%20Rock%20Show%20-%20Late%202006.mp3", cutInRange: [300, 3600] },
        { label: "Bruce Dickinson late 2006 #3 (Disturbed)", path: "03-bruce-dickinson-rock-show-late-2006-with-disturbed/03%20Bruce%20Dickinson%20Rock%20Show%20-%20Late%202006%20with%20Disturbed.mp3", cutInRange: [300, 3600] }
      ]
    },
    // 102.5 — Fusebox Radio hip hop (Apr 14 2010 #357, 184min).
    5: {
      episodes: [
        { label: "Fusebox #357 (Apr 14, 2010)", path: "Fuseboxradio-FuseBoxRadioBroadcastForWeekOfApril142010357/Fuseboxradio-FuseBoxRadioBroadcastForWeekOfApril142010357.mp3", cutInRange: [180, 3600] }
      ]
    },
    // 105.7 — Howard Stern 2006. Limit marketplace randomization to the
    // earliest vetted MP3s instead of the full 179-file archive.
    6: {
      archiveCollection: "howard-stern-24k-complete-2006",
      fileExtensions: ["mp3"],
      archiveFileLimit: 10,
      cutInRange: null
    },
    // 107.9 — Ice Cream Pirate Show 5: Psych-A-Rocky-Road (74min).
    7: {
      episodes: [
        { label: "Psych-A-Rocky-Road", path: "radio-ice-cream-pirate-shortwave/05_Radio_Ice_Cream_Show_5_Psych-A-Rocky-Road.mp3", cutInRange: [300, 2000] }
      ]
    }
  };
  // collectionId → [filename, ...]  in-memory cache of archive.org file lists.
  const archiveFilesCache = new Map();
  const blockedArchiveWarned = new Set();
  const MC_HOLD_MS = 700;
  const MC_HOLD_MOVE_THRESHOLD_PX = 3;
  // Fraction of knob radius that counts as the "center hot zone" for M.C. hold.
  const MC_CENTER_HIT_FRACTION = 0.5;
  const SPECIAL_PROFILE_USERNAME = "habahooney69";
  const SPECIAL_PROFILE_COLORS = ["#00d68f", "#b366ff", "#ff3df0", "#ffdd80"];
  const SPECIAL_PROFILE_HEART_COUNT = 15;
  const RACING_CLIP_ID = "racing-cart-longloop-webm";
  const OEL_WEBM_SOURCE_MAP_PLACEHOLDER = "__PVFD_" + "OEL_WEBM_SOURCE_MAP_JSON__";
  const OEL_WEBM_SOURCE_MAP = "__PVFD_OEL_WEBM_SOURCE_MAP_JSON__";
  const OEL_WEBM_CLIPS = [
    { id: "movie5-longloop-webm-proof", label: "CARZERIA", name: "MOVIE5 LONG", assetName: "movie5_longloop.webm" },
    { id: "movie1-longloop-webm", label: "JETS", name: "MOVIE1 LONG", assetName: "movie1_longloop.webm" },
    { id: "movie6-longloop-webm", label: "J-FLYIN", name: "MOVIE6 LONG", assetName: "movie6_longloop.webm" },
    { id: "movie10f-longloop-webm", label: "MECHA", name: "MOVIE10 F", assetName: "movie10_f_longloop.webm" },
    { id: "diverdolphins-longloop-webm", label: "DOLPHIN", name: "DIVER DOLPHINS", assetName: "diverdolphins_longloop.webm" },
    { id: "racing-cart-longloop-webm", label: "RACING", name: "RACING CART", assetName: "6_Racing_Cart_longloop.webm" }
  ];
  const DEVICE_PICKER_SELECTORS = [
    "button[data-testid='control-button-connect-picker']",
    "[data-testid='control-button-connect-picker']",
    "button[data-testid*='connect-picker' i]",
    "[data-testid*='connect-picker' i]",
    "button[data-testid*='device-picker' i]",
    "[data-testid*='device-picker' i]",
    "button[data-testid*='connect-device' i]",
    "[data-testid*='connect-device' i]",
    "button[data-restore-focus-key='DevicePicker']",
    "[data-restore-focus-key='DevicePicker']",
    "button[aria-label*='Connect to a device' i]",
    "button[aria-label*='Devices Available' i]",
    "button[aria-label*='device picker' i]",
    "button[aria-label*='device' i]",
    "[role='button'][aria-label*='device' i]",
    "[role='button'][aria-label*='connect' i]",
    "button[title*='device' i]",
    "button[title*='connect' i]"
  ];
  const DEVICE_PICKER_SCAN_SELECTOR = "button, [role='button'], [data-testid], [aria-label], [title]";
  const DEVICE_PICKER_SCOPE_SELECTOR = [
    "[data-testid='now-playing-bar']",
    ".Root__now-playing-bar",
    ".main-nowPlayingBar-container",
    "[class*='nowPlayingBar']",
    "footer"
  ].join(",");
  // Known sibling-button testids in the now-playing-bar right cluster — used to
  // EXCLUDE them when we fall back to generic-button scanning. The connect-picker
  // in Spotify 1.2.89.x has no testid, so the elimination approach is reliable.
  const DEVICE_PICKER_SIBLING_TESTIDS = new Set([
    "control-button-queue",
    "control-button-lyrics",
    "control-button-sleep-timer",
    "control-button-npv",
    "control-button-fullscreen",
    "control-button-mini-player",
    "control-button-pip",
    "control-button-volume",
    "control-button-playback-speed"
  ]);
  const PVFD_PLAY_GLYPH = "\u25B6\uFE0E";
  const PVFD_PAUSE_GLYPH = "\u23F8\uFE0E";
  const PVFD_META_IDLE_GLYPH = "\u2014";
  const PVFD_META_PAUSE_GLYPH = "\u2161";
  const FONT_PRESETS = [
    { label: "DOT",  stack: "\"VT323\", \"Share Tech Mono\", monospace" },
    { label: "LCD",  stack: "\"Iceland\", \"Share Tech Mono\", monospace" },
    { label: "TECH", stack: "\"Share Tech Mono\", monospace" },
    { label: "CRT",  stack: "\"VCR OSD Mono\", \"Silkscreen\", \"VT323\", monospace" },
  ];
  const DEFAULT_FONT_PRESET = "TECH";
  const LCD_FONT_PRESETS = [
    { label: "DEFAULT", bodyAttr: "" },
    { label: "DSEG14",  bodyAttr: "dseg14" },
  ];
  const DEFAULT_LCD_FONT_PRESET = "DEFAULT";
  const LCD_FONT_STORAGE_KEY = "pvfd-lcd-font-preset";
  let tintIdx = 0;
  let fontPresetIdx = FONT_PRESETS.findIndex(p => p.label === DEFAULT_FONT_PRESET);
  let lcdFontPresetIdx = LCD_FONT_PRESETS.findIndex(p => p.label === DEFAULT_LCD_FONT_PRESET);
  let performanceModeIdx = 0;
  let logoGlowEnabled = false;
  let pulseLiveFailureReason = "";
  let oelDisplayEnabled = true;
  let racingColorEnabled = false;

  const DEMO_CLIP_CYCLE_MS = 8000;
  const SOURCE_TARGETS = [
    { label: "PLAY", title: "Playback", kind: "playback" },
    { label: "LIB", title: "Your Library", kind: "library" },
    { label: "SRCH", title: "Search", kind: "search" },
    { label: "HOME", title: "Home", kind: "home" },
  ];
  let sourceIdx = 0;
  let sourceFlashUntil = 0;
  let demoAutoMode = false;
  let demoLastClipSwitchMs = 0;
  let demoSavedClipIdx = null;
  const DEMO_CYCLE_INTERVAL_MS = 15000;
  let menuOpen = false;
  let tintMenuOpen = false;
  let customizeMenuOpen = false;
  let pvfdSpecialProfileActive = false;
  let pvfdSpecialProfileSavedTintIdx = null;
  let pvfdSpecialProfileSweepEl = null;
  let pvfdSpecialProfileHeartsTimer = 0;
  let pvfdSpecialProfileRetriesLeft = 0;
  let pvfdSpecialProfileCheckTimer = 0;

  // Legacy LKD payload intentionally stripped from the production path now that the
  // WebM OEL system is the only active renderer.
  const CLIPS = [];
  let clipIdx = 0;
  let clipStartMs = 0;
  let clipVirtualMs = 0;
  let clipLastTsMs = 0;

  // HLPR (Linux audio helper) bridge — see issue #16 and the Reddit thread
  // with IpegFemboys. On Linux, xdg-desktop-portal often hides Spotify or
  // omits the "Share system audio" checkbox, AND picking Spotify in the
  // picker yields a silent track because Spotify outputs to PipeWire, not
  // the renderer media element. pvfd-hlpr taps PipeWire directly and streams
  // getByteFrequencyData-shaped bins over a localhost WebSocket. The bridge
  // stubs logoLiveAudioAnalyser/Ctx/Bins so the existing
  // readLogoLiveAudioMetrics pipeline works unchanged.
  const HLPR_PROTOCOL_VERSION = 1;
  const HLPR_DEFAULT_PORT = 17455;
  const HLPR_WS_URL = `ws://127.0.0.1:${HLPR_DEFAULT_PORT}`;
  const HLPR_OPT_OUT_STORAGE_KEY = "pvfd-hlpr-opt-out";
  const HLPR_OPT_IN_STORAGE_KEY = "pvfd-hlpr-opt-in";
  const HLPR_RELEASES_URL = "https://github.com/adainstarks/PVFD-Linux-Helper/releases/latest";
  const HLPR_PROJECT_URL = "https://github.com/adainstarks/PVFD-Linux-Helper";
  const HLPR_RECONNECT_MIN_MS = 250;
  const HLPR_RECONNECT_MAX_MS = 4000;
  const HLPR_FIRST_CONNECT_NOTIFY_MS = 8000;
  const HLPR_VIRTUAL_SAMPLE_RATE = 48000;

  let logoLiveGuitarCentroidPrev = 0;
  let logoLiveGuitarMotionEnv = 0;
  let logoLiveStyleCache = Object.create(null);
  let logoLiveAudioStream = null;
  let logoLiveAudioCtx = null;
  let logoLiveAudioAnalyser = null;
  let logoLiveAudioBins = null;
  let logoStrip = null;
  let logoLiveAudioSchedulerRaf = 0;
  let logoLiveAudioActive = false;
  let logoLiveAudioPending = false;
  let logoLiveAudioResumeTimer = 0;
  let desktopCaptureActive = false;
  let desktopCapturePending = false;
  // HLPR bridge state. hlprBridgeActive distinguishes Linux-helper streams
  // from native getDisplayMedia so the menu can show HLPR vs LIVE.
  let hlprBridgeActive = false;
  let hlprBridgePending = false;
  let hlprSocket = null;
  let hlprReconnectTimer = 0;
  let hlprReconnectDelayMs = HLPR_RECONNECT_MIN_MS;
  let hlprFirstConnectNotifyTimer = 0;
  let hlprConsentInFlight = false;
  let hlprLatestBins = null;
  let hlprHelloInfo = null;
  let hlprProtocolMismatched = false;
  let logoLivePrevBins = null;
  let logoLiveLastPulseMs = 0;
  let logoLiveDebugLastMs = 0;
  let logoLiveSubEnv = 0;
  let logoLiveBassEnv = 0;
  let logoLiveLowMidEnv = 0;
  let logoLiveMidEnv = 0;
  let logoLiveUpperMidEnv = 0;
  let logoLivePresenceEnv = 0;
  let logoLiveAirEnv = 0;
  let logoLiveLowEnv = 0;
  let logoLiveHighEnv = 0;
  let logoLiveSubSlow = 0;
  let logoLiveLowSlow = 0;
  let logoLiveMidSlow = 0;
  let logoLivePresenceSlow = 0;
  let logoLiveHighSlow = 0;
  let logoLiveSubPrev = 0;
  let logoLiveBassPrev = 0;
  let logoLiveLowMidPrev = 0;
  let logoLiveMidPrev = 0;
  let logoLiveUpperMidPrev = 0;
  let logoLivePresencePrev = 0;
  let logoLiveAirPrev = 0;
  let logoLiveLowPrev = 0;
  let logoLiveHighPrev = 0;
  let logoLiveFluxAvg = 0;
  let logoLivePunchEnv = 0;
  let logoLiveLogoEnv = 0;
  let lastLogoLiveAudioUpdateAt = -Infinity;
  let barHeights = new Array(NUM_BARS).fill(0);
  let sideVuEnergy = 0;
  let pvfdPlaylistScrollStressUntil = -Infinity;
  let pvfdPlaylistScrollStressInstalled = false;

  let lastScrollStressLogoDemandAt = -Infinity;
  let lastScrollStressKnobLedAt = -Infinity;

  let lastSideVuPlayingState = null;
  let lastSideVuReadoutAt = -Infinity;
  let sideVuSettleUntil = -Infinity;

  const SCROLL_STRESS_LOGO_DEMAND_MS = 500;
  const SCROLL_STRESS_KNOB_LED_MS = 350;

  const SIDE_VU_READOUT_MS = 1000;
  const SIDE_VU_SETTLE_MS = 420;
  const SIDE_VU_SETTLE_UPDATE_MS = 70;
  let lastMediumLaneAt = -Infinity;
  let lastSlowLaneAt = -Infinity;
  let globalSearchFocusState = false;
  let globalSearchFocusTimer = 0;
  let pendingGlobalSearchFocusTarget = null;
  const patchedLibrarySearchInputs = new WeakSet();
  const patchedLibrarySearchContainers = new WeakSet();
  const patchedLibraryToolbars = new WeakSet();
  const patchedLibraryRecentsControls = new WeakSet();
  const patchedLyricsSyncButtons = new WeakSet();
  const pvfdRouteState = { route: "other", at: -Infinity, churnUntil: 0 };
  const pvfdMutationWork = {
    chassisRecheck: false,
    mainViewChurn: false,
    searchRoot: null,
    lyricsRoot: null,
    browseFontTarget: false,
    routeMaybeChanged: false,
  };
  let pvfdPerfEnabled = false;
  const pvfdPerfStats = Object.create(null);

  let canvas = null, ctx = null;
  let lcdDimmed = false;
  let chromeDarkEnabled = false;
  let logoStyleIdx = 0;
  let everScrollMode = "OFF";
  let eeqTinted = false;
  let ledGlowEnabled = true;
  let knobGlowEnabled = true;
  let attMode = "mute";
  let mcMenuOpen = false;
  // -1 = BAND off (normal track metadata visible). 0..7 = active preset index.
  let bandPresetIdx = -1;
  let bandTuningTimer = null;
  let bandTuningInterval = null;
  let chassis = null;
  let trackTitle = "", trackArtist = "";
  let lastTrackUri = "";
  let pendingVolume = null;
  let volumeCommitTimer = null;
  let scrubPreviewMs = null;
  let scrubPreviewUntil = 0;
  let navDrag = null;
  let lastClipCacheKey = "";
  let lastCanvasFrameKey = "";
  let oelVideoActiveClipKey = "";
  let oelWebmSourceMap = null;
  let oelWebmCachePopulationStarted = false;
  let oelWebmLastCheckedUrl = "";
  let oelCanvasRendererDisabledLogged = false;
  let clipCacheRebuildBlockedUntil = 0;
  const CLIP_CACHE_BATCH_MS = 4;
  const CLIP_CACHE_ROUTE_REBUILD_BLOCK_MS = 650;
  const CLIP_CACHE_HOME_POINTER_REBUILD_BLOCK_MS = 220;
  const CLIP_RENDER_CACHE_ENABLED = true; // cached OEL frame path
  const MUTATION_FLUSH_DELAY_MS = 80;
  const PLAYER_STATE_SAMPLE_MS = 900;
  const PLAYER_TIMING_SAMPLE_MS = 1000;
  // logo strip is live-audio only. No Spotify analysis, no metronome fallback.
  // The analyser is throttled to ~30fps to keep the theme cheap for release users.
  const LOGO_LIVE_AUDIO_SCHEDULER_MS = 33;
  const LOGO_LIVE_SUB_MIN_HZ = 28;
  const LOGO_LIVE_SUB_MAX_HZ = 70;
  const LOGO_LIVE_BASS_MIN_HZ = 70;
  const LOGO_LIVE_BASS_MAX_HZ = 160;
  const LOGO_LIVE_LOWMID_MIN_HZ = 160;
  const LOGO_LIVE_LOWMID_MAX_HZ = 420;
  const LOGO_LIVE_MID_MIN_HZ = 420;
  const LOGO_LIVE_MID_MAX_HZ = 1500;
  const LOGO_LIVE_UPPERMID_MIN_HZ = 1500;
  const LOGO_LIVE_UPPERMID_MAX_HZ = 3200;
  const LOGO_LIVE_PRESENCE_MIN_HZ = 3200;
  const LOGO_LIVE_PRESENCE_MAX_HZ = 7000;
  const LOGO_LIVE_AIR_MIN_HZ = 7000;
  const LOGO_LIVE_AIR_MAX_HZ = 12000;
  const LOGO_LIVE_LOW_MIN_HZ = LOGO_LIVE_BASS_MIN_HZ;
  const LOGO_LIVE_LOW_MAX_HZ = LOGO_LIVE_LOWMID_MAX_HZ;
  const LOGO_LIVE_HIGH_MIN_HZ = LOGO_LIVE_UPPERMID_MIN_HZ;
  const LOGO_LIVE_HIGH_MAX_HZ = LOGO_LIVE_AIR_MAX_HZ;
  const LOGO_LIVE_ATTACK = 0.96;
  const LOGO_LIVE_RELEASE = 0.64;
  // Per-band AGC. Tracks each band's recent raw peak with a slow decay; the
  // effective compression gain is then reduced when the band has been
  // sustained-loud (shoegaze wall, dense mids) so transients still have
  // headroom to read above the wall. Floor prevents under-amplifying quiet
  // material. Target is the peak level where base gain is preserved at 1×.
  // At ~30fps render rate, 0.997/frame ≈ ~5s peak half-life.
  const LOGO_LIVE_AGC_DECAY = 0.997;
  const LOGO_LIVE_AGC_TARGET = 0.50;
  const LOGO_LIVE_AGC_FLOOR = 0.18;
  const logoLiveBandPeaks = new Float32Array(7);
  const LOGO_LIVE_HIGH_ATTACK = 0.97;
  const LOGO_LIVE_HIGH_RELEASE = 0.70;
  const LOGO_LIVE_LOGO_ATTACK = 0.24;
  const LOGO_LIVE_LOGO_RELEASE = 0.070;
  const LOGO_LIVE_DEBUG = false;
  const LOGO_GLOW_TIMING_SMOOTHING = 0.65;
  // 2048 gives ~23 Hz/bin at 48 kHz — coarser sizes (e.g. 256 → 187 Hz/bin) collapse
  // the 28–70 Hz SUB band and 70–160 Hz BASS band into the same bin.
  const DESKTOP_CAPTURE_FFT_SIZE = 2048;
  const TRACK_SYNC_INTERVAL_MS = 600;
  const BAR_UPDATE_INTERVAL_MS = 140;
  const PROGRESS_READOUT_INTERVAL_MS = 220;
  const LCD_CLOCK_READOUT_INTERVAL_MS = 250;
  const STATIC_READOUT_INTERVAL_MS = 1200;
  const ECO_STATIC_READOUT_INTERVAL_MS = 4200;
  const EXTERNAL_VOLUME_LED_SAMPLE_MS = 5000;
  const VOLUME_SAMPLE_MS = 1200;
  const PERFORMANCE_MODES = [
    {
      label: "FULL",
      frameMs: FRAME_INTERVAL_MS,
      maxClipFps: 60,
      maxDpr: 2,
      cacheBatchMs: CLIP_CACHE_BATCH_MS,
      cacheFramesPerSlice: 3,
      barUpdateMs: BAR_UPDATE_INTERVAL_MS,
      sideVu: true,
      sideReadouts: true,
      reducedEffects: false,
      preloadFullClipCache: true,
      allowPartialClipCache: false,
      keepPreviousClipCache: true,
      releaseInactiveClipBytes: false,
      maxCachedClipFrames: Infinity,
    },
    {
      label: "ECO",
      frameMs: FRAME_INTERVAL_MS,
      maxClipFps: 12,
      maxDpr: 1,
      cacheBatchMs: 8,
      cacheFramesPerSlice: 6,
      barUpdateMs: 1000,
      sideVu: false,
      sideReadouts: false,
      reducedEffects: true,
      preloadFullClipCache: true,
      allowPartialClipCache: true,
      keepPreviousClipCache: false,
      releaseInactiveClipBytes: true,
      maxCachedClipFrames: Infinity,
    },
  ];

  // Cache for the logo spectrum meter canvases — avoids per-frame querySelector +
  // getContext. Populated by ensureLogoSpectrumMarkup; nulled by mutation observer
  // when the strip is rebuilt by Spotify.
  const logoMeterCache = { left: null, right: null };

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  }

  function findPlayerBar() {
    const root = document.querySelector(".Root__now-playing-bar");
    if (root) return root;

    const testIdBar = document.querySelector("[data-testid='now-playing-bar']");
    if (testIdBar) {
      const rootParent = testIdBar.closest(".Root__now-playing-bar");
      return rootParent || testIdBar;
    }

    return document.querySelector(".main-nowPlayingBar-container");
  }

  function preparePlayerBar(bar) {
    if (!bar) return;
    document.documentElement.classList.add("pvfd-theme-active");
    document.body.classList.add("pvfd-theme-active");
    bar.classList.add("pvfd-mounted");
    bar.style.setProperty("height", "var(--pvfd-player-height)", "important");
    bar.style.setProperty("min-height", "var(--pvfd-player-height)", "important");
    bar.style.setProperty("max-height", "var(--pvfd-player-height)", "important");
    bar.style.setProperty("position", "relative", "important");
    bar.style.setProperty("overflow", "hidden", "important");
  }

  function hideNativePlayerChildren(bar) {
    if (!bar) return;
    Array.from(bar.children).forEach((child) => {
      if (!child.classList || !child.classList.contains("pvfd-chassis")) {
        child.classList.add("pvfd-native-player-hidden");
        child.removeAttribute("aria-hidden");
      }
    });
  }

  function buildChassis() {
    const root = document.createElement("div");
    root.className = "pvfd-chassis";
    root.innerHTML = `
      <div class="pvfd-faceplate">
        <div style="display:flex;align-items:center;gap:14px;justify-content:flex-start;">
          <span class="pvfd-silk-eeq" data-pvfd="eeq" role="button" tabindex="0" title="Toggle EEQ tint">EEQ</span>
          <span class="pvfd-silk-label">MOSFET 50w<span class="pvfd-silk-label-x">&times;</span><span class="pvfd-silk-label-4">4</span></span>
          <button class="pvfd-silk-lyrics" type="button" data-pvfd="lyrics" aria-label="Open song lyrics" title="Open lyrics">Lyrics</button>
        </div>
        <div class="pvfd-logo-strip" aria-label="Live audio spectrum logo strip">
          <div class="pvfd-logo-spectrum pvfd-logo-spectrum-left" aria-hidden="true">
            <span class="pvfd-vbar pvfd-vbar-left-air"></span>
            <span class="pvfd-vbar pvfd-vbar-left-presence"></span>
            <span class="pvfd-vbar pvfd-vbar-left-uppermid"></span>
            <span class="pvfd-vbar pvfd-vbar-left-mid"></span>
            <span class="pvfd-vbar pvfd-vbar-left-lowmid"></span>
            <span class="pvfd-vbar pvfd-vbar-left-bass"></span>
            <span class="pvfd-vbar pvfd-vbar-left-sub"></span>
          </div>
          <span class="pvfd-silk-pioneer">pioneer</span>
          <div class="pvfd-logo-spectrum pvfd-logo-spectrum-right" aria-hidden="true">
            <span class="pvfd-vbar pvfd-vbar-right-sub"></span>
            <span class="pvfd-vbar pvfd-vbar-right-bass"></span>
            <span class="pvfd-vbar pvfd-vbar-right-lowmid"></span>
            <span class="pvfd-vbar pvfd-vbar-right-mid"></span>
            <span class="pvfd-vbar pvfd-vbar-right-uppermid"></span>
            <span class="pvfd-vbar pvfd-vbar-right-presence"></span>
            <span class="pvfd-vbar pvfd-vbar-right-air"></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;justify-content:flex-end;">
          <span class="pvfd-silk-label">WMA / MP3</span>
          <span class="pvfd-silk-dab">DAB CONTROL</span>
          <div class="pvfd-eject-cluster" style="display:flex;gap:5px;padding-left:2px;">
            <span class="pvfd-eject-label">EJECT</span>
            <button class="pvfd-eject-glyph" type="button" data-pvfd="eject" title="Eject (initialize standby mode)" aria-label="Eject — Standby Mode"></button>
          </div>
        </div>
      </div>

      <div class="pvfd-mainrow">
        <div class="pvfd-knob-wrap">
          <div class="pvfd-knob" data-pvfd="lknob" title="Volume (scroll or drag — hold center for M.C.)">
            <div class="pvfd-knob-glow"></div>
            <div class="pvfd-knob-bezel"></div>
            <div class="pvfd-knob-led-arc"></div>
            <div class="pvfd-knob-cap"></div>
            <div class="pvfd-knob-engraving" aria-hidden="true">M.C.</div>
            <div class="pvfd-knob-indicator"></div>
          </div>
          <div class="pvfd-mc-menu" data-pvfd="mc-menu" role="menu" aria-hidden="true">
            <div class="pvfd-mc-menu-title">M.C.</div>
            <button class="pvfd-mc-menu-row" type="button" data-pvfd-mc-row="att" title="ATT mode — MUTE (silence) or 10%VOL (0.1 x Current Vol.)"><b>ATT</b><span>MUTE</span></button>
            <button class="pvfd-mc-menu-row" type="button" data-pvfd-mc-row="glow" title="GLOW — knob halo + indicator light up while dragging"><b>GLOW</b><span>ON</span></button>
          </div>
        </div>

        <div class="pvfd-flank">
          <div class="pvfd-pill" data-pvfd="esc"  title="Back (previous page)">ESC</div>
          <div class="pvfd-pill" data-pvfd="att" title="Attenuator: instant mute toggle">ATT</div>
          <div class="pvfd-pill" data-pvfd="dim"  title="Toggle LCD brightness">DIM</div>
          <div class="pvfd-pill" data-pvfd="clip" title="Next OEL/LKD animation">OEL</div>
        </div>

        <div class="pvfd-display-stack">
          <div class="pvfd-meta-lcd" aria-label="Now playing metadata">
            <div class="pvfd-meta-track">
              <button class="pvfd-meta-glyph" type="button" data-pvfd="meta-play-toggle" title="Play / pause" aria-label="Play or pause">${PVFD_PLAY_GLYPH}</button>
              <span class="pvfd-meta-title-window"><span class="pvfd-meta-track-inner">${PVFD_META_IDLE_GLYPH}</span></span>
            </div>
            <div class="pvfd-meta-progress" data-pvfd="trackbar" title="Click or drag to scrub">
              <span class="pvfd-progress-text">:----------&gt;----------:</span>
            </div>
            <div class="pvfd-meta-time">0:00</div>
            <div class="pvfd-fm-overlay" data-pvfd="fm-overlay" aria-hidden="true">
              <span class="pvfd-fm-band-label">FM</span>
              <span class="pvfd-fm-freq" data-pvfd="fm-freq">92.3</span>
              <span class="pvfd-fm-unit">MHz</span>
              <span class="pvfd-fm-stereo">ST</span>
            </div>
            <video class="pvfd-fm-audio" data-pvfd="fm-audio" preload="none" playsinline style="display:none"></video>
          </div>

          <div class="pvfd-compact-stage" aria-label="Compact Pioneer LCD test stage">
            <div class="pvfd-lcd-side pvfd-lcd-side-left" aria-label="Playback readouts">
              <div class="pvfd-side-label">PLAYBACK</div>
              <div class="pvfd-side-readout"><b>VOL</b><span data-pvfd="side-vol">--%</span></div>
              <div class="pvfd-side-readout"><b>MODE</b><span data-pvfd="side-mode">----</span></div>
              <div class="pvfd-side-readout"><b>TINT</b><span data-pvfd="side-tint">CYAN</span></div>
              <div class="pvfd-side-readout"><b>LCD</b><span data-pvfd="side-dim">FULL</span></div>
              <div class="pvfd-side-badges"><span>LIVE</span><span>VFD</span></div>
              <div class="pvfd-side-model pvfd-side-eco-model" data-pvfd="side-eco-model">ECO</div>
            </div>

            <div class="pvfd-lcd" aria-label="Pioneer VFD animation display">
              <div class="pvfd-lcd-video-probe" data-pvfd="lcd-video-probe" aria-hidden="true"></div>
              <video class="pvfd-lcd-video" data-pvfd="lcd-video" aria-hidden="true"></video>
              <div class="pvfd-oel-tint-wash" data-pvfd="oel-tint-wash" aria-hidden="true"></div>
              <canvas class="pvfd-lcd-canvas"></canvas>
              <div class="pvfd-lcd-status" data-pvfd="lcd-status" data-pvfd-label="PLAY" aria-hidden="true">PLAY</div>
              <div class="pvfd-lcd-clock" data-pvfd="lcd-clock" data-pvfd-label="--:--" aria-hidden="true">--:--</div>
              <div class="pvfd-eject-tintmask" data-pvfd="eject-tintmask" aria-hidden="true"></div>
              <div class="pvfd-eject-overlay" data-pvfd="eject-overlay" aria-hidden="true">
                <div class="pvfd-eject-headline"><span>EJECTING</span></div>
                <div class="pvfd-eject-caption">COME BACK SOON <span class="pvfd-eject-smiley">☺</span></div>
              </div>
            </div>

            <div class="pvfd-lcd-side pvfd-lcd-side-right" aria-label="Playback status readouts">
              <div class="pvfd-side-vu" data-pvfd="side-vu">
                <span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span>
              </div>
              <div class="pvfd-side-readouts-right">
                <div class="pvfd-side-readout"><b>PROG</b><span data-pvfd="side-prog">--%</span></div>
                <div class="pvfd-side-readout"><b>LEFT</b><span data-pvfd="side-left">--:--</span></div>
                <div class="pvfd-side-readout"><b>RPT</b><span data-pvfd="side-repeat">OFF</span></div>
                <div class="pvfd-side-readout"><b>SHUF</b><span data-pvfd="side-shuffle">OFF</span></div>
              </div>
              <div class="pvfd-side-model" data-pvfd="side-status">PAUSE</div>
              <div class="pvfd-side-badges"><span>DSP</span><span data-pvfd="side-playbadge">IDLE</span></div>
            </div>
          </div>

          <div class="pvfd-tint-menu-panel" data-pvfd="tint-menu-panel" aria-hidden="true">
            <div class="pvfd-tint-menu-title">TINT</div>
            <div class="pvfd-tint-menu-grid" data-pvfd="tint-menu-grid"></div>
          </div>

          <div class="pvfd-menu-panel" data-pvfd="menu-panel" data-view="main" aria-hidden="true">
            <div class="pvfd-menu-header">
              <div class="pvfd-menu-title" data-pvfd="menu-title">PIONEER MENU</div>
              <button class="pvfd-menu-close" type="button" data-pvfd-menu-action="close" title="Close menu" aria-label="Close menu">&#x2715;</button>
            </div>
            <div class="pvfd-menu-main" data-pvfd="menu-main" data-pvfd-menu-view="main">
              <div class="pvfd-menu-row-split">
                <div class="pvfd-menu-row" data-pvfd-menu-action="clip" title="Next OEL/LKD animation"><b>OEL</b><span data-pvfd="menu-oel">----</span></div>
                <div class="pvfd-menu-row" data-pvfd-menu-action="demo"><b>DEMO</b><span data-pvfd="menu-demo">OFF</span></div>
              </div>
              <div class="pvfd-menu-row-split">
                <button class="pvfd-menu-row pvfd-menu-right-toggle pvfd-menu-perf-toggle" type="button" data-pvfd-menu-action="perf" title="Cycle performance mode"><b>PERF</b><span data-pvfd="menu-perf">FULL</span></button>
                <div class="pvfd-menu-row pvfd-menu-row-placeholder" aria-hidden="true"></div>
              </div>
              <div class="pvfd-menu-row-split">
                <button class="pvfd-menu-row pvfd-menu-right-toggle pvfd-menu-logo-toggle" type="button" data-pvfd-menu-action="logoGlow" title="Toggle Chromium live audio capture"><b>PULSE</b><span data-pvfd="menu-logo-glow">OFF</span></button>
                <div class="pvfd-menu-row pvfd-menu-row-placeholder" aria-hidden="true"></div>
              </div>
              <div class="pvfd-menu-row-split">
                <button class="pvfd-menu-row pvfd-menu-right-toggle pvfd-menu-logo-toggle" type="button" data-pvfd-menu-action="oelDisplay" title="Toggle large OEL display"><b>VFD</b><span data-pvfd="menu-oel-display">ON</span></button>
                <div class="pvfd-menu-row pvfd-menu-row-placeholder" aria-hidden="true"></div>
              </div>
              <div class="pvfd-menu-row-split">
                <button class="pvfd-menu-row pvfd-menu-right-toggle pvfd-menu-row-customize" type="button" data-pvfd-menu-action="openCustomize" title="Appearance & customization"><b>CUSTOMIZE</b><span></span></button>
                <div class="pvfd-menu-row pvfd-menu-row-placeholder" aria-hidden="true"></div>
              </div>
            </div>
            <div class="pvfd-menu-main pvfd-menu-customize" data-pvfd="menu-customize" data-pvfd-menu-view="customize" hidden>
              <div class="pvfd-menu-row-split">
                <div class="pvfd-menu-row" data-pvfd-menu-action="tint"><b>TINT</b><span data-pvfd="menu-tint">CYAN</span></div>
                <button class="pvfd-menu-row pvfd-menu-right-toggle" type="button" data-pvfd-menu-action="racingColor" title="Racing only: TINT forces one-color VFD; COLOR keeps full range while still hue-shifting with the current tint"><b>RACING</b><span data-pvfd="menu-racing-color">TINT</span></button>
              </div>
              <div class="pvfd-menu-row-split">
                <div class="pvfd-menu-row" data-pvfd-menu-action="type"><b>TYPE</b><span data-pvfd="menu-type">DOT</span></div>
                <button class="pvfd-menu-row pvfd-menu-right-toggle" type="button" data-pvfd-menu-action="ledGlow" title="Toggle transport button LED glow"><b>BUTTON</b><span data-pvfd="menu-led-glow">GLOW</span></button>
              </div>

              <div class="pvfd-menu-row-split">
                <div class="pvfd-menu-row" data-pvfd-menu-action="lcdFont" title="Cycle LCD segment font"><b>LCD</b><span data-pvfd="menu-lcd-font">DEFAULT</span></div>
                <button class="pvfd-menu-row pvfd-menu-right-toggle" type="button" data-pvfd-menu-action="everScroll" title="Title scroll: OFF (truncate with ellipsis), ONCE (Pioneer Ever Scroll OFF — scroll across once), or ON (Pioneer Ever Scroll ON — loop forever)"><b>SCROLL</b><span data-pvfd="menu-ever-scroll">OFF</span></button>
              </div>
              <div class="pvfd-menu-row-split">
                <button class="pvfd-menu-row pvfd-menu-right-toggle" type="button" data-pvfd-menu-action="chromeMode" title="Toggle dark chrome plastic"><b>DARK</b><span data-pvfd="menu-chrome">OFF</span></button>
                <button class="pvfd-menu-row pvfd-menu-right-toggle" type="button" data-pvfd-menu-action="logoStyle" title="Pioneer logo style: MODERN (Neuropol geometric) or CLASSIC (Musieer serif from older Pioneer units)"><b>LOGO</b><span data-pvfd="menu-logo-style">MODERN</span></button>
              </div>
              <div class="pvfd-menu-row-split pvfd-menu-row-split-back">
                <button class="pvfd-menu-row pvfd-menu-back" type="button" data-pvfd-menu-action="backToMain" title="Back to Pioneer Menu" aria-label="Back to Pioneer Menu"><span>&#x2190;</span></button>
                <div class="pvfd-menu-row pvfd-menu-row-placeholder" aria-hidden="true"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="pvfd-flank">
          <div class="pvfd-pill" data-pvfd="band" title="BAND (fake-FM radio. Fetches archived 2000s broadcasts)">BAND</div>
          <div class="pvfd-pill" data-pvfd="demo" title="Toggle showroom auto-cycle">DEMO</div>
          <div class="pvfd-pill" data-pvfd="menu" title="Open Pioneer menu">MENU</div>
          <div class="pvfd-pill" data-pvfd="tint" title="Cycle theme color">TINT</div>
        </div>

        <div class="pvfd-knob-wrap">
          <div class="pvfd-nav" title="Outer ring scrolls to scrub. Center = play/pause. Arrows = save/queue/prev/next">
            <div class="pvfd-nav-glow"></div>
            <div class="pvfd-nav-outer" data-pvfd="navring"></div>
            <div class="pvfd-nav-led-ring"></div>
            <div class="pvfd-nav-inner-ring"></div>
            <div class="pvfd-nav-button" data-pvfd="navcenter"></div>
            <div class="pvfd-nav-arrow up"    data-pvfd="navup"    title="Save/like">&#9650;</div>
            <div class="pvfd-nav-arrow down"  data-pvfd="navdn"    title="Add to queue">&#9660;</div>
            <div class="pvfd-nav-arrow left"  data-pvfd="navleft"  title="Previous">&#9664;</div>
            <div class="pvfd-nav-arrow right" data-pvfd="navright" title="Next">&#9654;</div>
          </div>
        </div>
      </div>

      <div class="pvfd-transport">
        <div class="pvfd-tab-side" data-pvfd="queue" title="List (queue)">LST<div class="pvfd-led-strip"></div></div>
        <div class="pvfd-preset-row">
          <div class="pvfd-tab-preset" data-pvfd="shuffle" title="Shuffle">&#8646;<div class="pvfd-led-strip"></div></div>
          <div class="pvfd-tab-preset" data-pvfd="prev"    title="Previous">&#9198;&#xFE0E;<div class="pvfd-led-strip"></div></div>
          <div class="pvfd-tab-preset" data-pvfd="play"    title="Play / pause">&#9654;&#xFE0E;<div class="pvfd-led-strip"></div></div>
          <div class="pvfd-tab-preset" data-pvfd="next"    title="Next">&#9197;&#xFE0E;<div class="pvfd-led-strip"></div></div>
          <div class="pvfd-tab-preset" data-pvfd="repeat"  title="Repeat">&#8635;<div class="pvfd-led-strip"></div></div>
          <div class="pvfd-tab-preset" data-pvfd="love"    title="Save to liked">&#9829;<div class="pvfd-led-strip"></div></div>
        </div>
        <div class="pvfd-tab-side" data-pvfd="devices" title="Devices">SRC<div class="pvfd-led-strip"></div></div>
      </div>
    `;
    return root;
  }

  function ensureOelVideoMarkup() {
    if (!chassis) return;
    const lcd = chassis.querySelector(".pvfd-lcd");
    if (!lcd) return;

    let domChanged = false;
    let probe = lcd.querySelector("[data-pvfd='lcd-video-probe']");
    if (!probe) {
      probe = document.createElement("div");
      probe.className = "pvfd-lcd-video-probe";
      probe.setAttribute("data-pvfd", "lcd-video-probe");
      probe.setAttribute("aria-hidden", "true");
      lcd.insertBefore(probe, lcd.firstChild || null);
      domChanged = true;
    }

    let video = lcd.querySelector("[data-pvfd='lcd-video']");
    if (!video) {
      video = document.createElement("video");
      video.className = "pvfd-lcd-video";
      video.setAttribute("data-pvfd", "lcd-video");
      video.setAttribute("aria-hidden", "true");
      lcd.insertBefore(video, probe.nextSibling);
      domChanged = true;
    }

    prepareOelVideoElement(video);

    let tintWash = lcd.querySelector("[data-pvfd='oel-tint-wash']");
    if (!tintWash) {
      tintWash = document.createElement("div");
      tintWash.className = "pvfd-oel-tint-wash";
      tintWash.setAttribute("data-pvfd", "oel-tint-wash");
      tintWash.setAttribute("aria-hidden", "true");
      lcd.insertBefore(tintWash, video.nextSibling);
      domChanged = true;
    }

    if (!lcd.hasAttribute("data-pvfd-video-state")) {
      lcd.setAttribute("data-pvfd-video-state", "fallback");
      domChanged = true;
    }

    if (domChanged) pvfdDom = null;
    syncOelColorModeAttributes();
  }

  function isRacingClip(clip) {
    return !!clip && clip.id === RACING_CLIP_ID;
  }

  function racingColorModeLabel() {
    return racingColorEnabled ? "COLOR" : "TINT";
  }

  function syncOelColorModeAttributes() {
    if (!chassis) return;
    const dom = getPvfdDom();
    const activeClip = getActiveOelClip();
    const activeClipId = activeClip && activeClip.id ? activeClip.id : "";
    const racingColorActive = isRacingClip(activeClip) && racingColorEnabled;
    const colorMode = racingColorActive ? "color" : "tint";

    setAttrIfChanged(chassis, "data-pvfd-racing-color", racingColorEnabled ? "on" : "off");
    setAttrIfChanged(chassis, "data-pvfd-active-oel-clip", activeClipId || "none");

    if (dom.lcd) {
      setAttrIfChanged(dom.lcd, "data-pvfd-oel-clip", activeClipId || "none");
      setAttrIfChanged(dom.lcd, "data-pvfd-oel-color", colorMode);
      setAttrIfChanged(dom.lcd, "data-pvfd-racing-color", racingColorActive ? "on" : "off");
      dom.lcd.title = isRacingClip(activeClip)
        ? `Racing color mode: ${racingColorModeLabel()} (click OEL to toggle)`
        : "Pioneer OEL display";
    }

    if (dom.lcdVideo && dom.lcdVideo.dataset) {
      dom.lcdVideo.dataset.pvfdClipId = activeClipId || "none";
      dom.lcdVideo.dataset.pvfdColorMode = colorMode;
      dom.lcdVideo.dataset.pvfdRacingColor = racingColorActive ? "on" : "off";
    }
  }

  function ensureLogoSpectrumMarkup() {
    if (!chassis) return;

    const strip = chassis.querySelector(".pvfd-logo-strip");
    if (!strip) return;

    logoStrip = strip;

    let glowCanvas = strip.querySelector("canvas.pvfd-logo-glow-canvas");

    if (!glowCanvas) {
      glowCanvas = document.createElement("canvas");
      glowCanvas.className = "pvfd-logo-glow-canvas";
      glowCanvas.width = LOGO_GLOW_W;
      glowCanvas.height = LOGO_GLOW_H;
      glowCanvas.setAttribute("aria-hidden", "true");
      strip.insertBefore(glowCanvas, strip.firstChild || null);
    }

    const glowCtx = glowCanvas.getContext("2d", { alpha: true });
    if (glowCtx) glowCtx.imageSmoothingEnabled = false;

    logoGlowCanvasCache.canvas = glowCanvas;
    logoGlowCanvasCache.ctx = glowCtx;

    const ensureSide = (selector, cacheKey) => {
      const side = strip.querySelector(selector);

      if (!side) {
        logoMeterCache[cacheKey] = null;
        return;
      }

      let meterCanvas = side.querySelector("canvas.pvfd-logo-meter-canvas");

      if (!meterCanvas || side.children.length !== 1 || side.firstElementChild !== meterCanvas) {
        side.textContent = "";

        meterCanvas = document.createElement("canvas");
        meterCanvas.className = "pvfd-logo-meter-canvas";
        meterCanvas.width = LOGO_METER_W;
        meterCanvas.height = LOGO_METER_H;
        meterCanvas.setAttribute("aria-hidden", "true");

        side.appendChild(meterCanvas);
      }

      const ctx2d = meterCanvas.getContext("2d", { alpha: true });
      if (ctx2d) ctx2d.imageSmoothingEnabled = false;

      side.setAttribute("data-pvfd-meter", "canvas");
      side.setAttribute("data-pvfd-vbar-count", String(LOGO_METER_BAND_COUNT));

      logoMeterCache[cacheKey] = {
        side,
        canvas: meterCanvas,
        ctx: ctx2d
      };
    };

    ensureSide(".pvfd-logo-spectrum-left", "left");
    ensureSide(".pvfd-logo-spectrum-right", "right");

    logoRenderState.dirty = true;
    renderLogoVisuals(performance.now(), true);
  }

  function injectChassis() {
    pvfdDiag.injectChassisCalls++;
    const bar = findPlayerBar();
    if (!bar) return false;

    preparePlayerBar(bar);

    if (bar.querySelector(".pvfd-chassis")) {
      chassis = bar.querySelector(".pvfd-chassis");
      hideNativePlayerChildren(bar);
      ensureLogoSpectrumMarkup();
      ensureOelVideoMarkup();
      canvas = chassis.querySelector(".pvfd-lcd-canvas");
      logoStrip = chassis.querySelector(".pvfd-logo-strip");
      if (canvas) ctx = canvas.getContext("2d");
      if (ctx) ctx.imageSmoothingEnabled = false;
      sizeCanvas();
      // belt-and-braces re-measure on next rAF in case the bar wasn't
      // laid out yet on first attach. Without this, canvasCssW could stay 0 and
      // the loop's safe-bail path would fire every frame until a window resize.
      if (!canvasCssW || !canvasCssH) scheduleSizeCanvas();
      syncOelVideoPlayback(true);
      return true;
    }

    hideNativePlayerChildren(bar);
    chassis = buildChassis();
    chassis.dataset.pvfdInstance = String(pvfdDiag.injectChassisCalls);
    bar.appendChild(chassis);
    hideNativePlayerChildren(bar);
    ensureLogoSpectrumMarkup();
    ensureOelVideoMarkup();

    canvas = chassis.querySelector(".pvfd-lcd-canvas");
    logoStrip = chassis.querySelector(".pvfd-logo-strip");
    if (canvas) {
      ctx = canvas.getContext("2d");
      if (ctx) ctx.imageSmoothingEnabled = false;
      sizeCanvas();
      if (!canvasCssW || !canvasCssH) scheduleSizeCanvas();
      window.addEventListener("resize", scheduleSizeCanvas, { passive: true });
    }
    /* Meta-track re-measure on window resize. Container width changes when
       the Spotify window resizes or the right sidebar collapses/expands,
       which shifts overflow detection and scroll distance. Debounced via
       rAF so a drag-resize burst only re-measures once per frame. */
    window.addEventListener("resize", scheduleMetaTrackRepaint, { passive: true });
    wireControls();
    syncOelVideoPlayback(true);
    return true;
  }

  let metaTrackRepaintRaf = 0;
  function scheduleMetaTrackRepaint() {
    if (metaTrackRepaintRaf) return;
    metaTrackRepaintRaf = requestAnimationFrame(() => {
      metaTrackRepaintRaf = 0;
      repaintMetaTrackForMode();
    });
  }

  let canvasResizeRaf = 0;
  let canvasCssW = 0, canvasCssH = 0;
  function scheduleSizeCanvas() {
    if (canvasResizeRaf) return;
    canvasResizeRaf = requestAnimationFrame(() => {
      canvasResizeRaf = 0;
      sizeCanvas();
    });
  }

  function sizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvasCssW = rect.width;
    canvasCssH = rect.height;
    const perf = activePerformanceConfig();
    const dpr = Math.max(1, Math.min(perf.maxDpr || 2, window.devicePixelRatio || 1));
    const pixelW = Math.max(1, Math.floor(rect.width * dpr));
    const pixelH = Math.max(1, Math.floor(rect.height * dpr));
    const dprKey = String(dpr);
    if (canvas.width === pixelW && canvas.height === pixelH && canvas.dataset.pvfdDpr === dprKey) return;
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.dataset.pvfdDpr = dprKey;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function bind(el, fn) { if (el) el.addEventListener("click", fn); }
  function safe(fn) { try { fn(); } catch (e) { console.warn("[PVFD]", e); } }
  function safeReturn(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function safeErrorSummary(err) {
    if (!err) return "";
    const name = err.name ? String(err.name) : "";
    const message = err.message ? String(err.message) : String(err);
    return name && message && message !== name ? `${name}: ${message}` : (message || name || String(err));
  }
  function safePlayerIsPlaying(fallback = false) {
    return safeReturn(() => {
      if (!window.Spicetify || !Spicetify.Player || !Spicetify.Player.data) return fallback;
      return !!Spicetify.Player.isPlaying();
    }, fallback);
  }

  // Case-preserving variant. Spotify album/artist/playlist IDs are case-
  // sensitive base62 — lowercasing them breaks navigation back to that page
  // ("couldn't find that album"). Use this when storing a path to navigate
  // BACK to. Use currentSpotifyPath() only for prefix-matching route detection.
  function currentSpotifyPathRaw() {
    let spotifyPath = "";
    try {
      const hist = window.Spicetify && Spicetify.Platform && Spicetify.Platform.History;
      const loc = hist && hist.location;
      spotifyPath = String((loc && (loc.pathname || loc.href)) || "");
    } catch {
      spotifyPath = "";
    }
    return spotifyPath || String(window.location && window.location.pathname || "");
  }

  function currentSpotifyPath() {
    return currentSpotifyPathRaw().toLowerCase();
  }

  function refreshPvfdPerfEnabled() {
    pvfdPerfEnabled = safeReturn(() => window.localStorage.getItem(PVFD_PROF_STORAGE_KEY) === "1", false);
    return pvfdPerfEnabled;
  }
  function pvfdPerfStart() {
    return pvfdPerfEnabled ? performance.now() : -1;
  }
  function pvfdPerfEnd(name, startedAt) {
    if (startedAt < 0 || !pvfdPerfEnabled) return;
    const duration = performance.now() - startedAt;
    const entry = pvfdPerfStats[name] || (pvfdPerfStats[name] = {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    });
    entry.count += 1;
    entry.totalMs += duration;
    if (duration > entry.maxMs) entry.maxMs = duration;
  }
  function pvfdPerfDump() {
    refreshPvfdPerfEnabled();
    const rows = Object.keys(pvfdPerfStats)
      .sort()
      .map((name) => {
        const entry = pvfdPerfStats[name];
        const avgMs = entry.count ? entry.totalMs / entry.count : 0;
        return {
          name,
          count: entry.count,
          totalMs: Number(entry.totalMs.toFixed(3)),
          avgMs: Number(avgMs.toFixed(3)),
          maxMs: Number(entry.maxMs.toFixed(3)),
        };
      });
    if (console.table) console.table(rows);
    else console.log("[PVFD] perf", rows);
    return rows;
  }
  function pvfdPerfReset() {
    for (const key of Object.keys(pvfdPerfStats)) delete pvfdPerfStats[key];
    refreshPvfdPerfEnabled();
    return true;
  }
  window.pvfdPerfDump = pvfdPerfDump;
  window.pvfdPerfReset = pvfdPerfReset;
  function invokePlayerAction(fn, refreshDelay = 140) {
    safe(fn);
    schedulePlayerStateRefresh(refreshDelay);
  }
  function getCosmosAsync() {
    return window.Spicetify && Spicetify.CosmosAsync && typeof Spicetify.CosmosAsync.get === "function"
      ? Spicetify.CosmosAsync
      : null;
  }
  function applyRouteStateToDom() {
    const route = pvfdRouteState.route || "other";
    const churn = performance.now() < pvfdRouteState.churnUntil ? "1" : "0";
    const roots = [document.documentElement, document.body, chassis].filter(Boolean);
    for (const root of roots) {
      if (root.dataset) {
        root.dataset.pvfdRoute = route;
        root.dataset.pvfdRouteChurn = churn;
      } else {
        root.setAttribute("data-pvfd-route", route);
        root.setAttribute("data-pvfd-route-churn", churn);
      }
    }
  }

  function beginRouteChurn(ms = ROUTE_CHURN_SUPPRESS_MS) {
    const until = performance.now() + ms;
    if (until > pvfdRouteState.churnUntil) pvfdRouteState.churnUntil = until;
    applyRouteStateToDom();
  }

  // Special-profile easter egg. Spotify user URLs use internal IDs that don't
  // carry the display name, so we identify her by the rendered entity-header
  // heading once it lands in the DOM. Bounded retries cover the small window
  // between "route became profile" and "Spotify rendered the h1".
  function pvfdCheckSpecialProfile() {
    if (pvfdRouteState.route !== "profile") {
      if (pvfdSpecialProfileActive) pvfdExitSpecialProfile();
      pvfdSpecialProfileRetriesLeft = 0;
      if (pvfdSpecialProfileCheckTimer) {
        clearTimeout(pvfdSpecialProfileCheckTimer);
        pvfdSpecialProfileCheckTimer = 0;
      }
      return;
    }
    const headingText = pvfdReadProfileHeading();
    const onSpecial = headingText === SPECIAL_PROFILE_USERNAME;
    if (onSpecial && !pvfdSpecialProfileActive) {
      pvfdSpecialProfileRetriesLeft = 0;
      pvfdEnterSpecialProfile();
    } else if (!onSpecial && pvfdSpecialProfileActive) {
      pvfdSpecialProfileRetriesLeft = 0;
      pvfdExitSpecialProfile();
    } else if (!onSpecial && !pvfdSpecialProfileActive) {
      pvfdScheduleSpecialProfileRecheck();
    }
  }

  function pvfdReadProfileHeading() {
    const mainView = document.querySelector(".Root__main-view");
    if (!mainView) return "";
    const heading =
      mainView.querySelector(".main-entityHeader-container h1") ||
      mainView.querySelector("[class*='entityHeader'][class*='container' i] h1") ||
      mainView.querySelector("[data-testid*='entity-header' i] h1") ||
      mainView.querySelector("h1[data-encore-id='text']");
    return heading ? String(heading.textContent || "").trim().toLowerCase() : "";
  }

  function pvfdScheduleSpecialProfileRecheck() {
    if (pvfdSpecialProfileCheckTimer) return;
    if (pvfdSpecialProfileRetriesLeft <= 0) return;
    pvfdSpecialProfileRetriesLeft--;
    pvfdSpecialProfileCheckTimer = window.setTimeout(function () {
      pvfdSpecialProfileCheckTimer = 0;
      if (pvfdRouteState.route === "profile" && !pvfdSpecialProfileActive) {
        pvfdCheckSpecialProfile();
      }
    }, 350);
  }

  function pvfdEnterSpecialProfile() {
    pvfdSpecialProfileActive = true;
    const roots = [document.documentElement, document.body, chassis].filter(Boolean);
    for (const root of roots) {
      if (root.dataset) root.dataset.pvfdSpecialProfile = SPECIAL_PROFILE_USERNAME;
      else root.setAttribute("data-pvfd-special-profile", SPECIAL_PROFILE_USERNAME);
    }
    // Auto-lock TINT to MAGENTA, remembering whatever she had set so we can
    // restore on exit. applyTintMode(false) does NOT persist to localStorage.
    const magentaIdx = TINT_LABELS.indexOf("MAGENTA");
    if (magentaIdx >= 0 && tintIdx !== magentaIdx) {
      pvfdSpecialProfileSavedTintIdx = tintIdx;
      tintIdx = magentaIdx;
      applyTintMode(false);
    }
    pvfdInjectSpecialProfileSweep();
    pvfdBurstSpecialProfileHearts();
  }

  function pvfdExitSpecialProfile() {
    pvfdSpecialProfileActive = false;
    const roots = [document.documentElement, document.body, chassis].filter(Boolean);
    for (const root of roots) {
      if (root && root.removeAttribute) root.removeAttribute("data-pvfd-special-profile");
    }
    if (pvfdSpecialProfileSavedTintIdx !== null) {
      tintIdx = pvfdSpecialProfileSavedTintIdx;
      pvfdSpecialProfileSavedTintIdx = null;
      applyTintMode(false);
    }
    if (pvfdSpecialProfileSweepEl && pvfdSpecialProfileSweepEl.parentNode) {
      pvfdSpecialProfileSweepEl.parentNode.removeChild(pvfdSpecialProfileSweepEl);
    }
    pvfdSpecialProfileSweepEl = null;
    if (pvfdSpecialProfileHeartsTimer) {
      clearTimeout(pvfdSpecialProfileHeartsTimer);
      pvfdSpecialProfileHeartsTimer = 0;
    }
    const hearts = document.querySelector(".pvfd-habby-hearts-container");
    if (hearts && hearts.parentNode) hearts.parentNode.removeChild(hearts);
  }

  function pvfdInjectSpecialProfileSweep() {
    if (pvfdSpecialProfileSweepEl) return;
    const host = document.querySelector(".Root__main-view .main-view-container__scroll-node-child")
      || document.querySelector(".main-view-container__scroll-node-child")
      || document.querySelector(".Root__main-view");
    if (!host) return;
    const el = document.createElement("div");
    el.className = "pvfd-habby-sweep-overlay";
    el.setAttribute("aria-hidden", "true");
    // Ensure the host can position absolute children even if Spotify left it static.
    if (host.style && getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(el);
    pvfdSpecialProfileSweepEl = el;
  }

  function pvfdBurstSpecialProfileHearts() {
    const prior = document.querySelector(".pvfd-habby-hearts-container");
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    if (pvfdSpecialProfileHeartsTimer) {
      clearTimeout(pvfdSpecialProfileHeartsTimer);
      pvfdSpecialProfileHeartsTimer = 0;
    }
    const container = document.createElement("div");
    container.className = "pvfd-habby-hearts-container";
    container.setAttribute("aria-hidden", "true");
    let maxEndMs = 0;
    for (let i = 0; i < SPECIAL_PROFILE_HEART_COUNT; i++) {
      const heart = document.createElement("div");
      heart.className = "pvfd-habby-heart";
      const startX = Math.random() * 96;
      const duration = 3 + Math.random() * 2;
      const delay = Math.random() * 0.8;
      const size = 16 + Math.random() * 12;
      const color = SPECIAL_PROFILE_COLORS[Math.floor(Math.random() * SPECIAL_PROFILE_COLORS.length)];
      heart.style.cssText =
        "left:" + startX + "vw;" +
        "animation-duration:" + duration + "s;" +
        "animation-delay:" + delay + "s;" +
        "font-size:" + size + "px;" +
        "color:" + color + ";";
      container.appendChild(heart);
      const end = (delay + duration) * 1000;
      if (end > maxEndMs) maxEndMs = end;
    }
    document.body.appendChild(container);
    pvfdSpecialProfileHeartsTimer = window.setTimeout(function () {
      if (container.parentNode) container.parentNode.removeChild(container);
      pvfdSpecialProfileHeartsTimer = 0;
    }, maxEndMs + 600);
  }

  function isRouteChurnActive(ts = performance.now()) {
    if (ts < pvfdRouteState.churnUntil) return true;
    if (pvfdRouteState.churnUntil !== 0) {
      pvfdRouteState.churnUntil = 0;
      applyRouteStateToDom();
    }
    return false;
  }

    function detectPvfdRoute() {
    const mainView = document.querySelector(".Root__main-view");
    const entityHeader = mainView && mainView.querySelector(".main-entityHeader-container");

    const path = currentSpotifyPath();

    const allRouteHints = mainView
      ? Array.from(mainView.querySelectorAll("[data-test-uri], [data-uri], a[href]"))
          .map((el) => (
            el.getAttribute("data-test-uri") ||
            el.getAttribute("data-uri") ||
            el.getAttribute("href") ||
            ""
          ))
          .join(" ")
          .toLowerCase()
      : "";

    const headerText = entityHeader
      ? String(entityHeader.innerText || entityHeader.textContent || "").trim().toLowerCase()
      : "";

    const hasArtist =
      path.includes("/artist") ||
      allRouteHints.includes("spotify:artist:") ||
      !!(mainView && mainView.querySelector('section[data-test-uri^="spotify:artist:"]'));

    const hasAlbum =
      path.includes("/album") ||
      allRouteHints.includes("spotify:album:") ||
      /^\s*album\b/.test(headerText);

    const hasPlaylist =
      path.includes("/playlist") ||
      allRouteHints.includes("spotify:playlist:") ||
      /^\s*playlist\b/.test(headerText);

    if (hasArtist) return "artist";
    if (hasAlbum) return "album";
    if (hasPlaylist) return "playlist";

    if (path === "/" || path === "/home" || (mainView && mainView.querySelector("[data-testid='home-page']"))) return "home";
    if (path.includes("/search")) return "search";
    if (path.includes("/collection")) return "library";
    if (path.includes("/queue")) return "queue";
    if (path.includes("/beautifullyrics") || path.includes("/spicylyrics")) return "external-lyrics";
    if (path.includes("/lyrics")) return "lyrics";
    if (path.includes("/user/")) return "profile";

    /*
      Only call it fullscreen when there is no entity header.
      Album/playlist/artist pages can keep fullscreen-ish or now-playing nodes mounted.
    */
    if (
      !entityHeader &&
      (
        document.fullscreenElement ||
        document.querySelector("[data-testid*='fullscreen' i], [class*='fullscreenView' i]")
      )
    ) {
      return "fullscreen";
    }

    return "other";
  }

  function updateRouteState(force = false, ts = performance.now()) {
    const perfAt = pvfdPerfStart();
    if (!force && ts - pvfdRouteState.at < ROUTE_STATE_SAMPLE_MS && !isRouteChurnActive(ts)) {
      pvfdPerfEnd("routeStateUpdate", perfAt);
      return pvfdRouteState.route;
    }
    const nextRoute = detectPvfdRoute();
    pvfdRouteState.at = ts;
    const prevRoute = pvfdRouteState.route;
    if (prevRoute !== nextRoute) {
      pvfdRouteState.route = nextRoute;
      // Entering a profile route — give the special-profile heading detector
      // enough retries (8 × 350ms ≈ 2.8s) to catch Spotify's render.
      if (nextRoute === "profile") pvfdSpecialProfileRetriesLeft = 8;
    }
    applyRouteStateToDom();
    pvfdCheckSpecialProfile();
    pvfdPerfEnd("routeStateUpdate", perfAt);
    return pvfdRouteState.route;
  }

  function readFontPresetIdx() {
    const saved = safeReturn(() => window.localStorage.getItem(FONT_STORAGE_KEY), "");
    const idx = FONT_PRESETS.findIndex(p => p.label === saved);
    return idx >= 0 ? idx : Math.max(0, FONT_PRESETS.findIndex(p => p.label === DEFAULT_FONT_PRESET));
  }

  function readLcdFontPresetIdx() {
    const saved = safeReturn(() => window.localStorage.getItem(LCD_FONT_STORAGE_KEY), "");
    const idx = LCD_FONT_PRESETS.findIndex(p => p.label === saved);
    return idx >= 0 ? idx : Math.max(0, LCD_FONT_PRESETS.findIndex(p => p.label === DEFAULT_LCD_FONT_PRESET));
  }

  function readTintIdx() {
    const saved = String(safeReturn(() => window.localStorage.getItem(TINT_STORAGE_KEY), "") || "").toUpperCase();
    const idx = TINT_LABELS.findIndex(label => label === saved);
    if (idx >= 0) return idx;
    const numericIdx = Number(saved);
    return Number.isInteger(numericIdx) && numericIdx >= 0 && numericIdx < TINT_LABELS.length ? numericIdx : 0;
  }

  function readDimEnabled() {
    const saved = String(safeReturn(() => window.localStorage.getItem(DIM_STORAGE_KEY), "") || "").toUpperCase();
    return saved === "ON" || saved === "TRUE" || saved === "1" || saved === "DIM";
  }

  function readChromeDarkEnabled() {
    const saved = String(safeReturn(() => window.localStorage.getItem(CHROME_STORAGE_KEY), "") || "").toUpperCase();
    return saved === "ON" || saved === "TRUE" || saved === "1" || saved === "DARK";
  }

  function readLogoStyleIdx() {
    const saved = String(safeReturn(() => window.localStorage.getItem(LOGO_STYLE_STORAGE_KEY), "") || "").toUpperCase();
    const idx = LOGO_STYLES.indexOf(saved);
    return idx >= 0 ? idx : 0;
  }

  function readEverScrollMode() {
    const saved = String(safeReturn(() => window.localStorage.getItem(EVER_SCROLL_STORAGE_KEY), "") || "").toUpperCase();
    /* Upgrade old "ON" value (early 3-state cycle) to "LOOP" — same intent. */
    if (saved === "ON") return "LOOP";
    return EVER_SCROLL_MODES.indexOf(saved) >= 0 ? saved : "OFF";
  }

  function readEeqTinted() {
    const saved = String(safeReturn(() => window.localStorage.getItem(EEQ_TINT_STORAGE_KEY), "") || "").toUpperCase();
    return saved === "ON" || saved === "TRUE" || saved === "1";
  }

  function readLedGlowEnabled() {
    const saved = String(safeReturn(() => window.localStorage.getItem(LED_GLOW_STORAGE_KEY), "") || "").toUpperCase();
    return !(saved === "OFF" || saved === "FALSE" || saved === "0");
  }

  function readKnobGlowEnabled() {
    const saved = String(safeReturn(() => window.localStorage.getItem(KNOB_GLOW_STORAGE_KEY), "") || "").toUpperCase();
    return !(saved === "OFF" || saved === "FALSE" || saved === "0");
  }

  function readAttMode() {
    const saved = String(safeReturn(() => window.localStorage.getItem(ATT_MODE_STORAGE_KEY), "") || "").toLowerCase();
    return saved === "soft" ? "soft" : "mute";
  }

  function readBandPresetIdx() {
    const raw = safeReturn(() => window.localStorage.getItem(BAND_STORAGE_KEY), "");
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return -1;
    if (n < 0 || n >= BAND_PRESETS.length) return -1;
    return n;
  }

  function isLinuxLikePlatform() {
    const ua = String(safeReturn(() => navigator.userAgent, "") || "").toLowerCase();
    const platform = String(safeReturn(() => navigator.platform, "") || "").toLowerCase();
    const uaPlatform = String(safeReturn(() => navigator.userAgentData && navigator.userAgentData.platform, "") || "").toLowerCase();
    return ua.includes("linux") || ua.includes("x11") || platform.includes("linux") || uaPlatform.includes("linux");
  }

  function clipStorageId(clip, idx = 0) {
    return String((clip && (clip.id || clip.assetName || clip.source || clip.name)) || idx);
  }

  function getClipByStorageId(key) {
    if (!key) return null;
    const idx = OEL_WEBM_CLIPS.findIndex((clip, clipIndex) => clipStorageId(clip, clipIndex) === key);
    return idx >= 0 ? OEL_WEBM_CLIPS[idx] : null;
  }

  function clipWebmAssetName(clip) {
    return clip && clip.assetName ? clip.assetName : "";
  }

  function extractUrlFromCssValue(value) {
    const match = String(value || "").match(/^url\(["']?(.*?)["']?\)$/);
    return match ? match[1] : "";
  }

  function prepareOelVideoElement(video) {
    if (!video || video.dataset.pvfdInit === "1") return;
    video.dataset.pvfdInit = "1";
    console.log("[PVFD] OEL WebM proof: video element inserted into OEL frame");
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.loop = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = "auto";
    video.tabIndex = -1;
    video.removeAttribute("controls");
    video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    video.addEventListener("loadedmetadata", () => {
      const clipKey = video.dataset.pvfdClipKey || "unknown";
      console.log(`[PVFD] OEL WebM proof: loadedmetadata clip=${clipKey}`);
    });

    video.addEventListener("canplay", () => {
      const clipKey = video.dataset.pvfdClipKey || "unknown";
      console.log(`[PVFD] OEL WebM proof: canplay clip=${clipKey}`);
    });

    video.addEventListener("playing", () => {
      const clipKey = video.dataset.pvfdClipKey || "";
      console.log(`[PVFD] OEL WebM proof: playing clip=${clipKey}`);
      oelVideoActiveClipKey = clipKey;
      const dom = getPvfdDom();
      setAttrIfChanged(dom.lcd, "data-pvfd-video-state", "active");
      lastCanvasFrameKey = "";
    });

    video.addEventListener("error", () => {
      const clipKey = video.dataset.pvfdClipKey || "unknown";
      const errorCode = video.error && typeof video.error.code === "number" ? video.error.code : "unknown";
      const errorMessage = video.error && video.error.message ? video.error.message : "unavailable";
      console.warn(`[PVFD] OEL WebM proof: video error clip=${clipKey} code=${errorCode} message=${errorMessage}`);
      // EJECT easter egg pipes through the same cache resolver as
      // OEL clips, so leave its src alone if eject is active.
      if (video.dataset.pvfdEjectActive === "1") return;
      pauseOelVideoPlayback(oelDisplayEnabled ? "error" : "off", true);
    });
  }

  function setOelVideoState(state, clipKey = "") {
    const dom = getPvfdDom();
    setAttrIfChanged(dom.lcd, "data-pvfd-video-state", state);
    if (dom.lcdVideo) {
      if (clipKey) dom.lcdVideo.dataset.pvfdClipKey = clipKey;
      else delete dom.lcdVideo.dataset.pvfdClipKey;
    }
    if (state !== "active") oelVideoActiveClipKey = "";
    syncOelColorModeAttributes();
    applyLcdFilter();
  }

  function pauseOelVideoPlayback(state = "fallback", clearSrc = false) {
    const dom = getPvfdDom();
    const video = dom.lcdVideo;
    if (!video) {
      setOelVideoState(state);
      return;
    }

    safe(() => video.pause());
    delete video.dataset.pvfdPlayPending;
    if (clearSrc && video.getAttribute("src")) {
      video.removeAttribute("src");
      safe(() => video.load());
    }
    setOelVideoState(state);
  }

  const OEL_WEBM_CACHE_DB_NAME = "pvfd-oel-webm-cache";
  const OEL_WEBM_CACHE_STORE = "clips";
  // Bump when a webm's bytes change at the same filename — invalidates IndexedDB.
  const OEL_WEBM_CACHE_VERSION = 1;
  const OEL_WEBM_GITHUB_BASE = "https://adainstarks.github.io/PioneerVFD/Themes/PioneerVFD/assets/";

  function oelWebmCacheKey(assetName) {
    return `${assetName}@v${OEL_WEBM_CACHE_VERSION}`;
  }

  function openOelWebmCacheDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(OEL_WEBM_CACHE_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(OEL_WEBM_CACHE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function readOelWebmFromCache(assetName) {
    return openOelWebmCacheDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(OEL_WEBM_CACHE_STORE, "readonly");
      const req = tx.objectStore(OEL_WEBM_CACHE_STORE).get(oelWebmCacheKey(assetName));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  function writeOelWebmToCache(assetName, blob) {
    return openOelWebmCacheDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(OEL_WEBM_CACHE_STORE, "readwrite");
      tx.objectStore(OEL_WEBM_CACHE_STORE).put(blob, oelWebmCacheKey(assetName));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  async function resolveClipUrlViaCache(clip) {
    const assetName = clip.assetName;
    const githubUrl = OEL_WEBM_GITHUB_BASE + assetName;

    try {
      const cachedBlob = await readOelWebmFromCache(assetName);
      if (cachedBlob) {
        console.log(`[PVFD] OEL WebM cache hit: ${assetName} (${cachedBlob.size} bytes)`);
        return URL.createObjectURL(cachedBlob);
      }
    } catch (err) {
      console.warn(`[PVFD] OEL WebM cache read failed for ${assetName}:`, err);
    }

    fetch(githubUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => writeOelWebmToCache(assetName, blob)
        .then(() => console.log(`[PVFD] OEL WebM cached: ${assetName} (${blob.size} bytes)`)))
      .catch((err) => console.warn(`[PVFD] OEL WebM cache populate failed for ${assetName}:`, err && err.message || err));

    return githubUrl;
  }

  function startOelWebmCachePopulation() {
    if (oelWebmCachePopulationStarted) return;
    oelWebmCachePopulationStarted = true;
    oelWebmSourceMap = {};
    console.log("[PVFD] OEL WebM cache: starting population");

    // EJECTING.webm rides the same IndexedDB + gh-pages pipeline as
    // the OEL clips — no special-cased URL discovery, no link-element
    // scraping. We just pass a clip-shaped object to the resolver.
    const extras = [{ id: "ejecting-easter-egg", assetName: "EJECTING.webm" }];
    const all = OEL_WEBM_CLIPS.concat(extras);

    for (const clip of all) {
      if (!clip || !clip.assetName) continue;
      resolveClipUrlViaCache(clip)
        .then((url) => {
          oelWebmSourceMap[clip.assetName] = url;
          console.log(`[PVFD] OEL WebM ready: ${clip.assetName} → ${url.startsWith("blob:") ? "blob" : "github"}`);
          safe(() => syncOelVideoPlayback(true));
        })
        .catch((err) => console.warn(`[PVFD] OEL WebM resolve failed: ${clip.assetName}`, err && err.message || err));
    }
  }

  function resolveOelWebmSourceMap() {
    if (!oelWebmSourceMap) {
      const injectedMap = OEL_WEBM_SOURCE_MAP;
      if (
        injectedMap &&
        injectedMap !== OEL_WEBM_SOURCE_MAP_PLACEHOLDER &&
        typeof injectedMap === "object" &&
        !Array.isArray(injectedMap)
      ) {
        oelWebmSourceMap = injectedMap;
        console.log(`[PVFD] OEL WebM registry ready: clips=${Object.keys(injectedMap).length}`);
      } else {
        startOelWebmCachePopulation();
      }
    }
    return oelWebmSourceMap;
  }

  async function logOelWebmSourceCheck(clip, url) {
    if (!url || url === oelWebmLastCheckedUrl) return;
    oelWebmLastCheckedUrl = url;
    const clipKey = clipStorageId(clip);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const contentType = response.headers.get("content-type") || blob.type || "unknown";
      console.log(`[PVFD] OEL WebM proof: fetch check clip=${clipKey} status=${response.status} content-type=${contentType} blob-size=${blob.size}`);
    } catch (err) {
      const detail = err && err.message ? err.message : err;
      console.warn(`[PVFD] OEL WebM proof: fetch check failed clip=${clipKey}`, detail);
    }
  }

  function requestOelVideoPlay(video) {
    if (!video || video.dataset.pvfdPlayPending === "1") return;
    video.dataset.pvfdPlayPending = "1";
    let playResult = null;
    try {
      playResult = video.play();
    } catch (err) {
      delete video.dataset.pvfdPlayPending;
      console.warn("[PVFD] OEL WebM proof: play() rejected", err);
      pauseOelVideoPlayback("error");
      return;
    }
    if (!playResult || typeof playResult.then !== "function") {
      delete video.dataset.pvfdPlayPending;
      console.log("[PVFD] OEL WebM proof: play() resolved");
      return;
    }
    playResult.then(() => {
      delete video.dataset.pvfdPlayPending;
      console.log("[PVFD] OEL WebM proof: play() resolved");
    }).catch((err) => {
      delete video.dataset.pvfdPlayPending;
      console.warn("[PVFD] OEL WebM proof: play() rejected", err);
      pauseOelVideoPlayback("error");
    });
  }

  function resolveClipWebmUrl(clip) {
    const assetName = clipWebmAssetName(clip);
    if (!assetName) return "";
    if (clip.webmUrl) return clip.webmUrl;
    const sourceMap = resolveOelWebmSourceMap();
    if (!sourceMap) return "";

    const url = String(sourceMap[assetName] || "");
    if (!url) return "";

    const sourceType = url.startsWith("data:video/webm;base64,")
      ? "data"
      : (url.startsWith("blob:") ? "blob" : "other");
    console.log(`[PVFD] OEL WebM proof: clip=${clip.id} source-type=${sourceType} length=${url.length}`);
    clip.webmUrl = url;
    return url;
  }

  function markClipWebmFailed(clip, err) {
    if (!clip) return;
    clip.webmFailed = true;
    const detail = err && err.message ? err.message : err;
    console.warn("[PVFD] OEL WebM failed; clip disabled:", clip.name, detail || "unknown error");
    pauseOelVideoPlayback(oelDisplayEnabled ? "error" : "off");
  }

  function isPvfdPlaylistScrollStressActive(now = performance.now()) {
    return now < pvfdPlaylistScrollStressUntil;
  }



  function installPvfdPlaylistScrollStressDetector() {
    if (pvfdPlaylistScrollStressInstalled) return;

    pvfdPlaylistScrollStressInstalled = true;

    document.addEventListener(
      "scroll",
      (event) => {
        const target = event.target;

        if (
          target &&
          target.nodeType === 1 &&
          (
            target.matches?.(".main-view-container__scroll-node, [data-overlayscrollbars-viewport]") ||
            target.closest?.(".main-view-container__scroll-node, [data-overlayscrollbars-viewport]")
          )
        ) {
          pvfdPlaylistScrollStressUntil = performance.now() + 240;
        }
      },
      true
    );
  }

  function syncOelVideoPlayback(force = false) {
    const perfAt = pvfdPerfStart();
    if (!chassis) {
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }
    // EJECT easter egg owns the LCD for the duration of its sequence.
    // The render loop must not race the pause we issued from
    // startEjectSequence() — without this gate, the next tick's
    // readyState/paused check would immediately restart the webm.
    if (!force && chassis.getAttribute("data-pvfd-state") === "ejecting") {
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }
    ensureOelVideoMarkup();
    logOelCanvasRendererDisabled();

    const dom = getPvfdDom();
    const video = dom.lcdVideo;
    if (!dom.lcd || !video) {
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    if (!oelDisplayEnabled) {
      pauseOelVideoPlayback("off");
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    if (!force && dom.lcd.getAttribute("data-pvfd-video-state") === "error") {
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    const activeClip = getActiveOelClip();
    if (!activeClip) {
      pauseOelVideoPlayback("error");
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    syncOelColorModeAttributes();

    const clipKey = clipStorageId(activeClip, clipIdx);
    const webmUrl = resolveClipWebmUrl(activeClip);

    if (!webmUrl) {
      console.warn(`[PVFD] OEL WebM proof: ${activeClip.assetName} URL unavailable`);
      pauseOelVideoPlayback("error");
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    if (force || video.dataset.pvfdClipKey !== clipKey || video.getAttribute("src") !== webmUrl) {
      oelVideoActiveClipKey = "";
      setOelVideoState("loading", clipKey);
      safe(() => video.pause());
      delete video.dataset.pvfdPlayPending;
      video.dataset.pvfdClipKey = clipKey;
      video.dataset.pvfdClipLabel = activeClip.label;
      video.src = webmUrl;
      const assignedSrcType = video.src.startsWith("data:video/webm;base64,")
        ? "data"
        : (video.src.startsWith("blob:") ? "blob" : "other");
      console.log(`[PVFD] OEL WebM proof: assigned clip=${clipKey} src-type=${assignedSrcType} length=${video.src.length}`);
      logOelWebmSourceCheck(activeClip, video.src);
      safe(() => { video.currentTime = 0; });
      safe(() => video.load());
      video.addEventListener("canplay", () => {
        requestOelVideoPlay(video);
      }, { once: true });
      pvfdPerfEnd("webmOelSync", perfAt);
      return false;
    }

    if (oelVideoActiveClipKey === clipKey && !video.paused && !video.ended) {
      pvfdPerfEnd("webmOelSync", perfAt);
      return true;
    }

    if (video.readyState >= 3 && video.paused) {
      requestOelVideoPlay(video);
    }

    const active = oelVideoActiveClipKey === clipKey && !video.paused && !video.ended;
    pvfdPerfEnd("webmOelSync", perfAt);
    return active;
  }

  function readClipIdx() {
    const saved = String(safeReturn(() => window.localStorage.getItem(CLIP_STORAGE_KEY), "") || "");
    const clips = OEL_WEBM_CLIPS;
    if (!clips.length) return 0;
    if (!saved) return 0;
    const savedUpper = saved.toUpperCase();
    const exactIdx = clips.findIndex((clip, idx) => clipStorageId(clip, idx) === saved);
    if (exactIdx >= 0) return exactIdx;
    const nameIdx = clips.findIndex(clip => String(clip && clip.name || "").toUpperCase() === savedUpper);
    if (nameIdx >= 0) return nameIdx;
    const numericIdx = Number(saved);
    return Number.isInteger(numericIdx) && numericIdx >= 0 && numericIdx < clips.length ? numericIdx : 0;
  }

  function readPerformanceModeIdx() {
    const saved = safeReturn(() => window.localStorage.getItem(PERF_STORAGE_KEY), "");
    const idx = PERFORMANCE_MODES.findIndex(p => p.label === saved);
    return idx >= 0 ? idx : 0;
  }

  function readLogoGlowEnabled() {
    // PULSE should always boot idle so Chromium/system-audio capture never
    // re-engages itself on startup.
    return false;
  }

  function getActiveOelClip() {
    if (!OEL_WEBM_CLIPS.length) return null;
    return OEL_WEBM_CLIPS[clipIdx] || OEL_WEBM_CLIPS[0];
  }

  function readOelDisplayEnabled() {
    const saved = safeReturn(() => window.localStorage.getItem(OEL_DISPLAY_STORAGE_KEY), null);
    // Default ON when nothing has been saved yet.
    return saved !== "OFF";
  }

  function readRacingColorEnabled() {
    const saved = safeReturn(() => {
      return window.localStorage.getItem(RACING_COLOR_STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_RACING_COLOR_STORAGE_KEY);
    }, null);
    const value = String(saved || "").toUpperCase();
    return value === "COLOR" || value === "ON" || value === "TRUE" || value === "1";
  }

  function activePerformanceConfig() {
    return PERFORMANCE_MODES[performanceModeIdx] || PERFORMANCE_MODES[0];
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function validTempo(value) {
    const tempo = Number(value);
    return Number.isFinite(tempo) && tempo >= 45 && tempo <= 210 ? tempo : 0;
  }

  function readTempoFromObject(obj) {
    if (!obj || typeof obj !== "object") return 0;
    return validTempo(obj.tempo)
      || validTempo(obj.bpm)
      || validTempo(obj.audio_features && obj.audio_features.tempo)
      || validTempo(obj.audioFeatures && obj.audioFeatures.tempo)
      || validTempo(obj.metadata && obj.metadata.tempo)
      || validTempo(obj.metadata && obj.metadata.bpm)
      || validTempo(obj.metadata && obj.metadata.audio_features && obj.metadata.audio_features.tempo)
      || validTempo(obj.metadata && obj.metadata.audioFeatures && obj.metadata.audioFeatures.tempo);
  }

  function bindNowPlayingShortcut(el) {
    if (!el) return;
    if (el.dataset.pvfdNowPlayingShortcutBound === "1") return;
    el.dataset.pvfdNowPlayingShortcutBound = "1";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("title", "Open now playing; right-click for Spotify menu");
    el.addEventListener("click", () => {
      openPlaybackSource();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        openSpotifyNowPlayingContextMenu(e);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openPlaybackSource();
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSpotifyNowPlayingContextMenu(e);
    });
  }

  function bindMetaPlaybackGlyph(el) {
    if (!el) return;
    if (el.dataset.pvfdMetaPlaybackBound === "1") return;
    el.dataset.pvfdMetaPlaybackBound = "1";
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      invokePlayerAction(() => Spicetify.Player.togglePlay());
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSpotifyNowPlayingContextMenu(e);
    });
  }


  function activeClipName(maxLen = 12) {
    const activeClip = getActiveOelClip();
    const label = String(activeClip && (activeClip.label || activeClip.name) || "WEBM");
    return label.slice(0, maxLen).toUpperCase();
  }

  function logOelCanvasRendererDisabled() {
    if (oelCanvasRendererDisabledLogged) return;
    oelCanvasRendererDisabledLogged = true;
    console.log("[PVFD] hard-disabled old LKD canvas renderer");
  }

  function notifyPvfd(message) {
    console.warn("[PVFD]", message);
    safe(() => Spicetify.showNotification && Spicetify.showNotification(message));
  }

  function clickFirst(selectors) {
    for (const selector of selectors) {
      const el = safeReturn(() => document.querySelector(selector), null);
      if (el && typeof el.click === "function") {
        el.click();
        return true;
      }
    }
    return false;
  }

  function clickFirstOutsideChassis(selectors, reject = null) {
    for (const selector of selectors) {
      const els = safeReturn(() => Array.from(document.querySelectorAll(selector)), []);
      const el = els.find((candidate) => (
        (!candidate.closest || !candidate.closest(".pvfd-chassis")) &&
        !(reject && reject(candidate))
      ));
      if (el && typeof el.click === "function") {
        el.click();
        return true;
      }
    }
    return false;
  }

  function buttonLabelText(el) {
    return [
      el && el.id,
      el && el.getAttribute && el.getAttribute("aria-label"),
      el && el.getAttribute && el.getAttribute("title"),
      el && el.getAttribute && el.getAttribute("data-tippy-content"),
      el && el.textContent
    ].map((value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean).join(" ");
  }

  function pvfdButtonDescriptor(el) {
    if (!el) return null;
    const rect = safeReturn(() => el.getBoundingClientRect(), null);
    const style = safeReturn(() => window.getComputedStyle(el), null);
    return {
      tag: String(el.tagName || "").toLowerCase(),
      id: el.id || "",
      testid: el.getAttribute && el.getAttribute("data-testid") || "",
      role: el.getAttribute && el.getAttribute("role") || "",
      aria: el.getAttribute && el.getAttribute("aria-label") || "",
      title: el.getAttribute && el.getAttribute("title") || "",
      text: String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      disabled: !!(el.disabled || el.getAttribute && el.getAttribute("aria-disabled") === "true"),
      display: style && style.display || "",
      visibility: style && style.visibility || "",
      rect: rect ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      } : null
    };
  }

  function pvfdElementIsDisplayHidden(el) {
    const style = safeReturn(() => window.getComputedStyle(el), null);
    if (style && (style.display === "none" || style.visibility === "hidden")) return true;
    const rect = safeReturn(() => el.getBoundingClientRect(), null);
    return !!(rect && (!rect.width || !rect.height));
  }

  function scoreDevicePickerCandidate(el) {
    if (!el || el.closest && el.closest(".pvfd-chassis")) return -1000;
    const desc = pvfdButtonDescriptor(el) || {};
    const testid = String(desc.testid || "").toLowerCase();
    const label = buttonLabelText(el);
    const restoreKey = String(safeReturn(() => el.getAttribute("data-restore-focus-key"), "") || "");
    const className = String((el && el.className && el.className.baseVal) || el.className || "");
    const inScope = !!(el.closest && safeReturn(() => el.closest(DEVICE_PICKER_SCOPE_SELECTOR), null));
    const isGenericButton = /\bmain-genericButton-button\b/.test(className);
    let score = 0;

    // Tier 1: explicit testid hits (legacy Spotify builds that still carry the testid).
    if (testid === "control-button-connect-picker") score += 100;
    if (testid.includes("connect-picker")) score += 80;
    if (testid.includes("device-picker")) score += 75;
    if (testid.includes("connect-device")) score += 70;
    if (testid.includes("connect") && testid.includes("button")) score += 45;

    // Tier 2: data-restore-focus-key='DevicePicker' — set by Spotify when picker is open.
    // Reliable signal even when testid is empty and locale is non-English.
    if (restoreKey === "DevicePicker") score += 90;

    // Tier 3: English-locale aria-label matches (kept for any pre-localization labels).
    if (/connect to a device|devices available|device picker|connect picker|select a device/.test(label)) score += 80;
    if (/\bdevices?\b/.test(label)) score += 20;
    if (/\bconnect\b/.test(label)) score += 18;
    if (/speaker|speakers|spotify connect|cast/.test(label)) score += 8;

    // Tier 4 (NEW — Spotify 1.2.89.x DOM signature): a .main-genericButton-button
    // inside the now-playing-bar with NO data-testid and a non-empty aria-label is
    // almost certainly the connect-picker. Other generic buttons (queue/lyrics/sleep
    // timer/etc.) all carry a control-button-* testid. Locale-independent.
    if (inScope && isGenericButton && !testid && desc.aria) {
      if (!DEVICE_PICKER_SIBLING_TESTIDS.has(testid)) {
        score += 60;
      }
    }

    if (inScope) score += 12;

    // Soft penalty for disabled. Spotify can disable the connect button briefly
    // (a few hundred ms) while it enumerates devices on first mount. Our retry
    // loop in openDevicePicker() tries again at +90ms and +330ms, by which point
    // the button is usually re-enabled. Old code used -80 here which permanently
    // disqualified the candidate, so the retry loop had nothing to click on
    // the second/third attempt. -15 keeps it as the top scored candidate across
    // all three attempts. (Note: a persistently-disabled button — no Connect
    // devices on the network — still won't open anything, since browsers no-op
    // click() on disabled elements. The picker requires devices to exist.)
    if (desc.disabled) score -= 15;
    if (pvfdElementIsDisplayHidden(el)) score -= 80;

    return score;
  }

  function uniqueElements(elements) {
    const seen = new Set();
    const out = [];
    elements.forEach((el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      out.push(el);
    });
    return out;
  }

  function findDevicePickerCandidates() {
    const elements = [];
    DEVICE_PICKER_SELECTORS.forEach((selector) => {
      elements.push(...safeReturn(() => Array.from(document.querySelectorAll(selector)), []));
    });
    // Scan all generic buttons inside the now-playing bar — covers Spotify 1.2.89.x
    // where the connect-picker has no testid and only the localized aria-label.
    elements.push(...safeReturn(() => Array.from(document.querySelectorAll(
      "[data-testid='now-playing-bar'] .main-genericButton-button, " +
      ".Root__now-playing-bar .main-genericButton-button, " +
      ".main-nowPlayingBar-container .main-genericButton-button"
    )), []));
    elements.push(...safeReturn(() => Array.from(document.querySelectorAll(DEVICE_PICKER_SCAN_SELECTOR)), []));

    return uniqueElements(elements)
      .map((el) => ({ el, score: scoreDevicePickerCandidate(el) }))
      .filter((item) => item.score >= 20)
      .sort((a, b) => b.score - a.score);
  }

  function activateDevicePickerCandidate(el) {
    if (!el || typeof el.click !== "function") return false;
    safe(() => el.focus && el.focus({ preventScroll: true }));
    const eventOptions = { bubbles: true, cancelable: true, composed: true, view: window };
    ["pointerdown", "mousedown", "pointerup", "mouseup"].forEach((type) => {
      const EventCtor = type.indexOf("pointer") === 0 && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      safe(() => el.dispatchEvent(new EventCtor(type, eventOptions)));
    });
    el.click();
    return true;
  }

  function tryOpenDevicePicker() {
    const candidate = findDevicePickerCandidates()[0];
    if (!candidate) return false;
    window.__PVFD_LAST_DEVICE_PICKER_TARGET__ = {
      score: candidate.score,
      target: pvfdButtonDescriptor(candidate.el)
    };
    return activateDevicePickerCandidate(candidate.el);
  }

  function diagnoseDevicePickerTargets(limit = 12) {
    const candidates = findDevicePickerCandidates().slice(0, limit).map((candidate) => ({
      score: candidate.score,
      ...pvfdButtonDescriptor(candidate.el)
    }));
    if (console.table) console.table(candidates);
    else console.log("[PVFD] device picker candidates", candidates);

    // Locale/version drift dump: every button in the now-playing bar with its
    // identifying attributes, regardless of score. Lets users (or me) read off
    // what their Spotify build is actually rendering even when 0 candidates score.
    const allButtons = safeReturn(() => Array.from(document.querySelectorAll(
      "[data-testid='now-playing-bar'] button, " +
      ".Root__now-playing-bar button, " +
      ".main-nowPlayingBar-container button"
    )), []);
    const buttonDump = allButtons
      .filter((el) => !el.closest || !el.closest(".pvfd-chassis"))
      .map((el) => {
        const desc = pvfdButtonDescriptor(el) || {};
        const className = String((el && el.className && el.className.baseVal) || el.className || "");
        return {
          testid: desc.testid || "",
          aria: desc.aria || "",
          title: desc.title || "",
          tippy: safeReturn(() => el.getAttribute("data-tippy-content"), "") || "",
          rfk: safeReturn(() => el.getAttribute("data-restore-focus-key"), "") || "",
          disabled: desc.disabled,
          generic: /\bmain-genericButton-button\b/.test(className),
          score: scoreDevicePickerCandidate(el)
        };
      });
    if (console.table) console.table(buttonDump);
    else console.log("[PVFD] now-playing-bar button dump", buttonDump);

    return candidates;
  }

  function pushSpotifyPath(path) {
    const history = Spicetify.Platform && Spicetify.Platform.History;
    if (history && typeof history.push === "function") {
      history.push(path);
      return true;
    }
    const app = Spicetify.Platform && Spicetify.Platform.Application;
    if (app && typeof app.navigate === "function") {
      app.navigate(path);
      return true;
    }
    return false;
  }

  function routeFromSpotifyUri(uri) {
    const parts = String(uri || "").split(":");
    if (parts[0] !== "spotify" || !parts[1] || !parts[2]) return "";
    if (!/^(album|artist|playlist|show|episode|track)$/.test(parts[1])) return "";
    return `/${parts[1]}/${parts[2]}`;
  }

  function findSpotifyNowPlayingContextTarget() {
    const selectors = [
      "[data-testid='now-playing-widget'] [data-testid='cover-art-button']",
      "[data-testid='now-playing-bar'] [data-testid='cover-art-button']",
      ".Root__now-playing-bar [data-testid='cover-art-button']",
      ".main-nowPlayingBar-container [data-testid='cover-art-button']",
      "[data-testid='now-playing-widget'] button"
    ];
    for (const selector of selectors) {
      const candidates = safeReturn(() => Array.from(document.querySelectorAll(selector)), []);
      const target = candidates.find((candidate) => !candidate.closest || !candidate.closest(".pvfd-chassis"));
      if (target) return target;
    }
    return null;
  }

  function openSpotifyNowPlayingContextMenu(sourceEvent = null) {
    const target = findSpotifyNowPlayingContextTarget();
    if (!target) return false;
    let clientX = Number.isFinite(sourceEvent && sourceEvent.clientX) ? sourceEvent.clientX : null;
    let clientY = Number.isFinite(sourceEvent && sourceEvent.clientY) ? sourceEvent.clientY : null;
    if (clientX === null || clientY === null) {
      const rect = target.getBoundingClientRect();
      clientX = rect.left + rect.width / 2;
      clientY = rect.top + rect.height / 2;
    }
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 2,
      buttons: 2,
      clientX,
      clientY
    }));
    return true;
  }

  function openPlaybackSource() {
    const item = safeReturn(() => Spicetify.Player.data && Spicetify.Player.data.item, null);
    const route = item && routeFromSpotifyUri(item.uri || item.link);
    if (route && safeReturn(() => pushSpotifyPath(route), false)) return true;
    return clickFirst([
      "[data-testid='now-playing-widget']",
      "[class*='nowPlayingWidget']",
      "[aria-label*='Now playing' i]"
    ]);
  }

  function openLibrarySource() {
    return safeReturn(() => pushSpotifyPath("/collection/playlists"), false) || clickFirst([
      "a[href='/collection']",
      "a[href='/collection/playlists']",
      "[aria-label='Your Library']",
      "[aria-label*='Your Library' i]"
    ]);
  }

  function openSearchSource() {
    return safeReturn(() => pushSpotifyPath("/search"), false) || clickFirst([
      "a[href='/search']",
      "[aria-label='Search']",
      "[aria-label*='Search' i]"
    ]);
  }

  function openHomeSource() {
    return safeReturn(() => pushSpotifyPath("/"), false) || clickFirst([
      "a[href='/']",
      "a[href='/home']",
      "[aria-label='Home']",
      "[aria-label*='Home' i]"
    ]);
  }

  function openQueueSource() {
    return safeReturn(() => pushSpotifyPath("/queue"), false) || clickFirst([
      "[data-testid='control-button-queue']",
      "button[aria-label*='Queue' i]"
    ]);
  }

  function openDevicePicker() {
    if (tryOpenDevicePicker()) return true;

    window.setTimeout(() => {
      if (tryOpenDevicePicker()) return;
      window.setTimeout(() => {
        if (tryOpenDevicePicker()) return;
        const candidates = diagnoseDevicePickerTargets(8);
        notifyPvfd(`DEV: Spotify device picker not found. Diagnostics found ${candidates.length} candidate(s).`);
      }, 240);
    }, 90);

    return false;
  }

  // Progressive-lag investigation: knob/scrubber drag + EJECT standby text
  // get choppy after ~1 min of use, persists across window close (Windows
  // tray keeps the JS context alive), clears only on `spicetify apply`.
  // Run diagnosePerf() at fresh launch, use Spotify for ~90s, run again,
  // diff. Anything growing faster than uptime is the leak.
  function diagnosePerf() {
    const uptimeSec = (Date.now() - pvfdDiag.bootAt) / 1000;
    const safeRate = (n) => (uptimeSec > 0 ? +(n / uptimeSec).toFixed(3) : 0);
    const snapshot = {
      uptime_s: +uptimeSec.toFixed(1),

      // Should each be 1 across the entire session. >1 means we are
      // duplicating init paths — re-bound listeners, multiple rAF loops,
      // multiple MutationObservers all firing on every Spotify DOM mutation.
      injectChassis_calls: pvfdDiag.injectChassisCalls,
      wireControls_calls: pvfdDiag.wireControlsCalls,
      attachUnsafe_calls: pvfdDiag.attachUnsafeCalls,
      mutationObservers_created: pvfdDiag.mutationObserversCreated,
      recover_fatals: pvfdDiag.recoverFatals,

      // Rate-based. If mutation_flushes_per_sec climbs over the session,
      // Spotify's DOM churn is growing AND we are processing it all
      // synchronously — top candidate for the progressive lag.
      loop_frames: pvfdDiag.loopFrames,
      loop_fps_avg: safeRate(pvfdDiag.loopFrames),
      mutation_queues: pvfdDiag.mutationQueues,
      mutation_queues_per_sec: safeRate(pvfdDiag.mutationQueues),
      mutation_flushes: pvfdDiag.mutationFlushes,
      mutation_flushes_per_sec: safeRate(pvfdDiag.mutationFlushes),

      pending_mutation_work: { ...pvfdMutationWork },

      // Each entry is total addEventListener calls on that element since
      // boot. If wireControls ever ran twice on the same DOM node, these
      // are 2x their fresh-launch values and every pointer event during
      // drag is dispatching through duplicated handlers.
      listeners_added: { ...pvfdDiag.listenersAdded },
      // Bubble-block hit count. >0 confirms the new block is wired. If you
      // run a 3-sec drag with active mouse movement this should land in the
      // hundreds (one per pointermove). 0 means installation failed.
      pointer_bubble_blocks: pvfdDiag.pointerBubbleBlocks,
      pointer_bubble_blocks_per_sec: safeRate(pvfdDiag.pointerBubbleBlocks),

      active_intervals: {
        bandTuning: !!bandTuningInterval,
        lyricsProgress: !!pvfdLyricsProgressTimer,
      },
      active_timeouts: {
        mutation: !!pvfdMutationTimer,
        mutationFlush: !!pvfdMutationFlushTimer,
        volumeCommit: !!volumeCommitTimer,
        ejectFinish: !!ejectFinishTimer,
        ejectBlanked: !!ejectBlankedTimer,
        librarySearchFix: !!librarySearchFixTimer,
        lyricsSyncFix: !!lyricsSyncFixTimer,
        globalSearchFocus: !!globalSearchFocusTimer,
        pvfdCinemaTransition: !!pvfdCinemaTransitionTimer,
        specialProfileCheck: !!pvfdSpecialProfileCheckTimer,
        specialProfileHearts: !!pvfdSpecialProfileHeartsTimer,
        logoLiveAudioResume: !!logoLiveAudioResumeTimer,
      },
      active_rafs: {
        metaTrackRepaint: !!metaTrackRepaintRaf,
        canvasResize: !!canvasResizeRaf,
        standby: !!standbyRafId,
        logoLiveAudioScheduler: !!logoLiveAudioSchedulerRaf,
      },

      chassis_connected: !!(chassis && chassis.isConnected),
      // Identity changes if chassis was rebuilt mid-session. Compare
      // across runs — if it shifts, injectChassis ran and DOM listeners
      // on the old nodes are orphaned but the per-element instrumentation
      // counters above will tell you whether wireControls re-ran too.
      chassis_id: chassis ? (chassis.dataset.pvfdInstance || "unset") : null,
    };
    try { console.table(snapshot); } catch (_e) { console.log(snapshot); }
    return snapshot;
  }

  const pioneerVfdDebugApi = typeof window.PioneerVFD === "object" && window.PioneerVFD ? window.PioneerVFD : {};
  pioneerVfdDebugApi.openDevicePicker = openDevicePicker;
  pioneerVfdDebugApi.diagnoseDevicePicker = diagnoseDevicePickerTargets;
  pioneerVfdDebugApi.diagnosePerf = diagnosePerf;
  pioneerVfdDebugApi._diag = pvfdDiag;
  window.PioneerVFD = pioneerVfdDebugApi;

  // EJECT button — formerly OPEN (GitHub issue #8: OPEN had no handler).
  // Plays a 3.9s in-VFD easter egg (matches one full loop of the vault-boy
  // gif), then intializes standby mode. The webm OEL animation is
  // paused for the duration and resumed automatically; tint filter on
  // .pvfd-lcd cascades to the overlay so vault-boy tints with the chassis.
  // EJECT — hot-swaps the main OEL <video class="pvfd-lcd-video"> src to
  // EJECTING.webm for the easter-egg sequence, then transitions all
  // LCDs into a "blanked" state (sweeping tint scan-line followed by
  // total darkness). Any user input restores everything.
  //
  // Spotify desktop's window minimize is not reachable from renderer
  // JS in this build (OS-rendered title bar, no Platform API), so we
  // do a thematic on-chassis blackout instead.
  const EJECT_WEBM_FILENAME = "EJECTING.webm";
  const EJECT_SEQUENCE_MS = 3900;
  const EJECT_BLANK_TRANSITION_MS = 700;
  // ejectInFlight covers the *entire* easter-egg lifecycle: from click
  // through webm playback, blanking transition, blanked hold, and up
  // until a wake-input fires. The EJECT button click handler bails on
  // this flag, so re-clicking during any phase is a no-op.
  let ejectInFlight = false;
  let ejectFinishTimer = 0;
  let ejectBlankActive = false;
  let ejectSavedSrc = "";
  let ejectSavedClipKey = "";
  // Captures Spotify's playback state at click-time so wake can put
  // playback back to exactly where the user left it.
  let ejectSavedWasPlaying = false;
  // Page-level blackout overlay (single fullscreen div mounted to body).
  // Created lazily on first eject, removed on wake.
  let pageBlanket = null;
  // Pending timer that promotes blanking → blanked. We hold the handle
  // so wake can cancel it; otherwise it races wake and re-imposes the
  // blanked state after wake has already started restoring.
  let ejectBlankedTimer = 0;
  // Tracks whether the input-filter listeners are attached. They stay
  // armed for the entire eject lifecycle (blanking → blanked →
  // restoring) so every input during that window is filtered, not just
  // the first one — otherwise post-mousedown click events leak through
  // to Spotify's content handlers.
  let ejectListenersAttached = false;

  // Spotify shell containers that should each get their own scan-line
  // strip during the page-level blackout. Probed in order; missing ones
  // are skipped without affecting the backdrop.
  const EJECT_PANEL_SELECTORS = [
    ".Root__nav-bar",                       // left library/nav column
    ".Root__main-view",                     // central content area
    ".Root__right-sidebar",                 // right sidebar (newer Spotify)
    "aside[aria-label='Now playing view']", // right sidebar fallback
    ".Root__top-bar",                       // top global nav (older builds)
    ".main-globalNav-container",            // top global nav (newer builds)
  ];

  function ensurePageBlanket() {
    if (pageBlanket && pageBlanket.isConnected) return;
    pageBlanket = document.createElement("div");
    pageBlanket.className = "pvfd-page-blanket";
    pageBlanket.setAttribute("aria-hidden", "true");

    // Mount the backdrop as a SIBLING of the now-playing-bar (which is
    // where the chassis lives). This puts them in the same stacking
    // context so the chassis's z:1000 actually paints above the
    // backdrop's z:999. If we appended to <body> instead, the chassis
    // would be inside Spotify's Root subtree at a lower body-level
    // stacking position than the backdrop, and the chassis would
    // disappear behind the blackout.
    const npb = document.querySelector(".Root__now-playing-bar") ||
                document.querySelector("[data-testid='now-playing-bar']");
    if (npb && npb.parentNode) {
      npb.parentNode.insertBefore(pageBlanket, npb);
    } else {
      // Fallback: still attach somewhere so the feature degrades to
      // "backdrop visible, chassis might be covered" rather than
      // "feature absent." Better to have the easter egg work
      // imperfectly than not at all.
      document.body.appendChild(pageBlanket);
    }
  }

  function spawnPanelScanlines(direction = "down") {
    // Strip everything from prior runs first — defensive against a race
    // where wake teardown didn't fire (e.g., chassis got re-mounted
    // mid-sequence). Also called when reversing direction for the
    // restore sweep — we want a clean slate before adding new strips
    // with the reverse animation.
    document.querySelectorAll(".pvfd-panel-scanline").forEach((el) => el.remove());

    // Panel rects often extend down to the top of the now-playing-bar,
    // but the chassis visually starts ABOVE that (the meta-LCD strip
    // sits above the playbar's top edge). Clamp every scan-line's travel
    // bottom to the chassis's real top so the sweep lands exactly at the
    // chassis edge instead of bleeding into the chassis chrome.
    const chassisRect = chassis ? chassis.getBoundingClientRect() : null;
    const chassisTop = chassisRect ? chassisRect.top : Infinity;

    for (const sel of EJECT_PANEL_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // Skip panels that are collapsed/off-screen — no visual value in
      // sweeping a zero-size strip.
      if (rect.width < 8 || rect.height < 8) continue;

      // Travel = min(panel bottom, chassis top) − panel top. Anything
      // below the chassis top is the chassis's domain.
      const visibleBottom = Math.min(rect.top + rect.height, chassisTop);
      const travel = Math.max(0, visibleBottom - rect.top);
      if (travel < 8) continue;

      const strip = document.createElement("div");
      strip.className = "pvfd-panel-scanline";
      if (direction === "up") strip.classList.add("pvfd-panel-scanline--reverse");
      strip.setAttribute("aria-hidden", "true");
      strip.style.left = rect.left + "px";
      strip.style.width = rect.width + "px";
      strip.style.setProperty("--pvfd-panel-top", rect.top + "px");
      strip.style.setProperty("--pvfd-panel-h", travel + "px");
      document.body.appendChild(strip);
    }
  }

  function tearDownPageBlanket() {
    if (pageBlanket) {
      pageBlanket.remove();
      pageBlanket = null;
    }
    document.querySelectorAll(".pvfd-panel-scanline").forEach((el) => el.remove());
    hideStandby();
  }

  // "STANDING BY..." indicator that appears centered on the dark LCD
  // once the scan-line has finished its travel. Two effects layered:
  //   1) A left-to-right character-shuffle reveal (à la "Flibbertigibbeting…")
  //   2) After the reveal locks, a CSS chromatic-aberration glitch whose
  //      offset colors are derived from var(--pvfd-cyan) via hue-rotate
  //      filters — so the split colors always track the active chassis tint.
  const STANDBY_TEXT = "STANDING BY...";
  const STANDBY_SHUFFLE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*<>/\\";
  const STANDBY_LOCK_STAGGER_MS = 60;
  const STANDBY_LOCK_DURATION_MS = 280;
  let standbyEl = null;
  let standbyRafId = 0;

  function showStandby() {
    if (standbyEl) return;
    // Mount inside the page blanket so it shares the blanket's stacking
    // context (z:999) — meaning the chassis (z:1000) still paints above
    // it. If the blanket failed to mount for some reason, fall back to
    // body and accept that the chassis layering may be imperfect.
    const host = pageBlanket && pageBlanket.isConnected ? pageBlanket : document.body;
    standbyEl = document.createElement("div");
    standbyEl.className = "pvfd-standby";
    standbyEl.setAttribute("aria-hidden", "true");
    standbyEl.setAttribute("data-text", "");
    standbyEl.textContent = "";
    host.appendChild(standbyEl);
    startStandbyShuffle();
  }

  function startStandbyShuffle() {
    if (!standbyEl) return;
    const target = STANDBY_TEXT;
    const startMs = performance.now();
    // Characters we preserve verbatim (don't shuffle through random
    // alpha-numeric for these — keeps the lock-in feeling deliberate).
    const PRESERVE = new Set([" ", ".", ":", "/", "-"]);

    function tick() {
      if (!standbyEl) return;
      const elapsed = performance.now() - startMs;
      let out = "";
      let allLocked = true;
      for (let i = 0; i < target.length; i++) {
        const startAt = i * STANDBY_LOCK_STAGGER_MS;
        const lockAt = startAt + STANDBY_LOCK_DURATION_MS;
        if (elapsed < startAt) {
          out += " ";
          allLocked = false;
        } else if (elapsed >= lockAt) {
          out += target[i];
        } else {
          const c = target[i];
          if (PRESERVE.has(c)) {
            out += c;
          } else {
            out += STANDBY_SHUFFLE_CHARSET[
              Math.floor(Math.random() * STANDBY_SHUFFLE_CHARSET.length)
            ];
          }
          allLocked = false;
        }
      }
      standbyEl.textContent = out;
      // data-text feeds the glitch ::before/::after pseudo elements
      // so they stay in sync with the visible text during the shuffle.
      standbyEl.setAttribute("data-text", out);
      if (!allLocked) {
        standbyRafId = requestAnimationFrame(tick);
      } else {
        standbyEl.textContent = target;
        standbyEl.setAttribute("data-text", target);
        // Switching on the glitch class only after the shuffle has
        // resolved keeps the chromatic-aberration effect from
        // distracting during the reveal.
        standbyEl.classList.add("pvfd-standby--glitch");
      }
    }
    standbyRafId = requestAnimationFrame(tick);
  }

  function hideStandby() {
    if (standbyRafId) {
      cancelAnimationFrame(standbyRafId);
      standbyRafId = 0;
    }
    if (standbyEl) {
      standbyEl.remove();
      standbyEl = null;
    }
  }

  function resolveEjectWebmUrl() {
    // Reuses the OEL pipeline: cache populator pre-resolves EJECTING.webm
    // into oelWebmSourceMap (blob: URL once cached, gh-pages URL until
    // the cache fills). resolveOelWebmSourceMap() ensures the populator
    // has been kicked off.
    const map = resolveOelWebmSourceMap();
    const url = map && map[EJECT_WEBM_FILENAME];
    return url || (OEL_WEBM_GITHUB_BASE + EJECT_WEBM_FILENAME);
  }

  function startEjectSequence() {
    if (ejectInFlight) return;
    if (!chassis) return;

    const dom = getPvfdDom();
    const video = dom.lcdVideo;
    if (!video) {
      console.warn("[PVFD-EJECT] LCD video element not found");
      return;
    }

    ejectInFlight = true;

    // Eject cancels BAND too — fm audio is "media" by the same metaphor.
    if (bandPresetIdx >= 0) {
      bandPresetIdx = -1;
      applyBandPreset(true, false);
    }

    // Capture Spotify playback state and pause it. The easter egg is
    // "ejecting media," so playback halting matches the metaphor; wake
    // restores whatever state the user was in pre-eject (was-playing →
    // play; was-paused → stay paused).
    ejectSavedWasPlaying = false;
    safe(() => {
      ejectSavedWasPlaying = !!(Spicetify.Player && Spicetify.Player.isPlaying && Spicetify.Player.isPlaying());
      if (ejectSavedWasPlaying) Spicetify.Player.pause();
    });

    ejectSavedSrc = video.getAttribute("src") || "";
    ejectSavedClipKey = video.dataset.pvfdClipKey || "";

    const url = resolveEjectWebmUrl();
    console.warn(`[PVFD-EJECT] start: webm url="${url}" (from OEL cache pipeline)`);

    video.dataset.pvfdEjectActive = "1";
    delete video.dataset.pvfdClipKey;
    video.loop = false;
    video.src = url;
    safe(() => { video.currentTime = 0; });
    safe(() => video.load());
    safe(() => video.play());

    // Publish the active tint's hue-rotate amount as a CSS var so the
    // eject filter chain can apply it directly to the video.
    const ejectDeg = (typeof TINT_HUE_DEG !== "undefined" && TINT_HUE_DEG[tintIdx]) || 0;
    chassis.style.setProperty("--pvfd-eject-tint-deg", ejectDeg + "deg");

    chassis.setAttribute("data-pvfd-state", "ejecting");

    if (ejectFinishTimer) {
      window.clearTimeout(ejectFinishTimer);
      ejectFinishTimer = 0;
    }
    ejectFinishTimer = window.setTimeout(() => {
      ejectFinishTimer = 0;
      finishEjectSequence();
    }, EJECT_SEQUENCE_MS);
  }

  function finishEjectSequence() {
    if (!chassis) { ejectInFlight = false; return; }

    // Transition: ejecting → blanking. Keep tint-deg around for the
    // scan-line color. The CSS @keyframes for the scan-line runs once
    // (EJECT_BLANK_TRANSITION_MS); after that the LCDs stay black via
    // the data-pvfd-state="blanked" rules.
    chassis.setAttribute("data-pvfd-state", "blanking");

    // Mirror onto <html> so page-level CSS scopes (html[data-pvfd-state=…])
    // can target the Spotify shell containers without touching their
    // markup. The mirror is removed in wakeFromEjectBlank.
    document.documentElement.setAttribute("data-pvfd-state", "blanking");

    // Page-level blackout: full-viewport backdrop fades --pvfd-lcd-void → #000,
    // and per-panel scan-line strips sweep through each major Spotify
    // shell region (left nav, main view, right sidebar, top nav).
    ensurePageBlanket();
    spawnPanelScanlines();

    const dom = getPvfdDom();
    const video = dom.lcdVideo;
    if (video) {
      delete video.dataset.pvfdEjectActive;
      video.loop = true;
      safe(() => video.pause());
    }

    // Arm wake listeners NOW — at the start of the blanking phase —
    // so any click/key during the 700ms transition also restores
    // (closes the previous race where clicks landed in the gap).
    // ejectInFlight stays true until wake fires, keeping the EJECT
    // button a no-op for the whole window.
    armEjectWakeListeners();

    // After the scan-line animation completes, settle into "blanked"
    // and reveal the STANDING BY indicator. The shuffle reveal kicks
    // off here — strictly AFTER the sweep has finished traversing.
    // Hold the handle in ejectBlankedTimer so wake can cancel this
    // if the user wakes during the blanking transition (otherwise the
    // timer keeps running and re-imposes blanked state on top of a
    // wake-in-progress).
    if (ejectBlankedTimer) {
      window.clearTimeout(ejectBlankedTimer);
      ejectBlankedTimer = 0;
    }
    ejectBlankedTimer = window.setTimeout(() => {
      ejectBlankedTimer = 0;
      if (!chassis) return;
      // Defensive: if a wake fired during the transition, ejectBlankActive
      // is false and we should NOT re-blank. (The timer cancellation in
      // wakeFromEjectBlank should normally catch this, but a race window
      // between the clearTimeout and a scheduled fire is possible.)
      if (!ejectBlankActive) return;
      chassis.setAttribute("data-pvfd-state", "blanked");
      document.documentElement.setAttribute("data-pvfd-state", "blanked");
      showStandby();
    }, EJECT_BLANK_TRANSITION_MS);
  }

  // Event names the filter cares about. `click` must be in here too —
  // mousedown/pointerdown fire FIRST and we stop them, but the `click`
  // event is a separate event that fires later and would otherwise
  // reach Spotify's song-row / playlist handlers and trigger playback.
  const EJECT_WAKE_EVENTS = ["keydown", "pointerdown", "mousedown", "click", "wheel"];

  function armEjectWakeListeners() {
    if (ejectBlankActive) return;
    ejectBlankActive = true;
    console.warn("[PVFD-EJECT] blanked. Press any key or click anywhere to restore.");
    attachEjectInputFilter();
    attachEjectPlayerBackstop();
  }

  // Spicetify.Player event backstop: catches state changes that
  // bypass our keyboard listeners. Spotify's xpui registers keyboard
  // shortcut handlers during init (long before this extension loads)
  // and at least some of them call stopImmediatePropagation at a level
  // above our window/document capture listeners — meaning our keydown
  // handler never fires for Space, etc., even though we registered at
  // capture phase. We can't beat their registration timing for direct
  // event capture, so we listen for the *downstream effect* instead:
  // when Spotify's handler toggles playback or switches tracks, the
  // Player fires its own events and we wake from those.
  function playerWakeBackstop() {
    if (!ejectBlankActive) return;
    // Synthesize a wake. event=null means we have no propagation to
    // stop (Spotify's action already happened) and no classification
    // to do — treat it as a passive "something happened" wake.
    wakeFromEjectBlank(null);
  }

  function attachEjectPlayerBackstop() {
    const player = window.Spicetify && Spicetify.Player;
    if (!player || typeof player.addEventListener !== "function") return;
    safe(() => player.addEventListener("onplaypause", playerWakeBackstop));
    safe(() => player.addEventListener("songchange", playerWakeBackstop));
  }

  function detachEjectPlayerBackstop() {
    const player = window.Spicetify && Spicetify.Player;
    if (!player || typeof player.removeEventListener !== "function") return;
    safe(() => player.removeEventListener("onplaypause", playerWakeBackstop));
    safe(() => player.removeEventListener("songchange", playerWakeBackstop));
  }

  function attachEjectInputFilter() {
    if (ejectListenersAttached) return;
    ejectListenersAttached = true;
    // Listen at BOTH window-capture and document-capture so we fire
    // before Spotify's keyboard handlers wherever they're attached.
    // Window-capture fires earliest in the capture phase; document is
    // a fallback in case Spotify's stopImmediatePropagation runs there.
    for (const target of [window, document]) {
      for (const name of EJECT_WAKE_EVENTS) {
        target.addEventListener(name, wakeFromEjectBlank, {
          capture: true,
          passive: name === "wheel",
        });
      }
    }
  }

  function detachEjectInputFilter() {
    if (!ejectListenersAttached) return;
    ejectListenersAttached = false;
    for (const target of [window, document]) {
      for (const name of EJECT_WAKE_EVENTS) {
        target.removeEventListener(name, wakeFromEjectBlank, { capture: true });
      }
    }
  }

  // Wake is a 2-stage sequence so the restore feels cinematic instead
  // of snapping:
  //   Stage 1 (this function) — fires on the first user input. Hides
  //     standby instantly, flips chassis + <html> to "restoring" state,
  //     re-spawns the panel scan-lines with reverse animation, and
  //     defers the real teardown by EJECT_BLANK_TRANSITION_MS so the
  //     reverse sweep + backdrop unfade can play out.
  //   Stage 2 (finishEjectRestore) — after the reverse sweep completes,
  //     this performs the actual restore: tear down the page blanket,
  //     resume playback, re-sync OEL, clear ejectInFlight.
  function wakeFromEjectBlank(event) {
    // Classify every event the filter sees, regardless of whether this
    // is the first one or a follow-up during the restoring transition.
    //
    //   - Keyboard: always deliberate. Allow propagation so Spotify
    //     shortcuts (Space, Ctrl+L, arrow keys) take effect.
    //   - Pointer / mouse / click / wheel INSIDE the chassis: chassis
    //     controls are visible above the blackout, so user intent is
    //     clear. Allow propagation so chassis handlers fire normally.
    //   - Everything else (events landing on Spotify content under the
    //     blanket): user can't see the target. Block propagation so
    //     they don't accidentally play a song or open a playlist.
    const isKeyboard = event && event.type === "keydown";
    const isChassisInput = !!(event && event.target && event.target.closest &&
                              event.target.closest(".pvfd-chassis"));
    const allowPropagate = isKeyboard || isChassisInput;

    if (!allowPropagate && event) {
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    }

    // Only the FIRST event during the standby window triggers wake.
    // Subsequent events during the 700ms restoring transition just
    // get filtered (so post-mousedown `click` doesn't leak through to
    // a Spotify song row, for example).
    if (!ejectBlankActive) return;
    ejectBlankActive = false;

    // Cancel the pending blanking → blanked transition. Without this
    // it would still fire and re-impose blanked state + recreate the
    // standby element AFTER wake had already removed them.
    if (ejectBlankedTimer) {
      window.clearTimeout(ejectBlankedTimer);
      ejectBlankedTimer = 0;
    }

    if (!chassis) {
      // Defensive: if the chassis is gone (rare race during a re-mount),
      // skip the cinematic phase and tear down hard.
      finishEjectRestore();
      return;
    }

    // STANDING BY disappears first.
    hideStandby();

    // Flip into restoring state. CSS keys off this:
    //   - Chassis LCD ::after pseudos run pvfd-eject-scanline-reverse
    //   - Chassis LCD backgrounds fade from #000 back to --pvfd-lcd-void
    //   - Page blanket fades from #000 back to transparent
    //   - Panel scan-lines re-spawned with reverse animation
    chassis.setAttribute("data-pvfd-state", "restoring");
    document.documentElement.setAttribute("data-pvfd-state", "restoring");
    spawnPanelScanlines("up");

    // After the reverse sweep finishes, do the real restore.
    window.setTimeout(finishEjectRestore, EJECT_BLANK_TRANSITION_MS);
  }

  function finishEjectRestore() {
    if (chassis) {
      chassis.removeAttribute("data-pvfd-state");
      chassis.style.removeProperty("--pvfd-eject-tint-deg");
    }

    document.documentElement.removeAttribute("data-pvfd-state");
    tearDownPageBlanket();
    // Filter listeners stay attached through the entire blanking →
    // blanked → restoring → cleared sequence. Detach them now that
    // we're fully cleared.
    detachEjectInputFilter();
    detachEjectPlayerBackstop();

    // Restore the pre-eject playback state — but ONLY if nothing
    // already kicked playback back on during the 700ms restoring
    // window. The user's wake input may have been a deliberate
    // play-toggle (Space, chassis play button click, etc.) that's
    // already started the music; firing play() again would either be
    // a no-op (best case) or a race against a user pause toggled in
    // the meantime (worst case). Reading isPlaying() at this point
    // gives us the post-user-action truth.
    if (ejectSavedWasPlaying) {
      safe(() => {
        const player = window.Spicetify && Spicetify.Player;
        const playing = !!(player && typeof player.isPlaying === "function" && player.isPlaying());
        if (!playing && player && typeof player.play === "function") {
          player.play();
        }
      });
    }

    ejectSavedSrc = "";
    ejectSavedClipKey = "";
    ejectSavedWasPlaying = false;

    // Re-issue OEL playback. force=true so the sync resets src + play
    // cleanly even though dataset state may already match.
    safe(() => syncOelVideoPlayback(true));
    safe(() => applyLcdFilter());

    // Now release the in-flight gate so EJECT can be re-armed.
    ejectInFlight = false;
    console.warn("[PVFD-EJECT] restored.");
  }

  // Silk Lyrics button: routes to / toggles Spotify native lyrics. Clicking
  // Spotify's own lyrics-button is a toggle (Show/Hide), so calling this
  // function while already on /lyrics closes the view back to the song.
  function openLyrics() {
    let opened = clickFirstOutsideChassis([
      "button[data-testid='lyrics-button']",
      "button[data-testid='control-button-lyrics']",
      "[data-testid='lyrics-button']",
      "[data-testid='control-button-lyrics']",
      "button[data-testid='lyrics-cta-button']",
      "button[aria-label='Lyrics']",
      "button[aria-label='Show lyrics']",
      "button[aria-label='Hide lyrics']",
      "button[aria-label*='Lyrics' i]",
      "[role='button'][aria-label*='Lyrics' i]"
    ]);
    if (!opened) opened = safeReturn(() => pushSpotifyPath("/lyrics"), false);
    const lyrics = chassis && chassis.querySelector("[data-pvfd='lyrics']");
    if (lyrics) {
      lyrics.classList.add("active");
      setTimeout(() => lyrics.classList.remove("active"), 850);
    }
    if (!opened) console.warn("[PVFD] lyrics control unavailable");
    return opened;
  }

  function cycleSource() {
    sourceIdx = (sourceIdx + 1) % SOURCE_TARGETS.length;
    const source = SOURCE_TARGETS[sourceIdx];
    const opened =
      source.kind === "playback" ? openPlaybackSource() :
      source.kind === "library" ? openLibrarySource() :
      source.kind === "search" ? openSearchSource() :
      source.kind === "home" ? openHomeSource() :
      source.kind === "queue" ? openQueueSource() :
      false;
    sourceFlashUntil = performance.now() + 1600;
    markStaticReadoutsDirty();
    window.setTimeout(markStaticReadoutsDirty, 1650);
    const srcBtn = chassis && chassis.querySelector("[data-pvfd='scan']");
    if (srcBtn) {
      srcBtn.classList.add("active");
      srcBtn.title = `Source: ${source.title}`;
      setTimeout(() => srcBtn.classList.remove("active"), 900);
    }
    if (!opened) console.warn("[PVFD] source navigation unavailable:", source.title);
    updateMenuPanel();
  }

  function setMenuOpen(next) {
    menuOpen = !!next;
    if (!chassis) return;
    chassis.classList.toggle("pvfd-menu-open", menuOpen);
    const panel = chassis.querySelector("[data-pvfd='menu-panel']");
    if (panel) panel.setAttribute("aria-hidden", menuOpen ? "false" : "true");
    const menuBtn = chassis.querySelector("[data-pvfd='menu']");
    if (menuBtn) menuBtn.classList.toggle("active", menuOpen);
    if (menuOpen && tintMenuOpen) setTintMenuOpen(false);
    if (!menuOpen) setCustomizeMenuView(false);
    updateMenuPanel();
  }

  // Pioneer Menu has two views: "main" and "customize". A single panel swaps
  // its body via data-view; the X in the header always closes the panel
  // entirely, BACK returns to main.
  function setCustomizeMenuView(next) {
    customizeMenuOpen = !!next;
    if (!chassis) return;
    const panel = chassis.querySelector("[data-pvfd='menu-panel']");
    const title = chassis.querySelector("[data-pvfd='menu-title']");
    const mainView = chassis.querySelector("[data-pvfd='menu-main']");
    const customizeView = chassis.querySelector("[data-pvfd='menu-customize']");
    if (panel) panel.setAttribute("data-view", customizeMenuOpen ? "customize" : "main");
    if (title) title.textContent = customizeMenuOpen ? "CUSTOMIZE MENU" : "PIONEER MENU";
    if (mainView) mainView.hidden = customizeMenuOpen;
    if (customizeView) customizeView.hidden = !customizeMenuOpen;
  }

  function setTintMenuOpen(next) {
    tintMenuOpen = !!next;
    if (!chassis) return;
    chassis.classList.toggle("pvfd-tint-menu-open", tintMenuOpen);
    const panel = chassis.querySelector("[data-pvfd='tint-menu-panel']");
    if (panel) panel.setAttribute("aria-hidden", tintMenuOpen ? "false" : "true");
    if (tintMenuOpen && menuOpen) setMenuOpen(false);
    refreshTintMenuSelection();
  }

  function openTintMenu() {
    setTintMenuOpen(true);
  }

  function refreshTintMenuSelection() {
    if (!chassis) return;
    chassis.querySelectorAll(".pvfd-tint-swatch").forEach((sw) => {
      const idx = Number(sw.dataset.pvfdTintIdx);
      sw.classList.toggle("active", idx === tintIdx);
    });
  }

  function populateTintMenu() {
    if (!chassis) return;
    const grid = chassis.querySelector("[data-pvfd='tint-menu-grid']");
    if (!grid || grid.dataset.pvfdPopulated === "1") return;
    grid.innerHTML = TINT_LABELS.map((label, idx) => {
      const name = mapTintNameForCss(idx);
      return `<button class="pvfd-tint-swatch" type="button" data-pvfd-tint-idx="${idx}" data-pvfd-tint-name="${name}" title="Set tint: ${label}" aria-label="Set tint: ${label}"><span class="pvfd-tint-swatch-color" data-pvfd-tint-name="${name}"></span><span class="pvfd-tint-swatch-label">${label}</span></button>`;
    }).join("");
    grid.dataset.pvfdPopulated = "1";
    grid.querySelectorAll(".pvfd-tint-swatch").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.dataset.pvfdTintIdx);
        if (Number.isInteger(idx) && idx >= 0 && idx < TINT_LABELS.length) {
          tintIdx = idx;
          applyTintMode(true);
          setTintMenuOpen(false);
        }
      });
    });
  }

  let pvfdDom = null;
  const playerStateCache = { at: -Infinity, playing: false, shuffle: false, repeat: "OFF" };
  const playerTimingCache = { at: -Infinity, progressMs: 0, durationMs: 0, playing: false };
  const volumeStateCache = { at: -Infinity, value: 0.5 };
  // ATT (Attenuator) state. Dedicated ATT pill on the chassis flank toggles
  // mute (volume → 0); pressing again restores the snapshotted prior volume.
  // Matches the real Pioneer DEH-P7600MP ATT button behavior — a rapid
  // single-button safety mute, not a long-press gesture.
  let attActive = false;
  let attPriorVolume = 0;
  let browseFontPresetKey = "";
  let staticReadoutsDirty = true;
  let knobLedDirty = true;

  function getPvfdDom() {
    if (!chassis) return {};
    if (pvfdDom && pvfdDom.chassis === chassis) return pvfdDom;
    pvfdDom = {
      chassis,
      menuPanel: chassis.querySelector("[data-pvfd='menu-panel']"),
      menuMain: chassis.querySelector("[data-pvfd='menu-main']"),
      menu: {
        oel: chassis.querySelector("[data-pvfd='menu-oel']"),
        demo: chassis.querySelector("[data-pvfd='menu-demo']"),
        tint: chassis.querySelector("[data-pvfd='menu-tint']"),
        type: chassis.querySelector("[data-pvfd='menu-type']"),
        lcdFont: chassis.querySelector("[data-pvfd='menu-lcd-font']"),
        perf: chassis.querySelector("[data-pvfd='menu-perf']"),
        logoGlow: chassis.querySelector("[data-pvfd='menu-logo-glow']"),
        oelDisplay: chassis.querySelector("[data-pvfd='menu-oel-display']"),
        racingColor: chassis.querySelector("[data-pvfd='menu-racing-color']"),
        chromeMode: chassis.querySelector("[data-pvfd='menu-chrome']"),
        logoStyle: chassis.querySelector("[data-pvfd='menu-logo-style']"),
        everScroll: chassis.querySelector("[data-pvfd='menu-ever-scroll']"),
        ledGlow: chassis.querySelector("[data-pvfd='menu-led-glow']"),
      },
      buttons: {
        lyrics: chassis.querySelector("[data-pvfd='lyrics']"),
        play: chassis.querySelector("[data-pvfd='play']"),
        shuffle: chassis.querySelector("[data-pvfd='shuffle']"),
        repeat: chassis.querySelector("[data-pvfd='repeat']"),
        demo: chassis.querySelector("[data-pvfd='demo']"),
        menu: chassis.querySelector("[data-pvfd='menu']"),
      },
      side: {
        vol: chassis.querySelector("[data-pvfd='side-vol']"),
        mode: chassis.querySelector("[data-pvfd='side-mode']"),
        tint: chassis.querySelector("[data-pvfd='side-tint']"),
        dim: chassis.querySelector("[data-pvfd='side-dim']"),
        ecoModel: chassis.querySelector("[data-pvfd='side-eco-model']"),
        prog: chassis.querySelector("[data-pvfd='side-prog']"),
        left: chassis.querySelector("[data-pvfd='side-left']"),
        repeat: chassis.querySelector("[data-pvfd='side-repeat']"),
        shuffle: chassis.querySelector("[data-pvfd='side-shuffle']"),
        status: chassis.querySelector("[data-pvfd='side-status']"),
        playbadge: chassis.querySelector("[data-pvfd='side-playbadge']"),
      },
      sideVu: Array.from(chassis.querySelectorAll("[data-pvfd='side-vu'] span")),
      meta: chassis.querySelector(".pvfd-meta-track"),
      metaGlyph: chassis.querySelector("[data-pvfd='meta-play-toggle']"),
      metaTitle: chassis.querySelector(".pvfd-meta-title-window"),
      metaInner: chassis.querySelector(".pvfd-meta-track-inner"),
      time: chassis.querySelector(".pvfd-meta-time"),
      progress: chassis.querySelector(".pvfd-meta-progress"),
      progressText: chassis.querySelector(".pvfd-progress-text"),
      lcd: chassis.querySelector(".pvfd-lcd"),
      lcdCanvas: chassis.querySelector(".pvfd-lcd-canvas"),
      lcdStatus: chassis.querySelector("[data-pvfd='lcd-status']"),
      lcdClock: chassis.querySelector("[data-pvfd='lcd-clock']"),
      lcdVideo: chassis.querySelector("[data-pvfd='lcd-video']"),
      lcdVideoProbe: chassis.querySelector("[data-pvfd='lcd-video-probe']"),
      knobArc: chassis.querySelector(".pvfd-knob-led-arc"),
      knobIndicator: chassis.querySelector(".pvfd-knob-indicator"),
    };
    return pvfdDom;
  }

  function setTextIfChanged(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  function setLcdCornerTextIfChanged(el, txt) {
    setTextIfChanged(el, txt);
    setAttrIfChanged(el, "data-pvfd-label", txt);
  }

  /* Ever Scroll plumbing.
     1. Writes the title into the inner span as plain title text. The playback
        glyph is a fixed sibling button so it can be clicked without joining
        the scroll animation or duplicated LOOP text.
     2. Measures whether that single-copy title overflows the visible window.
     3. If overflowing AND mode is LOOP, re-writes the inner as "TEXT  •  TEXT"
        so animating to -50% in CSS lands seamlessly on the second copy.
     4. If overflowing AND mode is ONCE or BOUNCE, computes the exact pixel
        scroll distance (textWidth - containerWidth) and sets it as a CSS
        custom property --pvfd-scroll-distance on the parent so the keyframe
        scrolls just enough to expose the last character at the right edge,
        not over-scroll past it.
     5. Stores label + playing in module state so applyEverScrollMode can
        re-paint without needing to call back into sync logic.
     6. On title change, force-restarts the animation so the new text plays
        from the start instead of picking up mid-cycle. */
  let pvfdLastMetaLabel = "";
  let pvfdLastMetaPlaying = true;
  let pvfdLastMetaText = "";
  /* Separator-width cache: the LOOP separator is a fixed string and its
     rendered width is invariant for a given font. Was previously measured
     on every setMetaTrackContent call, which forced a synchronous layout
     flush (3× DOM write + getBoundingClientRect on the mirror, each tick
     of the 1.7Hz player sync). That single call site was the dominant
     forced-reflow source per Performance recordings. Cache here, invalidate
     when the LCD font preset changes (see applyLcdFontPreset). */
  let pvfdCachedSepWidth = -1;
  let pvfdMetaMirror = null;

  /* Reusable off-screen mirror element for measuring the meta-track text
     width. Created once on first use and parked inside the meta track so it
     INHERITS font-family / font-size / letter-spacing / etc from the same CSS
     context as the real title — no need to copy computed styles every call.
     Reused across all measurement passes; never destroyed. */
  function getMetaMirror(dom) {
    if (!dom || !dom.meta) return null;
    if (!pvfdMetaMirror) {
      pvfdMetaMirror = document.createElement("span");
      const s = pvfdMetaMirror.style;
      s.position = "absolute";
      s.visibility = "hidden";
      s.pointerEvents = "none";
      s.top = "-9999px";
      s.left = "-9999px";
      s.whiteSpace = "nowrap";
      s.display = "inline-block";
      s.padding = "0";
      s.margin = "0";
      s.border = "0";
      pvfdMetaMirror.setAttribute("aria-hidden", "true");
      pvfdMetaMirror.dataset.pvfd = "meta-mirror";
    }
    if (pvfdMetaMirror.parentNode !== dom.meta) dom.meta.appendChild(pvfdMetaMirror);
    return pvfdMetaMirror;
  }

  /* Ever Scroll plumbing.
     1. Writes the title into the inner span as plain title text.
     2. Measures whether that single-copy title overflows the visible window.
     3. If overflowing AND mode is LOOP, re-writes the inner as "TEXT  •  TEXT"
        so animating to -50% in CSS lands seamlessly on the second copy.
     4. If overflowing AND mode is ONCE or BOUNCE, computes the exact pixel
        scroll distance (textWidth - containerWidth) and sets it as a CSS
        custom property --pvfd-scroll-distance on the parent so the keyframe
        scrolls just enough to expose the last character at the right edge,
        not over-scroll past it.
     5. Stores label + playing in module state so applyEverScrollMode can
        re-paint without needing to call back into sync logic.
     6. On title change, force-restarts the animation so the new text plays
        from the start instead of picking up mid-cycle.

     `force` parameter: callers that need to re-measure even when the label
     hasn't changed (mode change, font change, window resize) pass true.
     Otherwise the function early-exits when nothing relevant changed —
     critical for performance because syncCurrentTrackFromPlayer calls this
     ~1.7×/sec and the measurement triggers a forced layout. */
  function metaPlaybackGlyph(playing) {
    return playing ? PVFD_PLAY_GLYPH : PVFD_META_PAUSE_GLYPH;
  }

  function makeMetaSingleText(label) {
    return label;
  }

  function makeMetaFinalText(singleText, overflows) {
    return (overflows && everScrollMode === "LOOP")
      ? `${singleText}${EVER_SCROLL_LOOP_SEPARATOR}${singleText}${EVER_SCROLL_LOOP_SEPARATOR}`
      : singleText;
  }

  function updateMetaPlaybackGlyph(dom, playing) {
    if (!dom || !dom.metaGlyph) return;
    const glyph = metaPlaybackGlyph(playing);
    setTextIfChanged(dom.metaGlyph, glyph);
    dom.metaGlyph.classList.toggle("playing", !!playing);
    dom.metaGlyph.classList.toggle("paused", !playing);
    setAttrIfChanged(dom.metaGlyph, "title", playing ? "Pause" : "Play");
    setAttrIfChanged(dom.metaGlyph, "aria-label", playing ? "Pause" : "Play");
    setAttrIfChanged(dom.metaGlyph, "aria-pressed", playing ? "true" : "false");
  }

  function setMetaTrackContent(label, playing, force = false) {
    const dom = getPvfdDom();
    if (!dom || !dom.meta || !dom.metaInner) return;
    const labelChanged = pvfdLastMetaLabel !== label;
    const playingChanged = pvfdLastMetaPlaying !== playing;
    pvfdLastMetaLabel = label;
    pvfdLastMetaPlaying = playing;
    updateMetaPlaybackGlyph(dom, playing);

    if (!force && playingChanged && !labelChanged) {
      return;
    }

    /* Fast path: nothing relevant changed and the caller didn't force a
       re-measure. Skip the entire write + measurement + animation-restart
       pipeline. This is the main lag fix — was previously re-measuring
       and creating/destroying a mirror DOM element on every sync tick. */
    if (!force && !labelChanged && !playingChanged) return;

    const singleText = makeMetaSingleText(label);

    /* Measure on the off-screen mirror only — never touch the visible inner
       span for measurement. The mirror always holds singleText (one copy);
       the visible inner holds either singleText or the LOOP duplicate. This
       avoids the previous flash bug where writing singleText to the inner
       before duplicating it caused a one-frame visible snap when force-mode
       remeasures hit during the animation cycle. */
    const titleViewport = dom.metaTitle || dom.meta;
    const containerWidth = titleViewport.clientWidth;
    let singleTextWidth = 0;
    const mirror = getMetaMirror(dom);
    if (mirror) {
      mirror.textContent = singleText;
      singleTextWidth = mirror.getBoundingClientRect().width;
    } else {
      /* Fallback if mirror creation failed: write to inner once and measure,
         accepting the flash risk in this degenerate path. */
      dom.metaInner.textContent = singleText;
      singleTextWidth = dom.metaInner.scrollWidth || titleViewport.scrollWidth;
    }
    const overflows = singleTextWidth > containerWidth + 1;
    /* End-guard — stop scrolling N px short of flush-right so the last
       character (plus its text-shadow halo) clears the title window's
       overflow:hidden clip edge. Without this, BOUNCE/ONCE park the final
       glyph touching the right wall and it reads as clipped. */
    const SCROLL_END_GUARD_PX = 6;
    const scrollDistance = overflows
      ? Math.max(0, singleTextWidth - containerWidth + SCROLL_END_GUARD_PX)
      : 0;

    /* Compute the FINAL text once, based on mode + overflow status. For
       LOOP, duplicate as `(text + sep) + (text + sep)` — the trailing
       separator after the second copy is critical for seamless wraparound.
       Total width = 2 × (textW + sepW), so translateX(-50%) translates by
       exactly one (textW + sepW) unit, landing the visible window on the
       start of the second copy. Without the trailing separator,
       translateX(-50%) would land halfway through the separator and cause
       a visible jump at the wrap point. */
    const finalText = makeMetaFinalText(singleText, overflows);

    /* Single write to the visible inner span — no intermediate state, so no
       chance of the user seeing singleText flash before duplication. */
    if (dom.metaInner.textContent !== finalText) {
      dom.metaInner.textContent = finalText;
    }

    setAttrIfChanged(dom.meta, "data-pvfd-overflow", overflows ? "yes" : "no");
    if (overflows) {
      dom.meta.style.setProperty("--pvfd-scroll-distance", `-${scrollDistance}px`);
      /* Distance-proportional duration so long titles don't blur past at
         freight-train speed. Target ~40 px/sec scroll speed (Pioneer-authentic
         VFD pacing). Floor/ceiling clamps keep edge cases sane. ONCE/BOUNCE
         travel scrollDistance; LOOP travels (textW + sepW) since the keyframe
         is translateX(-50%) on the duplicated content. Mode-change CSS
         keyframe swap auto-restarts the animation. Separator width is
         measured on the same mirror as singleText, then restored so the
         mirror keeps singleText for future width comparisons. */
      const PX_PER_SEC = 25;
      /* ONCE and BOUNCE both travel scrollDistance twice (out + back) in
         their keyframes; multiply one-way time by 2 then by 1.15 for the
         hold pads at start/middle/end so net travel speed stays ~25 px/sec. */
      const oneWay = Math.max(3, scrollDistance / PX_PER_SEC);
      const roundTrip = oneWay * 2 * 1.15;
      dom.meta.style.setProperty("--pvfd-scroll-duration-once", `${roundTrip.toFixed(2)}s`);
      dom.meta.style.setProperty("--pvfd-scroll-duration-bounce", `${roundTrip.toFixed(2)}s`);
      /* Use cached separator width — invalidated on font preset change.
         Measuring fresh here would force a layout flush on every player
         sync tick (~1.7Hz), which Performance recordings flagged as the
         dominant forced-reflow source while Ever Scroll is animating. */
      if (pvfdCachedSepWidth < 0 && mirror) {
        mirror.textContent = EVER_SCROLL_LOOP_SEPARATOR;
        pvfdCachedSepWidth = mirror.getBoundingClientRect().width;
        mirror.textContent = singleText;
      }
      const loopTravel = singleTextWidth + Math.max(0, pvfdCachedSepWidth);
      const loopDuration = Math.max(8, loopTravel / PX_PER_SEC);
      dom.meta.style.setProperty("--pvfd-scroll-duration-loop", `${loopDuration.toFixed(2)}s`);
    } else {
      dom.meta.style.removeProperty("--pvfd-scroll-distance");
      dom.meta.style.removeProperty("--pvfd-scroll-duration-once");
      dom.meta.style.removeProperty("--pvfd-scroll-duration-loop");
      dom.meta.style.removeProperty("--pvfd-scroll-duration-bounce");
    }

    /* Restart animation ONLY when the track label actually changes. Playback
       glyph-only changes update the fixed sibling button, so Ever Scroll keeps
       its current transform and iteration. CSS handles mode-change restarts
       automatically (different keyframe name triggers a new animation). */
    pvfdLastMetaText = dom.metaInner.textContent;
    if (labelChanged) {
      const inner = dom.metaInner;
      const prev = inner.style.animation;
      inner.style.animation = "none";
      void inner.offsetWidth; /* force reflow so the next assignment restarts the CSS animation */
      inner.style.animation = prev || "";
    }
  }

  function repaintMetaTrackForMode() {
    /* Re-runs setMetaTrackContent with force=true so the measurement re-runs
       even though the label hasn't changed. Used when scroll mode changes
       (need to re-decide duplication), when LCD font changes (text width
       shifts), and on window resize (container width shifts). */
    if (pvfdLastMetaLabel) setMetaTrackContent(pvfdLastMetaLabel, pvfdLastMetaPlaying, true);
  }

  function setDataIfChanged(el, name, value) {
    if (el && el.dataset && el.dataset[name] !== value) el.dataset[name] = value;
  }

  function setAttrIfChanged(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function setStyleIfChanged(el, name, value, priority) {
    if (!el || el.style.getPropertyValue(name) === value) return;
    el.style.setProperty(name, value, priority || "");
  }

  function getSampledPlayerState(now = performance.now()) {
    if (now - playerStateCache.at > PLAYER_STATE_SAMPLE_MS) {
      playerStateCache.at = now;
      playerStateCache.playing = safePlayerIsPlaying(playerStateCache.playing);
      playerStateCache.shuffle = getShuffleState();
      playerStateCache.repeat = getRepeatState();
    }
    return playerStateCache;
  }

  function markStaticReadoutsDirty() {
    staticReadoutsDirty = true;
  }

  function markPlayerStateDirty() {
    playerStateCache.at = -Infinity;
    markStaticReadoutsDirty();
  }

  function schedulePlayerStateRefresh(delay = 140) {
    markPlayerStateDirty();
    window.setTimeout(markPlayerStateDirty, delay);
  }

  function markVolumeReadoutsDirty() {
    knobLedDirty = true;
    markStaticReadoutsDirty();
  }

  function updateMenuPanel() {
    const perfAt = pvfdPerfStart();
    if (!chassis) {
      pvfdPerfEnd("menuRefreshUpdate", perfAt);
      return;
    }
    const dom = getPvfdDom();
    setTextIfChanged(dom.menu && dom.menu.oel, activeClipName(12));
    setAttrIfChanged(dom.buttons && dom.buttons.lyrics, "title", "Open lyrics");
    setAttrIfChanged(dom.buttons && dom.buttons.lyrics, "aria-label", "Open lyrics");
    setTextIfChanged(dom.menu && dom.menu.demo, demoAutoMode ? "AUTO" : "OFF");
    setTextIfChanged(dom.menu && dom.menu.tint, TINT_LABELS[tintIdx]);
    setTextIfChanged(dom.menu && dom.menu.type, FONT_PRESETS[fontPresetIdx].label);
    setTextIfChanged(dom.menu && dom.menu.lcdFont, LCD_FONT_PRESETS[lcdFontPresetIdx].label);
    setTextIfChanged(dom.menu && dom.menu.perf, activePerformanceConfig().label);
    setTextIfChanged(dom.menu && dom.menu.logoGlow, currentPulseModeLabel());
    setTextIfChanged(dom.menu && dom.menu.oelDisplay, oelDisplayEnabled ? "ON" : "OFF");
    setTextIfChanged(dom.menu && dom.menu.racingColor, racingColorModeLabel());
    setTextIfChanged(dom.menu && dom.menu.chromeMode, chromeDarkEnabled ? "ON" : "OFF");
    setTextIfChanged(dom.menu && dom.menu.logoStyle, LOGO_STYLES[logoStyleIdx] || "MODERN");
    setTextIfChanged(dom.menu && dom.menu.everScroll, everScrollMode);
    setTextIfChanged(dom.menu && dom.menu.ledGlow, ledGlowEnabled ? "GLOW" : "OFF");
    refreshTintMenuSelection();
    pvfdPerfEnd("menuRefreshUpdate", perfAt);
  }

  // Mirrors the Chromium live-audio path so the menu shows the same source the logo
  // pulse loop is trying to use.
  function currentPulseModeLabel() {
    if (!logoGlowEnabled) return "OFF";
    if (hlprBridgeActive) return "HLPR";
    if (hlprBridgePending || (desktopCapturePending && isLinuxLikePlatform())) return "WAIT";
    if (desktopCapturePending || logoLiveAudioPending) return "...";
    if (desktopCaptureActive) return "LIVE";
    return "...";
  }

  function buildPulseProbeSnapshot() {
    return {
      enabled: logoGlowEnabled,
      label: currentPulseModeLabel(),
      liveAudioActive: logoLiveAudioActive,
      liveAudioPending: logoLiveAudioPending,
      desktopCaptureActive,
      desktopCapturePending,
      linuxLike: isLinuxLikePlatform(),
      hlprBridgeActive,
      hlprBridgePending,
      hlprSocketReady: !!(hlprSocket && hlprSocket.readyState === 1),
      hlprProtocolMismatched,
      hlprHelperVersion: (hlprHelloInfo && hlprHelloInfo.version) || "",
      hasAnalyser: !!logoLiveAudioAnalyser,
      hasBins: !!(logoLiveAudioBins && logoLiveAudioBins.length),
      playerDataReady: !!safeReturn(() => Spicetify.Player && Spicetify.Player.data, null),
      playerPlaying: safePlayerIsPlaying(false),
      failure: pulseLiveFailureReason || "",
      lastLiveAudioUpdateAt: Number.isFinite(lastLogoLiveAudioUpdateAt) ? Math.round(lastLogoLiveAudioUpdateAt) : null
    };
  }

  async function diagnosePulseCapture(options = {}) {
    const attemptPortalCapture = !!(options && options.attemptPortalCapture);
    const out = {
      generatedAt: new Date().toISOString(),
      attemptPortalCapture,
      ua: String(safeReturn(() => navigator.userAgent, "") || ""),
      platform: String(safeReturn(() => navigator.platform, "") || ""),
      href: String(safeReturn(() => location.href, "") || ""),
      supportedConstraints: safeReturn(() => (
        navigator.mediaDevices && typeof navigator.mediaDevices.getSupportedConstraints === "function"
          ? navigator.mediaDevices.getSupportedConstraints()
          : null
      ), null),
      chromeTabCapture: safeReturn(() => (typeof chrome === "undefined" ? "chrome unavailable" : typeof chrome.tabCapture), "unavailable"),
      pulse: buildPulseProbeSnapshot(),
      captureOptions: pulseDisplayMediaOptions(),
      devices: [],
      devicesError: "",
      portalCaptureAttempt: attemptPortalCapture ? null : "skipped; pass { diagnose: true, attemptPortalCapture: true } to open the portal picker"
    };

    if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        out.devices = devices.map((device) => ({
          kind: device.kind || "",
          label: device.label || "",
          deviceId: device.deviceId ? "[present]" : "",
          groupId: device.groupId ? "[present]" : ""
        }));
        if (!out.devices.some((device) => device.label)) {
          out.note = "enumerateDevices labels may be blank until media permission has been granted.";
        }
      } catch (err) {
        out.devicesError = safeErrorSummary(err);
      }
    } else {
      out.devicesError = "enumerateDevices not available";
    }

    if (attemptPortalCapture) {
      let stream = null;
      let attemptTracks = [];
      try {
        stream = await requestPulseDisplayMediaStream();
        stream.getVideoTracks().forEach((track) => safe(() => track.stop()));
        attemptTracks = stream.getTracks().map((track) => ({
          kind: track.kind || "",
          label: track.label || "",
          settings: safeReturn(() => track.getSettings && track.getSettings(), null)
        }));
        selectPulseAudioTrack(stream);
        out.portalCaptureAttempt = {
          ok: true,
          tracks: attemptTracks
        };
      } catch (err) {
        out.portalCaptureAttempt = {
          ok: false,
          error: safeErrorSummary(err),
          name: err && err.name ? String(err.name) : "",
          message: err && err.message ? String(err.message) : "",
          tracks: attemptTracks
        };
      } finally {
        if (stream && stream.getTracks) stream.getTracks().forEach((track) => safe(() => track.stop()));
      }
    }

    return out;
  }

  window.pvfdPulseProbe = function pvfdPulseProbe(options) {
    if (options && options.diagnose) return diagnosePulseCapture(options);
    return buildPulseProbeSnapshot();
  };

  function updateRoleButtonStates() {
    if (!chassis) return;
    const dom = getPvfdDom();
    const demoBtn = dom.buttons && dom.buttons.demo;
    if (demoBtn) {
      demoBtn.classList.toggle("active", demoAutoMode);
      demoBtn.title = demoAutoMode ? "Showroom auto-cycle: on" : "Toggle showroom auto-cycle";
    }
    const menuBtn = dom.buttons && dom.buttons.menu;
    if (menuBtn) menuBtn.classList.toggle("active", menuOpen);
  }

  function applyDimMode(persist = false) {
    applyLcdFilter();
    const dimBtn = chassis && chassis.querySelector("[data-pvfd='dim']");
    if (dimBtn) dimBtn.classList.toggle("active", lcdDimmed);
    if (persist) safe(() => window.localStorage.setItem(DIM_STORAGE_KEY, lcdDimmed ? "ON" : "OFF"));
    markStaticReadoutsDirty();
    updateMenuPanel();
  }

  function toggleDimMode() {
    lcdDimmed = !lcdDimmed;
    applyDimMode(true);
  }

  function applyChromeMode(persist = false) {
    const mode = chromeDarkEnabled ? "dark" : "light";
    if (document.body) {
      if (chromeDarkEnabled) document.body.setAttribute("data-pvfd-chrome", "dark");
      else document.body.removeAttribute("data-pvfd-chrome");
    }
    if (chassis) chassis.setAttribute("data-pvfd-chrome", mode);
    if (persist) safe(() => window.localStorage.setItem(CHROME_STORAGE_KEY, chromeDarkEnabled ? "ON" : "OFF"));
    updateMenuPanel();
  }

  function toggleChromeMode() {
    chromeDarkEnabled = !chromeDarkEnabled;
    applyChromeMode(true);
  }

  function applyLogoStyle(persist = false) {
    const style = LOGO_STYLES[logoStyleIdx] || "MODERN";
    if (document.body) document.body.setAttribute("data-pvfd-logo-style", style.toLowerCase());
    if (persist) safe(() => window.localStorage.setItem(LOGO_STYLE_STORAGE_KEY, style));
    updateMenuPanel();
  }

  function cycleLogoStyle() {
    logoStyleIdx = (logoStyleIdx + 1) % LOGO_STYLES.length;
    applyLogoStyle(true);
  }

  function applyEverScrollMode(persist = false) {
    if (document.body) {
      if (everScrollMode === "OFF") document.body.removeAttribute("data-pvfd-scroll");
      else document.body.setAttribute("data-pvfd-scroll", everScrollMode.toLowerCase());
    }
    if (persist) safe(() => window.localStorage.setItem(EVER_SCROLL_STORAGE_KEY, everScrollMode));
    /* Re-paint the meta track so a mode change immediately picks up the right
       content (LOOP needs duplicated text, ONCE/BOUNCE need single text +
       pixel-precise scroll distance). */
    repaintMetaTrackForMode();
    updateMenuPanel();
  }

  function toggleEverScrollMode() {
    const idx = EVER_SCROLL_MODES.indexOf(everScrollMode);
    everScrollMode = EVER_SCROLL_MODES[(idx + 1) % EVER_SCROLL_MODES.length];
    applyEverScrollMode(true);
  }

  function applyEeqTint(persist = false) {
    if (document.body) document.body.setAttribute("data-pvfd-eeq-tint", eeqTinted ? "ON" : "OFF");
    if (persist) safe(() => window.localStorage.setItem(EEQ_TINT_STORAGE_KEY, eeqTinted ? "ON" : "OFF"));
  }

  function toggleEeqTint() {
    eeqTinted = !eeqTinted;
    applyEeqTint(true);
  }

  function applyLedGlow(persist = false) {
    if (document.body) document.body.setAttribute("data-pvfd-led-glow", ledGlowEnabled ? "GLOW" : "OFF");
    if (persist) safe(() => window.localStorage.setItem(LED_GLOW_STORAGE_KEY, ledGlowEnabled ? "ON" : "OFF"));
    updateMenuPanel();
  }

  function toggleLedGlow() {
    ledGlowEnabled = !ledGlowEnabled;
    applyLedGlow(true);
  }

  function applyKnobGlow(persist = false) {
    if (document.body) document.body.setAttribute("data-pvfd-knob-glow", knobGlowEnabled ? "on" : "off");
    if (persist) safe(() => window.localStorage.setItem(KNOB_GLOW_STORAGE_KEY, knobGlowEnabled ? "ON" : "OFF"));
  }

  function toggleKnobGlow() {
    knobGlowEnabled = !knobGlowEnabled;
    applyKnobGlow(true);
    updateMcMenuRows();
  }

  function applyAttMode(persist = false) {
    if (chassis) chassis.setAttribute("data-pvfd-att-mode", attMode);
    if (persist) safe(() => window.localStorage.setItem(ATT_MODE_STORAGE_KEY, attMode));
  }

  function cycleAttMode() {
    attMode = attMode === "mute" ? "soft" : "mute";
    applyAttMode(true);
    updateMcMenuRows();
  }

  function setFmFreqText(text) {
    const el = chassis && chassis.querySelector("[data-pvfd='fm-freq']");
    if (el) el.textContent = text;
  }

  function pickNoiseString(length) {
    let s = "";
    for (let i = 0; i < length; i++) {
      s += BAND_NOISE_GLYPHS[Math.floor(Math.random() * BAND_NOISE_GLYPHS.length)];
    }
    return s;
  }

  function clearBandTuning() {
    if (bandTuningTimer) { clearTimeout(bandTuningTimer); bandTuningTimer = null; }
    if (bandTuningInterval) { clearInterval(bandTuningInterval); bandTuningInterval = null; }
    if (chassis) chassis.removeAttribute("data-pvfd-band-tuning");
  }

  function applyBandPreset(persist = false, animate = false, userInitiated = false) {
    clearBandTuning();
    const overlay = chassis && chassis.querySelector("[data-pvfd='fm-overlay']");
    const isOn = bandPresetIdx >= 0;
    if (chassis) {
      if (isOn) chassis.setAttribute("data-pvfd-band", String(bandPresetIdx));
      else chassis.removeAttribute("data-pvfd-band");
    }
    if (overlay) overlay.setAttribute("aria-hidden", isOn ? "false" : "true");
    const bandPill = chassis && chassis.querySelector("[data-pvfd='band']");
    if (bandPill) bandPill.classList.toggle("active", isOn);

    // Stop any in-flight FM audio + restore Spotify before re-deciding state.
    // Spotify gets paused once on the very first BAND-on tick (handled below).
    const hadAudio = fmAudioEl && fmAudioEl.src;
    if (hadAudio) stopFmAudio();

    if (isOn) {
      const finalText = BAND_PRESETS[bandPresetIdx];
      const hasAudio = !!BAND_AUDIO_PRESETS[bandPresetIdx];

      // Pause Spotify on the BAND-on transition (only the first time we
      // enter BAND mode from off; cycling between presets keeps it paused).
      if (hasAudio) {
        if (!spotifyWasPlayingBeforeBand) pauseSpotifyForBand();
        seedFmVolumeFromSpotify();
      }

      if (animate) {
        if (chassis) chassis.setAttribute("data-pvfd-band-tuning", "on");
        bandTuningInterval = setInterval(() => {
          setFmFreqText(pickNoiseString(finalText.length));
        }, 55);
        bandTuningTimer = setTimeout(() => {
          clearBandTuning();
          setFmFreqText(finalText);
          // Kick off audio AFTER the tuning-static finishes so the static
          // visual reads as "the tuner finding the station", then audio drops.
          if (hasAudio) startFmEpisodeForPreset(bandPresetIdx, userInitiated);
        }, BAND_TUNING_MS);
      } else {
        setFmFreqText(finalText);
        if (hasAudio) startFmEpisodeForPreset(bandPresetIdx, userInitiated);
      }
    } else {
      // BAND off: blank text, resume Spotify if we paused it.
      setFmFreqText("");
      resumeSpotifyAfterBand();
    }
    if (persist) safe(() => window.localStorage.setItem(BAND_STORAGE_KEY, String(bandPresetIdx)));
  }

  function cycleBandPreset() {
    // -1 → 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → -1 (off)
    bandPresetIdx = bandPresetIdx + 1;
    if (bandPresetIdx >= BAND_PRESETS.length) bandPresetIdx = -1;
    primeFmPresetGainForUserGesture(bandPresetIdx);
    applyBandPreset(true, true, true);
  }

  // Real-audio playback for BAND presets that have episodes in
  // BAND_AUDIO_PRESETS. Pauses Spotify so the broadcast plays alone,
  // resumes Spotify when BAND turns off. Random episode + random cut-in
  // point sells the "flipped the dial mid-broadcast" feel.
  let fmAudioEl = null;
  let fmAudioCtx = null;
  let fmAudioSourceNode = null;
  let fmAudioSourceEl = null;
  let fmAudioGainNode = null;
  let fmAudioGraphWarned = false;
  let spotifyWasPlayingBeforeBand = false;
  function getFmAudio() {
    if (fmAudioEl) return fmAudioEl;
    fmAudioEl = chassis && chassis.querySelector("[data-pvfd='fm-audio']");
    if (fmAudioEl && !fmAudioEl.dataset.pvfdInit) {
      fmAudioEl.dataset.pvfdInit = "1";
      fmAudioEl.addEventListener("ended", () => {
        // Episode finished — pick a fresh random episode for the same preset.
        if (bandPresetIdx >= 0 && BAND_AUDIO_PRESETS[bandPresetIdx]) {
          startFmEpisodeForPreset(bandPresetIdx);
        }
      });
      fmAudioEl.addEventListener("loadedmetadata", () => {
        const range = fmAudioEl.dataset.pvfdCutInRange;
        if (!range || !Number.isFinite(fmAudioEl.duration) || fmAudioEl.duration <= 0) return;
        let [start, end] = range.split(",").map(Number);
        // null-range (encoded as "auto") = first half of the actual duration.
        if (range === "auto") { start = 0; end = fmAudioEl.duration / 2; }
        // Clamp to actual duration in case our manifest exceeds it.
        end = Math.min(end, fmAudioEl.duration);
        start = Math.min(start, end);
        const seek = start + Math.random() * Math.max(0, end - start);
        try { fmAudioEl.currentTime = seek; } catch (_) {}
        safe(() => fmAudioEl.play());
      });
    }
    return fmAudioEl;
  }

  function seedFmVolumeFromSpotify() {
    const audio = getFmAudio();
    if (!audio) return;
    const volume = pendingVolume !== null ? pendingVolume : getSpotifyVolumeSafe(performance.now(), true);
    applyFmVolume(volume);
  }

  function warnFmAudioGraphFailure(err) {
    if (fmAudioGraphWarned) return;
    fmAudioGraphWarned = true;
    console.warn("[PVFD] BAND audio gain unavailable:", err);
  }

  function ensureFmAudioGraph(audio, allowResume = false) {
    if (!audio) return null;
    if (fmAudioSourceNode) {
      if (fmAudioSourceEl !== audio) {
        warnFmAudioGraphFailure("FM media source already bound");
        return null;
      }
      if (allowResume && fmAudioCtx && fmAudioCtx.state === "suspended" && typeof fmAudioCtx.resume === "function") {
        const resumed = fmAudioCtx.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(warnFmAudioGraphFailure);
      }
      return fmAudioGainNode;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      if (!fmAudioCtx) fmAudioCtx = new AudioCtor();
      fmAudioSourceEl = audio;
      fmAudioSourceNode = fmAudioCtx.createMediaElementSource(audio);
      fmAudioGainNode = fmAudioCtx.createGain();
      fmAudioSourceNode.connect(fmAudioGainNode);
      fmAudioGainNode.connect(fmAudioCtx.destination);
      if (allowResume && fmAudioCtx.state === "suspended" && typeof fmAudioCtx.resume === "function") {
        const resumed = fmAudioCtx.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(warnFmAudioGraphFailure);
      }
      return fmAudioGainNode;
    } catch (err) {
      warnFmAudioGraphFailure(err);
      return null;
    }
  }

  function applyFmPresetGain(audio, gain, allowResume = false) {
    const rawGain = Number(gain);
    const presetGain = Number.isFinite(rawGain) && rawGain > 0 ? rawGain : 1;
    if (presetGain <= 1) {
      if (fmAudioGainNode) safe(() => { fmAudioGainNode.gain.value = 1; });
      return;
    }
    const gainNode = ensureFmAudioGraph(audio, allowResume);
    if (gainNode) safe(() => { gainNode.gain.value = presetGain; });
  }

  function primeFmPresetGainForUserGesture(presetIdx) {
    const preset = BAND_AUDIO_PRESETS[presetIdx];
    if (!preset || !(Number(preset.gain) > 1)) return;
    const audio = getFmAudio();
    if (!audio) return;
    audio.crossOrigin = "anonymous";
    applyFmPresetGain(audio, preset.gain, true);
  }

  function fetchArchiveCollectionFiles(collectionId, extensions) {
    if (archiveFilesCache.has(collectionId)) {
      return Promise.resolve(archiveFilesCache.get(collectionId));
    }
    const url = ARCHIVE_META_BASE + encodeURIComponent(collectionId);
    return fetch(url)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`metadata fetch ${r.status}`)))
      .then((meta) => {
        const exts = (extensions || []).map((e) => e.toLowerCase().replace(/^\./, ""));
        const files = Array.isArray(meta && meta.files) ? meta.files : [];
        const matches = files
          .map((f) => f && f.name)
          .filter((name) => {
            if (typeof name !== "string") return false;
            const lower = name.toLowerCase();
            if (!exts.some((ext) => lower.endsWith("." + ext))) return false;
            return !isBlockedArchiveFile(collectionId, name);
          })
          .sort((a, b) => a.localeCompare(b));
        archiveFilesCache.set(collectionId, matches);
        return matches;
      });
  }

  function archivePathInfo(path) {
    const parts = String(path || "").split("/");
    const collectionId = parts.shift() || "";
    return {
      collectionId,
      filename: parts.length ? decodeURIComponent(parts.join("/")) : ""
    };
  }

  function isBlockedArchiveFile(collectionId, filename) {
    const blocked = BLOCKED_ARCHIVE_FILES[collectionId];
    return !!(blocked && blocked.has(filename));
  }

  function isBlockedArchivePath(path) {
    const info = archivePathInfo(path);
    return isBlockedArchiveFile(info.collectionId, info.filename);
  }

  function warnBlockedArchivePath(path) {
    const info = archivePathInfo(path);
    const key = `${info.collectionId}/${info.filename}`;
    if (blockedArchiveWarned.has(key)) return;
    blockedArchiveWarned.add(key);
    console.warn("[PVFD] BAND blocked archive file:", key);
  }

  function playEpisodeOnAudio(audio, path, cutInRange, gain, allowAudioContextResume = false) {
    if (isBlockedArchivePath(path)) {
      warnBlockedArchivePath(path);
      safe(() => audio.pause());
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    audio.dataset.pvfdCutInRange = cutInRange ? `${cutInRange[0]},${cutInRange[1]}` : "auto";
    audio.crossOrigin = "anonymous";
    applyFmVolume(getActiveHardwareVolume());
    applyFmPresetGain(audio, gain, allowAudioContextResume);
    audio.src = ARCHIVE_DL_BASE + path;
    audio.load();
    // play() is invoked from loadedmetadata after seek lands.
  }

  function startFmEpisodeForPreset(presetIdx, allowAudioContextResume = false) {
    const preset = BAND_AUDIO_PRESETS[presetIdx];
    if (!preset) return false;
    const audio = getFmAudio();
    if (!audio) return false;

    if (Array.isArray(preset.episodes) && preset.episodes.length) {
      const episodes = preset.episodes.filter((episode) => episode && !isBlockedArchivePath(episode.path));
      if (!episodes.length) return false;
      const pick = episodes[Math.floor(Math.random() * episodes.length)];
      playEpisodeOnAudio(audio, pick.path, pick.cutInRange, preset.gain, allowAudioContextResume);
      return true;
    }

    if (preset.archiveCollection) {
      // Capture the preset idx at fetch time so a race with rapid BAND cycling
      // doesn't start audio for a preset the user already left.
      const requestedIdx = presetIdx;
      fetchArchiveCollectionFiles(preset.archiveCollection, preset.fileExtensions)
        .then((files) => {
          if (bandPresetIdx !== requestedIdx) return;          // user cycled away
          const limit = Number(preset.archiveFileLimit);
          const candidates = Number.isFinite(limit) && limit > 0 ? (files || []).slice(0, limit) : (files || []);
          const safeFiles = candidates.filter((filename) => !isBlockedArchiveFile(preset.archiveCollection, filename));
          if (!safeFiles.length) return;
          const filename = safeFiles[Math.floor(Math.random() * safeFiles.length)];
          const path = `${preset.archiveCollection}/${encodeURIComponent(filename)}`;
          playEpisodeOnAudio(audio, path, preset.cutInRange, preset.gain, allowAudioContextResume);
        })
        .catch((err) => {
          console.warn("[PVFD] BAND manifest fetch failed:", err);
        });
      return true;
    }

    return false;
  }

  function stopFmAudio() {
    if (!fmAudioEl) return;
    safe(() => fmAudioEl.pause());
    fmAudioEl.removeAttribute("src");
    fmAudioEl.load();
  }

  function pauseSpotifyForBand() {
    const isPlaying = safeReturn(() => Spicetify.Player.isPlaying && Spicetify.Player.isPlaying(), false);
    spotifyWasPlayingBeforeBand = !!isPlaying;
    if (spotifyWasPlayingBeforeBand) safe(() => Spicetify.Player.pause());
  }

  function resumeSpotifyAfterBand() {
    if (spotifyWasPlayingBeforeBand) safe(() => Spicetify.Player.play());
    spotifyWasPlayingBeforeBand = false;
  }

  // Cached so we can move the M.C. menu back to its original parent on close.
  // Open path appends it to <body> so it has zero ancestor clipping/stacking
  // interference from the now-playing bar.
  let mcMenuOriginalParent = null;
  function setMcMenuOpen(open) {
    const next = !!open;
    if (mcMenuOpen === next) return;
    mcMenuOpen = next;
    const knobEl = chassis && chassis.querySelector("[data-pvfd='lknob']");
    if (knobEl) knobEl.classList.toggle("mc-active", mcMenuOpen);
    // The menu may currently live in either its original parent OR <body>,
    // depending on prior open/close state — query both places.
    const menuEl = (chassis && chassis.querySelector("[data-pvfd='mc-menu']"))
                || document.querySelector("body > [data-pvfd='mc-menu']");
    if (menuEl) menuEl.setAttribute("aria-hidden", mcMenuOpen ? "false" : "true");
    if (chassis) {
      if (mcMenuOpen) chassis.setAttribute("data-pvfd-mc-open", "on");
      else chassis.removeAttribute("data-pvfd-mc-open");
    }
    if (mcMenuOpen && menuEl && knobEl) {
      // Re-parent to <body> so no ancestor's overflow/transform/stacking
      // context can interfere. Cache the original parent for restore.
      if (menuEl.parentElement !== document.body) {
        mcMenuOriginalParent = menuEl.parentElement;
        document.body.appendChild(menuEl);
      }
      const rect = knobEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const bottomFromViewportBottom = window.innerHeight - rect.top + 8;
      menuEl.style.setProperty("--pvfd-mc-x", `${Math.round(cx)}px`);
      menuEl.style.setProperty("--pvfd-mc-bottom", `${Math.round(bottomFromViewportBottom)}px`);
      updateMcMenuRows();
    } else if (!mcMenuOpen && menuEl && mcMenuOriginalParent && menuEl.parentElement === document.body) {
      mcMenuOriginalParent.appendChild(menuEl);
    }
  }

  // DISP prompt — clicking the Pioneer logo opens a YES/NO confirm above
  // it asking whether to enter Spotify's full-screen now-playing view.
  // The prompt element is created lazily and appended to <body> so it
  // escapes the chassis's overflow:hidden (same pattern as M.C. menu).
  let dispPromptEl = null;
  let dispPromptOpen = false;
  function getDispPromptEl() {
    if (dispPromptEl) return dispPromptEl;
    dispPromptEl = document.createElement("div");
    dispPromptEl.className = "pvfd-disp-prompt";
    dispPromptEl.setAttribute("role", "dialog");
    dispPromptEl.setAttribute("aria-hidden", "true");
    dispPromptEl.innerHTML = `
      <div class="pvfd-disp-prompt-title">ENTER FULL SCREEN DISPLAY?</div>
      <div class="pvfd-disp-prompt-row">
        <button class="pvfd-disp-prompt-btn" type="button" data-pvfd-disp="yes">YES</button>
        <button class="pvfd-disp-prompt-btn" type="button" data-pvfd-disp="no">NO</button>
      </div>
    `;
    dispPromptEl.querySelector("[data-pvfd-disp='yes']").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      setDispPromptOpen(false);
      setPvfdCinemaOpen(true);
    });
    dispPromptEl.querySelector("[data-pvfd-disp='no']").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      setDispPromptOpen(false);
    });
    document.body.appendChild(dispPromptEl);
    return dispPromptEl;
  }
  // PVFD Cinema Mode — full-viewport PVFD-themed "now playing" takeover.
  // Replaces Spotify's stock fullscreen with our own giant-chassis layout:
  // album art (left), track info + lyrics/OEL + controls (right), animated
  // scanline backdrop, tint-aware. Mounted to <body> so it escapes the
  // now-playing bar's overflow:hidden, controls live inside it (chassis is
  // hidden via body class while active).
  let pvfdCinemaEl = null;
  let pvfdCinemaOpen = false;
  let pvfdCinemaUpdateTimer = null;
  function getPvfdCinemaEl() {
    if (pvfdCinemaEl) return pvfdCinemaEl;
    pvfdCinemaEl = document.createElement("div");
    pvfdCinemaEl.className = "pvfd-cinema";
    pvfdCinemaEl.setAttribute("aria-hidden", "true");
    pvfdCinemaEl.innerHTML = `
      <div class="pvfd-cinema-scanlines" aria-hidden="true"></div>
      <div class="pvfd-cinema-grain" aria-hidden="true"></div>
      <div class="pvfd-cinema-vignette" aria-hidden="true"></div>
      <div class="pvfd-cinema-topstrip" aria-hidden="true">
        <span class="pvfd-cinema-topstrip-side">EEQ · MOSFET 50w<span class="pvfd-silk-label-x">&times;</span><span class="pvfd-silk-label-4">4</span></span>
        <span class="pvfd-cinema-topstrip-logo">pioneer</span>
        <span class="pvfd-cinema-topstrip-side pvfd-cinema-topstrip-side-right">WMA / MP3 · DAB CONTROL</span>
      </div>
      <div class="pvfd-cinema-corner-controls">
        <button class="pvfd-cinema-close" type="button" data-pvfd-cinema="close" title="Exit display (ESC)" aria-label="Exit display">
          <span class="pvfd-cinema-close-x">&#x2715;</span>
          <span class="pvfd-cinema-close-hint">ESC</span>
        </button>
        <button class="pvfd-cinema-fs" type="button" data-pvfd-cinema="fs" title="Toggle true fullscreen (F)" aria-label="Toggle fullscreen">
          <span class="pvfd-cinema-fs-icon" data-pvfd-cinema="fs-icon">&#x26F6;</span>
          <span class="pvfd-cinema-fs-hint" data-pvfd-cinema="fs-hint">FULL</span>
        </button>
      </div>
      <div class="pvfd-cinema-stage">
        <div class="pvfd-cinema-left">
          <div class="pvfd-cinema-art-frame">
            <img class="pvfd-cinema-art" data-pvfd-cinema="art" alt="" />
          </div>
        </div>
        <div class="pvfd-cinema-right">
          <div class="pvfd-cinema-header">
            <div class="pvfd-cinema-title" data-pvfd-cinema="title">—</div>
            <div class="pvfd-cinema-artist" data-pvfd-cinema="artist">—</div>
            <div class="pvfd-cinema-album" data-pvfd-cinema="album">—</div>
          </div>
          <div class="pvfd-cinema-body" data-pvfd-cinema="body">
            <div class="pvfd-cinema-lyrics" data-pvfd-cinema="lyrics" hidden></div>
            <div class="pvfd-cinema-no-lyrics" data-pvfd-cinema="no-lyrics" hidden>
              <div class="pvfd-cinema-no-lyrics-tag">NO LYRICS AVAILABLE</div>
              <div class="pvfd-cinema-no-lyrics-title" data-pvfd-cinema="big-title">—</div>
              <div class="pvfd-cinema-no-lyrics-bars" aria-hidden="true">
                <span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span>
              </div>
            </div>
            <div class="pvfd-cinema-body-status" data-pvfd-cinema="body-status">LOADING…</div>
          </div>
          <div class="pvfd-cinema-controls">
            <div class="pvfd-cinema-progress" data-pvfd-cinema="progress-track" title="Seek">
              <div class="pvfd-cinema-progress-fill" data-pvfd-cinema="progress-fill"></div>
            </div>
            <div class="pvfd-cinema-times">
              <span data-pvfd-cinema="time-elapsed">0:00</span>
              <span data-pvfd-cinema="time-total">0:00</span>
            </div>
            <div class="pvfd-cinema-transport">
              <button class="pvfd-cinema-btn pvfd-cinema-btn-toggle" type="button" data-pvfd-cinema-ctrl="shuffle" title="Shuffle" aria-label="Shuffle">&#8646;&#xFE0E;</button>
              <button class="pvfd-cinema-btn" type="button" data-pvfd-cinema-ctrl="prev" title="Previous" aria-label="Previous">&#9198;&#xFE0E;</button>
              <button class="pvfd-cinema-btn pvfd-cinema-btn-play" type="button" data-pvfd-cinema-ctrl="play" title="Play / pause" aria-label="Play or pause">&#9654;&#xFE0E;</button>
              <button class="pvfd-cinema-btn" type="button" data-pvfd-cinema-ctrl="next" title="Next" aria-label="Next">&#9197;&#xFE0E;</button>
              <button class="pvfd-cinema-btn pvfd-cinema-btn-toggle" type="button" data-pvfd-cinema-ctrl="repeat" title="Repeat" aria-label="Repeat">&#8635;&#xFE0E;</button>
              <button class="pvfd-cinema-btn pvfd-cinema-btn-heart" type="button" data-pvfd-cinema-ctrl="heart" title="Save to liked" aria-label="Save to liked">&#9825;&#xFE0E;</button>
            </div>
            <div class="pvfd-cinema-volume">
              <span class="pvfd-cinema-volume-label">VOL</span>
              <input class="pvfd-cinema-volume-slider" type="range" min="0" max="100" value="50" data-pvfd-cinema="volume" aria-label="Volume" />
              <span class="pvfd-cinema-volume-value" data-pvfd-cinema="volume-value">50%</span>
            </div>
          </div>
        </div>
      </div>
      <div class="pvfd-cinema-curtain" data-pvfd-cinema="curtain" aria-hidden="true">
        <div class="pvfd-cinema-curtain-scanline" aria-hidden="true"></div>
      </div>
    `;
    pvfdCinemaEl.querySelector("[data-pvfd-cinema='close']").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      setPvfdCinemaOpen(false);
    });

    // True browser fullscreen — element-level requestFullscreen so the cinema
    // overlay becomes the viewport, hiding window chrome/title bar.
    pvfdCinemaEl.querySelector("[data-pvfd-cinema='fs']").addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      togglePvfdCinemaFullscreen();
    });

    // Control surface wiring — Spicetify.Player methods + live state echo.
    const q = (sel) => pvfdCinemaEl.querySelector(sel);
    const ctrl = (which, fn) => {
      const btn = pvfdCinemaEl.querySelector(`[data-pvfd-cinema-ctrl='${which}']`);
      if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); safe(fn); });
    };
    // Toggle wrappers also schedule a refresh after the action — Spicetify's
    // own events sometimes lag behind, leaving the button stale.
    const tap = (fn) => { safe(fn); setTimeout(refreshPvfdCinemaControlState, 180); };
    ctrl("play",    () => Spicetify.Player.togglePlay());
    ctrl("prev",    () => Spicetify.Player.back());
    ctrl("next",    () => Spicetify.Player.next());
    ctrl("shuffle", () => tap(() => Spicetify.Player.toggleShuffle()));
    ctrl("repeat",  () => tap(() => Spicetify.Player.toggleRepeat()));
    ctrl("heart",   () => tap(() => Spicetify.Player.toggleHeart()));

    // Progress track — pointerdown + drag + release to seek. While dragging
    // the fill follows the pointer immediately; final seek fires on release.
    const progressTrack = q("[data-pvfd-cinema='progress-track']");
    const progressFill  = q("[data-pvfd-cinema='progress-fill']");
    if (progressTrack && progressFill) {
      let dragFrac = null;
      const fracFromEvent = (e) => {
        const rect = progressTrack.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      };
      progressTrack.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        progressTrack.setPointerCapture && progressTrack.setPointerCapture(e.pointerId);
        progressTrack.classList.add("dragging");
        dragFrac = fracFromEvent(e);
        progressFill.style.transition = "none";
        progressFill.style.width = `${(dragFrac * 100).toFixed(2)}%`;
      });
      progressTrack.addEventListener("pointermove", (e) => {
        if (dragFrac == null) return;
        dragFrac = fracFromEvent(e);
        progressFill.style.width = `${(dragFrac * 100).toFixed(2)}%`;
      });
      const endProgressDrag = (e) => {
        if (dragFrac == null) return;
        const frac = dragFrac;
        dragFrac = null;
        progressTrack.classList.remove("dragging");
        progressFill.style.transition = "";
        const dur = safeReturn(() => Spicetify.Player.getDuration(), 0);
        if (dur > 0) safe(() => Spicetify.Player.seek(frac * dur));
      };
      progressTrack.addEventListener("pointerup", endProgressDrag);
      progressTrack.addEventListener("pointercancel", endProgressDrag);
      progressTrack.addEventListener("lostpointercapture", endProgressDrag);
    }

    // Volume slider — bidirectional. Input fires while dragging; also update
    // the % display inline so it doesn't wait for the next state-refresh tick.
    const volSlider = q("[data-pvfd-cinema='volume']");
    const volValue  = q("[data-pvfd-cinema='volume-value']");
    if (volSlider) {
      volSlider.addEventListener("input", (e) => {
        const pct = Number(e.target.value);
        if (volValue) volValue.textContent = `${pct}%`;
        safe(() => Spicetify.Player.setVolume(pct / 100));
      });
    }

    document.body.appendChild(pvfdCinemaEl);
    return pvfdCinemaEl;
  }

  function pvfdFmtTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? "0" : ""}${r}`;
  }

  function tickPvfdCinemaControls() {
    if (!pvfdCinemaOpen) return;
    const cinema = getPvfdCinemaEl();
    const trackEl = cinema.querySelector("[data-pvfd-cinema='progress-track']");
    const draggingProgress = trackEl && trackEl.classList.contains("dragging");
    const dur = safeReturn(() => Spicetify.Player.getDuration(), 0);
    const prog = safeReturn(() => Spicetify.Player.getProgress(), 0);
    if (!draggingProgress) {
      const fillEl = cinema.querySelector("[data-pvfd-cinema='progress-fill']");
      if (fillEl && dur > 0) {
        fillEl.style.width = `${Math.min(100, (prog / dur) * 100).toFixed(2)}%`;
      }
      const elapsedEl = cinema.querySelector("[data-pvfd-cinema='time-elapsed']");
      if (elapsedEl) elapsedEl.textContent = pvfdFmtTime(prog);
    }
    const totalEl = cinema.querySelector("[data-pvfd-cinema='time-total']");
    if (totalEl) totalEl.textContent = pvfdFmtTime(dur);
  }

  function refreshPvfdCinemaControlState() {
    if (!pvfdCinemaOpen) return;
    const cinema = getPvfdCinemaEl();
    const playing = safeReturn(() => Spicetify.Player.isPlaying(), false);
    const playBtn = cinema.querySelector("[data-pvfd-cinema-ctrl='play']");
    if (playBtn) playBtn.innerHTML = playing ? "&#9208;&#xFE0E;" : "&#9654;&#xFE0E;";

    // Repeat: 0 = off, 1 = repeat-context (all), 2 = repeat-track (one).
    // Shuffle: boolean. Heart: boolean. Use sync getters when available, fall
    // back to Player.data shape for older Spicetify builds.
    const data = safeReturn(() => Spicetify.Player.data, null);
    const repeatMode = safeReturn(() => Spicetify.Player.getRepeat(), null);
    let repeatVal;
    if (typeof repeatMode === "number") repeatVal = repeatMode;
    else if (data && data.options) {
      repeatVal = data.options.repeatingTrack ? 2 : data.options.repeatingContext ? 1 : 0;
    } else { repeatVal = 0; }

    let shuffling = safeReturn(() => Spicetify.Player.getShuffle(), null);
    if (shuffling === null) shuffling = !!(data && data.options && (data.options.shufflingContext || data.options.shuffling_context));

    let liked = safeReturn(() => Spicetify.Player.getHeart && Spicetify.Player.getHeart(), null);
    if (liked === null) {
      const meta = data && data.item && data.item.metadata;
      liked = !!(meta && (meta.has_liked === "true" || meta.has_liked === true));
    }

    const shuffleBtn = cinema.querySelector("[data-pvfd-cinema-ctrl='shuffle']");
    const repeatBtn  = cinema.querySelector("[data-pvfd-cinema-ctrl='repeat']");
    const heartBtn   = cinema.querySelector("[data-pvfd-cinema-ctrl='heart']");
    if (shuffleBtn) shuffleBtn.classList.toggle("active", !!shuffling);
    if (repeatBtn) {
      // ↻ for repeat-all, ↻ + ONE label for repeat-track, plain when off.
      repeatBtn.classList.toggle("active", repeatVal > 0);
      repeatBtn.classList.toggle("repeat-one", repeatVal === 2);
      const baseIcon = "&#8635;&#xFE0E;";
      repeatBtn.innerHTML = repeatVal === 2 ? `${baseIcon}<sub class="pvfd-cinema-btn-sub">1</sub>` : baseIcon;
      repeatBtn.title = repeatVal === 0 ? "Repeat: off" : repeatVal === 1 ? "Repeat: all" : "Repeat: one";
    }
    if (heartBtn) {
      heartBtn.classList.toggle("active", !!liked);
      // Filled ♥ when liked, hollow ♡ otherwise.
      heartBtn.innerHTML = liked ? "&#9829;&#xFE0E;" : "&#9825;&#xFE0E;";
      heartBtn.title = liked ? "Remove from Liked Songs" : "Save to Liked Songs";
    }

    const vol = safeReturn(() => Spicetify.Player.getVolume(), 0.5);
    const volSlider = cinema.querySelector("[data-pvfd-cinema='volume']");
    const volValue  = cinema.querySelector("[data-pvfd-cinema='volume-value']");
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = String(Math.round(vol * 100));
    }
    if (volValue) volValue.textContent = `${Math.round(vol * 100)}%`;
  }

  // Lyrics state — keyed per trackUri; entries are arrays of {time, text}.
  // time is ms since track start, null = unsynced line.
  const pvfdLyricsCache = new Map();
  let pvfdCurrentLyrics = null;       // [{time, text}, ...] or null
  let pvfdCurrentLyricsTrackUri = "";
  let pvfdLyricsActiveIdx = -1;
  let pvfdLyricsProgressTimer = null;
  // After a track change + lyrics render, Spicetify's getProgress() can
  // briefly report the previous track's position. This timestamp suppresses
  // active-line computation until progress has had a chance to align.
  let pvfdLyricsGuardUntil = 0;

  function fetchPvfdLyrics(trackUri) {
    if (!trackUri) return Promise.resolve(null);
    if (pvfdLyricsCache.has(trackUri)) {
      return Promise.resolve(pvfdLyricsCache.get(trackUri));
    }
    const id = trackUri.split(":").pop();
    const cosmos = safeReturn(() => Spicetify.CosmosAsync, null);
    if (!cosmos || typeof cosmos.get !== "function") { pvfdLyricsCache.set(trackUri, null); return Promise.resolve(null); }

    // Try modern color-lyrics endpoint first, then legacy lyrics-views as fallback.
    const endpoints = [
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`,
      `wg://lyrics-views/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`,
      `https://spclient.wg.spotify.com/lyrics-views/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`
    ];

    const parse = (res) => {
      if (!res) return null;
      // color-lyrics returns { colors, lyrics: { syncType, lines } }
      const lyricsObj = (res.lyrics && res.lyrics.lines) ? res.lyrics
                     : (res.colorLyrics && res.colorLyrics.lyrics) ? res.colorLyrics.lyrics
                     : null;
      if (!lyricsObj || !Array.isArray(lyricsObj.lines) || !lyricsObj.lines.length) return null;

      const rawTimes = lyricsObj.lines.map((l) => {
        const r = l.startTimeMs != null ? parseInt(l.startTimeMs, 10) : (l.time != null ? l.time : null);
        return Number.isFinite(r) ? r : null;
      });
      // If <2 distinct positive times, the track is effectively unsynced —
      // Spotify often returns plain text with all startTimeMs=0. Treat the
      // whole track as unsynced (no timing → no active-line walk).
      const distinct = new Set(rawTimes.filter((t) => Number.isFinite(t) && t > 0));
      const treatAsUnsynced = distinct.size < 2
                            || (lyricsObj.syncType && lyricsObj.syncType.toString().toUpperCase() === "UNSYNCED");

      // Strictly-increasing monotonic walk for synced tracks (drops bogus
      // duplicate / out-of-order placeholders).
      let lastTime = -1;
      const parsed = lyricsObj.lines.map((l, i) => {
        let t = null;
        if (!treatAsUnsynced) {
          const r = rawTimes[i];
          if (Number.isFinite(r) && r > lastTime) { t = r; lastTime = r; }
        }
        return { time: t, text: (l.words || l.text || "").trim() };
      }).filter((l) => l.text && l.text !== "♪");
      return parsed.length ? parsed : null;
    };

    const tryNext = (i) => {
      if (i >= endpoints.length) { pvfdLyricsCache.set(trackUri, null); return null; }
      return cosmos.get(endpoints[i])
        .then((res) => {
          const parsed = parse(res);
          if (parsed) { pvfdLyricsCache.set(trackUri, parsed); return parsed; }
          return tryNext(i + 1);
        })
        .catch(() => tryNext(i + 1));
    };
    return tryNext(0);
  }

  function renderPvfdLyrics(lines) {
    const cinema = getPvfdCinemaEl();
    const wrap = cinema.querySelector("[data-pvfd-cinema='lyrics']");
    if (!wrap) return;
    pvfdLyricsGuardUntil = Date.now() + 1200;
    wrap.innerHTML = "";

    // Detect fully-unsynced lyrics — Spotify sometimes returns plain text
    // with no timing data. Show a notice + render statically, no highlight.
    const hasSynced = lines.some((l) => Number.isFinite(l.time));
    wrap.classList.toggle("unsynced", !hasSynced);
    if (!hasSynced) {
      const banner = document.createElement("div");
      banner.className = "pvfd-cinema-lyric-unsync-banner";
      banner.textContent = "These lyrics aren't synced to the song.";
      wrap.appendChild(banner);
    }

    lines.forEach((line, i) => {
      const div = document.createElement("div");
      div.className = "pvfd-cinema-lyric-line";
      div.dataset.idx = String(i);
      div.dataset.time = line.time != null ? String(line.time) : "";
      div.textContent = line.text;
      if (line.time != null) {
        div.classList.add("seekable");
        div.title = "Click to jump to this line";
        div.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          const t = parseInt(div.dataset.time, 10);
          if (Number.isFinite(t)) safe(() => Spicetify.Player.seek(t));
        });
      }
      wrap.appendChild(div);
    });
    pvfdLyricsActiveIdx = -1;
    requestAnimationFrame(() => {
      wrap.scrollTop = 0;
      requestAnimationFrame(() => { wrap.scrollTop = 0; });
    });
  }

  function tickPvfdLyrics() {
    tickPvfdCinemaControls();
    if (!pvfdCinemaOpen || !pvfdCurrentLyrics) return;
    // Unsynced lyrics → no active-line walk; just render statically.
    if (!pvfdCurrentLyrics.some((l) => Number.isFinite(l.time))) return;
    if (Date.now() < pvfdLyricsGuardUntil) return;
    const progress = safeReturn(() => Spicetify.Player.getProgress(), 0);
    const duration = safeReturn(() => Spicetify.Player.getDuration(), 0);
    if (duration > 0 && progress > duration + 1500) return;
    let active = -1;
    for (let i = 0; i < pvfdCurrentLyrics.length; i++) {
      const t = pvfdCurrentLyrics[i].time;
      if (t == null) continue;
      if (t <= progress) active = i; else break;
    }
    if (active === pvfdLyricsActiveIdx) return;
    pvfdLyricsActiveIdx = active;
    const wrap = getPvfdCinemaEl().querySelector("[data-pvfd-cinema='lyrics']");
    if (!wrap) return;
    wrap.querySelectorAll(".pvfd-cinema-lyric-line.active").forEach((el) => el.classList.remove("active"));
    if (active < 0) return;
    const activeEl = wrap.querySelector(`.pvfd-cinema-lyric-line[data-idx='${active}']`);
    if (activeEl) {
      activeEl.classList.add("active");
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function startPvfdLyricsTicker() {
    if (pvfdLyricsProgressTimer) return;
    pvfdLyricsProgressTimer = setInterval(tickPvfdLyrics, 200);
  }
  function stopPvfdLyricsTicker() {
    if (!pvfdLyricsProgressTimer) return;
    clearInterval(pvfdLyricsProgressTimer);
    pvfdLyricsProgressTimer = null;
  }

  function showPvfdLyricsOrFallback(trackUri) {
    const cinema = getPvfdCinemaEl();
    const lyricsEl = cinema.querySelector("[data-pvfd-cinema='lyrics']");
    const noLyricsEl = cinema.querySelector("[data-pvfd-cinema='no-lyrics']");
    const statusEl = cinema.querySelector("[data-pvfd-cinema='body-status']");
    if (!lyricsEl || !noLyricsEl || !statusEl) return;

    // Clear stale lyrics + active-idx immediately so the ticker can't match
    // the new song's just-started progress against the previous song's
    // lyric times (caused "song-end lyric flashing on song start").
    pvfdCurrentLyrics = null;
    pvfdLyricsActiveIdx = -1;

    lyricsEl.hidden = true;
    noLyricsEl.hidden = true;
    statusEl.hidden = false;
    statusEl.textContent = "LOADING LYRICS…";

    fetchPvfdLyrics(trackUri).then((lines) => {
      if (!pvfdCinemaOpen || trackUri !== pvfdCurrentLyricsTrackUri) return;
      if (lines && lines.length) {
        pvfdCurrentLyrics = lines;
        renderPvfdLyrics(lines);
        lyricsEl.hidden = false;
        statusEl.hidden = true;
        noLyricsEl.hidden = true;
        startPvfdLyricsTicker();
      } else {
        // No lyrics — keep the ticker running anyway so progress/time/controls
        // still update. tickPvfdLyrics short-circuits its lyrics work when
        // pvfdCurrentLyrics is null but still calls tickPvfdCinemaControls.
        pvfdCurrentLyrics = null;
        lyricsEl.hidden = true;
        statusEl.hidden = true;
        noLyricsEl.hidden = false;
        // Populate the big-title text with current track name.
        const data = safeReturn(() => Spicetify.Player.data, null);
        const item = data && data.item;
        const bigTitle = (item && (item.name || (item.metadata && item.metadata.title))) || "—";
        const bigEl = cinema.querySelector("[data-pvfd-cinema='big-title']");
        if (bigEl) bigEl.textContent = bigTitle;
      }
    });
  }

  function updatePvfdCinemaTrackInfo() {
    if (!pvfdCinemaOpen) return;
    const cinema = getPvfdCinemaEl();
    const data = safeReturn(() => Spicetify.Player.data, null);
    const item = data && data.item;
    if (!item) return;
    const meta = item.metadata || {};
    const title = item.name || meta.title || "—";
    const artist = meta.artist_name || (item.artists && item.artists[0] && item.artists[0].name) || "—";
    const album = meta.album_title || (item.album && item.album.name) || "—";
    const artUrl = meta.image_xlarge_url || meta.image_large_url || meta.image_url
                || (item.images && item.images[0] && item.images[0].url) || "";
    const setText = (sel, text) => {
      const el = cinema.querySelector(sel);
      if (el && el.textContent !== text) el.textContent = text;
    };
    setText("[data-pvfd-cinema='title']", title);
    setText("[data-pvfd-cinema='artist']", artist);
    setText("[data-pvfd-cinema='album']", album);
    const artEl = cinema.querySelector("[data-pvfd-cinema='art']");
    if (artEl && artUrl && artEl.getAttribute("src") !== artUrl) {
      artEl.setAttribute("src", artUrl);
    }
    // Track switched → re-fetch lyrics for the new uri.
    const trackUri = item.uri || "";
    if (trackUri && trackUri !== pvfdCurrentLyricsTrackUri) {
      pvfdCurrentLyricsTrackUri = trackUri;
      showPvfdLyricsOrFallback(trackUri);
    }
  }

  // EJECT-style transition timing — scanline + black curtain sweep across
  // the screen before cinema reveals (enter) / after content hides (exit).
  const PVFD_CINEMA_TRANSITION_MS = 700;
  let pvfdCinemaTransitionTimer = null;

  function setPvfdCinemaOpen(open) {
    const next = !!open;
    if (pvfdCinemaOpen === next) return;
    const cinema = getPvfdCinemaEl();
    if (pvfdCinemaTransitionTimer) { clearTimeout(pvfdCinemaTransitionTimer); pvfdCinemaTransitionTimer = null; }
    cinema.classList.remove("entering", "exiting");

    if (next) {
      // Reveal cinema immediately and play the entering curtain — curtain
      // covers content with black + downward scanline, then fades away.
      pvfdCinemaOpen = true;
      cinema.setAttribute("aria-hidden", "false");
      if (document.body) document.body.classList.add("pvfd-cinema-active");
      // Force layout reflow before adding entering class so the animation
      // restarts cleanly even if cinema was just closed.
      void cinema.offsetWidth;
      cinema.classList.add("entering");
      pvfdCinemaTransitionTimer = setTimeout(() => {
        cinema.classList.remove("entering");
        pvfdCinemaTransitionTimer = null;
      }, PVFD_CINEMA_TRANSITION_MS + 60);
      updatePvfdCinemaTrackInfo();
      refreshPvfdCinemaControlState();
      startPvfdLyricsTicker();
    } else {
      // Play exit curtain first — black fades in + upward scanline — then
      // actually hide cinema and restore the chassis.
      cinema.classList.add("exiting");
      pvfdCinemaTransitionTimer = setTimeout(() => {
        cinema.classList.remove("exiting");
        pvfdCinemaTransitionTimer = null;
        pvfdCinemaOpen = false;
        cinema.setAttribute("aria-hidden", "true");
        if (document.body) document.body.classList.remove("pvfd-cinema-active");
        stopPvfdLyricsTicker();
        if (isPvfdCinemaFullscreen()) safe(() => document.exitFullscreen());
      }, PVFD_CINEMA_TRANSITION_MS);
    }
  }

  function isPvfdCinemaFullscreen() {
    return !!document.fullscreenElement && document.fullscreenElement === pvfdCinemaEl;
  }
  function togglePvfdCinemaFullscreen() {
    if (!pvfdCinemaEl) return;
    if (isPvfdCinemaFullscreen()) {
      safe(() => document.exitFullscreen());
    } else {
      safe(() => pvfdCinemaEl.requestFullscreen());
    }
  }
  document.addEventListener("fullscreenchange", () => {
    if (!pvfdCinemaEl) return;
    const fs = isPvfdCinemaFullscreen();
    const iconEl = pvfdCinemaEl.querySelector("[data-pvfd-cinema='fs-icon']");
    const hintEl = pvfdCinemaEl.querySelector("[data-pvfd-cinema='fs-hint']");
    pvfdCinemaEl.classList.toggle("fs-active", fs);
    if (iconEl) iconEl.innerHTML = fs ? "&#x2922;" : "&#x26F6;";  // ⤢ vs ⛶
    if (hintEl) hintEl.textContent = fs ? "EXIT" : "FULL";
  });

  // ESC closes cinema (and the browser auto-exits its own fullscreen first if
  // active, so ESC-while-fullscreen exits FS first, then a second ESC closes
  // cinema). F-key toggles true fullscreen when cinema is open.
  document.addEventListener("keydown", (e) => {
    if (!pvfdCinemaOpen) return;
    if (e.key === "Escape") {
      // Browser handles ESC for FS exit natively; only close cinema if we're
      // not in FS (or no FS element at all).
      if (!document.fullscreenElement) {
        e.preventDefault();
        setPvfdCinemaOpen(false);
      }
    } else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Ignore F key inside text inputs.
      const t = e.target;
      const isInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (isInput) return;
      e.preventDefault();
      togglePvfdCinemaFullscreen();
    }
  });
  // Hook Spotify player events to refresh track info + controls while cinema is open.
  safe(() => {
    if (!Spicetify.Player || !Spicetify.Player.addEventListener) return;
    // songchange: aggressive cleanup THEN re-derive new state. Without the
    // hard clear, stale .active classes and scroll position survived the
    // track transition (Spicetify.Player.data sometimes lags the event).
    Spicetify.Player.addEventListener("songchange", () => {
      pvfdCurrentLyrics = null;
      pvfdLyricsActiveIdx = -1;
      pvfdLyricsGuardUntil = Date.now() + 1500;
      const c = pvfdCinemaEl;
      if (c) {
        const wrap = c.querySelector("[data-pvfd-cinema='lyrics']");
        if (wrap) {
          wrap.querySelectorAll(".pvfd-cinema-lyric-line.active").forEach((el) => el.classList.remove("active"));
          wrap.scrollTop = 0;
        }
      }
      // updatePvfdCinemaTrackInfo reads Spicetify.Player.data — delay a beat
      // to let Spicetify settle on the new track's data, then refresh.
      setTimeout(() => { updatePvfdCinemaTrackInfo(); refreshPvfdCinemaControlState(); }, 80);
    });
    Spicetify.Player.addEventListener("onplaypause", () => {
      updatePvfdCinemaTrackInfo();
      refreshPvfdCinemaControlState();
    });
  });
  function setDispPromptOpen(open) {
    const next = !!open;
    if (dispPromptOpen === next) return;
    dispPromptOpen = next;
    const logoEl = chassis && chassis.querySelector(".pvfd-silk-pioneer");
    if (logoEl) logoEl.classList.toggle("disp-active", dispPromptOpen);
    const prompt = getDispPromptEl();
    prompt.setAttribute("aria-hidden", dispPromptOpen ? "false" : "true");
    if (dispPromptOpen && logoEl) {
      const rect = logoEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const bottomFromViewportBottom = window.innerHeight - rect.top + 10;
      prompt.style.setProperty("--pvfd-disp-x", `${Math.round(cx)}px`);
      prompt.style.setProperty("--pvfd-disp-bottom", `${Math.round(bottomFromViewportBottom)}px`);
    }
  }

  function updateMcMenuRows() {
    // Scope to document, not chassis — when M.C. menu is open, it's
    // re-parented to <body> to escape the chassis's overflow:hidden, so
    // chassis.querySelector won't find the rows.
    const attRow = document.querySelector("[data-pvfd-mc-row='att']");
    const glowRow = document.querySelector("[data-pvfd-mc-row='glow']");
    if (attRow) {
      const span = attRow.querySelector("span");
      if (span) span.textContent = attMode === "soft" ? "10%VOL" : "MUTE";
    }
    if (glowRow) {
      const span = glowRow.querySelector("span");
      if (span) span.textContent = knobGlowEnabled ? "ON" : "OFF";
    }
  }

  function applyBrowseFontPreset(persist = false) {
    fontPresetIdx = ((fontPresetIdx % FONT_PRESETS.length) + FONT_PRESETS.length) % FONT_PRESETS.length;
    const preset = FONT_PRESETS[fontPresetIdx];
    const key = `${preset.label}:${preset.stack}`;
    let applied = false;
    const fontTargets = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll(".Root__main-view, .main-view-container, .main-view-container__scroll-node, .BeautifulLyricsPage, #SpicyLyricsPage")
    ].filter(Boolean);
    fontTargets.forEach((el) => {
      const pixelCurrent = el.style.getPropertyValue("--pvfd-font-pixel");
      const vfdCurrent = el.style.getPropertyValue("--pvfd-font-vfd");
      if (pixelCurrent !== preset.stack) {
        el.style.setProperty("--pvfd-font-pixel", preset.stack);
        applied = true;
      }
      if (vfdCurrent !== preset.stack) {
        el.style.setProperty("--pvfd-font-vfd", preset.stack);
        applied = true;
      }
    });
    if (!applied && browseFontPresetKey === key && !persist) return;
    browseFontPresetKey = key;
    if (persist) safe(() => window.localStorage.setItem(FONT_STORAGE_KEY, preset.label));
    updateMenuPanel();
  }

  function cycleFontPreset() {
    fontPresetIdx = (fontPresetIdx + 1) % FONT_PRESETS.length;
    applyBrowseFontPreset(true);
  }

  function applyLcdFontPreset(persist = false) {
    lcdFontPresetIdx = ((lcdFontPresetIdx % LCD_FONT_PRESETS.length) + LCD_FONT_PRESETS.length) % LCD_FONT_PRESETS.length;
    const preset = LCD_FONT_PRESETS[lcdFontPresetIdx];
    if (document.body) {
      if (preset.bodyAttr) document.body.setAttribute("data-pvfd-lcd", preset.bodyAttr);
      else document.body.removeAttribute("data-pvfd-lcd");
    }
    if (persist) safe(() => window.localStorage.setItem(LCD_FONT_STORAGE_KEY, preset.label));
    updateMenuPanel();
    /* LCD font change shifts meta-track text width — re-measure overflow so
       the scroll animation picks up the new glyph metrics. Invalidate the
       cached separator width since it's font-dependent. */
    pvfdCachedSepWidth = -1;
    repaintMetaTrackForMode();
  }

  function cycleLcdFontPreset() {
    lcdFontPresetIdx = (lcdFontPresetIdx + 1) % LCD_FONT_PRESETS.length;
    applyLcdFontPreset(true);
  }

  function applyPerformanceMode(persist = false) {
    performanceModeIdx = ((performanceModeIdx % PERFORMANCE_MODES.length) + PERFORMANCE_MODES.length) % PERFORMANCE_MODES.length;
    const perf = activePerformanceConfig();
    const perfName = perf.label.toLowerCase();
    if (chassis) chassis.setAttribute("data-pvfd-performance", perfName);
    document.documentElement.setAttribute("data-pvfd-performance", perfName);
    if (document.body) document.body.setAttribute("data-pvfd-performance", perfName);
    if (persist) safe(() => window.localStorage.setItem(PERF_STORAGE_KEY, perf.label));
    lastCanvasFrameKey = "";
    clearAllClipRenderCaches(!perf.keepPreviousClipCache);
    if (perf.releaseInactiveClipBytes) releaseInactiveClipBytes(CLIPS[clipIdx] || null);
    scheduleSizeCanvas();
    applyLcdFilter();
    markStaticReadoutsDirty();
    knobLedDirty = true;
    updateMenuPanel();
  }

  function applyLogoGlowMode(persist = false) {
    if (chassis) {
      chassis.setAttribute("data-pvfd-logo-glow", logoGlowEnabled ? "on" : "off");
      chassis.classList.remove("pvfd-logo-burst", "pvfd-logo-burst-a", "pvfd-logo-burst-b");
    }
    if (!logoGlowEnabled) {
      pulseLiveFailureReason = "";
      stopDesktopAudioCapture();
      stopLogoLiveAudioCapture();
    }
    if (persist) safe(() => window.localStorage.setItem(LOGO_GLOW_STORAGE_KEY, logoGlowEnabled ? "ON" : "OFF"));
    updateMenuPanel();
  }

  async function toggleLogoGlowMode() {
    if (desktopCapturePending) return;
    if (logoGlowEnabled) {
      logoGlowEnabled = false;
      applyLogoGlowMode(true);
      return;
    }

    logoGlowEnabled = true;
    applyLogoGlowMode(true);

    const pulseStartPromise = startLogoLiveAudioCapture();
    const liveCaptureStarted = await startDesktopAudioCapture();
    const pulseStarted = await pulseStartPromise;

    if (!pulseStarted || !liveCaptureStarted) {
      logoGlowEnabled = false;
      stopDesktopAudioCapture();
      stopLogoLiveAudioCapture();
      applyLogoGlowMode(true);
      return;
    }

    pulseLiveFailureReason = "";
    updateMenuPanel();
  }

  function applyRacingColorMode(persist = false) {
    syncOelColorModeAttributes();
    applyLcdFilter();
    if (persist) safe(() => window.localStorage.setItem(RACING_COLOR_STORAGE_KEY, racingColorEnabled ? "COLOR" : "TINT"));
    markStaticReadoutsDirty();
    updateMenuPanel();
  }

  function toggleRacingColorMode() {
    racingColorEnabled = !racingColorEnabled;
    applyRacingColorMode(true);
  }

  function toggleRacingColorFromOel() {
    if (!isRacingClip(getActiveOelClip())) return;
    toggleRacingColorMode();
  }

  function applyOelDisplayMode(persist = false) {
    if (chassis) chassis.setAttribute("data-pvfd-oel-display", oelDisplayEnabled ? "on" : "off");
    logOelCanvasRendererDisabled();
    if (canvas) canvas.style.display = "";
    const dom = getPvfdDom();
    syncOelColorModeAttributes();
    if (dom.lcdVideo) dom.lcdVideo.style.display = oelDisplayEnabled ? "block" : "none";
    if (!oelDisplayEnabled && ctx && canvasCssW && canvasCssH) {
      ctx.clearRect(0, 0, canvasCssW, canvasCssH);
      lastCanvasFrameKey = "";
    }
    if (oelDisplayEnabled) {
      console.log("[PVFD] VFD ON: showing/playing WebM");
      syncOelVideoPlayback(true);
    } else {
      console.log("[PVFD] VFD OFF: hiding/pausing WebM");
      pauseOelVideoPlayback("off");
    }
    if (persist) safe(() => window.localStorage.setItem(OEL_DISPLAY_STORAGE_KEY, oelDisplayEnabled ? "ON" : "OFF"));
    updateMenuPanel();
  }

  function toggleOelDisplay() {
    oelDisplayEnabled = !oelDisplayEnabled;
    applyOelDisplayMode(true);
  }

  function cyclePerformanceMode() {
    performanceModeIdx = (performanceModeIdx + 1) % PERFORMANCE_MODES.length;
    applyPerformanceMode(true);
  }

  function cycleClipMode() {
    logOelCanvasRendererDisabled();
    if (!OEL_WEBM_CLIPS.length) return;
    setActiveClip(clipIdx + 1, true);
    const clipBtn = chassis && chassis.querySelector("[data-pvfd='clip']");
    if (clipBtn) {
      clipBtn.classList.add("active");
      setTimeout(() => clipBtn.classList.remove("active"), 900);
    }
  }

  function applyTintMode(persist = false) {
    tintIdx = ((tintIdx % TINT_HUE_DEG.length) + TINT_HUE_DEG.length) % TINT_HUE_DEG.length;
    applyLcdFilter();
    markStaticReadoutsDirty();
    const tintBtn = chassis && chassis.querySelector("[data-pvfd='tint']");
    if (tintBtn) {
      tintBtn.textContent = TINT_LABELS[tintIdx];
      tintBtn.dataset.pvfdTintShort = TINT_LABELS_SHORT[tintIdx];
      tintBtn.classList.toggle("active", tintIdx !== 0);
    }
    if (persist) safe(() => window.localStorage.setItem(TINT_STORAGE_KEY, TINT_LABELS[tintIdx]));
    updateMenuPanel();
  }

  function cycleTintMode() {
    tintIdx = (tintIdx + 1) % TINT_HUE_DEG.length;
    applyTintMode(true);
  }

  function toggleDemoMode() {
    demoAutoMode = !demoAutoMode;
    if (demoAutoMode) {
      // Remember whichever clip the user had set so we can restore it when
      // DEMO is turned off. Cycle advances are non-persisted (setActiveClip
      // false) so the user's saved clip in localStorage is never touched.
      demoSavedClipIdx = clipIdx;
      demoLastClipSwitchMs = performance.now();
    } else if (demoSavedClipIdx !== null) {
      setActiveClip(demoSavedClipIdx, false);
      demoSavedClipIdx = null;
    }
    if (chassis) chassis.setAttribute("data-pvfd-demo", demoAutoMode ? "on" : "off");
    markStaticReadoutsDirty();
    updateRoleButtonStates();
    updateMenuPanel();
  }

  function activateMenuAction(action) {
    if (action === "clip") cycleClipMode();
    else if (action === "demo") toggleDemoMode();
    else if (action === "tint") openTintMenu();
    else if (action === "type") cycleFontPreset();
    else if (action === "lcdFont") cycleLcdFontPreset();
    else if (action === "perf") cyclePerformanceMode();
    else if (action === "logoGlow") toggleLogoGlowMode();
    else if (action === "oelDisplay") toggleOelDisplay();
    else if (action === "racingColor") toggleRacingColorMode();
    else if (action === "chromeMode") toggleChromeMode();
    else if (action === "logoStyle") cycleLogoStyle();
    else if (action === "everScroll") toggleEverScrollMode();
    else if (action === "ledGlow") toggleLedGlow();
    else if (action === "openCustomize") setCustomizeMenuView(true);
    else if (action === "backToMain") setCustomizeMenuView(false);
    else if (action === "close") setMenuOpen(false);
  }

  function clampVolume01(value) {
    const n = Number(value);
    return clamp(Number.isFinite(n) ? n : 0, 0, 1);
  }

  function isBandAudioActive() {
    return bandPresetIdx >= 0 && !!getFmAudio();
  }

  function getSpotifyVolumeSafe(now = performance.now(), force = false) {
    if (force || now - volumeStateCache.at > VOLUME_SAMPLE_MS) {
      const raw = safeReturn(() => Spicetify.Player.getVolume(), volumeStateCache.value);
      volumeStateCache.value = clampVolume01(raw);
      volumeStateCache.at = now;
    }
    return volumeStateCache.value;
  }

  function getFmVolumeSafe() {
    const audio = getFmAudio();
    if (!audio) return getSpotifyVolumeSafe();
    return clampVolume01(audio.volume);
  }

  function getActiveHardwareVolume(now = performance.now(), force = false) {
    if (pendingVolume !== null) return pendingVolume;
    return isBandAudioActive() ? getFmVolumeSafe() : getSpotifyVolumeSafe(now, force);
  }

  function getPlayerVolume(now = performance.now(), force = false) {
    return getActiveHardwareVolume(now, force);
  }

  function applyFmVolume(volume01) {
    const audio = getFmAudio();
    if (!audio) return;
    audio.volume = clampVolume01(volume01);
  }

  function mirrorSpotifyVolume(volume01) {
    const volume = clampVolume01(volume01);
    volumeStateCache.value = volume;
    volumeStateCache.at = performance.now();
    safe(() => Spicetify.Player.setVolume(volume));
  }

  function refreshVolumeUiFromActiveSource() {
    markVolumeReadoutsDirty();
    updateLknobLED();
  }

  function setHardwareVolume(volume01) {
    const volume = clampVolume01(volume01);
    if (isBandAudioActive()) {
      applyFmVolume(volume);
      mirrorSpotifyVolume(volume);
    } else {
      mirrorSpotifyVolume(volume);
    }
    refreshVolumeUiFromActiveSource();
  }

  function setVolumeSmooth(v) {
    pendingVolume = clampVolume01(v);
    if (!isBandAudioActive()) {
      volumeStateCache.value = pendingVolume;
      volumeStateCache.at = performance.now();
    }
    markStaticReadoutsDirty();
    updateLknobLED();
    if (volumeCommitTimer) return;
    volumeCommitTimer = setTimeout(() => {
      const next = pendingVolume;
      volumeCommitTimer = null;
      pendingVolume = null;
      if (next === null) return;
      setHardwareVolume(next);
    }, 35);
  }

  // Called from the volume knob's user-input paths (scroll wheel, drag).
  // If the user touches the volume while ATT is active, we cancel ATT
  // without restoring the snapshot — their fresh adjustment becomes the
  // new volume. Matches period radios where any volume input dismissed ATT.
  function exitAttOnUserVolumeInput() {
    if (!attActive) return;
    attActive = false;
    const attPill = chassis && chassis.querySelector("[data-pvfd='att']");
    if (attPill) attPill.classList.remove("active");
    if (chassis) chassis.removeAttribute("data-pvfd-att");
    markStaticReadoutsDirty();
  }

  // ATT toggle. Snapshots current volume and applies the attenuator per
  // attMode ("mute" → 0; "soft" → currentVolume * ATT_SOFT_MULTIPLIER).
  // A second press restores the snapshot. Mirrors the real Pioneer ATT
  // button: instant on, instant off. Mode is controlled by the M.C. menu.
  function toggleAttMode() {
    if (attActive) {
      attActive = false;
      setVolumeSmooth(attPriorVolume);
    } else {
      attPriorVolume = getPlayerVolume();
      attActive = true;
      const next = attMode === "soft" ? attPriorVolume * ATT_SOFT_MULTIPLIER : 0;
      setVolumeSmooth(next);
    }
    const attPill = chassis && chassis.querySelector("[data-pvfd='att']");
    if (attPill) attPill.classList.toggle("active", attActive);
    // Mirror onto the chassis so CSS can re-skin the left LCD VOL readout.
    if (chassis) {
      if (attActive) chassis.setAttribute("data-pvfd-att", "on");
      else chassis.removeAttribute("data-pvfd-att");
    }
    // Force the side-readout pass to redraw immediately so the VOL row
    // swaps to ATTENUATOR without waiting for the next sample tick.
    markStaticReadoutsDirty();
  }

  function activePlayerTimingSampleMs() {
    return PLAYER_TIMING_SAMPLE_MS;
  }

  function projectedPlayerProgressMs(ts = performance.now()) {
    if (!Number.isFinite(playerTimingCache.at)) return playerTimingCache.progressMs || 0;
    const elapsed = playerTimingCache.playing ? Math.max(0, ts - playerTimingCache.at) : 0;
    const duration = playerTimingCache.durationMs;
    const projected = playerTimingCache.progressMs + elapsed;
    return duration > 0 ? clamp(projected, 0, duration) : projected;
  }

  function getSampledPlaybackTiming(ts = performance.now(), force = false) {
    if (force || ts - playerTimingCache.at >= activePlayerTimingSampleMs()) {
      const projectedProgressMs = projectedPlayerProgressMs(ts);
      const sampledProgressMs = safeReturn(() => Spicetify.Player.getProgress(), projectedProgressMs) || 0;
      const durationMs = getCurrentDurationMs();
      const playing = safePlayerIsPlaying(playerTimingCache.playing);
      let progressMs = sampledProgressMs;

      if (logoGlowEnabled && !force && playing && playerTimingCache.playing && Number.isFinite(playerTimingCache.at)) {
        const correctionMs = sampledProgressMs - projectedProgressMs;
        progressMs = Math.abs(correctionMs) <= 450
          ? projectedProgressMs + correctionMs * LOGO_GLOW_TIMING_SMOOTHING
          : sampledProgressMs;
      }

      playerTimingCache.at = ts;
      playerTimingCache.progressMs = durationMs > 0 ? clamp(progressMs, 0, durationMs) : progressMs;
      playerTimingCache.durationMs = durationMs;
      playerTimingCache.playing = playing;
    }

    return {
      progressMs: projectedPlayerProgressMs(ts),
      durationMs: playerTimingCache.durationMs,
      playing: playerTimingCache.playing,
    };
  }

  function getDisplayProgressMs(ts = performance.now(), timing = getSampledPlaybackTiming(ts)) {
    if (scrubPreviewMs !== null && ts < scrubPreviewUntil) return scrubPreviewMs;
    scrubPreviewMs = null;
    return timing.progressMs;
  }

  function seekToMs(ms) {
    const duration = getCurrentDurationMs();
    const target = clamp(ms || 0, 0, duration > 0 ? duration : Number.MAX_SAFE_INTEGER);
    scrubPreviewMs = target;
    scrubPreviewUntil = performance.now() + 700;
    playerTimingCache.at = -Infinity;
    safe(() => Spicetify.Player.seek(target));
  }

  function seekByMs(deltaMs) {
    seekToMs(getDisplayProgressMs() + deltaMs);
  }

  function seekToFraction(frac) {
    const duration = getCurrentDurationMs();
    if (!duration) return;
    seekToMs(clamp(frac, 0, 1) * duration);
  }

  function bindProgressScrubber(el) {
    if (!el) return;
    let scrubRect = null;
    let pendingTarget = null;
    let commitTimer = 0;

    // Visual preview updates on every pointermove (instant feedback through
    // scrubPreviewMs). The actual Spicetify.Player.seek() commits are
    // debounced — without this, fast back-and-forth scrubbing fires 120+
    // overlapping async seeks that race in Spotify's audio engine and make
    // the displayed position jump erratically until the in-flight seeks
    // settle. 80ms commit window matches roughly what Spotify can chew
    // through cleanly without queuing.
    const commit = () => {
      commitTimer = 0;
      if (pendingTarget === null) return;
      const target = pendingTarget;
      pendingTarget = null;
      safe(() => Spicetify.Player.seek(target));
    };

    const apply = (e) => {
      const rect = scrubRect || el.getBoundingClientRect();
      if (!rect.width) return;
      const duration = getCurrentDurationMs();
      if (!duration) return;
      const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const target = frac * duration;
      // Visual: write the CSS variable directly on every pointermove so the
      // bar/thumb tracks the cursor at native pointer rate (60-240Hz) instead
      // of waiting for the next render-loop tick (30-60fps). Without this,
      // each move incurred up to ~33ms of perceived lag because --pvfd-progress
      // only updated when the main render loop next ran. scrubPreviewMs still
      // gets set so the render loop reads the right value when it does run.
      el.style.setProperty("--pvfd-progress", (frac * 100).toFixed(2) + "%");
      scrubPreviewMs = target;
      scrubPreviewUntil = performance.now() + 700;
      playerTimingCache.at = -Infinity;
      // Engine: debounce so we don't queue overlapping seeks.
      pendingTarget = target;
      if (!commitTimer) commitTimer = window.setTimeout(commit, 80);
    };

    let activePointer = null;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      activePointer = e.pointerId;
      scrubRect = el.getBoundingClientRect();
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      apply(e);
      el.classList.add("scrubbing");
    });
    el.addEventListener("pointermove", (e) => {
      if (activePointer !== e.pointerId) return;
      e.preventDefault();
      apply(e);
    });
    const end = () => {
      activePointer = null;
      scrubRect = null;
      el.classList.remove("scrubbing");
      // On release, flush any pending seek immediately so the final landing
      // position is committed without waiting out the 80ms debounce.
      if (commitTimer) {
        clearTimeout(commitTimer);
        commit();
      }
      // Extend the visual preview lock past Spotify's typical seek+buffer
      // window. Without this, scrubPreviewMs invalidates after 700ms while
      // the player is still mid-seek and reporting the OLD position; the
      // bar visibly bounces back to old, then snaps to new once Spotify
      // catches up. 2000ms covers the worst-case buffer reload on slower
      // connections; under normal conditions Spotify lands well inside
      // this window and the transition to player-reported state is
      // imperceptible because the values match.
      scrubPreviewUntil = performance.now() + 2000;
      // Also force the player timing cache to re-sample on the next read
      // after the preview window expires, so we read Spotify's settled
      // position rather than a stale cached value from before the seek.
      playerTimingCache.at = -Infinity;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function wireControls() {
    pvfdDiag.wireControlsCalls++;
    const $ = (sel) => chassis.querySelector(sel);

    // Wrap addEventListener on the drag elements so the diagnostic can count
    // registrations per element. If wireControls is ever called twice on the
    // same DOM node, listenersAdded.<label> will be 2x the per-run count and
    // every drag event will dispatch through duplicated handlers.
    const instrumentDragEl = (el, label) => {
      if (!el || el.__pvfdInstrumented) return el;
      el.__pvfdInstrumented = true;
      const orig = el.addEventListener.bind(el);
      el.addEventListener = function (type, fn, opts) {
        pvfdDiag.listenersAdded[label] = (pvfdDiag.listenersAdded[label] || 0) + 1;
        return orig(type, fn, opts);
      };
      return el;
    };

    populateTintMenu();

    const lknob = instrumentDragEl($("[data-pvfd='lknob']"), "lknob");
    if (lknob) {
      const knobCenter = () => {
        const rect = lknob.getBoundingClientRect();
        return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      };
      const pointerAngleDeg = (e, center = knobCenter()) => {
        const { cx, cy } = center;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        // 0deg is straight up / 12 o'clock. Positive is clockwise.
        return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      };
      lknob.addEventListener("wheel", (e) => {
        e.preventDefault();
        exitAttOnUserVolumeInput();
        const step = clamp(-e.deltaY / 1200, -0.04, 0.04);
        setVolumeSmooth(getPlayerVolume() + step);
      }, { passive: false });
      let volumeDrag = null;
      let mcHoldTimer = null;
      let mcHoldStart = null;
      const cancelMcHold = () => {
        if (mcHoldTimer) { clearTimeout(mcHoldTimer); mcHoldTimer = null; }
        mcHoldStart = null;
      };
      lknob.addEventListener("pointerdown", (e) => {
        // While M.C. menu is open, pointerdown on the knob just closes it
        // and suppresses the drag — prevents accidental volume changes when
        // the user is trying to dismiss the menu.
        if (mcMenuOpen) {
          setMcMenuOpen(false);
          e.preventDefault();
          return;
        }
        const center = knobCenter();
        volumeDrag = {
          ...center,
          lastAngle: pointerAngleDeg(e, center),
          startVolume: getPlayerVolume(),
          accumDeg: 0
        };
        if (lknob.setPointerCapture) lknob.setPointerCapture(e.pointerId);
        lknob.classList.add("dragging");

        // M.C. hold detection: only arm if pointerdown lands inside the
        // center hot zone (cap area). Outer ring presses are pure drag.
        const rect = lknob.getBoundingClientRect();
        const radius = Math.min(rect.width, rect.height) / 2;
        const dist = Math.hypot(e.clientX - center.cx, e.clientY - center.cy);
        if (radius > 0 && dist / radius <= MC_CENTER_HIT_FRACTION) {
          mcHoldStart = { x: e.clientX, y: e.clientY };
          mcHoldTimer = setTimeout(() => {
            mcHoldTimer = null;
            // Tear down the drag we started on pointerdown so the menu open
            // doesn't leave a stale drag accumulating rotation.
            volumeDrag = null;
            lknob.classList.remove("dragging");
            setMcMenuOpen(true);
          }, MC_HOLD_MS);
        }

        e.preventDefault();
      });
      lknob.addEventListener("pointermove", (e) => {
        if (mcHoldStart && (Math.abs(e.clientX - mcHoldStart.x) > MC_HOLD_MOVE_THRESHOLD_PX
                          || Math.abs(e.clientY - mcHoldStart.y) > MC_HOLD_MOVE_THRESHOLD_PX)) {
          cancelMcHold();
        }
        if (!volumeDrag) return;
        const a = pointerAngleDeg(e, volumeDrag);
        let d = a - volumeDrag.lastAngle;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        volumeDrag.accumDeg += d;
        volumeDrag.lastAngle = a;
        // Only exit ATT once the user has actually MOVED the knob, not on
        // pointerdown — a stray click on the knob shouldn't clear ATT.
        if (Math.abs(volumeDrag.accumDeg) > 2) exitAttOnUserVolumeInput();
        setVolumeSmooth(volumeDrag.startVolume + volumeDrag.accumDeg / 360);
        e.preventDefault();
      });
      const endVolumeDrag = () => {
        cancelMcHold();
        volumeDrag = null;
        lknob.classList.remove("dragging");
      };
      lknob.addEventListener("pointerup", endVolumeDrag);
      lknob.addEventListener("pointercancel", endVolumeDrag);
      lknob.addEventListener("lostpointercapture", endVolumeDrag);
    }

    // M.C. menu open/close + row click wiring. Outside-click closes; clicking
    // a row mutates the corresponding state and refreshes the row labels.
    const mcMenuEl = $("[data-pvfd='mc-menu']");
    if (mcMenuEl) {
      mcMenuEl.querySelectorAll("[data-pvfd-mc-row]").forEach((row) => {
        row.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const which = row.dataset.pvfdMcRow;
          if (which === "att")       cycleAttMode();
          else if (which === "glow") toggleKnobGlow();
        });
      });
    }
    // Outside-click handler is attached once and gates on mcMenuOpen.
    document.addEventListener("pointerdown", (e) => {
      if (!mcMenuOpen) return;
      if (!mcMenuEl) return;
      if (mcMenuEl.contains(e.target)) return;
      // The knob's own pointerdown handler already closes the menu and
      // suppresses drag; don't double-close from here.
      const knobEl = $("[data-pvfd='lknob']");
      if (knobEl && knobEl.contains(e.target)) return;
      setMcMenuOpen(false);
    }, true);

    const navring = instrumentDragEl($("[data-pvfd='navring']"), "navring");
    if (navring) {
      navring.addEventListener("wheel", (e) => {
        e.preventDefault();
        const ticks = clamp(-e.deltaY / 80, -3, 3);
        seekByMs(ticks * SCRUB_MS_PER_TICK);
      }, { passive: false });
      navring.addEventListener("pointerdown", (e) => {
        navDrag = { x: e.clientX, y: e.clientY, start: getDisplayProgressMs() };
        if (navring.setPointerCapture) navring.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      navring.addEventListener("pointermove", (e) => {
        if (!navDrag) return;
        const dx = e.clientX - navDrag.x;
        const dy = navDrag.y - e.clientY;
        seekToMs(navDrag.start + (dx + dy) * 420);
        e.preventDefault();
      });
      const endNavDrag = () => { navDrag = null; };
      navring.addEventListener("pointerup", endNavDrag);
      navring.addEventListener("pointercancel", endNavDrag);
    }

    bindProgressScrubber(instrumentDragEl($("[data-pvfd='trackbar']"), "trackbar"));
    bindMetaPlaybackGlyph($("[data-pvfd='meta-play-toggle']"));
    bindNowPlayingShortcut($(".pvfd-meta-title-window"));

    bind($("[data-pvfd='navcenter']"), () => invokePlayerAction(() => Spicetify.Player.togglePlay()));
    bind($("[data-pvfd='navup']"),    () => safe(() => Spicetify.Player.toggleHeart()));
    bind($("[data-pvfd='navdn']"),    () => safe(() => {
      if (Spicetify.addToQueue && Spicetify.Player.data && Spicetify.Player.data.item) {
        Spicetify.addToQueue([Spicetify.Player.data.item.uri]);
      }
    }));
    bind($("[data-pvfd='navleft']"),  () => invokePlayerAction(() => Spicetify.Player.back(), 300));
    bind($("[data-pvfd='navright']"), () => invokePlayerAction(() => Spicetify.Player.next(), 300));

    bind($("[data-pvfd='att']"), toggleAttMode);
    bind($("[data-pvfd='band']"), cycleBandPreset);

    // Pioneer logo click → DISP prompt (full-screen now-playing confirm).
    const logoEl = chassis.querySelector(".pvfd-silk-pioneer");
    if (logoEl) {
      logoEl.style.cursor = "pointer";
      logoEl.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        setDispPromptOpen(!dispPromptOpen);
      });
    }
    // Outside-click closes the DISP prompt (matches M.C. menu pattern).
    document.addEventListener("pointerdown", (e) => {
      if (!dispPromptOpen) return;
      const prompt = dispPromptEl;
      if (prompt && prompt.contains(e.target)) return;
      if (logoEl && logoEl.contains(e.target)) return;
      setDispPromptOpen(false);
    }, true);

    // Spotify play resumes → exit BAND back to song LCD (option B). Prevents
    // Spotify music playing on top of the BAND broadcast.
    safe(() => Spicetify.Player.addEventListener("onplaypause", () => {
      if (bandPresetIdx < 0) return;
      if (!safeReturn(() => Spicetify.Player.isPlaying(), false)) return;
      spotifyWasPlayingBeforeBand = false;  // don't re-pause what user just resumed
      bandPresetIdx = -1;
      applyBandPreset(true, false);
    }));
    bind($("[data-pvfd='eeq']"), toggleEeqTint);
    bind($("[data-pvfd='lyrics']"), openLyrics);
    bind($("[data-pvfd='dim']"), toggleDimMode);
    bind($("[data-pvfd='clip']"), cycleClipMode);
    bind($("[data-pvfd='tint']"), cycleTintMode);
    bind($("[data-pvfd='demo']"), toggleDemoMode);
    bind($(".pvfd-lcd"), toggleRacingColorFromOel);
    bind($("[data-pvfd='menu']"), () => {
      setMenuOpen(!menuOpen);
    });

    // ESC: back out of nested menus first (tint > customize > main); when no
    // menu is open, navigate to the previous Spotify route. Matches real
    // Pioneer ESC button which exits the current menu context.
    function handleEscBack() {
      // BAND escape — short way out of the cycle, no goBack fall-through.
      if (bandPresetIdx >= 0) {
        bandPresetIdx = -1;
        applyBandPreset(true, false);
        return;
      }
      if (tintMenuOpen) { setTintMenuOpen(false); return; }
      if (menuOpen) {
        if (customizeMenuOpen) setCustomizeMenuView(false);
        else setMenuOpen(false);
        return;
      }
      const history = safeReturn(() => Spicetify.Platform && Spicetify.Platform.History, null);
      if (history && typeof history.goBack === "function") safe(() => history.goBack());
    }
    bind($("[data-pvfd='esc']"), handleEscBack);

  chassis.querySelectorAll("[data-pvfd-menu-action]").forEach((row) => {
    row.setAttribute("role", "menuitem");
    row.setAttribute("tabindex", "0");

    row.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateMenuAction(row.dataset.pvfdMenuAction);
    });

    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      activateMenuAction(row.dataset.pvfdMenuAction);
    });
  });

    // ESC key: same behavior as the ESC pill — close nested menus, otherwise
    // no-op (keyboard Escape should NOT navigate Spotify history; that's
    // intentionally the pill-only behavior to avoid hijacking the key globally).
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (tintMenuOpen) { setTintMenuOpen(false); return; }
      if (!menuOpen) return;
      if (customizeMenuOpen) setCustomizeMenuView(false);
      else setMenuOpen(false);
    });

    bind($("[data-pvfd='shuffle']"), () => invokePlayerAction(() => Spicetify.Player.toggleShuffle()));
    bind($("[data-pvfd='prev']"),    () => invokePlayerAction(() => Spicetify.Player.back(), 300));
    bind($("[data-pvfd='play']"),    () => invokePlayerAction(() => Spicetify.Player.togglePlay()));
    bind($("[data-pvfd='next']"),    () => invokePlayerAction(() => Spicetify.Player.next(), 300));
    bind($("[data-pvfd='repeat']"),  () => invokePlayerAction(() => Spicetify.Player.toggleRepeat()));
    bind($("[data-pvfd='love']"),    () => safe(() => Spicetify.Player.toggleHeart()));
    bind($("[data-pvfd='queue']"),   () => {
      const q = document.querySelector("[data-testid='control-button-queue']");
      if (q) q.click();
    });
    bind($("[data-pvfd='devices']"), () => {
      openDevicePicker();
    });
    bind($("[data-pvfd='eject']"), startEjectSequence);
  }
//no synthetic fallback
  function getLogoSyntheticAudioMetrics() {
    const out = _syntheticMetricsBuf;

    logoLiveSubSlow *= 0.74;
    logoLiveLowSlow *= 0.74;
    logoLiveMidSlow *= 0.74;
    logoLivePresenceSlow *= 0.74;
    logoLiveHighSlow *= 0.74;

    out.sub = 0;
    out.low = 0;
    out.mid = 0;
    out.presence = 0;
    out.high = 0;

    out.subFlux = 0;
    out.lowFlux = 0;
    out.midFlux = 0;
    out.presenceFlux = 0;
    out.highFlux = 0;

    return out;
  }

  async function startLogoLiveAudioCapture() {
    if (logoLiveAudioActive || logoLiveAudioPending) return logoLiveAudioActive;
    logoLiveAudioPending = true;
    updateMenuPanel();
    try {
      // Chromium desktop capture only. If this fails, PULSE turns back off cleanly.
      stopLogoLiveAudioCapture();
      resetLogoLiveAudioState();
      setLogoAudioGlowVars(0.10, 0.10, 0.10, 0.10, 0.10, 0.10, 0);
      logoLiveAudioActive = true;
      startLogoLiveAudioScheduler();
      console.log("[PVFD] pulse visualizer active");
      return true;
    } catch (err) {
      console.warn("[PVFD] pulse visualizer start failed:", err);
      logoLiveAudioActive = false;
      return false;
    } finally {
      logoLiveAudioPending = false;
      updateMenuPanel();
    }
  }

  // Stops the per-pause envelope scheduler. Does NOT touch the desktop
  // capture stream — that lifecycle is owned by start/stopDesktopAudioCapture so
  // the user keeps their granted screen-share across pause/play.
  function stopLogoLiveAudioCapture() {
    stopLogoLiveAudioScheduler();
    logoLiveAudioActive = false;
    logoLiveAudioPending = false;
    resetLogoLiveAudioState();
    setLogoAudioGlowVars(0, 0, 0, 0, 0, 0, 0);
    updateMenuPanel();
  }

  function pulseDisplayMediaOptions() {
    return {
      video: { displaySurface: "browser" },
      audio: { suppressLocalAudioPlayback: false },
      selfBrowserSurface: "exclude",
      systemAudio: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "include",
    };
  }

  function requestPulseDisplayMediaStream() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      throw new Error("getDisplayMedia not available in this Spotify build");
    }
    return navigator.mediaDevices.getDisplayMedia(pulseDisplayMediaOptions());
  }

  function selectPulseAudioTrack(stream) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      throw new Error("no system audio in stream — enable 'Also share system audio' in the picker");
    }
    const audioTrack = audioTracks[0];
    // Tab audio comes back silent because Spotify's playback goes to the OS
    // audio stack, not the renderer media element. Reject it cleanly.
    if (audioTrack.label && audioTrack.label.toLowerCase().includes("tab")) {
      throw new Error("tab audio selected; pick a screen/window with system audio enabled");
    }
    return audioTrack;
  }

  function showPulseLiveFailureNotification(message) {
    const msg = String(message || "live capture failed");
    const text = isLinuxLikePlatform()
      ? [
          "PULSE on Linux: Spotify may be hidden by xdg-desktop-portal.",
          "Try selecting your monitor and enabling \"Share system audio\".",
          "See GitHub issue #16.",
          msg
        ].join("\n")
      : "PULSE LIVE: " + msg;
    safe(() => Spicetify.showNotification && Spicetify.showNotification(text));
  }

  // -------- HLPR (Linux audio helper) bridge --------
  //
  // Consent modal — asks whether the user wants to launch the HLPR helper
  // instead of going through getDisplayMedia. Returns "yes" | "no" |
  // "remember-yes" | "remember-no". The remember-* variants persist the
  // user's choice so we don't ask again on this Spotify profile (clear with
  // localStorage.removeItem to re-prompt).
  // Falls back to a confirm() if Spicetify.PopupModal isn't available.
  function showHlprConsentModal() {
    return new Promise((resolve) => {
      const fallback = () => {
        const ok = safeReturn(() => window.confirm(
          "PioneerVFD: PULSE on Linux needs the HLPR helper.\n\n" +
          "Download pvfd-hlpr from:\n" + HLPR_RELEASES_URL + "\n\n" +
          "Run it in a terminal, then click OK.\n" +
          "Click Cancel to skip PULSE for this session."
        ), false);
        resolve(ok ? "yes" : "no");
      };
      if (!window.Spicetify || !Spicetify.PopupModal || typeof Spicetify.PopupModal.display !== "function") {
        fallback();
        return;
      }
      const container = document.createElement("div");
      container.className = "pvfd-hlpr-modal";
      container.innerHTML =
        '<p style="margin:0 0 12px 0;line-height:1.45">' +
        "Chromium audio capture on Linux is unreliable — most setups don't list " +
        "Spotify in the picker, and even when they do, the resulting audio track " +
        "is silent (Spotify outputs to PipeWire, not the renderer). " +
        '(<a href="https://github.com/adainstarks/PioneerVFD/issues/16" target="_blank" rel="noopener">issue #16</a>)' +
        "</p>" +
        '<p style="margin:0 0 12px 0;line-height:1.45">' +
        "PVFD ships a small helper, <b>pvfd-hlpr</b>, that taps PipeWire directly. " +
        "Download it, run it in a terminal, and PULSE will connect automatically." +
        "</p>" +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px 0">' +
        '<button type="button" data-pvfd-hlpr-action="download" style="padding:8px 14px;background:#0a84ff;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600">Download HLPR (Releases)</button>' +
        '<button type="button" data-pvfd-hlpr-action="yes" style="padding:8px 14px;background:#1db954;color:#000;border:0;border-radius:4px;cursor:pointer;font-weight:600">I\'m running it — connect</button>' +
        '<button type="button" data-pvfd-hlpr-action="no" style="padding:8px 14px;background:#444;color:#fff;border:0;border-radius:4px;cursor:pointer">Skip PULSE</button>' +
        "</div>" +
        '<details style="margin:0 0 10px 0;font-size:12.5px;opacity:0.85">' +
        '<summary style="cursor:pointer">From source / Arch users</summary>' +
        '<pre style="background:#111;color:#7CFC7C;padding:10px;margin:8px 0 0 0;border-radius:4px;font-family:Consolas,monospace;font-size:12.5px;white-space:pre-wrap" data-pvfd-hlpr-cmd>pipx install git+https://github.com/adainstarks/PVFD-Linux-Helper.git &amp;&amp; pvfd-hlpr</pre>' +
        "</details>" +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;opacity:0.8">' +
        '<input type="checkbox" data-pvfd-hlpr-remember> Don\'t ask again on this profile' +
        "</label>";

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        safe(() => Spicetify.PopupModal.hide && Spicetify.PopupModal.hide());
        resolve(result);
      };

      container.addEventListener("click", (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute("data-pvfd-hlpr-action");
        if (!action) return;
        const remember = container.querySelector('[data-pvfd-hlpr-remember]');
        const wantRemember = !!(remember && remember.checked);
        if (action === "download") {
          safe(() => window.open(HLPR_RELEASES_URL, "_blank", "noopener,noreferrer"));
          target.textContent = "Opened ↗";
          setTimeout(() => { if (target) target.textContent = "Download HLPR (Releases)"; }, 1600);
          return;
        }
        if (action === "yes") return finish(wantRemember ? "remember-yes" : "yes");
        if (action === "no") return finish(wantRemember ? "remember-no" : "no");
      });

      safe(() => Spicetify.PopupModal.display({
        title: "PioneerVFD — Linux PULSE helper",
        content: container,
        isLarge: false,
      }));

      // Spicetify's modal close button fires no callback we can hook, so we
      // observe DOM removal and treat dismissal as "no".
      const observer = new MutationObserver(() => {
        if (!document.body.contains(container)) {
          observer.disconnect();
          finish("no");
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Stub analyser/ctx so readLogoLiveAudioMetrics() consumes HLPR bytes
  // through its existing pipeline. The "analyser" copies the latest received
  // bin buffer into the caller's output array, mimicking
  // AnalyserNode.getByteFrequencyData on a real getDisplayMedia stream.
  function installHlprFakeAnalyser() {
    const binCount = DESKTOP_CAPTURE_FFT_SIZE / 2;
    logoLiveAudioBins = new Uint8Array(binCount);
    logoLivePrevBins = new Uint8Array(binCount);
    hlprLatestBins = new Uint8Array(binCount);
    logoLiveAudioCtx = {
      sampleRate: HLPR_VIRTUAL_SAMPLE_RATE,
      close: () => {},
    };
    logoLiveAudioAnalyser = {
      fftSize: DESKTOP_CAPTURE_FFT_SIZE,
      frequencyBinCount: binCount,
      smoothingTimeConstant: 0.32,
      getByteFrequencyData: (out) => {
        if (!out || !hlprLatestBins) return;
        const n = Math.min(out.length, hlprLatestBins.length);
        for (let i = 0; i < n; i++) out[i] = hlprLatestBins[i];
      },
    };
  }

  function clearHlprFakeAnalyser() {
    logoLiveAudioBins = null;
    logoLivePrevBins = null;
    logoLiveAudioCtx = null;
    logoLiveAudioAnalyser = null;
    hlprLatestBins = null;
  }

  function applyHlprFrame(data) {
    if (!hlprLatestBins) return;
    let view;
    if (data instanceof ArrayBuffer) view = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else return;
    const n = Math.min(view.length, hlprLatestBins.length);
    for (let i = 0; i < n; i++) hlprLatestBins[i] = view[i];
    for (let i = n; i < hlprLatestBins.length; i++) hlprLatestBins[i] = 0;
  }

  function handleHlprHello(text) {
    let info = null;
    try { info = JSON.parse(text); } catch (_) { return false; }
    if (!info || info.type !== "hello") return false;
    hlprHelloInfo = info;
    const remoteProto = Number(info.protocol);
    if (!Number.isFinite(remoteProto) || remoteProto !== HLPR_PROTOCOL_VERSION) {
      hlprProtocolMismatched = true;
      const reason =
        "HLPR protocol mismatch (PVFD expects v" + HLPR_PROTOCOL_VERSION +
        ", HLPR sent v" + (Number.isFinite(remoteProto) ? remoteProto : "?") +
        "). Update pvfd-hlpr from " + HLPR_RELEASES_URL;
      pulseLiveFailureReason = reason;
      safe(() => Spicetify.showNotification && Spicetify.showNotification(reason));
      console.warn("[PVFD] " + reason);
      return false;
    }
    hlprProtocolMismatched = false;
    return true;
  }

  function connectHlprSocket() {
    if (hlprSocket) {
      safe(() => hlprSocket.close());
      hlprSocket = null;
    }
    let ws;
    try {
      ws = new WebSocket(HLPR_WS_URL);
      ws.binaryType = "arraybuffer";
    } catch (err) {
      console.warn("[PVFD] HLPR socket construct failed:", err);
      scheduleHlprReconnect();
      return;
    }
    hlprSocket = ws;
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        // First text frame is the protocol-v1 hello. If mismatched, the close
        // handler will run via ws.close() and we won't reconnect this cycle.
        const ok = handleHlprHello(ev.data);
        if (!ok) {
          safe(() => ws.close());
          return;
        }
        if (!hlprLatestBins) installHlprFakeAnalyser();
        hlprReconnectDelayMs = HLPR_RECONNECT_MIN_MS;
        if (hlprFirstConnectNotifyTimer) {
          clearTimeout(hlprFirstConnectNotifyTimer);
          hlprFirstConnectNotifyTimer = 0;
        }
        desktopCaptureActive = true;
        desktopCapturePending = false;
        hlprBridgeActive = true;
        hlprBridgePending = false;
        pulseLiveFailureReason = "";
        console.log("[PVFD] HLPR bridge connected (helper v" + (hlprHelloInfo && hlprHelloInfo.version || "?") + ")");
        updateMenuPanel();
        return;
      }
      applyHlprFrame(ev.data);
    });
    ws.addEventListener("close", () => {
      if (ws === hlprSocket) hlprSocket = null;
      const wasActive = hlprBridgeActive;
      hlprBridgeActive = false;
      if (wasActive) {
        desktopCaptureActive = false;
        if (hlprLatestBins) hlprLatestBins.fill(0);
        if (logoLiveAudioBins) logoLiveAudioBins.fill(0);
        if (logoLivePrevBins) logoLivePrevBins.fill(0);
        console.warn("[PVFD] HLPR bridge socket closed");
        updateMenuPanel();
      }
      // Don't auto-reconnect into a known protocol mismatch — that would
      // spam the notification banner every backoff cycle.
      if (hlprProtocolMismatched) return;
      if (hlprBridgePending || logoGlowEnabled) {
        scheduleHlprReconnect();
      }
    });
    ws.addEventListener("error", () => {
      // 'close' fires right after; let that drive reconnect.
    });
  }

  function scheduleHlprReconnect() {
    if (hlprReconnectTimer) return;
    if (hlprProtocolMismatched) return;
    const delay = hlprReconnectDelayMs;
    hlprReconnectDelayMs = Math.min(HLPR_RECONNECT_MAX_MS, Math.round(hlprReconnectDelayMs * 1.6));
    hlprReconnectTimer = setTimeout(() => {
      hlprReconnectTimer = 0;
      if (!logoGlowEnabled && !hlprBridgePending) return;
      connectHlprSocket();
    }, delay);
  }

  function armHlprFirstConnectNotify() {
    if (hlprFirstConnectNotifyTimer) clearTimeout(hlprFirstConnectNotifyTimer);
    hlprFirstConnectNotifyTimer = setTimeout(() => {
      hlprFirstConnectNotifyTimer = 0;
      if (hlprBridgeActive || hlprProtocolMismatched) return;
      pulseLiveFailureReason = "HLPR not detected on :" + HLPR_DEFAULT_PORT;
      desktopCapturePending = false;
      safe(() => Spicetify.showNotification && Spicetify.showNotification(
        "PULSE: HLPR not detected on :" + HLPR_DEFAULT_PORT + ". Run pvfd-hlpr in a terminal."
      ));
      updateMenuPanel();
    }, HLPR_FIRST_CONNECT_NOTIFY_MS);
  }

  function stopHlprBridge() {
    if (hlprReconnectTimer) {
      clearTimeout(hlprReconnectTimer);
      hlprReconnectTimer = 0;
    }
    if (hlprFirstConnectNotifyTimer) {
      clearTimeout(hlprFirstConnectNotifyTimer);
      hlprFirstConnectNotifyTimer = 0;
    }
    if (hlprSocket) {
      safe(() => hlprSocket.close());
      hlprSocket = null;
    }
    hlprBridgeActive = false;
    hlprBridgePending = false;
    hlprProtocolMismatched = false;
    hlprHelloInfo = null;
    hlprReconnectDelayMs = HLPR_RECONNECT_MIN_MS;
    clearHlprFakeAnalyser();
  }

  // Linux PULSE entry point. Asks consent (unless previously opted out),
  // then kicks the WS reconnect loop. Resolves true if the bridge is
  // reachable OR pending — false only on outright user-decline.
  async function startHlprBridge() {
    if (hlprBridgeActive) return true;
    if (hlprBridgePending) return true;
    if (hlprConsentInFlight) return false;
    desktopCapturePending = false;
    const persistedOptInValue = safeReturn(
      () => window.localStorage.getItem(HLPR_OPT_IN_STORAGE_KEY),
      null
    );
    const persistedOptIn = persistedOptInValue === "ON";
    const persistedOptOutValue = safeReturn(
      () => window.localStorage.getItem(HLPR_OPT_OUT_STORAGE_KEY),
      null
    );
    const persistedOptOut = persistedOptOutValue === "ON" || persistedOptOutValue === "yes";
    if (persistedOptIn) {
      hlprBridgePending = true;
      pulseLiveFailureReason = "";
      armHlprFirstConnectNotify();
      connectHlprSocket();
      updateMenuPanel();
      return true;
    }
    if (persistedOptOut) {
      pulseLiveFailureReason =
        "HLPR opt-out remembered — clear localStorage keys " + HLPR_OPT_OUT_STORAGE_KEY + " / " + HLPR_OPT_IN_STORAGE_KEY + " to re-prompt";
      return false;
    }
    hlprConsentInFlight = true;
    desktopCapturePending = true;
    updateMenuPanel();
    let consent;
    try {
      consent = await showHlprConsentModal();
    } finally {
      hlprConsentInFlight = false;
    }
    if (consent === "no" || consent === "remember-no") {
      if (consent === "remember-no") {
        safe(() => window.localStorage.setItem(HLPR_OPT_OUT_STORAGE_KEY, "ON"));
      }
      desktopCapturePending = false;
      pulseLiveFailureReason = "HLPR declined";
      updateMenuPanel();
      return false;
    }
    if (consent === "remember-yes") {
      safe(() => window.localStorage.setItem(HLPR_OPT_IN_STORAGE_KEY, "ON"));
    }
    hlprBridgePending = true;
    desktopCapturePending = false;
    pulseLiveFailureReason = "";
    armHlprFirstConnectNotify();
    connectHlprSocket();
    updateMenuPanel();
    return true;
  }

  async function startDesktopAudioCapture() {
    if (desktopCaptureActive || desktopCapturePending) return desktopCaptureActive;
    // Linux: skip getDisplayMedia — the portal route doesn't work reliably,
    // and picking Spotify in the picker yields silence anyway because its
    // playback goes to PipeWire, not the renderer. Route through HLPR.
    if (isLinuxLikePlatform()) {
      return await startHlprBridge();
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      pulseLiveFailureReason = "getDisplayMedia not available in this Spotify build";
      showPulseLiveFailureNotification(pulseLiveFailureReason);
      return false;
    }
    desktopCapturePending = true;
    pulseLiveFailureReason = "";
    updateMenuPanel();
    let stream = null;
    try {
      // selfBrowserSurface:"exclude" is the critical option: it stops the user
      // from picking Spotify's own window, which both avoids the historical
      // compositor feedback loop that froze the clock/scrubber/LCD AND keeps
      // the picker honest — picking Spotify yields a silent track anyway
      // (playback goes to the OS audio stack, not through the renderer).
      stream = await requestPulseDisplayMediaStream();
      // We only want audio. Drop video tracks immediately.
      stream.getVideoTracks().forEach((track) => safe(() => track.stop()));
      const audioTrack = selectPulseAudioTrack(stream);
      audioTrack.addEventListener("ended", () => {
        // Fires when user clicks "Stop sharing" in Chrome's banner.
        stopDesktopAudioCapture();
      });

      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtor();
      const sourceNode = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = DESKTOP_CAPTURE_FFT_SIZE;
      // Lower smoothingTimeConstant exposes short transients (pick attacks,
      // hi-hat hits, vocal sibilance) instead of being smeared away before
      // the band-energy and flux measurements even see them. Sustained bass
      // is still smooth because band-level RMS averages across multiple bins.
      analyser.smoothingTimeConstant = 0.32;
      sourceNode.connect(analyser);

      logoLiveAudioStream = stream;
      logoLiveAudioCtx = audioCtx;
      logoLiveAudioAnalyser = analyser;
      logoLiveAudioBins = new Uint8Array(analyser.frequencyBinCount);
      logoLivePrevBins = new Uint8Array(analyser.frequencyBinCount);
      desktopCaptureActive = true;
      pulseLiveFailureReason = "";
      console.log(`[PVFD] desktop audio capture active: ${audioTrack.label || "system audio"}`);
      return true;
    } catch (err) {
      // Cleanup any partial stream on failure.
      if (stream && stream.getTracks) stream.getTracks().forEach((track) => safe(() => track.stop()));
      const msg = safeErrorSummary(err);
      pulseLiveFailureReason = String(msg || "live capture failed");
      console.warn("[PVFD] pulse live capture failed:", msg);
      showPulseLiveFailureNotification(pulseLiveFailureReason);
      return false;
    } finally {
      desktopCapturePending = false;
      updateMenuPanel();
    }
  }

  function stopDesktopAudioCapture() {
    // Tear down HLPR (Linux helper bridge) if active. Safe to call when inactive.
    stopHlprBridge();
    if (logoLiveAudioStream && logoLiveAudioStream.getTracks) {
      logoLiveAudioStream.getTracks().forEach((track) => safe(() => track.stop()));
    }
    if (logoLiveAudioCtx && typeof logoLiveAudioCtx.close === "function") {
      safe(() => logoLiveAudioCtx.close());
    }
    logoLiveAudioStream = null;
    logoLiveAudioCtx = null;
    logoLiveAudioAnalyser = null;
    logoLiveAudioBins = null;
    logoLivePrevBins = null;
    desktopCaptureActive = false;
    desktopCapturePending = false;
    updateMenuPanel();
  }

  function startLogoLiveAudioScheduler() {
    lastLogoLiveAudioUpdateAt = -Infinity;
  }

  function stopLogoLiveAudioScheduler() {
    lastLogoLiveAudioUpdateAt = -Infinity;
    if (!logoLiveAudioSchedulerRaf) return;
    cancelAnimationFrame(logoLiveAudioSchedulerRaf);
    logoLiveAudioSchedulerRaf = 0;
  }

  // Resets the smoothed envelopes used by the pulse loop. Does NOT
  // touch logoLivePrevBins — that buffer's lifecycle belongs to startDesktopAudioCapture.
  function resetLogoLiveAudioState() {
    logoLiveGuitarCentroidPrev = 0;
    logoLiveGuitarMotionEnv = 0;
    logoLiveLastPulseMs = 0;
    logoLiveDebugLastMs = 0;
    logoLiveSubEnv = 0;
    logoLiveBassEnv = 0;
    logoLiveLowMidEnv = 0;
    logoLiveMidEnv = 0;
    logoLiveUpperMidEnv = 0;
    logoLivePresenceEnv = 0;
    logoLiveAirEnv = 0;
    logoLiveLowEnv = 0;
    logoLiveHighEnv = 0;
    logoLiveSubSlow = 0;
    logoLiveLowSlow = 0;
    logoLiveMidSlow = 0;
    logoLivePresenceSlow = 0;
    logoLiveHighSlow = 0;
    logoLiveSubPrev = 0;
    logoLiveBassPrev = 0;
    logoLiveLowMidPrev = 0;
    logoLiveMidPrev = 0;
    logoLiveUpperMidPrev = 0;
    logoLivePresencePrev = 0;
    logoLiveAirPrev = 0;
    logoLiveLowPrev = 0;
    logoLiveHighPrev = 0;
    logoLiveFluxAvg = 0;
    logoLivePunchEnv = 0;
    logoLiveLogoEnv = 0;
    logoLiveStyleCache = Object.create(null);
    lastLogoLiveAudioUpdateAt = -Infinity;
    resetLogoRenderState();
  }

  function setLiveStyleVar(el, key, value, cachePrefix) {
    if (!el) return;
    const cacheKey = cachePrefix + key;
    if (logoLiveStyleCache[cacheKey] === value) return;
    logoLiveStyleCache[cacheKey] = value;
    el.style.setProperty(key, value);
  }

  const LOGO_METER_W = 48;
  const LOGO_METER_H = 23;
  const LOGO_METER_BAND_COUNT = 7;
  const LOGO_GLOW_W = 170;
  const LOGO_GLOW_H = 34;
  const LOGO_RENDER_NORMAL_MS = 33;
  const LOGO_RENDER_STRESS_MS = 66;
  const LOGO_RENDER_EPSILON = 0.0035;

  const logoRenderState = {
    lanes: new Float32Array(LOGO_METER_BAND_COUNT),
    opacities: new Float32Array(LOGO_METER_BAND_COUNT),
    energy: 0,
    punch: 0,
    dirty: true,
    lastRenderAt: -Infinity
  };

  const logoBarSpriteCache = {
    sprite: null,
    paletteVersion: -1
  };

  const logoGlowCanvasCache = {
    canvas: null,
    ctx: null,
    halo: null,
    haloPaletteVersion: -1
  };

  function isLogoRenderStressActive() {
    return (
      (typeof isHomeInteractionStressActive === "function" && isHomeInteractionStressActive()) ||
      (typeof isRouteChurnActive === "function" && isRouteChurnActive()) ||
      (pvfdRouteState && Number.isFinite(pvfdRouteState.churnUntil) && performance.now() < pvfdRouteState.churnUntil)
    );
  }

  function resetLogoRenderState() {
    logoRenderState.lanes.fill(0);
    logoRenderState.opacities.fill(0);
    logoRenderState.energy = 0;
    logoRenderState.punch = 0;
    logoRenderState.dirty = true;
    logoRenderState.lastRenderAt = -Infinity;
    logoBarSpriteCache.sprite = null;
    logoBarSpriteCache.paletteVersion = -1;
    logoGlowCanvasCache.halo = null;
    logoGlowCanvasCache.haloPaletteVersion = -1;
  }

  function getLogoBarSprite() {
    if (
      logoBarSpriteCache.sprite &&
      logoBarSpriteCache.paletteVersion === pvfdPaletteVersion
    ) {
      return logoBarSpriteCache.sprite;
    }

    const sprite = document.createElement("canvas");
    sprite.width = 6;
    sprite.height = LOGO_METER_H;

    const c = sprite.getContext("2d", { alpha: true });
    if (!c) return null;

    c.imageSmoothingEnabled = false;

    const grad = c.createLinearGradient(0, 0, 0, LOGO_METER_H);
    grad.addColorStop(0.00, "rgba(255,255,255,1)");
    grad.addColorStop(0.36, pvfdRgba(pvfdCssPalette.light, 0.96));
    grad.addColorStop(1.00, pvfdRgba(pvfdCssPalette.deep, 0.58));

    c.fillStyle = grad;
    c.fillRect(0, 0, 6, LOGO_METER_H);

    logoBarSpriteCache.sprite = sprite;
    logoBarSpriteCache.paletteVersion = pvfdPaletteVersion;

    return sprite;
  }

  function buildLogoGlowHaloSprite() {
    const halo = document.createElement("canvas");
    halo.width = LOGO_GLOW_W;
    halo.height = LOGO_GLOW_H;

    const c = halo.getContext("2d", { alpha: true });
    if (!c) return null;

    c.imageSmoothingEnabled = false;

    const g = c.createRadialGradient(
      LOGO_GLOW_W * 0.5,
      LOGO_GLOW_H * 0.5,
      1,
      LOGO_GLOW_W * 0.5,
      LOGO_GLOW_H * 0.5,
      Math.max(LOGO_GLOW_W, LOGO_GLOW_H) * 0.48
    );

    g.addColorStop(0.00, "rgba(255,255,255,0.42)");
    g.addColorStop(0.22, pvfdRgba(pvfdCssPalette.light, 0.72));
    g.addColorStop(0.50, pvfdRgba(pvfdCssPalette.mid, 0.38));
    g.addColorStop(0.76, pvfdRgba(pvfdCssPalette.deep, 0.16));
    g.addColorStop(1.00, "rgba(0,0,0,0)");

    c.fillStyle = g;
    c.fillRect(0, 0, LOGO_GLOW_W, LOGO_GLOW_H);

    logoGlowCanvasCache.halo = halo;
    logoGlowCanvasCache.haloPaletteVersion = pvfdPaletteVersion;

    return halo;
  }

  function ensureLogoCanvasReady() {
    if (!logoStrip || !logoStrip.isConnected) {
      logoStrip = chassis && chassis.querySelector(".pvfd-logo-strip");
    }

    if (!logoStrip) return false;

    const left = logoMeterCache.left;
    const right = logoMeterCache.right;
    const glow = logoGlowCanvasCache;

    if (
      !left ||
      !right ||
      !left.canvas ||
      !right.canvas ||
      !left.canvas.isConnected ||
      !right.canvas.isConnected ||
      !glow.canvas ||
      !glow.canvas.isConnected
    ) {
      ensureLogoSpectrumMarkup();
    }

    return !!(
      logoMeterCache.left &&
      logoMeterCache.right &&
      logoMeterCache.left.ctx &&
      logoMeterCache.right.ctx &&
      logoGlowCanvasCache.ctx
    );
  }

  function setLogoRenderState(energy, sub, low, mid, presence, high, punch) {
    const e = clamp(Number(energy) || 0, 0, 1);
    const p = clamp(Number(punch) || 0, 0, 1);

    const envSum =
      logoLiveSubEnv +
      logoLiveBassEnv +
      logoLiveLowMidEnv +
      logoLiveMidEnv +
      logoLiveUpperMidEnv +
      logoLivePresenceEnv +
      logoLiveAirEnv;

    const hasEnv = envSum > 0.001;

    const subLane = hasEnv ? clamp(logoLiveSubEnv, 0, 1) : clamp(sub, 0, 1);
    const bassLane = hasEnv ? clamp(logoLiveBassEnv, 0, 1) : clamp(low, 0, 1);
    const lowMidLane = hasEnv ? clamp(logoLiveLowMidEnv, 0, 1) : clamp(low, 0, 1);
    const midLane = hasEnv ? clamp(logoLiveMidEnv, 0, 1) : clamp(mid, 0, 1);
    const upperMidLane = hasEnv ? clamp(logoLiveUpperMidEnv, 0, 1) : clamp(presence, 0, 1);
    const presenceLane = hasEnv ? clamp(logoLivePresenceEnv, 0, 1) : clamp(presence, 0, 1);
    const airLane = hasEnv ? clamp(logoLiveAirEnv, 0, 1) : clamp(high, 0, 1);

    const presenceDisplay = clamp(upperMidLane * 0.65 + presenceLane * 0.35, 0, 1);

    const nextValues = [
      airLane,
      presenceDisplay,
      upperMidLane,
      midLane,
      lowMidLane,
      bassLane,
      subLane
    ];

    const lanes = logoRenderState.lanes;
    const opacities = logoRenderState.opacities;

    let dirty = false;

    for (let i = 0; i < LOGO_METER_BAND_COUNT; i++) {
      const v = nextValues[i];
      const o = clamp(0.70 + v * 0.30, 0, 1);

      if (Math.abs(lanes[i] - v) >= LOGO_RENDER_EPSILON) {
        lanes[i] = v;
        dirty = true;
      }

      if (Math.abs(opacities[i] - o) >= LOGO_RENDER_EPSILON) {
        opacities[i] = o;
        dirty = true;
      }
    }

    if (Math.abs(logoRenderState.energy - e) >= LOGO_RENDER_EPSILON) {
      logoRenderState.energy = e;
      dirty = true;
    }

    if (Math.abs(logoRenderState.punch - p) >= LOGO_RENDER_EPSILON) {
      logoRenderState.punch = p;
      dirty = true;
    }

    logoRenderState.dirty = logoRenderState.dirty || dirty;
  }

  function drawLogoMeterCanvasFast(cacheEntry, reverse) {
    if (!cacheEntry || !cacheEntry.canvas || !cacheEntry.ctx) return;

    const canvas = cacheEntry.canvas;
    const c = cacheEntry.ctx;

    if (canvas.width !== LOGO_METER_W) canvas.width = LOGO_METER_W;
    if (canvas.height !== LOGO_METER_H) canvas.height = LOGO_METER_H;

    c.clearRect(0, 0, LOGO_METER_W, LOGO_METER_H);

    if (!logoGlowEnabled || !logoLiveAudioActive) return;

    const sprite = getLogoBarSprite();
    if (!sprite) return;

    const lanes = logoRenderState.lanes;
    const opacities = logoRenderState.opacities;

    for (let i = 0; i < LOGO_METER_BAND_COUNT; i++) {
      const srcIdx = reverse ? LOGO_METER_BAND_COUNT - 1 - i : i;
      const value = clamp(lanes[srcIdx] || 0, 0, 1);
      const alpha = clamp(opacities[srcIdx] || 0, 0, 1);

      const x = i * 7;
      const barHeight = Math.max(1, Math.min(LOGO_METER_H, Math.round(1 + value * 22)));
      const y = LOGO_METER_H - barHeight;

      c.globalAlpha = alpha;
      c.drawImage(
        sprite,
        0, LOGO_METER_H - barHeight, 6, barHeight,
        x, y, 6, barHeight
      );

      c.globalAlpha = clamp(alpha * 0.42, 0, 1);
      c.fillStyle = "rgba(255,255,255,0.9)";
      c.fillRect(x, y, 6, 1);
    }

    c.globalAlpha = 1;
  }

  function drawLogoGlowCanvas() {
    const canvas = logoGlowCanvasCache.canvas;
    const c = logoGlowCanvasCache.ctx;

    if (!canvas || !c) return;

    if (canvas.width !== LOGO_GLOW_W) canvas.width = LOGO_GLOW_W;
    if (canvas.height !== LOGO_GLOW_H) canvas.height = LOGO_GLOW_H;

    c.clearRect(0, 0, LOGO_GLOW_W, LOGO_GLOW_H);

    if (!logoGlowEnabled || !logoLiveAudioActive) return;

    const energy = clamp(logoRenderState.energy, 0, 1);
    const punch = clamp(logoRenderState.punch, 0, 1);

    if (energy < 0.012 && punch < 0.012) return;

    let halo = logoGlowCanvasCache.halo;

    if (!halo || logoGlowCanvasCache.haloPaletteVersion !== pvfdPaletteVersion) {
      halo = buildLogoGlowHaloSprite();
    }

    if (!halo) return;

    c.globalAlpha = clamp(0.08 + energy * 0.52 + punch * 0.10, 0, 0.72);

    const scale = 0.92 + energy * 0.12 + punch * 0.04;
    const dw = LOGO_GLOW_W * scale;
    const dh = LOGO_GLOW_H * scale;
    const dx = (LOGO_GLOW_W - dw) * 0.5;
    const dy = (LOGO_GLOW_H - dh) * 0.5;

    c.drawImage(halo, dx, dy, dw, dh);
    c.globalAlpha = 1;
  }

  function renderLogoVisuals(ts = performance.now(), force = false) {
    if (!force && !logoRenderState.dirty) return;
    if (!ensureLogoCanvasReady()) return;

    const interval = isLogoRenderStressActive()
      ? LOGO_RENDER_STRESS_MS
      : LOGO_RENDER_NORMAL_MS;

    if (!force && ts - logoRenderState.lastRenderAt < interval) return;

    const perfAt = pvfdPerfStart();

    logoRenderState.lastRenderAt = ts;
    logoRenderState.dirty = false;

    drawLogoMeterCanvasFast(logoMeterCache.left, false);
    drawLogoMeterCanvasFast(logoMeterCache.right, true);
    drawLogoGlowCanvas();

    pvfdPerfEnd("logoCanvasRender", perfAt);
  }

  function clearLogoVisuals() {
    resetLogoRenderState();
    renderLogoVisuals(performance.now(), true);
  }

  // Compatibility shim:
  // Old name stays so existing start/stop/update call sites do not break.
  // New behavior: no per-frame CSS vars, no text-shadow vars, no DOM-band vars.
  function setLogoAudioGlowVars(energy, sub, low, mid, presence, high, punch) {
    setLogoRenderState(energy, sub, low, mid, presence, high, punch);
    renderLogoVisuals(performance.now(), !logoGlowEnabled || !logoLiveAudioActive);
  }

  function smoothLogoEnvelope(prev, value, attack = LOGO_LIVE_ATTACK, release = LOGO_LIVE_RELEASE) {
    const mix = value > prev ? attack : release;
    return prev + (value - prev) * mix;
  }

  function compressAudioValue(value, gain = 1, curve = 0.70) {
    return clamp(Math.pow(Math.max(0, value) * gain, curve), 0, 1);
  }

  // Per-band AGC: update the band's rolling peak, return a gain reduction
  // factor in [floor, 1]. When peak ≤ target, returns 1 (full base gain).
  // When peak rises above target, returns target/peak so the effective gain
  // shrinks proportionally with how hard the band has been pinned.
  function pvfdBandAgcGain(bandIdx, rawValue) {
    let peak = logoLiveBandPeaks[bandIdx] * LOGO_LIVE_AGC_DECAY;
    if (rawValue > peak) peak = rawValue;
    logoLiveBandPeaks[bandIdx] = peak;
    const ceiling = peak < LOGO_LIVE_AGC_FLOOR ? LOGO_LIVE_AGC_FLOOR : peak;
    return ceiling <= LOGO_LIVE_AGC_TARGET ? 1 : (LOGO_LIVE_AGC_TARGET / ceiling);
  }

  function readLogoGuitarNoteMotion() {
    const analyser = logoLiveAudioAnalyser;
    const bins = logoLiveAudioBins;
    const ctx = logoLiveAudioCtx;

    if (!analyser || !bins || !ctx) return 0;

    const binHz = ctx.sampleRate / analyser.fftSize;

    const lo = Math.max(1, Math.floor(180 / binHz));
    const hi = Math.min(bins.length - 1, Math.ceil(5200 / binHz));

    let weighted = 0;
    let total = 0;

    for (let i = lo; i <= hi; i++) {
      const v = bins[i] / 255;

      if (v < 0.045) continue;

      const hz = i * binHz;

      const guitarWeight =
        hz < 320 ? 0.45 :
        hz < 700 ? 0.78 :
        hz < 1800 ? 1.00 :
        hz < 3600 ? 0.82 :
        0.52;

      const shaped = v * v * guitarWeight;

      weighted += shaped * i;
      total += shaped;
    }

    if (total <= 0.00001) return 0;

    const centroid = weighted / total;

    if (!logoLiveGuitarCentroidPrev) {
      logoLiveGuitarCentroidPrev = centroid;
      return 0;
    }

    const motion = Math.abs(centroid - logoLiveGuitarCentroidPrev) / Math.max(1, hi - lo);

    logoLiveGuitarCentroidPrev = centroid;

    return clamp(compressAudioValue(motion, 18.0, 0.58), 0, 1);
  }

  // Pre-computed bin offsets for each band, keyed on (sampleRate, fftSize, binsLen).
  // Recomputed only when those values actually change. Order:
  //   0=sub, 1=bass, 2=lowMid, 3=mid, 4=upperMid, 5=presence, 6=air
  const ANALYSER_BAND_RANGES = [
    [LOGO_LIVE_SUB_MIN_HZ,      LOGO_LIVE_SUB_MAX_HZ],
    [LOGO_LIVE_BASS_MIN_HZ,     LOGO_LIVE_BASS_MAX_HZ],
    [LOGO_LIVE_LOWMID_MIN_HZ,   LOGO_LIVE_LOWMID_MAX_HZ],
    [LOGO_LIVE_MID_MIN_HZ,      LOGO_LIVE_MID_MAX_HZ],
    [LOGO_LIVE_UPPERMID_MIN_HZ, LOGO_LIVE_UPPERMID_MAX_HZ],
    [LOGO_LIVE_PRESENCE_MIN_HZ, LOGO_LIVE_PRESENCE_MAX_HZ],
    [LOGO_LIVE_AIR_MIN_HZ,      LOGO_LIVE_AIR_MAX_HZ],
  ];
  // Flat Int32Array: [lo0, hi0, lo1, hi1, ...]. Uses Int32 to avoid SMI-vs-double
  // boundary jitter in tight loops.
  const _analyserBandOffsets = new Int32Array(ANALYSER_BAND_RANGES.length * 2);
  let _analyserBandOffsetKey = "";

  function ensureAnalyserBandOffsets(binHz, binsLen) {
    const key = `${binHz}|${binsLen}`;
    if (_analyserBandOffsetKey === key) return;
    _analyserBandOffsetKey = key;
    const cap = binsLen - 1;
    for (let b = 0; b < ANALYSER_BAND_RANGES.length; b++) {
      const range = ANALYSER_BAND_RANGES[b];
      const lo = Math.max(1, Math.floor(range[0] / binHz));
      const hi = Math.min(cap, Math.ceil(range[1] / binHz));
      _analyserBandOffsets[b * 2] = lo;
      _analyserBandOffsets[b * 2 + 1] = hi <= lo ? -1 : hi;
    }
  }

  // Reused per-frame so the analyser path doesn't allocate a 17-key object × 30fps.
  // Initialized to zero; mutated and returned on each call.
  const _analyserMetricsBuf = {
    sub: 0, bass: 0, lowMid: 0, mid: 0, upperMid: 0, presence: 0, air: 0,
    low: 0, high: 0,
    subFlux: 0, bassFlux: 0, lowMidFlux: 0, midFlux: 0,
    upperMidFlux: 0, presenceFlux: 0, airFlux: 0, highFlux: 0,
    guitarMotion: 0,
    guitarLevel: 0,
  };

  function readLogoLiveAudioMetrics(nowTs = performance.now()) {
    const perfAt = pvfdPerfStart();
    // Chromium desktop capture only. If no analyser is active, PULSE has no signal.
    const analyser = logoLiveAudioAnalyser;
    const bins = logoLiveAudioBins;
    const ctx = logoLiveAudioCtx;
    if (!analyser || !bins || !ctx) {
      pvfdPerfEnd("liveAudioRead", perfAt);
      return null;
    }

    analyser.getByteFrequencyData(bins);
    ensureAnalyserBandOffsets(ctx.sampleRate / analyser.fftSize, bins.length);
    const prev = logoLivePrevBins;
    const offsets = _analyserBandOffsets;
    const out = _analyserMetricsBuf;

    // Inline 7-band sweep: one loop per band, no function-call/closure overhead.
    // Uses pre-cached lo/hi indices instead of recomputing from frequency every call.
    let energy, flux, lo, hi;
    for (let b = 0; b < 7; b++) {
      lo = offsets[b * 2];
      hi = offsets[b * 2 + 1];
      energy = 0;
      flux = 0;
      if (hi > 0) {
        const count = hi - lo + 1;
        const denom = count * 255;

        let squareSum = 0;
        let fSum = 0;

        let top1 = 0;
        let top2 = 0;
        let top3 = 0;
        let top4 = 0;

        if (prev) {
          for (let i = lo; i <= hi; i++) {
            const v = bins[i];
            const n = v / 255;

            squareSum += n * n;

            if (n > top1) {
              top4 = top3;
              top3 = top2;
              top2 = top1;
              top1 = n;
            } else if (n > top2) {
              top4 = top3;
              top3 = top2;
              top2 = n;
            } else if (n > top3) {
              top4 = top3;
              top3 = n;
            } else if (n > top4) {
              top4 = n;
            }

            const d = v - prev[i];
            if (d > 0) fSum += d;
          }
        } else {
          for (let i = lo; i <= hi; i++) {
            const v = bins[i];
            const n = v / 255;

            squareSum += n * n;

            if (n > top1) {
              top4 = top3;
              top3 = top2;
              top2 = top1;
              top1 = n;
            } else if (n > top2) {
              top4 = top3;
              top3 = top2;
              top2 = n;
            } else if (n > top3) {
              top4 = top3;
              top3 = n;
            } else if (n > top4) {
              top4 = n;
            }
          }
        }

        const rms = Math.sqrt(squareSum / count);
        // Divide by min(4, count) so narrow bands (sub: ~2-4 bins, bass:
        // ~4-6 bins) compute topAverage from the actual count of available
        // top bins instead of always dividing by 4. Without this, top3/top4
        // stay zero in narrow bands and topAverage is underestimated.
        const topAverage = (top1 + top2 + top3 + top4) / (count < 4 ? count : 4);

        // 50/50 RMS-vs-top blend (was 72/28). RMS captures sustained spectral
        // fill (walls, drones); topAverage captures discrete loud bins (note
        // harmonics, vocal formants). Equal weight means a guitar harmonic
        // riding on top of a saturated wall still moves the bar.
        energy = rms * 0.50 + topAverage * 0.50;
        flux = fSum / denom;
      }
      // Map band index → out fields. Order matches ANALYSER_BAND_RANGES.
      switch (b) {
        case 0: out.sub      = energy; out.subFlux      = flux; break;
        case 1: out.bass     = energy; out.bassFlux     = flux; break;
        case 2: out.lowMid   = energy; out.lowMidFlux   = flux; break;
        case 3: out.mid      = energy; out.midFlux      = flux; break;
        case 4: out.upperMid = energy; out.upperMidFlux = flux; break;
        case 5: out.presence = energy; out.presenceFlux = flux; break;
        case 6: out.air      = energy; out.airFlux      = flux; break;
      }
    }

    out.low = out.bass * 0.58 + out.lowMid * 0.42;
    if (out.low > 1) out.low = 1; else if (out.low < 0) out.low = 0;
    out.high = out.upperMid * 0.42 + out.air * 0.58;
    if (out.high > 1) out.high = 1; else if (out.high < 0) out.high = 0;
    out.highFlux = out.upperMidFlux * 0.42 + out.airFlux * 0.58;
    if (out.highFlux > 1) out.highFlux = 1; else if (out.highFlux < 0) out.highFlux = 0;

    {
      const binHz = ctx.sampleRate / analyser.fftSize;
      const guitarLo = Math.max(1, Math.floor(180 / binHz));
      const guitarHi = Math.min(bins.length - 1, Math.ceil(5200 / binHz));

      let weighted = 0;
      let total = 0;

      for (let i = guitarLo; i <= guitarHi; i++) {
        const n = bins[i] / 255;

        if (n < 0.035) continue;

        const hz = i * binHz;

        const guitarWeight =
          hz < 320 ? 0.45 :
          hz < 700 ? 0.78 :
          hz < 1800 ? 1.00 :
          hz < 3600 ? 0.82 :
          0.52;

        const shaped = n * n * guitarWeight;

        weighted += shaped * i;
        total += shaped;
      }

      out.guitarLevel = clamp(total / Math.max(1, guitarHi - guitarLo + 1) * 18.0, 0, 1);

      if (total <= 0.00001) {
        out.guitarMotion = 0;
      } else {
        const centroid = weighted / total;

        if (!logoLiveGuitarCentroidPrev) {
          logoLiveGuitarCentroidPrev = centroid;
          out.guitarMotion = 0;
        } else {
          const centroidMotion = Math.abs(centroid - logoLiveGuitarCentroidPrev) / Math.max(1, guitarHi - guitarLo);
          logoLiveGuitarCentroidPrev = centroid;

          out.guitarMotion = clamp(compressAudioValue(centroidMotion, 28.0, 0.52) * out.guitarLevel, 0, 1);
        }
      }
    }

    if (prev) prev.set(bins);
    pvfdPerfEnd("liveAudioRead", perfAt);
    return out;
  }

  function updateLogoLiveAudioPulse(nowTs = performance.now()) {
    if (!logoGlowEnabled || !logoLiveAudioActive) return;
    const now = nowTs;
    const metrics = readLogoLiveAudioMetrics(nowTs);
    if (!metrics) return;

    const subRaw = clamp(metrics.sub, 0, 1);
    const bassRaw = clamp(metrics.bass != null ? metrics.bass : metrics.low, 0, 1);
    const lowMidRaw = clamp(metrics.lowMid != null ? metrics.lowMid : metrics.low, 0, 1);
    const midRaw = clamp(metrics.mid, 0, 1);
    const upperMidRaw = clamp(metrics.upperMid != null ? metrics.upperMid : metrics.presence, 0, 1);
    const presenceRaw = clamp(metrics.presence, 0, 1);
    const airRaw = clamp(metrics.air != null ? metrics.air : metrics.high, 0, 1);
    const subFlux = clamp(metrics.subFlux, 0, 1);
    const bassFlux = clamp(metrics.bassFlux != null ? metrics.bassFlux : metrics.lowFlux, 0, 1);
    const lowMidFlux = clamp(metrics.lowMidFlux != null ? metrics.lowMidFlux : metrics.lowFlux, 0, 1);
    const midFlux = clamp(metrics.midFlux, 0, 1);
    const upperMidFlux = clamp(metrics.upperMidFlux != null ? metrics.upperMidFlux : metrics.presenceFlux, 0, 1);
    const presenceFlux = clamp(metrics.presenceFlux, 0, 1);
    const airFlux = clamp(metrics.airFlux != null ? metrics.airFlux : metrics.highFlux, 0, 1);
    if (!Number.isFinite(subRaw + bassRaw + lowMidRaw + midRaw + upperMidRaw + presenceRaw + airRaw + subFlux + bassFlux + lowMidFlux + midFlux + upperMidFlux + presenceFlux + airFlux)) return;

    const metricEnergy = metrics.energy != null ? clamp(Number(metrics.energy), 0, 1) : null;
    const metricPunch = metrics.punch != null ? clamp(Number(metrics.punch), 0, 1) : null;

    const subEnergy      = compressAudioValue(subRaw,      2.35 * pvfdBandAgcGain(0, subRaw),      0.58);
    const bassEnergy     = compressAudioValue(bassRaw,     2.20 * pvfdBandAgcGain(1, bassRaw),     0.57);
    const lowMidEnergy   = compressAudioValue(lowMidRaw,   2.55 * pvfdBandAgcGain(2, lowMidRaw),   0.55);
    const midEnergy      = compressAudioValue(midRaw,      4.60 * pvfdBandAgcGain(3, midRaw),      0.50);
    const upperMidEnergy = compressAudioValue(upperMidRaw, 5.40 * pvfdBandAgcGain(4, upperMidRaw), 0.49);
    const presenceEnergy = compressAudioValue(presenceRaw, 6.80 * pvfdBandAgcGain(5, presenceRaw), 0.47);
    const airEnergy      = compressAudioValue(airRaw,      8.40 * pvfdBandAgcGain(6, airRaw),      0.45);

    const subMotion = compressAudioValue(subFlux, 9.5, 0.68);
    const bassMotion = compressAudioValue(bassFlux, 9.0, 0.68);
    const lowMidMotion = compressAudioValue(lowMidFlux, 8.2, 0.66);
    const midMotion = compressAudioValue(midFlux, 7.4, 0.64);
    const upperMidMotion = compressAudioValue(upperMidFlux, 6.8, 0.62);
    const presenceMotion = compressAudioValue(presenceFlux, 6.2, 0.60);
    const airMotion = compressAudioValue(airFlux, 5.8, 0.58);

    const hazeTexture = clamp(
      midEnergy * 0.10
        + upperMidEnergy * 0.13
        + presenceEnergy * 0.13
        + airEnergy * 0.05
        - bassEnergy * 0.06,
      0,
      0.12
    );

    const hazeMotion = clamp(
      midMotion * 0.30
        + upperMidMotion * 0.28
        + presenceMotion * 0.22
        + airMotion * 0.12,
      0,
      1
    );

    const hazeLift = clamp(hazeTexture * 0.34 + hazeMotion * 0.08, 0, 0.075);

    const guitarMotion = clamp(metrics.guitarMotion || 0, 0, 1);

    logoLiveGuitarMotionEnv = smoothLogoEnvelope(
      logoLiveGuitarMotionEnv,
      guitarMotion,
      0.58,
      0.105
    );

    const subInput = clamp(subEnergy * 0.44 + subMotion * 0.42 + subFlux * 2.2, 0, 1);
    const bassInput = clamp(bassEnergy * 0.42 + bassMotion * 0.44 + bassFlux * 2.4, 0, 1);
    const lowMidInput = clamp(lowMidEnergy * 0.36 + lowMidMotion * 0.46 + lowMidFlux * 2.8 + hazeLift * 0.020, 0, 1);
    const midInput = clamp(midEnergy * 0.30 + midMotion * 0.48 + midFlux * 3.2 + hazeLift * 0.040, 0, 1);
    const upperMidInput = clamp(upperMidEnergy * 0.26 + upperMidMotion * 0.50 + upperMidFlux * 3.4 + hazeLift * 0.050, 0, 1);
    const presenceInput = clamp(presenceEnergy * 0.24 + presenceMotion * 0.52 + presenceFlux * 3.6 + hazeLift * 0.055, 0, 1);
    const airInput = clamp(airEnergy * 0.24 + airMotion * 0.50 + airFlux * 3.2 + hazeLift * 0.040, 0, 1);

    if (!logoLiveSubEnv && !logoLiveBassEnv && !logoLiveLowMidEnv && !logoLiveMidEnv && !logoLiveUpperMidEnv && !logoLivePresenceEnv && !logoLiveAirEnv && !logoLiveLogoEnv) {
      logoLiveSubEnv = subInput;
      logoLiveBassEnv = bassInput;
      logoLiveLowMidEnv = lowMidInput;
      logoLiveMidEnv = midInput;
      logoLiveUpperMidEnv = upperMidInput;
      logoLivePresenceEnv = presenceInput;
      logoLiveAirEnv = airInput;
      logoLiveLowEnv = clamp(logoLiveBassEnv * 0.58 + logoLiveLowMidEnv * 0.42, 0, 1);
      logoLiveHighEnv = clamp(logoLiveUpperMidEnv * 0.42 + logoLiveAirEnv * 0.58, 0, 1);
      logoLiveLogoEnv = metricEnergy != null
        ? metricEnergy
        : clamp(compressAudioValue(subRaw * 0.16 + bassRaw * 0.18 + lowMidRaw * 0.16 + midRaw * 0.18 + upperMidRaw * 0.12 + presenceRaw * 0.11 + airRaw * 0.09, 1.80, 0.72), 0, 1);
      setLogoAudioGlowVars(logoLiveLogoEnv, logoLiveSubEnv, logoLiveLowEnv, logoLiveMidEnv, logoLivePresenceEnv, logoLiveHighEnv, 0);
      return;
    }

    logoLiveSubEnv = smoothLogoEnvelope(logoLiveSubEnv, subInput, LOGO_LIVE_ATTACK, 0.600);
    logoLiveBassEnv = smoothLogoEnvelope(logoLiveBassEnv, bassInput, LOGO_LIVE_ATTACK, 0.620);
    logoLiveLowMidEnv = smoothLogoEnvelope(logoLiveLowMidEnv, lowMidInput, LOGO_LIVE_ATTACK, 0.640);
    logoLiveMidEnv = smoothLogoEnvelope(logoLiveMidEnv, midInput, LOGO_LIVE_ATTACK, 0.660);
    logoLiveUpperMidEnv = smoothLogoEnvelope(logoLiveUpperMidEnv, upperMidInput, LOGO_LIVE_HIGH_ATTACK, 0.700);
    logoLivePresenceEnv = smoothLogoEnvelope(logoLivePresenceEnv, presenceInput, LOGO_LIVE_HIGH_ATTACK, 0.740);
    logoLiveAirEnv = smoothLogoEnvelope(logoLiveAirEnv, airInput, LOGO_LIVE_HIGH_ATTACK, 0.780);

    logoLiveLowEnv = clamp(logoLiveBassEnv * 0.58 + logoLiveLowMidEnv * 0.42, 0, 1);
    logoLiveHighEnv = clamp(logoLiveUpperMidEnv * 0.42 + logoLiveAirEnv * 0.58, 0, 1);

    const totalRaw = subRaw * 0.16 + bassRaw * 0.18 + lowMidRaw * 0.16 + midRaw * 0.18 + upperMidRaw * 0.12 + presenceRaw * 0.11 + airRaw * 0.09;
    const logoInput = metricEnergy != null
      ? metricEnergy
      : clamp(
          compressAudioValue(totalRaw, 1.80, 0.72) * 0.72
            + logoLiveSubEnv * 0.07
            + logoLiveBassEnv * 0.07
            + logoLiveLowMidEnv * 0.06
            + logoLiveMidEnv * 0.05
            + logoLiveUpperMidEnv * 0.04
            + logoLivePresenceEnv * 0.03
            + logoLiveAirEnv * 0.02,
          0,
          1
        );
    logoLiveLogoEnv = smoothLogoEnvelope(logoLiveLogoEnv, logoInput, LOGO_LIVE_LOGO_ATTACK, LOGO_LIVE_LOGO_RELEASE);

    const punchInput = metricPunch != null
      ? metricPunch
      : clamp(
          subFlux * 4.2
            + bassFlux * 3.4
            + lowMidFlux * 2.4
            + midFlux * 1.5
            + upperMidFlux * 0.9
            + presenceFlux * 0.6
            + airFlux * 0.4,
          0,
          1
        );
    logoLivePunchEnv = Math.max(logoLivePunchEnv * 0.58, punchInput > 0.24 ? punchInput : 0);

    setLogoAudioGlowVars(
      logoLiveLogoEnv,
      logoLiveSubEnv,
      logoLiveLowEnv,
      logoLiveMidEnv,
      logoLivePresenceEnv,
      logoLiveHighEnv,
      logoLivePunchEnv
    );

    if (LOGO_LIVE_DEBUG && now - logoLiveDebugLastMs > 500) {
      logoLiveDebugLastMs = now;
      console.log("[PVFD_AUDIO]", {
        raw: [
          Number(subRaw.toFixed(3)),
          Number(bassRaw.toFixed(3)),
          Number(lowMidRaw.toFixed(3)),
          Number(midRaw.toFixed(3)),
          Number(upperMidRaw.toFixed(3)),
          Number(presenceRaw.toFixed(3)),
          Number(airRaw.toFixed(3))
        ],
        flux: [
          Number(subFlux.toFixed(4)),
          Number(bassFlux.toFixed(4)),
          Number(lowMidFlux.toFixed(4)),
          Number(midFlux.toFixed(4)),
          Number(upperMidFlux.toFixed(4)),
          Number(presenceFlux.toFixed(4)),
          Number(airFlux.toFixed(4))
        ],
        lanes: [
          Number(logoLiveSubEnv.toFixed(3)),
          Number(logoLiveBassEnv.toFixed(3)),
          Number(logoLiveLowMidEnv.toFixed(3)),
          Number(logoLiveMidEnv.toFixed(3)),
          Number(logoLiveUpperMidEnv.toFixed(3)),
          Number(logoLivePresenceEnv.toFixed(3)),
          Number(logoLiveAirEnv.toFixed(3))
        ],
        logo: Number(logoLiveLogoEnv.toFixed(3)),
        punch: Number(logoLivePunchEnv.toFixed(3))
      });
    }

    logoLiveSubPrev = logoLiveSubEnv;
    logoLiveBassPrev = logoLiveBassEnv;
    logoLiveLowMidPrev = logoLiveLowMidEnv;
    logoLiveMidPrev = logoLiveMidEnv;
    logoLiveUpperMidPrev = logoLiveUpperMidEnv;
    logoLivePresencePrev = logoLivePresenceEnv;
    logoLiveAirPrev = logoLiveAirEnv;
    logoLiveLowPrev = logoLiveLowEnv;
    logoLiveHighPrev = logoLiveHighEnv;
  }

  function updateBars(isPlaying) {
    const base = isPlaying ? 0.52 : 0.10;
    const spread = isPlaying ? 0.30 : 0.06;

    let energySum = 0;

    for (let i = 0; i < NUM_BARS; i++) {
      const phase = NUM_BARS <= 1 ? 0 : i / (NUM_BARS - 1);
      let target = base + spread * (1 - Math.abs(phase - 0.5) * 1.65);

      if (target < 0.05) target = 0.05;
      else if (target > 1) target = 1;

      const prev = barHeights[i];
      const next = SMOOTHING * prev + (1 - SMOOTHING) * target;

      barHeights[i] = Math.abs(next - prev) >= VISUALIZER_EPSILON ? next : prev;
      energySum += barHeights[i];
    }

    sideVuEnergy = clamp(energySum / NUM_BARS, 0, 1);
  }

  function lcdBackground(w, h, targetCtx = ctx) {
    const bgW = Math.max(1, Math.round(w));
    const bgH = Math.max(1, Math.round(h));
    const key = `${bgW}x${bgH}:p${pvfdPaletteVersion}`;

    if (!lcdBackgroundCache || lcdBackgroundCache.key !== key) {
      const bg = document.createElement("canvas");
      bg.width = bgW;
      bg.height = bgH;

      const bgCtx = bg.getContext("2d");

      bgCtx.fillStyle = pvfdCssPalette.lcdVoid;
      bgCtx.fillRect(0, 0, bgW, bgH);

      bgCtx.fillStyle = pvfdRgba(pvfdCssPalette.mid, 0.045);
      for (let y = 0; y < bgH; y += 6) {
        bgCtx.fillRect(0, y, bgW, 1);
      }

      bgCtx.fillStyle = pvfdRgba(pvfdCssPalette.mid, 0.025);
      for (let x = 0; x < bgW; x += 8) {
        bgCtx.fillRect(x, 0, 1, bgH);
      }

      lcdBackgroundCache = { key, bg };
    }

    targetCtx.drawImage(lcdBackgroundCache.bg, 0, 0, w, h);
  }

  // Compose display filters. The WebM one-color path is already tinted by the
  // CSS RGB wash, so only full-color OEL mode keeps the hue-rotate filter.
  function applyLcdFilter() {
    if (!chassis) return;

    const tintName = mapTintNameForCss(tintIdx);
    const monoMode = TINT_MONO_MODE[tintIdx] || "";
    const perf = activePerformanceConfig();

    chassis.setAttribute("data-pvfd-tint", tintName);
    document.documentElement.setAttribute("data-pvfd-tint", tintName);
    if (monoMode) {
      chassis.setAttribute("data-pvfd-mono", monoMode);
      document.documentElement.setAttribute("data-pvfd-mono", monoMode);
    } else {
      chassis.removeAttribute("data-pvfd-mono");
      document.documentElement.removeAttribute("data-pvfd-mono");
    }
    refreshPvfdCssPalette();

    const deg = TINT_HUE_DEG[tintIdx];
    const baseLcdParts = [];

    if (perf.reducedEffects) {
      if (lcdDimmed) baseLcdParts.push("brightness(0.70)");
    } else if (lcdDimmed) {
      baseLcdParts.push("brightness(0.50) contrast(0.98) saturate(1.05)");
    } else {
      baseLcdParts.push("brightness(1.00) contrast(0.96) saturate(1.20)");
    }

    chassis.querySelectorAll(".pvfd-lcd").forEach((lcd) => {
      const colorMode = lcd.getAttribute("data-pvfd-oel-color");
      const videoState = lcd.getAttribute("data-pvfd-video-state");
      const cssTintedWebm = colorMode === "tint" && (videoState === "active" || videoState === "loading");
      const parts = [];
      if (deg !== 0 && !cssTintedWebm) parts.push(`hue-rotate(${deg}deg)`);
      // Mono modes: grayscale the LCD canvas + video. Racing clip in COLOR
      // mode keeps full color (colorMode === "color") so racing remains
      // expressive even when the rest of the chassis is monochrome.
      // Both B-ON-W and W-ON-B keep the chassis LCD dark with light ink
      // (the LCD is a "screen inside a dark housing" in both modes), so
      // grayscale alone is enough — no invert.
      if (monoMode && colorMode !== "color") parts.push("grayscale(1)");
      parts.push(...baseLcdParts);
      const nextFilter = parts.join(" ");
      if (lcd.style.filter !== nextFilter) lcd.style.filter = nextFilter;
    });

    const panelParts = [];

    if (lcdDimmed) {
      panelParts.push("brightness(0.55)");
    }

    chassis.querySelectorAll(".pvfd-meta-lcd, .pvfd-lcd-side").forEach((lcd) => {
      lcd.style.filter = panelParts.join(" ");
    });
  }

  function cyanRamp(y) {
    // Fixed cyan OEL palette.
    // Tint is applied later by CSS filter on .pvfd-lcd.
    const yy = Math.max(0, Math.min(1, y));
    const r = Math.max(0, Math.min(0.54, (yy - 0.68) * 1.65));
    const g = Math.max(0.08, Math.min(0.90, yy * 1.02 + 0.02));
    const b = Math.max(0.26, Math.min(1.00, 0.34 + yy * 0.92));
    return [r, g, b];
  }

  function clipCellColor(q, sparkleOn) {
    const key = `${q}:${sparkleOn ? 1 : 0}`;
    const cached = clipColorCache.get(key);

    if (cached) return cached;

    const y = Math.min(1, (q / 15) * 0.98);
    const ramp = cyanRamp(y);
    const sparkle = sparkleOn ? 0.035 : 0;

    const r = Math.min(255, Math.round((ramp[0] + sparkle) * 255));
    const g = Math.min(255, Math.round((ramp[1] + sparkle) * 255));
    const b = Math.min(255, Math.round((ramp[2] + sparkle) * 255));

    const color = `rgb(${r},${g},${b})`;
    clipColorCache.set(key, color);

    return color;
  }

  function decodePackedClip(clip) {
    if (!clip || clip.bytes) return;
    try {
      const binary = atob(clip.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      clip.bytes = bytes;
    } catch (e) {
      console.warn("[PVFD] packed clip decode failed:", clip && clip.name, e);
      clip.bytes = new Uint8Array(0);
    }
  }

  function clearClipRenderCache(clip, clearPrevious = true) {
    if (!clip) return;
    if (clip.renderCache) {
      clip.renderCache.frames = [];
      clip.renderCache.recentFrames = [];
      clip.renderCache = null;
    }
    if (clearPrevious && clip.lastReadyRenderCache) {
      clip.lastReadyRenderCache.frames = [];
      clip.lastReadyRenderCache = null;
    }
  }

  function clearAllClipRenderCaches(clearPrevious = true, exceptClip = null) {
    CLIPS.forEach((clip) => {
      if (clip !== exceptClip) clearClipRenderCache(clip, clearPrevious);
    });
  }

  function releaseInactiveClipBytes(activeClip) {
    CLIPS.forEach((clip) => {
      if (clip !== activeClip) clip.bytes = null;
    });
  }

  function setActiveClip(idx, persist = false) {
    if (!OEL_WEBM_CLIPS.length) return;
    clipIdx = ((idx % OEL_WEBM_CLIPS.length) + OEL_WEBM_CLIPS.length) % OEL_WEBM_CLIPS.length;
    clipStartMs = performance.now();
    clipVirtualMs = 0;
    clipLastTsMs = 0;
    lastCanvasFrameKey = "";
    const activeClip = OEL_WEBM_CLIPS[clipIdx];
    console.log(`[PVFD] OEL WebM clip: ${activeClip.name}`);
    syncOelVideoPlayback(true);
    syncOelColorModeAttributes();
    applyLcdFilter();
    if (persist) safe(() => window.localStorage.setItem(CLIP_STORAGE_KEY, clipStorageId(activeClip, clipIdx)));
    markStaticReadoutsDirty();
    updateMenuPanel();
  }

  function ensureClipRunning() {
    if (!OEL_WEBM_CLIPS.length) return null;
    const clip = OEL_WEBM_CLIPS[clipIdx] || OEL_WEBM_CLIPS[0];
    if (!clipStartMs) clipStartMs = performance.now();
    return clip;
  }

  function drawLCDStatus(text, w, h, targetCtx = ctx) {
    targetCtx.fillStyle = pvfdRgba(pvfdCssPalette.lcdVoidRgb, 0.72);
    targetCtx.fillRect(
      Math.round(w * 0.24),
      Math.round(h * 0.42),
      Math.round(w * 0.52),
      18
    );

    targetCtx.fillStyle = pvfdRgba(pvfdCssPalette.light, 0.88);
    targetCtx.font = "bold 11px 'Share Tech Mono', monospace";
    targetCtx.textAlign = "center";
    targetCtx.fillText(text, Math.round(w * 0.50), Math.round(h * 0.42) + 13);
    targetCtx.textAlign = "left";
  }

  function renderPackedClipFrame(targetCtx, clip, frame, w, h) {
    lcdBackground(w, h, targetCtx);

    const frameOffset = frame * ((clip.w * clip.h) >> 1);
    const cellW = w / clip.w;
    const cellH = h / clip.h;

    for (let py = 0; py < clip.h; py++) {
      for (let px = 0; px < clip.w; px++) {
        const packed = clip.bytes[frameOffset + ((py * clip.w + px) >> 1)] || 0;
        const q = (px & 1) ? (packed & 15) : (packed >> 4);
        const dx = Math.floor(px * cellW);
        const dy = Math.floor(py * cellH);
        const nextX = Math.ceil((px + 1) * cellW);
        const nextY = Math.ceil((py + 1) * cellH);
        const drawW = Math.max(1, nextX - dx);
        const drawH = Math.max(1, nextY - dy);

        if (q <= 0) {
          targetCtx.fillStyle = pvfdCssPalette.lcdDeep;
          targetCtx.fillRect(dx, dy, drawW, drawH);
          continue;
        }

        targetCtx.fillStyle = clipCellColor(q, (px * 13 + py * 7 + frame) % 37 === 0);
        targetCtx.fillRect(dx, dy, drawW, drawH);

        if (q >= 13 && drawW > 1 && drawH > 1) {
          targetCtx.fillStyle = pvfdRgba(pvfdCssPalette.light, 0.075);
          targetCtx.fillRect(dx, dy, Math.max(1, drawW - 1), Math.max(1, drawH - 1));
        }
      }
    }
  }
  function getClipCacheMeta(clip, w, h) {
    const perf = activePerformanceConfig();
    const dpr = Math.max(1, Math.min(perf.maxDpr || 2, window.devicePixelRatio || 1));
    const pixelW = Math.max(1, Math.floor(w * dpr));
    const pixelH = Math.max(1, Math.floor(h * dpr));
    const renderW = pixelW / dpr;
    const renderH = pixelH / dpr;
    const frameCount = clip.frames || 1;
    const cacheKey = `${perf.label}:${clip.source || clip.name}:${pixelW}x${pixelH}:${dpr}`;
    return { cacheKey, dpr, pixelW, pixelH, frameCount, w: renderW, h: renderH };
  }

  function ensureClipRenderCache(clip, meta) {
    const perf = activePerformanceConfig();
    if (!clip.renderCache || clip.renderCache.key !== meta.cacheKey) {
      if (perf.keepPreviousClipCache && clip.renderCache && clip.renderCache.ready) {
        clip.lastReadyRenderCache = clip.renderCache;
      } else if (!perf.keepPreviousClipCache) {
        clip.lastReadyRenderCache = null;
      }
      clip.renderCache = {
        key: meta.cacheKey,
        dpr: meta.dpr,
        pixelW: meta.pixelW,
        pixelH: meta.pixelH,
        w: meta.w,
        h: meta.h,
        frameCount: meta.frameCount,
        frames: new Array(meta.frameCount),
        recentFrames: [],
        warmed: 0,
        nextWarmFrame: 0,
        ready: false,
        warming: false,
        warmStartedAt: performance.now(),
      };
      lastClipCacheKey = meta.cacheKey;
    }
    return clip.renderCache;
  }

  function renderClipFrameCanvas(clip, frame, meta) {
    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = meta.pixelW;
    frameCanvas.height = meta.pixelH;
    const frameCtx = frameCanvas.getContext("2d");
    frameCtx.setTransform(meta.dpr, 0, 0, meta.dpr, 0, 0);
    frameCtx.imageSmoothingEnabled = false;
    renderPackedClipFrame(frameCtx, clip, frame, meta.w, meta.h);
    return frameCanvas;
  }

  function nextMissingClipFrame(cache) {
    for (let i = 0; i < cache.frameCount; i++) {
      const frame = (cache.nextWarmFrame + i) % cache.frameCount;
      if (!cache.frames[frame]) return frame;
    }
    return -1;
  }

  function finishClipCacheIfReady(clip, cache) {
    if (cache.ready || cache.warmed < cache.frameCount) return;
    const hadReadyCache = !!(clip.lastReadyRenderCache && clip.lastReadyRenderCache.ready);
    cache.ready = true;
    clip.lastReadyRenderCache = cache;
    if (!hadReadyCache && clip === (CLIPS[clipIdx] || CLIPS[0])) clipStartMs = performance.now();
  }

  function touchCachedClipFrame(cache, frame) {
    if (!cache.recentFrames) cache.recentFrames = [];
    const existingIdx = cache.recentFrames.indexOf(frame);
    if (existingIdx >= 0) cache.recentFrames.splice(existingIdx, 1);
    cache.recentFrames.push(frame);
    const maxFrames = activePerformanceConfig().maxCachedClipFrames;
    if (!Number.isFinite(maxFrames)) return;
    while (cache.recentFrames.length > maxFrames) {
      const evictFrame = cache.recentFrames.shift();
      if (evictFrame !== frame) cache.frames[evictFrame] = null;
    }
  }

  function markClipCacheRebuildStress(ms = CLIP_CACHE_ROUTE_REBUILD_BLOCK_MS) {
    clipCacheRebuildBlockedUntil = Math.max(clipCacheRebuildBlockedUntil, performance.now() + ms);
  }

  function isClipCacheRebuildStressActive() {
    return performance.now() < clipCacheRebuildBlockedUntil;
  }

  function metaFromClipRenderCache(cache) {
    if (!cache) return null;
    return {
      cacheKey: cache.key,
      dpr: cache.dpr,
      pixelW: cache.pixelW,
      pixelH: cache.pixelH,
      frameCount: cache.frameCount,
      w: cache.w,
      h: cache.h,
    };
  }

  function keepExistingClipCacheWarmupAlive(clip, cache) {
    if (!clip || !cache || cache.ready || cache.warming) return;
    const meta = metaFromClipRenderCache(cache);
    if (meta) scheduleClipCacheWarmup(clip, meta);
  }

  function getClipFrameDuringRebuildStress(clip, frame, meta) {
    if (!isClipCacheRebuildStressActive()) return null;
    const cache = clip && clip.renderCache;
    if (!cache || cache.key === meta.cacheKey || !cache.frames) return null;

    // Route/Home hover stress should not start a brand-new cache rebuild when an
    // existing OEL cache can still draw. Let the current incomplete cache finish
    // normally, but keep using available old frames until the renderer settles.
    keepExistingClipCacheWarmupAlive(clip, cache);

    const cacheFrame = frame % Math.max(1, cache.frameCount || meta.frameCount || 1);
    if (cache.frames[cacheFrame]) {
      touchCachedClipFrame(cache, cacheFrame);
      return cache.frames[cacheFrame];
    }

    const fallback = clip.lastReadyRenderCache;
    if (!fallback || !fallback.ready || !fallback.frames) return null;
    const fallbackFrame = frame % Math.max(1, fallback.frameCount || meta.frameCount || 1);
    if (fallback.frames[fallbackFrame]) {
      touchCachedClipFrame(fallback, fallbackFrame);
      return fallback.frames[fallbackFrame];
    }
    return null;
  }

  function warmClipCacheSlice(clip, meta) {
    const cache = ensureClipRenderCache(clip, meta);
    const startedAt = performance.now();
    let rendered = 0;
    const perf = activePerformanceConfig();
    while (rendered < 1 || (performance.now() - startedAt < perf.cacheBatchMs && rendered < perf.cacheFramesPerSlice)) {
      const frame = nextMissingClipFrame(cache);
      if (frame < 0) break;
      cache.frames[frame] = renderClipFrameCanvas(clip, frame, meta);
      touchCachedClipFrame(cache, frame);
      cache.warmed++;
      cache.nextWarmFrame = (frame + 1) % cache.frameCount;
      rendered++;
    }
    finishClipCacheIfReady(clip, cache);
  }

  function scheduleClipCacheWarmup(clip, meta) {
    if (!activePerformanceConfig().preloadFullClipCache) return;
    const cache = ensureClipRenderCache(clip, meta);
    if (cache.ready || cache.warming) return;
    cache.warming = true;
    const run = () => {
      cache.warming = false;
      if (clip.renderCache !== cache || cache.ready) return;
      warmClipCacheSlice(clip, meta);
      if (!cache.ready) scheduleClipCacheWarmup(clip, meta);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 80 });
    else window.setTimeout(run, 16);
  }

  function getCachedClipFrame(clip, frame, w, h) {
    const meta = getClipCacheMeta(clip, w, h);
    const stressFrame = getClipFrameDuringRebuildStress(clip, frame, meta);
    if (stressFrame) return stressFrame;
    const cache = ensureClipRenderCache(clip, meta);
    const perf = activePerformanceConfig();
    if (!perf.preloadFullClipCache || perf.allowPartialClipCache) {
      if (!cache.frames[frame]) {
        cache.frames[frame] = renderClipFrameCanvas(clip, frame, meta);
        cache.warmed = Math.min(cache.frameCount, cache.warmed + 1);
      }
      touchCachedClipFrame(cache, frame);
      if (perf.preloadFullClipCache) scheduleClipCacheWarmup(clip, meta);
      return cache.frames[frame];
    }
    scheduleClipCacheWarmup(clip, meta);
    if (cache.ready) {
      touchCachedClipFrame(cache, frame);
      return cache.frames[frame];
    }
    const fallback = clip.lastReadyRenderCache;
    if (!fallback || !fallback.ready || !fallback.frames) return null;
    return fallback.frames[frame % fallback.frameCount] || null;
  }

  function drawClipLoadingStatus(clip, w, h, t) {
    const cache = clip && clip.renderCache;
    const total = Math.max(1, cache ? cache.frameCount : (clip && clip.frames) || 1);
    const ready = Math.max(0, cache ? cache.warmed : 0);
    const pct = Math.min(99, Math.floor((ready / total) * 100));
    lcdBackground(w, h);

    ctx.save();
    if (!activePerformanceConfig().reducedEffects) {
      const scanX = Math.round((t * 36) % Math.max(1, w + 60)) - 60;
      const sweep = ctx.createLinearGradient(scanX, 0, scanX + 60, 0);
      sweep.addColorStop(0, pvfdRgba(pvfdCssPalette.mid, 0));
      sweep.addColorStop(0.5, pvfdRgba(pvfdCssPalette.mid, 0.11));
      sweep.addColorStop(1, pvfdRgba(pvfdCssPalette.mid, 0));
      ctx.fillStyle = sweep;
      ctx.fillRect(Math.max(0, scanX), 0, 60, h);
    }

    drawLCDStatus(ready ? `LOADING ${pct}%` : "LOADING...", w, h);

    const barW = Math.max(48, Math.round(w * 0.36));
    const barX = Math.round((w - barW) / 2);
    const barY = Math.min(h - 8, Math.round(h * 0.62));

    ctx.fillStyle = pvfdRgba(pvfdCssPalette.lcdDeepRgb, 0.92);
    ctx.fillRect(barX, barY, barW, 3);

    ctx.fillStyle = pvfdRgba(pvfdCssPalette.mid, 0.74);
    ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * ready / total)), 3);

    ctx.restore();
  }

  function drawClip(w, h, t, tsMs = t * 1000) {
    logOelCanvasRendererDisabled();
    console.warn("[PVFD] OEL WebM proof: drawClip() blocked");
    return;
    const clip = ensureClipRunning();
    decodePackedClip(clip);
    if (!clip || !clip.bytes || !clip.bytes.length) {
      lastCanvasFrameKey = "";
      lcdBackground(w, h);
      drawLCDStatus("OEL DATA", w, h);
      return;
    }

    const frameCount = clip.frames || 1;
    const perf = activePerformanceConfig();
    const fps = Math.min(clip.fps || 12, perf.maxClipFps || 60);
    if (!clipLastTsMs || tsMs < clipLastTsMs) {
      clipLastTsMs = tsMs;
    }

    const rawDeltaMs = Math.max(0, tsMs - clipLastTsMs);
    const cappedDeltaMs = Math.min(rawDeltaMs, 50);

    clipVirtualMs += cappedDeltaMs;
    clipLastTsMs = tsMs;

    const elapsed = clipVirtualMs / 1000;
    const frame = Math.floor(elapsed * fps) % frameCount;
    if (!CLIP_RENDER_CACHE_ENABLED) {
      renderPackedClipFrame(ctx, clip, frame, w, h);
      return;
    }
    const cachedFrame = getCachedClipFrame(clip, frame, w, h);
    if (!cachedFrame) {
      lastCanvasFrameKey = "";
      drawClipLoadingStatus(clip, w, h, t);
      return;
    }
    const cacheKey = clip.renderCache && clip.renderCache.key ? clip.renderCache.key : `${w}x${h}`;
    const frameKey = `${clipIdx}:${cacheKey}:${frame}`;
    if (frameKey === lastCanvasFrameKey) return;
    ctx.drawImage(cachedFrame, 0, 0, w, h);
    lastCanvasFrameKey = frameKey;
  }

  function syncCurrentTrackFromPlayer(force = false, ts = performance.now()) {
    if (!force && ts - lastTrackSyncAt < TRACK_SYNC_INTERVAL_MS) return;
    lastTrackSyncAt = ts;
    const item = Spicetify.Player.data && Spicetify.Player.data.item;
    if (!item) return;

    const uri = item.uri || item.link || item.name || "";
    if (uri && uri !== lastTrackUri) {
      lastTrackUri = uri;
      trackTitle = (item.name || "").toUpperCase();
      trackArtist = ((item.artists && item.artists.map(a => a.name).join(", ")) || "").toUpperCase();
      markPlayerStateDirty();
    }

    if (!trackTitle && item.name) {
      trackTitle = item.name.toUpperCase();
    }
    if (!trackArtist && item.artists) {
      trackArtist = item.artists.map(a => a.name).join(", ").toUpperCase();
    }
  }

  function getCurrentDurationMs() {
    const data = Spicetify.Player.data || {};
    const item = data.item || {};
    const raw = data.duration || item.duration_ms || item.duration || item.durationMs || 0;
    if (typeof raw === "number") return raw;
    if (raw && typeof raw.milliseconds === "number") return raw.milliseconds;
    return 0;
  }

  function getRepeatState() {
    const data = Spicetify.Player.data || {};
    const candidates = [data.repeat, data.repeat_mode, data.options && data.options.repeat, data.state && data.state.repeat, data.state && data.state.repeat_mode, data.context && data.context.repeat, safeReturn(() => Spicetify.Player.getRepeat && Spicetify.Player.getRepeat(), null)].filter(v => v !== undefined && v !== null);
    for (const raw of candidates) {
      const val = String(raw).toLowerCase();
      if (val === "2" || val.includes("track") || val.includes("one")) return "ONE";
      if (val === "1" || val.includes("context") || val.includes("all") || val === "true") return "ALL";
      if (val === "0" || val.includes("off") || val === "false") return "OFF";
    }
    const btn = document.querySelector("[data-testid='control-button-repeat'], button[aria-label*='repeat' i]");
    const label = (btn && btn.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("enable repeat one")) return "ALL";
    if (label.includes("disable repeat") || label.includes("disable repeat one")) return "ONE";
    return "OFF";
  }

  function getShuffleState() {
    const data = Spicetify.Player.data || {};
    const raw = data.shuffle ?? (data.options && data.options.shuffle) ?? (data.state && data.state.shuffle);
    if (typeof raw === "boolean") return raw;
    if (raw !== undefined && raw !== null) return String(raw).toLowerCase() === "true" || String(raw) === "1";
    const btn = document.querySelector("[data-testid='control-button-shuffle'], button[aria-label*='shuffle' i]");
    if (!btn) return false;
    const checked = btn.getAttribute("aria-checked");
    if (checked) return checked === "true";
    return (btn.getAttribute("aria-label") || "").toLowerCase().includes("disable shuffle");
  }

  function makeProgressLabel(progressMs, durationMs) {
    const elapsed = fmtTime(progressMs);
    return durationMs > 0 ? `${elapsed} / ${fmtTime(durationMs)}` : elapsed;
  }

  function makeLcdClockLabel(date = new Date()) {
    const h = date.getHours() % 12 || 12;
    const m = String(date.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  function updateLcdCornerReadouts(playerState = getSampledPlayerState(), ts = performance.now()) {
    const dom = getPvfdDom();
    if (dom.lcdStatus) {
      const status = playerState.playing ? "PLAY" : "PAUSE";
      setLcdCornerTextIfChanged(dom.lcdStatus, status);
      dom.lcdStatus.classList.toggle("paused", !playerState.playing);
    }
    if (dom.lcdClock && ts - lastLcdClockReadoutAt >= LCD_CLOCK_READOUT_INTERVAL_MS) {
      lastLcdClockReadoutAt = ts;
      setLcdCornerTextIfChanged(dom.lcdClock, makeLcdClockLabel());
    }
  }

  function updateButtonStates(playerState = getSampledPlayerState()) {
    const dom = getPvfdDom();
    const playBtn = dom.buttons && dom.buttons.play;
    setTextIfChanged(playBtn, playerState.playing ? PVFD_PAUSE_GLYPH : PVFD_PLAY_GLYPH);
    const shuffleBtn = dom.buttons && dom.buttons.shuffle;
    const shuffleOn = playerState.shuffle;
    if (shuffleBtn) {
      shuffleBtn.classList.toggle("active", shuffleOn);
      setDataIfChanged(shuffleBtn, "label", shuffleOn ? "ON" : "OFF");
      setAttrIfChanged(shuffleBtn, "title", shuffleOn ? "Shuffle: on" : "Shuffle: off");
    }
    const repeatBtn = dom.buttons && dom.buttons.repeat;
    const rpt = playerState.repeat;
    if (repeatBtn) {
      repeatBtn.classList.toggle("active", rpt !== "OFF");
      repeatBtn.classList.toggle("repeat-context", rpt === "ALL");
      repeatBtn.classList.toggle("repeat-one", rpt === "ONE");
      setDataIfChanged(repeatBtn, "label", rpt);
      setAttrIfChanged(repeatBtn, "title", rpt === "ONE" ? "Repeat: current song" : (rpt === "ALL" ? "Repeat: playlist/album" : "Repeat: off"));
    }
    updateRoleButtonStates();
  }

  function disableSideVuReadout(opacity = "0.18") {
    const vu = getPvfdDom().sideVu || [];
    vu.forEach((seg) => {
      if (seg.classList.contains("on")) seg.classList.remove("on");
      setStyleIfChanged(seg, "opacity", opacity);
    });
  }

  function updateSideVuReadout() {
    if (!activePerformanceConfig().sideVu) {
      disableSideVuReadout("0.14");
      return;
    }
    const vu = getPvfdDom().sideVu || [];
    if (!vu.length) return;
    const energy = sideVuEnergy;
    vu.forEach((seg, idx) => {
      const threshold = 1 - (idx + 1) / vu.length;
      const on = energy > threshold * 0.92;
      setStyleIfChanged(seg, "opacity", on ? (0.35 + energy * 0.65).toFixed(2) : "0.22");
    });
  }

  function updateSideProgressReadouts(progressMs, durationMs) {
    const side = getPvfdDom().side || {};
    if (!activePerformanceConfig().sideReadouts) {
      setTextIfChanged(side.prog, "--");
      setTextIfChanged(side.left, "--:--");
      return;
    }
    const pct = durationMs ? clamp(progressMs / durationMs, 0, 1) : 0;
    setTextIfChanged(side.prog, durationMs ? Math.round(pct * 100) + "%" : "--%");
    setTextIfChanged(side.left, durationMs ? "-" + fmtTime(durationMs - progressMs) : "--:--");
  }

  function updateSideStaticReadouts(playerState = getSampledPlayerState()) {
    const dom = getPvfdDom();
    const side = dom.side || {};
    const perf = activePerformanceConfig();
    if (!perf.sideReadouts) {
      setTextIfChanged(side.vol, attActive ? "ATTENUATOR" : (Math.round(getPlayerVolume() * 100) + "%"));
      setTextIfChanged(side.mode, "WEBM");
      setTextIfChanged(side.tint, TINT_LABELS[tintIdx]);
      setTextIfChanged(side.dim, lcdDimmed ? "DIM" : "FULL");
      setTextIfChanged(side.prog, "--");
      setTextIfChanged(side.left, "--:--");
      setTextIfChanged(side.repeat, playerState.repeat);
      setTextIfChanged(side.shuffle, playerState.shuffle ? "ON" : "OFF");
      setTextIfChanged(side.status, "ECO");
      setTextIfChanged(side.playbadge, "WEBM");
      if (side.ecoModel) side.ecoModel.hidden = false;
      disableSideVuReadout("0.14");
      return;
    }
    const activeClipLabel = activeClipName(8);
    const source = SOURCE_TARGETS[sourceIdx] || SOURCE_TARGETS[0];
    const sourceFlash = performance.now() < sourceFlashUntil;
    if (side.ecoModel) side.ecoModel.hidden = true;
    setTextIfChanged(side.vol, attActive ? "ATTENUATOR" : (Math.round(getPlayerVolume() * 100) + "%"));
    setTextIfChanged(side.mode, demoAutoMode ? "DEMO" : (oelDisplayEnabled ? "WEBM" : "----"));
    setTextIfChanged(side.tint, TINT_LABELS[tintIdx]);
    setTextIfChanged(side.dim, perf.label === "ECO" ? (lcdDimmed ? "ECO DIM" : "ECO") : (lcdDimmed ? "DIM" : "FULL"));
    setTextIfChanged(side.repeat, playerState.repeat);
    setTextIfChanged(side.shuffle, playerState.shuffle ? "ON" : "OFF");
    setTextIfChanged(side.status, sourceFlash ? ("SRC " + source.label) : (demoAutoMode ? "DEMO" : (oelDisplayEnabled ? activeClipLabel : (playerState.playing ? "PLAY" : "PAUSE"))));
    setTextIfChanged(side.playbadge, demoAutoMode ? "AUTO" : (oelDisplayEnabled ? "WEBM" : (playerState.playing ? "RUN" : "IDLE")));
  }

  function activeStaticReadoutIntervalMs() {
    return activePerformanceConfig().label === "ECO" ? ECO_STATIC_READOUT_INTERVAL_MS : STATIC_READOUT_INTERVAL_MS;
  }

  function runStaticOverlayUpdate(playerState, ts) {
    lastStaticReadoutAt = ts;
    staticReadoutsDirty = false;
    updateButtonStates(playerState);
    updateSideStaticReadouts(playerState);
    updateLcdCornerReadouts(playerState, ts);
  }

  function updateOverlays(progressMs, timing, ts = performance.now()) {
    const staticDue = staticReadoutsDirty || ts - lastStaticReadoutAt >= activeStaticReadoutIntervalMs();
    if (ts - lastProgressReadoutAt < PROGRESS_READOUT_INTERVAL_MS) {
      if (staticDue) runStaticOverlayUpdate(getSampledPlayerState(ts), ts);
      return;
    }
    lastProgressReadoutAt = ts;
    const dom = getPvfdDom();
    const playerState = getSampledPlayerState(ts);
    const title = trackTitle || PVFD_META_IDLE_GLYPH;
    const artist = trackArtist || "";
    const label = artist ? `${artist} - ${title}` : title;
    const durationMs = timing && timing.durationMs !== undefined ? timing.durationMs : getCurrentDurationMs();
    const elapsed = fmtTime(progressMs);
    const timeText = durationMs > 0 ? `${elapsed} / ${fmtTime(durationMs)}` : elapsed;
    const pct = durationMs > 0 ? clamp(progressMs / durationMs, 0, 1) : 0;

    if (dom.meta) {
      const metaLabel = "Open Now Playing: " + label;
      const metaShortcut = dom.metaTitle || dom.meta;
      setMetaTrackContent(label, playerState.playing);
      if (dom.meta.title !== metaLabel) dom.meta.title = metaLabel;
      if (metaShortcut && metaShortcut.title !== metaLabel) metaShortcut.title = metaLabel;
      setAttrIfChanged(metaShortcut, "aria-label", metaLabel);
    }
    setTextIfChanged(dom.time, timeText);
    if (dom.progress) {
      setStyleIfChanged(dom.progress, "--pvfd-progress", (pct * 100).toFixed(2) + "%");
      const progressLabel = makeProgressLabel(progressMs, durationMs);
      const titleText = "Scrub: " + progressLabel;
      if (dom.progress.title !== titleText) dom.progress.title = titleText;
      setAttrIfChanged(dom.progress, "aria-label", "Scrub progress " + progressLabel);
    }
    setTextIfChanged(dom.progressText, "");
    updateLcdCornerReadouts(playerState, ts);
    if (activePerformanceConfig().sideReadouts) updateSideProgressReadouts(progressMs, durationMs);
    if (staticDue) runStaticOverlayUpdate(playerState, ts);
  }

  function updateLknobLED() {
    knobLedDirty = false;
    const dom = getPvfdDom();
    if (!dom.knobArc) return;
    // 12 o'clock is 0%, one full clockwise sweep is 100%.
    const sweepDeg = (360 * getPlayerVolume()).toFixed(1) + "deg";
    setStyleIfChanged(dom.knobArc, "--pvfd-led-deg", sweepDeg);
    setStyleIfChanged(dom.knobIndicator, "--pvfd-rot", sweepDeg);
  }

  let lastFrame = 0;
  let lastProgressReadoutAt = -Infinity;
  let lastLcdClockReadoutAt = -Infinity;
  let lastStaticReadoutAt = -Infinity;
  let lastTrackSyncAt = -Infinity;
  let lastBarUpdateAt = -Infinity;
  let lastKnobLedAt = -Infinity;

  function activeFrameIntervalMs() {
    const perf = activePerformanceConfig();
    return perf.frameMs;
  }

  function syncLogoAudioDemand(wantAudio) {
    if (!wantAudio) {
      if (logoLiveAudioResumeTimer) {
        clearTimeout(logoLiveAudioResumeTimer);
        logoLiveAudioResumeTimer = 0;
      }
      if (logoLiveAudioActive || logoLiveAudioPending) stopLogoLiveAudioCapture();
      return;
    }
    if (!logoLiveAudioActive && !logoLiveAudioPending && !logoLiveAudioResumeTimer) {
      logoLiveAudioResumeTimer = window.setTimeout(() => {
        logoLiveAudioResumeTimer = 0;
        if (logoGlowEnabled && !logoLiveAudioActive && !logoLiveAudioPending && safePlayerIsPlaying(false)) {
          startLogoLiveAudioCapture();
        }
      }, 250);
    }
  }


  installPvfdPlaylistScrollStressDetector();
  function loop(ts) {
    requestAnimationFrame(loop);
    pvfdDiag.loopFrames++;

    if (ts - lastFrame < activeFrameIntervalMs()) return;

    lastFrame = ts;

    if (!ctx || !chassis) return;

    const perfAt = pvfdPerfStart();
    const scrollStress = isPvfdPlaylistScrollStressActive(ts);

    setAttrIfChanged(chassis, "data-pvfd-demo", demoAutoMode ? "on" : "off");

    // DEMO showroom auto-cycle. Advance to the next clip every
    // DEMO_CYCLE_INTERVAL_MS while DEMO is on. setActiveClip with persist=false
    // means the cycle doesn't overwrite the user's saved clip preference.
    if (demoAutoMode && ts - demoLastClipSwitchMs >= DEMO_CYCLE_INTERVAL_MS) {
      setActiveClip(clipIdx + 1, false);
      demoLastClipSwitchMs = ts;
    }

    // Never read canvas.clientWidth/Height inline — that forces a synchronous layout
    // flush which collides with Spotify's main-view mouseover delegate and React
    // scheduler tick on the same thread (measured 98ms forcedLayout across 4 frames
    // during home-quicklink sweeps). If the size cache is missing, schedule a
    // sizeCanvas in its own rAF and bail this frame.
    if (!canvasCssW || !canvasCssH) {
      scheduleSizeCanvas();
      pvfdPerfEnd("mainLoopTotal", perfAt);
      return;
    }

    const w = canvasCssW;
    const h = canvasCssH;

    const timing = getSampledPlaybackTiming(ts);
    const progressMs = getDisplayProgressMs(ts, timing);
    const perf = activePerformanceConfig();

    // OEL stays hot. Do not hide this inside the medium lane.
    if (oelDisplayEnabled) {
      syncOelVideoPlayback();
    }

    // Side VU/readout is decorative, so it yields during playlist scroll.
    if (perf.sideVu && !scrollStress) {
      const sideVuStateChanged = lastSideVuPlayingState !== timing.playing;

      if (sideVuStateChanged) {
        lastSideVuPlayingState = timing.playing;
        sideVuSettleUntil = ts + SIDE_VU_SETTLE_MS;
      }

      if (
        sideVuStateChanged ||
        (ts < sideVuSettleUntil && ts - lastBarUpdateAt >= SIDE_VU_SETTLE_UPDATE_MS)
      ) {
        lastBarUpdateAt = ts;

        const visualizerPerfAt = pvfdPerfStart();
        updateBars(timing.playing);
        pvfdPerfEnd("sideVuBarsUpdate", visualizerPerfAt);
      }

      if (sideVuStateChanged || ts - lastSideVuReadoutAt >= SIDE_VU_READOUT_MS) {
        lastSideVuReadoutAt = ts;

        const readoutPerfAt = pvfdPerfStart();
        updateSideVuReadout();
        pvfdPerfEnd("sideVuReadoutUpdate", readoutPerfAt);
      }
    }

    // Medium DOM maintenance yields during playlist scroll.
    // Logo audio demand still gets checked occasionally so the main visualizer stays alive.
    if (scrollStress) {
      if (ts - lastScrollStressLogoDemandAt >= SCROLL_STRESS_LOGO_DEMAND_MS) {
        lastScrollStressLogoDemandAt = ts;
        syncLogoAudioDemand(logoGlowEnabled && timing.playing);
      }

      if (
        (pendingVolume !== null || knobLedDirty) &&
        ts - lastScrollStressKnobLedAt >= SCROLL_STRESS_KNOB_LED_MS
      ) {
        lastScrollStressKnobLedAt = ts;
        updateLknobLED();
      }
    } else if (ts - lastMediumLaneAt >= MEDIUM_LANE_INTERVAL_MS) {
      lastMediumLaneAt = ts;

      syncCurrentTrackFromPlayer(false, ts);
      updateOverlays(progressMs, timing, ts);
      syncLogoAudioDemand(logoGlowEnabled && timing.playing);

      if (pendingVolume !== null || knobLedDirty || ts - lastKnobLedAt >= EXTERNAL_VOLUME_LED_SAMPLE_MS) {
        lastKnobLedAt = ts;
        updateLknobLED();
      }
    }

    // Main logo visualizer audio stays hot.
    if (logoGlowEnabled && logoLiveAudioActive && ts - lastLogoLiveAudioUpdateAt >= LOGO_LIVE_AUDIO_SCHEDULER_MS) {
      lastLogoLiveAudioUpdateAt = ts;
      updateLogoLiveAudioPulse(ts);
    }

    // Main logo visualizer render stays hot.
    if (logoRenderState.dirty) {
      renderLogoVisuals(ts, false);
    }

    // Slow maintenance yields during playlist scroll.
    if (!scrollStress && ts - lastSlowLaneAt >= SLOW_LANE_INTERVAL_MS) {
      lastSlowLaneAt = ts;
      refreshPvfdPerfEnabled();
      updateRouteState(false, ts);
      }

    pvfdPerfEnd("mainLoopTotal", perfAt);
  }

  function onTrackChange() {
    markPlayerStateDirty();
    playerTimingCache.at = -Infinity;
    lastTrackSyncAt = -Infinity;
    syncCurrentTrackFromPlayer(true);
    const playBtn = chassis && chassis.querySelector("[data-pvfd='play']");
    if (playBtn) playBtn.textContent = safePlayerIsPlaying(false) ? PVFD_PAUSE_GLYPH : PVFD_PLAY_GLYPH;
  }

  const LIBRARY_RECENTS_SELECTOR = [
    "button[aria-label*='Recents' i]",
    "[role='button'][aria-label*='Recents' i]",
    "button[title*='Recents' i]",
    "[role='button'][title*='Recents' i]",
    "[data-testid*='recents' i]",
    "[class*='recents' i]",
    "[class*='Recents']"
  ].join(",");
  let librarySearchFixTimer = 0;
  let pvfdMutationTimer = 0;
  let pvfdMutationFlushTimer = 0;
  let librarySearchLastRoot = null;
  let lyricsSyncFixTimer = 0;
  let lyricsSyncLastRoot = null;
  let lyricsViewCacheAt = -Infinity;
  let lyricsViewCache = false;


  function syncLibrarySearchState(container, input) {
    const hasText = !!input.value;
    container.classList.toggle("pvfd-filter-has-text", hasText);
  }

  function isGlobalSearchFocusTarget(target) {
    if (!target || !target.matches) return false;
    if (!target.matches("input, [role='searchbox'], [contenteditable='true']")) return false;
    return !!(target.closest && target.closest(
      ".Root__top-bar, .Root__globalNav, [data-testid*='global-nav' i], [class*='globalNav' i]"
    ));
  }

  function syncGlobalSearchFocus(target = document.activeElement) {
    const perfAt = pvfdPerfStart();
    const nextFocused = isGlobalSearchFocusTarget(target);
    if (nextFocused === globalSearchFocusState) {
      pvfdPerfEnd("globalSearchFocusSync", perfAt);
      return;
    }
    globalSearchFocusState = nextFocused;
    document.documentElement.classList.toggle("pvfd-global-search-focused", nextFocused);
    if (document.body && document.body.dataset) document.body.dataset.pvfdGlobalSearchFocused = nextFocused ? "1" : "0";
    pvfdPerfEnd("globalSearchFocusSync", perfAt);
  }

  function scheduleGlobalSearchFocusSync(target = document.activeElement, delay = 0) {
    pendingGlobalSearchFocusTarget = target;
    if (globalSearchFocusTimer) return;
    globalSearchFocusTimer = window.setTimeout(() => {
      globalSearchFocusTimer = 0;
      const nextTarget = pendingGlobalSearchFocusTarget || document.activeElement;
      pendingGlobalSearchFocusTarget = null;
      syncGlobalSearchFocus(nextTarget);
    }, delay);
  }

  function findLibraryToolbarParts(container) {
    let node = container && container.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.matches && node.matches(".Root__nav-bar, nav[aria-label='Main'], aside, [role='navigation']")) break;
      const recents = node.querySelector && node.querySelector(LIBRARY_RECENTS_SELECTOR);
      if (recents) {
        return {
          toolbar: node,
          recents: (recents.closest && recents.closest("button, [role='button']")) || recents,
        };
      }
    }
    return { toolbar: null, recents: null };
  }

  function reconcileLibraryToolbar(container) {
    const { toolbar, recents } = findLibraryToolbarParts(container);
    if (toolbar && !patchedLibraryToolbars.has(toolbar)) {
      patchedLibraryToolbars.add(toolbar);
      toolbar.classList.add("pvfd-library-toolbar");
    }
    if (recents && !patchedLibraryRecentsControls.has(recents)) {
      patchedLibraryRecentsControls.add(recents);
      recents.classList.add("pvfd-library-recents-control");
    }
  }


  function isLibrarySearchContainer(container) {
    if (!container || !container.closest) return false;
    // Only the left Your Library search should receive the JS layout class.
    // Playlist / Local Files / Liked Songs search boxes live in .Root__main-view and must be styled by static CSS.
    if (container.closest(".Root__main-view, .main-view-container, .main-view-container__scroll-node")) return false;
    return !!container.closest(".Root__nav-bar, nav[aria-label='Main'], [role='navigation'], .main-yourLibraryX-library");
  }

  function collectLibrarySearchBoxes(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    const boxes = [];
    if (scope.matches && scope.matches(".x-filterBox-filterInputContainer")) boxes.push(scope);
    if (scope.querySelectorAll) scope.querySelectorAll(".x-filterBox-filterInputContainer").forEach((container) => boxes.push(container));
    return boxes;
  }

  function reconcileLibrarySearchBoxes(root = document) {
    const perfAt = pvfdPerfStart();
    collectLibrarySearchBoxes(root).forEach((container) => {
      if (!isLibrarySearchContainer(container)) {
        container.classList.remove("pvfd-library-search-box", "pvfd-filter-has-text");
        return;
      }
      const input = container.querySelector(".x-filterBox-filterInput");
      if (!input) return;

      if (!patchedLibrarySearchContainers.has(container)) {
        patchedLibrarySearchContainers.add(container);
        container.classList.add("pvfd-library-search-box");
      } else if (!container.classList.contains("pvfd-library-search-box")) {
        container.classList.add("pvfd-library-search-box");
      }
      reconcileLibraryToolbar(container);

      if (!patchedLibrarySearchInputs.has(input)) {
        patchedLibrarySearchInputs.add(input);
        const sync = () => syncLibrarySearchState(container, input);
        input.addEventListener("input", sync);
        input.addEventListener("change", sync);
        input.addEventListener("focus", sync);
        input.addEventListener("blur", sync);
      }
      syncLibrarySearchState(container, input);
    });
    pvfdPerfEnd("searchReconciliation", perfAt);
  }

  function scheduleLibrarySearchReconcile(root, delay = 120) {
    librarySearchLastRoot = root && root.querySelectorAll ? root : document;
    if (librarySearchFixTimer) return;
    const nextDelay = Math.max(delay, isRouteChurnActive() ? ROUTE_CHURN_SEARCH_DELAY_MS : 0);
    librarySearchFixTimer = window.setTimeout(() => {
      const nextRoot = librarySearchLastRoot || document;
      librarySearchFixTimer = 0;
      librarySearchLastRoot = null;
      reconcileLibrarySearchBoxes(nextRoot);
    }, nextDelay);
  }

  function elementFromMutationNode(node) {
    return node && node.nodeType === 1 ? node : null;
  }

  function findLibrarySearchBox(el, includeDescendants = false) {
    if (!el || !el.matches) return null;
    if (el.matches(".x-filterBox-filterInputContainer")) return el;
    const closestBox = el.closest && el.closest(".x-filterBox-filterInputContainer");
    if (closestBox) return closestBox;
    if (includeDescendants && el.querySelector) return el.querySelector(".x-filterBox-filterInputContainer");
    return null;
  }

  const BROWSE_FONT_TARGET_SELECTOR = ".Root__main-view, .main-view-container, .main-view-container__scroll-node";

  function containsBrowseFontTarget(el) {
    if (!el || !el.matches) return false;
    // Deliberately do not use closest() here. Route/card churn inside the main view
    // used to retrigger font propagation on almost every Home mutation even though
    // the inherited variables already existed on the view root.
    return el.matches(BROWSE_FONT_TARGET_SELECTOR);
  }

  function addedNodeContainsBrowseFontTarget(el) {
    if (!el || !el.matches) return false;
    return el.matches(BROWSE_FONT_TARGET_SELECTOR) || !!(el.querySelector && el.querySelector(BROWSE_FONT_TARGET_SELECTOR));
  }

  const LIBRARY_SEARCH_SCOPE_SELECTOR = ".Root__nav-bar, nav[aria-label='Main'], aside, [role='navigation'], .main-yourLibraryX-library";

  function isLibrarySearchMutationScope(el) {
    if (!el || !el.matches) return false;
    if (el.matches(".x-filterBox-filterInputContainer, .x-filterBox-filterInput")) return true;
    if (el.closest && el.closest(".x-filterBox-filterInputContainer")) return true;
    return el.matches(LIBRARY_SEARCH_SCOPE_SELECTOR) || !!(el.closest && el.closest(LIBRARY_SEARCH_SCOPE_SELECTOR));
  }

  const LYRICS_SCOPE_SELECTOR = [
    "[data-testid*='lyrics' i]",
    "[class*='lyrics-lyrics' i]",
    "[class*='LyricsLyrics' i]",
    "[class*='lyricsPage' i]:not(.BeautifulLyricsPage)",
    "[class*='LyricsPage' i]:not(.BeautifulLyricsPage)",
    ".lyrics-lyrics-container",
    ".lyrics-lyrics-background",
    ".lyrics-lyrics-contentContainer"
  ].join(", ");

  const LYRICS_SURFACE_SELECTOR = [
    ".lyrics-lyrics-container",
    "[class*='lyrics-lyrics-container' i]",
    "[class*='LyricsLyricsContainer' i]",
    ".lyrics-lyrics-background",
    "[class*='lyrics-lyrics-background' i]",
    "[class*='LyricsLyricsBackground' i]",
    ".lyrics-lyrics-contentContainer",
    "[class*='lyrics-lyrics-contentContainer' i]",
    "[class*='LyricsLyricsContent' i]"
  ].join(", ");

  function hasLyricsView() {
    const now = performance.now();
    if (now - lyricsViewCacheAt < 500) return lyricsViewCache;
    lyricsViewCacheAt = now;
    lyricsViewCache = !!document.querySelector(LYRICS_SCOPE_SELECTOR);
    return lyricsViewCache;
  }

  function collectButtons(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const buttons = [];
    if (scope.matches && scope.matches("button, [role='button']")) buttons.push(scope);
    scope.querySelectorAll("button, [role='button']").forEach((button) => buttons.push(button));
    return buttons;
  }

  function rootLooksLyricsScoped(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope === document) return true;
    return !!(
      (scope.matches && scope.matches(LYRICS_SCOPE_SELECTOR)) ||
      (scope.closest && scope.closest(LYRICS_SCOPE_SELECTOR)) ||
      (scope.querySelector && scope.querySelector(LYRICS_SCOPE_SELECTOR))
    );
  }

  function tagLyricsSurfaces(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    let tagged = 0;
    const surfaces = [];
    if (scope.matches && scope.matches(LYRICS_SURFACE_SELECTOR)) surfaces.push(scope);
    scope.querySelectorAll(LYRICS_SURFACE_SELECTOR).forEach((el) => surfaces.push(el));

    surfaces.forEach((el) => {
      if (!el || !el.classList) return;
      if (el.matches(".lyrics-lyrics-container, [class*='lyrics-lyrics-container' i], [class*='LyricsLyricsContainer' i]") && !el.classList.contains("pvfd-lyrics-surface")) {
        el.classList.add("pvfd-lyrics-surface");
        tagged++;
      }
      if (el.matches(".lyrics-lyrics-background, [class*='lyrics-lyrics-background' i]")) {
        el.classList.add("pvfd-lyrics-background");
      }
      if (el.matches(".lyrics-lyrics-contentContainer, [class*='lyrics-lyrics-contentContainer' i]")) {
        el.classList.add("pvfd-lyrics-content");
      }
    });

    return tagged;
  }

  function isLyricsSyncButton(button) {
    if (!button) return false;
    const label = [
      button.textContent,
      button.getAttribute && button.getAttribute("aria-label"),
      button.getAttribute && button.getAttribute("title")
    ].map((value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean).join(" ");
    return label === "sync" || /\bsync\b/.test(label);
  }

  function reconcileLyricsSyncButtons(root = document) {
    const perfAt = pvfdPerfStart();
    if (!hasLyricsView() || !rootLooksLyricsScoped(root)) {
      pvfdPerfEnd("searchReconciliation", perfAt);
      return 0;
    }
    let tagged = tagLyricsSurfaces(root);
    collectButtons(root).forEach((button) => {
      if (isLyricsSyncButton(button)) {
        if (!patchedLyricsSyncButtons.has(button)) patchedLyricsSyncButtons.add(button);
        if (!button.classList.contains("pvfd-lyrics-sync-button")) {
          button.classList.add("pvfd-lyrics-sync-button");
          button.setAttribute("data-pvfd", "lyrics-sync");
        }
        tagged++;
      }
    });
    pvfdPerfEnd("searchReconciliation", perfAt);
    return tagged;
  }

  function scheduleLyricsSyncReconcile(root, delay = 120) {
    lyricsSyncLastRoot = root && root.querySelectorAll ? root : document;
    lyricsViewCacheAt = -Infinity;
    if (lyricsSyncFixTimer) return;
    lyricsSyncFixTimer = window.setTimeout(() => {
      const nextRoot = lyricsSyncLastRoot || document;
      lyricsSyncFixTimer = 0;
      lyricsSyncLastRoot = null;
      const tagged = reconcileLyricsSyncButtons(nextRoot);
      if (!tagged && nextRoot !== document) reconcileLyricsSyncButtons(document);
    }, delay);
  }

  function findLyricsSyncRoot(node, includeDescendants = false) {
    if (!node || !node.matches) return null;
    if (node.matches(LYRICS_SCOPE_SELECTOR)) return node;
    const closestLyrics = node.closest && node.closest(LYRICS_SCOPE_SELECTOR);
    if (closestLyrics) return closestLyrics;
    if (includeDescendants && node.querySelector && node.querySelector(LYRICS_SCOPE_SELECTOR)) return node;
    if (node.matches("button, [role='button']")) return node;
    if (includeDescendants && node.querySelector) return node.querySelector("button, [role='button']");
    return null;
  }

  function scheduleChassisRecheck() {
    if (chassis && chassis.isConnected) return;
    if (pvfdMutationTimer) return;
    pvfdMutationTimer = window.setTimeout(() => {
      pvfdMutationTimer = 0;
      if (!chassis || !chassis.isConnected) injectChassis();
    }, 250);
  }

  function flushMutationRecords() {
    pvfdDiag.mutationFlushes++;
    const perfAt = pvfdPerfStart();
    pvfdMutationFlushTimer = 0;
    const work = {
      chassisRecheck: pvfdMutationWork.chassisRecheck,
      mainViewChurn: pvfdMutationWork.mainViewChurn,
      searchRoot: pvfdMutationWork.searchRoot,
      lyricsRoot: pvfdMutationWork.lyricsRoot,
      browseFontTarget: pvfdMutationWork.browseFontTarget,
      routeMaybeChanged: pvfdMutationWork.routeMaybeChanged,
    };
    pvfdMutationWork.chassisRecheck = false;
    pvfdMutationWork.mainViewChurn = false;
    pvfdMutationWork.searchRoot = null;
    pvfdMutationWork.lyricsRoot = null;
    pvfdMutationWork.browseFontTarget = false;
    pvfdMutationWork.routeMaybeChanged = false;
    if (!work.chassisRecheck && !work.mainViewChurn && !work.searchRoot && !work.lyricsRoot && !work.browseFontTarget && !work.routeMaybeChanged) {
      pvfdPerfEnd("mutationFlush", perfAt);
      return;
    }

    if (work.chassisRecheck) scheduleChassisRecheck();
    if (work.routeMaybeChanged) updateRouteState(true);
    if (work.browseFontTarget) applyBrowseFontPreset(false);
    if (work.searchRoot) scheduleLibrarySearchReconcile(work.searchRoot, work.mainViewChurn ? ROUTE_CHURN_SEARCH_DELAY_MS : 80);
    if (hasLyricsView() && work.lyricsRoot) scheduleLyricsSyncReconcile(work.lyricsRoot, work.mainViewChurn ? ROUTE_CHURN_SEARCH_DELAY_MS : 80);
    pvfdPerfEnd("mutationFlush", perfAt);
  }

  const MAIN_VIEW_MUTATION_SELECTOR = ".Root__main-view, .main-view-container, .main-view-container__scroll-node";

  function isMainViewMutationTarget(el) {
    if (!el || !el.matches) return false;
    return !!(
      el.matches(MAIN_VIEW_MUTATION_SELECTOR) ||
      (el.closest && el.closest(MAIN_VIEW_MUTATION_SELECTOR))
    );
  }

  function accumulateMutationNodeWork(el, includeDescendants = false) {
    if (!el || !el.matches) return;
    if (!pvfdMutationWork.browseFontTarget && addedNodeContainsBrowseFontTarget(el)) {
      pvfdMutationWork.browseFontTarget = true;
    }
    if (!pvfdMutationWork.mainViewChurn) {
      const mainViewHit = includeDescendants
        ? addedNodeContainsBrowseFontTarget(el) || isMainViewMutationTarget(el)
        : isMainViewMutationTarget(el);
      if (mainViewHit) {
        pvfdMutationWork.mainViewChurn = true;
        pvfdMutationWork.routeMaybeChanged = true;
        beginRouteChurn(CLIP_CACHE_ROUTE_REBUILD_BLOCK_MS);
        markClipCacheRebuildStress(CLIP_CACHE_ROUTE_REBUILD_BLOCK_MS);
      }
    }
    if (!pvfdMutationWork.searchRoot && isLibrarySearchMutationScope(el)) {
      pvfdMutationWork.searchRoot = findLibrarySearchBox(el, includeDescendants) || document;
    }
    if (!pvfdMutationWork.lyricsRoot) {
      const lyricsRoot = findLyricsSyncRoot(el, includeDescendants);
      if (lyricsRoot) pvfdMutationWork.lyricsRoot = lyricsRoot;
    }
  }

  function queueMutationRecords(records) {
    pvfdDiag.mutationQueues++;
    const perfAt = pvfdPerfStart();
    let hasWork = false;
    for (const record of records) {
      const target = elementFromMutationNode(record.target);
      if (chassis && target && chassis.contains(target)) continue;
      pvfdMutationWork.chassisRecheck = true;
      accumulateMutationNodeWork(target, false);
      for (const node of record.addedNodes || []) {
        accumulateMutationNodeWork(elementFromMutationNode(node), true);
      }
      hasWork = true;
    }
    if (!hasWork) {
      pvfdPerfEnd("mutationQueue", perfAt);
      return;
    }
    if (!pvfdMutationFlushTimer) {
      pvfdMutationFlushTimer = window.setTimeout(flushMutationRecords, MUTATION_FLUSH_DELAY_MS);
    }
    pvfdPerfEnd("mutationQueue", perfAt);
  }

  function recoverNativePlayerAfterFatal() {
    pvfdDiag.recoverFatals++;
    try {
      if (typeof stopLogoLiveAudioScheduler === "function") stopLogoLiveAudioScheduler();
      if (chassis && chassis.parentNode) chassis.parentNode.removeChild(chassis);
      const bar = findPlayerBar();
      if (bar) {
        bar.classList.remove("pvfd-mounted");
        Array.from(bar.children).forEach((child) => {
          child.classList.remove("pvfd-native-player-hidden");
          if (child.getAttribute("aria-hidden") === "true") child.removeAttribute("aria-hidden");
        });
      }
      chassis = null;
      logoStrip = null;
      pvfdDom = null;
      canvas = null;
      ctx = null;
    } catch (recoverErr) {
      console.warn("[PVFD] Native player recovery failed:", recoverErr);
    }
  }

  function attach() {
    try {
      attachUnsafe();
    } catch (err) {
      console.error("[PVFD] Init failed; restored Spotify player and will retry.", err);
      recoverNativePlayerAfterFatal();
      window.__PVFD_EXTENSION_RUNNING__ = false;
      setTimeout(PioneerVFD, 1000);
    }
  }

   // home-page hover/pointer event suppression
  //extends from quicklinks-only to full home-page cards).
  //
  // Background (diagnosed May 7, 2026 via window-capture event blocking A/B):
  //   After leaving Home and returning, fast horizontal sweeps over the top
  //   quick-link tiles produced 100-130ms longtasks paced at the user's hover
  //   rate. Attribution from `long-animation-frame`:
  //     - `xpui-modules.js | tX`  (DIV#main mouseover listener)  ~99% forced layout
  //     - `xpui-modules.js | P`   (MessagePort.onmessage = React 18 scheduler)
  //                               ~86% forced layout
  //   Each pointer movement drove a chain of:
  //     mouseover -> tX reads layout (forced flush) -> tX writes React state
  //     -> React schedules commit -> P commits the fiber, writes DOM
  //     -> next mouseover/pointerover/pointermove -> tX flushes again.
  //
  //   Diagnostic A/B (window-capture stopImmediatePropagation per type):
  //     - block mouseover  alone -> still lags
  //     - block pointerover alone -> still lags
  //     - block pointermove alone -> still lags
  //     - block ALL of {mouseover, mouseout, mouseenter, mouseleave,
  //                     pointerover, pointerout, pointerenter, pointerleave,
  //                     pointermove, mousemove} -> buttery smooth
  //   Conclusion: Spotify's React commit work is fired redundantly by every
  //   hover-class event, so silencing only one type leaves the others as backup
  //   triggers. Blocking the entire family is the minimum sufficient set.
  //
  //   intra-tile mouseover coalescer was insufficient: mouseover-only,
  //   same-tile-only. Replaced by full-family block on the quicklinks
  //   grid. extends the same proven block to the rest of the home page
  //   (album/playlist cards and their chrome play-button containers), verified
  //   via the same window-capture A/B method on the cards surface.
  //
  // What this DOES suppress (capture phase on `window`, scoped to the
  // selectors below):
  //     mouseover, mouseout, mouseenter, mouseleave,
  //     pointerover, pointerout, pointerenter, pointerleave,
  //     pointermove, mousemove.
  //
  // Scopes (any element matching closest() of these gets its hover events killed):
  //   - `.view-homeShortcutsGrid-grid`         (top quicklink tiles)
  //   - `[data-testid="home-page"] .main-card-card`
  //   - `[data-testid="home-page"] [data-encore-id="card"]`
  //   - `[data-testid="home-page"] .main-card-cardContainer`
  //   - `[data-testid="home-page"] .main-card-PlayButtonContainer`
  //
  // What this does NOT touch:
  //   - any event outside home (other pages unaffected; fix is gated by
  //     `[data-testid="home-page"]` for the cards + a unique class for quicklinks)
  //   - click, auxclick, dblclick, contextmenu (-> tile/card activation works)
  //   - mousedown/up, pointerdown/up, touchstart/end (-> activation works)
  //   - focusin/focusout, keydown/up (-> keyboard nav + focus rings work)
  //   - drag, dragstart, dragend, dragover, drop (-> dnd unaffected)
  //   - wheel, scroll (-> scrolling unaffected)
  //   - CSS :hover (browser-internal, independent of JS event dispatch),
  //     so the visible hover glow / play-button reveal still appear.
  //
  // Disable at runtime for A/B testing without a reinstall:
  //     window.__pvfdDisableHoverBlock = true;
  const PVFD_HOVER_BLOCK_TYPES = [
    "mouseover", "mouseout", "mouseenter", "mouseleave",
    "pointerover", "pointerout", "pointerenter", "pointerleave",
    "pointermove", "mousemove"
  ];
  const PVFD_HOVER_BLOCK_SCOPE = [
    ".view-homeShortcutsGrid-grid",
    '[data-testid="home-page"] .main-card-card',
    '[data-testid="home-page"] [data-encore-id="card"]',
    '[data-testid="home-page"] .main-card-cardContainer',
    '[data-testid="home-page"] .main-card-PlayButtonContainer',
    '.main-rootlist-wrapper'
  ].join(", ");
  /* Chassis-scoped subset of the hover block. Excludes pointermove/mousemove
     because our knob/scrubber drag handlers depend on those events. The
     over/out/enter/leave family is the actual trigger for Spotify's `te`
     forced-reflow chain during chassis interaction (Performance trace showed
     86 layouts averaging 200ms each, all from `te @ xpui-modules.js:30`,
     firing once per pointer event during knob drag). Blocking the hover-
     enter/leave family on the chassis stops Spotify's listener from
     re-running while keeping our drag handlers functional. */
  const PVFD_CHASSIS_HOVER_BLOCK_TYPES = [
    "mouseover", "mouseout", "mouseenter", "mouseleave",
    "pointerover", "pointerout", "pointerenter", "pointerleave"
  ];
  const PVFD_CHASSIS_HOVER_BLOCK_SCOPE = ".pvfd-chassis";
  let pvfdHoverBlockInstalled = false;
  function pvfdHoverBlockHandler(e) {
    if (window.__pvfdDisableHoverBlock) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest(PVFD_HOVER_BLOCK_SCOPE)) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
  }
  function pvfdChassisHoverBlockHandler(e) {
    if (window.__pvfdDisableHoverBlock) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest(PVFD_CHASSIS_HOVER_BLOCK_SCOPE)) return;
    e.stopImmediatePropagation();
    e.stopPropagation();
  }
  // Chassis-bubble pointer block. Different mechanism from the window-capture
  // hover block above: this fires on the BUBBLE phase at the chassis element,
  // AFTER our own knob/scrubber/navring handlers have run during target phase.
  // Stops pointermove/mousemove from bubbling further to document/window where
  // React 18's root dispatcher and any Spotify global tracker would receive
  // them. Trace 20260530T214233 showed 139 forced layouts at 63ms avg during
  // a knob drag with stacks rooted at xpui-modules.js callbacks, with zero
  // pioneerVFD frames — the trigger is downstream of the event reaching the
  // React root. Session 2's window-capture attempt had to exclude pointermove
  // because window-capture runs BEFORE our handlers and would kill them; this
  // bubble-phase attachment is the path that wasn't tried then.
  // Disable for runtime A/B: window.__pvfdDisablePointerBubbleBlock = true
  let pvfdPointerBubbleBlockInstalled = false;
  function pvfdPointerBubbleBlockHandler(e) {
    if (window.__pvfdDisablePointerBubbleBlock) return;
    // Only stop bubble propagation. Do NOT stopImmediatePropagation —
    // sibling bubble handlers on the chassis (if any) should still see the
    // event. Our knob/scrubber/navring handlers already fired at target.
    e.stopPropagation();
    pvfdDiag.pointerBubbleBlocks = (pvfdDiag.pointerBubbleBlocks || 0) + 1;
  }
  function installChassisPointerBubbleBlock() {
    if (pvfdPointerBubbleBlockInstalled) return;
    if (!chassis) return;
    pvfdPointerBubbleBlockInstalled = true;
    chassis.addEventListener("pointermove", pvfdPointerBubbleBlockHandler, false);
    chassis.addEventListener("mousemove", pvfdPointerBubbleBlockHandler, false);
  }

  function installShortcutHoverBlock() {
    if (pvfdHoverBlockInstalled) return;
    pvfdHoverBlockInstalled = true;
    for (let i = 0; i < PVFD_HOVER_BLOCK_TYPES.length; i++) {
      window.addEventListener(
        PVFD_HOVER_BLOCK_TYPES[i],
        pvfdHoverBlockHandler,
        { capture: true, passive: true }
      );
    }
    for (let i = 0; i < PVFD_CHASSIS_HOVER_BLOCK_TYPES.length; i++) {
      window.addEventListener(
        PVFD_CHASSIS_HOVER_BLOCK_TYPES[i],
        pvfdChassisHoverBlockHandler,
        { capture: true, passive: true }
      );
    }
  }

  function onHomeShortcutPointerStress(event) {
    const target = event && event.target;
    if (!target || !target.closest) return;
    const nextShortcut = target.closest(".view-homeShortcutsGrid-shortcut");
    if (!nextShortcut) return;

    const relatedTarget = event.relatedTarget;
    const previousShortcut = (
      relatedTarget &&
      relatedTarget.closest &&
      relatedTarget.closest(".view-homeShortcutsGrid-shortcut")
    ) || null;

    // pointerover fires for child-boundary hops too; only mark stress when the
    // cursor actually crosses into a different quick-link tile.
    if (previousShortcut === nextShortcut) return;
    markClipCacheRebuildStress(CLIP_CACHE_HOME_POINTER_REBUILD_BLOCK_MS);
  }

  function onHomeShortcutPointerStress(event) {
    const target = event && event.target;
    if (!target || !target.closest) return;
    const nextShortcut = target.closest(".view-homeShortcutsGrid-shortcut");
    if (!nextShortcut) return;

    const relatedTarget = event.relatedTarget;
    const previousShortcut = (
      relatedTarget &&
      relatedTarget.closest &&
      relatedTarget.closest(".view-homeShortcutsGrid-shortcut")
    ) || null;

    // pointerover fires for child-boundary hops too; only mark stress when the
    // cursor actually crosses into a different quick-link tile.
    if (previousShortcut === nextShortcut) return;
    markClipCacheRebuildStress(CLIP_CACHE_HOME_POINTER_REBUILD_BLOCK_MS);
  }

  function attachUnsafe() {
    pvfdDiag.attachUnsafeCalls++;
    if (!injectChassis()) {
      setTimeout(attach, 500);
      return;
    }
    fontPresetIdx = readFontPresetIdx();
    lcdFontPresetIdx = readLcdFontPresetIdx();
    tintIdx = readTintIdx();
    lcdDimmed = readDimEnabled();
    chromeDarkEnabled = readChromeDarkEnabled();
    logoStyleIdx = readLogoStyleIdx();
    everScrollMode = readEverScrollMode();
    eeqTinted = readEeqTinted();
    ledGlowEnabled = readLedGlowEnabled();
    knobGlowEnabled = readKnobGlowEnabled();
    attMode = readAttMode();
    bandPresetIdx = readBandPresetIdx();
    performanceModeIdx = readPerformanceModeIdx();
    logoGlowEnabled = readLogoGlowEnabled();
    oelDisplayEnabled = readOelDisplayEnabled();
    racingColorEnabled = readRacingColorEnabled();
    clipIdx = readClipIdx();
    refreshPvfdPerfEnabled();
    applyBrowseFontPreset(false);
    applyLcdFontPreset(false);
    applyPerformanceMode(false);
    applyTintMode(false);
    applyDimMode(false);
    applyChromeMode(false);
    applyLogoStyle(false);
    applyEverScrollMode(false);
    applyEeqTint(false);
    applyLedGlow(false);
    applyKnobGlow(false);
    applyAttMode(false);
    applyBandPreset(false, false);
    applyLogoGlowMode(false);
    applyOelDisplayMode(false);
    applyRacingColorMode(false);
    updateRouteState(true);
    reconcileLibrarySearchBoxes();
    reconcileLyricsSyncButtons();
    syncGlobalSearchFocus();
    onTrackChange();
    if (typeof Spicetify.Player.addEventListener === "function") {
      Spicetify.Player.addEventListener("songchange", onTrackChange);
      Spicetify.Player.addEventListener("onplaypause", () => {
        markPlayerStateDirty();
        const playing = safePlayerIsPlaying(false);
        const playBtn = chassis && chassis.querySelector("[data-pvfd='play']");
        if (playBtn) playBtn.textContent = playing ? PVFD_PAUSE_GLYPH : PVFD_PLAY_GLYPH;
      });
    } else {
      console.warn("[PVFD] Spicetify Player events unavailable; using polling-only sync.");
    }
    requestAnimationFrame(loop);

    const obs = new MutationObserver(queueMutationRecords);
    pvfdDiag.mutationObserversCreated++;
    obs.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("focusin", (e) => {
      const box = e.target && e.target.closest && e.target.closest(".x-filterBox-filterInputContainer");
      if (box) scheduleLibrarySearchReconcile(box, 0);
      scheduleGlobalSearchFocusSync(e.target, 0);
    }, true);

    document.addEventListener("focusout", (e) => {
      if (isGlobalSearchFocusTarget(e.target)) scheduleGlobalSearchFocusSync(document.activeElement, 0);
    }, true);

    installShortcutHoverBlock();
    installChassisPointerBubbleBlock();

    console.log("[PVFD] PioneerVFD online - Chromium live-audio PULSE + taller logo bars loaded.");
  }

  attach();
})();
