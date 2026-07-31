# Contributing

Thanks for checking out Codex Android Remote Control.

## Local Setup

```powershell
.\scripts\setup-dev.ps1
.\scripts\verify.ps1
```

## Development Notes

- Keep active app work in `phone-app/`.
- Treat `desktop-server/` as legacy unless you are fixing compatibility or doing the planned cleanup PR.
- Do not commit generated Android output, APKs, local databases, logs, caches, `.env` files, or App Server auth tokens.
- Keep remote-control access local-network first unless auth and network hardening are intentionally expanded.

## Pull Request Checklist

- Phone app typecheck passes.
- Phone logic tests pass.
- README/setup docs are updated when setup or behavior changes.
- For Android thread or connection work, run an App Server websocket smoke against the official endpoint.
- For tunnel work, verify `initialize`, `remoteControl/status/changed` if available, and `thread/list` through the public tunnel URL.
- Confirm normal phone flows do not require the legacy FastAPI bridge or port `8010`.
- For phone UI changes, validate on an attached Android device or clearly call out why device validation was blocked.
