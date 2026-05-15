$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$themeSource = Join-Path $repoRoot "Themes\PioneerVFD"
$extensionSource = Join-Path $repoRoot "Extensions\pioneerVFD.js"
$spiceRoot = Join-Path $env:APPDATA "spicetify"
$themeDest = Join-Path $spiceRoot "Themes\PioneerVFD"
$extensionDestRoot = Join-Path $spiceRoot "Extensions"
$extensionDest = Join-Path $extensionDestRoot "pioneerVFD.js"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Error "Spicetify was not found in PATH. Install Spicetify first, then run this script again."
}

if (-not (Test-Path $themeSource)) {
    Write-Error "Missing theme folder: $themeSource"
}

if (-not (Test-Path $extensionSource)) {
    Write-Error "Missing extension file: $extensionSource"
}

New-Item -ItemType Directory -Force -Path $themeDest, $extensionDestRoot | Out-Null

Copy-Item -Force (Join-Path $themeSource "user.css") $themeDest
Copy-Item -Force (Join-Path $themeSource "color.ini") $themeDest

Copy-Item -Force $extensionSource $extensionDest

if (-not (Test-Path $extensionDest)) {
    Write-Error "Extension copy failed: $extensionDest"
}

if (-not (Test-Path (Join-Path $themeDest "user.css"))) {
    Write-Error "Theme copy failed: $(Join-Path $themeDest "user.css")"
}

if (-not (Test-Path (Join-Path $themeDest "fonts"))) {
    Write-Warning "Fonts folder not found in installed theme. This patch zip does not include font files; install the full repo first if the logo font looks wrong."
}

try {
    spicetify backup | Out-Null
} catch {
    Write-Warning "spicetify backup did not complete; continuing with apply."
}

spicetify config current_theme PioneerVFD color_scheme "PioneerVFD" inject_css 1 inject_theme_js 1 replace_colors 1 overwrite_assets 1 expose_apis 1

# Preserve any existing Spicetify extensions the user already had enabled
# (Bookmark, Beautiful Lyrics, adblock, etc.). Spicetify's extensions config
# is pipe-separated. We only add pioneerVFD.js if it's not already present.
$existingExtensions = (spicetify config extensions 2>$null | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($existingExtensions)) {
    spicetify config extensions pioneerVFD.js
} elseif ($existingExtensions -notmatch "(^|\|)pioneerVFD\.js(\||$)") {
    spicetify config extensions "$existingExtensions|pioneerVFD.js"
}

spicetify apply

$configuredExtensions = spicetify config extensions 2>$null
if ($configuredExtensions -notmatch "pioneerVFD\.js") {
    Write-Warning "pioneerVFD.js was not reported in Spicetify extensions config."
}


Write-Host "PioneerVFD installed and applied with Chromium-only PULSE and the WebM-only OEL clip set."
