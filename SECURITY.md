# Security Policy

Codex Control is intended for trusted local networks, VPNs, or USB debugging through ADB reverse. It is not designed to be exposed directly to the public internet.

## Before Sharing A Server

- Change `CODEX_CONTROL_SHARED_TOKEN`.
- Keep `.env`, local databases, runtime logs, and generated APKs private.
- Restrict firewall access to trusted devices.
- Prefer VPN or USB reverse over public port forwarding.

## Reporting Issues

Open a GitHub issue with:

- the affected component (`phone-app` or `desktop-server`)
- the expected behavior
- the observed behavior
- relevant logs with tokens, local paths, and personal data removed
