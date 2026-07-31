import test = require("node:test");
import assert = require("node:assert/strict");

import { formatAppServerErrorMessage } from "../utils/app-server-error";

test("formatAppServerErrorMessage explains rate limit errors and keeps the raw message", () => {
  const message = formatAppServerErrorMessage(
    new Error("429 rate_limit_exceeded: too many requests, retry after 60s"),
    "Failed to send input to Codex.",
  );

  assert.match(message, /rate limited/i);
  assert.match(message, /retry after 60s/i);
});

test("formatAppServerErrorMessage explains quota and usage limit errors", () => {
  const message = formatAppServerErrorMessage(
    new Error("insufficient_quota: You exceeded your current quota"),
    "Failed to continue the Codex thread.",
  );

  assert.match(message, /usage or quota limit/i);
  assert.match(message, /insufficient_quota/i);
});

test("formatAppServerErrorMessage treats 429 quota errors as quota limits", () => {
  const message = formatAppServerErrorMessage(
    new Error("429 insufficient_quota: credit balance too low"),
    "Failed to continue the Codex thread.",
  );

  assert.match(message, /usage or quota limit/i);
  assert.doesNotMatch(message, /rate limited/i);
});

test("formatAppServerErrorMessage explains context window errors", () => {
  const message = formatAppServerErrorMessage(
    new Error("This model's maximum context length is 128000 tokens. Please reduce the input."),
    "Failed to send input to Codex.",
  );

  assert.match(message, /context limit/i);
  assert.match(message, /maximum context length/i);
});

test("formatAppServerErrorMessage preserves existing network guidance for network failures", () => {
  const message = formatAppServerErrorMessage(
    new Error("Network request failed"),
    "Failed to load App Server thread.",
  );

  assert.match(message, /could not reach the Codex App Server remote endpoint/i);
});

test("formatAppServerErrorMessage preserves non-limit string errors", () => {
  assert.equal(
    formatAppServerErrorMessage("model unavailable for this account", "Failed to send input to Codex."),
    "model unavailable for this account",
  );
});
