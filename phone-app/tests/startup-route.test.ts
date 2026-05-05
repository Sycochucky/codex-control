import test = require("node:test");
import assert = require("node:assert/strict");

import { getStartupRoute } from "../utils/startup-route";

test("getStartupRoute sends unauthenticated users to connect", () => {
  assert.equal(getStartupRoute({ isHydrated: true, sessionToken: null }), "/connect");
});

test("getStartupRoute sends authenticated users to threads", () => {
  assert.equal(getStartupRoute({ isHydrated: true, sessionToken: "abc" }), "/(tabs)/threads");
});

test("getStartupRoute waits while storage is hydrating", () => {
  assert.equal(getStartupRoute({ isHydrated: false, sessionToken: null }), null);
});
