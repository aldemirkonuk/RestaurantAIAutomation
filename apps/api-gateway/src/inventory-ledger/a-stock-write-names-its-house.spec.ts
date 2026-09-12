import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { Test, TestingModule } from "@nestjs/testing";
import {
  ForbiddenException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import {
  TransactionType,
  TransactionSource,
} from "./dto/inventory-ledger.dto";

/**
 * ADR 0141 — A STOCK WRITE NAMES THE HOUSE IT IS FOR.
 *
 * THE DEFECT, on main `aa426050` and live in production.
 * `public.apply_stock_movement` took no restaurant argument. It read
 * `restaurant_id` off the inventory row the CALLER named
 * (`20260906233000_stock_at_the_door_cost_at_verified.sql:222`) and wrote the
 * lot and the ledger row under that restaurant. There is no RLS on the path —
 * the gateway holds the service-role key — and no tenant assertion in the
 * function.
 *
 * The gateway did not compensate. `createTransaction` took `restaurantId` from
 * the authenticated token, LOGGED it, and then never used it: not as a filter,
 * not as a comparison, not as an argument. `dto.inventoryId` went straight into
 * the RPC. So a signed-in user naming another house's item wrote that house's
 * ledger — and, because the read-back afterwards IS scoped to the caller, was
 * answered "Transaction not found" over a write that had committed.
 *
 * These tests were observed failing against the pre-fix module, copied in place
 * with `git show HEAD:<path> > <probe>` per the standing brief. The counts are
 * in `p4-scratch/tenantfix-report.md`.
 */

const REPO = resolve(__dirname, "../../../..");
const GATEWAY_SRC = join(REPO, "apps/api-gateway/src");
const MIGRATIONS = join(REPO, "supabase/migrations");

const OWN_RESTAURANT = "11111111-1111-4111-8111-111111111111";
const OWN_ITEM = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ITEM = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

// ---------------------------------------------------------------------------
// A database that knows which items belong to whom
// ---------------------------------------------------------------------------

type Probe = { data: unknown; error: { message: string } | null };

interface DbOptions {
  /** What the ownership probe on restaurant_inventory answers. */
  ownership: Probe;
  /** What apply_stock_movement returns. */
  rpc?: Probe;
  /** What the read-back of inventory_transactions answers. */
  readBack?: Probe;
}

function makeDb(opts: DbOptions) {
  const calls: {
    rpc: Array<{ name: string; args: Record<string, unknown> }>;
    reads: string[];
  } = { rpc: [], reads: [] };

  const supabase: any = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      return Promise.resolve(opts.rpc ?? { data: "txn-1", error: null });
    },
    from(table: string) {
      calls.reads.push(table);
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: () =>
          Promise.resolve(
            table === "restaurant_inventory"
              ? opts.ownership
              : (opts.readBack ?? {
                  data: transactionRow(),
                  error: null,
                }),
          ),
        single: () =>
          Promise.resolve(
            opts.readBack ?? { data: transactionRow(), error: null },
          ),
      };
      return q;
    },
  };

  return { supabase, calls };
}

function transactionRow() {
  return {
    id: "txn-1",
    restaurant_id: OWN_RESTAURANT,
    inventory_id: OWN_ITEM,
    wine_id: "wine-1",
    transaction_type: "sale",
    source: "pos",
    quantity_change: -2,
    quantity_before: 10,
    quantity_after: 8,
    stock_type: "live",
    performed_by_type: "user",
    transaction_date: new Date().toISOString(),
    created_at: new Date().toISOString(),
    metadata: {},
  };
}

async function service(supabase: unknown): Promise<InventoryLedgerService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InventoryLedgerService,
      { provide: DatabaseService, useValue: { supabase, getClient: () => supabase } },
      {
        provide: EventsService,
        useValue: { createEvent: async () => ({ id: "event-1" }) },
      },
    ],
  }).compile();
  return module.get(InventoryLedgerService);
}

const dto = (inventoryId: string) => ({
  inventoryId,
  wineId: "wine-1",
  transactionType: TransactionType.SALE,
  source: TransactionSource.POS,
  quantityChange: -2,
  idempotencyKey: "key-1",
});

// ---------------------------------------------------------------------------
// 1. The write itself
// ---------------------------------------------------------------------------

describe("createTransaction — a movement cannot reach another house", () => {
  it("refuses an item belonging to another restaurant, and issues no RPC", async () => {
    // The ownership probe finds nothing: FOREIGN_ITEM is not this house's.
    const { supabase, calls } = makeDb({
      ownership: { data: null, error: null },
    });

    await expect(
      (await service(supabase)).createTransaction(
        OWN_RESTAURANT,
        USER,
        dto(FOREIGN_ITEM) as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The point is not that it threw. A check running AFTER the RPC would
    // still have moved the other house's stock and then thrown.
    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toEqual(
      [],
    );
  });

  it("says which item it refused rather than failing blankly", async () => {
    const { supabase } = makeDb({ ownership: { data: null, error: null } });
    await expect(
      (await service(supabase)).createTransaction(
        OWN_RESTAURANT,
        USER,
        dto(FOREIGN_ITEM) as any,
      ),
    ).rejects.toThrow(/does not belong to this restaurant/i);
  });

  it("REFUSES when the ownership read fails — a failed read is not permission", async () => {
    // supabase-js resolves `{ data, error }` rather than throwing, so a dropped
    // connection arrives here as data:null + error. Treating that like "not
    // found" would be wrong in the safe direction; treating it like "found"
    // would report the ABSENCE of an answer as a yes, which is this codebase's
    // standing fault (ADR 0051 / 0067).
    const { supabase, calls } = makeDb({
      ownership: { data: null, error: { message: "connection reset" } },
    });

    await expect(
      (await service(supabase)).createTransaction(
        OWN_RESTAURANT,
        USER,
        dto(OWN_ITEM) as any,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(calls.rpc.filter((c) => c.name === "apply_stock_movement")).toEqual(
      [],
    );
  });

  it("still writes a legitimate movement, and NAMES THE HOUSE when it does", async () => {
    const { supabase, calls } = makeDb({
      ownership: { data: { id: OWN_ITEM }, error: null },
    });

    const result = await (
      await service(supabase)
    ).createTransaction(OWN_RESTAURANT, USER, dto(OWN_ITEM) as any);

    expect(result.id).toBe("txn-1");
    const movement = calls.rpc.find((c) => c.name === "apply_stock_movement");
    expect(movement).toBeDefined();
    expect(movement!.args.p_restaurant_id).toBe(OWN_RESTAURANT);
    expect(movement!.args.p_inventory_id).toBe(OWN_ITEM);
  });
});

// ---------------------------------------------------------------------------
// 2. The committed-write-reported-as-failure half
// ---------------------------------------------------------------------------

describe("createTransaction — a committed write is never reported as not found", () => {
  it("calls a read that finds nothing after a returned id a CONTRADICTION", async () => {
    // apply_stock_movement returned an id, so the row exists. Not seeing it
    // under this restaurant is not "not found" — it is the two facts
    // disagreeing, and it is what the tenant hole looked like from the caller's
    // side before the refusal above existed.
    const { supabase } = makeDb({
      ownership: { data: { id: OWN_ITEM }, error: null },
      rpc: { data: "txn-9", error: null },
      readBack: { data: null, error: null },
    });

    const call = (await service(supabase)).createTransaction(
      OWN_RESTAURANT,
      USER,
      dto(OWN_ITEM) as any,
    );

    await expect(call).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(call).rejects.toThrow(/contradiction/i);
    await expect(call).rejects.not.toThrow(/Transaction not found/i);
  });

  it("says the movement stands when the read-back itself fails", async () => {
    const { supabase } = makeDb({
      ownership: { data: { id: OWN_ITEM }, error: null },
      rpc: { data: "txn-9", error: null },
      readBack: { data: null, error: { message: "statement timeout" } },
    });

    await expect(
      (await service(supabase)).createTransaction(
        OWN_RESTAURANT,
        USER,
        dto(OWN_ITEM) as any,
      ),
    ).rejects.toThrow(/The movement stands/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Every call site, not just the one that was noticed
// ---------------------------------------------------------------------------

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...tsFiles(full));
    } else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Every `.rpc("apply_stock_movement", {...})` argument object in the gateway,
 * brace-matched so a nested object or a template literal cannot truncate the
 * block and hide a key that is present — or absent.
 */
function applyStockMovementCalls(): Array<{ where: string; body: string }> {
  const out: Array<{ where: string; body: string }> = [];
  for (const file of tsFiles(GATEWAY_SRC)) {
    if (file.endsWith(".spec.ts")) continue;
    const src = readFileSync(file, "utf8");
    const marker = /rpc\(\s*\n?\s*"apply_stock_movement"/g;
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

describe("every gateway stock write names the house it is for", () => {
  it("finds the call sites at all — an empty scan proves nothing", () => {
    // Absence reported as health: a scan that matched zero call sites would
    // pass the assertion below without having checked anything. Measured on
    // this tree: 15 call sites across 8 files.
    expect(applyStockMovementCalls().length).toBeGreaterThanOrEqual(10);
  });

  it("passes p_restaurant_id at every one of them", () => {
    const missing = applyStockMovementCalls()
      .filter((c) => !/\bp_restaurant_id\s*:/.test(c.body))
      .map((c) => c.where);
    // Pre-fix this list is every call site in the gateway.
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. The primitive itself
// ---------------------------------------------------------------------------

describe("apply_stock_movement stops trusting its caller", () => {
  const sql = () => {
    const file = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith("_a_stock_write_names_its_house.sql"))
      .sort()
      .pop();
    expect(file).toBeDefined();
    return readFileSync(join(MIGRATIONS, file as string), "utf8");
  };

  it("takes a restaurant argument", () => {
    expect(sql()).toMatch(/p_restaurant_id uuid DEFAULT NULL::uuid/);
  });

  it("raises on a mismatch rather than relocating the write", () => {
    const body = sql();
    // Twice: once before the idempotency lookup, so a replayed key cannot be
    // used to fish another house's transaction id out of the ledger, and once
    // under the row lock, which is the comparison the write depends on.
    const refusals = body.match(
      /does not match the item\./g,
    );
    expect(refusals?.length).toBe(2);
    expect(body).toMatch(/USING ERRCODE = '42501'/);
  });

  it("drops the old signature so PostgREST has exactly one candidate", () => {
    const body = sql();
    expect(body).toMatch(/DROP FUNCTION IF EXISTS public\.apply_stock_movement\(/);
    expect(body).toMatch(/expected exactly one public\.apply_stock_movement/);
  });

  it("keeps the argument OPTIONAL, which is what makes the deploy window survivable", () => {
    // A required argument would 404 every stock write made by the old gateway
    // between the migration applying at merge and the new gateway booting.
    // This assertion is the decision, pinned: if it is ever removed, that is a
    // second decision and not an accident.
    expect(sql()).toMatch(/pronargdefaults[\s\S]{0,240}<> 13/);
    expect(sql()).toMatch(/p_restaurant_id uuid DEFAULT NULL::uuid\n\) RETURNS uuid/);
  });
});
