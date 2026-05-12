$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$themeSource = Join-Path $repoRoot "Themes\PioneerVFD"
$themeAssetsSource = Join-Path $themeSource "assets"
$extensionSource = Join-Path $repoRoot "Extensions\pioneerVFD.js"
$spiceRoot = Join-Path $env:APPDATA "spicetify"
$themeDest = Join-Path $spiceRoot "Themes\PioneerVFD"
$themeAssetsDest = Join-Path $themeDest "assets"
$extensionDestRoot = Join-Path $spiceRoot "Extensions"
$extensionDest = Join-Path $extensionDestRoot "pioneerVFD.js"
$oelWebmSourceMapPlaceholder = "__PVFD_OEL_WEBM_SOURCE_MAP_JSON__"
$oelWebmAssets = @(
    "movie5_longloop.webm",
    "movie1_longloop.webm",
    "movie6_longloop.webm",
    "movie10_f_longloop.webm",
    "diverdolphins_longloop.webm",
    "6_Racing_Cart_longloop.webm"
)

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Error "Spicetify was not found in PATH. Install Spicetify first, then run this script again."
}

if (-not (Test-Path $themeSource)) {
    Write-Error "Missing theme folder: $themeSource"
}

if (-not (Test-Path $extensionSource)) {
    Write-Error "Missing extension file: $extensionSource"
}

foreach ($assetName in $oelWebmAssets) {
    $assetPath = Join-Path $themeAssetsSource $assetName
    if (-not (Test-Path $assetPath)) {
        Write-Error "Missing long-loop OEL WebM asset: $assetPath"
    }
}

New-Item -ItemType Directory -Force -Path $themeDest, $extensionDestRoot | Out-Null

Copy-Item -Force (Join-Path $themeSource "user.css") $themeDest
Copy-Item -Force (Join-Path $themeSource "color.ini") $themeDest
if (Test-Path $themeAssetsSource) {
    New-Item -ItemType Directory -Force -Path $themeAssetsDest | Out-Null
    Copy-Item -Recurse -Force (Join-Path $themeAssetsSource "*") $themeAssetsDest
}

$extensionTemplate = Get-Content -Raw -Path $extensionSource
$oelWebmSourceMap = [ordered]@{}
foreach ($assetName in $oelWebmAssets) {
    $assetPath = Join-Path $themeAssetsSource $assetName
    $oelWebmSourceMap[$assetName] = "data:video/webm;base64,$([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($assetPath)))"
}
$oelWebmSourceMapJson = $oelWebmSourceMap | ConvertTo-Json -Compress
$placeholderAssignment = "const OEL_WEBM_SOURCE_MAP = `"$oelWebmSourceMapPlaceholder`";"
$replacementAssignment = "const OEL_WEBM_SOURCE_MAP = $oelWebmSourceMapJson;"
$extensionBuilt = $extensionTemplate.Replace($placeholderAssignment, $replacementAssignment)
if ($extensionBuilt -eq $extensionTemplate) {
    Write-Error "Failed to inject OEL WebM source map into pioneerVFD.js"
}
[System.IO.File]::WriteAllText($extensionDest, $extensionBuilt, (New-Object System.Text.UTF8Encoding($false)))

$installedExtensionText = [System.IO.File]::ReadAllText($extensionDest)
if (-not $installedExtensionText.Contains("data:video/webm;base64,")) {
    Write-Error "Installed extension is missing the injected OEL WebM data URLs."
}
if ($installedExtensionText.Contains($oelWebmSourceMapPlaceholder)) {
    Write-Error "Installed extension still contains the OEL WebM source-map placeholder."
}

if (-not (Test-Path $extensionDest)) {
    Write-Error "Extension build failed: $extensionDest"
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
spicetify config extensions pioneerVFD.js
spicetify apply

$configuredExtensions = spicetify config extensions 2>$null
if ($configuredExtensions -notmatch "pioneerVFD\.js") {
    Write-Warning "pioneerVFD.js was not reported in Spicetify extensions config."
}


Write-Host "PioneerVFD installed and applied with Chromium-only PULSE and the WebM-only OEL clip set."
