# Push PioneerVFD to GitHub on Windows

This is the Windows PowerShell version. No Linux commands needed.

## 1. Install Git for Windows

Install **Git for Windows** if you do not already have it.

After installation, open **PowerShell** and check:

```powershell
git --version
```

If that prints a version, Git is ready.

## 2. Create an empty GitHub repo

On GitHub, create a new repository named:

```text
PioneerVFD
```

Do **not** add a README, `.gitignore`, or license on GitHub. This folder already includes those.

## 3. Extract the ZIP

Extract the project ZIP somewhere normal, for example:

```text
C:\Users\YOURNAME\Desktop\PioneerVFD-github-ready
```

The folder should contain:

```text
Extensions\
Themes\
README.md
.gitignore
.gitattributes
install-windows.ps1
PUSH_TO_GITHUB.md
PUSH_TO_GITHUB_WINDOWS.md
```

## 4. Open PowerShell inside the folder

In File Explorer, open the extracted folder.

Then click the address bar, type:

```text
powershell
```

and press Enter.

PowerShell should open already inside the project folder.

## 5. Push with normal PowerShell commands

Replace `YOUR_USERNAME` with your GitHub username:

```powershell
git init
git branch -M main
git add .
git commit -m "Initial release v0.3.2"
git remote add origin https://github.com/YOUR_USERNAME/PioneerVFD.git
git push -u origin main
```

GitHub may ask you to sign in. That is normal.

## 6. Create the version tag

```powershell
git tag -a v0.3.2 -m "PioneerVFD v0.3.2"
git push origin v0.3.2
```

## 7. Future updates

After editing files later:

```powershell
git status
git add .
git commit -m "Describe the change clearly"
git push
```

## Optional: run the included push helper script

You can also run:

```powershell
.\push-to-github-windows.ps1 -GitHubUsername YOUR_USERNAME
```

If PowerShell blocks scripts, run this once inside the same folder:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then run the script again.
