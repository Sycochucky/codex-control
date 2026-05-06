import test = require("node:test");
import assert = require("node:assert/strict");

import { getDefaultBackendUrl, hasExplicitDefaultBackendUrl } from "../utils/default-backend-url";

test("getDefaultBackendUrl uses an explicit Expo public backend URL first", () => {
  assert.equal(
    getDefaultBackendUrl({
      envUrl: " http://192.168.50.137:8000/ ",
      envTunnelUrl: "https://example.trycloudflare.com",
      expoHostUri: "192.168.50.200:8081",
    }),
    "http://192.168.50.137:8000",
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
    "http://192.168.50.137:8010",
  );
});

test("getDefaultBackendUrl infers desktop backend URL from Expo LAN host", () => {
  assert.equal(
    getDefaultBackendUrl({ envTunnelUrl: null, expoHostUri: "192.168.50.137:8081" }),
    "http://192.168.50.137:8010",
  );
});

test("getDefaultBackendUrl falls back to localhost for simulator and web localhost hosts", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: null,
      expoHostUri: "localhost:8081",
      browserHostname: "127.0.0.1",
    }),
    "http://127.0.0.1:8010",
  );
});

test("getDefaultBackendUrl accepts an Expo public backend port override", () => {
  assert.equal(
    getDefaultBackendUrl({
      envTunnelUrl: null,
      envPort: "8020",
      expoHostUri: "192.168.50.137:8081",
    }),
    "http://192.168.50.137:8020",
  );
});

test("hasExplicitDefaultBackendUrl detects backend or tunnel URL overrides", () => {
  assert.equal(hasExplicitDefaultBackendUrl({ envUrl: "http://10.0.0.2:8010" }), true);
  assert.equal(hasExplicitDefaultBackendUrl({ envTunnelUrl: "https://env.trycloudflare.com" }), true);
  assert.equal(hasExplicitDefaultBackendUrl({ envTunnelUrl: "env.trycloudflare.com" }), false);
});
