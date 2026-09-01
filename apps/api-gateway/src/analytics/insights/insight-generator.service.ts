import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import * as E from "../engine";
import {
  INSIGHT_CANDIDATES,
  availableCandidates,
  candidatesByCategory,
  DIMENSIONS,
  MEASURES,
  COMPARATORS,
  DataRequirement,
  InsightCategory,
} from "./insight-catalog";
import {
  verbalize,
  tableAttributeReading,
  InsightEvidence,
} from "./insight-verbalizer";

/**
 * InsightGeneratorService — executes the insight candidate space.
 *
 * Pipeline (the SOTA "auto-insights" loop):
 *   1. LOAD    one normalized data bundle (consumption, orders, inventory,
 *              checks, tables, venue, goals) with graceful degradation —
 *              a missing table just removes its candidate families.
 *   2. COMPUTE every available candidate × its live entities through the
 *              pure engine (baselines, peers, regressions, baskets...).
 *   3. SCORE   effect size × statistical significance × support, so a 40%
 *              swing on 3 data points doesn't outrank a 12% swing on 90.
 *   4. VERBALIZE deterministically (templates — every number is auditable).
 *   5. RANK    keep the top-K per category; optionally persist to
 *              analytics_insights for instant mobile/web reads.
 */
@Injectable()
export class InsightGeneratorService {
  private readonly logger = new Logger(InsightGeneratorService.name);

  constructor(private readonly dbService: DatabaseService) {}

  // ==========================================================================
  // Public API
  // ==========================================================================

  getCatalogSummary() {
    return {
      totalCandidateTypes: INSIGHT_CANDIDATES.length,
      byCategory: candidatesByCategory(),
      note: "Each candidate type multiplies by live entities (tables, waiters, wines...) at runtime.",
    };
  }

  /**
   * Full enumerated catalog for the Browse-All explorer (NEW-707…NEW-728):
   * every dimension, measure, comparator, and every candidate type key with its
   * category + data requirements. Pure — no restaurant data touched.
   *
   * The count is deliberately NOT written here. It is `INSIGHT_CANDIDATES.length`
   * (573 as of 2026-09-01), and this comment said "375" for months while the line
   * below already returned 573 — a number in prose is a claim nothing re-checks.
   */
  getCatalogTypes() {
    return {
      total: INSIGHT_CANDIDATES.length,
      byCategory: candidatesByCategory(),
      dimensions: DIMENSIONS,
      measures: MEASURES,
      comparators: COMPARATORS,
      candidates: INSIGHT_CANDIDATES,
    };
  }

  /**
   * Which data requirements this restaurant currently satisfies — lets the
   * explorer mark types as "computable" vs "blocked" and say what's missing
   * (NEW-719 / NEW-720 / NEW-722). Reuses the same bundle the engine loads.
   */
  async getAvailability(restaurantId: string): Promise<DataRequirement[]> {
    const bundle = await this.loadBundle(restaurantId);
    return Array.from(bundle.availability);
  }

  async generate(
    restaurantId: string,
    opts: {
      categories?: InsightCategory[];
      maxPerCategory?: number;
      persist?: boolean;
    } = {},
  ) {
    const startedAt = Date.now();
    const maxPerCategory = opts.maxPerCategory ?? 5;
    const bundle = await this.loadBundle(restaurantId);
    const candidates = availableCandidates(bundle.availability);

    let insights: InsightRecord[] = [];
    const push = (r: InsightRecord | null) => {
      if (r && r.sentence) insights.push(r);
    };

    // ---- family executors (each guards on its own data) -------------------
    this.computeConsumptionFamily(bundle, push);
    this.computeOrdersFamily(bundle, push);
    this.computeInventoryFamily(bundle, push);
    this.computeChecksFamily(bundle, push);
    this.computeGoalsFamily(bundle, push);

    if (opts.categories?.length) {
      const set = new Set(opts.categories);
      insights = insights.filter((i) => set.has(i.category));
    }

    // Rank: score desc, cap per category.
    insights.sort((a, b) => b.score - a.score);
    const perCat = new Map<string, number>();
    const ranked = insights.filter((i) => {
      const c = perCat.get(i.category) || 0;
      if (c >= maxPerCategory) return false;
      perCat.set(i.category, c + 1);
      return true;
    });

    if (opts.persist) {
      await this.persist(restaurantId, ranked, opts.categories);
    }

    return {
      restaurantId,
      insights: ranked,
      availability: Array.from(bundle.availability),
      // UPPER BOUND, not a count of what this restaurant can receive.
      // `availableCandidates` (insight-catalog.ts:557) filters on DATA
      // REQUIREMENTS only — `c.requires.every(r => available.has(r))` — and
      // never on whether a type has an implementation behind it. So with all
      // seven data sources connected this equals the whole catalogue, which is
      // how a "573 of 573" meter came to overstate a system where roughly two
      // dozen types have a `record()` site and fewer than that could actually
      // fire. What DID fire is `insights` below; the gap between them is the
      // honest number, and it is deliberately left visible rather than papered
      // over here (ADR 0020: a surface never asserts what it cannot support).
      candidateTypesAvailable: candidates.length,
      candidateTypesTotal: INSIGHT_CANDIDATES.length,
      computedIn: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Read stored insights (instant mobile path). */
  async getStored(
    restaurantId: string,
    opts: { categories?: string[]; limit?: number } = {},
  ) {
    const client = this.dbService.getClient();
    let q = client
      .from("analytics_insights")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("score", { ascending: false })
      .limit(opts.limit ?? 30);
    if (opts.categories?.length) q = q.in("category", opts.categories);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`getStored failed: ${error.message}`);
      return [];
    }
    return data || [];
  }

  private async persist(
    restaurantId: string,
    insights: InsightRecord[],
    categories?: InsightCategory[],
  ) {
    const client = this.dbService.getClient();
    try {
      // Replace the refreshed categories atomically-enough for analytics.
      let del = client
        .from("analytics_insights")
        .delete()
        .eq("restaurant_id", restaurantId);
      if (categories?.length) del = del.in("category", categories);
      await del;
      if (insights.length) {
        await client.from("analytics_insights").insert(
          insights.map((i) => ({
            restaurant_id: restaurantId,
            candidate_key: i.candidateKey,
            category: i.category,
            entity_key: i.entityKey ?? null,
            entity_label: i.entityLabel ?? null,
            sentence: i.sentence,
            score: i.score,
            effect_pct: i.effectPct ?? null,
            z_score: i.z ?? null,
            evidence: i.evidence,
            period_start: i.periodStart ?? null,
            period_end: i.periodEnd ?? null,
          })),
        );
      }
    } catch (err: any) {
      this.logger.warn(`persist insights failed: ${err?.message}`);
    }
  }

  // ==========================================================================
  // Scoring — effect × significance × support (documented, tunable)
  // ==========================================================================

  private scoreOf(params: {
    effectPct?: number | null;
    z?: number | null;
    n?: number;
    boost?: number;
  }): number {
    const effect = Math.min(3, Math.abs(params.effectPct ?? 0) * 5); // 20% → 1.0
    const sig = Math.min(3, Math.abs(params.z ?? 0)); // capped at 3σ
    const support = Math.min(1, (params.n ?? 0) / 14); // full weight at 2 weeks
    const base = (effect * 0.5 + sig * 0.5) * (0.4 + 0.6 * support);
    return Math.round(base * (params.boost ?? 1) * 100) / 100;
  }

  // ==========================================================================
  // Data bundle
  // ==========================================================================

  private async loadBundle(restaurantId: string): Promise<Bundle> {
    const client = this.dbService.getClient();
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const since180 = new Date(Date.now() - 180 * 86400000).toISOString();

    const [cons, ords, inv, checks, tables, venue, goals] =
      await Promise.allSettled([
        client
          .from("wine_consumption_log")
          // No master_wine_id column — resolve via the inventory FK.
          .select(
            "inventory_id, quantity, volume_ml, created_at, restaurant_inventory(master_wine_id)",
          )
          .eq("restaurant_id", restaurantId)
          .gte("created_at", since90),
        client
          .from("procurement_orders")
          // NO provider_name column on procurement_orders (see
          // supabase/migrations/20260805000000_baseline_from_production.sql:4514-4568)
          // — naming it 42703s the whole query, `ok()` below turned that into
          // an empty order list, and the entire purchasing insight family went
          // permanently silent. The vendor label comes from the provider_id FK.
          .select(
            "provider_id, providers(name), total_cost, final_price, bottles_total, quantity, delivered_at, created_at, status",
          )
          .eq("restaurant_id", restaurantId)
          .eq("status", "delivered")
          .gte("delivered_at", since180),
        client
          .from("restaurant_inventory")
          .select(
            "id, wine_name, stock_live, menu_price_current, last_purchase_price, master_wine_id, master_wine_library(primary_type)",
          )
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
        client
          .from("pos_checks")
          .select(
            "id, source, table_id, server_name, server_external_id, opened_at, closed_at, covers, total, tip, items",
          )
          .eq("restaurant_id", restaurantId)
          // Voided checks are not revenue — see pos_checks.voided.
          .eq("voided", false)
          .gte("opened_at", since90),
        client
          .from("restaurant_tables")
          .select(
            "id, label, seats, zone, is_outdoor, distance_to_kitchen_m, distance_to_bar_m, distance_to_pool_m",
          )
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
        client
          .from("restaurant_venue_profiles")
          .select("features")
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        client
          .from("analytics_goals")
          .select("*")
          .eq("restaurant_id", restaurantId)
          .eq("status", "active"),
      ]);

    // A failed slice still degrades to `[]` — one dead lens must not take the
    // whole insight run down. But it must not do so SILENTLY: an empty array
    // from a 42703 is indistinguishable from an empty array from a quiet
    // restaurant, which is precisely how the provider_name drift above stayed
    // invisible. Every failure now names itself in the logs.
    const slices: Array<[string, PromiseSettledResult<any>]> = [
      ["wine_consumption_log", cons],
      ["procurement_orders", ords],
      ["restaurant_inventory", inv],
      ["pos_checks", checks],
      ["restaurant_tables", tables],
      ["restaurant_venue_profiles", venue],
      ["analytics_goals", goals],
    ];
    for (const [table, r] of slices) {
      if (r.status === "rejected")
        this.logger.error(
          `insight bundle query on ${table} rejected: ${r.reason}`,
        );
      else if (r.value?.error)
        this.logger.error(
          `insight bundle query on ${table} failed — this family will be ` +
            `silent rather than wrong: ${r.value.error.code ?? "?"} ${r.value.error.message ?? r.value.error}`,
        );
    }

    const ok = <T>(r: PromiseSettledResult<any>): T[] =>
      r.status === "fulfilled" && !r.value.error ? r.value.data || [] : [];

    const bundle: Bundle = {
      restaurantId,
      consumption: ok<any>(cons).map((c: any) => ({
        // The select above resolves the wine through the inventory FK, because
        // wine_consumption_log has no master_wine_id column of its own — so
        // PostgREST returns it NESTED, and reading it at the top level yields
        // undefined on every row. That made `if (!c.wineId) continue` (:394,
        // :578) skip everything and silently emptied both per-wine families.
        wineId: c.restaurant_inventory?.master_wine_id,
        qty: c.quantity || (c.volume_ml ? c.volume_ml / 750 : 0),
        date: (c.created_at || "").substring(0, 10),
      })),
      orders: ok<any>(ords).map((o: any) => ({
        vendorId: o.provider_id || "unknown",
        vendorName: o.providers?.name || o.provider_id || "unknown vendor",
        cost: o.total_cost || o.final_price || 0,
        date: (o.delivered_at || o.created_at || "").substring(0, 10),
      })),
      inventory: ok<any>(inv),
      checks: ok<any>(checks),
      tables: ok<any>(tables),
      venueFeatures:
        venue.status === "fulfilled" && !venue.value.error
          ? venue.value.data?.features || null
          : null,
      goals: ok<any>(goals),
      availability: new Set<DataRequirement>(),
    };

    if (bundle.consumption.length) bundle.availability.add("consumption");
    if (bundle.orders.length) bundle.availability.add("orders");
    if (bundle.inventory.length) bundle.availability.add("inventory");
    if (bundle.checks.length) bundle.availability.add("checks");
    if (bundle.tables.length) bundle.availability.add("tables");
    if (bundle.venueFeatures) bundle.availability.add("venue");
    if (bundle.goals.length) bundle.availability.add("goals");
    return bundle;
  }

  private toDaily(
    rows: Array<{ date: string; value: number }>,
    days: number,
  ): { dates: string[]; values: number[] } {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (!r.date) continue;
      byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    }
    const dates: string[] = [];
    const values: number[] = [];
    const today = new Date();
    for (let d = days; d >= 1; d--) {
      // exclude today (partial day would distort baselines)
      const day = new Date(today.getTime() - d * 86400000)
        .toISOString()
        .substring(0, 10);
      dates.push(day);
      values.push(byDay.get(day) || 0);
    }
    return { dates, values };
  }

  // ==========================================================================
  // Family: consumption (wine demand) — sales/forecast/risk categories
  // ==========================================================================

  private computeConsumptionFamily(bundle: Bundle, push: Push) {
    if (!bundle.availability.has("consumption")) return;
    const rows = bundle.consumption.map((c) => ({
      date: c.date,
      value: c.qty,
    }));
    const { dates, values } = this.toDaily(rows, 90);
    const label = "bottles sold";

    this.timeSeriesInsights({
      push,
      dates,
      values,
      measure: "bottles",
      measureLabel: label,
      unit: "units",
      dimension: "overall",
      category: "sales",
    });

    // Per-wine peer rank + movers (needs names from inventory).
    const nameByWine = new Map<string, string>();
    for (const i of bundle.inventory)
      if (i.master_wine_id)
        nameByWine.set(i.master_wine_id, i.wine_name || i.master_wine_id);

    const byWine = new Map<string, Array<{ date: string; value: number }>>();
    for (const c of bundle.consumption) {
      if (!c.wineId) continue;
      const arr = byWine.get(c.wineId) || [];
      arr.push({ date: c.date, value: c.qty });
      byWine.set(c.wineId, arr);
    }

    // Wine week-over-week movers.
    let bestMove: { wine: string; cmp: E.PeriodComparison } | null = null;
    for (const [wineId, wineRows] of byWine) {
      const s = this.toDaily(wineRows, 28).values;
      const cmp = E.periodOverPeriod(s, 7);
      if (!cmp || cmp.deltaPct === null || cmp.previous < 2) continue;
      if (
        !bestMove ||
        Math.abs(cmp.deltaPct) > Math.abs(bestMove.cmp.deltaPct ?? 0)
      )
        bestMove = { wine: nameByWine.get(wineId) || wineId, cmp };
    }
    if (bestMove && bestMove.cmp.deltaPct !== null) {
      const ev: InsightEvidence = {
        entity: bestMove.wine,
        measureLabel: label,
        unit: "units",
        value: bestMove.cmp.current,
        baseline: bestMove.cmp.previous,
        deltaPct: bestMove.cmp.deltaPct,
        windowLabel: "week",
      };
      push(
        this.record("wine.bottles.vs_prev_period_7d", "sales", "period", ev, {
          effectPct: bestMove.cmp.deltaPct,
          n: 14,
          entityLabel: bestMove.wine,
        }),
      );
    }

    // Concentration of demand across wines (risk).
    const totalsByWine = Array.from(byWine.entries()).map(([wineId, r]) => ({
      id: wineId,
      total: r.reduce((s, x) => s + x.value, 0),
    }));
    if (totalsByWine.length >= 5) {
      const weights = totalsByWine.map((t) => t.total);
      const hhi = E.herfindahlIndex(weights);
      const sorted = [...weights].sort((a, b) => b - a);
      const top3 = sorted.slice(0, 3).reduce((a, b) => a + b, 0);
      const total = sorted.reduce((a, b) => a + b, 0);
      if (hhi !== null && total > 0) {
        const topShare = top3 / total;
        const ev: InsightEvidence = {
          entity: "wines",
          measureLabel: "wine demand",
          unit: "units",
          topShare,
          topCount: 3,
          hhi,
        };
        push(
          this.record(
            "wine.consumption_qty.concentration",
            "risk",
            "concentration",
            ev,
            {
              effectPct: topShare - 3 / totalsByWine.length, // excess vs uniform
              n: dates.length,
            },
          ),
        );
      }
    }

    // Forecast gap: Holt-Winters fitted vs actual over last week.
    const hw = E.holtWintersAdditive(
      values.slice(0, -7),
      7,
      {
        alpha: 0.3,
        beta: 0.05,
        gamma: 0.3,
      },
      7,
    );
    if (hw) {
      const actual = values.slice(-7).reduce((a, b) => a + b, 0);
      const predicted = hw.forecast.reduce((a, b) => a + Math.max(0, b), 0);
      if (predicted > 0) {
        const gap = (actual - predicted) / predicted;
        const ev: InsightEvidence = {
          measureLabel: label,
          unit: "units",
          forecastGapPct: gap,
          windowLabel: "week",
        };
        push(
          this.record(
            "overall.bottles.forecast_gap",
            "forecast",
            "forecast",
            ev,
            {
              effectPct: gap,
              n: 7,
            },
          ),
        );
      }
    }
  }

  // ==========================================================================
  // Family: procurement orders — purchasing category
  // ==========================================================================

  private computeOrdersFamily(bundle: Bundle, push: Push) {
    if (!bundle.availability.has("orders")) return;
    const rows = bundle.orders.map((o) => ({ date: o.date, value: o.cost }));
    const { dates, values } = this.toDaily(rows, 90);

    this.timeSeriesInsights({
      push,
      dates,
      values,
      measure: "purchase_spend",
      measureLabel: "purchasing spend",
      unit: "currency",
      dimension: "overall",
      category: "purchasing",
      periodWindow: 30,
      windowLabel: "30 days",
    });

    // Vendor concentration + peer rank.
    const byVendor = new Map<string, { name: string; total: number }>();
    for (const o of bundle.orders) {
      const e = byVendor.get(o.vendorId) || { name: o.vendorName, total: 0 };
      e.total += o.cost;
      byVendor.set(o.vendorId, e);
    }
    const weights = Array.from(byVendor.values()).map((v) => v.total);
    const hhi = E.herfindahlIndex(weights);
    if (hhi !== null && byVendor.size >= 2) {
      const sorted = Array.from(byVendor.values()).sort(
        (a, b) => b.total - a.total,
      );
      const total = weights.reduce((a, b) => a + b, 0);
      const ev: InsightEvidence = {
        entity: "vendors",
        measureLabel: "purchasing spend",
        unit: "currency",
        topShare: sorted[0].total / total,
        topCount: 1,
        hhi,
      };
      push(
        this.record(
          "vendor.purchase_spend.concentration",
          "risk",
          "concentration",
          ev,
          {
            effectPct: hhi - 1 / byVendor.size,
            n: bundle.orders.length,
            boost: hhi > 0.4 ? 1.4 : 1,
          },
        ),
      );
    }
  }

  // ==========================================================================
  // Family: inventory — days-of-cover / stockout risk
  // ==========================================================================

  private computeInventoryFamily(bundle: Bundle, push: Push) {
    if (
      !bundle.availability.has("inventory") ||
      !bundle.availability.has("consumption")
    )
      return;

    const byWine = new Map<string, number[]>();
    for (const c of bundle.consumption) {
      if (!c.wineId) continue;
      const arr = byWine.get(c.wineId) || [];
      arr.push(c.qty);
      byWine.set(c.wineId, arr);
    }

    let worst: { name: string; prob: number; onHand: number } | null = null;
    for (const item of bundle.inventory) {
      const qtys = byWine.get(item.master_wine_id) || [];
      if (qtys.length < 5) continue;
      const dailyMean = qtys.reduce((a: number, b: number) => a + b, 0) / 90;
      const profile = E.demandProfile(
        this.toDaily(
          bundle.consumption
            .filter((c) => c.wineId === item.master_wine_id)
            .map((c) => ({ date: c.date, value: c.qty })),
          90,
        ).values,
      );
      if (!profile || profile.mean <= 0) continue;
      const prob = E.stockoutProbability({
        onHand: item.stock_live || 0,
        avgDemandPerPeriod: profile.mean,
        demandStdev: profile.stdev,
        leadTime: 7,
      });
      if (prob !== null && (!worst || prob > worst.prob) && dailyMean > 0.05) {
        worst = {
          name: item.wine_name || item.master_wine_id,
          prob,
          onHand: item.stock_live || 0,
        };
      }
    }
    if (worst && worst.prob > 0.25) {
      const ev: InsightEvidence = {
        entity: worst.name,
        measureLabel: "stockout risk",
        unit: "percent",
        value: worst.prob,
        rank: 1,
        peerCount: bundle.inventory.length,
        attributeReading: `Only ${worst.onHand} bottles on hand vs its demand pattern — reorder before the next delivery window.`,
      };
      push(
        this.record("wine.stockout_risk.peer_rank", "risk", "peer", ev, {
          effectPct: worst.prob,
          z: 2,
          n: 30,
          boost: 1.5,
        }),
      );
    }
  }

  // ==========================================================================
  // Family: POS checks — tables / staff / efficiency / basket
  // ==========================================================================

  private computeChecksFamily(bundle: Bundle, push: Push) {
    if (!bundle.availability.has("checks")) return;
    const checks = bundle.checks;

    // Overall revenue series insights.
    const revRows = checks.map((c: any) => ({
      date: (c.closed_at || c.opened_at || "").substring(0, 10),
      value: c.total || 0,
    }));
    const { dates, values } = this.toDaily(revRows, 90);
    this.timeSeriesInsights({
      push,
      dates,
      values,
      measure: "revenue",
      measureLabel: "sales",
      unit: "currency",
      dimension: "overall",
      category: "sales",
    });

    const tableById = new Map(bundle.tables.map((t: any) => [t.id, t]));

    // ---- per-table aggregates --------------------------------------------
    const byTable = new Map<
      string,
      {
        revenue: number;
        checks: number;
        covers: number;
        wineChecks: number;
        tips: number;
      }
    >();
    const byWaiter = new Map<
      string,
      {
        revenue: number;
        checks: number;
        covers: number;
        wineChecks: number;
        tips: number;
      }
    >();
    const waiterObs: { y: number[]; waiter: string[]; table: string[] } = {
      y: [],
      waiter: [],
      table: [],
    };
    const transactions: string[][] = [];

    for (const c of checks) {
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      const hasWine = items.some((it) => it?.is_wine);
      const itemNames = items
        .map((it) => (it?.name ? String(it.name) : null))
        .filter(Boolean) as string[];
      if (itemNames.length >= 2) transactions.push(itemNames);

      if (c.table_id) {
        const t = byTable.get(c.table_id) || {
          revenue: 0,
          checks: 0,
          covers: 0,
          wineChecks: 0,
          tips: 0,
        };
        t.revenue += c.total || 0;
        t.checks += 1;
        t.covers += c.covers || 0;
        t.wineChecks += hasWine ? 1 : 0;
        t.tips += c.tip || 0;
        byTable.set(c.table_id, t);
      }
      const server = c.server_name || c.server_external_id;
      if (server) {
        const w = byWaiter.get(server) || {
          revenue: 0,
          checks: 0,
          covers: 0,
          wineChecks: 0,
          tips: 0,
        };
        w.revenue += c.total || 0;
        w.checks += 1;
        w.covers += c.covers || 0;
        w.wineChecks += hasWine ? 1 : 0;
        w.tips += c.tip || 0;
        byWaiter.set(server, w);
        if (c.table_id) {
          waiterObs.y.push(c.total || 0);
          waiterObs.waiter.push(server);
          waiterObs.table.push(c.table_id);
        }
      }
    }

    // Table peer ranking on avg check, with distance attribution.
    if (byTable.size >= 3) {
      const entries = Array.from(byTable.entries())
        .filter(([, v]) => v.checks >= 3)
        .map(([id, v]) => ({
          entity: id,
          value: v.revenue / v.checks,
        }));
      if (entries.length >= 3) {
        const standings = E.peerComparison(entries);
        const top = standings[0];
        const t: any = tableById.get(top.entity);
        let attributeReading: string | undefined;
        // correlate avg check with distances across tables
        const withAttrs = entries
          .map((e) => ({ v: e.value, t: tableById.get(e.entity) as any }))
          .filter((x) => x.t);
        if (withAttrs.length >= 4) {
          const attrs: Array<{ name: string; key: string }> = [
            { name: "distance to kitchen", key: "distance_to_kitchen_m" },
            { name: "distance to bar", key: "distance_to_bar_m" },
            { name: "distance to pool", key: "distance_to_pool_m" },
            { name: "seat count", key: "seats" },
          ];
          let best: { name: string; r: number } | null = null;
          for (const a of attrs) {
            const xs = withAttrs.map((x) => Number(x.t[a.key] ?? NaN));
            const pairs = withAttrs
              .map((x, i) => ({ x: xs[i], y: x.v }))
              .filter((p) => Number.isFinite(p.x));
            if (pairs.length < 4) continue;
            const r = E.pearson(
              pairs.map((p) => p.x),
              pairs.map((p) => p.y),
            );
            if (r !== null && (!best || Math.abs(r) > Math.abs(best.r)))
              best = { name: a.name, r };
          }
          if (best && Math.abs(best.r) >= 0.35) {
            attributeReading = tableAttributeReading(best.name, best.r);
            const evc: InsightEvidence = {
              entity: "tables",
              measureLabel: "average check",
              unit: "currency",
              r: best.r,
              attribute: best.name,
            };
            push(
              this.record(
                "table.avg_check.attribute_correlation",
                "tables",
                "correlation",
                evc,
                {
                  effectPct: best.r / 2,
                  z: Math.abs(best.r) * Math.sqrt(withAttrs.length),
                  n: withAttrs.length,
                },
              ),
            );
          }

          // Driver weights via ridge on table attributes.
          const X: number[][] = [];
          const y: number[] = [];
          for (const x of withAttrs) {
            const row = [
              Number(x.t.distance_to_kitchen_m ?? 0),
              Number(x.t.distance_to_bar_m ?? 0),
              Number(x.t.seats ?? 0),
              x.t.is_outdoor ? 1 : 0,
            ];
            X.push(row);
            y.push(x.v);
          }
          const reg = E.multipleRegression(X, y, { ridgeLambda: 0.1 });
          if (reg && reg.r2 > 0.15) {
            const names = [
              "kitchen distance",
              "bar distance",
              "seats",
              "outdoor",
            ];
            const drivers = reg.standardizedBetas
              .map((w, i) => ({ attribute: names[i], weight: w }))
              .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
            const evd: InsightEvidence = {
              measureLabel: "average check",
              unit: "currency",
              drivers,
            };
            push(
              this.record(
                "table.avg_check.driver_weights",
                "tables",
                "driver",
                evd,
                {
                  effectPct: reg.r2,
                  n: withAttrs.length,
                },
              ),
            );
          }
        }
        const ev: InsightEvidence = {
          entity: t?.label ? `Table ${t.label}` : "Top table",
          measureLabel: "average check",
          unit: "currency",
          value: top.value,
          rank: 1,
          peerCount: standings.length,
          deltaPct: top.pctVsMean,
          attributeReading,
        };
        push(
          this.record("table.avg_check.peer_rank", "tables", "peer", ev, {
            effectPct: top.pctVsMean,
            z: top.z,
            n: byTable.get(top.entity)?.checks ?? 0,
          }),
        );
      }
    }

    // Waiter peer + adjusted effects.
    if (byWaiter.size >= 2) {
      const entries = Array.from(byWaiter.entries())
        .filter(([, v]) => v.checks >= 3)
        .map(([name, v]) => ({ entity: name, value: v.revenue / v.checks }));
      if (entries.length >= 2) {
        const standings = E.peerComparison(entries);
        const top = standings[0];
        let attributeReading: string | undefined;
        if (waiterObs.y.length >= 10 && new Set(waiterObs.table).size >= 2) {
          const adj = E.adjustedGroupEffects({
            y: waiterObs.y,
            target: waiterObs.waiter,
            controls: [waiterObs.table],
          });
          if (adj) {
            const adjTop = adj.effects[0];
            attributeReading =
              adjTop.group === top.entity
                ? `Still #1 after adjusting for which tables they worked.`
                : `After adjusting for table assignments, ${adjTop.group} actually adds the most per check.`;
          }
        }
        const ev: InsightEvidence = {
          entity: top.entity,
          measureLabel: "average check",
          unit: "currency",
          value: top.value,
          rank: 1,
          peerCount: standings.length,
          deltaPct: top.pctVsMean,
          attributeReading,
        };
        push(
          this.record("waiter.avg_check.peer_rank", "staff", "peer", ev, {
            effectPct: top.pctVsMean,
            z: top.z,
            n: byWaiter.get(top.entity)?.checks ?? 0,
          }),
        );
      }
    }

    // Basket affinity.
    if (transactions.length >= 10) {
      const pairs = E.pairAssociations(transactions, {
        minCount: 3,
        maxPairs: 3,
      });
      const best = pairs.find((p) => p.lift > 1.3 && p.pValue < 0.1);
      if (best) {
        const ev: InsightEvidence = {
          measureLabel: "orders",
          unit: "count",
          pairA: best.a,
          pairB: best.b,
          lift: best.lift,
        };
        push(
          this.record("wine.bottles.basket_affinity", "basket", "basket", ev, {
            effectPct: (best.lift - 1) / 2,
            z: Math.sqrt(best.chi2),
            n: best.count,
          }),
        );
      }
    }

    // Hot tables — live surge detection on OPEN checks (no closed_at).
    const now = Date.now();
    const open = checks.filter((c: any) => !c.closed_at && c.opened_at);
    for (const c of open) {
      const t: any = c.table_id ? tableById.get(c.table_id) : null;
      const minutes = Math.max(
        5,
        (now - new Date(c.opened_at).getTime()) / 60000,
      );
      if (minutes > 240) continue; // stale
      const pace = (c.total || 0) / minutes; // $/min so far
      // typical pace for this table across history
      const hist = checks
        .filter(
          (h: any) =>
            h.table_id === c.table_id && h.closed_at && h.opened_at && h.total,
        )
        .map((h: any) => {
          const mins = Math.max(
            10,
            (new Date(h.closed_at).getTime() -
              new Date(h.opened_at).getTime()) /
              60000,
          );
          return h.total / mins;
        });
      if (hist.length < 5) continue;
      const z = E.robustZScore(pace, hist);
      if (z !== null && z >= 2 && (c.total || 0) > 0) {
        const ev: InsightEvidence = {
          entity: t?.label ? `Table ${t.label}` : "A table",
          measureLabel: "spend",
          unit: "currency",
          value: c.total || 0,
          z,
          surgeMinutes: Math.round(minutes),
        };
        push(
          this.record("table.revenue.hot_entity_live", "tables", "hot", ev, {
            effectPct: 0.5,
            z,
            n: hist.length,
            boost: 1.6,
          }),
        );
      }
    }
  }

  // ==========================================================================
  // Family: goals — pace vs target
  // ==========================================================================

  private computeGoalsFamily(bundle: Bundle, push: Push) {
    if (!bundle.availability.has("goals")) return;
    for (const g of bundle.goals) {
      const target = Number(g.target_value) || 0;
      const current = Number(g.current_value) || 0;
      if (target <= 0) continue;
      const progress = current / target;
      let daysLeft: number | null = null;
      let onTrack: boolean | null = null;
      if (g.deadline) {
        const total = g.created_at
          ? (new Date(g.deadline).getTime() -
              new Date(g.created_at).getTime()) /
            86400000
          : null;
        daysLeft = Math.max(
          0,
          Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000),
        );
        if (total && total > 0) {
          const elapsedFrac = Math.min(
            1,
            Math.max(0, (total - daysLeft) / total),
          );
          onTrack = progress >= elapsedFrac * 0.9; // within 10% of linear pace
        }
      }
      const ev: InsightEvidence = {
        measureLabel: g.metric_key,
        unit: "ratio",
        goalName: g.name,
        goalProgressPct: progress,
        goalDaysLeft: daysLeft ?? undefined,
        goalOnTrack: onTrack ?? undefined,
      };
      push(
        this.record("overall.revenue.goal_pace", "goals", "goal", ev, {
          effectPct: progress - 1,
          n: 14,
          boost: onTrack === false ? 1.5 : 1,
          entityLabel: g.name,
        }),
      );
    }
  }

  // ==========================================================================
  // Shared: standard time-series insight pack for one measure
  // ==========================================================================

  private timeSeriesInsights(params: {
    push: Push;
    dates: string[];
    values: number[];
    measure: string;
    measureLabel: string;
    unit: InsightEvidence["unit"];
    dimension: string;
    category: InsightCategory;
    periodWindow?: number;
    windowLabel?: string;
  }) {
    const {
      push,
      dates,
      values,
      measure,
      measureLabel,
      unit,
      dimension,
      category,
    } = params;
    const nonZeroDays = values.filter((v) => v > 0).length;
    if (nonZeroDays < 7) return;

    // 1. Latest complete day vs same-weekday history.
    const lastIdx = values.length - 1;
    const lastDate = dates[lastIdx];
    const weekday = new Date(`${lastDate}T00:00:00Z`).getUTCDay();
    const history: number[] = [];
    for (let i = 0; i < lastIdx; i++) {
      if (new Date(`${dates[i]}T00:00:00Z`).getUTCDay() === weekday)
        history.push(values[i]);
    }
    if (history.length >= 3) {
      const cmp = E.groupBaseline(values[lastIdx], history);
      if (cmp && cmp.direction !== "in_line") {
        const ev: InsightEvidence = {
          entity: E.WEEKDAY_NAMES[weekday],
          measureLabel,
          unit,
          value: cmp.value,
          baseline: cmp.baselineMean,
          deltaPct: cmp.deltaPct,
          direction: cmp.direction,
        };
        push(
          this.record(
            `${dimension}.${measure}.vs_same_weekday`,
            category,
            "baseline",
            ev,
            {
              effectPct: cmp.deltaPct,
              z: cmp.z,
              n: history.length,
            },
          ),
        );
      }
    }

    // 2. Period over period.
    const window = params.periodWindow ?? 7;
    const cmp = E.periodOverPeriod(values, window);
    if (cmp && cmp.deltaPct !== null && cmp.direction !== "flat") {
      const ev: InsightEvidence = {
        measureLabel,
        unit,
        value: cmp.current,
        baseline: cmp.previous,
        deltaPct: cmp.deltaPct,
        windowLabel: params.windowLabel ?? "week",
      };
      push(
        this.record(
          `${dimension}.${measure}.vs_prev_period_${window}d`,
          category,
          "period",
          ev,
          { effectPct: cmp.deltaPct, n: window * 2 },
        ),
      );
    }

    // 3. Trend (last 28 days, weekly slope as % of level).
    const recent = values.slice(-28);
    const trend = E.trendPerPeriodPct(recent);
    if (trend !== null && Math.abs(trend * 7) >= 0.05) {
      const ev: InsightEvidence = {
        measureLabel,
        unit,
        trendPctPerWeek: trend * 7,
        n: recent.length,
      };
      push(
        this.record(
          `${dimension}.${measure}.trend_direction`,
          category,
          "trend",
          ev,
          {
            effectPct: trend * 7,
            n: recent.length,
          },
        ),
      );
    }

    // 4. Anomaly scan over the last 14 days (robust z vs the 90-day window).
    for (let i = Math.max(0, values.length - 14); i < values.length; i++) {
      const rest = values.filter((_, j) => j !== i);
      const z = E.robustZScore(values[i], rest);
      if (z !== null && Math.abs(z) >= 3) {
        const ev: InsightEvidence = {
          measureLabel,
          unit,
          value: values[i],
          z,
          date: dates[i],
        };
        push(
          this.record(
            `${dimension}.${measure}.anomaly_day`,
            category,
            "anomaly",
            ev,
            {
              z,
              n: values.length,
            },
          ),
        );
        break; // one anomaly headline per measure
      }
    }
  }

  // ==========================================================================
  // Record assembly
  // ==========================================================================

  private record(
    candidateKey: string,
    category: InsightCategory,
    template: string,
    evidence: InsightEvidence,
    scoreParams: {
      effectPct?: number | null;
      z?: number | null;
      n?: number;
      boost?: number;
      entityLabel?: string;
    },
  ): InsightRecord | null {
    const sentence = verbalize(template, evidence);
    if (!sentence) return null;
    return {
      candidateKey,
      category,
      sentence,
      score: this.scoreOf(scoreParams),
      effectPct: scoreParams.effectPct ?? null,
      z: scoreParams.z ?? null,
      entityKey: scoreParams.entityLabel ?? evidence.entity ?? null,
      entityLabel: scoreParams.entityLabel ?? evidence.entity ?? null,
      evidence,
      periodStart: null,
      periodEnd: null,
    };
  }
}

// ---------------------------------------------------------------------------

type Push = (r: InsightRecord | null) => void;

export interface InsightRecord {
  candidateKey: string;
  category: InsightCategory;
  sentence: string;
  score: number;
  effectPct: number | null;
  z: number | null;
  entityKey: string | null;
  entityLabel: string | null;
  evidence: InsightEvidence;
  periodStart: string | null;
  periodEnd: string | null;
}

interface Bundle {
  restaurantId: string;
  consumption: Array<{ wineId: string; qty: number; date: string }>;
  orders: Array<{
    vendorId: string;
    vendorName: string;
    cost: number;
    date: string;
  }>;
  inventory: any[];
  checks: any[];
  tables: any[];
  venueFeatures: Record<string, unknown> | null;
  goals: any[];
  availability: Set<DataRequirement>;
}
