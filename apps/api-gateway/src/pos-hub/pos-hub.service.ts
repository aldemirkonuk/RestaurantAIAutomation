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
 * Wine identification for the ingestion fallback path.
 * =====================================================
 *
 * `PosHubService.resolveWine` consults `pos_item_mappings` first. On a fresh
 * tenant there are no mappings, so everything below is what decides whether a
 * sale is recorded with `is_wine: true` — and every wine analytic downstream
 * (table-analytics, insight-generator, goals) counts off that flag. A miss is
 * silent: nothing errors, the number is just low.
 *
 * Two signals, in this order:
 *
 *   1. CATEGORY. A POS that groups its list under 'Wine by the Glass' has
 *      already told us the answer, and it tells us for the wines a keyword list
 *      can never reach (a Barolo sold as 'Conterno 2016', a producer-only
 *      button). `POSIntegrationAgent.is_wine_item` on the Python ingress has
 *      always read the category; this side ignored it until now, so the two
 *      ingresses disagreed about how wine is identified.
 *   2. NAME. The backstop for a POS that sends no category. Varietal labelling
 *      ('Sonoma Pinot Noir') resolves on a grape list alone; Old World
 *      appellation labelling ('Edmondo Sarti Barbaresco') does not, which is why
 *      WINE_WORDS below carries appellations and styles rather than grapes only.
 *
 * An UNRECOGNISED category does not veto the name scan — it falls through to it.
 * Only a category positively identified as a non-wine family stops the scan.
 * That matters: real POS menus file wine under headings we will not have seen,
 * and treating 'unknown' as 'not wine' is the undercount this path exists to
 * avoid.
 *
 * None of this is a substitute for `pos_item_mappings`. Seeding mappings from
 * the restaurant's own imported wine list (which already carries
 * `signature_hash`) is the durable fix and makes the below a backstop rather
 * than the mechanism. A keyword list cannot resolve a bottle to an identity, so
 * it can flag a sale as wine but never say WHICH wine.
 *
 * Kept in lockstep with `scripts/simulate/detection.py` (the measurement mirror)
 * and `services/agent-orchestrator/agents/pos_integration_agent.py` (the other
 * ingress); `scripts/test_simulate.py` fails if the three drift apart.
 */

/**
 * Category tokens that name a wine section outright. Authoritative: they win
 * over NON_WINE_CATEGORY_WORDS, so a Dessert Wine category reads as wine and
 * not as dessert.
 */
export const WINE_CATEGORY_WORDS = [
  "wine",
  "wines",
  "vino",
  "vini",
  "vin",
  "vins",
  "vinho",
  "vinhos",
  "weine",
  "şarap",
  "sarap",
  "şaraplar",
  "saraplar",
];

/**
 * Weaker category tokens: they name a wine STYLE, which is usually a wine
 * section but not always. Wine only when the category carries no non-wine word
 * as well — otherwise a Sparkling Water heading reads as sparkling wine.
 */
export const WINE_STYLE_CATEGORY_WORDS = [
  "champagne",
  "sparkling",
  "bubbles",
  "bubbly",
  "prosecco",
  "cava",
  "rosé",
  "rose",
  "rosato",
  "by the glass",
  "by the bottle",
  "btg",
  "cellar",
  "sommelier",
  "somm",
];

/**
 * Category families that are definitively not wine. Deliberately narrow —
 * every token here is a heading that cannot hold wine. Note what is absent:
 * 'beverage' and 'drinks' are NOT here, because real POS menus routinely file
 * the wine list under exactly those, and vetoing them would recreate the
 * undercount. An unlisted category falls through to the name scan instead.
 */
export const NON_WINE_CATEGORY_WORDS = [
  "beer",
  "beers",
  "draft",
  "draught",
  "cider",
  "seltzer",
  "kombucha",
  "cocktail",
  "cocktails",
  "mocktail",
  "spirit",
  "spirits",
  "liquor",
  "whiskey",
  "whisky",
  "bourbon",
  "vodka",
  "gin",
  "tequila",
  "mezcal",
  "rum",
  "sake",
  "water",
  "soda",
  "juice",
  "coffee",
  "espresso",
  "tea",
  "food",
  "kitchen",
  "appetizer",
  "appetizers",
  "starter",
  "starters",
  "snack",
  "snacks",
  "salad",
  "salads",
  "soup",
  "soups",
  "pasta",
  "pizza",
  "entree",
  "entrée",
  "entrees",
  "main",
  "mains",
  "side",
  "sides",
  "dessert",
  "desserts",
  "bread",
  "charcuterie",
  "cheese",
  "sushi",
  "raw bar",
  "breakfast",
  "brunch",
  "lunch",
  "kids",
  "retail",
  "merch",
];

/**
 * Wine tokens for the NAME scan: grapes, appellations, and styles.
 *
 * Matched on word boundaries rather than as bare substrings, which is what
 * lets the list carry short tokens safely — 'cava' no longer fires on
 * Cavatelli, 'etna' does not fire on Vietnamese, 'rose' does not fire on
 * Rosemary (so the old trailing-space hack on 'rose ' is gone).
 *
 * Two rules govern what is in here:
 *
 *   - Wine-specific only. A token that is also an ordinary food word is left
 *     out no matter how good a grape it is, because a food item resolving as
 *     wine inflates depletion for wine that was never poured — a worse failure
 *     than a miss, which a mapping row or the category fixes. So: no 'pecorino'
 *     (the Marche white, but far more often the cheese), no 'bianco' or
 *     'blanco' (pizza bianca, queso blanco), no 'dolce' (the dessert section),
 *     no 'nero' (cavolo nero), no 'marsala' (the sauce), no 'sparkling' (water).
 *   - Generalisable. These are appellations and grapes, not names lifted off
 *     one restaurant's list. Where a real crawled menu misspelled a grape
 *     ('FRIULIANO' for Friulano) the misspelling is not encoded here.
 *
 * 'avola' rather than nero d'avola, because real menus write the apostrophe
 * three different ways; 'blanc de' rather than blanc de blancs, because it
 * covers blanc de blanc, blancs, and noirs at once; 'cru' rather than grand cru,
 * because it also catches 1er Cru.
 *
 * One token is knowingly ambiguous and stays anyway: 'rose'. Wines are sold as
 * nothing but ROSE, and rose is also an ingredient (rose harissa, rose water).
 * The category settles those, since they arrive under a food heading. The
 * pre-existing token was 'rose ' with a trailing space, which matched rose
 * harissa identically, so this is a limit of a name scan rather than a
 * regression — `scripts/test_simulate.py` pins it in both directions.
 *
 * Turkish caveat: matching on word boundaries means only the nominative
 * 'şarap' resolves, not the inflected 'şarabı'. That was equally true of the
 * substring version, and a mapping row is the fix.
 */
export const WINE_WORDS = [
  // Generic, multilingual
  "wine",
  "vino",
  "vinho",
  "vin santo",
  "şarap",
  "sarap",
  "rosé",
  "rose",
  "rosato",
  "rosado",
  "red blend",
  "white blend",
  "meritage",
  "cuvee",
  "cuvée",
  // Bare 'red' and 'white' are food words (red snapper, white bean), so the
  // house pour is matched as a phrase instead.
  "house red",
  "house white",
  "cru",
  "reserva",
  "riserva",
  "port",
  "sherry",
  "madeira",
  // Producer words. A POS button carrying one of these is a bottle from that
  // producer, whatever the cuvee is called — which is the only thing that
  // resolves a winery's proprietary names (Lakefront White, Vineyard to Table).
  // The substring version caught these by accident, matching 'wine' inside
  // 'Winery'; naming them is the same catch on purpose. Left out: 'cantina' and
  // 'bodega', which are also restaurant words and appear in dish names.
  "winery",
  "vineyard",
  "weingut",
  "domaine",
  "chateau",
  "château",
  "tenuta",
  "quinta",
  "vignoble",
  // Sparkling
  "champagne",
  "prosecco",
  "cava",
  "brut",
  "blanc de",
  "cremant",
  "crémant",
  "franciacorta",
  "lambrusco",
  "sekt",
  // Widely planted grapes
  "chardonnay",
  "sauvignon",
  "riesling",
  "pinot",
  "merlot",
  "cabernet",
  "syrah",
  "sirah",
  "shiraz",
  "malbec",
  "tempranillo",
  "nebbiolo",
  "sangiovese",
  "grenache",
  "garnacha",
  "zinfandel",
  "viognier",
  "chenin",
  "gamay",
  "semillon",
  "sémillon",
  "mourvedre",
  "mourvèdre",
  "monastrell",
  "cinsault",
  "carignan",
  "marsanne",
  "roussanne",
  "petit verdot",
  "gewurztraminer",
  "gewürztraminer",
  "moscato",
  "muscat",
  "carmenere",
  "carménère",
  "pinotage",
  "tannat",
  "torrontes",
  "torrontés",
  // Italy — appellations
  "chianti",
  "barolo",
  "barbaresco",
  "montalcino",
  "brunello",
  "montepulciano",
  "vernaccia",
  "valpolicella",
  "ripasso",
  "amarone",
  "soave",
  "gavi",
  "roero",
  "etna",
  "taurasi",
  "orvieto",
  "frascati",
  "bolgheri",
  "morellino",
  "cannonau",
  "cerasuolo",
  "super tuscan",
  // Italy — grapes
  "barbera",
  "dolcetto",
  "arneis",
  "vermentino",
  "verdicchio",
  "falanghina",
  "fiano",
  "greco",
  "grechetto",
  "grillo",
  "ribolla",
  "vitovska",
  "rossese",
  "malvasia",
  "trebbiano",
  "garganega",
  "cortese",
  "corvina",
  "nerello",
  "mascalese",
  "aglianico",
  "avola",
  "timorasso",
  "bellone",
  "friulano",
  "teroldego",
  "lagrein",
  "sagrantino",
  "negroamaro",
  "primitivo",
  // France
  "bordeaux",
  "burgundy",
  "bourgogne",
  "chablis",
  "sancerre",
  "vouvray",
  "chinon",
  "muscadet",
  "pouilly",
  "gigondas",
  "cotes du",
  "côtes du",
  "chateauneuf",
  "châteauneuf",
  "beaujolais",
  "macon",
  "mâcon",
  "sauternes",
  "medoc",
  "médoc",
  "pauillac",
  "margaux",
  "montrachet",
  "echezeaux",
  "échezeaux",
  "corton",
  "romanee",
  "romanée",
  "bonnezeaux",
  // Spain and Portugal
  "rioja",
  "priorat",
  "ribera",
  "rueda",
  "bierzo",
  "mencia",
  "mencía",
  "albarino",
  "albariño",
  "alvarinho",
  "verdejo",
  "godello",
  "txakoli",
  "txakolina",
  "tinto",
  "tinta",
  "tintillo",
  "douro",
  "dao",
  "dão",
  "alentejo",
  "touriga",
  // Germany and Austria
  "gruner",
  "grüner",
  "veltliner",
  "blaufrankisch",
  "blaufränkisch",
  "zweigelt",
  "spatlese",
  "spätlese",
  "kabinett",
  "trocken",
  // Greece
  "assyrtiko",
  "xinomavro",
  "agiorgitiko",
  "agioritiko",
  "malagousia",
  "moschofilero",
  "moscofilero",
  "monemvasia",
  "monemvasios",
  "kidonitsa",
  "savatiano",
  "retsina",
  "santorini",
  "nemea",
  // Turkey
  "okuzgozu",
  "öküzgözü",
  "bogazkere",
  "boğazkere",
  "kalecik",
  "narince",
  "calkarasi",
  "çalkarası",
];

/** What the category signal concluded, or that it had nothing to say. */
export type WineCategoryVerdict = "wine" | "not_wine" | "unknown";

/**
 * One alternation per list, compiled once. `\p{L}\p{N}_` mirrors Python's
 * unicode-aware `\w` so the TS and Python matchers agree character for
 * character — the mirrors are asserted equal, so they have to behave equal too.
 */
const boundedMatcher = (words: readonly string[]): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${words
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})(?![\\p{L}\\p{N}_])`,
    "iu",
  );

const WINE_CATEGORY_RE = boundedMatcher(WINE_CATEGORY_WORDS);
const WINE_STYLE_CATEGORY_RE = boundedMatcher(WINE_STYLE_CATEGORY_WORDS);
const NON_WINE_CATEGORY_RE = boundedMatcher(NON_WINE_CATEGORY_WORDS);
const WINE_WORD_RE = boundedMatcher(WINE_WORDS);

/** Signal 1: what the POS category says. */
export function classifyWineCategory(
  category: string | null | undefined,
): WineCategoryVerdict {
  const value = (category || "").trim();
  if (!value) return "unknown";
  if (WINE_CATEGORY_RE.test(value)) return "wine";
  if (NON_WINE_CATEGORY_RE.test(value)) return "not_wine";
  if (WINE_STYLE_CATEGORY_RE.test(value)) return "wine";
  return "unknown";
}

/** Signal 2: the name backstop. */
export function looksLikeWineName(name: string | null | undefined): boolean {
  return WINE_WORD_RE.test(name || "");
}

/** Category first, name second. See the header comment for why in that order. */
export function detectWine(
  name: string | null | undefined,
  category: string | null | undefined,
): boolean {
  const verdict = classifyWineCategory(category);
  if (verdict !== "unknown") return verdict === "wine";
  return looksLikeWineName(name);
}

/**
 * PosHubService — the unified ingestion pipeline (the "foundation" wave).
 *
 * raw payload → adapter.normalize() → wine mapping (pos_item_mappings →
 * category + keyword heuristic) → table/server resolution → UPSERT pos_checks.
 * Idempotent on (restaurant_id, source, external_check_id), so webhook
 * replays and re-imports are safe.
 */
@Injectable()
export class PosHubService {
  private readonly logger = new Logger(PosHubService.name);

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
          const mapped = this.resolveWine(
            it.name,
            it.externalItemId,
            mappings,
            it.category,
          );
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
    category?: string | null,
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
    // No mapping row: fall back to the POS category, then the name. Passing the
    // category is the fix for the two-thirds of an Old World list that a grape
    // keyword scan structurally cannot reach.
    return {
      isWine: detectWine(name, category),
      masterWineId: null,
      category: null,
    };
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
