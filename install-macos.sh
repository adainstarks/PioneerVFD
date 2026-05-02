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

mkdir -p "$theme_dest_root" "$extension_dest_root"
rm -rf "$theme_dest_root/PioneerVFD"
cp -R "$theme_source" "$theme_dest_root/"
cp "$extension_source" "$extension_dest_root/pioneerVFD.js"

spicetify config current_theme PioneerVFD color_scheme "Pioneer DEH-P7600MP"
spicetify config extensions pioneerVFD.js
spicetify apply

printf '%s\n' "PioneerVFD installed and applied."
