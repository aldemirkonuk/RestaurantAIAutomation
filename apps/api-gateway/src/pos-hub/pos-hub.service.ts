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
 * `record_glass_pour` COALESCEs a missing `bottle_size_ml` to 750 before it
 * subtracts a pour (baseline_from_production.sql:1148). Mirrored here so the
 * "a pour can never exceed the container it comes from" guard below reasons
 * about the same number the database will.
 */
const RPC_DEFAULT_BOTTLE_ML = 750;

/** Below this, a value is a unit mistake (litres typed into an ml field). */
const MIN_PLAUSIBLE_SALE_ML = 10;
/** Above this, likewise — a Melchizedek is 30 000ml and nothing pours more. */
const MAX_PLAUSIBLE_SALE_ML = 30000;

/** The inventory facts a depletion needs. Nulls are real: see ADR 0011. */
interface InventoryVolumes {
  bottleMl: number | null;
  pourMl: number | null;
  menuPrice: number | null;
}

/**
 * How much stock one sale of a POS item removes (ADR 0011).
 *
 * `whole_bottle` is a unit move on `apply_stock_movement`; `volume` is an
 * arbitrary ml draw routed through `record_glass_pour`'s `p_pour_ml`. There is
 * deliberately no "assume a bottle" arm — an unresolvable line resolves to
 * `unresolved` and is queued.
 *
 * Discriminated on `mode` rather than an `ok` boolean: this package compiles
 * with `strictNullChecks: false` (tsconfig.json), under which boolean literal
 * discriminants do not narrow.
 */
export type SaleVolume =
  | { mode: "whole_bottle" }
  | { mode: "volume"; ml: number }
  | { mode: "unresolved"; reason: string };

/** A sale volume that resolved — i.e. one that may touch stock. */
export type ResolvedSaleVolume = Exclude<SaleVolume, { mode: "unresolved" }>;

/**
 * Resolve one line's depletion, in the order locked by ADR 0011:
 * `sale_volume_ml` → `sale_unit` + the inventory row → fail closed.
 *
 * Pure and exported so the Toast door (`toast.service.ts:502`, which still
 * carries its own `?? "bottle"`) can adopt the same contract without a second
 * implementation of it, and so the resolution can be tested without a database.
 */
export function resolveSaleVolume(
  saleVolumeMl: number | null | undefined,
  saleUnit: string | null | undefined,
  inv: InventoryVolumes | null,
): SaleVolume {
  const label =
    typeof saleUnit === "string" ? saleUnit.trim().toLowerCase() : null;

  // 1. An explicit volume is the truth and outranks the label. A mapping that
  //    says "glass" and "60ml" sells a 60ml taster, not a 150ml pour.
  if (saleVolumeMl !== null && saleVolumeMl !== undefined) {
    const ml = Number(saleVolumeMl);
    if (!Number.isFinite(ml) || ml < MIN_PLAUSIBLE_SALE_ML) {
      return {
        mode: "unresolved",
        reason: `sale_volume_ml ${saleVolumeMl} is not a usable volume`,
      };
    }
    // A pour is taken out of ONE container. Asking for more than the container
    // holds drives inventory_lots.open_bottle_ml negative rather than failing —
    // silent lot corruption, which is worse than the under-depletion we accept
    // everywhere else here. Queue it instead: the mapping points at the wrong
    // inventory row.
    const capacity = inv?.bottleMl ?? RPC_DEFAULT_BOTTLE_ML;
    if (ml > capacity) {
      return {
        mode: "unresolved",
        reason: `sale_volume_ml ${ml} exceeds the ${capacity}ml container it pours from`,
      };
    }
    // Selling exactly one container IS a whole-bottle sale, so it books as one
    // rather than as a pour that happens to empty a bottle.
    if (inv?.bottleMl != null && ml === inv.bottleMl)
      return { mode: "whole_bottle" };
    return { mode: "volume", ml };
  }

  // 2. Derive from the label. Only these two carry a derivation; every other
  //    label is a reporting word with no arithmetic attached to it.
  if (label === "bottle") {
    // Deliberately does not consult the inventory row: bottle_size_ml is
    // nullable in production and a unit move never needed it.
    return { mode: "whole_bottle" };
  }
  if (label === "glass") {
    if (inv?.pourMl == null) {
      return {
        mode: "unresolved",
        reason:
          "sale_unit 'glass' but the inventory row carries no pour_size_ml",
      };
    }
    return { mode: "volume", ml: inv.pourMl };
  }

  // 3. Fail closed. This is where the 92 production mappings land.
  return {
    mode: "unresolved",
    reason: label
      ? `sale_unit '${label}' carries no volume — set sale_volume_ml`
      : "neither sale_volume_ml nor a derivable sale_unit",
  };
}

/**
 * Which rung of the secret chain authenticated a webhook. Ordered most
 * specific first; `legacy_global` is the pre-existing process-wide key and is
 * the only rung that is NOT bound to a provider or a tenant.
 */
export type WebhookSecretSource =
  | "per_connection"
  | "per_provider"
  | "legacy_global";

export interface ResolvedWebhookSecret {
  secret: string;
  source: WebhookSecretSource;
  envVar: string;
}

/** Env-var-safe token: `generic_webhook` -> `GENERIC_WEBHOOK`. */
function envToken(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
}

/**
 * The two scoped env vars a (provider, restaurant) pair may be keyed by.
 * Exported so operators and tests name them from one place rather than
 * re-deriving the string. `__` separates the two tokens because provider keys
 * themselves contain `_` (`ncr_aloha`), and a single separator would make
 * `POS_WEBHOOK_SECRET_NCR_ALOHA` ambiguous.
 */
export function webhookSecretEnvVars(
  providerKey: string,
  restaurantId: string,
): { perConnection: string; perProvider: string } {
  const provider = envToken(providerKey);
  return {
    perConnection: `POS_WEBHOOK_SECRET_${provider}__${envToken(restaurantId)}`,
    perProvider: `POS_WEBHOOK_SECRET_${provider}`,
  };
}

/**
 * The message a scoped signature covers.
 *
 * The provider and the restaurant are inside the signed bytes, not merely
 * beside them, so one provider-wide secret still cannot mint a signature that
 * authenticates a different tenant's payload — the same reason Toast signs
 * `timestamp.body` rather than `body` (toast.service.ts:152).
 */
function scopedSignedPayload(
  providerKey: string,
  restaurantId: string,
  rawBody: Buffer | string,
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  return `${providerKey}:${restaurantId}.${body}`;
}

/** Identity the webhook route claims, and which this must bind the key to. */
export interface WebhookContext {
  provider: string;
  restaurantId: string;
}

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

  /**
   * Which (source, provider, restaurant) triples have already been logged, so
   * a route that takes production webhook volume states its key resolution
   * once rather than on every request. Bounded: `restaurantId` comes off an
   * unauthenticated path, so an attacker could otherwise grow this set without
   * limit by varying it.
   */
  private readonly loggedSecretResolutions = new Set<string>();
  private static readonly MAX_LOGGED_RESOLUTIONS = 500;

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

  /** Log a key-resolution outcome once per (source, provider, restaurant). */
  private logSecretResolutionOnce(key: string, emit: () => void): void {
    if (this.loggedSecretResolutions.has(key)) return;
    // Overflow clears rather than stops deduping: memory stays bounded and the
    // route keeps reporting, at the cost of repeating a line after 500 pairs.
    if (
      this.loggedSecretResolutions.size >= PosHubService.MAX_LOGGED_RESOLUTIONS
    ) {
      this.loggedSecretResolutions.clear();
    }
    this.loggedSecretResolutions.add(key);
    emit();
  }

  /**
   * Resolve the HMAC key for one (provider, restaurant), most specific first:
   *
   *   1. `POS_WEBHOOK_SECRET_<PROVIDER>__<RESTAURANT_ID>` — per connection.
   *   2. `POS_WEBHOOK_SECRET_<PROVIDER>`                  — per provider.
   *   3. `POS_HUB_WEBHOOK_SECRET`                         — legacy, global.
   *
   * The first rung that is SET wins; a rung being set is therefore the cutover
   * switch for everything below it. Configuring (1) or (2) for a provider
   * stops the legacy global key from authenticating that provider at all —
   * deliberate, because a fallback that runs after a scoped signature fails is
   * not a fallback, it is the hole still being open.
   *
   * Returns null when nothing is configured. Callers must reject on null.
   */
  private resolveWebhookSecret(
    providerKey: string,
    restaurantId: string,
  ): ResolvedWebhookSecret | null {
    const { perConnection, perProvider } = webhookSecretEnvVars(
      providerKey,
      restaurantId,
    );

    const rungs: Array<{ source: WebhookSecretSource; envVar: string }> = [
      { source: "per_connection", envVar: perConnection },
      { source: "per_provider", envVar: perProvider },
      { source: "legacy_global", envVar: "POS_HUB_WEBHOOK_SECRET" },
    ];

    for (const rung of rungs) {
      const secret = process.env[rung.envVar];
      if (!secret) continue;
      const logKey = `${rung.source}:${providerKey}:${restaurantId}`;
      this.logSecretResolutionOnce(logKey, () => {
        if (rung.source === "legacy_global") {
          this.logger.warn(
            `POS webhook [${providerKey}] r=${restaurantId} is authenticating with the ` +
              `legacy process-wide POS_HUB_WEBHOOK_SECRET, which is shared by every ` +
              `provider and every tenant. Set ${perProvider} (or ${perConnection}) to ` +
              `bind this door to one provider and one restaurant.`,
          );
        } else {
          this.logger.log(
            `POS webhook [${providerKey}] r=${restaurantId} keyed by ${rung.envVar} (${rung.source})`,
          );
        }
      });
      return { secret, source: rung.source, envVar: rung.envVar };
    }

    return null;
  }

  /**
   * Verify an inbound webhook's HMAC-SHA256 signature.
   *
   * Fails closed on every path: an unknown provider, a blank context, a
   * missing signature or body, and — decision B16's posture — no configured
   * secret all reject. There is no arm that returns true without a key.
   *
   * The signature is bound to the identity the URL claims. A scoped key signs
   * `"<provider>:<restaurantId>." + rawBody`, so a signature minted for one
   * tenant does not authenticate another's payload even when both sit behind
   * the same provider-wide secret. Before this, one process-wide key covered
   * all 27 providers and every restaurant while the route read `restaurantId`
   * straight out of the path and never bound it to anything — so a signature
   * valid for restaurant A was valid for restaurant B's URL, and holding the
   * secret meant stock writes for any tenant (POS-BRIDGE-AUDIT.md §2.4, OD-B).
   *
   * The legacy global key keeps its original unscoped scheme (HMAC over the
   * raw body alone) so today's signers — SimPOS `sendSignedWebhook`
   * (simpos.service.ts:490) and `scripts/simulate/bridge.py` — keep working
   * until a scoped secret is configured. Every acceptance on that rung is
   * logged as the open door it is.
   */
  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signature: string | null | undefined,
    context: WebhookContext,
  ): boolean {
    const providerKey = context?.provider?.trim();
    const restaurantId = context?.restaurantId?.trim();
    if (!providerKey || !restaurantId) {
      this.logger.error(
        "POS webhook rejected: signature verification requires a provider and a restaurant to key on",
      );
      return false;
    }

    // An unrecognized provider is rejected here rather than deeper in
    // `ingest`, so an unauthenticated caller cannot probe the registry and no
    // secret is ever matched against a provider we do not serve.
    const provider = PROVIDER_BY_KEY[providerKey];
    if (!provider) {
      this.logSecretResolutionOnce(`unknown:${providerKey}`, () =>
        this.logger.error(
          `POS webhook rejected: unknown provider '${providerKey}'`,
        ),
      );
      return false;
    }

    const resolved = this.resolveWebhookSecret(providerKey, restaurantId);
    if (!resolved) {
      const { perConnection, perProvider } = webhookSecretEnvVars(
        providerKey,
        restaurantId,
      );
      this.logSecretResolutionOnce(
        `missing:${providerKey}:${restaurantId}`,
        () =>
          this.logger.error(
            `POS webhook rejected (fail closed): no secret configured for provider ` +
              `'${providerKey}'${provider.status === "available" ? " — which the registry marks AVAILABLE, so this door is advertised and shut" : ""}. ` +
              `Set ${perProvider}, ${perConnection}, or the legacy POS_HUB_WEBHOOK_SECRET.`,
          ),
      );
      return false;
    }

    if (!signature || !rawBody) return false;

    try {
      const signedPayload =
        resolved.source === "legacy_global"
          ? rawBody
          : scopedSignedPayload(providerKey, restaurantId, rawBody);

      const expected = crypto
        .createHmac("sha256", resolved.secret)
        .update(signedPayload)
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

    const [mappingLookup, tableLookup] = await Promise.all([
      this.loadItemMappings(restaurantId, providerKey),
      this.loadTables(restaurantId),
    ]);
    const mappings = mappingLookup.rows;
    if (mappingLookup.error) errors.push(mappingLookup.error);
    const tables = tableLookup.tables;
    // Degrade, do not reject: table resolution is an enrichment, so a failed
    // lookup must not turn into a 500 the POS retries forever. But it is SAID,
    // through the same `errors` channel a failed check upsert uses, so the
    // ingest can no longer report a clean success over a lookup that failed.
    if (tableLookup.error) errors.push(tableLookup.error);

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
            sale_volume_ml: mapped.saleVolumeMl,
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

  /**
   * Same shape as `loadTables` below, for the same reason.
   *
   * A failed read here returned `[]`, and `resolveWine` finds nothing in an
   * empty array — so every line on every check ingested with
   * `inventory_id: null`, `is_wine` from the name heuristic only, and no
   * depletion. The ingest then reported `errors: []`. That is the mechanism
   * that manufactures "the POS bridge stopped mapping" as a silent condition.
   *
   * An empty mapping table is NOT an error (a restaurant that has mapped
   * nothing yet is normal) and is never reported as one; only a real failure
   * is, through the same `errors` channel a failed check upsert uses.
   */
  private async loadItemMappings(
    restaurantId: string,
    source: string,
  ): Promise<{ rows: any[]; error: string | null }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_item_mappings")
      .select(
        "external_item_id, item_name, category, is_wine, master_wine_id, inventory_id, sale_unit, sale_volume_ml",
      )
      .eq("restaurant_id", restaurantId)
      .in("source", [source, "*"]);
    if (error) {
      this.logger.error(
        `pos_item_mappings lookup failed for r=${restaurantId} src=${source} — ` +
          `every line will ingest unmapped rather than wrongly mapped: ${error.message}`,
      );
      return { rows: [], error: `pos_item_mappings: ${error.message}` };
    }
    return { rows: data || [], error: null };
  }

  /**
   * One batched read of every inventory row a check touches.
   *
   * Depletion needs `bottle_size_ml`/`pour_size_ml` to resolve a sale volume
   * (ADR 0011) and the consumption mirror needs `menu_price_current`; this
   * replaces the per-line `maybeSingle()` that mirror used to issue on its own,
   * so a 20-line check costs one query rather than twenty.
   */
  private async loadInventoryVolumes(
    inventoryIds: string[],
  ): Promise<Map<string, InventoryVolumes>> {
    const out = new Map<string, InventoryVolumes>();
    if (!inventoryIds.length) return out;
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_inventory")
      .select("id, bottle_size_ml, pour_size_ml, menu_price_current")
      .in("id", inventoryIds);
    // An empty map is the safe degrade — resolveSaleVolume queues the line
    // rather than guessing a volume (ADR 0011) — but it must not be silent:
    // a failed read here queues an ENTIRE service as unresolved and looks
    // exactly like a restaurant whose inventory rows all vanished.
    if (error)
      this.logger.error(
        `restaurant_inventory volume lookup failed for ${inventoryIds.length} ` +
          `id(s) — every wine line on this check will queue as unresolved ` +
          `rather than deplete by a guessed volume: ${error.message}`,
      );
    for (const row of data || []) {
      const positive = (v: unknown) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      out.set(row.id, {
        bottleMl: positive(row.bottle_size_ml),
        pourMl: positive(row.pour_size_ml),
        menuPrice: positive(row.menu_price_current),
      });
    }
    return out;
  }

  /**
   * Mapping-table-first resolution (decision B21): a `pos_item_mappings` hit
   * — by external id first, then exact name — is authoritative and is the
   * only source that can produce an `inventoryId`/`saleUnit`/`saleVolumeMl`
   * (decision B36: sale unit never inferred from the item name — and per ADR
   * 0011, neither is sale volume, even though `normalizeDescription()` could
   * read "1.5L magnum" out of a name. A POS catalog's size is the size of the
   * bottle a by-the-glass SKU is poured FROM, so parsing it would rebuild the
   * bottle default under a new name). WINE_WORDS is a
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
    saleUnit: string | null;
    saleVolumeMl: number | null;
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
        saleUnit: (byName.sale_unit as string | null) ?? null,
        saleVolumeMl:
          byName.sale_volume_ml == null ? null : Number(byName.sale_volume_ml),
      };
    }
    const isWine = PosHubService.WINE_WORDS.some((w) => lower.includes(w));
    return {
      isWine,
      masterWineId: null,
      category: null,
      inventoryId: null,
      saleUnit: null,
      saleVolumeMl: null,
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
      sale_unit: string | null;
      sale_volume_ml: number | null;
    }>,
  ): Promise<void> {
    const db = this.dbService.getClient();
    const isVoid = check.voided === true;
    const affected = new Set<string>();

    // One read for the whole check (ADR 0011): resolving a sale volume needs
    // the inventory row's bottle/pour sizes before any RPC is issued.
    const inventories = await this.loadInventoryVolumes([
      ...new Set(
        items
          .filter((it) => it.is_wine && it.inventory_id)
          .map((it) => it.inventory_id as string),
      ),
    ]);

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
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "unmapped",
            mappedInventoryId: null,
            detail: "no pos_item_mappings row resolves this line to stock",
          });
          continue;
        }

        // ADR 0011: sale_volume_ml → sale_unit + inventory → queue. There is
        // no `?? "bottle"` any more. Until 2026-08-25 this line read
        // `it.sale_unit ?? "bottle"`, and because upsertItemMapping never wrote
        // the column, all 92 production mappings took that branch: every
        // by-the-glass sale booked 750ml instead of 150.
        const inv = inventories.get(it.inventory_id) ?? null;
        const resolved = resolveSaleVolume(
          it.sale_volume_ml,
          it.sale_unit,
          inv,
        );
        if (resolved.mode === "unresolved") {
          // Fail closed, exactly as the unmapped branch above does. This
          // UNDER-depletes — stock reads high until a human works the queue —
          // which is the trade recorded in ADR 0011 against a default that
          // OVER-depleted by 5x with nothing to show for it.
          await this.queueUnresolvedLine(restaurantId, source, check, it, {
            reason: "no_sale_volume",
            mappedInventoryId: it.inventory_id,
            detail: resolved.reason,
          });
          continue;
        }

        // B15: depletion idempotency key.
        const idem = `pos:${source}:${check.externalCheckId}:${it.external_item_id ?? it.name}:${lineNo}`;
        // Reporting label only — never arithmetic (ADR 0011).
        const label = it.sale_unit ?? resolved.mode;

        // supabase-js resolves RPC failures as { error } rather than
        // throwing, so — as in the receiving-door bug this plan's spine
        // repair fixed — the error field must be checked explicitly or a
        // failed depletion reports success silently.
        let rpcError: { message?: string } | null = null;
        if (resolved.mode === "volume" && !isVoid) {
          // record_glass_pour has taken an arbitrary p_pour_ml since the
          // baseline (baseline_from_production.sql:1132); the app layer was
          // the only binary part. It is passed explicitly rather than as null
          // so the ml that moves stock and the ml written to the consumption
          // log are the same number, decided here.
          ({ error: rpcError } = await db.rpc("record_glass_pour", {
            p_inventory_id: it.inventory_id,
            p_pours: qty,
            p_pour_ml: Math.round(resolved.ml),
            p_location_id: null,
            p_source: "pos",
            p_reason: `POS sale (${label}): ${it.name}`,
            p_idempotency_key: idem,
          }));
        } else {
          // Whole-bottle sales, and every void.
          //
          // B19 (unchanged, and wrong — see ADR 0011 Consequences): a partial-
          // volume void returns `qty` WHOLE BOTTLES because record_glass_pour
          // has no reversal mode. Voiding 5 glasses returns 5 bottles. Left as
          // it is because B19 is a recorded decision; superseding it is the
          // founder's call, not this change's.
          //
          // ADR 0093 D5 — THE VOID'S KEY IS NOT THE SALE'S KEY.
          //
          // `apply_stock_movement` (production definition, read 2026-09-02)
          // opens with `SELECT id ... WHERE idempotency_key = p_idempotency_key
          // ... IF FOUND RETURN`. Passing `idem` here — the key the SALE
          // already wrote — therefore returned the sale's transaction id and
          // MOVED NOTHING: a voided check stayed depleted forever, and the
          // caller could not tell, because an idempotent hit and a real
          // movement are the same `{ error: null }`.
          //
          // `${idem}:void` is derived from the sale's key rather than random,
          // so a REPLAYED void is still idempotent — the property the sale
          // already had, extended to the reversal.
          //
          // pos-hub.void-idempotency.spec.ts pins this against a mock that
          // actually implements the early return; the older B19 tests could
          // not see it because their mock ignores the key.
          ({ error: rpcError } = await db.rpc("apply_stock_movement", {
            p_inventory_id: it.inventory_id,
            p_stock_state: "live",
            p_delta: isVoid ? qty : -qty,
            p_transaction_type: isVoid ? "return" : "sale",
            p_source: "pos",
            p_reason: `POS ${isVoid ? "void" : "sale"} (${label}): ${it.name}`,
            p_idempotency_key: isVoid ? `${idem}:void` : idem,
          }));
        }

        if (rpcError) {
          this.logger.warn(
            `Stock effect failed for ${it.name} (${label}) on check ${check.externalCheckId}: ${rpcError.message}`,
          );
        } else {
          affected.add(it.inventory_id);
          if (!isVoid) {
            await this.recordConsumption(
              restaurantId,
              it,
              resolved,
              inv,
              qty,
              idem,
            );
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
   * Queue a line the pipeline refused to act on (decision B20, extended by
   * ADR 0011).
   *
   * `reason` is what makes the queue workable rather than a pile: "we don't
   * know what this item is" and "we know exactly what it is but not how much
   * one sale removes" need different questions asked of the reviewer, and the
   * second arrives already carrying its inventory row.
   *
   * supabase-js resolves with { error } rather than throwing on a constraint
   * violation, so the dedupe check happens on the result, not in a catch. The
   * partial unique index on (restaurant_id, source, external_check_id,
   * external_item_id, reason) WHERE NOT resolved means a 23505 here just means
   * it is already queued and open — not a real failure.
   */
  private async queueUnresolvedLine(
    restaurantId: string,
    source: string,
    check: CanonicalCheck,
    it: {
      name: string;
      external_item_id: string | null;
      qty: number;
      price: number;
    },
    opts: {
      reason: "unmapped" | "no_sale_volume";
      mappedInventoryId: string | null;
      detail: string;
    },
  ): Promise<void> {
    const { error } = await this.dbService
      .getClient()
      .from("pos_unresolved_lines")
      .insert({
        restaurant_id: restaurantId,
        source,
        external_check_id: check.externalCheckId,
        external_item_id: it.external_item_id,
        item_name: it.name,
        qty: it.qty,
        price: it.price,
        reason: opts.reason,
        mapped_inventory_id: opts.mappedInventoryId,
        raw: { ...it, unresolved_detail: opts.detail },
      });
    if (error && error.code !== "23505") {
      this.logger.warn(
        `Failed to queue unresolved line ${it.name} (${opts.reason}): ${error.message}`,
      );
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
    resolved: ResolvedSaleVolume,
    inv: InventoryVolumes | null,
    qty: number,
    idempotencyKey: string,
  ): Promise<void> {
    if (!item.inventory_id) return;
    try {
      const db = this.dbService.getClient();

      // `consumption_type` stays 'bottle' | 'glass' — the column is
      // varchar(10) with a CHECK on exactly those two
      // (baseline_from_production.sql:6394), and wine_consumption_summary
      // branches on it. So it records the DEPLETION MODE, while
      // `pos_item_mappings.sale_unit` carries the human label ('magnum',
      // 'carafe') and `volume_ml` carries the truth. A 500ml carafe is a
      // 'glass' row of 500ml here — not a lie about the pour, because every
      // volume reader sums volume_ml.
      const volumeMl =
        resolved.mode === "volume"
          ? resolved.ml * qty
          : (inv?.bottleMl ?? RPC_DEFAULT_BOTTLE_ML) * qty;
      const unit = resolved.mode === "volume" ? "glass" : "bottle";
      const unitPrice = Number(item.price) || inv?.menuPrice || null;

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
      //
      // Measured on the first ADR 0093 live day (2026-09-03): this was an
      // `upsert(..., { onConflict: "restaurant_id,notes" })`, and EVERY call
      // failed with 42P10 "there is no unique or exclusion constraint matching
      // the ON CONFLICT specification" — the index above is PARTIAL
      // (`where notes is not null and source = 'pos'`), and Postgres only
      // matches a partial index to a conflict target that repeats its
      // predicate, which PostgREST cannot express. So the mirror had written
      // zero rows for every POS sale since 2026-08-24 while the error was
      // logged and nothing else noticed. The honest shape is a plain INSERT
      // with the partial unique index as the backstop: a replay raises 23505,
      // which is the idempotent no-op the upsert was meant to be.
      const { error } = await db.from("wine_consumption_log").insert({
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
      });
      if (error?.code === "23505") {
        // Already mirrored under this key — a webhook replay. Nothing to add.
        return;
      }

      // This result used to be discarded, which made the comment above a claim
      // the code did not honour. supabase-js RESOLVES with `{ data, error }` on
      // a database error rather than throwing, so the `catch` below only ever
      // caught client/network faults — a rejected upsert vanished in silence.
      //
      // That is a SILENT OMISSION, not a corruption, and it is the harder of the
      // two to live with: a wrong row can be found and repaired by querying for
      // it, whereas a missing row leaves no trace at all. Nothing records that
      // the event failed to land, so the damage cannot be enumerated, bounded or
      // repaired — while velocity, XYZ, reorder points, Holt-Winters and goal
      // progress all quietly under-count over a ledger that looks complete.
      if (error) {
        this.logger.error(
          `wine_consumption_log insert FAILED for ${item.name} ` +
            `(r=${restaurantId}, key=${idempotencyKey}): ${error.message} ` +
            `[${error.code ?? "no-code"}] — the demand series is now short one ` +
            `event and nothing else records that.`,
        );
      }
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
    // ADR 0011 reopened the vocabulary. sale_unit is an OPEN human label —
    // 'glass', 'bottle', 'half_bottle', 'magnum', 'carafe', 'taster',
    // 'flight' — for reporting and the UI, never for arithmetic. Only the two
    // historical labels still carry a derivation, and only when
    // sale_volume_ml is absent. What is still rejected is malformed input:
    // a non-string, or a string that is empty or whitespace-only, is a bug in
    // the caller, not a label anyone chose. Stored trimmed, case preserved —
    // the derivation compares case-insensitively.
    const rawUnit = mapping.sale_unit ?? null;
    let saleUnit: string | null = null;
    if (rawUnit !== null) {
      if (typeof rawUnit !== "string" || rawUnit.trim() === "") {
        throw new Error(
          `sale_unit must be a non-empty label or null — got ${JSON.stringify(rawUnit)}`,
        );
      }
      if (rawUnit.trim().length > 32) {
        throw new Error("sale_unit must be 32 characters or fewer");
      }
      saleUnit = rawUnit.trim();
    }

    // sale_volume_ml is the number the depletion actually reads, so a wrong one
    // is a silent stock error. The plausibility band catches the mistake that
    // matters: 1.5 typed into an ml field meaning 1.5 LITRES would otherwise
    // pass as "positive" and pour 1.5ml per sale forever.
    const rawVolume = mapping.sale_volume_ml ?? null;
    let saleVolumeMl: number | null = null;
    if (rawVolume !== null) {
      const n =
        typeof rawVolume === "number"
          ? rawVolume
          : typeof rawVolume === "string" && rawVolume.trim() !== ""
            ? Number(rawVolume)
            : NaN;
      if (
        !Number.isFinite(n) ||
        n < MIN_PLAUSIBLE_SALE_ML ||
        n > MAX_PLAUSIBLE_SALE_ML
      ) {
        throw new Error(
          `sale_volume_ml must be a volume in millilitres between ${MIN_PLAUSIBLE_SALE_ML} and ${MAX_PLAUSIBLE_SALE_ML}, or null — got ${JSON.stringify(rawVolume)}`,
        );
      }
      saleVolumeMl = n;
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
      sale_unit: saleUnit,
      sale_volume_ml: saleVolumeMl,
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

  /**
   * Returns the tables AND whether the lookup failed, because those are
   * different facts and the caller writes a row either way.
   *
   * supabase-js RESOLVES with `{ data, error }` on a database error rather than
   * throwing, so the previous `const { data } = await …; return data || []`
   * turned a failed query into an empty table list. Every check then resolved
   * `table_id: null` (`resolveTable` finds nothing in an empty array) while the
   * ingest reported success with zero errors — indistinguishable from a
   * restaurant that genuinely has no tables, and the mechanism that manufactures
   * the "table_id is null on every row" symptom the POS bridge was diagnosed on.
   *
   * An empty result is NOT an error and must not be reported as one; only a real
   * failure is. Conflating them would trade a silent failure for a false alarm.
   */
  private async loadTables(
    restaurantId: string,
  ): Promise<{ tables: any[]; error: string | null }> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_tables")
      .select("id, label, pos_refs")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (error) {
      this.logger.error(
        `restaurant_tables lookup failed for r=${restaurantId} — checks will be ` +
          `written without a table_id rather than with a wrong one: ${error.message}`,
      );
      return { tables: [], error: `restaurant_tables: ${error.message}` };
    }
    return { tables: data || [], error: null };
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

  /**
   * "Is my POS connection live?" — the one screen an operator opens to answer
   * exactly that.
   *
   * The `error` used to be discarded, so a failed `pos_checks` read returned
   * `totalChecks: 0, sources: []` and Settings → POS rendered
   * "Ingestion (30d): 0 checks from this source" — the same sentence a
   * genuinely idle integration produces. A status endpoint that cannot tell
   * "dead" from "quiet" is answering the wrong question, and it answers it in
   * the reassuring direction.
   *
   * Now it returns `unavailable: true` with `totalChecks: null`, which the
   * client renders as an em dash (ADR 0051). A real measured zero still
   * renders `0`.
   */
  async getStatus(restaurantId: string) {
    const client = this.dbService.getClient();
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await client
      .from("pos_checks")
      .select("source, opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", since30);
    if (error) {
      this.logger.error(
        `pos_checks status read failed for r=${restaurantId} — reporting ` +
          `UNAVAILABLE rather than "0 checks": ${error.code ?? "?"} ${error.message}`,
      );
      return {
        windowDays: 30,
        unavailable: true as const,
        totalChecks: null,
        sources: null,
        generatedAt: new Date().toISOString(),
      };
    }
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
      unavailable: false as const,
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
