import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TeamService } from "./team.service";
import { IngestSalesDto } from "./dto/team.dto";

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

  async ingestBatch(
    userId: string,
    restaurantId: string,
    rows: IngestSalesDto[],
  ) {
    await this.team.assertAccess(userId, restaurantId, "manager");
    if (!rows?.length) return { inserted: 0 };
    // Reject rows referencing members outside this tenant.
    const memberIds = [...new Set(rows.map((r) => r.memberId))];
    const { data: valid } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .in("id", memberIds);
    const validSet = new Set((valid ?? []).map((m: any) => m.id));
    const clean = rows.filter((r) => validSet.has(r.memberId));
    if (!clean.length) return { inserted: 0 };
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
    return { inserted: payload.length };
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

    const { data: rows } = await this.sb
      .from("server_sales")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("member_id", memberId)
      .order("service_date", { ascending: false })
      .limit(limit);

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
    // Blended (sum/sum) rather than avg-of-ratios, so uneven services weight correctly.
    const avgCheck = totalChecks > 0 ? totalNet / totalChecks : 0;
    const wineAttach = totalNet > 0 ? totalWine / totalNet : 0;

    // Team benchmark (same recent window, all members).
    //
    // The error used to be discarded, and `percentile([])` returned 0 — so a
    // failed benchmark query rendered a peer median of $0/cover and a band of
    // [0, 0], which puts EVERY server above their team. A comparison that
    // flatters everyone is worse than no comparison. Per ADR 0051 an unknown
    // figure is the em dash, never a zero, so the benchmark is now `null` both
    // when the read fails and when the restaurant genuinely has no peer rows,
    // and the caller draws no median line for either.
    const { data: teamRows, error: teamError } = await this.sb
      .from("server_sales")
      .select("member_id, net_sales, covers")
      .eq("restaurant_id", restaurantId)
      .order("service_date", { ascending: false })
      .limit(200);
    if (teamError) {
      this.logger.error(
        `server_sales team benchmark failed for r=${restaurantId} — this ` +
          `member's card will show no peer comparison rather than a false ` +
          `one: ${teamError.code ?? "?"} ${teamError.message}`,
      );
    }
    const teamPerCover = teamError
      ? []
      : (teamRows ?? [])
          .map((r: any) => (r.covers > 0 ? Number(r.net_sales) / r.covers : 0))
          .filter((n) => n > 0)
          .sort((a, b) => a - b);
    const median = percentile(teamPerCover, 0.5);
    const band: [number, number] | null =
      median == null
        ? null
        : [percentile(teamPerCover, 0.25)!, percentile(teamPerCover, 0.75)!];

    return {
      hasData: true,
      metrics: {
        salesPerShift: round(salesPerShift),
        avgCheck: round(avgCheck),
        wineAttachPct: round(wineAttach * 100),
      },
      analytic: {
        unit: "/cover",
        series: series.map((r) => round(perCover(r))),
        // null, not 0, when the peer benchmark is unknown — the client draws
        // no median line and no band rather than a flattering one at zero.
        median: median == null ? null : round(median),
        band: band == null ? null : ([round(band[0]), round(band[1])] as const),
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
