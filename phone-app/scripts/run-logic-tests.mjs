import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.join(projectRoot, ".logic-test-dist");

function collectTestFiles(directory) {
  const entries = readdirSync(directory);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

execFileSync(
  process.execPath,
  [path.join(projectRoot, "node_modules", "typescript", "lib", "tsc.js"), "-p", "tsconfig.logic-tests.json"],
  {
    cwd: projectRoot,
    stdio: "inherit",
  },
);

try {
  const testFiles = collectTestFiles(path.join(distDir, "tests"));
  execFileSync(process.execPath, ["--test", ...testFiles], {
    cwd: projectRoot,
    stdio: "inherit",
  });
} finally {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }
}
