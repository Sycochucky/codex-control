# Codex Android Remote Control

Codex Android Remote Control is a local-first Expo / React Native Android client for the official Codex App Server. The normal runtime path is:

```text
phone-app -> official Codex remote-control/App Server -> Codex
```

The app is designed for your own machine, home network, USB debugging, VPN, or a short-lived development tunnel. Do not expose an unauthenticated Codex App Server endpoint to the public internet.

## Features

- Browse active and archived Codex App Server threads grouped by project, with the most recently updated projects and threads first.
- Continue threads and send follow-up input from Android.
- View thread metadata, workspace, Git branch, commit, status, and token usage when available.
- Run workspace-aware Git actions through the official App Server JSON-RPC surface.
- Inspect Codex models, accounts, config, loaded threads, and command output through App Server calls.
- Start a quick development tunnel for temporary out-of-house phone testing against the official endpoint.
- Show clearer connection, waiting, refresh, rate-limit, quota, and context-window status messages.

## Project Layout

- `phone-app/` - active Expo Router / React Native Android remote-control app.
- `desktop-server/` - legacy FastAPI bridge kept for compatibility while the direct App Server path is tested; it is not part of the normal Android runtime path.
- `scripts/` - repo-level setup and verification helpers.
- `docs/` - design notes and implementation plans.

Generated Android projects, APKs, local databases, runtime logs, `node_modules`, and the older prototype `mobile-app/` are intentionally ignored.

## Requirements

- Windows PowerShell.
- Node.js 20+ and npm.
- Git.
- GitHub CLI (`gh`) for GitHub actions surfaced by the App Server.
- Codex CLI installed and authenticated. This repo is currently aligned with `codex-cli 0.146.0`.
- Android Studio / Android SDK for local Android builds, or EAS for cloud builds.

## Quick Start

Install dependencies:

```powershell
.\scripts\setup-dev.ps1
```

Start the official Codex remote-control endpoint:

```powershell
codex remote-control start
```

For local development you can also start an explicit websocket listener:

```powershell
codex app-server --listen ws://127.0.0.1:8765 --ws-auth capability-token
```

For a USB-attached Android device, forward the App Server port:

```powershell
cd phone-app
.\scripts\configure-android-local.ps1 -RemotePort 8765
```

Install and run the Android app:

```powershell
cd phone-app
npm run android:local
```

Open the app and connect with:

- Codex App Server URL: `ws://127.0.0.1:8765` when using ADB reverse. The app automatically targets the official `/ws` websocket path.
- Bearer Token: optional; use the official websocket auth token when your listener requires one.

For LAN or VPN access, use `ws://<desktop-lan-ip>:8765` or a secure `wss://` endpoint and make sure your firewall allows only trusted devices.

### Quick Tunnel Testing

For temporary out-of-house development testing, start a tunnel to the official App Server endpoint:

```powershell
cd phone-app
.\scripts\quick-tunnel.ps1 -Start
```

The helper defaults to `cloudflared` and targets `http://127.0.0.1:8765`. It prints the public HTTPS URL and the phone-app environment variable to use:

```powershell
$env:EXPO_PUBLIC_CODEX_REMOTE_URL = "https://<your-tunnel>.trycloudflare.com"
npm run android:local
```

`EXPO_PUBLIC_CODEX_REMOTE_URL` takes priority over older backend/tunnel variables and saved phone settings.

Quick tunnels are for short development sessions only. Stop the tunnel when you are done and use the official App Server websocket auth mode for anything beyond trusted local testing.

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

Regenerate protocol bindings from the installed Codex CLI:

```powershell
codex app-server generate-ts --out phone-app\generated\app-server
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

For local development, set phone build defaults when needed:

```powershell
$env:EXPO_PUBLIC_CODEX_REMOTE_URL = "ws://127.0.0.1:8765"
$env:EXPO_PUBLIC_CODEX_BACKEND_PORT = "8765"
```

Older `EXPO_PUBLIC_CODEX_BACKEND_URL` and `EXPO_PUBLIC_CODEX_TUNNEL_URL` values are still accepted as migration aliases, but new work should use `EXPO_PUBLIC_CODEX_REMOTE_URL`.

## Legacy Bridge

`desktop-server/` is deprecated for the Android remote-control path. Keep it untouched for now unless you are working on a compatibility fix or the follow-up cleanup PR that removes the legacy bridge.

## Security Notes

- Prefer `ws://127.0.0.1:8765` with ADB reverse, LAN/VPN, or `wss://` through a trusted tunnel.
- Use the official App Server websocket auth mode for non-loopback listeners.
- Do not commit `.env`, runtime logs, local databases, APKs, generated Android build output, or websocket auth tokens.
- Do not expose the official App Server endpoint publicly without authentication and network controls.

## Current Status

The Android app now targets the official Codex App Server / remote-control path by default. The legacy FastAPI bridge remains in the repo temporarily but is not required for thread browsing or control in the normal app flow.
