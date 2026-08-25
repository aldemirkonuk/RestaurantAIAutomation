import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";

/**
 * TableAnalyticsService — floor-geometry & staff analytics over pos_checks.
 *
 * Everything here reads the POS-agnostic `pos_checks` staging table (fed by
 * Toast/Square/Lightspeed adapters or manual import) joined to
 * `restaurant_tables` floor facts. Answers:
 *
 *   • Which tables genuinely outperform — and is it the table or its spot?
 *     (distance-to-kitchen/bar/pool correlations + ridge driver weights)
 *   • Which waiters lift checks AFTER adjusting for the tables they worked
 *     (dummy-encoded ridge — "adjusted plus-minus")
 *   • What sells together (pair lift on check items)
 *   • Which open tables are surging right now (live watchlist)
 */
@Injectable()
export class TableAnalyticsService {
  private readonly logger = new Logger(TableAnalyticsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  // ==========================================================================
  // Floor CRUD (tables + venue profile)
  // ==========================================================================

  async listTables(restaurantId: string) {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .order("label");
    if (error) throw new Error(error.message);
    return data || [];
  }

  async upsertTable(restaurantId: string, table: any) {
    const client = this.dbService.getClient();
    const row = {
      restaurant_id: restaurantId,
      label: String(table.label ?? "").trim(),
      seats: Number(table.seats) || 2,
      zone: table.zone ?? null,
      is_outdoor: Boolean(table.is_outdoor),
      distance_to_kitchen_m: table.distance_to_kitchen_m ?? null,
      distance_to_bar_m: table.distance_to_bar_m ?? null,
      distance_to_pool_m: table.distance_to_pool_m ?? null,
      x_pos: table.x_pos ?? null,
      y_pos: table.y_pos ?? null,
      updated_at: new Date().toISOString(),
    };
    if (!row.label) throw new Error("Table label is required");
    const { data, error } = await client
      .from("restaurant_tables")
      .upsert(row, { onConflict: "restaurant_id,label" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async getVenueProfile(restaurantId: string) {
    const { data } = await this.dbService
      .getClient()
      .from("restaurant_venue_profiles")
      .select("features, updated_at")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    return data ?? { features: {}, updated_at: null };
  }

  async setVenueProfile(
    restaurantId: string,
    features: Record<string, unknown>,
  ) {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_venue_profiles")
      .upsert({
        restaurant_id: restaurantId,
        features: features ?? {},
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  // ==========================================================================
  // Shared check loading
  // ==========================================================================

  private async loadChecks(restaurantId: string, sinceDays = 90) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select(
        "id, table_id, server_name, server_external_id, opened_at, closed_at, covers, total, tip, items",
      )
      .eq("restaurant_id", restaurantId)
      // A voided check is not revenue. Its stock is reversed at ingest, but its
      // `total` used to keep counting here forever — every table and waiter
      // figure inherited it.
      .eq("voided", false)
      .gte("opened_at", since);
    if (error) {
      this.logger.warn(`loadChecks failed: ${error.message}`);
      return [];
    }
    return data || [];
  }

  // ==========================================================================
  // Table performance — per-table metrics + geometry attribution
  // ==========================================================================

  async getTablePerformance(restaurantId: string, sinceDays = 90) {
    const [tables, checks] = await Promise.all([
      this.listTables(restaurantId),
      this.loadChecks(restaurantId, sinceDays),
    ]);

    const agg = new Map<
      string,
      {
        revenue: number;
        checks: number;
        covers: number;
        wineChecks: number;
        tips: number;
        totalWithTip: number;
      }
    >();
    for (const c of checks) {
      if (!c.table_id) continue;
      const a = agg.get(c.table_id) || {
        revenue: 0,
        checks: 0,
        covers: 0,
        wineChecks: 0,
        tips: 0,
        totalWithTip: 0,
      };
      a.revenue += c.total || 0;
      a.checks += 1;
      a.covers += c.covers || 0;
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      a.wineChecks += items.some((it) => it?.is_wine) ? 1 : 0;
      if (c.tip != null && c.total) {
        a.tips += c.tip;
        a.totalWithTip += c.total;
      }
      agg.set(c.table_id, a);
    }

    const rows = tables.map((t: any) => {
      const a = agg.get(t.id);
      const avgCheck = a && a.checks > 0 ? a.revenue / a.checks : null;
      return {
        tableId: t.id,
        label: t.label,
        zone: t.zone,
        seats: t.seats,
        isOutdoor: t.is_outdoor,
        distanceToKitchenM: t.distance_to_kitchen_m,
        distanceToBarM: t.distance_to_bar_m,
        distanceToPoolM: t.distance_to_pool_m,
        checks: a?.checks ?? 0,
        revenue: a?.revenue ?? 0,
        covers: a?.covers ?? 0,
        avgCheck,
        revenuePerSeat: a && t.seats > 0 ? a.revenue / t.seats : null,
        checkinDensity: a && t.seats > 0 ? (a.covers || 0) / t.seats : null,
        checksPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
        wineRevenuePerSeat: null as number | null, // filled when wine $ available on check
        revenuePerCover: a && a.covers > 0 ? a.revenue / a.covers : null,
        seatUtilization:
          a && t.seats > 0
            ? Math.min(1, (a.covers || 0) / (t.seats * Math.max(1, a.checks)))
            : null,
        wineAttachRate: a && a.checks > 0 ? a.wineChecks / a.checks : null,
        tipPct: a && a.totalWithTip > 0 ? a.tips / a.totalWithTip : null,
        tipPerSeat: a && t.seats > 0 ? a.tips / t.seats : null,
        turnoverPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
      };
    });

    // Peer standings on avg check (tables with enough sample).
    const eligible = rows.filter((r) => r.checks >= 3 && r.avgCheck !== null);
    const standings = E.peerComparison(
      eligible.map((r) => ({ entity: r.tableId, value: r.avgCheck as number })),
    );
    const standingByTable = new Map(standings.map((s) => [s.entity, s]));
    for (const r of rows as any[]) {
      const s = standingByTable.get(r.tableId);
      r.rank = s?.rank ?? null;
      r.pctVsMean = s?.pctVsMean ?? null;
    }

    // Geometry correlations: measure × attribute matrix (Pearson + partial
    // controlling seats), only across tables with data.
    const attrs = [
      { key: "distanceToKitchenM", label: "distance to kitchen" },
      { key: "distanceToBarM", label: "distance to bar" },
      { key: "distanceToPoolM", label: "distance to pool" },
      { key: "seats", label: "seats" },
    ] as const;
    const measures = [
      { key: "avgCheck", label: "average check" },
      { key: "revenuePerSeat", label: "revenue per seat" },
      { key: "checkinDensity", label: "check-in density" },
      { key: "wineAttachRate", label: "wine attach rate" },
      { key: "tipPct", label: "tip %" },
      { key: "revenuePerCover", label: "sales per cover" },
      { key: "seatUtilization", label: "seat utilization" },
      { key: "tipPerSeat", label: "tips per seat" },
    ] as const;

    const correlations: any[] = [];
    for (const m of measures) {
      for (const a of attrs) {
        const pairs = eligible
          .map((r: any) => ({ x: Number(r[a.key]), y: Number(r[m.key]) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pairs.length < 4) continue;
        const xs = pairs.map((p) => p.x);
        const ys = pairs.map((p) => p.y);
        const r = E.pearson(xs, ys);
        if (r === null) continue;
        let partial: number | null = null;
        if (a.key !== "seats") {
          const seats = eligible
            .map((t: any) => ({
              s: Number(t.seats),
              x: Number(t[a.key]),
              y: Number(t[m.key]),
            }))
            .filter(
              (p) =>
                Number.isFinite(p.s) &&
                Number.isFinite(p.x) &&
                Number.isFinite(p.y),
            );
          if (seats.length >= 5) {
            partial = E.partialCorrelation(
              seats.map((p) => p.x),
              seats.map((p) => p.y),
              [seats.map((p) => p.s)],
            );
          }
        }
        correlations.push({
          measure: m.label,
          attribute: a.label,
          r,
          rControllingSeats: partial,
          n: pairs.length,
        });
      }
    }
    correlations.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

    // Ridge driver weights for avg check from geometry (the "ML-adjusted
    // weights" — standardized betas learned from this restaurant's own data).
    let drivers: any = null;
    const featRows = eligible.map((r: any) => ({
      x: [
        Number(r.distanceToKitchenM ?? 0),
        Number(r.distanceToBarM ?? 0),
        Number(r.seats ?? 0),
        r.isOutdoor ? 1 : 0,
      ],
      y: r.avgCheck as number,
    }));
    if (featRows.length >= 5) {
      const reg = E.multipleRegression(
        featRows.map((f) => f.x),
        featRows.map((f) => f.y),
        { ridgeLambda: 0.1 },
      );
      if (reg) {
        const names = ["kitchen distance", "bar distance", "seats", "outdoor"];
        drivers = {
          r2: reg.r2,
          weights: reg.standardizedBetas
            .map((w, i) => ({ attribute: names[i], weight: w }))
            .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)),
        };
      }
    }

    return {
      sinceDays,
      tables: rows.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      correlations,
      drivers,
      dataStatus: checks.length
        ? "live"
        : "awaiting POS check feed (pos_checks is empty)",
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Waiter performance — raw + table-adjusted
  // ==========================================================================

  async getWaiterPerformance(restaurantId: string, sinceDays = 90) {
    const checks = await this.loadChecks(restaurantId, sinceDays);
    const byWaiter = new Map<
      string,
      {
        revenue: number;
        checks: number;
        covers: number;
        wineChecks: number;
        tips: number;
        totalWithTip: number;
      }
    >();
    const obs = {
      y: [] as number[],
      waiter: [] as string[],
      table: [] as string[],
    };

    for (const c of checks) {
      const server = c.server_name || c.server_external_id;
      if (!server) continue;
      const a = byWaiter.get(server) || {
        revenue: 0,
        checks: 0,
        covers: 0,
        wineChecks: 0,
        tips: 0,
        totalWithTip: 0,
      };
      a.revenue += c.total || 0;
      a.checks += 1;
      a.covers += c.covers || 0;
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      a.wineChecks += items.some((it) => it?.is_wine) ? 1 : 0;
      if (c.tip != null && c.total) {
        a.tips += c.tip;
        a.totalWithTip += c.total;
      }
      byWaiter.set(server, a);
      if (c.table_id) {
        obs.y.push(c.total || 0);
        obs.waiter.push(server);
        obs.table.push(c.table_id);
      }
    }

    const waiters = Array.from(byWaiter.entries()).map(([name, a]) => ({
      name,
      checks: a.checks,
      revenue: a.revenue,
      avgCheck: a.checks > 0 ? a.revenue / a.checks : null,
      wineAttachRate: a.checks > 0 ? a.wineChecks / a.checks : null,
      tipPct: a.totalWithTip > 0 ? a.tips / a.totalWithTip : null,
      revenuePerCover: a.covers > 0 ? a.revenue / a.covers : null,
    }));

    const standings = E.peerComparison(
      waiters
        .filter((w) => w.checks >= 3 && w.avgCheck !== null)
        .map((w) => ({ entity: w.name, value: w.avgCheck as number })),
    );
    const standingByName = new Map(standings.map((s) => [s.entity, s]));
    for (const w of waiters as any[]) {
      const s = standingByName.get(w.name);
      w.rank = s?.rank ?? null;
      w.pctVsMean = s?.pctVsMean ?? null;
    }

    // Table-adjusted effects (only meaningful with table attribution).
    let adjusted: any = null;
    if (obs.y.length >= 10 && new Set(obs.table).size >= 2) {
      const adj = E.adjustedGroupEffects({
        y: obs.y,
        target: obs.waiter,
        controls: [obs.table],
      });
      if (adj) {
        adjusted = {
          method:
            "ridge regression with table fixed effects — each waiter's lift after removing table quality",
          r2: adj.r2,
          effects: adj.effects,
        };
      }
    }

    return {
      sinceDays,
      waiters: waiters.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      adjusted,
      dataStatus: checks.length
        ? "live"
        : "awaiting POS check feed (pos_checks is empty)",
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Basket — what sells together
  // ==========================================================================

  async getBasketAffinity(restaurantId: string, sinceDays = 90) {
    const checks = await this.loadChecks(restaurantId, sinceDays);
    const transactions: string[][] = [];
    for (const c of checks) {
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      const names = items
        .map((it) => (it?.name ? String(it.name) : null))
        .filter(Boolean) as string[];
      if (names.length >= 2) transactions.push(names);
    }
    const pairs = E.pairAssociations(transactions, {
      minCount: 3,
      maxPairs: 40,
    });
    return {
      sinceDays,
      transactionCount: transactions.length,
      pairs,
      dataStatus: transactions.length
        ? "live"
        : "awaiting POS check items (pos_checks.items is empty)",
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Hot tables — live surge watchlist
  // ==========================================================================

  async getHotTables(restaurantId: string) {
    const checks = await this.loadChecks(restaurantId, 90);
    const tables = await this.listTables(restaurantId);
    const tableById = new Map(tables.map((t: any) => [t.id, t]));
    const now = Date.now();

    const closedPace = new Map<string, number[]>();
    for (const h of checks) {
      if (!h.table_id || !h.closed_at || !h.opened_at || !h.total) continue;
      const mins = Math.max(
        10,
        (new Date(h.closed_at).getTime() - new Date(h.opened_at).getTime()) /
          60000,
      );
      const arr = closedPace.get(h.table_id) || [];
      arr.push(h.total / mins);
      closedPace.set(h.table_id, arr);
    }

    const hot: any[] = [];
    for (const c of checks) {
      if (c.closed_at || !c.opened_at) continue; // only open checks
      const minutes = (now - new Date(c.opened_at).getTime()) / 60000;
      if (minutes < 5 || minutes > 240) continue;
      const pace = (c.total || 0) / minutes;
      const hist = c.table_id ? closedPace.get(c.table_id) || [] : [];
      const z = hist.length >= 5 ? E.robustZScore(pace, hist) : null;
      const t: any = c.table_id ? tableById.get(c.table_id) : null;
      hot.push({
        checkId: c.id,
        table: t?.label ?? null,
        zone: t?.zone ?? null,
        server: c.server_name || c.server_external_id || null,
        openMinutes: Math.round(minutes),
        spendSoFar: c.total || 0,
        pacePerMin: pace,
        surgeZ: z,
        watch: z !== null && z >= 2,
      });
    }
    hot.sort((a, b) => (b.surgeZ ?? -99) - (a.surgeZ ?? -99));
    return {
      openChecks: hot.length,
      watchlist: hot.filter((h) => h.watch),
      all: hot,
      dataStatus: checks.length
        ? "live"
        : "awaiting POS check feed (pos_checks is empty)",
      generatedAt: new Date().toISOString(),
    };
  }
}
