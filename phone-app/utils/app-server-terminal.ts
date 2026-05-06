export type TerminalConnectionState = "idle" | "starting" | "running" | "stopped";

export function appendTerminalDelta(currentOutput: string, deltaBase64: string) {
  return `${currentOutput}${decodeTerminalDelta(deltaBase64)}`;
}

export function decodeTerminalDelta(deltaBase64: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(deltaBase64, "base64").toString("utf8");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(deltaBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  throw new Error("No base64 decoder is available in this environment.");
}

export function encodeTerminalInput(text: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }

  if (typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return globalThis.btoa(binary);
  }

  throw new Error("No base64 encoder is available in this environment.");
}
