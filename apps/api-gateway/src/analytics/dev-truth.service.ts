import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  INSIGHT_CANDIDATES,
  availableCandidates,
  DataRequirement,
} from "./insights/insight-catalog";

/**
 * Data behind the `/dev/*` truth surfaces. Dev-only, never mounted in
 * production (`DevTruthController`).
 *
 * These exist because the product's own numbers cannot be checked from the
 * product's own screens. `candidateTypesAvailable` says 386 of 573 for the one
 * tenant with data — and that number is built from a PRESENCE test
 * (`if (bundle.checks.length) availability.add("checks")`), so a single row
 * flips an entire data source on. Nothing in the app shows the row counts that
 * produced it, which is exactly why "67.4% of insights reachable" circulated as
 * a win for a restaurant with 66 simulator checks and zero consumption rows.
 *
 * The job of this service is to put those two numbers on one screen.
 */

/** The seven sources, and the table whose rows switch each one on. */
const SOURCE_TABLE: Record<DataRequirement, string> = {
  consumption: "wine_consumption_log",
  orders: "procurement_orders",
  inventory: "restaurant_inventory",
  checks: "pos_checks",
  tables: "restaurant_tables",
  venue: "restaurant_venue_profiles",
  goals: "analytics_goals",
};

const REQUIREMENTS = Object.keys(SOURCE_TABLE) as DataRequirement[];

/**
 * What "enough to say something" means, per source, as a row count.
 *
 * These are DELIBERATELY ROUND and deliberately visible in the response: they
 * are a stated assumption, not a measurement, and the screen labels them as
 * such. The point is not that 30 is the correct number of consumption rows —
 * it is that ANY threshold above 1 collapses the reachable count, which is the
 * whole argument. A week-over-week comparison cannot be made from one row, and
 * presence-based availability claims it can.
 */
const SUFFICIENT_ROWS: Record<DataRequirement, number> = {
  consumption: 30, // a demand series needs a series
  orders: 10, // vendor comparison needs several orders
  inventory: 10, // ranking needs something to rank
  checks: 30, // day-of-week anything needs multiple days
  tables: 4, // floor geometry across at least a few tables
  venue: 1, // a profile row is genuinely one row
  goals: 1, // a goal is genuinely one row
};

export interface SourceRow {
  requirement: DataRequirement;
  table: string;
  /** null means the count could NOT be read — never conflated with 0. */
  rows: number | null;
  error: string | null;
  presenceFlag: boolean;
  sufficientThreshold: number;
  sufficientFlag: boolean;
}

@Injectable()
export class DevTruthService {
  private readonly logger = new Logger(DevTruthService.name);

  constructor(private readonly db: DatabaseService) {}

  async reach(restaurantId: string) {
    const client = this.db.getClient();

    const sources: SourceRow[] = await Promise.all(
      REQUIREMENTS.map(async (requirement) => {
        const table = SOURCE_TABLE[requirement];
        const { count, error } = await client
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId);

        // A count that could not be read is null, never 0. Reporting an
        // unreadable count as zero is the failure this whole surface exists to
        // expose, and it would be absurd to commit it here.
        if (error) {
          this.logger.warn(
            `dev/reach could not count ${table} for r=${restaurantId}: ${error.message}`,
          );
          return {
            requirement,
            table,
            rows: null,
            error: error.message,
            presenceFlag: false,
            sufficientFlag: false,
            sufficientThreshold: SUFFICIENT_ROWS[requirement],
          };
        }

        const rows = count ?? 0;
        return {
          requirement,
          table,
          rows,
          error: null,
          // Exactly what insight-generator.service.ts does: `.length > 0`.
          presenceFlag: rows > 0,
          sufficientThreshold: SUFFICIENT_ROWS[requirement],
          sufficientFlag: rows >= SUFFICIENT_ROWS[requirement],
        };
      }),
    );

    const presenceSet = new Set<DataRequirement>(
      sources.filter((s) => s.presenceFlag).map((s) => s.requirement),
    );
    const sufficientSet = new Set<DataRequirement>(
      sources.filter((s) => s.sufficientFlag).map((s) => s.requirement),
    );

    const total = INSIGHT_CANDIDATES.length;
    const reachedByPresence = availableCandidates(presenceSet).length;
    const reachedBySufficiency = availableCandidates(sufficientSet).length;

    // Which single source is doing the most work in the presence number — i.e.
    // if you deleted its one row, how much of the "reachable" claim evaporates.
    const leverage = [...presenceSet]
      .map((r) => {
        const without = new Set(presenceSet);
        without.delete(r);
        return {
          requirement: r,
          rows: sources.find((s) => s.requirement === r)?.rows ?? null,
          typesItUnlocks: reachedByPresence - availableCandidates(without).length,
        };
      })
      .sort((a, b) => b.typesItUnlocks - a.typesItUnlocks);

    return {
      restaurantId,
      total,
      // The number the product reports today.
      reachedByPresence,
      presencePct: total ? +((reachedByPresence / total) * 100).toFixed(1) : 0,
      // The same calculation with a stated minimum row count per source.
      reachedBySufficiency,
      sufficiencyPct: total
        ? +((reachedBySufficiency / total) * 100).toFixed(1)
        : 0,
      overstatement: reachedByPresence - reachedBySufficiency,
      sources,
      leverage,
      unreadable: sources.filter((s) => s.rows === null).map((s) => s.table),
      note:
        "reachedByPresence is what the product reports: availability is set by " +
        "`.length > 0`, so one row switches a whole source on. reachedBySufficiency " +
        "applies the stated per-source row minimums below. Neither is a count of " +
        "insights a restaurant can receive — both filter on data requirements only, " +
        "never on whether a type has an implementation behind it.",
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Every list-shaped read, with whether a caller could tell an empty result
   * from a broken one. Probes live rather than reading source, because the
   * question is about runtime behaviour.
   */
  async swallow(restaurantId: string) {
    const client = this.db.getClient();

    const probes = REQUIREMENTS.map((r) => SOURCE_TABLE[r]).concat([
      "analytics_insights",
      "providers",
      "pos_item_mappings",
      "pos_unresolved_lines",
      "prediction_outcomes",
    ]);

    const rows = await Promise.all(
      probes.map(async (table) => {
        const { data, error } = await client
          .from(table)
          .select("*")
          .eq("restaurant_id", restaurantId)
          .limit(1);

        return {
          table,
          rows: error ? null : (data?.length ?? 0),
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          // The whole point: with the error in hand these are distinguishable.
          // A caller that destructures only `data` cannot tell them apart, and
          // that is the defect class this grid makes visible.
          state: error
            ? "BROKEN"
            : (data?.length ?? 0) > 0
              ? "HAS ROWS"
              : "GENUINELY EMPTY",
        };
      }),
    );

    return {
      restaurantId,
      rows,
      note:
        "supabase-js RESOLVES with { data, error } rather than throwing, so a " +
        "caller writing `const { data } = await …` sees [] for BOTH a failed query " +
        "and an empty table. Every row here is distinguishable only because the " +
        "error was read. BROKEN vs GENUINELY EMPTY is a distinction the call " +
        "sites still on scripts/read_error_baseline.json cannot make — run " +
        "scripts/check_read_errors_not_swallowed.py for the live count rather " +
        "than trusting a number written here (the '~29' this line used to " +
        "quote was a triaged subset; the mechanical sweep measured 215). " +
        "ADR 0067.",
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * As-of truncation, for the one dimension that has usable dated rows.
   *
   * Honest about its own limits: `pos_checks.opened_at` is the only column in
   * production carrying a real spread of dates (66 rows across 22 days), so
   * this truncates on that and nothing else. It is not a general as-of engine
   * and does not pretend to be — see the `limits` field, which the UI renders.
   */
  async asOf(restaurantId: string, cutoff: string) {
    const client = this.db.getClient();

    const [before, after] = await Promise.all([
      client
        .from("pos_checks")
        .select("id, opened_at, total, covers", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .lte("opened_at", cutoff),
      client
        .from("pos_checks")
        .select("id, opened_at, total, covers", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .gt("opened_at", cutoff),
    ]);

    if (before.error || after.error) {
      return {
        restaurantId,
        cutoff,
        error: before.error?.message ?? after.error?.message,
        known: null,
        happened: null,
        limits: null,
      };
    }

    const sum = (rows: any[] | null, f: string) =>
      (rows ?? []).reduce((a, r) => a + (Number(r[f]) || 0), 0);

    const knownRows = before.data ?? [];
    const afterRows = after.data ?? [];

    return {
      restaurantId,
      cutoff,
      error: null,
      known: {
        checks: knownRows.length,
        revenue: +sum(knownRows, "total").toFixed(2),
        covers: sum(knownRows, "covers"),
        firstAt: knownRows.length
          ? knownRows.map((r) => r.opened_at).sort()[0]
          : null,
        lastAt: knownRows.length
          ? knownRows.map((r) => r.opened_at).sort().slice(-1)[0]
          : null,
      },
      happened: {
        checks: afterRows.length,
        revenue: +sum(afterRows, "total").toFixed(2),
        covers: sum(afterRows, "covers"),
      },
      limits: [
        "Truncates on pos_checks.opened_at only — the single column in production " +
          "with a real date spread. This is not a general as-of engine.",
        "wine_consumption_log has 0 rows, so no demand series can be truncated at all.",
        "The engine is NOT re-run against the truncated world here; this shows the " +
          "INPUTS either side of the cut. A forecast computed on the left and scored " +
          "on the right is the next step. The look-ahead leak that used to block it " +
          "is fixed (ADR 0064, 2026-09-02): fitted[i] is now pushed BEFORE the state " +
          "absorbs series[i], so what is missing here is the harness, not the engine.",
      ],
      generatedAt: new Date().toISOString(),
    };
  }
}
