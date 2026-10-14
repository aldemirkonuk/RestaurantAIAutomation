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
import { WholeReadError, readWholeWindow } from "../common/read-whole-window";
import {
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
} from "../common/house-day";
import {
  PERIOD_TAX_NOTE_UNREAD,
  readPeriodTaxNote,
} from "../common/period-tax-note";
import { netSalesOf } from "../dashboard/dashboard.service";
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
   * Non-voided checks opened in the last `sinceDays` days, read WHOLE or not
   * at all (ADR 0292).
   *
   * The unranged select this replaces stopped at PostgREST's 1,000 rows, so
   * "Who served it" ranked the floor on 1,000 of 3,341 checks (29.6% of the
   * takings) under "the last 90 days" and put last place first (A-006). A
   * failed or partial read now THROWS (ADR 0067): it used to log and return
   * `[]`, and every caller then reported the failure as an empty feed: the
   * waiter and table registers said "pos_checks is empty" over a read that
   * never answered.
   *
   * The window is the till's (F-575): the last `sinceDays` days on the house's
   * clock, today included, each check filed on the house day it closed, else
   * opened (ADR 0296, `goals.service.ts` computeMetric). It used to be the
   * last `sinceDays × 24h` by when each check OPENED, so a check opened before
   * the till's first midnight and closed after it, or one that fell inside one
   * window and not the other, made the tables and the servers fail to add up
   * to the till's "Taken" over the same 90 days. A house with no zone has no
   * house days and the till states no figure for it, so there is nothing to
   * reconcile with: it keeps the rolling window.
   */
  private async loadChecks(restaurantId: string, sinceDays = 90) {
    const client = this.dbService.getClient();
    let zone: string | null;
    try {
      zone = (await readHouseZone(client, restaurantId)).zone;
    } catch (err: any) {
      this.logger.warn(`loadChecks zone read failed: ${err?.message}`);
      throw new ServiceUnavailableException(
        "The house's time zone could not be read, so no day's checks are claimed.",
      );
    }
    const { from, to } = houseWindowOf(zone, sinceDays);
    // A check opened up to a day before the first midnight may close on it,
    // so the read starts at the till's own lookback and the filing below
    // drops whatever falls before the window.
    const since =
      zone && from && to
        ? houseDayBounds(from, to, zone).readFromIso
        : new Date(Date.now() - sinceDays * 86400000).toISOString();
    let rows: any[];
    try {
      rows = await readWholeWindow<any>("The POS checks in this window", () =>
        client
          .from("pos_checks")
          .select(
            "id, table_id, server_name, server_external_id, opened_at, closed_at, covers, subtotal, gross_subtotal, tax_basis, net_not_recorded_reason, total, tip, items",
            { count: "exact" },
          )
          .eq("restaurant_id", restaurantId)
          // A voided check is not revenue. Its stock is reversed at ingest, but
          // its `total` used to keep counting here forever — every table and
          // waiter figure inherited it.
          .eq("voided", false)
          .gte("opened_at", since),
      );
    } catch (err: any) {
      if (!(err instanceof WholeReadError)) throw err;
      this.logger.warn(`loadChecks failed: ${err.message}`);
      throw new ServiceUnavailableException(
        "The POS checks could not be read, so nothing about them is claimed.",
      );
    }
    if (!zone || !from || !to) return rows;
    const houseZone = zone;
    return rows.filter((c) => {
      const day = houseDayOf(c, houseZone);
      return day !== null && day >= from && day <= to;
    });
  }

  /**
   * F-1588 (ADR 0341 F2): the sentence a net-based figure over `loadChecks`'
   * window carries when the window spans a day the house's net changed tax
   * basis; null when every day is on one basis, or with no house zone. No
   * check is restamped, and an unread zone or answer history is said, never
   * taken as no change.
   */
  private async windowTaxNote(
    restaurantId: string,
    sinceDays: number,
  ): Promise<string | null> {
    const client = this.dbService.getClient();
    try {
      const { zone } = await readHouseZone(client, restaurantId);
      const { from, to } = houseWindowOf(zone, sinceDays);
      if (!from || !to) return null;
      return await readPeriodTaxNote(client, restaurantId, zone, from, to);
    } catch (err: any) {
      this.logger.warn(
        `tax answer history unreadable for r=${restaurantId}: ${err?.message ?? err}`,
      );
      return PERIOD_TAX_NOTE_UNREAD;
    }
  }

  /**
   * w111-net-table-revenue (AW17, ADR 0341): Taken and the average check here
   * are net sales, each check's subtotal through the dashboard's own
   * `netSalesOf`, so a table's, a server's and the dashboard's figures are on
   * one basis at every house. It replaces w109's "include KDV" sentence: the
   * figures no longer hold the tax. A window across the day the house's net
   * changed basis says so (`netSalesTaxNote`), as the dashboard month does;
   * a house with no answer in force gets no key.
   */
  private async netSalesTaxNote(
    restaurantId: string,
    sinceDays: number,
  ): Promise<{ netSalesTaxNote?: string }> {
    const note = await this.windowTaxNote(restaurantId, sinceDays);
    return note ? { netSalesTaxNote: note } : {};
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

    const agg = new Map<string, SalesTally>();
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
      const a = agg.get(c.table_id) || newSalesTally();
      tallySale(a, c);
      a.covers += c.covers || 0;
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      a.wineChecks += items.some((it) => it?.is_wine) ? 1 : 0;
      agg.set(c.table_id, a);
    }

    const rows = shown.map((t: any) => {
      const a = agg.get(t.id);
      // F-1644: over the paid checks' own totals, so a refund is in neither
      // the sum nor the count.
      const avgCheck =
        a && a.paidChecks > 0 ? a.paidRevenue / a.paidChecks : null;
      const revenue = a ? takenOf(a) : 0;
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
        paidChecks: a?.paidChecks ?? 0,
        checksTakingNoMoney: a?.zeroChecks ?? 0,
        checksRefunded: a?.refundChecks ?? 0,
        checksWithoutNet: a ? a.checks - a.netChecks : 0,
        revenue,
        covers: a?.covers ?? 0,
        avgCheck,
        revenuePerSeat:
          revenue !== null && t.seats > 0 ? revenue / t.seats : null,
        checkinDensity: a && t.seats > 0 ? (a.covers || 0) / t.seats : null,
        checksPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
        wineRevenuePerSeat: null as number | null, // filled when wine $ available on check
        revenuePerCover:
          revenue !== null && a && a.covers > 0 ? revenue / a.covers : null,
        seatUtilization:
          a && t.seats > 0
            ? Math.min(1, (a.covers || 0) / (t.seats * Math.max(1, a.checks)))
            : null,
        wineAttachRate: a && a.checks > 0 ? a.wineChecks / a.checks : null,
        tipPct: a && a.tipBase > 0 ? a.tips / a.tipBase : null,
        // F-1573: no tip counted (the till sent no amount before tax) is
        // not a measured 0 a seat.
        tipPerSeat: a && t.seats > 0 && a.tipBase > 0 ? a.tips / t.seats : null,
        turnoverPerSeat: a && t.seats > 0 ? a.checks / t.seats : null,
      };
    });

    // Peer standings on avg check (tables with enough sample).
    const eligible = rows.filter(
      (r) => r.paidChecks >= 3 && r.avgCheck !== null,
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
      /**
       * Checks at a shown table rung at 0 (a comp, a staff meal): in Checks,
       * out of every average check (F-1534).
       */
      checksTakingNoMoney: rows.reduce((n, r) => n + r.checksTakingNoMoney, 0),
      /** Refunds at a shown table: taken off Taken, out of every average (F-1644). */
      checksRefunded: rows.reduce((n, r) => n + r.checksRefunded, 0),
      /** Taken and the average check are net sales, as on the dashboard (AW17). */
      revenueBasis: "net" as const,
      /** Checks at a shown table with no net stated: in Checks, out of Taken and every average. */
      checksWithoutNet: rows.reduce((n, r) => n + r.checksWithoutNet, 0),
      /** Tip % is over net sales, the checks' subtotal (F-1532), or why not (F-1573). */
      ...tipBasisOf(Array.from(agg.values())),
      ...(await this.netSalesTaxNote(restaurantId, sinceDays)),
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
      a.covers += c.covers || 0;
      const items: any[] = Array.isArray(c.items) ? c.items : [];
      a.wineChecks += items.some((it) => it?.is_wine) ? 1 : 0;
      byWaiter.set(server, a);
      // A check with no stated net leaves the whole fit, not only the table
      // control (ADR-0303-THE-WAITER-CONTROL-KEEPS-HIDDEN-TABLES, net form).
      if (c.table_id && net !== null) {
        obs.y.push(net);
        obs.waiter.push(server);
        obs.table.push(c.table_id);
      }
    }

    const waiters = Array.from(byWaiter.entries()).map(([name, a]) => ({
      name,
      checks: a.checks,
      paidChecks: a.paidChecks,
      checksTakingNoMoney: a.zeroChecks,
      checksRefunded: a.refundChecks,
      checksWithoutNet: a.checks - a.netChecks,
      revenue: takenOf(a),
      // F-1644: a refund is in neither the sum nor the count.
      avgCheck: a.paidChecks > 0 ? a.paidRevenue / a.paidChecks : null,
      wineAttachRate: a.checks > 0 ? a.wineChecks / a.checks : null,
      tipPct: a.tipBase > 0 ? a.tips / a.tipBase : null,
      /** F-1573: why Tip is blank when tips were recorded; null otherwise. */
      tipPctWhy:
        a.tipBase > 0 || a.tipsWithoutNet === 0
          ? null
          : a.tipsNetNotRecorded > 0
            ? TIP_NET_NOT_RECORDED_ON_SERVER
            : TIP_NO_NET_ON_SERVER,
      revenuePerCover:
        a.covers > 0 && a.netChecks > 0 ? a.revenue / a.covers : null,
    }));

    const standings = E.peerComparison(
      waiters
        .filter((w) => w.paidChecks >= 3 && w.avgCheck !== null)
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

    const tipBasis = tipBasisOf(Array.from(byWaiter.values()));
    return {
      sinceDays,
      waiters: waiters.sort(
        (a: any, b: any) => (b.revenue ?? 0) - (a.revenue ?? 0),
      ),
      adjusted,
      /** Checks rung at 0 (a comp, a staff meal): in Checks, out of Avg check (F-1534). */
      checksTakingNoMoney: waiters.reduce(
        (n, w) => n + w.checksTakingNoMoney,
        0,
      ),
      /** Refunds: taken off Taken, out of Avg check (F-1644). */
      checksRefunded: waiters.reduce((n, w) => n + w.checksRefunded, 0),
      /** Taken and the average check are net sales, as on the dashboard (AW17). */
      revenueBasis: "net" as const,
      /** Checks with no net stated: in Checks, out of Taken and Avg check. */
      checksWithoutNet: waiters.reduce((n, w) => n + w.checksWithoutNet, 0),
      /** Tip % is over net sales, the checks' subtotal (F-1532), or why not (F-1573). */
      ...tipBasis,
      /**
       * F-1588: Tip is over net sales, so a window across the day net began
       * leaving tax out (or the house changed its answer) takes tips over two
       * kinds of net. The sentence naming each stretch; null when every day
       * is on one basis, or no Tip is worked out. No check is restamped (ADR
       * 0341 F2), and an unread answer history is said, not taken as none.
       */
      tipTaxNote:
        tipBasis.tipBasis === "net"
          ? await this.windowTaxNote(restaurantId, sinceDays)
          : null,
      ...(await this.netSalesTaxNote(restaurantId, sinceDays)),
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

/** What a table's or a server's checks add up to. */
interface SalesTally {
  /** The net sales of the checks that stated one (`netChecks`). */
  revenue: number;
  checks: number;
  /** Checks whose net sales were stated (a subtotal), as the dashboard counts them. */
  netChecks: number;
  covers: number;
  wineChecks: number;
  tips: number;
  tipBase: number;
  tipsWithoutNet: number;
  tipsNetNotRecorded: number;
  tipsNetNotRecordedByReason: Record<string, number>;
  paidChecks: number;
  paidRevenue: number;
  zeroChecks: number;
  refundChecks: number;
}

function newSalesTally(): SalesTally {
  return {
    revenue: 0,
    checks: 0,
    netChecks: 0,
    covers: 0,
    wineChecks: 0,
    tips: 0,
    tipBase: 0,
    tipsWithoutNet: 0,
    tipsNetNotRecorded: 0,
    tipsNetNotRecordedByReason: {},
    paidChecks: 0,
    paidRevenue: 0,
    zeroChecks: 0,
    refundChecks: 0,
  };
}

/**
 * Taken, under the dashboard's count-and-say (ADR 0290, AW17): the stated net
 * sales, or null when there were checks and not one stated any ("not
 * recorded", never 0).
 */
function takenOf(a: SalesTally): number | null {
  return a.checks > 0 && a.netChecks === 0 ? null : a.revenue;
}

/**
 * One check into a table's or a server's tally; returns its net sales, or
 * null when it stated none.
 *
 * w111-net-table-revenue (AW17, ADR 0341): Taken was `pos_checks.total`, the
 * till's own figure with tax and tips in it, while the dashboard's net sales
 * are the subtotal; at a house whose till prices include KDV the room said
 * KDV-in figures beside a KDV-out dashboard. It is now the dashboard's own
 * `netSalesOf`, so the two agree. A check with no stated net is counted in
 * Checks and left out of Taken and every average, never read as its total.
 */
function tallySale(a: SalesTally, c: Record<string, unknown>): number | null {
  const net = netSalesOf(c);
  a.checks += 1;
  if (net !== null) {
    a.revenue += net;
    a.netChecks += 1;
  }
  tallyCheck(a, c, net);
  return net;
}

/**
 * The parts of one check a table's or a server's average and tip rate rest on.
 *
 * - F-1534: a check rung at 0 (a comp, a staff meal) took no money. It is
 *   counted in `zeroChecks` and left out of `paidChecks`, the count every
 *   average check divides by, so it does not pull the average down. A check
 *   with no total is in neither: it is not a 0 (F-1444).
 * - F-1644: a refund the till sends as a check with a minus total is taken
 *   off the revenue, counted in `refundChecks`, and kept out of `paidChecks`
 *   and `paidRevenue`, the sum and count every average check is over.
 * - w111: the average is over net sales, so a paid check enters it only
 *   when it stated its net; its total decides only whether it was a sale.
 * - F-1532: the tip rate is tips over the net sales (`subtotal`) of the checks
 *   that carried both. It used to be over `total`, which on Square and most
 *   tills already holds the tip, so a 20% tip read as 15.9%.
 */
function tallyCheck(
  a: SalesTally,
  c: {
    total?: unknown;
    subtotal?: unknown;
    gross_subtotal?: unknown;
    tax_basis?: unknown;
    net_not_recorded_reason?: unknown;
    tip?: unknown;
  },
  stated: number | null,
): void {
  const total = recorded(c.total);
  if (total === 0) a.zeroChecks += 1;
  else if (total < 0) a.refundChecks += 1;
  else if (Number.isFinite(total) && stated !== null && stated > 0) {
    a.paidChecks += 1;
    a.paidRevenue += stated;
  }
  const net = recorded(c.subtotal);
  const tip = recorded(c.tip);
  if (Number.isFinite(tip) && Number.isFinite(net) && net > 0) {
    a.tips += tip;
    a.tipBase += net;
  } else if (Number.isFinite(tip) && tip > 0) {
    // F-1573: a tip on a check with no amount before tax (Clover, a CSV
    // without one). It cannot be set against net sales, and it is not "no
    // tip" either: it is counted so the register can say so.
    a.tipsWithoutNet += 1;
    // F-1581: the till did send a subtotal, but this house's prices include
    // tax and ingest could not take it off, so it left the net unrecorded.
    // F-1612: counted by the reason ingest kept on the check, so the page
    // names the real cause, not always "no rate".
    if (
      !Number.isFinite(net) &&
      c.tax_basis === "prices_include_tax" &&
      Number.isFinite(recorded(c.gross_subtotal))
    ) {
      a.tipsNetNotRecorded += 1;
      const why =
        typeof c.net_not_recorded_reason === "string"
          ? c.net_not_recorded_reason
          : "unknown";
      a.tipsNetNotRecordedByReason[why] =
        (a.tipsNetNotRecordedByReason[why] ?? 0) + 1;
    }
  }
}

/** F-1573: Tip is blank on a server whose tipped checks carried no net. */
export const TIP_NO_NET_ON_SERVER =
  "tips were recorded, but the till sent no amount before tax, so no tip rate can be taken";

/** F-1573: no check carried both a tip and an amount before tax. */
export const TIP_NO_NET =
  "Your till sends tips but no amount before tax, so no tip rate can be taken. The tips were recorded; Tip stays blank rather than be worked out on totals that hold tax.";

/**
 * F-1581: Tip is blank on a server whose tipped checks have no net because
 * the tax could not be taken off. F-1612: the cause of each is not one
 * sentence (no rate, an unreadable till tax, tax on top...); the register's
 * note counts them by reason (`tipsNetNotRecordedByReason`).
 */
export const TIP_NET_NOT_RECORDED_ON_SERVER =
  "tips were recorded, but the tax could not be taken off these checks, so their net sales were not recorded and no tip rate can be taken";

/** F-1581: no tipped check has net sales, because the tax could not be taken off them. */
export const TIP_NET_NOT_RECORDED =
  "Tips were recorded, but these checks have no net sales: this house's prices include tax, and the tax could not be taken off them. Tip stays blank; the notes count why, check by check.";

/** F-1581: some tipped checks have no net sales, for the same cause. */
export const TIP_SOME_NET_NOT_RECORDED =
  "Some checks carried a tip but have no net sales, because the tax could not be taken off them. Their tips are left out of Tip, which is worked out only on checks that carried both.";

/** F-1573: some tipped checks carried no amount before tax. */
export const TIP_SOME_WITHOUT_NET =
  "Some checks carried a tip but no amount before tax. Their tips are left out of Tip, which is worked out only on checks that carried both.";

/** The `sinceDays` house days ending today, which `loadChecks` files on; nulls with no zone. */
function houseWindowOf(
  zone: string | null,
  sinceDays: number,
): { from: string | null; to: string | null } {
  const to = zone ? houseToday(zone) : null;
  return { from: to ? shiftHouseDay(to, -(sinceDays - 1)) : null, to };
}

/**
 * F-1532 / F-1573: Tip is over net sales only when some check carried both a
 * tip and a subtotal. When tips came only on checks with no subtotal, the
 * basis is null and says why, never "over net sales" over nothing.
 */
function tipBasisOf(
  aggs: Array<{
    tipBase: number;
    tipsWithoutNet: number;
    tipsNetNotRecorded: number;
    tipsNetNotRecordedByReason: Record<string, number>;
  }>,
): {
  tipBasis: "net" | null;
  tipBasisWhy: string | null;
  /** F-1581: tipped checks whose net the house's tax settings left unrecorded. */
  tipsNetNotRecorded: number;
  /** F-1612: the same, by the reason kept on each check ("unknown" before it was kept). */
  tipsNetNotRecordedByReason: Record<string, number>;
} {
  const based = aggs.some((a) => a.tipBase > 0);
  const unbased = aggs.some((a) => a.tipsWithoutNet > 0);
  // F-1581: when the house's own tax settings are the cause, say that, not
  // that the till sends no amount before tax.
  const tipsNetNotRecorded = aggs.reduce((n, a) => n + a.tipsNetNotRecorded, 0);
  const tipsNetNotRecordedByReason: Record<string, number> = {};
  for (const a of aggs) {
    for (const [why, n] of Object.entries(a.tipsNetNotRecordedByReason))
      tipsNetNotRecordedByReason[why] =
        (tipsNetNotRecordedByReason[why] ?? 0) + n;
  }
  const byHouse = tipsNetNotRecorded > 0;
  if (!based && unbased)
    return {
      tipBasis: null,
      tipBasisWhy: byHouse ? TIP_NET_NOT_RECORDED : TIP_NO_NET,
      tipsNetNotRecorded,
      tipsNetNotRecordedByReason,
    };
  return {
    tipBasis: "net",
    tipBasisWhy: unbased
      ? byHouse
        ? TIP_SOME_NET_NOT_RECORDED
        : TIP_SOME_WITHOUT_NET
      : null,
    tipsNetNotRecorded,
    tipsNetNotRecordedByReason,
  };
}
