param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubUsername,

    [string]$RepoName = "PioneerVFD",
    [string]$Version = "v0.3.2"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Git was not found. Install Git for Windows first, then reopen PowerShell."
}

$repoUrl = "https://github.com/$GitHubUsername/$RepoName.git"

if (-not (Test-Path ".git")) {
    git init
}

git branch -M main
git add .

$hasChanges = git status --porcelain
if ($hasChanges) {
    git commit -m "Initial release $Version"
} else {
    Write-Host "No file changes to commit. Continuing..."
}

$existingOrigin = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingOrigin)) {
    git remote add origin $repoUrl
} else {
    git remote set-url origin $repoUrl
}

git push -u origin main

$existingTag = git tag --list $Version
if (-not $existingTag) {
    git tag -a $Version -m "PioneerVFD $Version"
}

git push origin $Version

Write-Host "Done. Repo pushed to $repoUrl"
