import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * COST TRUTH ON A LOT — the three defects that let an unverified price wear the
 * word "invoice", and stopped a verified one from correcting anything.
 *
 * D1  `apply_stock_movement` inferred provenance:
 *       COALESCE(p_cost_provenance,
 *                CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END)
 *     so ANY caller passing a price without stating what kind of price it was
 *     got `'invoice'` free. `markDelivered` passes the PO's own quoted price
 *     (`row.final_price`) — the lot was stamped invoice-verified before anyone
 *     had seen paper. `receiving.service.ts:205-218` gets this right and says
 *     why; `markDelivered` gets it wrong 800 lines away.
 *
 * D2  A correction could not correct. A positive delta INSERTs a lot, a
 *     negative delta DELETEs lots FIFO, and nothing ever restated an existing
 *     lot's `unit_cost`. So a verified invoice arriving after an estimated
 *     receipt either landed only on a ledger row, or created a SECOND lot
 *     beside the estimated original — and `inventory_lot_rollup.wac`
 *     permanently blended the estimate with the correction, under the label
 *     "invoiced lot WAC".
 *
 * D3  `applyReceiptAdjustment` passed `p_source: "receiving"`.
 *     `inventory_transaction_source` is exactly
 *     (pos, manual, order, mobile_count, reconciliation, system, import, api)
 *     — verified against production 2026-09-02. The RPC casts
 *     `p_source::inventory_transaction_source`, so EVERY receipt-verification
 *     stock correction raised and `verifyReceipt` returned 422.
 *
 * WHY THE ENUM TESTS READ THE MIGRATION AND NOT A MOCK
 * ---------------------------------------------------
 * `verify-receipt.spec.ts` stubs `rpc()` as `async () => ({data:null,error:null})`.
 * A stub that always succeeds cannot fail an enum cast, which is exactly why D3
 * shipped green. These tests parse the enum out of
 * `20260805000000_baseline_from_production.sql` — a pg_dump OF PRODUCTION — and
 * check the literals the source code actually sends against it. No stub sits
 * between the assertion and the real value, and the check covers every call
 * site in the gateway rather than the one that happened to be noticed.
 */

const REPO = resolve(__dirname, "../../../..");
const GATEWAY_SRC = join(REPO, "apps/api-gateway/src");
const BASELINE = join(
  REPO,
  "supabase/migrations/20260805000000_baseline_from_production.sql",
);
const MIGRATIONS = join(REPO, "supabase/migrations");

// ---------------------------------------------------------------------------
// Reading the real schema
// ---------------------------------------------------------------------------

/** Pull an enum's labels straight out of the production dump. */
function enumLabels(typeName: string): string[] {
  const sql = readFileSync(BASELINE, "utf8");
  const m = new RegExp(
    `CREATE TYPE public\\.${typeName} AS ENUM \\(([^)]*)\\)`,
  ).exec(sql);
  if (!m) throw new Error(`enum ${typeName} not found in ${BASELINE}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...tsFiles(p));
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Every `key: "literal"` in the gateway, with file and line. */
function literalArgs(key: string): Array<{ where: string; value: string }> {
  const hits: Array<{ where: string; value: string }> = [];
  for (const file of tsFiles(GATEWAY_SRC)) {
    if (file.endsWith(".spec.ts")) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = new RegExp(`\\b${key}\\s*:\\s*"([^"]+)"`).exec(line);
      if (m)
        hits.push({ where: `${relative(REPO, file)}:${i + 1}`, value: m[1] });
    });
  }
  return hits;
}

/**
 * Every `.rpc("apply_stock_movement", {...})` argument object in the gateway,
 * as raw text. Brace-matched rather than regexed so a nested object or a
 * template literal cannot truncate the block.
 */
function applyStockMovementCalls(): Array<{ where: string; body: string }> {
  const out: Array<{ where: string; body: string }> = [];
  for (const file of tsFiles(GATEWAY_SRC)) {
    if (file.endsWith(".spec.ts")) continue;
    const src = readFileSync(file, "utf8");
    const marker = /"apply_stock_movement"/g;
    let m: RegExpExecArray | null;
    while ((m = marker.exec(src))) {
      const open = src.indexOf("{", m.index);
      if (open === -1) continue;
      let depth = 0;
      let close = open;
      for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
          depth--;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      out.push({
        where: `${relative(REPO, file)}:${src.slice(0, m.index).split("\n").length}`,
        body: src.slice(open, close + 1),
      });
    }
  }
  return out;
}

function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// D3 — the enum cast that made every receipt verification 422
// ---------------------------------------------------------------------------

describe("D3 — stock writes name enum values that exist", () => {
  it("inventory_transaction_source in the dump is the eight-value enum production has", () => {
    expect(enumLabels("inventory_transaction_source")).toEqual([
      "pos",
      "manual",
      "order",
      "mobile_count",
      "reconciliation",
      "system",
      "import",
      "api",
    ]);
  });

  it("every p_source literal in the gateway is a real inventory_transaction_source", () => {
    const valid = new Set(enumLabels("inventory_transaction_source"));
    const bad = literalArgs("p_source").filter((h) => !valid.has(h.value));
    // Pre-fix this is
    //   apps/api-gateway/src/procurement/procurement.service.ts:1654 -> "receiving"
    expect(bad.map((h) => `${h.where} -> "${h.value}"`)).toEqual([]);
  });

  it("every p_transaction_type literal in the gateway is a real inventory_transaction_type", () => {
    const valid = new Set(enumLabels("inventory_transaction_type"));
    const bad = literalArgs("p_transaction_type").filter(
      (h) => !valid.has(h.value),
    );
    expect(bad.map((h) => `${h.where} -> "${h.value}"`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D1 — a price must say what kind of price it is
// ---------------------------------------------------------------------------

describe("D1 — no price is promoted to 'invoice' by silence", () => {
  it("apply_stock_movement no longer infers provenance from the presence of a price", () => {
    const sql = migrationSql();
    // The exact inference, from 20260805130000_extend_apply_stock_movement.sql:66-69.
    const inference =
      /CASE WHEN p_unit_cost IS NOT NULL THEN 'invoice' ELSE 'estimated' END/g;
    // The baseline dump records history and is replayed first; only a LATER
    // migration can retire the behaviour, so what matters is that the final
    // definition does not carry it.
    const finalDef = sql.slice(
      sql.lastIndexOf("FUNCTION public.apply_stock_movement"),
    );
    expect(finalDef.match(inference)).toBeNull();
  });

  it("every apply_stock_movement call that passes a price also states its provenance", () => {
    // NAMED GAP, not a hidden one. `inventory-ledger.service.ts` passes
    // `p_unit_cost: dto.unitCost || null` with no provenance. `unitCost` is an
    // optional field on CreateTransactionDto that no client in this repo sets
    // (zero occurrences across apps/web/src and apps/mobile/src), and
    // production `inventory_transactions` holds 4 rows from sources manual and
    // order only — so no live path reaches it. That file is owned by a
    // concurrent inventory-ledger rework, so it is exempted BY EXACT PATH here
    // and in scripts/check_lot_cost_provenance.py rather than silently
    // excluded by a pattern. Removing this line is the whole of the follow-up.
    const OWNED_ELSEWHERE =
      "apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts";

    const offenders = applyStockMovementCalls()
      .filter((c) => /p_unit_cost\s*:/.test(c.body))
      .filter((c) => !/p_cost_provenance\s*:/.test(c.body))
      .map((c) => c.where);

    // Pre-fix: procurement.service.ts markDelivered (the PO's own quoted price)
    // and applyReceiptAdjustment (the landed cost) both pass a price mute.
    expect(offenders.filter((o) => !o.startsWith(OWNED_ELSEWHERE))).toEqual([]);
    // The exemption is asserted to still be REAL. If the sibling fixes that
    // call site, this fails and the exemption gets deleted rather than
    // outliving the reason for it.
    //
    // BY PATH, NOT BY PATH:LINE. This asserted `:98` and broke on a merge that
    // added two lines above the call — the exemption had not changed, only its
    // position had. A line number is a fact about everything above a call site,
    // so pinning one makes an unrelated edit look like a fixed bug; the sibling
    // guard `scripts/check_lot_cost_provenance.py:83` keys on the path alone
    // for the same reason, and this is the same mistake the stock-writes
    // allowlist was re-keyed off file:line to escape.
    expect(offenders.some((o) => o.startsWith(`${OWNED_ELSEWHERE}:`))).toBe(true);
  });

  it("markDelivered books the delivery at a stated, non-invoice provenance", async () => {
    const { db, calls } = makeDb();
    await service(db).markDelivered(REST, ORDER, USER, 10);

    const live = calls.rpc.find(
      (c) =>
        c.name === "apply_stock_movement" &&
        c.args.p_stock_state === "live" &&
        (c.args.p_delta ?? 0) > 0,
    );
    expect(live).toBeDefined();
    // The order carries final_price: 40 — a quoted PO price. Nobody has seen an
    // invoice, so whatever this lot is, it is not invoice-verified.
    expect(live!.args.p_cost_provenance).toBeDefined();
    expect(live!.args.p_cost_provenance).not.toBe("invoice");
  });

  it("markDelivered does not read suggested_price, which is not a column", () => {
    // information_schema on production, 2026-09-02: the price columns on
    // procurement_orders are final_price, negotiated_price, quoted_price,
    // invoice_unit_price, final_confirmed_cost, prefilled_invoice_unit_price
    // and the *_cost totals. `suggested_price` is not among them, so
    // `row.suggested_price` was always undefined.
    const src = readFileSync(
      join(GATEWAY_SRC, "procurement/procurement.service.ts"),
      "utf8",
    );
    const reads = src
      .split("\n")
      .flatMap((line, i) =>
        /row\.suggested_price/.test(line)
          ? [`procurement.service.ts:${i + 1}`]
          : [],
      );
    expect(reads).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D2 — a correction must restate the lot it corrects
// ---------------------------------------------------------------------------

describe("D2 — a verified invoice restates the lot instead of rivalling it", () => {
  it("a revalue_lot primitive exists in the migrations", () => {
    const declared = /CREATE (?:OR REPLACE )?FUNCTION public\.revalue_lot/.test(
      migrationSql(),
    );
    expect({ revalue_lot_declared: declared }).toEqual({
      revalue_lot_declared: true,
    });
  });

  it("the prior cost is preserved rather than overwritten", () => {
    // ADR 0059's rule: the proposal and the confirmation must not share a
    // column, or confirming destroys the estimate at the instant it becomes
    // evidence that the estimate was wrong.
    const preserved = /inventory_lot_revaluations/.test(migrationSql());
    expect({ prior_cost_preserved: preserved }).toEqual({
      prior_cost_preserved: true,
    });
  });

  it("verifyReceipt revalues the delivered lot at the verified landed cost", async () => {
    const { db, calls } = makeDb();

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 10,
      invoiceUnitPrice: 43,
      acceptedQuantity: 10,
      priceOverrideReason: "fuel surcharge agreed by phone",
    } as any);

    const reval = calls.rpc.find((c) => c.name === "revalue_lot");
    expect(reval).toBeDefined();
    expect(reval!.args.p_unit_cost).toBeCloseTo(43);
    expect(reval!.args.p_cost_provenance).toBe("invoice");
    // Targeted at the lots this delivery created, not at whatever FIFO returns.
    expect(reval!.args.p_source_order_id).toBe(ORDER);
  });

  it("an equal-quantity price correction still reaches the lot", async () => {
    // ledgerDelta is 0 here (accepted == already stocked). Pre-fix this was the
    // silent case: no movement, so the corrected price landed nowhere at all.
    const { db, calls } = makeDb();

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 10,
      invoiceUnitPrice: 43,
      acceptedQuantity: 10,
      priceOverrideReason: "fuel surcharge agreed by phone",
    } as any);

    const movements = calls.rpc.filter(
      (c) => c.name === "apply_stock_movement" && c.args.p_delta !== 0,
    );
    expect(movements).toHaveLength(0);
    expect(calls.rpc.some((c) => c.name === "revalue_lot")).toBe(true);
  });

  it("a receipt correction names a source the enum actually has", async () => {
    const valid = new Set(enumLabels("inventory_transaction_source"));
    const { db, calls } = makeDb();

    await service(db).verifyReceipt(REST, ORDER, USER, {
      invoiceQuantity: 12,
      invoiceUnitPrice: 43,
      acceptedQuantity: 12,
      priceOverrideReason: "fuel surcharge agreed by phone",
    } as any);

    for (const c of calls.rpc.filter(
      (x) => x.name === "apply_stock_movement",
    )) {
      expect(valid.has(c.args.p_source)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const INVENTORY = "11111111-1111-4111-8111-111111111111";

const orderRow = {
  id: ORDER,
  order_number: "ORD-2026-00001",
  restaurant_id: REST,
  inventory_id: INVENTORY,
  provider_id: "prov-1",
  quantity: 10,
  bottles_total: 10,
  unit_type: "bottle",
  final_price: 40,
  quantity_received: 10,
  status: "DELIVERED",
  delivery_notes: null,
};

function makeDb() {
  const calls = { rpc: [] as { name: string; args: Record<string, any> }[] };

  const supabase: any = {
    from(table: string) {
      let op = "select";
      let cols = "";
      const filters: Record<string, any> = {};
      const settle = (shape: "one" | "many"): Record<string, any> => {
        if (table === "procurement_orders")
          return {
            data: { ...orderRow, inventory: { wine_name: "Barolo" } },
            error: null,
          };
        if (table === "restaurant_inventory") {
          if (cols.trim() === "id")
            return { data: { id: filters.id }, error: null };
          return {
            data: {
              master_wine_id: "55555555-5555-4555-8555-555555555555",
              shadow_stock: 0,
              in_transit_quantity: 0,
            },
            error: null,
          };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };
      const q: any = {
        select(c?: string) {
          if (op === "select" && typeof c === "string") cols = c;
          return q;
        },
        eq(c: string, v: any) {
          filters[c] = v;
          return q;
        },
        neq: () => q,
        not: () => q,
        in: () => q,
        is: () => q,
        gt: () => q,
        order: () => q,
        range: () => q,
        limit: () => q,
        insert: () => {
          op = "insert";
          return q;
        },
        update: () => {
          op = "update";
          return q;
        },
        delete: () => {
          op = "delete";
          return q;
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async (name: string, args: Record<string, any>) => {
      calls.rpc.push({ name, args });
      return { data: null, error: null };
    },
    storage: { from: () => ({}) },
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;

  return { db, calls };
}

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

function service(db: DatabaseService) {
  return new ProcurementService(db, events, ledger);
}
