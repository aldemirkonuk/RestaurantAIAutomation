/**
 * The handshake, against a REAL server.
 *
 * WHY A LOCAL HTTP SERVER AND NOT A MOCKED `fetch`
 * ------------------------------------------------
 * A stubbed `fetch` tests the shape of the code that calls it and nothing about
 * the protocol: it cannot tell you that the `Accept` header lists both content
 * types the spec makes mandatory, that the `Mcp-Session-Id` a server hands back
 * is echoed on the next request, that an SSE body actually parses, or that a
 * body over the cap is cut off instead of buffered. Each of those is a wire
 * fact, so each test here boots `node:http` on 127.0.0.1 and reads what
 * arrived.
 *
 * The stub is ours and it is local. Nothing in this file calls a public MCP
 * server: a test that depends on someone else's uptime reports THEIR outage as
 * OUR regression, and a test suite that quietly needs the network is one CI
 * runner away from being skipped.
 *
 * `MCP_ALLOW_PRIVATE_ENDPOINTS=true` is set on the services under test because
 * 127.0.0.1 is precisely what `mcp-endpoint.guard.ts` exists to refuse. The
 * final describe block proves the refusal is real by leaving the flag off.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { ConfigService } from "@nestjs/config";
import { McpRuntimeService } from "./mcp-runtime.service";

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  seen: Recorded[],
) => void;

interface Recorded {
  method: string;
  rpcMethod: string | null;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

interface Stub {
  url: string;
  seen: Recorded[];
  close: () => Promise<void>;
}

async function startStub(handler: Handler): Promise<Stub> {
  const seen: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        body = null;
      }
      seen.push({
        method: req.method ?? "",
        rpcMethod:
          body && typeof body === "object" && "method" in (body as object)
            ? String((body as { method: unknown }).method)
            : null,
        headers: req.headers,
        body,
      });
      handler(req, res, body, seen);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function runtime(env: Record<string, string> = {}): McpRuntimeService {
  const values: Record<string, string> = {
    MCP_ALLOW_PRIVATE_ENDPOINTS: "true",
    MCP_PROBE_TIMEOUT_MS: "4000",
    ...env,
  };
  return new McpRuntimeService({
    get: (key: string) => values[key],
  } as unknown as ConfigService);
}

const INIT_RESULT = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: { listChanged: true } },
  serverInfo: { name: "House POS bridge", version: "3.1.0" },
};

const TOOLS = [
  {
    name: "stock_on_hand",
    title: "Stock on hand",
    description: "What the cellar holds right now",
    inputSchema: { type: "object", properties: {} },
  },
  { name: "open_orders", description: "Purchase orders not yet received" },
];

/** The happy path server: JSON answers, a session id, two tools. */
function goodHandler(sessionId = "sess-abc-123"): Handler {
  return (req, res, body) => {
    const method =
      body && typeof body === "object" ? (body as { method?: string }).method : undefined;
    const id = body && typeof body === "object" ? (body as { id?: number }).id : undefined;

    if (method === "initialize") {
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: INIT_RESULT }));
      return;
    }
    if (method === "notifications/initialized") {
      res.writeHead(202).end();
      return;
    }
    if (method === "tools/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }));
      return;
    }
    res.writeHead(400).end();
  };
}

describe("McpRuntimeService.probe — the happy handshake", () => {
  let stub: Stub;
  afterEach(async () => stub?.close());

  it("initializes, acknowledges, lists tools, and records what answered", async () => {
    stub = await startStub(goodHandler());
    const outcome = await runtime().probe(stub.url, null);

    expect(outcome.status).toBe("ok");
    expect(outcome.serverName).toBe("House POS bridge");
    expect(outcome.serverVersion).toBe("3.1.0");
    expect(outcome.protocolVersion).toBe("2025-06-18");
    expect(outcome.tools?.map((t) => t.name)).toEqual([
      "stock_on_hand",
      "open_orders",
    ]);
    expect(outcome.toolCount).toBe(2);
    expect(outcome.truncated).toBe(false);
    expect(outcome.answeredAt).not.toBeNull();

    // The three-step lifecycle, in the order the spec fixes.
    expect(stub.seen.map((r) => r.rpcMethod)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);
  });

  it("sends the Accept header the spec makes mandatory", async () => {
    stub = await startStub(goodHandler());
    await runtime().probe(stub.url, null);

    const accept = String(stub.seen[0].headers.accept);
    expect(accept).toContain("application/json");
    expect(accept).toContain("text/event-stream");
  });

  it("echoes the server's session id on every later request", async () => {
    stub = await startStub(goodHandler("sess-from-the-server"));
    await runtime().probe(stub.url, null);

    expect(stub.seen[0].headers["mcp-session-id"]).toBeUndefined();
    expect(stub.seen[1].headers["mcp-session-id"]).toBe("sess-from-the-server");
    expect(stub.seen[2].headers["mcp-session-id"]).toBe("sess-from-the-server");
  });

  it("sends the version the SERVER negotiated, not the one we asked for", async () => {
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { ...INIT_RESULT, protocolVersion: "2025-03-26" },
          }),
        );
        return;
      }
      if (method === "notifications/initialized") return void res.writeHead(202).end();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }));
    });

    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.protocolVersion).toBe("2025-03-26");
    expect(stub.seen[2].headers["mcp-protocol-version"]).toBe("2025-03-26");
  });

  it("sends the secret as a bearer, and sends nothing when there is none", async () => {
    stub = await startStub(goodHandler());
    await runtime().probe(stub.url, "the-house-token");
    expect(stub.seen[0].headers.authorization).toBe("Bearer the-house-token");

    await stub.close();
    stub = await startStub(goodHandler());
    await runtime().probe(stub.url, null);
    expect(stub.seen[0].headers.authorization).toBeUndefined();
  });

  it("reads an SSE answer as readily as a JSON one", async () => {
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "notifications/initialized") return void res.writeHead(202).end();

      const result = method === "initialize" ? INIT_RESULT : { tools: TOOLS };
      res.writeHead(200, { "content-type": "text/event-stream" });
      // A server MAY send unrelated messages before the response; the client
      // must not mistake the first frame for the answer.
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } })}\n\n`);
      res.write(`id: 1\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`);
      res.end();
    });

    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("ok");
    expect(outcome.tools?.map((t) => t.name)).toEqual([
      "stock_on_hand",
      "open_orders",
    ]);
  });

  it("drops inputSchema — a row shows names, and nothing here can invoke", async () => {
    stub = await startStub(goodHandler());
    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.tools?.[0]).toEqual({
      name: "stock_on_hand",
      title: "Stock on hand",
      description: "What the cellar holds right now",
    });
  });
});

describe("McpRuntimeService.probe — a server that answers, but not with tools", () => {
  let stub: Stub;
  afterEach(async () => stub?.close());

  it("does not ask for tools when the server never offered the capability", async () => {
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { ...INIT_RESULT, capabilities: { resources: {} } },
          }),
        );
        return;
      }
      res.writeHead(202).end();
    });

    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("ok");
    expect(outcome.tools).toEqual([]);
    expect(outcome.toolCount).toBe(0);
    expect(outcome.detail).toMatch(/declares no tools capability/);
    expect(stub.seen.map((r) => r.rpcMethod)).not.toContain("tools/list");
  });

  it("separates 'answered with none' from 'never asked' by the sentence, not the array", async () => {
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: INIT_RESULT }));
        return;
      }
      if (method === "notifications/initialized") return void res.writeHead(202).end();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }));
    });

    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.tools).toEqual([]);
    expect(outcome.detail).toMatch(/lists no tools/);
    expect(stub.seen.map((r) => r.rpcMethod)).toContain("tools/list");
  });

  it("keeps the cap, and reports the count the server actually gave", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}` }));
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: INIT_RESULT }));
        return;
      }
      if (method === "notifications/initialized") return void res.writeHead(202).end();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { tools: many, nextCursor: "page-2" },
        }),
      );
    });

    const outcome = await runtime({ MCP_PROBE_MAX_TOOLS: "5" }).probe(stub.url, null);
    expect(outcome.tools).toHaveLength(5);
    // The whole point of two fields: a truncation must not read as the catalogue.
    expect(outcome.toolCount).toBe(12);
    expect(outcome.truncated).toBe(true);
    expect(outcome.detail).toMatch(/further pages/);
  });
});

describe("McpRuntimeService.probe — every failure is its own sentence", () => {
  let stub: Stub | undefined;
  afterEach(async () => stub?.close());

  it("classifies a 500 as refused, not as a dead server", async () => {
    stub = await startStub((req, res) => {
      res.writeHead(500, { "content-type": "text/plain" }).end("boom");
    });
    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toContain("500");
    expect(outcome.answeredAt).toBeNull();
  });

  it("names a 401 as the credential being refused", async () => {
    stub = await startStub((req, res) => void res.writeHead(401).end());
    const outcome = await runtime().probe(stub.url, "wrong-token");
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toMatch(/did not accept the credential/);
  });

  it("prefers the server's own JSON-RPC error message over our status line", async () => {
    stub = await startStub((req, res, body) => {
      const id = (body as { id?: number })?.id;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Unsupported protocol version" },
        }),
      );
    });
    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toContain("Unsupported protocol version");
    expect(outcome.detail).toContain("-32602");
  });

  it("calls a body without protocolVersion a protocol error, not a connection", async () => {
    stub = await startStub((req, res, body) => {
      const id = (body as { id?: number })?.id;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { hello: "world" } }));
    });
    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("protocol_error");
    expect(outcome.detail).toMatch(/no protocolVersion/);
  });

  it("refuses to follow a redirect, so the credential cannot leave the checked host", async () => {
    stub = await startStub((req, res) => {
      res.writeHead(302, { location: "https://elsewhere.example/mcp" }).end();
    });
    const outcome = await runtime().probe(stub.url, "the-house-token");
    expect(outcome.status).toBe("protocol_error");
    expect(outcome.detail).toMatch(/redirected/);
    expect(outcome.detail).toContain("elsewhere.example");
  });

  it("cuts off a body over the cap instead of buffering it", async () => {
    stub = await startStub((req, res, body) => {
      const id = (body as { id?: number })?.id;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: { ...INIT_RESULT, padding: "x".repeat(50_000) },
        }),
      );
    });
    const outcome = await runtime({ MCP_PROBE_MAX_BYTES: "2048" }).probe(stub.url, null);
    expect(outcome.status).toBe("protocol_error");
    expect(outcome.detail).toMatch(/larger than the 2048-byte limit/);
  });

  it("gives up on a server that never answers, and calls it unreachable", async () => {
    stub = await startStub(() => {
      /* answer nothing at all */
    });
    const started = Date.now();
    const outcome = await runtime({ MCP_PROBE_TIMEOUT_MS: "300" }).probe(stub.url, null);
    expect(outcome.status).toBe("unreachable");
    expect(outcome.detail).toMatch(/time budget/);
    // The deadline is real: this must not have waited on a default socket timeout.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("calls a closed port unreachable, with the system's own code", async () => {
    const closed = await startStub(() => undefined);
    const url = closed.url;
    await closed.close();
    const outcome = await runtime().probe(url, null);
    expect(outcome.status).toBe("unreachable");
    expect(outcome.detail).toMatch(/ECONNREFUSED|did not complete/);
  });

  it("stops at the handshake when the initialized notification is rejected", async () => {
    stub = await startStub((req, res, body) => {
      const method = (body as { method?: string })?.method;
      const id = (body as { id?: number })?.id;
      if (method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: INIT_RESULT }));
        return;
      }
      res.writeHead(400).end();
    });
    const outcome = await runtime().probe(stub.url, null);
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toMatch(/initialized notification/);
    // It answered the handshake, so what it said about itself is kept.
    expect(outcome.serverName).toBe("House POS bridge");
    expect(outcome.tools).toBeNull();
  });
});

describe("McpRuntimeService — where it will not go", () => {
  it("refuses a loopback endpoint unless a deployment says otherwise", async () => {
    const service = new McpRuntimeService({
      get: () => undefined,
    } as unknown as ConfigService);

    const outcome = await service.probe("http://127.0.0.1:9/mcp", null);
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toMatch(/loopback/);
    expect(outcome.detail).toContain("MCP_ALLOW_PRIVATE_ENDPOINTS");
  });

  it("refuses the cloud instance-metadata address", async () => {
    const service = new McpRuntimeService({
      get: () => undefined,
    } as unknown as ConfigService);

    const outcome = await service.probe(
      "http://169.254.169.254/latest/meta-data/",
      null,
    );
    expect(outcome.status).toBe("refused");
    expect(outcome.detail).toMatch(/link-local/);
  });

  it("has no way to call a tool — the guardrail decision comes first", () => {
    // Structural, and deliberately so: the commitment guardrail (ADR 0013) is
    // undecided for MCP dispatch, so the absence of an invocation path is a
    // property of this module and not a habit of its callers.
    const names = Object.getOwnPropertyNames(McpRuntimeService.prototype);
    expect(names).toContain("probe");
    expect(names).not.toContain("call");
    expect(names).not.toContain("callTool");
    expect(names).not.toContain("invoke");
  });
});
