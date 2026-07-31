# Architecture Overview

Codex Android Remote Control has one active runtime client: the Android app in `phone-app/`. The app connects directly to the official Codex App Server / remote-control endpoint exposed by the installed Codex CLI.

## Phone App

The phone app is built with Expo Router, React Native, and TypeScript. It owns the mobile UI, local connection storage, App Server JSON-RPC client, thread/project browsing, Git/operator screens, and Android setup scripts.

Expo is still used for the JavaScript and native build workflow, but the app is meant to be installed as a native Android build, not used only through Expo Go.

The Threads screen groups App Server threads by their project/workspace metadata. Project groups are ordered by each group's most recently updated thread, and threads inside a group are also shown newest first. This keeps the Android list aligned with the desktop Codex app's project-oriented thread browsing while preserving the paged active/archived list behavior.

Thread detail surfaces live connection state from the App Server client: connecting, connected, sending, waiting for Codex, waiting for user input, refreshing, disconnected, and error states. App Server errors are normalized before display so rate limits, quota or billing limits, and context-window limits get specific user-facing messages.

## App Server Path

The normal runtime path is:

```text
phone-app -> official Codex remote-control/App Server -> Codex
```

The phone app connects to a direct websocket endpoint such as `ws://127.0.0.1:8765`, `ws://<desktop-lan-ip>:8765`, or a secure `wss://` tunnel, then targets the official `/ws` websocket path. It sends `initialize`, consumes official notifications including `thread/status/changed` and `remoteControl/status/changed`, and uses App Server methods such as `thread/list`, `thread/start`, `turn/start`, and `turn/steer`.

## Local Network Model

The default direct App Server port is `8765`.

Supported local access patterns:

- ADB reverse: phone app uses `ws://127.0.0.1:8765`.
- LAN/VPN: phone app uses `ws://<desktop-lan-ip>:8765`.
- Temporary tunnel: phone app uses `EXPO_PUBLIC_CODEX_REMOTE_URL=https://<tunnel-host>` or a manually entered `wss://` URL.

The system is intended for trusted local networks, VPNs, USB debugging, and short-lived development tunnels. It is not hardened for unauthenticated public internet exposure.

## Legacy Bridge

`desktop-server/` is a deprecated FastAPI bridge from the earlier runtime path:

```text
phone-app -> desktop-server -> local Codex App Server -> Codex
```

It remains in the repository temporarily for compatibility and follow-up cleanup, but it is not part of the normal Android remote-control path.

## Repository Shape

- `phone-app/` - active Android remote-control app.
- `desktop-server/` - legacy FastAPI bridge, deprecated for Android runtime.
- `scripts/` - repo-level setup and verification helpers.
- `docs/` - current design notes only.

Generated native builds, local databases, runtime logs, caches, and the old `mobile-app/` prototype are excluded from the public repository.
