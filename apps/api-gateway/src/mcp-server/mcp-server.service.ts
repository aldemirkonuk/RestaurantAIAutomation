import { Injectable, Logger } from "@nestjs/common";
import { CellarRegistersService } from "../cellar/cellar-registers.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpCredentialsService } from "./mcp-credentials.service";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpCredential,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  ToolPayload,
} from "./mcp-server.types";
import { McpToolReadersService } from "./mcp-tool-readers.service";
import { findTool, visibleTools } from "./tool-catalog";

export const SERVER_NAME = "mudavym";
export const SERVER_TITLE = "Mudavym — the house's day-book";

/**
 * The dispatcher: one JSON-RPC message in, one response out.
 *
 * ---------------------------------------------------------------------------
 * THE PROTOCOL REVISION IS BORROWED, NOT RESTATED
 * ---------------------------------------------------------------------------
 * `McpRuntimeService.PROTOCOL_VERSION` is the client half's pin. This server
 * answers with the same constant, so the two halves inside one process cannot
 * end up speaking different revisions of one spec. That is the ADR 0013 rule
 * (one canon, never a copy) applied to a version string.
 *
 * ---------------------------------------------------------------------------
 * WHAT A REFUSAL IS
 * ---------------------------------------------------------------------------
 * §7a of the capability note: "a refusal is a result, not an error". Every
 * write tool below therefore returns `isError: true` inside a NORMAL `result`
 * envelope — the spec's own channel for "the tool ran and declined" — and never
 * a JSON-RPC `error`, which would tell a client the call was malformed and
 * invite a retry with different arguments. A protocol error is for a protocol
 * fault; a refusal is an answer.
 */
@Injectable()
export class McpServerService {
  private readonly logger = new Logger(McpServerService.name);

  constructor(
    private readonly readers: McpToolReadersService,
    private readonly credentials: McpCredentialsService,
    private readonly cellar: CellarRegistersService,
  ) {}

  static protocolVersion(): string {
    return McpRuntimeService.PROTOCOL_VERSION;
  }

  private ok(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private fail(
    id: string | number | null,
    code: number,
    message: string,
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }

  /** A tool result: text content plus the structured payload beside it. */
  private toolResult(payload: ToolPayload, isError = false): unknown {
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError,
    };
  }

  /**
   * Handle one request.
   *
   * Returns `null` for a notification (a message with no `id`), which the
   * transport turns into a 202 with no body — the spec's requirement, and the
   * reason `notifications/initialized` does not fall through to
   * "method not found".
   */
  async handle(
    message: JsonRpcRequest,
    credential: McpCredential,
  ): Promise<JsonRpcResponse | null> {
    const id = message.id ?? null;
    const isNotification = message.id === undefined || message.id === null;
    const params = message.params ?? {};

    switch (message.method) {
      case "initialize":
        return this.ok(id, {
          protocolVersion: McpServerService.protocolVersion(),
          capabilities: {
            // Only what is actually served. A `tools: { listChanged: true }`
            // here would promise a notification this server never sends, and a
            // capability nobody implements is a lie the client plans around.
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: SERVER_NAME,
            title: SERVER_TITLE,
            version: process.env.npm_package_version ?? "0.1.0",
          },
          instructions:
            "This is one restaurant's own operating record, offered read-only. " +
            "It reads freely and it commits nothing: the write tools are listed so you " +
            "can see what exists, and every one of them refuses and names the step a " +
            "person must take in Mudavym. Figures carry the row count they summed and " +
            "the time they were read; an unknown comes back as null with a reason, " +
            "never as a zero or an empty list.",
        });

      // Notifications. Acknowledged by returning null, which the transport
      // answers with 202 and no body.
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return isNotification ? null : this.ok(id, {});

      case "tools/list":
        return this.ok(id, {
          tools: visibleTools(credential.scopes).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        });

      case "tools/call":
        return this.callTool(id, params, credential);

      case "resources/list":
        return this.ok(id, {
          resources: this.resources(credential),
        });

      case "resources/read":
        return this.readResource(id, params, credential);

      case "prompts/list":
        return this.ok(id, { prompts: PROMPTS });

      case "prompts/get":
        return this.getPrompt(id, params);

      default:
        return this.fail(
          id,
          RPC_METHOD_NOT_FOUND,
          `This server does not implement ${message.method}. It serves initialize, tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get and ping.`,
        );
    }
  }

  private async callTool(
    id: string | number | null,
    params: Record<string, unknown>,
    credential: McpCredential,
  ): Promise<JsonRpcResponse> {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments as Record<string, unknown>) ?? {};
    const tool = findTool(name);

    if (!tool) {
      return this.fail(
        id,
        RPC_INVALID_PARAMS,
        `No tool named ${name || "(unnamed)"}. Call tools/list for what this key may use.`,
      );
    }

    // A WRITE. Refused as a result, with the sentence naming the seal.
    if (tool.refusal) {
      return this.ok(
        id,
        this.toolResult(
          {
            value: null,
            reason: tool.refusal,
            provenance: {
              readAt: new Date().toISOString(),
              rows: 0,
              source: "mcp-server/tool-catalog.ts — declared, refused",
            },
          },
          true,
        ),
      );
    }

    // A READ whose scope this key does not hold. It was already hidden from
    // tools/list; a direct call is still answered honestly rather than with a
    // "no such tool", which would let a client conclude the capability is
    // absent from the product.
    if (tool.scope && !credential.scopes.includes(tool.scope)) {
      return this.ok(
        id,
        this.toolResult(
          {
            value: null,
            reason: `This key does not hold the scope \`${tool.scope}\`, so it cannot read that. The tool exists; this key was not granted it. Scopes are set when the key is minted on /connections.`,
            provenance: {
              readAt: new Date().toISOString(),
              rows: 0,
              source: "mcp-server/tool-catalog.ts — scope not held",
            },
          },
          true,
        ),
      );
    }

    const house = credential.restaurantId;
    try {
      const payload = await this.dispatchRead(tool.name, house, args);
      return this.ok(id, this.toolResult(payload));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`MCP tool ${tool.name} failed: ${detail}`);
      // The underlying route is down or erroring. §7a: "a tool over a route
      // that 503s says so". This is a RESULT with isError, not an empty answer.
      return this.ok(
        id,
        this.toolResult(
          {
            value: null,
            reason: `The read behind ${tool.name} did not answer: ${detail}. This is a fault, not an absence — do not read it as "there is none".`,
            provenance: {
              readAt: new Date().toISOString(),
              rows: 0,
              source: `${tool.name} — upstream read failed`,
            },
          },
          true,
        ),
      );
    }
  }

  /** The ten reads. A `default` that throws, so a new catalogue row cannot silently answer nothing. */
  private async dispatchRead(
    name: string,
    house: string,
    args: Record<string, unknown>,
  ): Promise<ToolPayload> {
    switch (name) {
      case "inventory.list":
        return this.readers.inventoryList(house);
      case "inventory.low_stock":
        return this.readers.inventoryLowStock(house);
      case "orders.list":
        return this.readers.ordersList(house, {
          status: asString(args.status),
          limit: asNumber(args.limit),
        });
      case "orders.get": {
        const orderId = asString(args.orderId);
        if (!orderId) {
          return {
            value: null,
            reason: "orders.get needs an orderId.",
            provenance: {
              readAt: new Date().toISOString(),
              rows: 0,
              source: "orders.get — missing argument",
            },
          };
        }
        return this.readers.ordersGet(house, orderId);
      }
      case "vendors.search":
        return this.readers.vendorsSearch(house, {
          query: asString(args.query),
          limit: asNumber(args.limit),
        });
      case "prices.compare": {
        const masterWineId = asString(args.masterWineId);
        if (!masterWineId) {
          return {
            value: null,
            reason: "prices.compare needs a masterWineId.",
            provenance: {
              readAt: new Date().toISOString(),
              rows: 0,
              source: "prices.compare — missing argument",
            },
          };
        }
        return this.readers.pricesCompare(house, {
          masterWineId,
          windowDays: asNumber(args.windowDays),
        });
      }
      case "insights.list":
        return this.readers.insights(house, {
          limit: asNumber(args.limit),
          categories: Array.isArray(args.categories)
            ? args.categories.filter((c): c is string => typeof c === "string")
            : undefined,
        });
      case "analytics.financial":
        return this.readers.financial(house, { labor: asNumber(args.labor) });
      case "logs.timeline":
        return this.readers.timelineRead(house, {
          limit: asNumber(args.limit),
          correlationId: asString(args.correlationId),
        });
      case "health.live":
        return this.readers.health();
      default:
        throw new Error(
          `${name} is declared in the catalogue and has no implementation. That is a build fault, not an empty answer.`,
        );
    }
  }

  /**
   * The resources served.
   *
   * §7c names five. Two are served and three are not, and the reasons are
   * recorded here rather than left as an unexplained short list:
   *   - `mudavym://reports/{id}` — needs the reports module; not in this build's
   *     ten, and a resource whose tool is absent is a half-surface.
   *   - `mudavym://vault/pages/{slug}` and `.../softwares/{slug}` — those files
   *     live in `.planning/`, which the gateway's Dockerfile does not copy
   *     (`apps/api-gateway/Dockerfile:39` takes `dist` only). Serving them would
   *     work locally and 404 in production, which is worse than not serving them.
   *
   * `{date}` is dropped from the day-book URI on purpose: `getTimeline` has no
   * date filter, and a URI that accepts a date it cannot honour would answer
   * every date with the same rows.
   */
  private resources(credential: McpCredential): unknown[] {
    return [
      {
        uri: `mudavym://day-book/${credential.restaurantId}`,
        name: "The day-book",
        title: "Today's movements, deliveries and decisions",
        description:
          "The correlated activity timeline for this house. Not filterable by date in this build — the underlying reader takes no date, and a URI that accepted one would answer every date alike.",
        mimeType: "application/json",
      },
      {
        uri: `mudavym://cellar/${credential.restaurantId}`,
        name: "The cellar book",
        title: "The house's cellar registers",
        description:
          "The registers this house keeps and what each one is answering from. Each register names its own source status, so an empty register is distinguishable from an unread one.",
        mimeType: "application/json",
      },
    ];
  }

  private async readResource(
    id: string | number | null,
    params: Record<string, unknown>,
    credential: McpCredential,
  ): Promise<JsonRpcResponse> {
    const uri = asString(params.uri) ?? "";
    const house = credential.restaurantId;

    // The house in the URI must be this key's house. A resource URI is a
    // client-supplied string like any tool argument, and reading the id out of
    // it would be the tenancy hole the tools deliberately avoid.
    const dayBook = `mudavym://day-book/${house}`;
    const cellarBook = `mudavym://cellar/${house}`;

    if (uri !== dayBook && uri !== cellarBook) {
      if (uri.startsWith("mudavym://day-book/") || uri.startsWith("mudavym://cellar/")) {
        return this.fail(
          id,
          RPC_INVALID_PARAMS,
          "That resource belongs to another house. This key reads one house's record and the id in the URI is not trusted — call resources/list for the URIs this key may read.",
        );
      }
      return this.fail(
        id,
        RPC_INVALID_PARAMS,
        `No resource at ${uri || "(no uri)"}. Call resources/list.`,
      );
    }

    try {
      const body =
        uri === dayBook
          ? await this.readers.timelineRead(house, { limit: 100 })
          : {
              value: await this.cellar.read(house),
              provenance: {
                readAt: new Date().toISOString(),
                rows: 1,
                source: "CellarRegistersService.read",
              },
            };
      return this.ok(id, {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(body, null, 2),
          },
        ],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.fail(
        id,
        RPC_INTERNAL_ERROR,
        `The read behind ${uri} did not answer: ${detail}. This is a fault, not an empty document.`,
      );
    }
  }

  private getPrompt(
    id: string | number | null,
    params: Record<string, unknown>,
  ): JsonRpcResponse {
    const name = asString(params.name) ?? "";
    const prompt = PROMPTS.find((p) => p.name === name);
    if (!prompt) {
      return this.fail(
        id,
        RPC_INVALID_PARAMS,
        `No prompt named ${name || "(unnamed)"}. Call prompts/list.`,
      );
    }
    return this.ok(id, {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: { type: "text", text: prompt.text },
        },
      ],
    });
  }

  /** Convenience for the transport: log a call without reaching past this service. */
  async log(entry: {
    credentialId: string | null;
    restaurantId: string | null;
    method: string;
    toolName: string | null;
    outcome: "ok" | "refused" | "error" | "unauthorized" | "rate_limited";
    detail: string | null;
    durationMs: number | null;
  }): Promise<void> {
    // `askedBy` is null and is passed explicitly rather than omitted: MCP
    // presents a key, not a person, and the day a client carries an end-user
    // identity this is the one line that changes.
    await this.credentials.logCall({ ...entry, askedBy: null });
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The five prompts of §7c.
 *
 * Every one of them is written to end in a READ. `chase-the-short-delivery`
 * says "draft" in the note; here it stops at finding the discrepancy and hands
 * the draft to a person, because `reply.draft` refuses in this build and a
 * prompt that instructs an assistant to call a refusing tool wastes its turn
 * and teaches it the wrong shape of this server.
 */
export const PROMPTS = [
  {
    name: "close-the-week",
    title: "Close the week",
    description:
      "Read the week's stock, orders, insights and day-book, and write a close. Drafts nothing.",
    text:
      "Close this week for the house. Read inventory.list and inventory.low_stock for where stock stands, orders.list for what was ordered and what arrived, insights.list for what the engine found, and logs.timeline for what actually happened. Write a short close naming what moved, what is short, and what needs a decision. Do not draft or send anything: every figure you cite must name the row count and read time it came with, and any null you meet is an absence to report, never a zero to sum.",
  },
  {
    name: "chase-the-short-delivery",
    title: "Chase a short delivery",
    description:
      "Find the order whose delivery is short of its lines and lay out the chase for a person to send.",
    text:
      "Find any order whose delivery came up short. Use orders.list to find recently delivered orders and orders.get to compare each order's lines against what was received. For the one that is short, lay out exactly what was ordered, what arrived, and the gap. Then stop and tell the user to draft the reply on /communications — reply.draft refuses here, because the text of a vendor reply can form a contract and needs a person's hold.",
  },
  {
    name: "walk-the-cellar",
    title: "Walk the cellar",
    description: "Low-stock lines against the cellar book, ordered by what runs out first.",
    text:
      "Walk the cellar. Read inventory.low_stock, then the mudavym://cellar resource for how the house keeps its registers. Order what is short by what will run out first and say what each one is used for. If low_stock returns nothing, say that the read completed and nothing is short — do not report it as 'no data'.",
  },
  {
    name: "price-check-before-ordering",
    title: "Price-check before ordering",
    description: "Compare held vendor prices for a wine before a human approves an order.",
    text:
      "Before anyone approves an order, price-check it. For each wine in question call prices.compare and report what this house holds across vendors, with the read time. Where prices.compare returns null, say that no observation exists in the window — that is an absence, not a price of zero, and it must not be averaged in. Recommend, do not order: orders.draft refuses here.",
  },
  {
    name: "what-changed-since-yesterday",
    title: "What changed since yesterday",
    description: "The day-book plus what is newly short.",
    text:
      "Say what changed. Read logs.timeline for the recent record and inventory.low_stock for what is newly short. If the timeline's completeness field says FLOOR, say so plainly at the top: some sources did not answer and the list is what could be read, not what happened.",
  },
];
