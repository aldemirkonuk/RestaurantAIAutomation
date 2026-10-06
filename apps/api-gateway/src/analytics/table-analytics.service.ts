import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { netSalesOf } from "./net-sales";

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

  /**
   * Non-voided checks opened in the last `sinceDays` days.
   *
   * A failed read THROWS (ADR 0067). It used to log and return `[]`, and every
   * caller then reported the failure as an empty feed: the waiter and table
   * registers said "pos_checks is empty" over a read that never answered.
   */
  private async loadChecks(restaurantId: string, sinceDays = 90) {
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select(
        "id, table_id, server_name, server_external_id, opened_at, closed_at, covers, subtotal, tip, items",
      )
      .eq("restaurant_id", restaurantId)
      // A voided check is not revenue. Its stock is reversed at ingest, but its
      // total used to keep counting here forever — every table and waiter
      // figure inherited it. Sales here are net (ADR 0295): `subtotal`.
      .eq("voided", false)
      .gte("opened_at", since);
    if (error) {
      this.logger.warn(`loadChecks failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "The POS checks could not be read, so nothing about them is claimed.",
      );
    }
    return data || [];
  }

  /**
   * What the window holds, said as what it is (ADR 0020, ADR 0051).
   *
   * `dataStatus` used to say the pos_checks table was empty whenever the
   * WINDOW held no check. /reports fixes the window at 90 days, so a house
   * whose feed stopped a season ago was told it had no checks at all, and the
   * server register then blamed "an absent field on the POS feed" (analytics
   * walk 2026-10-03, A-040). Three different facts, now three different
   * answers:
   *
   *   checks in the window   "live" (scenario-verify keys on that word), and
   *                          `latestCheckAt` is the newest one among them;
   *   none, but older ones   the window is empty, and the newest check's date;
   *   none ever              no POS check is recorded for this restaurant.
   *
   * The probe runs ONLY when the window is empty — one row off
   * idx_pos_checks_restaurant_opened (restaurant_id, opened_at DESC) — and is
   * filtered on `voided` like the window, so the two can never disagree about
   * which checks count. A failed probe throws: an unreadable history is not
   * "no check ever" (ADR 0067).
   */
  private async feedStatus(
    restaurantId: string,
    sinceDays: number,
    checks: Array<{ opened_at?: string | null }>,
  ): Promise<{
    dataStatus: string;
    checksInWindow: number;
    latestCheckAt: string | null;
  }> {
    if (checks.length > 0) {
      let latest: string | null = null;
      for (const c of checks)
        if (c.opened_at && (latest === null || isoOf(c.opened_at) > latest))
          latest = isoOf(c.opened_at);
      return {
        dataStatus: "live",
        checksInWindow: checks.length,
        latestCheckAt: latest,
      };
    }
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("opened_at")
      .eq("restaurant_id", restaurantId)
      .eq("voided", false)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      this.logger.warn(`latest POS check probe failed: ${error.message}`);
      throw new ServiceUnavailableException(
        "Whether this restaurant has any POS check could not be read, so nothing about its feed is claimed.",
      );
    }
    const raw = (data as { opened_at?: string | null } | null)?.opened_at;
    if (!raw)
      return {
        dataStatus:
          "awaiting POS check feed — no POS check is recorded for this restaurant (voided checks are not counted)",
        checksInWindow: 0,
        latestCheckAt: null,
      };
    const latest = isoOf(raw);
    return {
      dataStatus: `no POS check opened in the last ${sinceDays} days — the latest was opened ${latest.slice(0, 10)} (UTC)`,
      checksInWindow: 0,
      latestCheckAt: latest,
    };
  }

  // ==========================================================================
  // Table performance — per-table metrics + geometry attribution
  // ==========================================================================

  async getTablePerformance(restaurantId: string, sinceDays = 90) {
    const [tables, checks] = await Promise.all([
      this.listTables(restaurantId),
      this.loadChecks(restaurantId, sinceDays),
    ]);

    // Sales are net (ADR 0295): the subtotal, before tax, surcharge and tip.
    // A check without one is counted in `checks` and left out of every sales
    // figure (`netChecks` says how many carried one); its total is never read.
    const agg = new Map<string, SalesTally>();
    for (const c of checks) {
      if (!c.table_id) continue;
      const a = agg.get(c.table_id) || newSalesTally();
      tallySale(a, c);
      agg.set(c.table_id, a);
    }

    const rows = tables.map((t: any) => {
      const a = agg.get(t.id);
      const revenue = a ? salesOf(a) : 0;
      const avgCheck = a && a.netChecks > 0 ? a.net / a.netChecks : null;
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
        netChecks: a?.netChecks ?? 0,
        revenue,
        covers: a?.covers ?? 0,
        avgCheck,
        revenuePerSeat:
          revenue !== null && t.seats > 0 ? revenue / t.seats : null,
        checkinDensity: a && t.seats > 0 ? (a.covers || 0) / t.seats : null,
        checksPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
        wineRevenuePerSeat: null as number | null, // filled when wine $ available on check
        revenuePerCover:
          a && a.netCovers > 0 ? a.netOnCovers / a.netCovers : null,
        seatUtilization:
          a && t.seats > 0
            ? Math.min(1, (a.covers || 0) / (t.seats * Math.max(1, a.checks)))
            : null,
        wineAttachRate: a && a.checks > 0 ? a.wineChecks / a.checks : null,
        tipPct: a && a.netWithTip > 0 ? a.tips / a.netWithTip : null,
        tipPerSeat: a && t.seats > 0 ? a.tips / t.seats : null,
        turnoverPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
      };
    });

    // Peer standings on avg check (tables with enough sample).
    const eligible = rows.filter(
      (r) => r.netChecks >= 3 && r.avgCheck !== null,
    );
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
      basis: "net" as const,
      tables: rows.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      correlations,
      drivers,
      ...(await this.feedStatus(restaurantId, sinceDays, checks)),
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Waiter performance — raw + table-adjusted
  // ==========================================================================

  async getWaiterPerformance(restaurantId: string, sinceDays = 90) {
    const checks = await this.loadChecks(restaurantId, sinceDays);
    const byWaiter = new Map<string, SalesTally>();
    const obs = {
      y: [] as number[],
      waiter: [] as string[],
      table: [] as string[],
    };

    for (const c of checks) {
      const server = c.server_name || c.server_external_id;
      if (!server) continue;
      const a = byWaiter.get(server) || newSalesTally();
      const net = tallySale(a, c);
      byWaiter.set(server, a);
      // The lift is fitted on net sales, so a check without a subtotal has
      // no y and stays out of the fit rather than entering it as $0.
      if (c.table_id && net !== null) {
        obs.y.push(net);
        obs.waiter.push(server);
        obs.table.push(c.table_id);
      }
    }

    const waiters = Array.from(byWaiter.entries()).map(([name, a]) => ({
      name,
      checks: a.checks,
      netChecks: a.netChecks,
      revenue: salesOf(a),
      avgCheck: a.netChecks > 0 ? a.net / a.netChecks : null,
      wineAttachRate: a.checks > 0 ? a.wineChecks / a.checks : null,
      tipPct: a.netWithTip > 0 ? a.tips / a.netWithTip : null,
      revenuePerCover: a.netCovers > 0 ? a.netOnCovers / a.netCovers : null,
    }));

    const standings = E.peerComparison(
      waiters
        .filter((w) => w.netChecks >= 3 && w.avgCheck !== null)
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
      basis: "net" as const,
      waiters: waiters.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      adjusted,
      ...(await this.feedStatus(restaurantId, sinceDays, checks)),
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
    const feed = await this.feedStatus(restaurantId, sinceDays, checks);
    return {
      sinceDays,
      transactionCount: transactions.length,
      pairs,
      ...feed,
      // Checks in the window, none listing two named items, is a third fact:
      // the feed is live and the checks are there, but there is no basket.
      dataStatus:
        feed.checksInWindow > 0 && transactions.length === 0
          ? `${feed.checksInWindow} POS check${feed.checksInWindow === 1 ? "" : "s"} in the last ${sinceDays} days, none listing two or more named items`
          : feed.dataStatus,
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Hot tables — live surge watchlist
  // ==========================================================================

  async getHotTables(restaurantId: string) {
    const sinceDays = 90;
    const checks = await this.loadChecks(restaurantId, sinceDays);
    const tables = await this.listTables(restaurantId);
    const tableById = new Map(tables.map((t: any) => [t.id, t]));
    const now = Date.now();

    // Pace is net sales per minute (ADR 0295); a check without a subtotal
    // has no pace and is not compared, rather than pacing at $0.
    const closedPace = new Map<string, number[]>();
    for (const h of checks) {
      const net = netSalesOf(h);
      if (!h.table_id || !h.closed_at || !h.opened_at || !net) continue;
      const mins = Math.max(
        10,
        (new Date(h.closed_at).getTime() - new Date(h.opened_at).getTime()) /
          60000,
      );
      const arr = closedPace.get(h.table_id) || [];
      arr.push(net / mins);
      closedPace.set(h.table_id, arr);
    }

    const hot: any[] = [];
    for (const c of checks) {
      if (c.closed_at || !c.opened_at) continue; // only open checks
      const minutes = (now - new Date(c.opened_at).getTime()) / 60000;
      if (minutes < 5 || minutes > 240) continue;
      const spend = netSalesOf(c);
      const pace = spend === null ? null : spend / minutes;
      const hist = c.table_id ? closedPace.get(c.table_id) || [] : [];
      const z =
        pace !== null && hist.length >= 5 ? E.robustZScore(pace, hist) : null;
      const t: any = c.table_id ? tableById.get(c.table_id) : null;
      hot.push({
        checkId: c.id,
        table: t?.label ?? null,
        zone: t?.zone ?? null,
        server: c.server_name || c.server_external_id || null,
        openMinutes: Math.round(minutes),
        spendSoFar: spend,
        pacePerMin: pace,
        surgeZ: z,
        watch: z !== null && z >= 2,
      });
    }
    hot.sort((a, b) => (b.surgeZ ?? -99) - (a.surgeZ ?? -99));
    return {
      basis: "net" as const,
      openChecks: hot.length,
      watchlist: hot.filter((h) => h.watch),
      all: hot,
      ...(await this.feedStatus(restaurantId, sinceDays, checks)),
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * One table's or one server's sales, net (ADR 0295). `net` sums the
 * subtotals of the `netChecks` checks that carried one; `checks` counts them
 * all. Per-cover and tip rates divide only over checks that carry both
 * figures, so a check with covers but no subtotal never deflates a rate.
 */
interface SalesTally {
  checks: number;
  netChecks: number;
  net: number;
  covers: number;
  /** Net sales of the checks that also recorded covers. */
  netOnCovers: number;
  /** Covers on the checks that also carried a subtotal. */
  netCovers: number;
  wineChecks: number;
  tips: number;
  /** Net sales of the checks whose tip was recorded: the tip rate's base. */
  netWithTip: number;
}

function newSalesTally(): SalesTally {
  return {
    checks: 0,
    netChecks: 0,
    net: 0,
    covers: 0,
    netOnCovers: 0,
    netCovers: 0,
    wineChecks: 0,
    tips: 0,
    netWithTip: 0,
  };
}

/** Add one check to a tally; returns its net sales (`null` if unstated). */
function tallySale(a: SalesTally, c: any): number | null {
  const net = netSalesOf(c);
  a.checks += 1;
  a.covers += c.covers || 0;
  const items: any[] = Array.isArray(c.items) ? c.items : [];
  a.wineChecks += items.some((it) => it?.is_wine) ? 1 : 0;
  if (net === null) return null;
  a.netChecks += 1;
  a.net += net;
  if (c.covers > 0) {
    a.netOnCovers += net;
    a.netCovers += c.covers;
  }
  // The tip rate is on net (AW17): tips over the net of the checks that
  // recorded a tip. It used to divide by the gross total.
  if (c.tip != null && net > 0) {
    a.tips += Number(c.tip) || 0;
    a.netWithTip += net;
  }
  return net;
}

/** A tally's net sales: `null` ("not recorded") when no check carried one. */
function salesOf(a: SalesTally): number | null {
  return a.netChecks > 0 ? a.net : a.checks > 0 ? null : 0;
}

/**
 * A timestamptz as a UTC ISO string, so two of them compare as strings and a
 * date can be sliced off the front. An unparseable value is returned as it
 * came rather than replaced with a date nobody recorded.
 */
function isoOf(v: string): string {
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString();
}
