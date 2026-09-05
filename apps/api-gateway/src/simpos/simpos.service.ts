import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import axios from "axios";
import { DatabaseService } from "../database/database.service";
import { isOpenAt } from "../common/operating-hours/operating-hours";

/**
 * Categories a SimPOS button can carry — `master_wine_library.beverage_kind`'s
 * vocabulary plus the two words a beverage classifier has no room for and a
 * restaurant's button list is full of.
 */
const SIMPOS_CATEGORIES = new Set([
  "wine",
  "beer",
  "spirit",
  "sake",
  "cider",
  "cocktail",
  "non_alcoholic",
  "food",
  "other",
]);

/**
 * The price to seed a button with, or null.
 *
 * Was `… || 45`, which is two bugs in one operator: `||` treats a genuine $0
 * (a staff pour, a tasting) as absent, and the literal invents a price for
 * anything with none. Measured: 53 of 53 seeded SKUs carried $45.00, with
 * nothing on screen saying they were placeholders — so every revenue figure
 * SimPOS produced was arithmetic over a constant. ADR 0020: an unknown number
 * is null and renders as "unpriced".
 */
function seedPrice(inv: any, wine: any): number | null {
  for (const raw of [
    inv.menu_price_current,
    inv.custom_price,
    inv.target_price,
    wine?.price_reference,
  ]) {
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  return null;
}

/**
 * What kind of thing this button sells, or null when nothing says.
 *
 * `beverage_kind` is trigger-maintained on `master_wine_library` and never
 * written by application code, which makes it the one classification here that
 * is not a guess. Its `'unknown'` is stored as null: the absence of an answer
 * is not a category, and writing it as one is how "we do not know" starts
 * rendering as "we checked".
 */
function seedCategory(inv: any, wine: any): string | null {
  const raw = String(wine?.beverage_kind ?? inv?.beverage_kind ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "unknown") return null;
  return SIMPOS_CATEGORIES.has(raw) ? raw : null;
}

/** A money field, or null when there is no number — never a coerced 0. */
function moneyOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * What the check is worth, or null when nothing on it carries a price.
 *
 * A check with SOME priced lines returns the sum of those, because the money
 * that was charged is a fact even when part of the check is unpriced. A check
 * with NO priced line at all returns null: "we do not know what this cost" and
 * "this cost nothing" are different, and only one of them is true.
 */
function sumLineMoney(lines: any[]): number | null {
  let total = 0;
  let sawPrice = false;
  for (const l of lines) {
    const price = moneyOrNull(l.unit_price_snapshot);
    if (price === null) continue;
    sawPrice = true;
    total += price * (Number(l.qty) || 0);
  }
  return sawPrice ? Math.round(total * 100) / 100 : null;
}

/**
 * SimposService — the fake POS terminal's own backend (SimPOS testbed plan,
 * decisions C23-C31).
 *
 * Deliberately has NO dependency on PosHubService or any other WineOps
 * service. Decision C25: "SimPOS communicates with WineOps only over signed
 * HTTP webhook. No shared service imports, no direct reads of WineOps
 * tables." That boundary is what makes drift real — SimPOS's own catalog
 * (simpos_catalog) can diverge from pos_item_mappings/restaurant_inventory
 * exactly the way a real POS's item list drifts from what a restaurant
 * stocks, and the webhook is the only channel that can ever reconcile them.
 */
@Injectable()
export class SimposService {
  private readonly logger = new Logger(SimposService.name);
  private readonly webhookSecret: string | null =
    process.env.POS_HUB_WEBHOOK_SECRET || null;
  private readonly internalApiBaseUrl: string =
    process.env.API_GATEWAY_INTERNAL_URL ||
    `http://localhost:${process.env.PORT || 4000}/api/v1`;

  constructor(private readonly dbService: DatabaseService) {}

  // =========================================================================
  // Sim-namespace guard (decision C31)
  // =========================================================================

  /**
   * SimPOS refuses to target a restaurant_id outside the sim.* uuid5
   * namespace. The synth toolkit's own definition of a sim tenant is
   * `restaurants.slug LIKE 'sim-%'` (scripts/synth/teardown.py's
   * resolve_sim_restaurant_ids) — reusing that definition here, rather than
   * recomputing uuid5 client-side, keeps exactly one source of truth for
   * "what counts as a sim tenant."
   */
  async assertSimRestaurant(restaurantId: string): Promise<void> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("id, slug")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException(`Restaurant '${restaurantId}' not found`);
    }
    if (!String(data.slug || "").startsWith("sim-")) {
      throw new ForbiddenException(
        `SimPOS refuses to target restaurant '${restaurantId}' — not a sim.* tenant (slug must start with 'sim-')`,
      );
    }
  }

  // =========================================================================
  // Catalog (decisions C23, C30 "Edit POS")
  // =========================================================================

  /**
   * Seed simpos_catalog once from the sim restaurant's live inventory
   * (decision C23: grain wine + vintage + size_ml, one row per sellable
   * SKU). No-ops if the catalog already has rows — SimPOS is free to
   * diverge from that point on (decision C30 is the drift generator).
   */
  async seedCatalogIfEmpty(
    restaurantId: string,
  ): Promise<{ seeded: boolean; count: number }> {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;

    const { count: existing } = await db
      .from("simpos_catalog")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if ((existing ?? 0) > 0) {
      return { seeded: false, count: existing ?? 0 };
    }

    const inventory = await this.dbService.getRestaurantInventory(restaurantId);
    const rows = (inventory || [])
      .filter((inv: any) => inv.master_wine_library)
      .map((inv: any) => {
        const wine = inv.master_wine_library;
        return {
          restaurant_id: restaurantId,
          wine_name: inv.wine_name || wine.name,
          producer: wine.producer ?? null,
          vintage: wine.vintage ?? null,
          size_ml: inv.bottle_size_ml || 750,
          price: seedPrice(inv, wine),
          category: seedCategory(inv, wine),
        };
      });
    if (rows.length === 0) return { seeded: false, count: 0 };

    const { error } = await db.from("simpos_catalog").insert(rows);
    if (error) throw new Error(`Seed failed: ${error.message}`);

    this.logger.log(
      `SimPOS catalog seeded for ${restaurantId}: ${rows.length} SKU(s)`,
    );
    return { seeded: true, count: rows.length };
  }

  /**
   * The venue's own timezone and published hours.
   *
   * Exists because the SimPOS screens were rendering POS timestamps with
   * `toLocaleString()` — the VIEWER's zone. A 23:20 PDT check showed as 2:20 AM
   * EDT to anyone reading from the east coast, which is not a cosmetic
   * difference: it moves the check to the wrong service day and makes "did this
   * ring after we closed?" unanswerable by eye.
   *
   * Returns nulls rather than a fallback zone when the venue has not set them.
   * A default of UTC (or of the browser's zone) would render a confident wrong
   * time, which is worse than rendering a time that admits what it is.
   */
  async getVenue(restaurantId: string): Promise<{
    id: string;
    name: string | null;
    timezone: string | null;
    operating_hours: unknown;
    open_now: { open: boolean | null; reason: string | null };
  }> {
    await this.assertSimRestaurant(restaurantId);
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("id, name, timezone, operating_hours")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Answered here rather than in the browser so there is exactly ONE
    // implementation of "is this venue open" — the same `isOpenAt` the close
    // path stamps onto the check. A second copy in the SPA would drift, and
    // the two would disagree about the same minute.
    const state = isOpenAt(
      data?.operating_hours ?? null,
      data?.timezone ?? null,
      new Date(Date.now()),
    );
    return {
      id: restaurantId,
      name: data?.name ?? null,
      timezone: data?.timezone ?? null,
      operating_hours: data?.operating_hours ?? null,
      open_now: { open: state.open, reason: state.reason ?? null },
    };
  }

  async listCatalog(restaurantId: string) {
    await this.assertSimRestaurant(restaurantId);
    const { data, error } = await this.dbService.supabase
      .from("simpos_catalog")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("wine_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  /** Edit POS mode (decision C30): add, remove, or reprice SKUs — the drift generator. */
  async upsertCatalogItem(
    restaurantId: string,
    item: {
      id?: string;
      wineName: string;
      producer?: string | null;
      vintage?: number | null;
      sizeMl?: number;
      /** Null is a real answer: the button exists and nobody has priced it. */
      price?: number | null;
      category?: string | null;
    },
  ) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const rawCategory = String(item.category ?? "")
      .trim()
      .toLowerCase();
    const row = {
      restaurant_id: restaurantId,
      wine_name: item.wineName,
      producer: item.producer ?? null,
      vintage: item.vintage ?? null,
      size_ml: item.sizeMl ?? 750,
      // `?? null` and not `|| null`: a deliberate $0 button must survive.
      price: item.price ?? null,
      category:
        rawCategory && SIMPOS_CATEGORIES.has(rawCategory) ? rawCategory : null,
      updated_at: new Date().toISOString(),
    };
    if (item.id) {
      const { data, error } = await db
        .from("simpos_catalog")
        .update(row)
        .eq("id", item.id)
        .eq("restaurant_id", restaurantId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
    const { data, error } = await db
      .from("simpos_catalog")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async removeCatalogItem(restaurantId: string, catalogId: string) {
    await this.assertSimRestaurant(restaurantId);
    const { error } = await this.dbService.supabase
      .from("simpos_catalog")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", catalogId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new Error(error.message);
    return { removed: true };
  }

  // =========================================================================
  // Tables (decision C29 — visible, disabled, future affordance)
  // =========================================================================

  async listTables(restaurantId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const { data } = await db
      .from("simpos_tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("table_number", { ascending: true });
    if (data && data.length > 0) return data;

    const rows = Array.from({ length: 20 }, (_, i) => ({
      restaurant_id: restaurantId,
      table_number: i + 1,
    }));
    const { data: inserted, error } = await db
      .from("simpos_tables")
      .insert(rows)
      .select();
    if (error) throw new Error(error.message);
    return inserted || [];
  }

  // =========================================================================
  // Check lifecycle (decision C27: open, add lines, close)
  // =========================================================================

  /**
   * The Home pane's current check.
   *
   * Always returns the same shape as getCheck() — { ...check, lines,
   * lossTotal } — never the bare simpos_checks row. The frontend's
   * SimposCheck type declares `lines` as required and the terminal page
   * reads `check.lines.length` unguarded, so a response missing `lines`
   * (as this endpoint used to return on both the "found existing" and the
   * "just created" path) crashes the page on load, before a single line has
   * ever been added.
   */
  async getOrCreateOpenCheck(restaurantId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const { data: existing } = await db
      .from("simpos_checks")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return this.getCheck(restaurantId, existing.id);

    const { data: created, error } = await db
      .from("simpos_checks")
      .insert({ restaurant_id: restaurantId, status: "open" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return this.getCheck(restaurantId, created.id);
  }

  async getCheck(restaurantId: string, checkId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const { data: check, error } = await db
      .from("simpos_checks")
      .select("*")
      .eq("id", checkId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error || !check) throw new NotFoundException("Check not found");
    const { data: lines } = await db
      .from("simpos_check_lines")
      .select("*")
      .eq("check_id", checkId)
      .order("added_at", { ascending: true });
    return {
      ...check,
      lines: lines || [],
      lossTotal: this.computeLoss(lines || []),
    };
  }

  /** Running Loss total (Home pane indicator, UI spec): voided/comped price*qty + discount_amount. */
  private computeLoss(lines: any[]): number {
    let loss = 0;
    for (const l of lines) {
      if (l.status === "voided" || l.status === "comped") {
        // An unpriced button's void is a loss of an UNKNOWN amount. It is
        // skipped rather than added as `Number(null) * qty` = 0, which would
        // have quietly asserted that voiding it cost nothing.
        const price = moneyOrNull(l.unit_price_snapshot);
        if (price === null) continue;
        loss += price * Number(l.qty);
      } else if (l.status === "discounted") {
        loss += Number(l.discount_amount) || 0;
      }
    }
    return Math.round(loss * 100) / 100;
  }

  async addLine(
    restaurantId: string,
    checkId: string,
    catalogId: string,
    qty: number,
  ) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;

    const { data: check } = await db
      .from("simpos_checks")
      .select("id, status")
      .eq("id", checkId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!check) throw new NotFoundException("Check not found");
    if (check.status !== "open")
      throw new ForbiddenException("Check is closed — open a new one");

    const { data: item } = await db
      .from("simpos_catalog")
      .select("*")
      .eq("id", catalogId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!item) throw new NotFoundException("Catalog item not found");

    const { data: line, error } = await db
      .from("simpos_check_lines")
      .insert({
        restaurant_id: restaurantId,
        check_id: checkId,
        catalog_id: catalogId,
        item_name_snapshot: item.wine_name,
        vintage_snapshot: item.vintage,
        size_ml_snapshot: item.size_ml,
        unit_price_snapshot: item.price,
        qty: Math.max(1, Math.round(qty || 1)),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return line;
  }

  /**
   * Record the covers, table and server on an open check.
   *
   * A POS knows who is at the table and how many of them there are; SimPOS had
   * nowhere to put any of it, so `pos_checks.covers`, `.table_id` and
   * `.server_name` were NULL on 44 of 44 rows and every covers-based or
   * per-server figure downstream was computed over nothing.
   *
   * Only the keys actually sent are written, so setting a server does not
   * silently clear a cover count. An explicitly sent `null` DOES clear —
   * "nobody said" has to be expressible, or the first wrong number entered
   * becomes permanent.
   */
  async updateCheckContext(
    restaurantId: string,
    checkId: string,
    patch: {
      covers?: number | null;
      tableId?: string | null;
      serverName?: string | null;
    },
  ) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;

    const { data: check } = await db
      .from("simpos_checks")
      .select("id, status")
      .eq("id", checkId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!check) throw new NotFoundException("Check not found");
    if (check.status !== "open")
      throw new ForbiddenException("Check is closed — open a new one");

    const row: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if ("covers" in patch) {
      if (patch.covers === null || patch.covers === undefined) {
        row.covers = null;
      } else {
        const n = Number(patch.covers);
        if (!Number.isInteger(n) || n < 0 || n > 200) {
          throw new Error(
            `covers must be a whole number of guests between 0 and 200, or null — got ${JSON.stringify(patch.covers)}`,
          );
        }
        row.covers = n;
      }
    }
    if ("tableId" in patch) row.table_id = patch.tableId ?? null;
    if ("serverName" in patch) {
      const name = String(patch.serverName ?? "").trim();
      row.server_name = name === "" ? null : name.slice(0, 120);
    }

    const { data, error } = await db
      .from("simpos_checks")
      .update(row)
      .eq("id", checkId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /** Loss box inputs: void ("never happened"), comp (free, still consumed), discount (partial). */
  async setLineStatus(
    restaurantId: string,
    lineId: string,
    status: "active" | "voided" | "comped" | "discounted",
    opts: { reason?: string; discountAmount?: number } = {},
  ) {
    await this.assertSimRestaurant(restaurantId);
    const { data, error } = await this.dbService.supabase
      .from("simpos_check_lines")
      .update({
        status,
        status_reason: opts.reason ?? null,
        discount_amount:
          status === "discounted" ? (opts.discountAmount ?? 0) : 0,
      })
      .eq("id", lineId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Close the check (decision C27) and fire the signed webhook (decision
   * C25/C28) — the only channel SimPOS ever uses to reach WineOps. Voided
   * lines never happened, so they're excluded; comped and discounted lines
   * still consumed real stock and are included at their real quantity.
   */
  async closeCheck(restaurantId: string, checkId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;

    const { data: check } = await db
      .from("simpos_checks")
      .select("*")
      .eq("id", checkId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!check) throw new NotFoundException("Check not found");
    if (check.status !== "open")
      throw new ForbiddenException("Check is already closed");

    const { data: lines } = await db
      .from("simpos_check_lines")
      .select("*")
      .eq("check_id", checkId);
    const activeLines = (lines || []).filter((l) => l.status !== "voided");

    // pos_item_mappings.external_item_id must line up with the POS-facing id
    // (simpos_catalog.external_item_id, the PLU-equivalent), not the
    // internal catalog_id PK — the catalog matcher (decisions D32-39) keys
    // its mapping rows off exactly this field.
    const catalogIds = [
      ...new Set(activeLines.map((l) => l.catalog_id).filter(Boolean)),
    ];
    let externalIdByCatalogId = new Map<string, string>();
    let catalogByCatalogId = new Map<string, any>();
    if (catalogIds.length > 0) {
      const { data: catalogRows } = await db
        .from("simpos_catalog")
        .select("id, external_item_id, category")
        .in("id", catalogIds);
      externalIdByCatalogId = new Map(
        (catalogRows || []).map((c: any) => [c.id, c.external_item_id]),
      );
      catalogByCatalogId = new Map(
        (catalogRows || []).map((c: any) => [c.id, c]),
      );
    }

    const closedAt = new Date(Date.now()).toISOString();

    // Was the venue open when this rang? All 44 checks on the 2026-09-03 lens
    // run were closed between 22:29 and 23:20 PDT against a published 22:00
    // Friday close, and nothing anywhere noticed. This RECORDS the answer and
    // never refuses the check: a POS that will not take money after closing
    // time is a broken POS, and late trade is a fact about the night, not an
    // error. `isOpenAt` answers null-with-a-reason rather than false, and that
    // distinction survives into the column — "we could not tell" must never
    // render as "it was fine" (ADR 0093 D1).
    const venue = await this.loadVenueContext(restaurantId);
    const openState = isOpenAt(
      venue.operating_hours,
      venue.timezone,
      new Date(closedAt),
    );
    const hoursState =
      openState.open === true ? "open" : (openState.reason ?? "hours_unknown");

    const { error: closeError } = await db
      .from("simpos_checks")
      .update({
        status: "closed",
        closed_at: closedAt,
        hours_state: hoursState,
      })
      .eq("id", checkId);
    if (closeError) throw new Error(closeError.message);

    const items = activeLines.map((l) => {
      const catalog = catalogByCatalogId.get(l.catalog_id) ?? null;
      return {
        name: l.item_name_snapshot,
        externalItemId: externalIdByCatalogId.get(l.catalog_id) ?? l.catalog_id,
        qty: l.qty,
        // An unpriced button sells at an unknown price, not at $0.00. The old
        // `Number(null)` made that 0 and every downstream revenue figure a sum
        // over invented zeros.
        price: moneyOrNull(l.unit_price_snapshot),
        category: catalog?.category ?? null,
        // Was hard-coded `true`. SimPOS's catalog is not all wine — the lens
        // run put Haydari, Köpoğlu, Acılı Muhammara, a Turkish coffee and a
        // mocktail into pos_unresolved_lines as permanent "unmapped wine", 38
        // of the 39 open rows. An uncategorised button is NOT declared wine:
        // a meze wrongly dropped costs one queue row, a meze wrongly declared
        // wine costs a permanent one.
        is_wine: (catalog?.category ?? null) === "wine",
      };
    });

    // ADR 0011's contract: a check carries its money, its table, its server
    // and its covers. All six were NULL on 44 of 44 pos_checks rows, so every
    // revenue, average-check and covers figure downstream was computed over
    // nulls while the screens rendered them as numbers.
    const subtotal = sumLineMoney(activeLines);
    const discounts = activeLines.reduce(
      (s, l) => s + (Number(l.discount_amount) || 0),
      0,
    );
    const payload = {
      externalCheckId: checkId,
      openedAt: check.opened_at,
      closedAt,
      voided: false,
      // Null and not 0 when a table was never opened: a check rung without
      // seating anybody has an UNKNOWN cover count (ADR 0105 D5).
      covers: check.covers ?? null,
      tableRef: check.table_id ?? null,
      serverName: check.server_name ?? null,
      subtotal,
      total:
        subtotal === null
          ? null
          : Math.round((subtotal - discounts) * 100) / 100,
      // SimPOS has no tip flow, and inventing 0 would make "nobody tipped"
      // indistinguishable from "this POS does not report tips".
      tip: null,
      items,
    };

    const delivery = await this.sendSignedWebhook(restaurantId, payload);
    await db
      .from("simpos_checks")
      .update({
        webhook_status: delivery.ok ? "sent" : "failed",
        webhook_sent_at: delivery.ok ? new Date().toISOString() : null,
        webhook_error: delivery.ok ? null : delivery.error,
      })
      .eq("id", checkId);

    return {
      check: {
        ...check,
        status: "closed",
        closed_at: closedAt,
        hours_state: hoursState,
      },
      lines,
      webhook: delivery,
    };
  }

  /**
   * The venue's timezone and published hours, read fresh at close time.
   *
   * Deliberately a soft read: a restaurants row that cannot be loaded yields
   * nulls, which `isOpenAt` answers `hours_unknown` to. Failing the close
   * because we could not look up opening hours would be the tail wagging the
   * dog — but reporting "open" because we could not look them up would be the
   * absence-as-health fault this whole pass exists to remove.
   */
  private async loadVenueContext(
    restaurantId: string,
  ): Promise<{ timezone: string | null; operating_hours: unknown }> {
    const { data, error } = await this.dbService.supabase
      .from("restaurants")
      .select("id, timezone, operating_hours")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      // Soft, but never silent. The close proceeds and the check is stamped
      // `hours_unknown`, which is TRUE — we could not find out. What must not
      // happen is this failing quietly and the venue reading as open, so the
      // reason is logged with the restaurant it concerns.
      this.logger.warn(
        `Could not read operating hours for ${restaurantId} while closing a check — hours_state will be 'hours_unknown': ${error.message}`,
      );
    }
    return {
      timezone: data?.timezone ?? null,
      operating_hours: data?.operating_hours ?? null,
    };
  }

  // =========================================================================
  // Order log (decision — SimPOS-side full-page order log, distinct from
  // the cross-cutting WineOps logs timeline; a debugging view over SimPOS's
  // own data only)
  // =========================================================================

  /**
   * Flat list of every check this SimPOS instance has ever produced, with
   * lines, timestamps, the per-check Loss total, and webhook
   * delivery/signing status — reached via "check logs in full page" from
   * the Home tab's check view.
   */
  async listOrders(restaurantId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;

    const { data: checks, error } = await db
      .from("simpos_checks")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("opened_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!checks || checks.length === 0) return [];

    const { data: allLines } = await db
      .from("simpos_check_lines")
      .select("*")
      .in(
        "check_id",
        checks.map((c: any) => c.id),
      );

    const linesByCheck = new Map<string, any[]>();
    for (const line of allLines || []) {
      const arr = linesByCheck.get(line.check_id) ?? [];
      arr.push(line);
      linesByCheck.set(line.check_id, arr);
    }

    return checks.map((c: any) => {
      const lines = linesByCheck.get(c.id) ?? [];
      return {
        ...c,
        lines,
        lossTotal: this.computeLoss(lines),
      };
    });
  }

  /**
   * HMAC-SHA256 sign the canonical check payload and POST it to the pos-hub
   * webhook — the same guard PosHubService.verifyWebhookSignature enforces
   * (decision B17). No in-process call, no shared service import: this is a
   * real HTTP round trip so the verification path stays exercised (C28).
   */
  private async sendSignedWebhook(
    restaurantId: string,
    payload: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.webhookSecret) {
      const msg = "POS_HUB_WEBHOOK_SECRET not configured — cannot sign webhook";
      this.logger.error(msg);
      return { ok: false, error: msg };
    }
    const body = JSON.stringify([payload]);
    const signature = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(body)
      .digest("hex");
    // CodeQL flags this as request-forgery (critical) because `restaurantId`
    // reaches a URL. In practice every caller passes through
    // `assertSimRestaurant`, whose `.eq("id", …)` lookup rejects anything that
    // is not a real uuid — but that is action at a distance: it lives in another
    // method, CodeQL cannot see it, and a future caller reaching this private
    // method directly would inherit no protection at all.
    //
    // So the check is made local. The host still comes from config and cannot be
    // influenced from here; what this stops is a crafted id steering the PATH to
    // some other internal endpoint. Encoding alone would not do it — `%2E%2E%2F`
    // is still traversal to some servers — so the shape is asserted first, and
    // encoding is belt to that braces.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        restaurantId,
      )
    ) {
      const msg = `Refusing to send a SimPOS webhook for a non-uuid restaurant id`;
      this.logger.error(msg);
      return { ok: false, error: msg };
    }
    const url = `${this.internalApiBaseUrl}/pos-hub/webhook/generic_webhook/${encodeURIComponent(restaurantId)}`;
    try {
      await axios.post(url, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Pos-Hub-Signature": signature,
        },
        timeout: 10000,
      });
      return { ok: true };
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "webhook delivery failed";
      this.logger.warn(`SimPOS webhook delivery failed for ${url}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
