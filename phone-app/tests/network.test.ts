import test = require("node:test");
import assert = require("node:assert/strict");

import {
  getFriendlyNetworkErrorMessage,
  isValidAppServerEndpoint,
  normalizeAppServerEndpoint,
} from "../utils/network";

test("normalizeAppServerEndpoint trims and strips trailing slashes", () => {
  assert.equal(normalizeAppServerEndpoint(" ws://127.0.0.1:8765/ "), "ws://127.0.0.1:8765");
});

test("isValidAppServerEndpoint accepts official websocket and http transports", () => {
  assert.equal(isValidAppServerEndpoint("ws://127.0.0.1:8765"), true);
  assert.equal(isValidAppServerEndpoint("wss://remote.example.com/codex"), true);
  assert.equal(isValidAppServerEndpoint("http://127.0.0.1:8765"), true);
  assert.equal(isValidAppServerEndpoint("ftp://127.0.0.1:8765"), false);
});

test("getFriendlyNetworkErrorMessage maps common fetch failures", () => {
  assert.match(
    getFriendlyNetworkErrorMessage(new Error("Network request failed"), "fallback"),
    /Codex App Server remote endpoint/i,
  );
});
