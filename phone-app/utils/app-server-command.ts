import { withAppServerClient } from "../services/app-server";
import type { AppServerCommandExecResponse } from "../types/app-server";

export async function runBufferedCommand(
  baseUrl: string,
  token: string,
  command: string[],
  cwd?: string | null,
  timeoutMs = 30000,
) {
  return await withAppServerClient(baseUrl, token, async (client) => {
    return await client.execCommand({
      command,
      cwd,
      timeoutMs,
    });
  });
}

export function stringifyJson(value: unknown) {
  return JSON.stringify(
    value,
    (_, next) => (typeof next === "bigint" ? next.toString() : next),
    2,
  );
}

export function getCombinedCommandOutput(result: AppServerCommandExecResponse) {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n").trim();
}

export function parseShellCommand(command: string) {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  const input = command.trim();
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      const next = input[index + 1];
      if (next === "\"" || next === "'" || next === "\\" || /\s/.test(next ?? "")) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}
