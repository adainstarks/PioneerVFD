#!/usr/bin/env sh
set -eu

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

command -v spicetify >/dev/null 2>&1 || die "Spicetify was not found in PATH. Install Spicetify first, then run this script again."

repo_root=$(CDPATH= cd "$(dirname "$0")" && pwd)
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

theme_dest_root="$spice_root/Themes"
extension_dest_root="$spice_root/Extensions"

printf '%s\n' "Using Spicetify config root: $spice_root"

mkdir -p "$theme_dest_root" "$extension_dest_root"
rm -rf "$theme_dest_root/PioneerVFD"
cp -R "$theme_source" "$theme_dest_root/"
cp "$extension_source" "$extension_dest_root/pioneerVFD.js"

[ -f "$extension_dest_root/pioneerVFD.js" ] || die "Extension copy failed: $extension_dest_root/pioneerVFD.js"
[ -f "$theme_dest_root/PioneerVFD/user.css" ] || die "Theme copy failed: $theme_dest_root/PioneerVFD/user.css"

spicetify backup >/dev/null 2>&1 || printf '%s\n' "Warning: spicetify backup did not complete; continuing with apply."

spicetify config \
  current_theme PioneerVFD \
  color_scheme "Pioneer DEH-P7600MP" \
  inject_css 1 \
  inject_theme_js 1 \
  replace_colors 1 \
  overwrite_assets 1 \
  expose_apis 1
spicetify config extensions pioneerVFD.js

if [ "${PVFD_ENABLE_DEVTOOLS:-1}" != "0" ]; then
  if spicetify enable-devtools >/dev/null 2>&1; then
    printf '%s\n' "Enabled Spotify DevTools for Spicetify on macOS."
  elif spicetify config always_enable_devtools 1 >/dev/null 2>&1; then
    printf '%s\n' "Enabled always_enable_devtools for Spicetify on macOS."
  else
    printf '%s\n' "Warning: could not enable DevTools automatically; continuing."
  fi
fi

spicetify apply

configured_extensions=$(spicetify config extensions 2>/dev/null || true)
case "$configured_extensions" in
  *pioneerVFD.js*) ;;
  *) printf '%s\n' "Warning: pioneerVFD.js was not reported in Spicetify extensions config." ;;
esac

printf '%s\n' "PioneerVFD installed and applied."
