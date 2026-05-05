import test = require("node:test");
import assert = require("node:assert/strict");

import { getDefaultBackendUrl } from "../utils/default-backend-url";

test("getDefaultBackendUrl uses an explicit Expo public backend URL first", () => {
  assert.equal(
    getDefaultBackendUrl({
      envUrl: " http://192.168.50.137:8000/ ",
      expoHostUri: "192.168.50.200:8081",
    }),
    "http://192.168.50.137:8000",
  );
});

test("getDefaultBackendUrl infers desktop backend URL from Expo LAN host", () => {
  assert.equal(
    getDefaultBackendUrl({ expoHostUri: "192.168.50.137:8081" }),
    "http://192.168.50.137:8010",
  );
});

test("getDefaultBackendUrl falls back to localhost for simulator and web localhost hosts", () => {
  assert.equal(
    getDefaultBackendUrl({ expoHostUri: "localhost:8081", browserHostname: "127.0.0.1" }),
    "http://127.0.0.1:8010",
  );
});

test("getDefaultBackendUrl accepts an Expo public backend port override", () => {
  assert.equal(
    getDefaultBackendUrl({ envPort: "8020", expoHostUri: "192.168.50.137:8081" }),
    "http://192.168.50.137:8020",
  );
});
