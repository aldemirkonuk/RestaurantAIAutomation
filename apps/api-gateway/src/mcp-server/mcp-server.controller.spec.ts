import { Response } from "express";
import { McpCredentialsService } from "./mcp-credentials.service";
import { McpServerController } from "./mcp-server.controller";
import { McpServerService } from "./mcp-server.service";
import { McpRequest } from "./mcp-server.types";

/**
 * The transport contract, tested where it is actually decided.
 *
 * Three of these assert a STATUS rather than a body, and that is the point: a
 * 200 with an empty object where the spec says 202-with-no-body is a response
 * to a message that asked for none, and a client written to the spec has to
 * guess what it means.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";

function res() {
  const headers: Record<string, string> = {};
  const state = { status: 200 };
  const response = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status: (code: number) => {
      state.status = code;
      return response;
    },
  } as unknown as Response;
  return { response, headers, state };
}

function build(opts: { allowed?: boolean } = {}) {
  const server = {
    handle: jest.fn(),
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as McpServerService;
  const credentials = {
    consume: jest.fn().mockReturnValue({
      allowed: opts.allowed ?? true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
    }),
    stampUse: jest.fn().mockResolvedValue(undefined),
  } as unknown as McpCredentialsService;
  const controller = new McpServerController(server, credentials);
  const request = {
    headers: {},
    mcpCredential: {
      id: "cred-1",
      restaurantId: HOUSE,
      label: "Assistant",
      scopes: ["inventory:read"],
    },
  } as McpRequest;
  return { controller, server, credentials, request };
}

describe("McpServerController — the transport", () => {
  it("answers a notification-only POST with 202 and no body", async () => {
    const { controller, server, request } = build();
    (server.handle as jest.Mock).mockResolvedValue(null);
    const { response, state } = res();

    const body = await controller.rpc(
      request,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      response,
    );

    expect(state.status).toBe(202);
    expect(body).toBeUndefined();
  });

  it("answers a single request with a single object, and a batch with an array", async () => {
    const { controller, server, request } = build();
    (server.handle as jest.Mock).mockImplementation(async (m) => ({
      jsonrpc: "2.0",
      id: m.id,
      result: {},
    }));

    const single = await controller.rpc(
      request,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      res().response,
    );
    expect(Array.isArray(single)).toBe(false);

    const batch = await controller.rpc(
      request,
      [
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 2, method: "prompts/list" },
      ],
      res().response,
    );
    expect(Array.isArray(batch)).toBe(true);
    expect((batch as unknown[]).length).toBe(2);
  });

  it("429s past the per-credential window and says which limit was hit", async () => {
    const { controller, request } = build({ allowed: false });
    const { response, state } = res();

    const body = (await controller.rpc(
      request,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      response,
    )) as { error: { message: string } };

    expect(state.status).toBe(429);
    expect(body.error.message).toContain("Too many calls on this key");
    expect(body.error.message).toContain("per credential");
  });

  it("stamps last_used_at only on a request that actually ran", async () => {
    const { controller, credentials, request } = build({ allowed: false });
    await controller.rpc(
      request,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      res().response,
    );
    // Rate-limited: nothing was read, so nothing may claim a use.
    expect(credentials.stampUse).not.toHaveBeenCalled();
  });

  it("logs a refusal as `refused`, not as `ok` and not as `error`", async () => {
    const { controller, server, request } = build();
    (server.handle as jest.Mock).mockResolvedValue({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        structuredContent: { value: null, reason: "a commitment needs a person's hold" },
      },
    });

    await controller.rpc(
      request,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "orders.draft", arguments: {} },
      },
      res().response,
    );

    expect(server.log).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "tools/call",
        toolName: "orders.draft",
        outcome: "refused",
        detail: "a commitment needs a person's hold",
      }),
    );
  });

  it("rejects a body that is not a JSON-RPC message instead of guessing", async () => {
    const { controller, request } = build();
    const body = (await controller.rpc(request, { hello: "world" }, res().response)) as {
      error: { code: number; message: string };
    };
    expect(body.error.code).toBe(-32600);
    expect(body.error.message).toContain("string `method`");
  });

  it("says there is no stream rather than holding a silent one open", () => {
    const { controller } = build();
    expect(controller.stream().error).toContain("never initiates a message");
  });

  it("throws rather than serving anything if the guard is ever removed", async () => {
    const { controller } = build();
    await expect(
      controller.rpc(
        { headers: {} } as McpRequest,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        res().response,
      ),
    ).rejects.toThrow("the guard is not applied");
  });
});
