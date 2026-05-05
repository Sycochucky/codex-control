# Codex Control

Codex Control is a local-first Android command center for Codex. It pairs an installable React Native phone app with a FastAPI desktop bridge so you can browse threads, continue work, run safe Git actions, and inspect local setup from your phone.

The app is designed for your own machine, home network, USB debugging, or VPN. Do not expose the desktop server directly to the public internet.

## Features

- Browse active and archived Codex App Server threads.
- Continue threads and send follow-up input from Android.
- View thread metadata, workspace, Git branch, commit, and token usage when available.
- Run workspace-aware Git actions through the desktop bridge.
- Create local/GitHub repository setup plans with public/private repo choices and `.gitignore` templates.
- Inspect Codex, Git, GitHub CLI, model, account, plugin, skill, and rate-limit status.
- Use a local desktop bridge instead of placing Codex credentials on the phone.

## Project Layout

- `phone-app/` - Expo Router / React Native Android app.
- `desktop-server/` - FastAPI bridge for auth, setup checks, GitHub login, and App Server WebSocket proxying.
- `scripts/` - repo-level setup and verification helpers.
- `docs/` - design notes and implementation plans.

Generated Android projects, APKs, local databases, runtime logs, `node_modules`, and the older prototype `mobile-app/` are intentionally ignored.

## Requirements

- Windows PowerShell.
- Node.js 20+ and npm.
- Python 3.11+.
- Git.
- GitHub CLI (`gh`) for GitHub setup actions.
- Codex CLI installed and authenticated.
- Android Studio / Android SDK for local Android builds, or EAS for cloud builds.

## Quick Start

Install desktop and phone dependencies:

```powershell
.\scripts\setup-dev.ps1
```

Start the desktop bridge:

```powershell
cd desktop-server
.\start-real-codex-server.ps1 -Port 8010 -SharedToken "codex-dev"
```

The desktop server listens on `http://0.0.0.0:8010`. Port `8010` is the default to avoid common Docker use of port `8000`.

For a USB-attached Android device, forward the backend port:

```powershell
cd phone-app
.\scripts\configure-android-local.ps1 -BackendPort 8010
```

Install and run the Android app:

```powershell
cd phone-app
npm run android:local
```

Open the app and connect with:

- Backend URL: `http://127.0.0.1:8010` when using ADB reverse.
- Shared token: `codex-dev` unless you changed it.

For LAN or VPN access, use `http://<desktop-lan-ip>:8010` and make sure your firewall allows the desktop server port.

## Useful Commands

Run all repo checks:

```powershell
.\scripts\verify.ps1
```

Run phone checks only:

```powershell
cd phone-app
npm run typecheck
npm run test:logic
```

Run desktop tests only:

```powershell
cd desktop-server
py -3 -m unittest discover -s tests
```

Build a local release APK:

```powershell
cd phone-app\android
.\gradlew.bat app:assembleRelease --configure-on-demand --build-cache "-PreactNativeArchitectures=arm64-v8a,armeabi-v7a"
```

The release APK is generated at:

```text
phone-app/android/app/build/outputs/apk/release/app-release.apk
```

## Configuration

The desktop server uses environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_PROVIDER` | `mock-codex` | Use `real-codex` to call the local Codex CLI. |
| `CODEX_CONTROL_SHARED_TOKEN` | `codex-dev` | Shared login token used by the phone app. |
| `CODEX_WORKSPACE_ROOT` | repo parent | Workspace root allowed to the bridge. |
| `CODEX_CLI_SANDBOX` | `workspace-write` | Sandbox mode passed to Codex CLI work. |
| `CODEX_CLI_EPHEMERAL` | `true` | Whether Codex CLI sessions are ephemeral. |
| `CODEX_MODEL` | `gpt-5.4` | Default model for new Codex work. |

For local development, you can also set phone build defaults:

```powershell
$env:EXPO_PUBLIC_CODEX_BACKEND_PORT = "8010"
$env:EXPO_PUBLIC_CODEX_BACKEND_URL = "http://127.0.0.1:8010"
```

The explicit backend URL wins over the port default.

## Control Panel

The desktop server includes a small local control panel:

```powershell
cd desktop-server
.\start-control-panel-gui.ps1
```

It can start/stop the backend, run phone app checks, and manage local build jobs. It is a local operator tool, not a hosted service.

## Security Notes

- Change `CODEX_CONTROL_SHARED_TOKEN` before using this beyond your own test machine.
- Keep the server on a trusted LAN, VPN, or USB reverse path.
- Do not commit `.env`, runtime logs, local databases, APKs, or generated Android build output.
- Review the desktop bridge before enabling broader filesystem or network access.

## Current Status

This is an early public release. Android local install, desktop bridge startup, thread browsing, App Server WebSocket proxying, Git surfaces, setup checks, and logic tests are working in the current development environment.
