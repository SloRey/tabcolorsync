<h1><img src="extension/icons/icon-48.png" width="40" height="40"> Tab Color Sync</h1>

Dynamically recolors your Chromium based browser's toolbar and tab strip to
match the active tab's page color - the same idea as Firefox's
[Adaptive Tab Bar Colour](https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour),
brought to Chromium. Works on Brave, Chrome, and Edge. Windows only currently.

> [!WARNING]
> Do not use this on a company managed or IT administered device. This tool
> works by writing to the same Windows registry policy mechanism
> (`HKCU\SOFTWARE\Policies\...`) that enterprises use to manage Chromium
> based browsers. The exact path depends on which browser you target
> (Brave/Chrome/Edge). On a managed device this can conflict with your
> company's actual policies, may be flagged by security software as
> unauthorized policy tampering, and could violate your company's IT
> policies. This is intended for personal, unmanaged devices only, always check
> with your IT department before using it on anything work issued.

## Why this exists

Chromium has no extension API for live browser theming, nothing like
Firefox's `browser.theme.update()`. So a normal extension like
[Adaptive Tab Bar Colour](https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour)
was not possible. This project works around that gap by using Chromium's
`BrowserThemeColor` managed policy (normally an enterprise IT tool) plus a
live policy-refresh flag, driven by a small local service and a browser
extension. See [Limitations](#limitations) below.

## Requirements

- Windows
- Brave, Chrome, or Edge
- Python 3.8+ (only if running `color_service.py` directly)

## Installation

### 1. Load the extension

1. Go to `<your-browser>://extensions` (e.g. `brave://extensions`,
   `chrome://extensions`, or `edge://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, select the `extension/` folder

### 2. Run the color service

Two ways to do this:

- **Run the pre-built exe** (easiest, no Python needed) by downloading
  `color_service.exe` from this repo's Releases page and running it.
- **Run with Python**:
  ```
  cd service
  python color_service.py
  ```

This needs to be running in the background. Also see
[Auto start at login](#auto-start-at-login).
This needs to run as administrator, or have its registry permissions
granted manually, see [Troubleshooting](#troubleshooting) if you hit a
`PermissionError`.

### 3. Select your browser (required, one-time)

Click the extension icon. The popup has a **Browser** dropdown: pick
Brave, Chrome, or Edge. Nothing will apply until you do this.

## Building standalone .exe yourself

```
pip install pyinstaller
cd service
pyinstaller --onefile --noconsole --uac-admin --icon=color_service.ico --name color_service color_service.py
```

Find the build in `dist/color_service.exe`.

### Auto start at login

Because the exe requires elevation, it will show a UAC prompt every time
it launches. For elevated auto-start without a prompt each time, use Task
Scheduler instead:

1. Task Scheduler → **Create Task**
2. General tab → check **"Run with highest privileges"**
3. Triggers → **"At log on"**
4. Actions → start `color_service.exe`

## Troubleshooting

**Nothing happens / colors never apply**:
First check the extension popup, if it says "Browser not selected" in
red, pick your browser from the dropdown. If it's selected, confirm
`color_service.exe` (or the `.py`) is actually running. Check Task
Manager for `python.exe`/`pythonw.exe`/`color_service.exe`. Check the
extension's service worker console (`<your-browser>://extensions` → this
extension → "service worker") for connection errors.

**`PermissionError: [WinError 5] Access is denied` in the service terminal**:
The `HKCU\SOFTWARE\Policies` registry key sometimes has restrictive
permissions even under your own user account. Open `regedit.exe`, navigate
to `HKEY_CURRENT_USER\SOFTWARE\Policies`, right-click → Permissions → grant
your account Full Control (tick "Replace all child object permission
entries" under Advanced). Or run as administrator.

**Browser says "Your browser is managed by your organization" and blocks
manual theme changes**:
This is a side effect of the registry key. Toggling the extension off via its pop up
should clean this up automatically (it deletes the whole policy key, not
just the color value). If it lingers, remove it manually, choose the one
for your browser:
```powershell
Remove-Item "HKCU:\SOFTWARE\Policies\BraveSoftware\Brave" -Recurse -Force   # Brave
Remove-Item "HKCU:\SOFTWARE\Policies\Google\Chrome" -Recurse -Force         # Chrome
Remove-Item "HKCU:\SOFTWARE\Policies\Microsoft\Edge" -Recurse -Force        # Edge
```

## Uninstall

1. Toggle the extension off in the extension's popup - this reverts the theme back to
   default by resetting the managed policy.
2. Remove the extension from your browser.
3. Delete all downloaded files (the `extension/` and `service/` folders,
   and `color_service.exe` if you used the packaged version).
4. If you set up auto start, remove the task from Task Scheduler.

If any theme color remains, or your browser still says "Your browser is
managed by your organization," see the commandline fix in
[Troubleshooting](#troubleshooting).

## Limitations

- **Windows only.** Registry edits are native to Windows; adapting to
  macOS/Linux would need a different approach.
- **Colors are different compared to Firefox's ATBC.** Every color the
  toolbar can use is clamped regardless of the input color. This is by
  design in Chromium's Material You theming, not a bug. Chromium's Material
  You creates a two tone theme. The tool can only pass a color via the
  registry edits, but Chromium's Material You takes over.
- **Requires a locally running service.** Unlike a self-contained browser
  extension, this needs `color_service.exe` (or `.py`) running in the
  background at all times. The extension itself can not edit Window's registry.
- **Some pages may extract the wrong color.** Sites with translucent
  overlays, heavy scripts, videos, or color changes can occasionally throw
  off detection. Use the per-site adjustment sliders in the popup as a
  manual override.

## Acknowledgments

This project is a recreation of Adaptive Tab Bar Color by easonwong-de at
https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour for Chromium. A few
specific techniques were adapted from Adaptive Tab Bar Color, specifically
the element-sampling strategy, brightness adjustment algorithm and
event-driven listeners.

Since Chromium has no API equivalent to Firefox's `browser.theme.update()`,
this project's core mechanism uses Chromium's `BrowserThemeColor` managed
policy plus `--refresh-platform-policy` to update the theme color live, no
restart needed. This idea comes from an excellent write up by Januschka at
https://www.januschka.com/chromium-omarchy.html. Without this writeup, this
project would not have been possible.

While no code was copied verbatim, both were essential to how this project
turned out.
