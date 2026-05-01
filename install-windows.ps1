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

spicetify config current_theme PioneerVFD color_scheme "Pioneer DEH-P7600MP"
spicetify config extensions pioneerVFD.js
spicetify apply

Write-Host "PioneerVFD testbuild v2.0-r1-oel-pixelgrid-sidebox-clearance-personal installed and applied."
