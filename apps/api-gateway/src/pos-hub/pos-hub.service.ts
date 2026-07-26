import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CanonicalCheck } from "./pos-types";
import { ADAPTERS } from "./pos-adapters";
import {
  PROVIDER_BY_KEY,
  POS_PROVIDERS,
  registrySummary,
} from "./pos-provider.registry";

/**
 * PosHubService — the unified ingestion pipeline (the "foundation" wave).
 *
 * raw payload → adapter.normalize() → wine mapping (pos_item_mappings →
 * keyword heuristic) → table/server resolution → UPSERT pos_checks.
 * Idempotent on (restaurant_id, source, external_check_id), so webhook
 * replays and re-imports are safe.
 */
@Injectable()
export class PosHubService {
  private readonly logger = new Logger(PosHubService.name);

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

  constructor(private readonly dbService: DatabaseService) {}

  getProviders() {
    return { summary: registrySummary(), providers: POS_PROVIDERS };
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
          items,
          raw: check.raw ?? null,
        };
        const { error } = await client.from("pos_checks").upsert(row, {
          onConflict: "restaurant_id,source,external_check_id",
        });
        if (error) errors.push(`${check.externalCheckId}: ${error.message}`);
        else upserted++;
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
      .select("external_item_id, item_name, category, is_wine, master_wine_id")
      .eq("restaurant_id", restaurantId)
      .in("source", [source, "*"]);
    return data || [];
  }

  private resolveWine(
    name: string,
    externalItemId: string | null | undefined,
    mappings: any[],
  ): { isWine: boolean; masterWineId: string | null; category: string | null } {
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
      };
    }
    const isWine = PosHubService.WINE_WORDS.some((w) => lower.includes(w));
    return { isWine, masterWineId: null, category: null };
  }

  async upsertItemMapping(restaurantId: string, mapping: any) {
    const row = {
      restaurant_id: restaurantId,
      source: mapping.source || "*",
      external_item_id: mapping.external_item_id ?? "",
      item_name: mapping.item_name ?? "",
      category: mapping.category ?? null,
      is_wine: mapping.is_wine === true,
      master_wine_id: mapping.master_wine_id ?? null,
      inventory_id: mapping.inventory_id ?? null,
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
