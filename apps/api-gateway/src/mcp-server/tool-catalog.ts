import { CatalogTool } from "./mcp-server.types";

/**
 * The tools this server declares — and, for the writes, the tools it declares
 * IN ORDER TO REFUSE THEM.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WRITES ARE HERE AT ALL (the fork, and how it was settled — ADR 0132)
 * ---------------------------------------------------------------------------
 * §7b of `.planning/08-softwares/mudavym-mcp.md` says an ungranted scope HIDES
 * a tool from `tools/list` rather than failing at call time. That rule is right
 * for reads and wrong for writes, and the difference is what the client
 * concludes from the absence.
 *
 * A read the key was not granted is genuinely not available to this client, and
 * hiding it says so. A write is different: NO key can be granted one in this
 * build, so hiding all eight would tell every assistant that Mudavym cannot
 * draft an order — which is false, and is precisely the
 * absence-reported-as-health shape. Declaring them, each with
 * `readOnlyHint: false` and a description that names the human step, tells the
 * truth: the capability exists, this door does not open it, and here is the
 * door that does.
 *
 * It also honours the ADR 0107 addendum from the other side. Our own client
 * classifies an un-annotated tool as a write and suspends a grant when the
 * declaration moves; a server that emitted no annotations would be classified
 * entirely as writes by our own rule. Every tool below therefore carries all
 * four hints, and they are the note's own R/W legend, transcribed.
 *
 * ---------------------------------------------------------------------------
 * WHY TEN READS AND NOT THIRTY-FOUR
 * ---------------------------------------------------------------------------
 * These ten are §8 step 4 of the capability note, unchanged and in its order.
 * The note reached them first and the reason holds: one division at a time, so
 * a first release cannot commit anything. The other twenty-four reads of §3 are
 * declared nowhere — not as a stub, not as a "coming soon" — because a tool
 * that answers `not implemented` is worse than a tool that is absent: the
 * client has already spent a turn on it.
 *
 * ---------------------------------------------------------------------------
 * A COUNT THE NOTE GOT WRONG
 * ---------------------------------------------------------------------------
 * §3 closes with "42 tools. 33 read-only, 9 write". Counting its own eight
 * tables gives 42 tools, 34 read and 8 write — Restaurant 8R/4W, Vendor 6R/1W,
 * POS 3R/1W, Sommelier 4R, Intelligence 6R/1W, Platform 5R, Customer 1R, Agent
 * 1R/1W. The eight writes below are that corrected set, and §7 of the note now
 * carries the correction.
 */

/** The scope vocabulary. Lowercase slugs, the shape `restaurant_mcp_connections.scopes` already validates. */
export const READ_SCOPES = [
  "inventory:read",
  "orders:read",
  "vendors:read",
  "prices:read",
  "analytics:read",
  "logs:read",
  "platform:read",
] as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** No arguments at all. Declared explicitly — an absent schema is not "no arguments". */
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };

/**
 * The sentence every write answers with.
 *
 * One function, not eight strings, so the eight refusals cannot drift into
 * eight different accounts of the same rule — the ADR 0013 failure that this
 * whole surface is built to avoid repeating.
 */
export function refusalFor(what: string, where: string): string {
  return (
    `Refused, and this is a result rather than an error: ${what} is a commitment, ` +
    `and a commitment needs a person's hold. This server reads freely and commits ` +
    `nothing. The seal it would need is the challenge-and-redeem hold a manager ` +
    `performs in Mudavym (ADR 0112/0113, common/seal/seal-token.ts) — no key can ` +
    `carry it and no argument can substitute for it. Do this at ${where}.`
  );
}

/** The ten read tools of §8 step 4, in the note's own order. */
export const READ_TOOLS: CatalogTool[] = [
  {
    name: "inventory.list",
    title: "Stock on hand",
    description:
      "Every active stock line for this house, with quantity and unit. Returns the rows the /inventory page reads, through the same service. Names the row count and the read time.",
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    scope: "inventory:read",
  },
  {
    name: "inventory.low_stock",
    title: "What is short",
    description:
      "Stock lines at or under par. An empty result means nothing is short AND the read succeeded; a read that could not run says so with a reason instead of returning an empty list.",
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    scope: "inventory:read",
  },
  {
    name: "orders.list",
    title: "Purchase orders",
    description:
      "Purchase orders for this house and their state. Optional status filter and page size.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter to one order status, e.g. pending, delivered.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Rows per page. Default 25.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "orders:read",
  },
  {
    name: "orders.get",
    title: "One purchase order",
    description:
      "One purchase order with its lines, vendor and agreed prices. Refuses an order belonging to another house — the id is checked against this key's restaurant, not trusted.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string", description: "The order's UUID." },
      },
      required: ["orderId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "orders:read",
  },
  {
    name: "vendors.search",
    title: "Search the vendor directory",
    description:
      "Searches distributors reachable from this house's territory. The corpus is shared; the territory gate is this house's.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text name or portfolio term." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, openWorldHint: true },
    scope: "vendors:read",
  },
  {
    name: "prices.compare",
    title: "Compare held prices",
    description:
      "Compares the prices this house holds for one wine across vendors. Returns null with a reason when no observation exists in the window — never a zero.",
    inputSchema: {
      type: "object",
      properties: {
        masterWineId: { type: "string", description: "Master wine library UUID." },
        windowDays: { type: "integer", minimum: 1, maximum: 730 },
      },
      required: ["masterWineId"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "prices:read",
  },
  {
    name: "insights.list",
    title: "Computed insights",
    description:
      "Stored insights for this house. This tool reads only what the generator has already computed; it never triggers a recompute, because a recompute is a spend and a spend is not a read.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Filter to these insight categories.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "analytics:read",
  },
  {
    name: "analytics.financial",
    title: "Financial rollup",
    description:
      "COGS %, gross margin, prime cost, inventory turnover, DIO, GMROI and dead-stock capital. Figures the engine could not complete come back null with the engine's own reason attached, never as zero.",
    inputSchema: {
      type: "object",
      properties: {
        labor: {
          type: "number",
          minimum: 0,
          description: "Labor cost for the prime-cost calculation. Omit and prime cost is reported as incomplete rather than computed from a zero.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "analytics:read",
  },
  {
    name: "logs.timeline",
    title: "The day-book",
    description:
      "The house's correlated activity timeline across checks, decisions, stock movements, documents and the audit log. Sources that failed are named, so the count is known to be a floor rather than assumed to be complete.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        correlationId: {
          type: "string",
          description: "Follow one business event across tables.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    scope: "logs:read",
  },
  {
    name: "health.live",
    title: "Which build is answering",
    description:
      'Whether the gateway is up and which revision it is. `commit` is the literal "unknown" when no build variable was set — never omitted, so a caller cannot read absence as agreement.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    scope: null,
  },
];

/**
 * The eight write tools of §3, declared and refused.
 *
 * `destructiveHint` is false on all eight and that is not laziness: every one
 * of them writes a draft, a proposal, or a record of something that already
 * physically happened. None deletes, none sends, none approves. The four verbs
 * that DO commit — approve an order, send a vendor mail, execute a one-tap
 * action, approve a POS match — are absent from this file entirely, which is
 * §4 of the note holding.
 */
export const WRITE_TOOLS: CatalogTool[] = [
  {
    name: "inventory.count",
    title: "Record a physical count",
    description:
      "Would record a counted quantity against a stock line. DECLARED AND REFUSED in this build: a count moves the ledger. Do it on /inventory.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        quantity: { type: "number" },
        uom: { type: "string" },
      },
      required: ["itemId", "quantity", "uom"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "inventory:count",
    refusal: refusalFor("recording a count", "/inventory in Mudavym"),
  },
  {
    name: "ledger.post_transaction",
    title: "Post a ledger transaction",
    description:
      "Would post one transaction to the inventory ledger. DECLARED AND REFUSED in this build. Do it on /inventory.",
    inputSchema: {
      type: "object",
      properties: {
        inventoryId: { type: "string" },
        quantity: { type: "number" },
        reason: { type: "string" },
      },
      required: ["inventoryId", "quantity"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "ledger:post",
    refusal: refusalFor("posting to the ledger", "/inventory in Mudavym"),
  },
  {
    name: "orders.draft",
    title: "Draft a purchase order",
    description:
      "Would draft a purchase order for a manager to approve. DECLARED AND REFUSED in this build. Draft it on /orders; approval is a separate, sealed step there.",
    inputSchema: {
      type: "object",
      properties: {
        vendorId: { type: "string" },
        lines: { type: "array", items: { type: "object" } },
      },
      required: ["vendorId", "lines"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "orders:draft",
    refusal: refusalFor("drafting an order", "/orders in Mudavym"),
  },
  {
    name: "receiving.log_door",
    title: "Log what arrived",
    description:
      "Would log what physically arrived against an order. DECLARED AND REFUSED in this build. Do it on /receiving.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        lines: { type: "array", items: { type: "object" } },
      },
      required: ["orderId", "lines"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "receiving:log",
    refusal: refusalFor("logging a delivery", "/receiving in Mudavym"),
  },
  {
    name: "reply.draft",
    title: "Draft a vendor reply",
    description:
      "Would draft a reply to a vendor thread. DECLARED AND REFUSED in this build — the text of a reply can form a contract, so it passes the commitment guardrail and a human hold before it exists at all. Do it on /communications.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        intent: { type: "string" },
      },
      required: ["orderId", "intent"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "replies:draft",
    refusal: refusalFor("drafting a vendor reply", "/communications in Mudavym"),
  },
  {
    name: "pos.propose_matches",
    title: "Propose POS matches",
    description:
      "Would propose catalogue matches for unmapped POS items. DECLARED AND REFUSED in this build. Do it on /settings.",
    inputSchema: NO_ARGS,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "pos:propose",
    refusal: refusalFor("proposing POS matches", "/settings in Mudavym"),
  },
  {
    name: "reports.generate",
    title: "Generate a report",
    description:
      "Would ask the engine for a report. DECLARED AND REFUSED in this build: generating one spends, and a spend is not a read. Do it on /reports.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string" } },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "reports:generate",
    refusal: refusalFor("generating a report", "/reports in Mudavym"),
  },
  {
    name: "ask_ai.propose",
    title: "Propose an action from a question",
    description:
      "Would turn a question into a proposed action for a human to confirm. DECLARED AND REFUSED in this build. Ask on /dashboard, where the confirm step is a person's.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    scope: "ask_ai:propose",
    refusal: refusalFor("proposing an action", "/dashboard in Mudavym"),
  },
];

export const ALL_TOOLS: CatalogTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function findTool(name: string): CatalogTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

/**
 * What this key may see.
 *
 * Reads are filtered by scope (§7b: an ungranted scope hides the tool). Writes
 * are ALWAYS listed — see the header. A read whose `scope` is null is always
 * listed too, because there is nothing to grant.
 */
export function visibleTools(scopes: string[]): CatalogTool[] {
  const held = new Set(scopes.map((s) => s.trim().toLowerCase()));
  const reads = READ_TOOLS.filter(
    (t) => t.scope === null || held.has(t.scope),
  );
  return [...reads, ...WRITE_TOOLS];
}
