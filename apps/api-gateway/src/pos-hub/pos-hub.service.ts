import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from "@nestjs/common";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import { CanonicalCheck } from "./pos-types";
import { ADAPTERS } from "./pos-adapters";
import {
  PROVIDER_BY_KEY,
  POS_PROVIDERS,
  registrySummary,
} from "./pos-provider.registry";

/**
 * PosHubService — the unified ingestion pipeline and the single POS door for
 * stock writes (SimPOS testbed plan, decision B13).
 *
 * raw payload → adapter.normalize() → wine mapping (pos_item_mappings →
 * keyword heuristic) → table/server resolution → UPSERT pos_checks → stock
 * depletion via apply_stock_movement/record_glass_pour for closed checks only
 * (decision B18). Idempotent on (restaurant_id, source, external_check_id)
 * for the check row, and on `pos:{source}:{externalCheckId}:{externalItemId}
 * :{lineNo}` (decision B15) for every stock write, so webhook replays and
 * re-imports are safe.
 */
@Injectable()
export class PosHubService {
  private readonly logger = new Logger(PosHubService.name);
  private readonly webhookSecret: string | null =
    process.env.POS_HUB_WEBHOOK_SECRET || null;

  // Multilingual wine keywords (incl. Turkish şarap) for the fallback
  // heuristic when no pos_item_mappings row exists yet.
  private static readonly WINE_WORDS = [
    "wine",
    "vino",
    "şarap",
    "sarap",
    "rosé",
    "rose ",
    "champagne",
    "prosecco",
    "cava",
    "brut",
    "chardonnay",
    "sauvignon",
    "riesling",
    "pinot",
    "merlot",
    "cabernet",
    "syrah",
    "shiraz",
    "malbec",
    "tempranillo",
    "nebbiolo",
    "sangiovese",
    "grenache",
    "zinfandel",
    "chianti",
    "bordeaux",
    "burgundy",
    "rioja",
    "barolo",
  ];

  constructor(
    private readonly dbService: DatabaseService,
    // Optional so the hub still boots (and ingests) if the notifications
    // module is unavailable — alerting is a side effect of depletion, never a
    // precondition for it.
    @Optional()
    @Inject(forwardRef(() => LowStockAlertsService))
    private readonly lowStockAlerts?: LowStockAlertsService,
  ) {}

  getProviders() {
    return { summary: registrySummary(), providers: POS_PROVIDERS };
  }

  // =========================================================================
  // Webhook auth (decision B17: the hub had no auth guard at all; decision
  // B28: SimPOS signs with a real HMAC secret so this path stays exercised)
  // =========================================================================

  /**
   * Verify an inbound webhook's HMAC-SHA256 signature against the raw request
   * body. Fails closed: no configured secret means every signed request is
   * rejected, matching decision B16's fail-closed posture elsewhere in the
   * ingress path. `POS_HUB_WEBHOOK_SECRET` is unset -> reject.
   */
  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | null | undefined,
  ): boolean {
    if (!this.webhookSecret) {
      this.logger.error(
        "POS_HUB_WEBHOOK_SECRET not configured — rejecting webhook (fail closed)",
      );
      return false;
    }
    if (!signature || !rawBody) return false;
    try {
      const expected = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(rawBody)
        .digest("hex");
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(signature.toLowerCase(), "hex");
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification error: ${err?.message}`,
      );
      return false;
    }
  }

  // =========================================================================
  // Ingestion
  // =========================================================================

  async ingest(
    restaurantId: string,
    providerKey: string,
    payload: unknown,
  ): Promise<{
    provider: string;
    received: number;
    upserted: number;
    wineItemsDetected: number;
    errors: string[];
  }> {
    const provider = PROVIDER_BY_KEY[providerKey];
    if (!provider) throw new Error(`Unknown POS provider '${providerKey}'`);
    const adapter = ADAPTERS[providerKey];
    if (!adapter)
      throw new Error(
        `Provider '${providerKey}' is ${provider.status} — no adapter yet. Use 'generic_webhook' or 'csv_import' to bridge it today.`,
      );

    const checks = adapter.normalize(payload);
    const errors: string[] = [];
    if (!checks.length)
      return {
        provider: providerKey,
        received: 0,
        upserted: 0,
        wineItemsDetected: 0,
        errors: ["No recognizable checks in payload"],
      };

    const [mappings, tables] = await Promise.all([
      this.loadItemMappings(restaurantId, providerKey),
      this.loadTables(restaurantId),
    ]);

    let upserted = 0;
    let wineItems = 0;
    const client = this.dbService.getClient();

    for (const check of checks) {
      try {
        const items = check.items.map((it) => {
          const mapped = this.resolveWine(it.name, it.externalItemId, mappings);
          const is_wine =
            typeof it.is_wine === "boolean" ? it.is_wine : mapped.isWine;
          if (is_wine) wineItems++;
          return {
            name: it.name,
            external_item_id: it.externalItemId ?? null,
            category: it.category ?? mapped.category ?? null,
            qty: it.qty,
            price: it.price,
            is_wine,
            master_wine_id: it.master_wine_id ?? mapped.masterWineId ?? null,
            inventory_id: mapped.inventoryId,
            sale_unit: mapped.saleUnit,
          };
        });

        const row = {
          restaurant_id: restaurantId,
          source: providerKey,
          external_check_id: check.externalCheckId,
          table_id: this.resolveTable(check.tableRef, providerKey, tables),
          server_external_id: check.serverExternalId ?? null,
          server_name: check.serverName ?? null,
          opened_at: check.openedAt,
          closed_at: check.closedAt ?? null,
          covers: check.covers ?? null,
          subtotal: check.subtotal ?? null,
          total: check.total ?? null,
          tip: check.tip ?? null,
          // Persisted from 2026-08-24. `voided` had driven stock reversal
          // (isVoid, below) since the contract was written, but was never
          // written to the row — and the column did not exist. A voided check
          // therefore returned its stock correctly and stayed revenue forever,
          // because every reader sums `total` with nothing to filter on.
          voided: check.voided === true,
          items,
          raw: check.raw ?? null,
        };
        const { error } = await client.from("pos_checks").upsert(row, {
          onConflict: "restaurant_id,source,external_check_id",
        });
        if (error) {
          errors.push(`${check.externalCheckId}: ${error.message}`);
        } else {
          upserted++;
          // B18: only closed/paid checks deplete — an open check is
          // analytics-only until closedAt lands (possibly on a later replay
          // of the same externalCheckId, which the upsert above just handled).
          if (check.closedAt) {
            await this.applyStockEffects(
              restaurantId,
              providerKey,
              check,
              items,
            );
          }
        }
      } catch (err: any) {
        errors.push(`${check.externalCheckId}: ${err?.message}`);
      }
    }

    this.logger.log(
      `POS ingest [${providerKey}] r=${restaurantId}: ${upserted}/${checks.length} checks, ${wineItems} wine items`,
    );
    return {
      provider: providerKey,
      received: checks.length,
      upserted,
      wineItemsDetected: wineItems,
      errors,
    };
  }

  // =========================================================================
  // Item mappings (pos_item_mappings) + wine heuristic
  // =========================================================================

  private async loadItemMappings(restaurantId: string, source: string) {
    const { data } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select(
        "external_item_id, item_name, category, is_wine, master_wine_id, inventory_id, sale_unit",
      )
      .eq("restaurant_id", restaurantId)
      .in("source", [source, "*"]);
    return data || [];
  }

  /**
   * Mapping-table-first resolution (decision B21): a `pos_item_mappings` hit
   * — by external id first, then exact name — is authoritative and is the
   * only source that can produce an `inventoryId`/`saleUnit` (decision B36:
   * sale unit never inferred from the item name). WINE_WORDS is a
   * best-effort fallback used only to flag likely-wine items that have no
   * mapping yet, so they get queued in pos_unresolved_lines instead of
   * vanishing — it never has enough information to resolve a stock target.
   */
  private resolveWine(
    name: string,
    externalItemId: string | null | undefined,
    mappings: any[],
  ): {
    isWine: boolean;
    masterWineId: string | null;
    category: string | null;
    inventoryId: string | null;
    saleUnit: "glass" | "bottle" | null;
  } {
    const lower = (name || "").toLowerCase();
    const byId = externalItemId
      ? mappings.find(
          (m) => m.external_item_id && m.external_item_id === externalItemId,
        )
      : null;
    const byName =
      byId ??
      mappings.find(
        (m) => m.item_name && lower === String(m.item_name).toLowerCase(),
      );
    if (byName) {
      return {
        isWine: byName.is_wine === true,
        masterWineId: byName.master_wine_id ?? null,
        category: byName.category ?? null,
        inventoryId: byName.inventory_id ?? null,
        saleUnit: (byName.sale_unit as "glass" | "bottle" | null) ?? null,
      };
    }
    const isWine = PosHubService.WINE_WORDS.some((w) => lower.includes(w));
    return {
      isWine,
      masterWineId: null,
      category: null,
      inventoryId: null,
      saleUnit: null,
    };
  }

  // =========================================================================
  // Stock effects (decision B13/B18/B19/B20) — closed checks only
  // =========================================================================

  private async applyStockEffects(
    restaurantId: string,
    source: string,
    check: CanonicalCheck,
    items: Array<{
      name: string;
      external_item_id: string | null;
      qty: number;
      price: number;
      is_wine: boolean;
      inventory_id: string | null;
      sale_unit: "glass" | "bottle" | null;
    }>,
  ): Promise<void> {
    const db = this.dbService.getClient();
    const isVoid = check.voided === true;
    const affected = new Set<string>();

    for (let lineNo = 0; lineNo < items.length; lineNo++) {
      const it = items[lineNo];
      // Stock-scoped skip only. The full line set — food included — was
      // already persisted verbatim to pos_checks.items at the upsert above
      // (ingest(), ~line 202), before this loop runs, and is already read by
      // TableAnalyticsService.getBasketAffinity() for wine/dish co-occurrence
      // with no is_wine filter. Do not read this line as "food is discarded" —
      // it isn't; only stock depletion (which food has no inventory row for)
      // is skipped here. See .planning/BEVERAGE_CATALOGUE_PLAN.md register A11.
      if (!it.is_wine) continue;

      const qty = Math.max(0, Math.round(Number(it.qty) || 0));
      if (qty <= 0) continue;

      try {
        if (!it.inventory_id) {
          // B20: an unmapped wine line is queued for review, never dropped.
          // supabase-js resolves with { error } rather than throwing on a
          // constraint violation, so the dedupe check happens on the
          // result, not in a catch block. The partial unique index on
          // (restaurant_id, source, external_check_id, external_item_id)
          // WHERE NOT resolved means a 23505 here just means it's already
          // queued and open — not a real failure.
          const { error: queueError } = await db
            .from("pos_unresolved_lines")
            .insert({
              restaurant_id: restaurantId,
              source,
              external_check_id: check.externalCheckId,
              external_item_id: it.external_item_id,
              item_name: it.name,
              qty: it.qty,
              price: it.price,
              raw: it,
            });
          if (queueError && queueError.code !== "23505") {
            this.logger.warn(
              `Failed to queue unresolved line ${it.name}: ${queueError.message}`,
            );
          }
          continue;
        }

        // B15: depletion idempotency key.
        const idem = `pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}`;
        const unit = it.sale_unit ?? "bottle"; // B36: default, never name-inferred

        // supabase-js resolves RPC failures as { error } rather than
        // throwing, so — as in the receiving-door bug this plan's spine
        // repair fixed — the error field must be checked explicitly or a
        // failed depletion reports success silently.
        let rpcError: { message?: string } | null = null;
        if (unit === "glass") {
          if (isVoid) {
            // B19: voids reverse glasses as well as bottles.
            // record_glass_pour has no reversal mode, so a glass void is
            // booked as a live-stock return of the equivalent glass count.
            ({ error: rpcError } = await db.rpc("apply_stock_movement", {
              p_inventory_id: it.inventory_id,
              p_stock_state: "live",
              p_delta: qty,
              p_transaction_type: "return",
              p_source: "pos",
              p_reason: `POS void (glass): ${it.name}`,
              p_idempotency_key: idem,
            }));
          } else {
            ({ error: rpcError } = await db.rpc("record_glass_pour", {
              p_inventory_id: it.inventory_id,
              p_pours: qty,
              p_pour_ml: null,
              p_location_id: null,
              p_source: "pos",
              p_reason: `POS sale: ${it.name}`,
              p_idempotency_key: idem,
            }));
          }
        } else {
          ({ error: rpcError } = await db.rpc("apply_stock_movement", {
            p_inventory_id: it.inventory_id,
            p_stock_state: "live",
            p_delta: isVoid ? qty : -qty,
            p_transaction_type: isVoid ? "return" : "sale",
            p_source: "pos",
            p_reason: `POS ${isVoid ? "void" : "sale"}: ${it.name}`,
            p_idempotency_key: idem,
          }));
        }

        if (rpcError) {
          this.logger.warn(
            `Stock effect failed for ${it.name} (${unit}) on check ${check.externalCheckId}: ${rpcError.message}`,
          );
        } else {
          affected.add(it.inventory_id);
          if (!isVoid) {
            await this.recordConsumption(restaurantId, it, unit, qty, idem);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Stock effect threw for ${it.name} on check ${check.externalCheckId}: ${err?.message}`,
        );
      }
    }

    if (affected.size > 0) {
      this.logger.debug(
        `POS ${isVoid ? "void" : "close"} [${source}] check=${check.externalCheckId}: stock updated for ${affected.size} item(s)`,
      );
      // Real-time low-stock edge check for every wine this check touched —
      // the same call ToastService makes after its own depletion loop.
      // Without it only Toast raised par alerts, while the generic webhook
      // path (the documented bridge for every other POS in the registry)
      // depleted stock silently. Fire-and-forget: alerting must never slow
      // or block POS ingestion.
      if (this.lowStockAlerts) {
        void this.lowStockAlerts
          .evaluateInventoryItems(restaurantId, [...affected])
          .catch(() => undefined);
      }
    }
  }

  /**
   * Mirror a depleting POS sale into `wine_consumption_log`.
   *
   * That table is the demand series behind essentially all of the
   * consumption-side analytics — velocity, XYZ classification, reorder point
   * and safety stock, the Holt-Winters forecast, consumption insights, goal
   * progress and the dashboard's pour panels all SELECT from it. Until now
   * nothing in the codebase ever INSERTed a row: POS sales landed only in
   * `inventory_transactions`, so every one of those surfaces read an empty
   * series and reported zero demand forever, for every restaurant. The
   * table's own CHECK constraint (`source IN ('manual','pos','ai_agent')`)
   * shows a POS writer was always the intent.
   *
   * Deliberately non-fatal and after the fact: stock depletion is the
   * contract of this path, and a analytics-mirror failure must never roll it
   * back or block the webhook. Voids are excluded — a voided line never
   * happened, so it is not consumption.
   */
  private async recordConsumption(
    restaurantId: string,
    item: {
      name: string;
      qty: number;
      price: number;
      inventory_id: string | null;
    },
    unit: "glass" | "bottle",
    qty: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (!item.inventory_id) return;
    try {
      const db = this.dbService.getClient();
      const { data: inv } = await db
        .from("restaurant_inventory")
        .select("bottle_size_ml, pour_size_ml, menu_price_current")
        .eq("id", item.inventory_id)
        .maybeSingle();

      const bottleMl = Number(inv?.bottle_size_ml) || 750;
      const pourMl = Number(inv?.pour_size_ml) || 150;
      const volumeMl = unit === "glass" ? pourMl * qty : bottleMl * qty;
      const unitPrice =
        Number(item.price) || Number(inv?.menu_price_current) || null;

      // Idempotent from 2026-08-24, matching the stock write it follows.
      //
      // The caller reaches here whenever apply_stock_movement returned no error
      // — but that RPC is idempotent and returns the EXISTING transaction for a
      // known key, so "no error" does not mean "this depleted just now". The
      // bare insert that used to be here therefore left stock correct and the
      // consumption log inflated: one check line replayed twice produced three
      // rows. Stock is the number a human checks; the log is the series behind
      // velocity, XYZ, reorder points, Holt-Winters and goal progress. Drifting
      // the invisible one is the worse failure.
      //
      // `ignoreDuplicates` needs the unique index from
      // 20260824190000_pos_voided_and_consumption_idempotency.sql — the
      // constraint lives in the database so a second caller cannot reintroduce
      // this by writing its own insert.
      //
      // `notes` is the idempotency key verbatim. It used to be `pos:${key}`
      // while the key already began with "pos:", rendering "pos:pos:…".
      await db.from("wine_consumption_log").upsert(
        {
          restaurant_id: restaurantId,
          inventory_id: item.inventory_id,
          wine_name: item.name,
          consumption_type: unit,
          quantity: qty,
          volume_ml: volumeMl,
          unit_price: unitPrice,
          total_revenue: unitPrice != null ? unitPrice * qty : null,
          source: "pos",
          notes: idempotencyKey,
        },
        { onConflict: "restaurant_id,notes", ignoreDuplicates: true },
      );
    } catch (err: any) {
      this.logger.warn(
        `Consumption log write failed for ${item.name}: ${err?.message}`,
      );
    }
  }

  async upsertItemMapping(restaurantId: string, mapping: any) {
    // sale_unit was missing from this row until 2026-08-24, and this is the ONLY
    // writer of the column — used by both auto-map and human approve. So all 92
    // production mappings carried sale_unit = null, the `?? "bottle"` fallback in
    // applyStockEffects fired unconditionally, and EVERY BY-THE-GLASS SALE
    // DEPLETED A WHOLE BOTTLE. Confirmed at runtime: a glass-priced item booked
    // volume_ml 750 instead of 150.
    //
    // Unrecognised values are rejected rather than coerced. Writing a wrong unit
    // is worse than writing none: null at least routes to a documented default,
    // while "Glass " or "bottles" would silently take the same fallback while
    // looking mapped in the UI.
    const rawUnit = mapping.sale_unit ?? null;
    if (rawUnit !== null && rawUnit !== "glass" && rawUnit !== "bottle") {
      throw new Error(
        `sale_unit must be "glass", "bottle", or null — got ${JSON.stringify(rawUnit)}`,
      );
    }
    const row = {
      restaurant_id: restaurantId,
      source: mapping.source || "*",
      external_item_id: mapping.external_item_id ?? "",
      item_name: mapping.item_name ?? "",
      category: mapping.category ?? null,
      is_wine: mapping.is_wine === true,
      master_wine_id: mapping.master_wine_id ?? null,
      inventory_id: mapping.inventory_id ?? null,
      sale_unit: rawUnit as "glass" | "bottle" | null,
      updated_at: new Date().toISOString(),
    };
    if (!row.external_item_id && !row.item_name)
      throw new Error("Mapping needs external_item_id or item_name");
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .upsert(row, {
        onConflict: "restaurant_id,source,external_item_id,item_name",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async listItemMappings(restaurantId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // =========================================================================
  // Table resolution + status
  // =========================================================================

  private async loadTables(restaurantId: string) {
    const { data } = await this.dbService
      .getClient()
      .from("restaurant_tables")
      .select("id, label, pos_refs")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    return data || [];
  }

  private resolveTable(
    tableRef: string | null | undefined,
    source: string,
    tables: any[],
  ): string | null {
    if (!tableRef) return null;
    const ref = String(tableRef).toLowerCase();
    for (const t of tables) {
      const posRef = t.pos_refs?.[source];
      if (posRef && String(posRef).toLowerCase() === ref) return t.id;
    }
    const byLabel = tables.find(
      (t) =>
        String(t.label).toLowerCase() === ref ||
        `table ${String(t.label).toLowerCase()}` === ref,
    );
    return byLabel?.id ?? null;
  }

  async getStatus(restaurantId: string) {
    const client = this.dbService.getClient();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await client
      .from("pos_checks")
      .select("source, opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", since30);
    const rows = data || [];
    const bySource = new Map<
      string,
      { checks: number; open: number; latest: string | null }
    >();
    for (const r of rows) {
      const s = bySource.get(r.source) || { checks: 0, open: 0, latest: null };
      s.checks++;
      if (!r.closed_at) s.open++;
      if (!s.latest || r.opened_at > s.latest) s.latest = r.opened_at;
      bySource.set(r.source, s);
    }
    return {
      windowDays: 30,
      totalChecks: rows.length,
      sources: Array.from(bySource.entries()).map(([source, s]) => ({
        source,
        providerName: PROVIDER_BY_KEY[source]?.name ?? source,
        ...s,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
