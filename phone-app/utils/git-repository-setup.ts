export type RepositoryVisibility = "private" | "public";

export type GitignoreTemplateId = "none" | "node" | "expo" | "python" | "dotnet";

export type GitignoreTemplate = {
  id: GitignoreTemplateId;
  label: string;
  lines: string[];
};

const DEV_PROJECTS_ROOT = "D:\\DevProjects";

export const GITIGNORE_TEMPLATES: GitignoreTemplate[] = [
  {
    id: "none",
    label: "None",
    lines: [],
  },
  {
    id: "node",
    label: "Node",
    lines: [
      "# Dependencies",
      "node_modules/",
      "",
      "# Build output",
      "dist/",
      "build/",
      "coverage/",
      "",
      "# Local environment",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Logs",
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",
      "pnpm-debug.log*",
    ],
  },
  {
    id: "expo",
    label: "Expo",
    lines: [
      "# Dependencies",
      "node_modules/",
      "",
      "# Expo and React Native",
      ".expo/",
      ".expo-shared/",
      "android/",
      "ios/",
      "web-build/",
      "",
      "# Native build output",
      "*.apk",
      "*.aab",
      "*.ipa",
      "",
      "# Local environment",
      ".env",
      ".env.*",
      "!.env.example",
      "",
      "# Logs",
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",
      "pnpm-debug.log*",
    ],
  },
  {
    id: "python",
    label: "Python",
    lines: [
      "# Python cache",
      "__pycache__/",
      "*.py[cod]",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      "",
      "# Virtual environments",
      ".venv/",
      "venv/",
      "",
      "# Build output",
      "build/",
      "dist/",
      "*.egg-info/",
      "",
      "# Local environment",
      ".env",
      ".env.*",
      "!.env.example",
    ],
  },
  {
    id: "dotnet",
    label: ".NET",
    lines: [
      "# .NET build output",
      "bin/",
      "obj/",
      "",
      "# IDE state",
      ".vs/",
      "*.user",
      "*.suo",
      "",
      "# Test output",
      "TestResults/",
      "coverage/",
    ],
  },
];

export function getGitignoreTemplate(templateId: GitignoreTemplateId) {
  return GITIGNORE_TEMPLATES.find((template) => template.id === templateId) ?? GITIGNORE_TEMPLATES[0];
}

export function normalizeRepositoryName(value: string | null | undefined) {
  const leaf = (value ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return leaf
    .trim()
    .replace(/\.git$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "")
    .slice(0, 100);
}

export function isSafeRepositoryName(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.endsWith(".git");
}

export function isSafeRemoteName(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

export function isSafeBranchName(value: string) {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock")
  );
}

export function isAllowedProjectPath(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const normalizedRoot = normalizeWindowsPath(DEV_PROJECTS_ROOT);
  const normalizedValue = normalizeWindowsPath(value);
  return normalizedValue === normalizedRoot || normalizedValue.startsWith(`${normalizedRoot}\\`);
}

export function buildGitignoreMergeScript(templateId: GitignoreTemplateId) {
  const template = getGitignoreTemplate(templateId);
  const payload = template.lines.join("\n");

  return [
    "$ErrorActionPreference = 'Stop'",
    "$target = Join-Path (Get-Location) '.gitignore'",
    "$template = @'",
    payload,
    "'@",
    "if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType File -Path $target -Force | Out-Null }",
    "$existing = @(Get-Content -LiteralPath $target -ErrorAction SilentlyContinue)",
    "$toAdd = @()",
    "foreach ($line in ($template -split \"`r?`n\")) {",
    "  if ($line -eq '') { continue }",
    "  if ($existing -notcontains $line -and $toAdd -notcontains $line) { $toAdd += $line }",
    "}",
    "if ($toAdd.Count -eq 0) { Write-Output '.gitignore already contains the selected template entries.'; exit 0 }",
    "if ($existing.Count -gt 0 -and $existing[$existing.Count - 1] -ne '') { Add-Content -LiteralPath $target -Value '' }",
    "Add-Content -LiteralPath $target -Value $toAdd",
    `Write-Output "Added $($toAdd.Count) ${escapePowerShellDoubleQuotedString(template.label)} .gitignore entries."`,
  ].join("\n");
}

function normalizeWindowsPath(value: string) {
  return value.replace(/^\\\\\?\\/, "").replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
}

function escapePowerShellDoubleQuotedString(value: string) {
  return value.replace(/`/g, "``").replace(/\$/g, "`$").replace(/"/g, '`"');
}
