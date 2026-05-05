import test = require("node:test");
import assert = require("node:assert/strict");

import { getFriendlyNetworkErrorMessage, isValidGatewayUrl, normalizeGatewayUrl } from "../utils/network";

test("normalizeGatewayUrl trims and strips trailing slashes", () => {
  assert.equal(normalizeGatewayUrl(" http://127.0.0.1:8000/ "), "http://127.0.0.1:8000");
});

test("isValidGatewayUrl accepts only http and https", () => {
  assert.equal(isValidGatewayUrl("http://192.168.1.10:8000"), true);
  assert.equal(isValidGatewayUrl("https://example.com"), true);
  assert.equal(isValidGatewayUrl("ws://127.0.0.1:8000"), false);
});

test("getFriendlyNetworkErrorMessage maps common fetch failures", () => {
  assert.match(
    getFriendlyNetworkErrorMessage(new Error("Network request failed"), "fallback"),
    /could not reach/i,
  );
});
