import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Response } from "express";
import { McpCredentialAuthGuard } from "./mcp-credential-auth.guard";
import {
  McpCredentialsService,
  RATE_LIMIT_PER_MINUTE,
} from "./mcp-credentials.service";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpRequest,
  RPC_INVALID_REQUEST,
} from "./mcp-server.types";
import { McpServerService } from "./mcp-server.service";

/**
 * `POST /api/v1/mcp` — the Streamable HTTP endpoint an assistant speaks to.
 *
 * TRANSPORT
 * ---------
 * Streamable HTTP, revision `2025-06-18`, JSON responses only. The spec lets a
 * server answer either `application/json` or `text/event-stream`; this one
 * always answers JSON, because every method it implements is request/response
 * and it never initiates a message. `GET /mcp` therefore answers 405 with the
 * sentence that says so, rather than opening a stream that would carry nothing —
 * an open, permanently silent SSE connection is indistinguishable, from the
 * client's side, from a server that is thinking.
 *
 * There is no session store and no `Mcp-Session-Id`. The spec makes the header
 * optional for a stateless server, and this one is stateless in the strong
 * sense: the credential is the whole of the state, it is presented on every
 * request, and revoking it takes effect on the very next call rather than when
 * some session expires.
 *
 * `@ApiExcludeController` keeps it out of the browser-facing Swagger document:
 * its contract is the MCP specification, not our OpenAPI, and a JSON-RPC
 * envelope rendered as a REST operation would document neither.
 */
@ApiExcludeController()
@Controller("mcp")
@UseGuards(McpCredentialAuthGuard)
export class McpServerController {
  constructor(
    private readonly server: McpServerService,
    private readonly credentials: McpCredentialsService,
  ) {}

  @Post()
  @HttpCode(200)
  @Header("MCP-Protocol-Version", "2025-06-18")
  async rpc(
    @Req() request: McpRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const credential = request.mcpCredential;
    if (!credential) {
      // Unreachable while the guard is applied. Kept, and kept as a THROW
      // rather than a silent empty result, because the day someone removes the
      // guard this must stop the request instead of serving one house's rows
      // to a caller with no house.
      throw new Error(
        "MCP request reached the controller with no credential — the guard is not applied.",
      );
    }

    const gate = this.credentials.consume(credential.id);
    // Deliberately NOT `X-RateLimit-*`. The global `RateLimitGuard` has already
    // written that trio for its own IP-keyed budget, and overwriting only its
    // `Remaining` would leave a client reading one limiter's ceiling against
    // another limiter's remainder — two true numbers making one false sentence.
    response.setHeader("X-Mcp-RateLimit-Limit", String(RATE_LIMIT_PER_MINUTE));
    response.setHeader("X-Mcp-RateLimit-Remaining", String(gate.remaining));
    response.setHeader(
      "X-Mcp-RateLimit-Reset",
      String(Math.ceil(gate.resetAt / 1000)),
    );
    if (!gate.allowed) {
      response.status(429);
      await this.server.log({
        credentialId: credential.id,
        restaurantId: credential.restaurantId,
        method: methodOf(body) ?? "unknown",
        toolName: null,
        outcome: "rate_limited",
        detail: McpCredentialsService.describeLimiter(),
        durationMs: 0,
      });
      return {
        jsonrpc: "2.0",
        id: idOf(body),
        error: {
          code: RPC_INVALID_REQUEST,
          message: `Too many calls on this key. ${McpCredentialsService.describeLimiter()}`,
        },
      };
    }

    const messages = Array.isArray(body) ? body : [body];
    const responses: JsonRpcResponse[] = [];

    for (const raw of messages) {
      const message = raw as JsonRpcRequest | null;
      if (!message || typeof message !== "object" || typeof message.method !== "string") {
        responses.push({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: RPC_INVALID_REQUEST,
            message:
              "Not a JSON-RPC 2.0 message: an object with a string `method` is required.",
          },
        });
        continue;
      }

      const startedAt = Date.now();
      const answer = await this.server.handle(message, credential);
      const isToolCall = message.method === "tools/call";
      const toolName = isToolCall
        ? ((message.params?.name as string | undefined) ?? null)
        : null;

      await this.server.log({
        credentialId: credential.id,
        restaurantId: credential.restaurantId,
        method: message.method,
        toolName,
        // A tool that answered `isError` is a REFUSAL or an upstream fault, and
        // the log keeps them apart from a clean read. `error` is reserved for a
        // protocol-level failure, which is a different thing again.
        outcome: outcomeOf(answer),
        detail: detailOf(answer),
        durationMs: Date.now() - startedAt,
      });

      if (answer) responses.push(answer);
    }

    // Every message was a notification. The spec's answer is 202 with no body,
    // and returning `{}` instead would be a response to something that asked
    // for none.
    if (responses.length === 0) {
      response.status(202);
      await this.credentials.stampUse(credential.id);
      return undefined;
    }

    await this.credentials.stampUse(credential.id);
    return Array.isArray(body) ? responses : responses[0];
  }

  /**
   * The spec permits a client to open a GET stream for server-initiated
   * messages. This server initiates none, so it says so with the status the
   * spec names for exactly that case rather than holding a silent connection
   * open — and 405 is the answer even though the guard has already
   * authenticated, because "you are allowed, and there is nothing here" is the
   * true statement.
   */
  @Get()
  @HttpCode(405)
  stream(): { error: string } {
    return {
      error:
        "This server never initiates a message, so there is no stream to open. Send JSON-RPC requests with POST; every response comes back on the POST.",
    };
  }
}

function methodOf(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  const method = (first as { method?: unknown } | null)?.method;
  return typeof method === "string" ? method : null;
}

function idOf(body: unknown): string | number | null {
  const first = Array.isArray(body) ? body[0] : body;
  const id = (first as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function outcomeOf(
  answer: JsonRpcResponse | null,
): "ok" | "refused" | "error" {
  if (!answer) return "ok";
  if ("error" in answer) return "error";
  const result = (answer as { result?: { isError?: boolean } }).result;
  return result?.isError ? "refused" : "ok";
}

function detailOf(answer: JsonRpcResponse | null): string | null {
  if (!answer) return null;
  if ("error" in answer) return answer.error.message;
  const result = (answer as {
    result?: { isError?: boolean; structuredContent?: { reason?: string } };
  }).result;
  if (result?.isError) return result.structuredContent?.reason ?? "refused";
  return null;
}
