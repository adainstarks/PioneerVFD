$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$themeSource = Join-Path $repoRoot "Themes\PioneerVFD"
$extensionSource = Join-Path $repoRoot "Extensions\pioneerVFD.js"
$spiceRoot = Join-Path $env:APPDATA "spicetify"
$themeDestRoot = Join-Path $spiceRoot "Themes"
$extensionDestRoot = Join-Path $spiceRoot "Extensions"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Error "Spicetify was not found in PATH. Install Spicetify first, then run this script again."
}

if (-not (Test-Path $themeSource)) {
    Write-Error "Missing theme folder: $themeSource"
}

if (-not (Test-Path $extensionSource)) {
    Write-Error "Missing extension file: $extensionSource"
}

New-Item -ItemType Directory -Force -Path $themeDestRoot, $extensionDestRoot | Out-Null

Copy-Item -Recurse -Force $themeSource $themeDestRoot
Copy-Item -Force $extensionSource $extensionDestRoot

if (-not (Test-Path (Join-Path $extensionDestRoot "pioneerVFD.js"))) {
    Write-Error "Extension copy failed: $(Join-Path $extensionDestRoot "pioneerVFD.js")"
}

if (-not (Test-Path (Join-Path $themeDestRoot "PioneerVFD\user.css"))) {
    Write-Error "Theme copy failed: $(Join-Path $themeDestRoot "PioneerVFD\user.css")"
}

try {
    spicetify backup | Out-Null
} catch {
    Write-Warning "spicetify backup did not complete; continuing with apply."
}

spicetify config current_theme PioneerVFD color_scheme "PioneerVFD" inject_css 1 inject_theme_js 1 replace_colors 1 overwrite_assets 1 expose_apis 1
spicetify config extensions pioneerVFD.js
spicetify apply

$configuredExtensions = spicetify config extensions 2>$null
if ($configuredExtensions -notmatch "pioneerVFD\.js") {
    Write-Warning "pioneerVFD.js was not reported in Spicetify extensions config."
}

Write-Host "PioneerVFD installed and applied."
