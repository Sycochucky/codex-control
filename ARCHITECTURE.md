# Architecture Overview

Codex Control has two active pieces: an Android app in `phone-app/` and a local desktop bridge in `desktop-server/`.

## Phone App

The phone app is built with Expo Router, React Native, and TypeScript. It owns the mobile UI, local session storage, App Server client protocol, Git/operator screens, and Android setup scripts.

Expo is still used for the JavaScript and native build workflow, but the app is meant to be installed as a native Android build, not used only through Expo Go.

## Desktop Bridge

The desktop bridge is a FastAPI service. It provides:

- shared-token login and bearer sessions
- setup/status APIs for Codex, Git, GitHub CLI, and local tooling
- GitHub device login helpers
- a WebSocket proxy into the local Codex App Server

The phone never stores Codex credentials directly. It talks to the desktop bridge, and the bridge talks to the local Codex/App Server environment.

## App Server Path

The main runtime path is:

```text
phone-app -> desktop-server -> local Codex App Server -> Codex
```

The desktop bridge keeps a bounded WebSocket startup/connect path for the local App Server and proxies JSON-RPC traffic to the phone app.

## Local Network Model

The default backend port is `8010` to avoid common Docker conflicts on `8000`.

Supported local access patterns:

- ADB reverse: phone app uses `http://127.0.0.1:8010`
- LAN/VPN: phone app uses `http://<desktop-lan-ip>:8010`

The system is intended for trusted local networks, VPNs, and USB debugging. It is not hardened for direct public internet exposure.

## Repository Shape

- `phone-app/` - active Android app.
- `desktop-server/` - active FastAPI desktop bridge.
- `scripts/` - repo-level setup and verification helpers.
- `docs/` - current design notes only.

Generated native builds, local databases, runtime logs, caches, and the old `mobile-app/` prototype are excluded from the public repository.
