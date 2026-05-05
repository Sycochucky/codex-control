import test = require("node:test");
import assert = require("node:assert/strict");

import {
  AppServerClient,
  CreatedThreadError,
  mergeThreadListPages,
  withAppServerClient,
} from "../services/app-server";
import { getSessionValidationOutcome } from "../utils/session-restore";

test("getSessionValidationOutcome only treats 401 as invalid", () => {
  assert.equal(getSessionValidationOutcome({ status: 401 }), "invalid");
  assert.equal(getSessionValidationOutcome({ status: 500 }), "retryable");
});

test("mergeThreadListPages keeps the newest repeated thread", () => {
  const first = createThread({ id: "t1", updatedAt: 1 });
  const newer = createThread({ id: "t1", updatedAt: 2 });
  const merged = mergeThreadListPages([
    { data: [first], nextCursor: "x" },
    { data: [newer], nextCursor: null },
  ]);

  assert.equal(merged[0]?.updatedAt, 2);
});

test("mergeThreadListPages keeps the newest duplicate even if a later page is older", () => {
  const newest = createThread({ id: "t1", updatedAt: 9 });
  const older = createThread({ id: "t1", updatedAt: 3 });
  const merged = mergeThreadListPages([
    { data: [newest], nextCursor: "x" },
    { data: [older], nextCursor: null },
  ]);

  assert.equal(merged[0]?.updatedAt, 9);
});

test("AppServerClient rejects pending requests on close", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string };
      if (parsed.method === "initialize" && parsed.id !== undefined) {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }) });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }

    fail(reason: string) {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason });
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    const pending = client.listThreads();
    socket.fail("dropped");

    await assert.rejects(pending, /dropped/i);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("AppServerClient rejects and closes when opening the websocket times out", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    closeCount = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send() {}

    close() {
      this.closeCount += 1;
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient(
      "http://127.0.0.1:8000",
      "token",
      undefined,
      undefined,
      { connectTimeoutMs: 5 },
    );
    const socket = sockets[0];
    assert.ok(socket);

    await assert.rejects(
      Promise.race([
        client.connect(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("test observed no client connect timeout")), 30);
        }),
      ]),
      /connection timed out/i,
    );
    assert.equal(socket.closeCount, 1);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("withAppServerClient closes the socket when initialize fails", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    closeCount = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string };
      if (parsed.method === "initialize" && parsed.id !== undefined) {
        this.onmessage?.({
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            error: { code: -32000, message: "initialize failed" },
          }),
        });
      }
    }

    close() {
      this.closeCount += 1;
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const pending = withAppServerClient("http://127.0.0.1:8000", "token", async () => undefined);
    const socket = sockets[0];
    assert.ok(socket);
    socket.open();

    await assert.rejects(pending, /initialize failed/i);
    assert.equal(socket.closeCount, 1);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("AppServerClient accepts App Server responses without a jsonrpc field", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string };
      if (parsed.id === undefined || !parsed.method) {
        return;
      }

      if (parsed.method === "initialize") {
        this.onmessage?.({ data: JSON.stringify({ id: parsed.id, result: {} }) });
        return;
      }

      if (parsed.method === "thread/list") {
        this.onmessage?.({
          data: JSON.stringify({
            id: parsed.id,
            result: { data: [createThread({ id: "thread-from-app-server" })], nextCursor: null },
          }),
        });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = Promise.race([
      client.connect(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("connect did not resolve")), 30);
      }),
    ]);
    socket.open();
    await connectPromise;

    const page = await client.listThreads({ limit: 25 });
    assert.equal(page.data[0]?.id, "thread-from-app-server");
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("AppServerClient rejects pending requests on malformed JSON", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string };
      if (parsed.method === "initialize" && parsed.id !== undefined) {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }) });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    const pending = client.listThreads();
    socket.onmessage?.({ data: "{not-json" });

    await assert.rejects(pending, /malformed json/i);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("startThread surfaces the created thread id when follow-up setup fails", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string };
      if (parsed.id === undefined || !parsed.method) {
        return;
      }

      if (parsed.method === "initialize") {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }) });
        return;
      }

      if (parsed.method === "thread/start") {
        this.onmessage?.({
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            result: {
              thread: createThread({ id: "created-thread", updatedAt: 1 }),
              model: "gpt-5.4",
              modelProvider: "openai",
              serviceTier: null,
              cwd: "D:\\DevProjects\\codex-app-syco",
              approvalPolicy: "on-request",
              sandbox: "workspace-write",
              reasoningEffort: null,
            },
          }),
        });
        return;
      }

      if (parsed.method === "thread/name/set") {
        this.onmessage?.({
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id,
            error: { code: -32000, message: "rename failed" },
          }),
        });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    await assert.rejects(
      client.startThread({
        title: "New thread",
        initialMessage: null,
      }),
      (error: unknown) =>
        error instanceof CreatedThreadError &&
        error.threadId === "created-thread" &&
        /rename failed/i.test(error.message),
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("AppServerClient sends hidden-model and workspace config params", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];
  const sent: Array<{ id?: string | number; method?: string; params?: unknown }> = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string; params?: unknown };
      sent.push(parsed);
      if (parsed.id === undefined || !parsed.method) {
        return;
      }

      if (parsed.method === "initialize") {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }) });
        return;
      }

      if (parsed.method === "model/list") {
        this.onmessage?.({
          data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { data: [], nextCursor: null } }),
        });
        return;
      }

      if (parsed.method === "config/read") {
        this.onmessage?.({
          data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { config: {}, origins: {} } }),
        });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    await client.listModels({ cursor: "cursor-1", limit: 50, includeHidden: true });
    await client.readConfig({ cwd: "D:\\DevProjects\\codex-app-syco" });

    assert.deepEqual(
      sent.find((entry) => entry.method === "model/list")?.params,
      { cursor: "cursor-1", limit: 50, includeHidden: true },
    );
    assert.deepEqual(
      sent.find((entry) => entry.method === "config/read")?.params,
      { includeLayers: true, cwd: "D:\\DevProjects\\codex-app-syco" },
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("AppServerClient strips top-level null permissions before approval response", async () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];
  const sent: Array<{ id?: string | number; method?: string; result?: unknown }> = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason?: string }) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;

    constructor(url: string) {
      this.url = url;
      sockets.push(this);
    }

    send(payload: string) {
      const parsed = JSON.parse(payload) as { id?: string | number; method?: string; result?: unknown };
      sent.push(parsed);
      if (parsed.method === "initialize" && parsed.id !== undefined) {
        this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: {} }) });
      }
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ reason: "" });
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    const client = new AppServerClient("http://127.0.0.1:8000", "token");
    const socket = sockets[0];
    assert.ok(socket);

    const connectPromise = client.connect();
    socket.open();
    await connectPromise;

    client.respondToPermissionsApproval(
      "permissions-1",
      {
        network: { enabled: null },
        fileSystem: null,
        macos: { accessibility: true },
      },
      "session",
    );

    assert.deepEqual(
      sent.find((entry) => entry.id === "permissions-1")?.result,
      {
        permissions: {
          network: { enabled: null },
          macos: { accessibility: true },
        },
        scope: "session",
      },
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

function createThread(overrides: Record<string, unknown>) {
  return {
    id: "thread",
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" as const },
    path: null,
    cwd: "D:\\DevProjects\\codex-app-syco",
    cliVersion: "1.0.0",
    source: "vscode",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}
