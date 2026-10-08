import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TeamService } from "./team.service";
import { IngestSalesDto } from "./dto/team.dto";

/**
 * Why the house benchmark has a median, or why it has none (ADR 0294).
 *
 * - `computed`: at least one other server's service is in it.
 * - `self-only`: every per-cover figure in the window is this member's own.
 *   The founder's pick, 2026-10-04: refuse the comparison. A median of
 *   someone's own services is not a benchmark for them, so none is sent.
 * - `no-covers`: no service in the window records covers with its sales.
 * - `unreadable`: the read failed. Never shown as one of the above.
 */
export type BenchmarkState =
  | "computed"
  | "self-only"
  | "no-covers"
  | "unreadable";

/**
 * A service has a per-cover figure only when it records covers AND sales.
 * `server_sales` stores a blank as 0 (both columns `DEFAULT 0 NOT NULL`, and
 * both ingest routes write `?? 0`), so a 0 here means "not recorded". This is
 * the predicate the benchmark has always used (`covers > 0`, then `> 0`); the
 * member's own per-cover figure now uses it too, so the two are comparable.
 */
function recordsPerCover(r: any): boolean {
  return Number(r.covers) > 0 && Number(r.net_sales) > 0;
}

/**
 * Per-server sales attribution. There is NO POS/guest-check source in the
 * product today, so this ingests manual/CSV/POS-webhook rows and the
 * Performance panel renders "no data yet" until rows exist — never mock data.
 */
@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly team: TeamService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  async ingest(userId: string, restaurantId: string, dto: IngestSalesDto) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    await this.team.assertMemberInRestaurant(restaurantId, dto.memberId);
    const { data, error } = await this.sb
      .from("server_sales")
      .upsert(
        {
          restaurant_id: restaurantId,
          member_id: dto.memberId,
          service_date: dto.serviceDate,
          covers: dto.covers ?? 0,
          net_sales: dto.netSales ?? 0,
          wine_sales: dto.wineSales ?? 0,
          checks: dto.checks ?? 0,
          source: dto.source ?? "manual",
        },
        { onConflict: "restaurant_id,member_id,service_date" },
      )
      .select()
      .single();
    if (error) throw new InternalServerErrorException("Failed to ingest sales");
    return data;
  }

  /**
   * Several services at once — a CSV, or a night typed in for the whole floor.
   *
   * The row it writes is the single route's row, field for field (source
   * defaults to "csv" here, "manual" there; the client names it). Three things
   * changed on 2026-09-26 (founder, round 8, item 51), all about what the
   * answer SAYS:
   *
   * - A row naming a person who is not on THIS house's roster is still not
   *   written, but it is now COUNTED and named back (`skipped`), instead of
   *   vanishing inside a smaller `inserted`.
   * - A failed roster read used to leave `valid` null, drop every row and
   *   answer `{ inserted: 0 }` — "nothing to import" for a read that failed.
   *   It is a 500 now and nothing is written.
   * - Two rows for the same person on the same day make PostgREST's upsert
   *   fail as a whole ("ON CONFLICT DO UPDATE command cannot affect row a
   *   second time"), which surfaced as a bare 500. It is a 400 naming the
   *   pair, before anything is written.
   */
  async ingestBatch(
    userId: string,
    restaurantId: string,
    rows: IngestSalesDto[],
  ): Promise<{
    inserted: number;
    skipped: number;
    skippedRows: Array<{ memberId: string; serviceDate: string }>;
  }> {
    await this.team.assertAccess(userId, restaurantId, "manager");
    if (!rows?.length) return { inserted: 0, skipped: 0, skippedRows: [] };

    const seen = new Set<string>();
    const twice: string[] = [];
    for (const r of rows) {
      const key = `${r.memberId}|${r.serviceDate}`;
      if (seen.has(key)) twice.push(`${r.memberId} on ${r.serviceDate}`);
      seen.add(key);
    }
    if (twice.length) {
      throw new BadRequestException(
        `The same person appears twice for the same day (${twice.slice(0, 3).join("; ")}${
          twice.length > 3 ? `; and ${twice.length - 3} more` : ""
        }). Keep one row per person per day. Nothing was saved.`,
      );
    }

    // Rows naming members outside this house are not written (tenant scope).
    const memberIds = [...new Set(rows.map((r) => r.memberId))];
    const { data: valid, error: rosterError } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .in("id", memberIds);
    if (rosterError) {
      this.logger.error(
        `sales batch roster read failed for r=${restaurantId}: ${rosterError.code ?? "?"} ${rosterError.message}`,
      );
      throw new InternalServerErrorException(
        "The roster could not be read, so no sales were saved.",
      );
    }
    const validSet = new Set((valid ?? []).map((m: any) => m.id));
    const clean = rows.filter((r) => validSet.has(r.memberId));
    const skippedRows = rows
      .filter((r) => !validSet.has(r.memberId))
      .map((r) => ({ memberId: r.memberId, serviceDate: r.serviceDate }));
    if (!clean.length) {
      return { inserted: 0, skipped: skippedRows.length, skippedRows };
    }
    const payload = clean.map((r) => ({
      restaurant_id: restaurantId,
      member_id: r.memberId,
      service_date: r.serviceDate,
      covers: r.covers ?? 0,
      net_sales: r.netSales ?? 0,
      wine_sales: r.wineSales ?? 0,
      checks: r.checks ?? 0,
      source: r.source ?? "csv",
    }));
    const { error } = await this.sb
      .from("server_sales")
      .upsert(payload, { onConflict: "restaurant_id,member_id,service_date" });
    if (error)
      throw new InternalServerErrorException("Failed to ingest sales batch");
    return { inserted: payload.length, skipped: skippedRows.length, skippedRows };
  }

  /**
   * Performance for one member over the last N services, benchmarked against
   * the team. Returns { hasData: false } when nothing has been ingested.
   */
  async getMemberPerformance(
    userId: string,
    restaurantId: string,
    memberId: string,
    limit = 6,
  ): Promise<any> {
    const { role } = await this.team.assertAccess(userId, restaurantId);
    await this.team.assertMemberInRestaurant(restaurantId, memberId);

    if (role === "staff") {
      const { data: me } = await this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!me || me.id !== memberId) {
        throw new ForbiddenException("You can only view your own performance");
      }
    }

    // A failed read used to fall through to `{ hasData: false }` — "no service
    // has been attributed yet" — for a register that did not answer. The card
    // has its own unreadable state; this is what reaches it.
    const { data: rows, error: rowsError } = await this.sb
      .from("server_sales")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .order("service_date", { ascending: false })
      .limit(limit);
    if (rowsError) {
      this.logger.error(
        `server_sales read failed for r=${restaurantId} member=${memberId}: ${rowsError.code ?? "?"} ${rowsError.message}`,
      );
      throw new InternalServerErrorException(
        "The sales register could not be read.",
      );
    }

    if (!rows?.length) {
      return { hasData: false };
    }

    const series = [...rows].reverse();
    const perCover = (r: any) =>
      r.covers > 0 ? Number(r.net_sales) / r.covers : 0;
    const totalNet = series.reduce((s, r) => s + Number(r.net_sales), 0);
    const totalWine = series.reduce((s, r) => s + Number(r.wine_sales), 0);
    const totalChecks = series.reduce((s, r) => s + Number(r.checks), 0);
    const salesPerShift = avg(series.map((r) => Number(r.net_sales)));
    // Blended (sum/sum) rather than avg-of-ratios, so uneven services weight
    // correctly. `null`, never 0, when none of these services records a
    // check: an average over no checks is unknown, and ADR 0051 prints
    // unknown as the em dash. It used to answer 0, which the card printed as
    // "$0". The same goes for the wine share over no sales.
    const avgCheck = totalChecks > 0 ? totalNet / totalChecks : null;
    // A SHARE OF SALES (wine_sales / net_sales), not an attach rate: /reports
    // keeps "wine attach" for checks-with-wine / checks. The card labels this
    // "Wine share of sales" (founder, 2026-10-04: "Rename on the card"). The
    // key keeps its old name so a page built before ADR 0294 still reads it.
    const wineShare = totalNet > 0 ? totalWine / totalNet : null;
    // This member's sales per cover, set beside the house median below
    // (A-048: the median was printed beside nothing it could be compared
    // with). Blended over the services that record covers with their sales,
    // the services the median itself is taken over.
    const coverRows = series.filter(recordsPerCover);
    const coverNet = coverRows.reduce((s, r) => s + Number(r.net_sales), 0);
    const covers = coverRows.reduce((s, r) => s + Number(r.covers), 0);
    const salesPerCover = covers > 0 ? coverNet / covers : null;

    // The house's money, so every figure on the card prints in the house's
    // currency and locale. These are sales, not pay, so ADR 0215's owner-only
    // rule does not govern them; a currency code and a country are not money.
    // Unreadable is its own state ("currency could not be read"), never a
    // guessed dollar (ADR 0117 Q25).
    const { data: house, error: houseError } = await this.sb
      .from("restaurants")
      .select("currency, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (houseError) {
      this.logger.warn(
        `performance: the currency of r=${restaurantId} could not be read, so ` +
          `the card prints its figures without one: ${houseError.code ?? "?"} ${houseError.message}`,
      );
    }
    const money = houseError
      ? { currency: null, country: null, readable: false }
      : {
          currency: (house as any)?.currency ?? null,
          country: (house as any)?.country ?? null,
          readable: true,
        };

    // House benchmark: every server's recent services, this member's own
    // included. The founder kept that over a peer median, 2026-10-04:
    // "House median (Recommended)" (ADR 0294).
    //
    // The error used to be discarded, and `percentile([])` returned 0 — so a
    // failed benchmark query rendered a peer median of $0/cover and a band of
    // [0, 0], which puts EVERY server above their team. A comparison that
    // flatters everyone is worse than no comparison. Per ADR 0051 an unknown
    // figure is the em dash, never a zero, so the median is `null` when the
    // read fails, when no recent service records covers, and when the only
    // per-cover figures are this member's own; `benchmark.state` says which.
    const { data: teamRows, error: teamError } = await this.sb
      .from("server_sales")
      .select("member_id, net_sales, covers")
      .eq("restaurant_id", restaurantId)
      .order("service_date", { ascending: false })
      // The house benchmark's window: the web declares it as
      // TEAM_SERVER_WINDOWS.BENCHMARK_SERVICES and prints it as a ceiling
      // ("≤200"); check_windowed_figures.py W1 reads this literal.
      .limit(200);
    if (teamError) {
      this.logger.error(
        `server_sales team benchmark failed for r=${restaurantId} — this ` +
          `member's card will show no peer comparison rather than a false ` +
          `one: ${teamError.code ?? "?"} ${teamError.message}`,
      );
    }
    const contributing = teamError
      ? []
      : (teamRows ?? []).filter(recordsPerCover);
    const servers = new Set(contributing.map((r: any) => r.member_id));
    const includesMember = contributing.some(
      (r: any) => r.member_id === memberId,
    );
    const state: BenchmarkState = teamError
      ? "unreadable"
      : contributing.length === 0
        ? "no-covers"
        : servers.size === 1 && includesMember
          ? "self-only"
          : "computed";
    const teamPerCover =
      state === "computed"
        ? contributing
            .map((r: any) => Number(r.net_sales) / Number(r.covers))
            .sort((a, b) => a - b)
        : [];
    const median = percentile(teamPerCover, 0.5);
    const band: [number, number] | null =
      median == null
        ? null
        : [percentile(teamPerCover, 0.25)!, percentile(teamPerCover, 0.75)!];

    return {
      hasData: true,
      money,
      metrics: {
        salesPerShift: round(salesPerShift),
        avgCheck: avgCheck == null ? null : round(avgCheck),
        salesPerCover: salesPerCover == null ? null : round(salesPerCover),
        // Of this member's `services`, how many record covers with sales.
        coverServices: coverRows.length,
        wineAttachPct: wineShare == null ? null : round(wineShare * 100),
      },
      analytic: {
        unit: "/cover",
        series: series.map((r) => round(perCover(r))),
        // null, not 0, when the peer benchmark is unknown — the client draws
        // no median line and no band rather than a flattering one at zero.
        median: median == null ? null : round(median),
        band: band == null ? null : ([round(band[0]), round(band[1])] as const),
        // What the median is taken over, so the card can say it: services
        // that record covers among the house's ≤200 newest,
        // the servers they belong to, and whether this member is one.
        benchmark: {
          state,
          services: contributing.length,
          servers: servers.size,
          includesMember,
        },
      },
      services: series.map((r) => ({ date: r.service_date, covers: r.covers })),
    };
  }
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
/**
 * `null` — not 0 — when there is nothing to take a percentile of.
 *
 * The old `return 0` was the whole peer-median defect: an empty array is
 * "unknown", and rendering unknown as zero made every restaurant's every
 * server beat the house average. ADR 0051: unknown is the em dash.
 */
function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}
