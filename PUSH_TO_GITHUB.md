# Push PioneerVFD to GitHub

This repo is ready to push as **PioneerVFD v0.3.2**.

## 1. Create the GitHub repo

On GitHub, create a new empty repository named:

```text
PioneerVFD
```

Do **not** initialize it with a README, `.gitignore`, or license if you are using the commands below, because this folder already includes those starter files.

## 2. Open a terminal in this folder

You should be in the folder that contains:

```text
Extensions/
Themes/
README.md
.gitignore
.gitattributes
install-windows.ps1
```

## 3. Initial commit

```bash
git init
git branch -M main
git add .
git commit -m "Initial release v0.3.2"
```

## 4. Connect to GitHub

Replace `YOUR_USERNAME` with your GitHub username:

```bash
git remote add origin https://github.com/YOUR_USERNAME/PioneerVFD.git
git push -u origin main
```

## 5. Tag the release

```bash
git tag -a v0.3.2 -m "PioneerVFD v0.3.2"
git push origin v0.3.2
```

## 6. Suggested GitHub repo description

```text
Spicetify theme + extension that turns Spotify into a 2000s Pioneer VFD/LCD stereo interface.
```

## 7. Suggested release notes

```markdown
## PioneerVFD v0.3.2

- Removed old ART mode path.
- Kept packed LCD clips active instead of fragile embedded MP4 playback.
- Preserved DOLPHIN as a full-panel LCD clip.
- Changed RACING to render in a tighter contained viewport instead of stretching.
- Added subtle VFD side rails/glow so contained video mode looks intentional.
- Cleaned GitHub package structure and install instructions.
```

## 8. After future changes

```bash
git status
git add .
git commit -m "Describe the change clearly"
git push
```
