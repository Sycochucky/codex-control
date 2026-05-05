import test = require("node:test");
import assert = require("node:assert/strict");

import { parseShellCommand } from "../utils/app-server-command";
import {
  buildGitignoreMergeScript,
  isAllowedProjectPath,
  isSafeBranchName,
  isSafeRemoteName,
  isSafeRepositoryName,
  normalizeRepositoryName,
} from "../utils/git-repository-setup";
import { createGitActionPresets, parseGitLog, parseGitStatus } from "../utils/git-shell";

test("parseGitStatus extracts branch and file state", () => {
  const parsed = parseGitStatus("## main...origin/main [ahead 1]\nM  app.tsx\n?? new.ts\n");
  assert.equal(parsed.branch, "main");
  assert.equal(parsed.files.length, 2);
});

test("parseGitLog normalizes sha and message", () => {
  const entries = parseGitLog("abc1234 first commit\n");
  assert.equal(entries[0]?.sha, "abc1234");
  assert.equal(entries[0]?.message, "first commit");
});

test("createGitActionPresets builds a commit command", () => {
  const presets = createGitActionPresets("main", "ship it");
  assert.equal(presets.find((preset) => preset.id === "commit")?.command.join(" "), "git commit -m ship it");
});

test("parseShellCommand preserves quoted args and paths with spaces", () => {
  assert.deepEqual(
    parseShellCommand('powershell -NoProfile -Command "git status --short" "C:\\Program Files\\Codex\\codex.exe"'),
    [
      "powershell",
      "-NoProfile",
      "-Command",
      "git status --short",
      "C:\\Program Files\\Codex\\codex.exe",
    ],
  );
});

test("normalizeRepositoryName creates a GitHub-safe default from paths", () => {
  assert.equal(normalizeRepositoryName("D:\\DevProjects\\My App.git"), "My-App");
  assert.equal(isSafeRepositoryName("My-App"), true);
  assert.equal(isSafeRepositoryName("../bad"), false);
});

test("repository setup validates branch, remote, and project path", () => {
  assert.equal(isSafeBranchName("feature/setup-repo"), true);
  assert.equal(isSafeBranchName("feature//bad"), false);
  assert.equal(isSafeRemoteName("origin"), true);
  assert.equal(isSafeRemoteName("origin remote"), false);
  assert.equal(isAllowedProjectPath("D:\\DevProjects\\codex-app-syco"), true);
  assert.equal(isAllowedProjectPath("C:\\Users\\NWA_4\\Desktop\\codex-app-syco"), false);
});

test("buildGitignoreMergeScript appends entries without overwrite commands", () => {
  const script = buildGitignoreMergeScript("expo");
  assert.match(script, /Add-Content/);
  assert.match(script, /node_modules\//);
  assert.doesNotMatch(script, /Remove-Item/);
});
