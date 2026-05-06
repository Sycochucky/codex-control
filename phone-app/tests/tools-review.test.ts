import test = require("node:test");
import assert = require("node:assert/strict");

import {
  getCommandCenterModeTabs,
  getReviewDefaults,
  getToolsModeTabs,
  partitionPluginsByInstallState,
} from "../utils/review-tools";

test("getReviewDefaults uses inline delivery for the selected thread", () => {
  assert.deepEqual(getReviewDefaults("thread-1"), {
    threadId: "thread-1",
    delivery: "inline",
    targetMode: "custom",
    customInstructions: "Review my recent commits for correctness risks and maintainability concerns.",
  });
});

test("getToolsModeTabs keeps terminal first", () => {
  assert.deepEqual(getToolsModeTabs(), ["terminal", "search", "review"]);
});

test("getCommandCenterModeTabs keeps plugins first", () => {
  assert.deepEqual(getCommandCenterModeTabs(), [
    "plugins",
    "apps",
    "skills",
    "mcp",
    "config",
    "experiments",
  ]);
});

test("partitionPluginsByInstallState sorts installed plugins before available plugins", () => {
  const grouped = partitionPluginsByInstallState([
    { id: "available-b", name: "Zeta", installed: false, enabled: false, source: null, interface: null },
    { id: "installed-disabled", name: "Beta", installed: true, enabled: false, source: null, interface: null },
    { id: "installed-enabled", name: "Alpha", installed: true, enabled: true, source: null, interface: null },
    { id: "available-a", name: "Delta", installed: false, enabled: false, source: null, interface: null },
  ]);

  assert.deepEqual(grouped.installed.map((plugin) => plugin.name), ["Alpha", "Beta"]);
  assert.deepEqual(grouped.available.map((plugin) => plugin.name), ["Delta", "Zeta"]);
});
