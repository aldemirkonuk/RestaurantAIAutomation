import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpCredentialsService } from "./mcp-credentials.service";
import { McpServerService } from "./mcp-server.service";
import { McpCredential } from "./mcp-server.types";
import { McpToolReadersService } from "./mcp-tool-readers.service";
import { READ_TOOLS, WRITE_TOOLS } from "./tool-catalog";

/**
 * What these specs are actually asserting.
 *
 * Not "the dispatcher runs" — that a call returns SOMETHING is the weakest
 * possible claim and is the one an absent implementation also satisfies. Each
 * spec below names a sentence the server has to be able to say: which house it
 * read, that a write declined and why, that a scope it does not hold is a
 * refusal and not a silence.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";

function credential(overrides: Partial<McpCredential> = {}): McpCredential {
  return {
    id: "cred-1",
    restaurantId: HOUSE_A,
    label: "Front-of-house assistant",
    scopes: [
      "inventory:read",
      "orders:read",
      "vendors:read",
      "prices:read",
      "analytics:read",
      "logs:read",
      "platform:read",
    ],
    ...overrides,
  };
}

function build(readerOverrides: Partial<McpToolReadersService> = {}) {
  const readers = {
    inventoryList: jest.fn(),
    inventoryLowStock: jest.fn(),
    ordersList: jest.fn(),
    ordersGet: jest.fn(),
    vendorsSearch: jest.fn(),
    pricesCompare: jest.fn(),
    insights: jest.fn(),
    financial: jest.fn(),
    timelineRead: jest.fn(),
    health: jest.fn(),
    ...readerOverrides,
  } as unknown as McpToolReadersService;

  const credentials = {
    logCall: jest.fn().mockResolvedValue(undefined),
  } as unknown as McpCredentialsService;

  const cellar = { read: jest.fn() } as unknown as { read: jest.Mock };

  const service = new McpServerService(
    readers,
    credentials,
    cellar as never,
  );
  return { service, readers, cellar };
}

function resultOf(answer: unknown): {
  isError?: boolean;
  structuredContent?: { value: unknown; reason?: string };
} {
  return (answer as { result: never }).result;
}

describe("McpServerService — the handshake", () => {
  it("answers initialize with the SAME protocol revision the client half pins", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      credential(),
    );
    const result = (answer as { result: Record<string, unknown> }).result;

    // Not a hardcoded "2025-06-18" on both sides — the assertion is that the
    // two halves READ THE SAME CONSTANT, which is the thing that cannot drift.
    expect(result.protocolVersion).toBe(McpRuntimeService.PROTOCOL_VERSION);
    expect((result.serverInfo as { name: string }).name).toBe("mudavym");
    expect(String(result.instructions)).toContain("commits nothing");
  });

  it("declares only the capabilities it serves — no listChanged it never sends", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      credential(),
    );
    const caps = (answer as { result: { capabilities: Record<string, unknown> } })
      .result.capabilities;
    expect(Object.keys(caps).sort()).toEqual(["prompts", "resources", "tools"]);
    expect(caps.tools).toEqual({});
    expect(caps).not.toHaveProperty("logging");
  });

  it("answers a notification with null so the transport can send 202", async () => {
    const { service } = build();
    await expect(
      service.handle(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        credential(),
      ),
    ).resolves.toBeNull();
  });

  it("names the methods it does implement when asked for one it does not", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 9, method: "completion/complete" },
      credential(),
    );
    const error = (answer as { error: { code: number; message: string } }).error;
    expect(error.code).toBe(-32601);
    expect(error.message).toContain("tools/call");
  });
});

describe("McpServerService — tools/list", () => {
  it("carries all four annotation hints on every tool", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      credential(),
    );
    const tools = (answer as { result: { tools: Record<string, never>[] } })
      .result.tools;

    expect(tools.length).toBe(READ_TOOLS.length + WRITE_TOOLS.length);
    for (const tool of tools) {
      // Our OWN client classifies a tool with no annotations as a write
      // (tool-classification.ts). A server that omitted them would be read as
      // all-writes by our own rule, so all four are required, on all of them.
      expect(Object.keys(tool.annotations).sort()).toEqual([
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
        "readOnlyHint",
      ]);
      expect(tool.inputSchema).toBeDefined();
      expect(String(tool.description).length).toBeGreaterThan(20);
    }
  });

  it("declares every write with readOnlyHint false, and none of them destructive", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      credential(),
    );
    const tools = (answer as {
      result: { tools: { name: string; annotations: Record<string, boolean> }[] };
    }).result.tools;

    for (const write of WRITE_TOOLS) {
      const wire = tools.find((t) => t.name === write.name);
      expect(wire).toBeDefined();
      expect(wire!.annotations.readOnlyHint).toBe(false);
      // Every write is a draft, a proposal, or a record of something that
      // already happened. Nothing here deletes.
      expect(wire!.annotations.destructiveHint).toBe(false);
    }
  });

  it("hides a read whose scope the key does not hold, and still lists the writes", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      credential({ scopes: ["orders:read"] }),
    );
    const names = (answer as { result: { tools: { name: string }[] } }).result.tools.map(
      (t) => t.name,
    );

    expect(names).toContain("orders.list");
    expect(names).not.toContain("inventory.list");
    // `health.live` needs no scope, so it survives an empty grant.
    expect(names).toContain("health.live");
    // The writes are listed for EVERY key: hiding them would tell the client
    // that Mudavym cannot draft an order, which is false.
    expect(names).toContain("orders.draft");
  });
});

describe("McpServerService — a read", () => {
  it("calls the service the page calls, with the credential's house", async () => {
    const inventoryList = jest.fn().mockResolvedValue({
      value: { items: [{ id: "a" }] },
      provenance: { readAt: "2026-09-06T00:00:00.000Z", rows: 1, source: "x" },
    });
    const { service } = build({ inventoryList } as never);

    const answer = await service.handle(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "inventory.list", arguments: {} },
      },
      credential(),
    );

    expect(inventoryList).toHaveBeenCalledWith(HOUSE_A);
    const result = resultOf(answer);
    expect(result.isError).toBe(false);
    expect(result.structuredContent?.value).toEqual({ items: [{ id: "a" }] });
  });

  it("returns the row count and the read time with the figure", async () => {
    const financial = jest.fn().mockResolvedValue({
      value: { cogsPct: 31.4 },
      provenance: {
        readAt: "2026-09-06T10:00:00.000Z",
        rows: 1,
        source: "AnalyticsService.getFinancialSummary",
      },
    });
    const { service } = build({ financial } as never);

    const answer = await service.handle(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "analytics.financial", arguments: {} },
      },
      credential(),
    );
    const payload = resultOf(answer).structuredContent as unknown as {
      provenance: { readAt: string; rows: number; source: string };
    };
    expect(payload.provenance.rows).toBe(1);
    expect(payload.provenance.readAt).toBe("2026-09-06T10:00:00.000Z");
    expect(payload.provenance.source).toContain("AnalyticsService");
  });

  it("reports an upstream failure as a fault, never as an absence", async () => {
    const inventoryList = jest
      .fn()
      .mockRejectedValue(new Error("Service Unavailable (503)"));
    const { service } = build({ inventoryList } as never);

    const answer = await service.handle(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "inventory.list", arguments: {} },
      },
      credential(),
    );
    const result = resultOf(answer);
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.value).toBeNull();
    expect(result.structuredContent?.reason).toContain("503");
    expect(result.structuredContent?.reason).toContain(
      'do not read it as "there is none"',
    );
  });
});

describe("McpServerService — tenancy", () => {
  it("never lets a tool argument name the house", () => {
    // The structural assertion, not a behavioural one: no read tool's schema
    // has a place to put a restaurant id, so there is no argument to smuggle.
    for (const tool of READ_TOOLS) {
      const props = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {},
      );
      expect(props).not.toContain("restaurantId");
      expect(props).not.toContain("restaurant_id");
      expect(props).not.toContain("houseId");
    }
  });

  it("refuses another house's resource even though the URI is well-formed", async () => {
    const { service, cellar } = build();
    const answer = await service.handle(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "resources/read",
        params: { uri: `mudavym://cellar/${HOUSE_B}` },
      },
      credential({ restaurantId: HOUSE_A }),
    );

    const error = (answer as { error: { message: string } }).error;
    expect(error.message).toContain("belongs to another house");
    // And nothing was read on the way to refusing.
    expect(cellar.read).not.toHaveBeenCalled();
  });

  it("lists only this house's resources", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 7, method: "resources/list" },
      credential({ restaurantId: HOUSE_A }),
    );
    const uris = (answer as { result: { resources: { uri: string }[] } }).result.resources.map(
      (r) => r.uri,
    );
    expect(uris).toEqual([
      `mudavym://day-book/${HOUSE_A}`,
      `mudavym://cellar/${HOUSE_A}`,
    ]);
    expect(uris.join(" ")).not.toContain(HOUSE_B);
  });
});

describe("McpServerService — a write", () => {
  it("refuses every declared write, naming the seal and the human step", async () => {
    const { service } = build();

    for (const write of WRITE_TOOLS) {
      const answer = await service.handle(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: write.name, arguments: {} },
        },
        credential(),
      );

      // A refusal is a RESULT, not a JSON-RPC error: an error invites a retry
      // with different arguments, which is exactly the wrong lesson.
      expect(answer).toHaveProperty("result");
      expect(answer).not.toHaveProperty("error");

      const result = resultOf(answer);
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.value).toBeNull();

      const reason = String(result.structuredContent?.reason);
      expect(reason).toContain("a commitment needs a person's hold");
      expect(reason).toContain("ADR 0112/0113");
      expect(reason).toMatch(/Do this at \/\w/);
    }
  });

  it("refuses a read whose scope is not held, rather than pretending it does not exist", async () => {
    const inventoryList = jest.fn();
    const { service } = build({ inventoryList } as never);

    const answer = await service.handle(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "inventory.list", arguments: {} },
      },
      credential({ scopes: ["orders:read"] }),
    );
    const result = resultOf(answer);
    expect(result.isError).toBe(true);
    expect(String(result.structuredContent?.reason)).toContain(
      "does not hold the scope",
    );
    expect(String(result.structuredContent?.reason)).toContain("The tool exists");
    expect(inventoryList).not.toHaveBeenCalled();
  });
});

describe("McpServerService — prompts", () => {
  it("serves five prompts and none of them instructs a commit", async () => {
    const { service } = build();
    const answer = await service.handle(
      { jsonrpc: "2.0", id: 11, method: "prompts/list" },
      credential(),
    );
    const prompts = (answer as { result: { prompts: { name: string }[] } }).result
      .prompts;
    expect(prompts.map((p) => p.name)).toEqual([
      "close-the-week",
      "chase-the-short-delivery",
      "walk-the-cellar",
      "price-check-before-ordering",
      "what-changed-since-yesterday",
    ]);
  });

  it("returns a prompt's text, and refuses one it does not have", async () => {
    const { service } = build();
    const found = await service.handle(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "prompts/get",
        params: { name: "walk-the-cellar" },
      },
      credential(),
    );
    const messages = (found as {
      result: { messages: { content: { text: string } }[] };
    }).result.messages;
    expect(messages[0].content.text).toContain("inventory.low_stock");

    const missing = await service.handle(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "prompts/get",
        params: { name: "sell-the-cellar" },
      },
      credential(),
    );
    expect((missing as { error: { message: string } }).error.message).toContain(
      "No prompt named sell-the-cellar",
    );
  });
});
