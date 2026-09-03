import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { checkEndpoint } from "./mcp-endpoint.guard";
import type {
  McpProbeLimits,
  McpProbeOutcome,
  McpToolSummary,
} from "./mcp-runtime.types";

/**
 * The Model Context Protocol, spoken over Streamable HTTP, for exactly one
 * purpose: finding out whether a server a house declared is real, and what it
 * says it can do.
 *
 * WHAT IT SPEAKS, AND WHERE THAT COMES FROM
 * -----------------------------------------
 * modelcontextprotocol.io, revision 2025-06-18, "Basic / Transports" and
 * "Basic / Lifecycle". The sequence is fixed by the spec and this file follows
 * it exactly:
 *
 *   1. POST `initialize` — `Accept: application/json, text/event-stream` is
 *      MUST, both response shapes MUST be handled, and the server MAY return an
 *      `Mcp-Session-Id` header that the client MUST then echo on every later
 *      request.
 *   2. POST `notifications/initialized` — MUST follow a successful initialize.
 *      The server MUST answer 202 with no body (any 2xx is accepted here; the
 *      distinction between 200 and 202 is not one the house cares about).
 *   3. POST `tools/list` — only when the InitializeResult declared a `tools`
 *      capability. The spec says both parties MUST only use capabilities that
 *      were negotiated, so a server with no `tools` capability is recorded as
 *      answering with no tools rather than being asked a question it did not
 *      offer to take.
 *
 * `MCP-Protocol-Version` is sent on every request after initialize, carrying the
 * version the SERVER negotiated to rather than the one we asked for — the spec
 * makes that the client's obligation, and a server that answers `2024-11-05`
 * must not then be told `2025-06-18`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * `tools/call`. Not "not yet implemented" — not present. A tool call can send an
 * email, place an order, or otherwise bind the restaurant, which is the exact
 * subject of ADR 0013's commitment guardrail; that decision comes before the
 * code, so there is no invocation method on this service to accidentally wire a
 * button to. `tools/list` is a read and the runtime stops there.
 *
 * It also does not open the GET stream (server-initiated messages), send
 * `DELETE` to end the session, or fall back to the deprecated 2024-11-05
 * HTTP+SSE transport. A probe is a single round trip that answers one question;
 * every one of those belongs to a long-lived client this product does not have.
 *
 * EVERY FAILURE IS A CLASSIFIED OUTCOME, NEVER AN EXCEPTION
 * --------------------------------------------------------
 * `probe()` does not throw. A dead host, a 500, a redirect and a body of
 * malformed JSON are four different sentences on the register row, and turning
 * them into one 500 from the gateway would collapse them back into "something
 * went wrong" — the shape this repo files as absence-reported-as-health. The
 * caller writes `status` and `detail` straight onto the connection.
 */
@Injectable()
export class McpRuntimeService {
  /** The revision this client implements. Sent on `initialize`. */
  static readonly PROTOCOL_VERSION = "2025-06-18";

  /** Who we say we are. The spec requires name and version. */
  static readonly CLIENT_INFO = {
    name: "mudavym",
    title: "Mudavym",
    version: "0.1.0",
  } as const;

  static readonly DEFAULTS: McpProbeLimits = {
    /** The whole probe, not one request: three round trips share this budget. */
    timeoutMs: 8000,
    /** 256 KiB. A tools/list of a hundred tools is a few tens of KiB. */
    maxBytes: 256 * 1024,
    /** Rows show names; a server with more than this is truncated and says so. */
    maxTools: 100,
    allowPrivateEndpoints: false,
  };

  private readonly logger = new Logger(McpRuntimeService.name);

  constructor(private readonly configService: ConfigService) {}

  get limits(): McpProbeLimits {
    const num = (key: string, fallback: number): number => {
      const raw = this.configService.get<string | number>(key);
      const value = typeof raw === "string" ? Number(raw) : raw;
      return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : fallback;
    };
    return {
      timeoutMs: num("MCP_PROBE_TIMEOUT_MS", McpRuntimeService.DEFAULTS.timeoutMs),
      maxBytes: num("MCP_PROBE_MAX_BYTES", McpRuntimeService.DEFAULTS.maxBytes),
      maxTools: num("MCP_PROBE_MAX_TOOLS", McpRuntimeService.DEFAULTS.maxTools),
      allowPrivateEndpoints:
        String(
          this.configService.get<string>("MCP_ALLOW_PRIVATE_ENDPOINTS") ?? "",
        ).toLowerCase() === "true",
    };
  }

  /* ── the probe ──────────────────────────────────────────────────────── */

  /**
   * Shake hands with one server and list its tools.
   *
   * @param url    the endpoint exactly as the house declared it
   * @param secret the decrypted per-connection credential, or null for none
   */
  async probe(url: string, secret: string | null): Promise<McpProbeOutcome> {
    const limits = this.limits;
    const calledAt = new Date().toISOString();
    const base = {
      calledAt,
      answeredAt: null,
      serverName: null,
      serverVersion: null,
      protocolVersion: null,
      tools: null,
      toolCount: null,
      truncated: false,
    } as const;

    const endpoint = await checkEndpoint(url, limits.allowPrivateEndpoints);
    if (!endpoint.ok) {
      return {
        ...base,
        status: "refused",
        detail: `This gateway did not call the endpoint: ${endpoint.reason}`,
      };
    }

    const deadline = Date.now() + limits.timeoutMs;

    /* 1. initialize ------------------------------------------------------ */

    const init = await this.rpc(url, deadline, limits, {
      secret,
      sessionId: null,
      protocolVersion: null,
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: McpRuntimeService.PROTOCOL_VERSION,
          // Empty and honest: this client offers no roots, no sampling and no
          // elicitation, because it makes exactly one read and then stops.
          capabilities: {},
          clientInfo: McpRuntimeService.CLIENT_INFO,
        },
      },
      expectId: 1,
    });

    if (init.kind !== "result") {
      return { ...base, status: init.status, detail: init.detail };
    }

    const result = asRecord(init.result);
    const serverInfo = asRecord(result?.serverInfo);
    const capabilities = asRecord(result?.capabilities);
    const negotiated = asString(result?.protocolVersion);

    if (!negotiated) {
      return {
        ...base,
        status: "protocol_error",
        detail:
          "The endpoint answered, but its initialize result carried no protocolVersion, so it is not speaking this protocol.",
      };
    }

    const answered = {
      answeredAt: new Date().toISOString(),
      serverName: asString(serverInfo?.name),
      serverVersion: asString(serverInfo?.version),
      protocolVersion: negotiated,
    };

    /* 2. notifications/initialized --------------------------------------- */

    const ack = await this.notify(url, deadline, limits, {
      secret,
      sessionId: init.sessionId,
      protocolVersion: negotiated,
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    });

    if (ack.kind !== "accepted") {
      return {
        ...base,
        ...answered,
        status: ack.status,
        detail: `The handshake began but the server would not take the initialized notification: ${ack.detail}`,
      };
    }

    /* 3. tools/list ------------------------------------------------------ */

    // Only capabilities that were negotiated may be used. A server with no
    // `tools` capability is recorded as having none, not asked anyway.
    if (!capabilities || capabilities.tools === undefined) {
      return {
        ...base,
        ...answered,
        status: "ok",
        tools: [],
        toolCount: 0,
        detail:
          "Connected. The server declares no tools capability, so it was not asked for a tool list — that is its answer, not a failed read.",
      };
    }

    const listed = await this.rpc(url, deadline, limits, {
      secret,
      sessionId: init.sessionId,
      protocolVersion: negotiated,
      body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      expectId: 2,
    });

    if (listed.kind !== "result") {
      return {
        ...base,
        ...answered,
        status: listed.status,
        detail: `The handshake succeeded and the tool list did not: ${listed.detail}`,
      };
    }

    const listResult = asRecord(listed.result);
    const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : null;
    if (rawTools === null) {
      return {
        ...base,
        ...answered,
        status: "protocol_error",
        detail:
          "The server answered tools/list without a `tools` array, so what it offers could not be read.",
      };
    }

    const summaries = rawTools
      .map(toSummary)
      .filter((t): t is McpToolSummary => t !== null);
    const truncated = summaries.length > limits.maxTools;
    const kept = truncated ? summaries.slice(0, limits.maxTools) : summaries;

    const more = asString(listResult?.nextCursor)
      ? " The server offers further pages of tools; only the first was read."
      : "";

    return {
      ...answered,
      calledAt,
      status: "ok",
      tools: kept,
      // What the server SAID, which may exceed what was kept.
      toolCount: summaries.length,
      truncated: truncated || Boolean(asString(listResult?.nextCursor)),
      detail:
        summaries.length === 0
          ? `Connected. ${answered.serverName ?? "The server"} answered the handshake and lists no tools.${more}`
          : `Connected. ${summaries.length} tool${summaries.length === 1 ? "" : "s"} listed${truncated ? `, ${kept.length} kept` : ""}.${more}`,
    };
  }

  /* ── one JSON-RPC round trip ────────────────────────────────────────── */

  private headers(opts: {
    secret: string | null;
    sessionId: string | null;
    protocolVersion: string | null;
  }): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      // MUST list both. A server may answer either way and the client must cope.
      accept: "application/json, text/event-stream",
      "user-agent": `${McpRuntimeService.CLIENT_INFO.name}/${McpRuntimeService.CLIENT_INFO.version}`,
    };
    if (opts.protocolVersion) {
      h["mcp-protocol-version"] = opts.protocolVersion;
    }
    if (opts.sessionId) h["mcp-session-id"] = opts.sessionId;
    if (opts.secret) h.authorization = `Bearer ${opts.secret}`;
    return h;
  }

  private async send(
    url: string,
    deadline: number,
    opts: {
      secret: string | null;
      sessionId: string | null;
      protocolVersion: string | null;
      body: unknown;
    },
  ): Promise<
    | { ok: true; response: Response; controller: AbortController }
    | { ok: false; status: "unreachable" | "protocol_error"; detail: string }
  > {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        ok: false,
        status: "unreachable",
        detail: "the probe ran out of time before this request could be made.",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(opts),
        body: JSON.stringify(opts.body),
        signal: controller.signal,
        // A redirect can move the request — and its Authorization header — to a
        // host the endpoint check never vetted. Refused, and named.
        redirect: "manual",
      });
      return { ok: true, response, controller };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string }; code?: string };
      if (e.name === "AbortError" || e.name === "TimeoutError") {
        return {
          ok: false,
          status: "unreachable",
          detail: `nothing answered within the ${remaining}ms left of the probe's time budget.`,
        };
      }
      const code = e.cause?.code ?? e.code;
      return {
        ok: false,
        status: "unreachable",
        detail: `the request did not complete (${code ?? e.message}).`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** A notification: no id, no result, 2xx and nothing else. */
  private async notify(
    url: string,
    deadline: number,
    limits: McpProbeLimits,
    opts: {
      secret: string | null;
      sessionId: string | null;
      protocolVersion: string | null;
      body: unknown;
    },
  ): Promise<
    | { kind: "accepted" }
    | { kind: "failed"; status: "unreachable" | "refused" | "protocol_error"; detail: string }
  > {
    const sent = await this.send(url, deadline, opts);
    if (!sent.ok) return { kind: "failed", status: sent.status, detail: sent.detail };

    const { response } = sent;
    // Drain under the cap so the socket can be reused and nothing is left open.
    await readCapped(response, limits.maxBytes).catch(() => undefined);

    if (response.status >= 300 && response.status < 400) {
      return {
        kind: "failed",
        status: "protocol_error",
        detail: `it redirected (HTTP ${response.status}); declare the final URL instead, so the credential is never sent somewhere this gateway did not check.`,
      };
    }
    if (!response.ok) {
      return {
        kind: "failed",
        status: "refused",
        detail: `HTTP ${response.status}${describeStatus(response.status)}`,
      };
    }
    return { kind: "accepted" };
  }

  /** A request: an id goes out, a result or an error comes back. */
  private async rpc(
    url: string,
    deadline: number,
    limits: McpProbeLimits,
    opts: {
      secret: string | null;
      sessionId: string | null;
      protocolVersion: string | null;
      body: unknown;
      expectId: number;
    },
  ): Promise<
    | { kind: "result"; result: unknown; sessionId: string | null }
    | {
        kind: "failed";
        status: "unreachable" | "refused" | "protocol_error";
        detail: string;
      }
  > {
    const sent = await this.send(url, deadline, opts);
    if (!sent.ok) return { kind: "failed", status: sent.status, detail: sent.detail };

    const { response } = sent;
    const sessionId = response.headers.get("mcp-session-id");

    if (response.status >= 300 && response.status < 400) {
      await readCapped(response, limits.maxBytes).catch(() => undefined);
      return {
        kind: "failed",
        status: "protocol_error",
        detail: `it redirected (HTTP ${response.status} to ${response.headers.get("location") ?? "an unnamed location"}); declare the final URL, so the credential is never sent somewhere this gateway did not check.`,
      };
    }

    let body: { text: string; overflow: boolean };
    try {
      body = await readCapped(response, limits.maxBytes);
    } catch (err) {
      return {
        kind: "failed",
        status: "unreachable",
        detail: `the answer stopped mid-body (${(err as Error).message}).`,
      };
    }

    if (body.overflow) {
      return {
        kind: "failed",
        status: "protocol_error",
        detail: `the answer was larger than the ${limits.maxBytes}-byte limit this gateway reads, so it was cut off unread rather than held in memory.`,
      };
    }

    if (!response.ok) {
      // A 4xx/5xx MAY still carry a JSON-RPC error object; prefer the server's
      // own words over our status line when it does.
      const said = firstMessage(body.text, response.headers.get("content-type"));
      const rpcError = asRecord(asRecord(said)?.error);
      const message = rpcError ? asString(rpcError.message) : null;
      return {
        kind: "failed",
        status: "refused",
        detail: message
          ? `HTTP ${response.status} — ${message}`
          : `HTTP ${response.status}${describeStatus(response.status)}`,
      };
    }

    const message = firstMessage(
      body.text,
      response.headers.get("content-type"),
      opts.expectId,
    );
    if (!message) {
      return {
        kind: "failed",
        status: "protocol_error",
        detail:
          "the answer carried no JSON-RPC message for the request that was sent, so this endpoint is answering something other than MCP.",
      };
    }

    const record = asRecord(message);
    const err = asRecord(record?.error);
    if (err) {
      const code = typeof err.code === "number" ? ` (${err.code})` : "";
      return {
        kind: "failed",
        status: "refused",
        detail: `the server answered with an error${code}: ${asString(err.message) ?? "no message"}.`,
      };
    }

    if (record?.result === undefined) {
      return {
        kind: "failed",
        status: "protocol_error",
        detail: "the answer had neither a result nor an error.",
      };
    }

    return { kind: "result", result: record.result, sessionId };
  }
}

/* ── wire helpers ──────────────────────────────────────────────────────── */

function describeStatus(status: number): string {
  if (status === 401) return " — the server did not accept the credential.";
  if (status === 403) return " — the server refused this client.";
  if (status === 404) return " — there is no MCP endpoint at that path.";
  if (status === 405) return " — that path does not take a POST, so it is not a Streamable HTTP endpoint.";
  return ".";
}

/**
 * Read a body with a hard byte ceiling.
 *
 * `response.text()` would buffer whatever the server sends, which is the whole
 * point of having a cap. This reads chunk by chunk, stops the moment the count
 * is exceeded, and cancels the stream so nothing keeps arriving.
 */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; overflow: boolean }> {
  const body = response.body;
  if (!body) return { text: "", overflow: false };

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { text: "", overflow: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), overflow: false };
}

/**
 * Pull the JSON-RPC message out of a body that may be plain JSON or an SSE
 * stream, because the spec lets the server choose and the client MUST cope
 * with both.
 *
 * When `expectId` is given, only a message carrying that id is returned — an
 * SSE stream may legitimately carry server-initiated requests and notifications
 * ahead of the response, and treating the first frame as the answer would read
 * a log line as a tool list.
 */
export function firstMessage(
  text: string,
  contentType: string | null,
  expectId?: number,
): unknown | null {
  const isSse = (contentType ?? "").toLowerCase().includes("text/event-stream");

  const consider = (raw: string): unknown | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    // A server MAY batch. Take the member that answers our id.
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      const record = asRecord(candidate);
      if (!record) continue;
      if (expectId === undefined) return record;
      if (record.id === expectId) return record;
    }
    return null;
  };

  if (!isSse) return consider(text.trim());

  for (const frame of text.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    const found = consider(data);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * One tool, reduced to what a row shows. `inputSchema` is dropped on purpose —
 * see the service header: it is only useful to a caller that can invoke, and
 * nothing invokes.
 */
function toSummary(value: unknown): McpToolSummary | null {
  const record = asRecord(value);
  const name = record ? asString(record.name) : null;
  if (!name) return null;
  return {
    name,
    title: asString(record?.title),
    description: asString(record?.description),
  };
}
