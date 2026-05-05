import test = require("node:test");
import assert = require("node:assert/strict");

import { withTimeout } from "../utils/async-timeout";

test("withTimeout resolves when the operation finishes first", async () => {
  const value = await withTimeout(Promise.resolve("done"), 20, "too slow");

  assert.equal(value, "done");
});

test("withTimeout rejects when the operation stays pending", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 5, "Threads page load timed out."),
    /threads page load timed out/i,
  );
});
