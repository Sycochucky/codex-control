import test = require("node:test");
import assert = require("node:assert/strict");

import {
  DEFAULT_THEME_PRESET_ID,
  normalizeThemePresetId,
  themePresets,
} from "../constants/theme";

test("theme preset normalization falls back to Codex Dark", () => {
  assert.equal(normalizeThemePresetId("graphite"), "graphite");
  assert.equal(normalizeThemePresetId("missing"), DEFAULT_THEME_PRESET_ID);
  assert.equal(normalizeThemePresetId(null), DEFAULT_THEME_PRESET_ID);
});

test("dark theme presets expose semantic UI tokens", () => {
  for (const preset of Object.values(themePresets)) {
    assert.ok(preset.background);
    assert.ok(preset.backgroundElevated);
    assert.ok(preset.cardSoft);
    assert.ok(preset.primaryStrong);
    assert.ok(preset.onAccent);
    assert.ok(preset.noticeErrorBackground);
    assert.ok(preset.noticeSuccessText);
    assert.ok(preset.userBubbleText);
  }
});
