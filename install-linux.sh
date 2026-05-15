#!/usr/bin/env sh
set -eu

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

command -v spicetify >/dev/null 2>&1 || die "Spicetify was not found in PATH. Install Spicetify first, then run this script again."

unset CDPATH
repo_root=$(cd "$(dirname "$0")" && pwd)
theme_source="$repo_root/Themes/PioneerVFD"
extension_source="$repo_root/Extensions/pioneerVFD.js"

[ -d "$theme_source" ] || die "Missing theme folder: $theme_source"
[ -f "$extension_source" ] || die "Missing extension file: $extension_source"

config_path=$(spicetify -c 2>/dev/null | tail -n 1 | tr -d '\r')
if [ -n "$config_path" ]; then
  spice_root=$(dirname "$config_path")
else
  spice_root="$HOME/.config/spicetify"
fi

theme_dest="$spice_root/Themes/PioneerVFD"
extension_dest_root="$spice_root/Extensions"
extension_dest="$extension_dest_root/pioneerVFD.js"

printf '%s\n' "Using Spicetify config root: $spice_root"

mkdir -p "$theme_dest" "$extension_dest_root"
cp "$theme_source/user.css" "$theme_dest/user.css"
cp "$theme_source/color.ini" "$theme_dest/color.ini"
cp "$extension_source" "$extension_dest"

[ -f "$extension_dest" ] || die "Extension copy failed: $extension_dest"
[ -f "$theme_dest/user.css" ] || die "Theme copy failed: $theme_dest/user.css"

if [ ! -d "$theme_dest/fonts" ]; then
  printf '%s\n' "Warning: fonts folder not found in installed theme. This patch zip does not include font files; install the full repo first if the logo font looks wrong." >&2
fi

spicetify backup >/dev/null 2>&1 || printf '%s\n' "Warning: spicetify backup did not complete; continuing with apply." >&2

spicetify config \
  current_theme PioneerVFD \
  color_scheme "PioneerVFD" \
  inject_css 1 \
  inject_theme_js 1 \
  replace_colors 1 \
  overwrite_assets 1 \
  expose_apis 1

# Preserve any existing Spicetify extensions the user already had enabled
# (Bookmark, Beautiful Lyrics, adblock, etc.). Spicetify's extensions config
# is pipe-separated. Only add pioneerVFD.js if not already present.
existing_extensions=$(spicetify config extensions 2>/dev/null | tr -d '\n' || true)
if [ -z "$existing_extensions" ]; then
  spicetify config extensions pioneerVFD.js
else
  case "|$existing_extensions|" in
    *"|pioneerVFD.js|"*) : ;;
    *) spicetify config extensions "$existing_extensions|pioneerVFD.js" ;;
  esac
fi

spicetify apply

configured_extensions=$(spicetify config extensions 2>/dev/null || true)
case "$configured_extensions" in
  *pioneerVFD.js*) ;;
  *) printf '%s\n' "Warning: pioneerVFD.js was not reported in Spicetify extensions config." >&2 ;;
esac

printf '%s\n' "PioneerVFD installed and applied with Chromium-only PULSE and the WebM-only OEL clip set."
