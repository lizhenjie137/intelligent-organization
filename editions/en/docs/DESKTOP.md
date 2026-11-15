# Windows desktop and source editions

**Delivery status:** the Windows x64 installer and source are provided, and installation has been verified. Downloads are available from the [v0.1.0 release](https://github.com/lizhenjie137/intelligent-organization/releases/tag/v0.1.0). This guide describes the Electron shell and standalone backend packaging.

## Choose how to run

| Mode | Intended use | Requirements |
| --- | --- | --- |
| Windows x64 desktop installer | Members and administrators using Xiaolajiao | Run the installer; Python, Node.js and npm do not need to be installed separately |
| Web application from source | Inspecting or editing Python and frontend code | Python 3.11+, PowerShell and network access for the initial dependency installation |
| Build a desktop installer from source | Developing the shell or repackaging the application | Python 3.11+, Node.js 22.12+ with npm, PowerShell and network access |

Both modes use the same workspace and permission workflows. The desktop edition places the web workspace in an application window and includes its backend runtime. It does not add access from other computers, cloud identities or remote-team deployment.

## Install and launch

The English installer filename is `Xiaolajiao-en-0.1.0-Windows-x64-Setup.exe`. Run the final supplied installer, follow the installation wizard, and open Xiaolajiao from the Start menu or desktop shortcut.

The app starts its own local backend and automatically chooses a loopback port. There is no need to launch a PowerShell service or use the source edition's fixed port. Register on first launch: the first local account is the workspace administrator and subsequent accounts are members.

Quitting the desktop app stops the backend it started. It does not take over or close another source workspace's service. Submit any form contents you need to preserve before closing; saved accounts and tasks remain available on the next launch.

## Data location and separation

The English desktop edition's default workspace directory is:

```text
%LOCALAPPDATA%\Xiaolajiao\en\workspace
```

Sibling `profile` and `logs` directories hold the app's browser profile and desktop logs. The Chinese desktop edition uses the `zh` directory. The source edition uses `data/workspace/` inside its own folder.

**The Chinese desktop app, English desktop app, source edition and any existing workspace are separate. They do not automatically copy accounts, passwords, model settings, attachments or tasks.** Seeing registration on the first desktop launch is expected for a new workspace; it does not mean that existing accounts were deleted. There is no automatic migration wizard.

After quitting the app, back up the complete workspace directory so attachments are kept alongside databases. Model keys use Windows protection and may need to be entered again after moving to another computer or system account. The installer is configured not to delete user data automatically on uninstall; keep an independent backup before upgrading, uninstalling or manually cleaning directories.

## Build from source

Run from the source package root:

```powershell
.\Build-Desktop.ps1
```

The script performs these steps:

1. Creates `build/.venv` and installs the locked runtime and PyInstaller dependencies.
2. Runs `npm ci --ignore-scripts` using the official npm registry.
3. Downloads and verifies the pinned runtime from the official Electron release source.
4. Packages the backend through `scripts/build_backend.py`.
5. Builds a Windows x64 NSIS installer through electron-builder with `--publish never`; nothing is uploaded.

Expected output is in `dist/`. Use this option only after dependencies and the build environment are already prepared:

```powershell
.\Build-Desktop.ps1 -SkipDependencyInstall
```

Pins are recorded in `package-lock.json`, `desktop/requirements-build.txt` and `deepseek-harness-base/requirements.lock.txt`. The shell currently uses Electron 45.3.2 and electron-builder 26.18.0. The build does not copy existing business data into the installer.

## Development and troubleshooting

After packaging the backend and installing desktop dependencies, use `npm run desktop:dev` in the source directory. The desktop window still uses its own desktop data directory; it is not a migration tool for a source web workspace.

For startup failures, inspect `%LOCALAPPDATA%\Xiaolajiao\en\logs\desktop.log`. Logs can include local error context; review paths and sensitive information before sharing a report. The app does not automatically switch to an existing source server.

See the [README](../README.md) for developer checks. Update, migration and signing status are governed by the actual release notes; automatic updates are not promised. Use, modification and distribution remain subject to [LICENSE](../LICENSE) and [LICENSING.md](../LICENSING.md).
