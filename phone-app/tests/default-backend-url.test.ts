import test = require("node:test");
import assert = require("node:assert/strict");

import { getDefaultBackendUrl, hasExplicitDefaultBackendUrl } from "../utils/default-backend-url";

test("getDefaultBackendUrl uses an explicit Expo public remote URL first", () => {
  assert.equal(
    getDefaultBackendUrl({
      envRemoteUrl: " ws://192.168.50.137:8765/ ",
      envUrl: " http://192.168.50.137:8000/ ",
      envTunnelUrl: "https://example.trycloudflare.com",
      expoHostUri: "192.168.50.200:8081",
    }),
    "ws://192.168.50.137:8765",
  );
});

test("getDefaultBackendUrl uses an Expo public tunnel URL before inferred hosts", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: " https://example.trycloudflare.com/ ",
      expoHostUri: "192.168.50.200:8081",
    }),
    "https://example.trycloudflare.com",
  );
});

test("getDefaultBackendUrl reads EXPO_PUBLIC_CODEX_REMOTE_URL before tunnel env", () => {
  const originalRemoteUrl = process.env.EXPO_PUBLIC_CODEX_REMOTE_URL;
  const originalTunnelUrl = process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL;
  process.env.EXPO_PUBLIC_CODEX_REMOTE_URL = " wss://remote.example.com/codex/ ";
  process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL = " https://env.trycloudflare.com/ ";

  try {
    assert.equal(
      getDefaultBackendUrl({
        expoHostUri: "192.168.50.200:8081",
      }),
      "wss://remote.example.com/codex",
    );
  } finally {
    if (originalRemoteUrl === undefined) {
      delete process.env.EXPO_PUBLIC_CODEX_REMOTE_URL;
    } else {
      process.env.EXPO_PUBLIC_CODEX_REMOTE_URL = originalRemoteUrl;
    }

    if (originalTunnelUrl === undefined) {
      delete process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL;
    } else {
      process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL = originalTunnelUrl;
    }
  }
});

test("getDefaultBackendUrl reads EXPO_PUBLIC_CODEX_TUNNEL_URL when no tunnel input is passed", () => {
  const originalTunnelUrl = process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL;
  process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL = " https://env.trycloudflare.com/ ";

  try {
    assert.equal(
      getDefaultBackendUrl({
        expoHostUri: "192.168.50.200:8081",
      }),
      "https://env.trycloudflare.com",
    );
  } finally {
    if (originalTunnelUrl === undefined) {
      delete process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL;
    } else {
      process.env.EXPO_PUBLIC_CODEX_TUNNEL_URL = originalTunnelUrl;
    }
  }
});

test("getDefaultBackendUrl ignores invalid tunnel URLs", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: "example.trycloudflare.com",
      expoHostUri: "192.168.50.137:8081",
    }),
    "ws://192.168.50.137:8765",
  );
});

test("getDefaultBackendUrl infers Codex App Server URL from Expo LAN host", () => {
  assert.equal(
    getDefaultBackendUrl({ envTunnelUrl: null, expoHostUri: "192.168.50.137:8081" }),
    "ws://192.168.50.137:8765",
  );
});

test("getDefaultBackendUrl falls back to localhost for simulator and web localhost hosts", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: null,
      expoHostUri: "localhost:8081",
      browserHostname: "127.0.0.1",
    }),
    "ws://127.0.0.1:8765",
  );
});

test("getDefaultBackendUrl accepts an Expo public remote port override", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: null,
      envPort: "8020",
      expoHostUri: "192.168.50.137:8081",
    }),
    "ws://192.168.50.137:8020",
  );
});

test("hasExplicitDefaultBackendUrl detects remote, backend, or tunnel URL overrides", () => {
  assert.equal(hasExplicitDefaultBackendUrl({ envRemoteUrl: "ws://10.0.0.2:8765" }), true);
  assert.equal(hasExplicitDefaultBackendUrl({ envUrl: "http://10.0.0.2:8765" }), true);
  assert.equal(hasExplicitDefaultBackendUrl({ envTunnelUrl: "https://env.trycloudflare.com" }), true);
  assert.equal(hasExplicitDefaultBackendUrl({ envTunnelUrl: "env.trycloudflare.com" }), false);
});
