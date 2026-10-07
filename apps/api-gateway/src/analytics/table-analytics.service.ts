import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";

/** A table's id as Postgres stores it; anything else cannot be one of the house's. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /**
   * Rename or hide one table of the house (ADR 0303). The route admits an
   * owner or a manager (founder fork F1) and pins :restaurantId to the
   * caller's house; every read and write here is scoped to that house too, so
   * another house's table id is a 404 and never a write.
   *
   * A name is 1-60 characters after trimming, and no other table of the house
   * (retired ones included) may answer to it in any case: two tables with one
   * name would split the till's checks between them. `hidden` true hides the
   * table from the room, its export and the hot list while it still catches
   * its checks (founder fork F2; the insight generator leaves it out too, ADR
   * 0303 amendment 2026-10-05); false shows it again. Merging two till names into one table is not
   * offered (ADR 0303 residual).
   */
  async renameOrHideTable(
    restaurantId: string,
    tableId: string,
    body: unknown,
  ) {
    const b =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    let label: string | undefined;
    if (b.label !== undefined) {
      if (typeof b.label !== "string")
        throw new BadRequestException("A table's name is text.");
      label = b.label.trim();
      if (label.length < 1 || label.length > 60)
        throw new BadRequestException("A table's name is 1 to 60 characters.");
    }
    if (b.hidden !== undefined && typeof b.hidden !== "boolean")
      throw new BadRequestException("hidden is true or false.");
    if (label === undefined && b.hidden === undefined)
      throw new BadRequestException(
        "Send a new name (label), or hidden: true or false.",
      );
    if (!UUID_RE.test(tableId))
      throw new NotFoundException("This house has no such table.");

    const client = this.dbService.getClient();
    const { data: house, error: readError } = await client
      .from("restaurant_tables")
      .select("id, label, hidden_at, is_active")
      .eq("restaurant_id", restaurantId);
    if (readError) {
      this.logger.warn(`renameOrHideTable read failed: ${readError.message}`);
      throw new ServiceUnavailableException(
        "The house's tables could not be read, so nothing was changed.",
      );
    }
    const rows = (house ?? []) as Array<{
      id: string;
      label: string;
      hidden_at: string | null;
      is_active: boolean;
    }>;
    const current = rows.find((t) => t.id === tableId && t.is_active);
    if (!current) throw new NotFoundException("This house has no such table.");

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (label !== undefined && label !== current.label) {
      const wanted = label.toLowerCase();
      const clash = rows.find(
        (t) =>
          t.id !== tableId && String(t.label).trim().toLowerCase() === wanted,
      );
      if (clash)
        throw new ConflictException(
          `Another table in this house is already called "${clash.label}".`,
        );
      patch.label = label;
    }
    if (b.hidden === true && !current.hidden_at)
      patch.hidden_at = new Date().toISOString();
    if (b.hidden === false && current.hidden_at) patch.hidden_at = null;

    const { data, error } = await client
      .from("restaurant_tables")
      .update(patch)
      .eq("restaurant_id", restaurantId)
      .eq("id", tableId)
      .select()
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictException(
          `Another table in this house is already called "${label}".`,
        );
      this.logger.error(`renameOrHideTable write failed: ${error.message}`);
      throw new InternalServerErrorException("The table could not be changed.");
    }
    if (!data) throw new NotFoundException("This house has no such table.");
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

    // ADR 0303. A hidden table still catches its checks, so they stay in
    // takings, but it leaves every figure this register computes (founder
    // fork F2: "Out of every figure"; the insight generator's part is ADR
    // 0303's amendment of 2026-10-05). A retired table (is_active false) is not listed at all;
    // its checks are counted with the hidden ones. A check the till sent
    // without a table is counted, not dropped: the register says how many.
    const shown = tables.filter((t: any) => !t.hidden_at);
    const shownIds = new Set(shown.map((t: any) => t.id));
    let checksWithoutTable = 0;
    let checksAtHiddenTables = 0;
    const hiddenWithChecks = new Set<string>();

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
      if (!c.table_id) {
        checksWithoutTable++;
        continue;
      }
      if (!shownIds.has(c.table_id)) {
        checksAtHiddenTables++;
        hiddenWithChecks.add(c.table_id);
        continue;
      }
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

    const rows = shown.map((t: any) => {
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

    // A value nobody recorded is absent, never 0: a learned table carries no
    // seats and no distances (ADR 0303), and `Number(null)` is 0.
    const correlations: any[] = [];
    for (const m of measures) {
      for (const a of attrs) {
        const pairs = eligible
          .map((r: any) => ({ x: recorded(r[a.key]), y: recorded(r[m.key]) }))
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
              s: recorded(t.seats),
              x: recorded(t[a.key]),
              y: recorded(t[m.key]),
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
    // Only a feature recorded on at least 5 eligible tables, and not the same
    // on all of them, enters; the fit runs over the tables that carry every
    // feature kept. It used to zero-fill a missing distance (`?? 0`) and read
    // a missing outdoor flag as indoors, so a house with no geometry got a
    // fitted model of zeros. With no feature kept, there is no model (null).
    const features: Array<{ name: string; of: (r: any) => number }> = [
      { name: "kitchen distance", of: (r) => recorded(r.distanceToKitchenM) },
      { name: "bar distance", of: (r) => recorded(r.distanceToBarM) },
      { name: "seats", of: (r) => recorded(r.seats) },
      {
        name: "outdoor",
        of: (r) =>
          typeof r.isOutdoor === "boolean" ? (r.isOutdoor ? 1 : 0) : NaN,
      },
    ];
    const kept = features.filter((f) => {
      const values = eligible.map(f.of).filter((v) => Number.isFinite(v));
      return values.length >= 5 && new Set(values).size > 1;
    });
    let drivers: any = null;
    const featRows = eligible
      .map((r: any) => ({
        x: kept.map((f) => f.of(r)),
        y: r.avgCheck as number,
      }))
      .filter((f) => f.x.every((v) => Number.isFinite(v)));
    if (kept.length > 0 && featRows.length >= 5) {
      const reg = E.multipleRegression(
        featRows.map((f) => f.x),
        featRows.map((f) => f.y),
        { ridgeLambda: 0.1 },
      );
      if (reg) {
        drivers = {
          r2: reg.r2,
          weights: reg.standardizedBetas
            .map((w, i) => ({ attribute: kept[i].name, weight: w }))
            .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)),
        };
      }
    }
    const geometryRecorded = shown.filter(
      (t: any) =>
        t.distance_to_kitchen_m != null ||
        t.distance_to_bar_m != null ||
        t.distance_to_pool_m != null,
    ).length;

    return {
      sinceDays,
      tables: rows.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      correlations,
      drivers,
      /**
       * Checks in the window with no table: the till named none, or a word no
       * table answers (a word with no digit makes no table, ADR 0303). In
       * takings, in no table's figure.
       */
      checksWithoutTable,
      /** Checks in the window at a hidden (or retired) table. In takings, in no table's figure. */
      checksAtHiddenTables,
      /** How many hidden (or retired) tables those checks were at. */
      hiddenTables: hiddenWithChecks.size,
      /**
       * The house's tables that are hidden now, whatever the window held. With
       * no shown table and no check, it tells "every table is hidden" from
       * "this house has no table yet".
       */
      hiddenTablesInHouse: tables.length - shown.length,
      /** Shown tables learned from the till (ADR 0303), as against added by hand. */
      learnedTables: shown.filter((t: any) => t.learned_at != null).length,
      /** Shown tables with at least one distance recorded. */
      geometryRecorded,
      ...(await this.feedStatus(restaurantId, sinceDays, checks)),
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
    // A hidden table leaves the hot list too (ADR 0303): its open checks are
    // counted, not watched.
    const hidden = new Set(
      tables.filter((t: any) => t.hidden_at).map((t: any) => t.id),
    );
    let openChecksAtHiddenTables = 0;
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
      if (c.table_id && hidden.has(c.table_id)) {
        openChecksAtHiddenTables++;
        continue;
      }
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
      openChecksAtHiddenTables,
      watchlist: hot.filter((h) => h.watch),
      all: hot,
      ...(await this.feedStatus(restaurantId, sinceDays, checks)),
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * A recorded number, or NaN when nothing was recorded. `Number(null)` is 0,
 * which made an unrecorded distance or seat count read as a measured zero.
 */
function recorded(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  return Number(v);
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
