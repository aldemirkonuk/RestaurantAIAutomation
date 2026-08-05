import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import axios from "axios";
import { DatabaseService } from "../database/database.service";

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
        const price =
          Number(inv.menu_price_current) ||
          Number(inv.custom_price) ||
          Number(inv.target_price) ||
          Number(wine.price_reference) ||
          45;
        return {
          restaurant_id: restaurantId,
          wine_name: inv.wine_name || wine.name,
          producer: wine.producer ?? null,
          vintage: wine.vintage ?? null,
          size_ml: inv.bottle_size_ml || 750,
          price: Math.round(price * 100) / 100,
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
      price: number;
    },
  ) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const row = {
      restaurant_id: restaurantId,
      wine_name: item.wineName,
      producer: item.producer ?? null,
      vintage: item.vintage ?? null,
      size_ml: item.sizeMl ?? 750,
      price: item.price,
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

  async getOrCreateOpenCheck(restaurantId: string) {
    await this.assertSimRestaurant(restaurantId);
    const db = this.dbService.supabase;
    const { data: existing } = await db
      .from("simpos_checks")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await db
      .from("simpos_checks")
      .insert({ restaurant_id: restaurantId, status: "open" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return created;
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
        loss += Number(l.unit_price_snapshot) * Number(l.qty);
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
    if (catalogIds.length > 0) {
      const { data: catalogRows } = await db
        .from("simpos_catalog")
        .select("id, external_item_id")
        .in("id", catalogIds);
      externalIdByCatalogId = new Map(
        (catalogRows || []).map((c: any) => [c.id, c.external_item_id]),
      );
    }

    const closedAt = new Date().toISOString();
    const { error: closeError } = await db
      .from("simpos_checks")
      .update({ status: "closed", closed_at: closedAt })
      .eq("id", checkId);
    if (closeError) throw new Error(closeError.message);

    const payload = {
      externalCheckId: checkId,
      openedAt: check.opened_at,
      closedAt,
      voided: false,
      items: activeLines.map((l) => ({
        name: l.item_name_snapshot,
        externalItemId: externalIdByCatalogId.get(l.catalog_id) ?? l.catalog_id,
        qty: l.qty,
        price: Number(l.unit_price_snapshot),
        // SimPOS's whole catalog is wine — every line is definitively wine,
        // so the hub's WINE_WORDS fallback (which "Opus One" would fail)
        // never needs to guess.
        is_wine: true,
      })),
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
      check: { ...check, status: "closed", closed_at: closedAt },
      lines,
      webhook: delivery,
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
    const url = `${this.internalApiBaseUrl}/pos-hub/webhook/generic_webhook/${restaurantId}`;
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
