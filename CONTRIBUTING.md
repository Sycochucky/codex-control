# Contributing

Thanks for checking out Codex Control.

## Local Setup

```powershell
.\scripts\setup-dev.ps1
.\scripts\verify.ps1
```

## Development Notes

- Keep active app work in `phone-app/`.
- Keep desktop bridge work in `desktop-server/`.
- Do not commit generated Android output, APKs, local databases, logs, caches, or `.env` files.
- Keep the desktop bridge local-network first unless auth and network hardening are intentionally expanded.

## Pull Request Checklist

- Phone app typecheck passes.
- Phone logic tests pass.
- Desktop server tests pass.
- README/setup docs are updated when setup or behavior changes.
