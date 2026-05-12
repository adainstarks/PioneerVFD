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
theme_assets_source="$theme_source/assets"
extension_source="$repo_root/Extensions/pioneerVFD.js"
oel_webm_source_map_placeholder="__PVFD_OEL_WEBM_SOURCE_MAP_JSON__"
oel_webm_assets="
movie5_longloop.webm
movie1_longloop.webm
movie6_longloop.webm
movie10_f_longloop.webm
diverdolphins_longloop.webm
6_Racing_Cart_longloop.webm
"

[ -d "$theme_source" ] || die "Missing theme folder: $theme_source"
[ -f "$extension_source" ] || die "Missing extension file: $extension_source"
[ -d "$theme_assets_source" ] || die "Missing theme assets folder: $theme_assets_source"

for asset_name in $oel_webm_assets; do
  [ -f "$theme_assets_source/$asset_name" ] || die "Missing long-loop OEL WebM asset: $theme_assets_source/$asset_name"
done

json_tmp=$(mktemp "${TMPDIR:-/tmp}/pvfd-oel-map.XXXXXX") || die "Could not create temporary OEL source map."
extension_tmp=$(mktemp "${TMPDIR:-/tmp}/pvfd-extension.XXXXXX") || die "Could not create temporary extension build."
cleanup() {
  rm -f "$json_tmp" "$extension_tmp"
}
trap cleanup EXIT HUP INT TERM

build_oel_webm_source_map() {
  first_asset=1
  printf '{' > "$json_tmp"
  for asset_name in $oel_webm_assets; do
    if [ "$first_asset" -eq 1 ]; then
      first_asset=0
    else
      printf ',' >> "$json_tmp"
    fi
    {
      printf '"%s":"data:video/webm;base64,' "$asset_name"
      base64 < "$theme_assets_source/$asset_name" | tr -d '\n\r'
      printf '"'
    } >> "$json_tmp"
  done
  printf '}' >> "$json_tmp"
}

build_extension_with_webm_sources() {
  injected=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '  const OEL_WEBM_SOURCE_MAP = "__PVFD_OEL_WEBM_SOURCE_MAP_JSON__";')
        printf '  const OEL_WEBM_SOURCE_MAP = ' >> "$extension_tmp"
        cat "$json_tmp" >> "$extension_tmp"
        printf ';\n' >> "$extension_tmp"
        injected=1
        ;;
      *)
        printf '%s\n' "$line" >> "$extension_tmp"
        ;;
    esac
  done < "$extension_source"

  [ "$injected" -eq 1 ] || die "Failed to inject OEL WebM source map into pioneerVFD.js"
}

config_path=$(spicetify -c 2>/dev/null | tail -n 1 | tr -d '\r')
if [ -n "$config_path" ]; then
  spice_root=$(dirname "$config_path")
else
  spice_root="$HOME/.config/spicetify"
fi

theme_dest="$spice_root/Themes/PioneerVFD"
theme_assets_dest="$theme_dest/assets"
extension_dest_root="$spice_root/Extensions"
extension_dest="$extension_dest_root/pioneerVFD.js"

printf '%s\n' "Using Spicetify config root: $spice_root"

mkdir -p "$theme_dest" "$extension_dest_root"
cp "$theme_source/user.css" "$theme_dest/user.css"
cp "$theme_source/color.ini" "$theme_dest/color.ini"
mkdir -p "$theme_assets_dest"
cp -R "$theme_assets_source/." "$theme_assets_dest/"

build_oel_webm_source_map
build_extension_with_webm_sources
cp "$extension_tmp" "$extension_dest"

[ -f "$extension_dest" ] || die "Extension build failed: $extension_dest"
[ -f "$theme_dest/user.css" ] || die "Theme copy failed: $theme_dest/user.css"
grep -q 'data:video/webm;base64,' "$extension_dest" || die "Installed extension is missing the injected OEL WebM data URLs."
if grep -q "$oel_webm_source_map_placeholder" "$extension_dest"; then
  die "Installed extension still contains the OEL WebM source-map placeholder."
fi

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
spicetify config extensions pioneerVFD.js
spicetify apply

configured_extensions=$(spicetify config extensions 2>/dev/null || true)
case "$configured_extensions" in
  *pioneerVFD.js*) ;;
  *) printf '%s\n' "Warning: pioneerVFD.js was not reported in Spicetify extensions config." >&2 ;;
esac

printf '%s\n' "PioneerVFD installed and applied with Chromium-only PULSE and the WebM-only OEL clip set."
