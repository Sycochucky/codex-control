# Security Policy

Codex Android Remote Control is intended for trusted local networks, VPNs, or USB debugging through ADB reverse. It is not designed to expose an unauthenticated Codex App Server endpoint directly to the public internet.

Temporary quick tunnels are supported for development smoke testing, but they should be treated as short-lived remote access to your local Codex App Server / remote-control endpoint. They are not a production exposure model.

## Before Sharing A Server

- Use the official App Server websocket auth mode for non-loopback listeners.
- Keep websocket auth tokens, `.env`, local databases, runtime logs, and generated APKs private.
- Restrict firewall access to trusted devices.
- Prefer VPN or USB reverse over public port forwarding.
- For quick tunnels, keep the tunnel URL private and stop the tunnel as soon as testing is done.

## Reporting Issues

Open a GitHub issue with:

- the affected component (`phone-app`, official App Server integration, or legacy `desktop-server`)
- the expected behavior
- the observed behavior
- relevant logs with tokens, local paths, and personal data removed
