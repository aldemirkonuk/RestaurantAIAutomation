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
import {
  ORDER_NOT_YET_ARRIVED_STATUSES,
  ORDER_SPEND_STATUSES,
} from "../../procurement/order-status";
import {
  namedCurrencies,
  orderCurrency,
  orderSpend,
} from "../../procurement/order-spend";
import { readWholeWindow } from "../../common/read-whole-window";
import { netSalesOf } from "../../dashboard/dashboard.service";
import { readHouseMoney } from "../../common/house-money";
import { goalSchedule, goalWindow } from "../goal-window";
import {
  HOUSE_DAY_LOOKBACK_MS,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
} from "../../common/house-day";
import {
  BottleHow,
  UnitsLabel,
  bottlesOf,
  unitsLabel,
} from "../consumption-units";
import { DayExclusionsService } from "./day-exclusions.service";
import { RecommendationActionsService } from "../recommendation-actions.service";
import {
  SuppressionScope,
  buildSuppressionKey,
  dayGrain,
  effectiveScope,
  insightRuleId,
  suppressionKeys,
  trendGrain,
  windowGrain,
  withFiring,
} from "./suppression";
import {
  ItemState,
  ResolvedState,
  StateBook,
  resolveItemState,
} from "./item-state";

/**
 * Goal measures that are a LEVEL read at an instant or as a ratio over the
 * window (an average, a share, days of stock), not a running total. Their
 * pace is not `target × elapsed/total`: an average check of 25 against a
 * target of 15 is already met, not "a quarter of the way there" (F-183).
 */
export const LEVEL_GOAL_METRICS: ReadonlySet<string> = new Set([
  "avg_check",
  "wine_attach_rate",
  "days_of_inventory",
]);

/**
 * Where a goal should stand by now, as a fraction `elapsed` (0–1) of its
 * schedule. A running total ramps from nothing to the target. A level ramps
 * from where the house stood when the goal was set (its baseline) to the
 * target; with no baseline to ramp from, the target itself is the line.
 */
export function goalExpectedByNow(
  metricKey: string,
  target: number,
  baseline: number | null,
  elapsed: number,
): number {
  if (!LEVEL_GOAL_METRICS.has(metricKey)) return target * elapsed;
  if (baseline === null || !Number.isFinite(baseline) || baseline <= 0)
    return target;
  return baseline + (target - baseline) * elapsed;
}

/**
 * Whether a goal is keeping the pace `expected` asks of it by now: within 10%
 * of the line, upward for a goal to reach, downward for one to keep under
 * ("at_most"). One rule for the goals desk, the recommendation card and the
 * insight card, so the three cannot disagree (F-383).
 */
export function goalPaceHolds(
  direction: string | null | undefined,
  current: number,
  expected: number,
): boolean {
  return direction === "at_most"
    ? current <= expected * 1.1
    : current >= expected * 0.9;
}

/** How many items each hiding state withheld from one read (ADR 0191). */
export interface WithheldCounts {
  dismissed: number;
  snoozed: number;
  done: number;
}

/**
 * Drop every item whose shared state is not `active` — dismissed, done, or
 * snoozed with an instant still ahead — and count each. The ONE filter the
 * live compute and the stored read both apply, so an item hidden on the feed
 * is hidden on Reports, the rails, the catalogue and the mobile tab by the
 * same rule (ADR 0191, founder 2026-09-21).
 */
export function withholdByState<T>(
  items: T[],
  targetOf: (item: T) => {
    ruleId: string;
    subject: string | null;
    periodKey: string | null;
  },
  book: StateBook,
): { kept: T[]; withheld: WithheldCounts } {
  const withheld: WithheldCounts = { dismissed: 0, snoozed: 0, done: 0 };
  const kept: T[] = [];
  for (const item of items) {
    const st: ResolvedState = resolveItemState(targetOf(item), book);
    if (st.state === "active") kept.push(item);
    else withheld[st.state as Exclude<ItemState, "active">]++;
  }
  return { kept, withheld };
}

/** The item a stored `analytics_insights` row is — the same target as live. */
function storedTarget(row: any): {
  ruleId: string;
  subject: string | null;
  periodKey: string | null;
} {
  return {
    ruleId: insightRuleId(String(row?.candidate_key ?? "")),
    subject:
      typeof row?.subject === "string" && row.subject ? row.subject : null,
    periodKey:
      typeof row?.period_key === "string" && row.period_key
        ? row.period_key
        : null,
  };
}

/**
 * The floor under any "vs its own history" sentence.
 *
 * A mean over one or two same-weekday observations is not a baseline, it is a
 * coincidence with a percentage attached. Three is the minimum this generator
 * has always required for the weekday comparison; it is named here because the
 * requirement now has to survive the OBSERVED-day filter below (a history of
 * five Wednesdays, three of them closures, is a history of two).
 */
export const MIN_BASELINE_N = 3;

/**
 * Period-over-period needs comparable windows. A week is compared with the
 * week before like for like: only weekdays open in BOTH weeks are summed
 * (`matchedPeriodOverPeriod`), and the comparison is withheld unless at least
 * this many such days remain. A window that is not whole weeks (the 30-day
 * spend window) keeps the older rule — both windows carry at least this many
 * observed days and their counts differ by no more than one — and sums only
 * observed days, so a manager-excluded day never rides inside the total.
 *
 * Without this the running gateway emitted, on 2026-09-03:
 *   "sales fell 100% vs the previous week ($0 vs $2.4k)"
 * — from a current window with no records in it at all; and, before F-707,
 * "sales fell 14% vs the previous week" about one holiday closure.
 */
export const MIN_PERIOD_OBSERVED = 4;
export const MAX_PERIOD_OBSERVED_GAP = 1;

/** A 28-day trend needs half its days to be real ones. */
export const MIN_TREND_OBSERVED = 14;

/** A live table is paced only after this long and this many lines (F-1188). */
export const HOT_TABLE_MIN_MINUTES = 30;
export const HOT_TABLE_MIN_RINGS = 2;

/**
 * A ranking or a pairing is printed only when the data can tell it apart
 * (ADR 0272). On Tuzlu Rüzgar — servers and tables dealt uniformly, baskets
 * dealt round-robin, so there is nothing to find — this generator named a
 * "#1 server" on a 1.0% gap (A-003) and a pairing "6.3× more than chance" on
 * three co-occurrences that fired on 200 of 200 shuffled copies of the data
 * (A-002). These are the four numbers the gates below share.
 *
 *  - SIGNIFICANCE_ALPHA: the family-wise error a printed #1 or pairing may
 *    carry, after the correction for having picked it out of many. The
 *    table driver fit's F-test uses it too (ADR 0303, founder 2026-10-07);
 *    that fit is one pre-set model, not a pick, so it is not corrected.
 *  - MIN_RANK_N: checks a server or table needs before it is ranked at all.
 *  - BASKET_MIN_COUNT: checks a pair must share before it is tested; it also
 *    sizes the multiple-comparison family (items on at least this many).
 *  - BASKET_MIN_LIFT: the smallest affinity worth a sentence, however sure.
 */
export const SIGNIFICANCE_ALPHA = 0.05;
export const MIN_RANK_N = 30;
export const BASKET_MIN_COUNT = 5;
export const BASKET_MIN_LIFT = 1.3;

/**
 * The version of the arithmetic behind a stored sentence.
 *
 * `analytics_insights` is a write-through cache, and `getStored()` is preferred
 * over a fresh compute by `GET /analytics/insights/:id`, by
 * `AdvancedAnalyticsService.getOverview` and by `GoalsService`'s suggestions.
 * That made every cached row a claim about the world made by a version of this
 * file that may no longer exist — and on 2026-09-03, a day after the
 * observed-day fix landed, it was still answering
 *
 *     "Tuesday sales came in 100% lower than your average Tuesday ($0 vs $72)."
 *
 * from a row computed the previous morning. Age cannot decide that: an hour-old
 * row can be right and a minute-old one wrong. Only provenance can. So every
 * persisted row carries the version that produced it, and every reader refuses
 * anything below its own.
 *
 * BUMP THIS whenever a change alters what a sentence CLAIMS — new withholding
 * rules, a changed baseline, a reworded template that changes the meaning.
 * A refactor that cannot change a single sentence does not need a bump.
 *
 *   0 — rows written before the column existed (the migration's default), i.e.
 *       before 2026-09-03. Zero-filled absent days; the 100% sentences.
 *   1 — reserved for that arithmetic, so "unversioned" and "version 1" are not
 *       the same statement.
 *   2 — 2026-09-03: a day with no records is unobserved, not zero
 *       (`toDaily`/`timeSeriesInsights`); manager day-exclusions are honoured;
 *       dismissals are honoured; the baseline sentence carries its support
 *       count and dates itself when it skipped back.
 *   3 — 2026-09-21 (ADR 0191): snoozes and done are withheld as well as
 *       dismissals, and every row stores its `subject` and `period_key` so
 *       the stored read can resolve the shared per-item state. A version-2
 *       row has neither, so its state cannot be read at the scope it was
 *       written: it is withheld and recomputed, not served unfiltered.
 *       Round 3 (same day, still version 3 — no version-3 row has ever been
 *       served: `main` is at 2): a type that names no subject and no period
 *       stores the week it fired in as its `period_key` ("Each firing is one
 *       card").
 *   4 — 2026-10-03 (ADR 0272): a ranking or a pairing is printed only when
 *       the data can tell it apart. The waiter and table "#1" pass a tie
 *       check and a Bonferroni test against the rest (a waiter's lead must
 *       also survive table adjustment); the basket pairing passes an exact
 *       test corrected over every pair; a tied stockout #1 is withheld and no
 *       longer carries a hard-coded z of 2. A version-3 row may hold any of
 *       those sentences, so it is recomputed, not served.
 *   5 — 2026-10-04 (ADR 0291): vendor concentration is recorded under
 *       `purchasing`, the category the catalogue files it under, not `risk`.
 *       A version-4 or older row still sits under `risk`, where the
 *       catalogue's narrowed read never looks and the purchasing+risk rails
 *       would show it twice once the new row lands; it is refused and
 *       recomputed. (Drafted as 4 on 2026-10-03; #602 took 4 first, so this
 *       change is 5 — no ADR 0291 row was ever written at 4.)
 *   6 — 2026-10-04 (ADR 0292): the bundle reads `pos_checks` and
 *       `wine_consumption_log` whole (`readWholeWindow`), where it used to
 *       read the first 1,000 rows PostgREST returned and name them a window.
 *       A row below 6 may hold a sentence computed from that slice: the
 *       sim's Saturday 2026-08-15 read "97% lower ($274 vs $10.8k)" where the
 *       whole window says about 14.6% lower. Those rows are refused and
 *       recomputed, not served until their category's cadence comes round.
 *       Lane cap first took 4 on its branch; sig (ADR 0272) landed 4 first
 *       and rec (ADR 0291) takes 5, so this change is 6: a row written by
 *       either earlier change predates it.
 *  10 — 2026-10-07 (ADR 0292, fork 3 follow-on): two new withholding rules.
 *       The table "#1" (`table.avg_check.peer_rank`) and the live surge
 *       (`table.revenue.hot_entity_live`) do not fire when the table list
 *       could not be read, where they fired as "Top table" and "A table";
 *       and the wine mover (`wine.bottles.vs_prev_period_7d`) does not fire
 *       when the inventory list could not be read, where it printed the
 *       wine's raw id as its name. A version-6 row written after such a read
 *       may hold one of those sentences, and every stored reader prefers it
 *       to a fresh compute, so it is refused and recomputed. Numbered 10,
 *       not 7: open PRs hold 7 (#619, #624) and 8 (#625, #626) on their
 *       branches (2026-10-07), and the coordinator renumbers at merge.
 *       [2026-10-08: #626 no longer holds 8; it holds 11, below.]
 *  11 — 2026-10-05 (ADR 0297): a glass is not a bottle. The bundle counts a
 *       consumption line's bottles by its own mode, where it read `quantity`
 *       (servings) as bottles: ten 150 ml glasses were "10 bottles sold", a
 *       50 ml single fifteen times what it poured. A day holding a line with
 *       no bottle figure is unobserved, and a wine holding one is left out of
 *       the movers and the stockout #1. Every record built on consumption
 *       carries `evidence.units`: how many of its lines and items rest on
 *       the 750 ml stand-in. A row below 11 may hold a sentence
 *       counted in pours, so it is recomputed, not served. (Drafted as 8;
 *       renumbered 9 on 2026-10-07 because #625 also holds 8, and 11 on
 *       2026-10-08 because #652 took 10 on `main`; neither 8 nor 9 was ever
 *       on `main`.) The number is re-checked at merge: of the open PRs that
 *       move it, whichever merges later takes one past the version on `main`
 *       at its merge. [2026-10-08: 11 also covers the bundle's own wording
 *       for `evidence.units.basis` (ADR 0297 round 4b); not bumped, since 11
 *       has never been on `main`.]
 *  12 — 2026-10-05 (ADR 0303): a hidden table leaves every table insight
 *       (rank, correlation, drivers, live surge), and so does a retired one
 *       or a check with no table; the driver fit reads only recorded seat
 *       counts, distances and outdoor flags, never a NULL as 0. A row below
 *       12 may rank a hidden table or fit an unrecorded 0, so it is
 *       recomputed, not served. Same version, 2026-10-07 (the founder's
 *       two rulings, ADR 0303; this version was not on `main` when they
 *       were built): the driver sentence needs the fit's F-test at
 *       SIGNIFICANCE_ALPHA and r² above DRIVER_MIN_R2, where it needed
 *       r² > 0.15 alone. [2026-10-08, merge of `origin/main` at be9a16ccf
 *       (#652): drafted as 8 on this branch (#625), with 7 held for lane
 *       stockout (ADR 0299, #619). #652 landed 10 on `main` first, so this
 *       change is 11, one past every value on `main`; no row was ever
 *       written at 8 on `main`, and this branch holds neither 7 nor 8.]
 *       [2026-10-08, merge of `origin/main` at 8b22448dc: #626 (ADR 0297)
 *       landed 11 on `main` first, so this change is 12, one past every
 *       value on `main`; no row was ever written at 11 for this change.]
 *  13 — 2026-10-09 (F-341): a currency figure prints in the house's own
 *       money (`restaurants.currency`), and with no symbol when none is
 *       recorded; it printed `$` for every house. A row below 13 may say
 *       dollars about lira or pounds, so it is recomputed, not served.
 *  14 — 2026-10-08 (F-295, ADR 0296): every daily series is filed on the
 *       house's day, where it read the UTC prefix of a timestamp: a Los
 *       Angeles dinner was filed on the next day, so "Thursday's sales" named
 *       Wednesday's dinner, and a day the manager ruled out removed the wrong
 *       day. A row below 14 may name the wrong day, so it is recomputed.
 *       Re-checked at merge like 11. [integ rehearsal 2026-10-10: drafted
 *       as 12 on fix/sim-insights-copy; 12 (ADR 0303) and 13 (F-341) were
 *       taken first, so this is 14. Renumber again at landing if needed.]
 *  15 — 2026-10-09 (F-381, F-132): the wine mover compares two weeks only
 *       when the house filed records on enough days of each (the overall
 *       comparison's rule), where a week with no records read "fell 100%"
 *       and raised the weekly-demand-slide card; and a concentration
 *       sentence says "worth watching" only above the usual 1,500 line, and
 *       names "your top vendor" in the singular; and (F-383, F-183) the goal
 *       card keeps the goals desk's pace, so a "keep at most" goal under its
 *       line, a level ramped from its baseline and a goal with nothing
 *       measured no longer read behind or "0% of the way". A row below 13
 *       may hold any of these sentences, so it is recomputed, not served. [integ rehearsal 2026-10-10:
 *       drafted as 13 on fix/sim-analytics-goals; 13 (F-341) and 14 (F-295)
 *       were taken first, so this is 15. Renumber again at landing if needed.]
 *  16 — 2026-10-10 (F-1189..F-1192): the forecast gap leaves out the days
 *       the manager ruled out, on both sides; a concentration line is read on
 *       the excess over an even split, so three equal vendors no longer read
 *       "highly concentrated"; and the stockout card counts bottles already
 *       ordered, averages demand over the days a drink was on the list, keys
 *       it by the house's item (drinks with no wine record included), and
 *       calls a sold-out drink with a demand out of stock (risk 1), where it
 *       said "Only 0 bottles". A row below 16 may say any of these, so it is
 *       recomputed. [integ rehearsal 2026-10-10: one past 15; renumber at
 *       landing if a sibling lane takes 16 first.]
 */
export const INSIGHT_GENERATOR_VERSION = 16;

/**
 * Each of the bundle's reads, in the words the house uses for it.
 *
 * A read that was refused (`readWholeWindow`'s `WholeReadError`) or that
 * failed (a Supabase error) leaves its slice empty, so no insight states a
 * figure from it. Each family is gated on the slice it is built on, and the
 * two groups of insights that also read a second slice are gated on that
 * read too:
 * the checks family's per-table insights (the table "#1" and the live surge)
 * on the table list, and the consumption family's wine mover on the
 * inventory list, which holds the wine's name (`readWasRefused`). That is
 * not enough on its own: an empty feed then looks like a quiet week. The
 * founder, 2026-10-07 (ADR 0292, fork 3 follow-on): *"Say it couldn't be
 * read (Recommended)"*. So `generate()` names every such read in its
 * `sourcesUnread`, and /recommendations' quiet tier prints the name. The
 * weekly digest prints it only in a letter that carries entries: in a week
 * where nothing stands it sends nothing, as before, and the name is only in
 * its log row's reason.
 *
 * Names, not table names; and a read that answered with no rows is never
 * named (an empty read is not a refused one). `goals` is the word the
 * recommendations feed already uses for its own read of the same goals, so
 * the two collapse into one name there.
 *
 * Not a sentence: no stored row carries these names, so they do not move
 * `INSIGHT_GENERATOR_VERSION`. The two gates above withhold sentences, and
 * they do (10).
 */
export const BUNDLE_READ_WORDS = {
  wine_consumption_log: "pour history",
  procurement_orders: "order history",
  restaurant_inventory: "inventory list",
  pos_checks: "till checks",
  restaurant_tables: "table list",
  restaurant_venue_profiles: "venue profile",
  analytics_goals: "goals",
} as const;
type BundleRead = keyof typeof BUNDLE_READ_WORDS;

/**
 * The house's time zone, in the same house words, when it is unset or could
 * not be read. Every daily series is filed on the house's day (ADR 0296), so
 * without a zone no day can be filed and every rule built on one says nothing;
 * this names why in `sourcesUnread`. Never UTC in its place: that filed a Los
 * Angeles dinner on the next day (F-295).
 */
export const HOUSE_ZONE_WORDS = "the house's time zone";

/**
 * The bundle's reads that hold the house's own records, in the order the page
 * lists them. A read here that answered with no rows is named in
 * `sourcesEmpty`: its rules had nothing to judge, which is not the same as
 * judging the house clear (F-298). The table list, venue profile and goals
 * are settings, not records, and an empty one is not named.
 */
const RECORD_READS = [
  "pos_checks",
  "wine_consumption_log",
  "procurement_orders",
  "restaurant_inventory",
] as const;

/**
 * Whether this bundle read was refused or failed: its slice is `[]` because
 * nothing could be read, not because the house has no rows. An insight that
 * takes a name from a slice other than its own family's (a table's label, a
 * wine's name) checks this, never the slice's length, before it fires. An
 * insight that names things from its own family's slice is gated on that
 * slice's length, which is empty when the read failed.
 */
function readWasRefused(bundle: Bundle, read: BundleRead): boolean {
  return bundle.unread.includes(BUNDLE_READ_WORDS[read]);
}

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

  constructor(
    private readonly dbService: DatabaseService,
    private readonly dayExclusions: DayExclusionsService,
    private readonly actions: RecommendationActionsService,
  ) {}

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
      /**
       * Only these types (the catalogue's "open live items", ADR 0191). A
       * narrowed read filters BEFORE the per-category cap, is uncapped unless
       * `maxPerCategory` is passed, and is NEVER persisted — see below.
       */
      candidateKeys?: string[];
      maxPerCategory?: number;
      persist?: boolean;
    } = {},
  ) {
    const startedAt = Date.now();
    const narrowed = (opts.candidateKeys?.length ?? 0) > 0;
    // The cap keeps a MIXED feed readable. A read narrowed to one type is the
    // manager asking for that type's whole list, so it is not capped.
    const maxPerCategory =
      opts.maxPerCategory ?? (narrowed ? Number.POSITIVE_INFINITY : 5);
    // The week a subject-less card fired in is the house's week, read once
    // here for every card (F-796, as the recommendations feed does for
    // F-384): keyed on UTC, a card put away on a Los Angeles Sunday evening
    // was already in next week's key and came straight back.
    const firedAt = new Date();
    const [bundle, state, zone] = await Promise.all([
      this.loadBundle(restaurantId),
      this.actions.readState(restaurantId),
      this.readFiringZone(restaurantId),
    ]);
    const candidates = availableCandidates(bundle.availability);

    let insights: InsightRecord[] = [];
    const push = (r: InsightRecord | null) => {
      if (r && r.sentence) insights.push(keyOnFiring(r, firedAt, zone));
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
    // BEFORE the cap below, never after it: filtering a capped list would
    // hide a type's live items whenever five higher-scoring insights of other
    // types share its category, and the catalogue would then say "nothing
    // live" about a type that fired (ADR 0191).
    if (narrowed) {
      const keys = new Set(opts.candidateKeys);
      insights = insights.filter((i) => keys.has(i.candidateKey));
    }

    // ---- The manager's dismissals, honoured HERE ---------------------------
    // This is the fix for "if the person says dismiss, it should be avoided at
    // all costs". Before it, `dismiss` wrote a row that exactly one consumer
    // read — the recommendations feed's own filter — while this generator, the
    // thing that produces the sentence and also feeds Reports, the mobile tab
    // and the hourly `analytics_insights` persist, had never heard of it. The
    // count is kept and returned rather than swallowed: a page that shows four
    // insights when six fired has to be able to say so (ADR 0020).
    //
    // Since ADR 0191's second round (founder, 2026-09-21: "Build it right, in
    // order") this honours the ONE shared per-item state, not dismissals
    // alone: a snooze (until its instant) and a done hold here too, at every
    // scope, so an item snoozed on the feed is snoozed on Reports, the rails
    // and the catalogue.
    const fired = insights;
    const held = withholdByState(
      insights,
      (i) => ({
        ruleId: insightRuleId(i.candidateKey),
        subject: i.subject,
        periodKey: i.periodKey,
      }),
      state.book,
    );
    insights = held.kept;
    const suppressed = held.withheld.dismissed;

    // Rank: score desc, cap per category.
    insights.sort((a, b) => b.score - a.score);
    const perCat = new Map<string, number>();
    const ranked = insights.filter((i) => {
      const c = perCat.get(i.category) || 0;
      if (c >= maxPerCategory) return false;
      perCat.set(i.category, c + 1);
      return true;
    });

    // A narrowed read is never persisted, whatever the caller asked:
    // `persist()` REPLACES every stored row of the requested categories (of
    // every category when none is named), so writing one type's list back
    // would delete every other type's stored insights for the house.
    //
    // The cache is state-free (ADR 0191, last call): it stores what fired —
    // capped as if nothing were hidden — together with what is shown now, and
    // every stored read applies the shared state (`readStored`). Storing only
    // what was visible at the rebuild meant a finding snoozed at 06:00 was
    // missing from the cache when its snooze ended, so on Reports and the
    // rails it did not "return after" (the founder's words) until the
    // category's next rebuild — a day for `daily`, a week for `weekly`, never
    // for `manual`. Same for a dismissal or a done returned to the book.
    // Bounded: at most twice the per-category cap.
    let persisted: boolean | null = null;
    if (opts.persist && !narrowed) {
      const shown = new Set(ranked);
      const firedPerCat = new Map<string, number>();
      const firedCapped = [...fired]
        .sort((a, b) => b.score - a.score)
        .filter((i) => {
          const c = firedPerCat.get(i.category) || 0;
          if (c >= maxPerCategory) return false;
          firedPerCat.set(i.category, c + 1);
          return true;
        });
      const toStore = [
        ...ranked,
        ...firedCapped.filter((i) => !shown.has(i)),
      ].sort((a, b) => b.score - a.score);
      persisted = await this.persist(restaurantId, toStore, opts.categories);
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
      // How many fired and were then withheld because the manager dismissed
      // them, and whether the dismissal list was readable at all. `false` here
      // means the list below may contain things already dismissed — the
      // surface must say that rather than present it as clean.
      suppressed,
      // Every hiding state, counted apart: a page that shows four when six
      // fired says which of the two were snoozed and which were ruled off.
      withheld: held.withheld,
      suppressionsReadable: state.readable,
      // Days the manager ruled out of the baselines, and whether THAT store
      // was readable. Same contract, same reason.
      excludedDays: Array.from(bundle.excludedDates).sort(),
      exclusionsReadable: bundle.exclusionsReadable,
      // The bottle basis of every consumption line the bundle read: how many
      // rest on the 750 ml stand-in, across how many items, and how many
      // carry no bottle figure (ADR 0297). Each record built on them carries
      // its own count in `evidence.units`.
      units: this.unitsOf(bundle.consumption),
      // The bundle's reads that were refused or failed, in house words
      // (`BUNDLE_READ_WORDS`). Empty = every read answered, rows or none. A
      // name here means every insight that reads it said nothing because
      // nothing could be read, not because nothing happened: the families
      // built on it, and the per-table and wine-mover insights that take a
      // label or a name from it (`readWasRefused`; ADR 0292).
      sourcesUnread: bundle.unread,
      // Whether the stored rows of the requested categories were replaced:
      // null when no persist was asked (or the read was narrowed), false when
      // the database refused the delete or the insert (logged), in which case
      // whatever rows stood may still stand.
      persisted,
      // The record reads that answered with no rows, in the same words. A
      // house with nothing recorded has rules with nothing to judge, and the
      // page says so rather than call the book clear (F-298).
      sourcesEmpty: RECORD_READS.filter(
        (r) =>
          !readWasRefused(bundle, r) &&
          {
            pos_checks: bundle.checks,
            wine_consumption_log: bundle.consumption,
            procurement_orders: bundle.orders,
            restaurant_inventory: bundle.inventory,
          }[r].length === 0,
      ).map((r) => BUNDLE_READ_WORDS[r]),
      computedIn: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Read stored insights (instant mobile path).
   *
   * **Rows below `INSIGHT_GENERATOR_VERSION` are treated as ABSENT, not as
   * data.** They were computed by arithmetic this build has superseded, which
   * makes them retracted claims rather than merely old ones — and every caller
   * of this method (`GET /analytics/insights/:id`, `getOverview`, the goal
   * suggestions) prefers whatever it returns over a fresh compute, so a stale
   * row here is served to a person. Withholding them makes the caller fall
   * through to `generate({persist:true})`, which recomputes and replaces them:
   * the cache corrects itself on first read, with no backfill and no deploy
   * hook, and serves nothing wrong in the meantime.
   *
   * `gte`, not `eq`: during a rolling deploy a newer pod's rows are better
   * arithmetic, not worse, and an older pod that refused them would recompute
   * and overwrite on every read.
   *
   * A failed read returns `[]` for the same reason it always did — one dead
   * cache must not take the endpoint down — but it is logged as a failure, and
   * the caller's fallback is a fresh compute, so nothing is reported as empty
   * that was merely unreadable.
   */
  async getStored(
    restaurantId: string,
    opts: { categories?: string[]; limit?: number } = {},
  ) {
    return (await this.readStored(restaurantId, opts)).rows;
  }

  /**
   * The stored read, with the ONE shared per-item state applied (ADR 0191).
   *
   * Before this, a stored row was served whatever had been done to it since
   * the last persist — a dismissal made at 10:05 stood on Reports, the rails
   * and the mobile tab until the category's next cadence run, which for a
   * `daily @ 06:00` category is the next morning. Every stored row now
   * carries its subject and period (`20260925120000`), so the same
   * `resolveItemState` the live compute uses decides here too, and each row
   * goes out with the keys an act on it must write (`suppression`), exactly
   * as a live row does — no surface builds a key.
   *
   * Reads past `limit` so that withheld rows do not shorten the page: the
   * table holds at most the per-category cap of each category, so the extra
   * read is bounded.
   *
   * `read` is how many current-version rows existed BEFORE the state was
   * applied: zero means a cold cache (the caller computes), anything else is
   * an answer even when every row was withheld.
   */
  async readStored(
    restaurantId: string,
    opts: { categories?: string[]; limit?: number } = {},
  ): Promise<{
    rows: any[];
    read: number;
    withheld: WithheldCounts;
    suppressionsReadable: boolean;
  }> {
    const limit = opts.limit ?? 30;
    const [rows, state] = await Promise.all([
      this.queryStored(restaurantId, opts.categories, Math.max(limit, 200)),
      this.actions.readState(restaurantId),
    ]);
    const held = withholdByState(rows, storedTarget, state.book);
    return {
      rows: held.kept.slice(0, limit).map((r) => {
        const target = storedTarget(r);
        return {
          ...r,
          suppression: {
            key: buildSuppressionKey(target, "insight"),
            scope: effectiveScope(target, "insight"),
            keys: suppressionKeys(target),
          },
        };
      }),
      read: rows.length,
      withheld: held.withheld,
      suppressionsReadable: state.readable,
    };
  }

  private async queryStored(
    restaurantId: string,
    categories: string[] | undefined,
    limit: number,
  ): Promise<any[]> {
    const client = this.dbService.getClient();
    let q = client
      .from("analytics_insights")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .gte("generator_version", INSIGHT_GENERATOR_VERSION)
      .order("score", { ascending: false })
      .limit(limit);
    if (categories?.length) q = q.in("category", categories);
    const { data, error } = await q;
    if (error) {
      // Includes the window between this code deploying and migration
      // `20260903130000` applying, when the column does not exist yet and
      // PostgREST answers 42703. Returning nothing is the SAFE failure here:
      // the caller recomputes rather than serving a row whose provenance
      // cannot be established.
      this.logger.warn(
        `getStored failed — serving nothing rather than rows of unknown ` +
          `provenance, the caller will recompute: ${error.message}`,
      );
      return [];
    }
    return data || [];
  }

  /**
   * Restaurants still holding insight rows from superseded arithmetic.
   *
   * The hourly sweep is cadence-gated — a `daily @ 06:00` category refreshes
   * once a day and not before — so after a generator change a tenant can carry
   * retracted sentences for up to 24 hours. `getStored()` stops SERVING them
   * immediately; this is what gets them REPLACED. One read for every tenant.
   *
   * A failed read returns null, which the sweep reports rather than treating as
   * "nothing is stale".
   */
  async staleVersionCategories(): Promise<Map<string, Set<string>> | null> {
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_insights")
      .select("restaurant_id, category")
      .lt("generator_version", INSIGHT_GENERATOR_VERSION)
      .limit(5000);
    if (error) {
      this.logger.warn(`stale-version scan failed: ${error.message}`);
      return null;
    }
    const byRestaurant = new Map<string, Set<string>>();
    for (const row of data || []) {
      const rid = String((row as any).restaurant_id ?? "");
      const category = String((row as any).category ?? "");
      if (!rid || !category) continue;
      const set = byRestaurant.get(rid);
      if (set) set.add(category);
      else byRestaurant.set(rid, new Set([category]));
    }
    return byRestaurant;
  }

  /**
   * Drop the stored rows of `categories` for one house, so that the next
   * read of those categories computes them live. For a write that changes
   * what the rows may say — a table hidden, or shown again (ADR 0303,
   * amendment item 7) — where a row stored at the 06:00 run would otherwise
   * stand, naming the table, until the category's next run. Returns whether
   * the rows are gone; a caller whose write must not outrun them refuses the
   * write on false. With no category named, nothing is dropped.
   */
  async dropStored(
    restaurantId: string,
    categories: InsightCategory[],
  ): Promise<boolean> {
    if (!categories.length) return true;
    const { error } = await this.dbService
      .getClient()
      .from("analytics_insights")
      .delete()
      .eq("restaurant_id", restaurantId)
      .in("category", categories);
    if (error) {
      this.logger.warn(
        `dropStored(${categories.join(",")}) failed, the rows stand: ` +
          error.message,
      );
      return false;
    }
    return true;
  }

  /**
   * Recompute `categories` for one house and replace their stored rows now,
   * outside the cadence. Never throws: the caller has already made the
   * change the rows must reflect. "refreshed" means the rows were replaced;
   * "dropped" means the fresh rows could not be written, so the stale ones
   * were removed and the next read of those categories computes live;
   * "stale" means neither worked, which is logged as an error, and the rows
   * stand until the category's next run.
   */
  async refreshStored(
    restaurantId: string,
    categories: InsightCategory[],
  ): Promise<"refreshed" | "dropped" | "stale"> {
    try {
      const out = await this.generate(restaurantId, {
        categories,
        persist: true,
      });
      if (out.persisted) return "refreshed";
    } catch (err: any) {
      this.logger.warn(
        `refreshStored(${categories.join(",")}) compute failed: ${err?.message}`,
      );
    }
    let dropped = false;
    try {
      dropped = await this.dropStored(restaurantId, categories);
    } catch (err: any) {
      this.logger.warn(
        `refreshStored(${categories.join(",")}) drop failed: ${err?.message}`,
      );
    }
    if (dropped) return "dropped";
    this.logger.error(
      `refreshStored(${categories.join(",")}): the stored rows could be ` +
        `neither replaced nor dropped, so they stand until the next run`,
    );
    return "stale";
  }

  /**
   * Replace the stored rows of `categories` (every category when none is
   * named) with `insights`. Returns whether both the delete and the insert
   * were accepted: PostgREST answers an error rather than throwing, so each
   * answer is read, and a refused write is logged and reported, never taken
   * for a write.
   */
  private async persist(
    restaurantId: string,
    insights: InsightRecord[],
    categories?: InsightCategory[],
  ): Promise<boolean> {
    const client = this.dbService.getClient();
    try {
      // Replace the refreshed categories atomically-enough for analytics.
      let del = client
        .from("analytics_insights")
        .delete()
        .eq("restaurant_id", restaurantId);
      if (categories?.length) del = del.in("category", categories);
      const { error: deleteError } = (await del) ?? {};
      if (deleteError) throw new Error(`delete: ${deleteError.message}`);
      if (insights.length) {
        const { error: insertError } =
          (await client.from("analytics_insights").insert(
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
              // The item's identity, so a stored read resolves its shared
              // state at every scope (ADR 0191, `20260925120000`).
              subject: i.subject ?? null,
              period_key: i.periodKey ?? null,
              generator_version: INSIGHT_GENERATOR_VERSION,
            })),
          )) ?? {};
        if (insertError) throw new Error(`insert: ${insertError.message}`);
      }
      return true;
    } catch (err: any) {
      this.logger.warn(`persist insights failed: ${err?.message}`);
      return false;
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

  /**
   * The house's zone for firing keys. A house with no zone, or a zone that
   * cannot be read, keys on UTC as before: a key is not a figure, and a
   * failed read must not take the whole feed down with it (F-384).
   */
  private async readFiringZone(restaurantId: string): Promise<string | null> {
    try {
      return (await readHouseZone(this.dbService.getClient(), restaurantId))
        .zone;
    } catch (err: any) {
      this.logger.warn(
        `house zone unread; firing weeks keyed on UTC: ${err?.message ?? err}`,
      );
      return null;
    }
  }

  private async loadBundle(restaurantId: string): Promise<Bundle> {
    const client = this.dbService.getClient();
    // A day back, so the first house day of the 90 is read whole (ADR 0296).
    const since90 = new Date(
      Date.now() - 90 * 86400000 - HOUSE_DAY_LOOKBACK_MS,
    ).toISOString();
    const since180 = new Date(Date.now() - 180 * 86400000).toISOString();

    // The manager's own exclusions — closures, buyouts, outages. Loaded with
    // the data, not after it, because every daily series below is built
    // through `toDaily` and every one of them must honour the same list.
    // Beside them, the house's own money, so every currency figure in a
    // sentence prints in it (F-341), grouped by the house's own mark (F-866).
    // It never rejects: null prints the figure with no symbol, never as
    // dollars, and a null locale groups en-US.
    const [exclusions, { currency, locale }] = await Promise.all([
      this.dayExclusions.load(restaurantId),
      readHouseMoney(client, restaurantId),
    ]);

    // Every row is filed on the house's day, as /reports files it (ADR 0296):
    // the exclusions above are house dates, and a UTC prefix filed a Los
    // Angeles dinner on the next day (F-295). With no zone, or a zone read
    // that failed, no row gets a day, so no daily rule fires, and the zone is
    // named in `unread` rather than read as UTC.
    let zone: string | null = null;
    try {
      zone = (await readHouseZone(client, restaurantId)).zone;
    } catch (err: any) {
      this.logger.error(`insight bundle zone read failed: ${err?.message}`);
    }
    const dayOf = (
      subject:
        | string
        | { closed_at?: string | null; opened_at?: string | null },
    ) => (zone ? (houseDayOf(subject, zone) ?? "") : "");

    // The two window reads go through `readWholeWindow` (ADR 0292). Unranged,
    // they stopped at PostgREST's 1,000 rows: the sales-dip rule then read
    // Saturday Aug 15 as $274 against a $10.8k average, "97% lower", over a
    // day the feed puts about 15% down (A-004). The whole rows are put back
    // into the `{ data, error }` shape `ok()` reads; a refusal REJECTS, which
    // the loop below logs and names in `unread`: the family states no figure,
    // and the feed says which read it could not make (ADR 0292, 2026-10-07).
    const whole = (rows: unknown[]) => ({ data: rows, error: null });
    const [cons, ords, inv, checks, tables, venue, goals, open] =
      await Promise.allSettled([
        readWholeWindow("The insight bundle's consumption lines", () =>
          client
            .from("wine_consumption_log")
            // No master_wine_id column — resolve via the inventory FK.
            .select(
              "id, inventory_id, consumption_type, quantity, volume_ml, created_at, restaurant_inventory(master_wine_id, bottle_size_ml)",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            // F-1197: a voided or corrected-down sale is marked reversed.
            .is("reversed_at", null)
            .gte("created_at", since90),
        ).then(whole),
        client
          .from("procurement_orders")
          // NO provider_name column on procurement_orders (see
          // supabase/migrations/20260805000000_baseline_from_production.sql:4514-4568)
          // — naming it 42703s the whole query, `ok()` below turned that into
          // an empty order list, and the entire purchasing insight family went
          // permanently silent. The vendor label comes from the provider_id FK.
          .select(
            "provider_id, providers(name), total_cost, final_price, currency, bottles_total, quantity, delivered_at, created_at, status",
          )
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_SPEND_STATUSES)
          .gte("delivered_at", since180),
        client
          .from("restaurant_inventory")
          .select(
            "id, wine_name, stock_live, menu_price_current, last_purchase_price, master_wine_id, created_at, master_wine_library(primary_type)",
          )
          .eq("restaurant_id", restaurantId)
          .eq("is_active", true),
        readWholeWindow("The insight bundle's POS checks", () =>
          client
            .from("pos_checks")
            .select(
              "id, source, table_id, server_name, server_external_id, opened_at, closed_at, covers, total, subtotal, tip, items",
              { count: "exact" },
            )
            .eq("restaurant_id", restaurantId)
            // Voided checks are not revenue — see pos_checks.voided.
            .eq("voided", false)
            .gte("opened_at", since90),
        ).then(whole),
        client
          .from("restaurant_tables")
          .select(
            "id, label, seats, zone, is_outdoor, distance_to_kitchen_m, distance_to_bar_m, distance_to_pool_m, hidden_at",
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
        // Bottles already ordered and not yet here, as getInventoryScience
        // reads them (F-630, F-1192): the stockout card counts them before it
        // says "reorder".
        client
          .from("procurement_orders")
          .select("inventory_id, bottles_total")
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_NOT_YET_ARRIVED_STATUSES),
      ]);

    // A failed slice still degrades to `[]` — one dead lens must not take the
    // whole insight run down. But it must not do so SILENTLY: an empty array
    // from a 42703 is indistinguishable from an empty array from a quiet
    // restaurant, which is precisely how the provider_name drift above stayed
    // invisible. Every failure now names itself in the logs, and in `unread`,
    // which `generate()` returns as `sourcesUnread` (ADR 0292, 2026-10-07).
    const slices: Array<[BundleRead, PromiseSettledResult<any>]> = [
      ["wine_consumption_log", cons],
      ["procurement_orders", ords],
      ["restaurant_inventory", inv],
      ["pos_checks", checks],
      ["restaurant_tables", tables],
      ["restaurant_venue_profiles", venue],
      ["analytics_goals", goals],
      ["procurement_orders", open],
    ];
    const unread: string[] = zone ? [] : [HOUSE_ZONE_WORDS];
    for (const [table, r] of slices) {
      if (r.status === "rejected") {
        this.logger.error(
          `insight bundle query on ${table} rejected: ${r.reason}`,
        );
        unread.push(BUNDLE_READ_WORDS[table]);
      } else if (r.value?.error) {
        this.logger.error(
          `insight bundle query on ${table} failed — this family states no ` +
            `figure and is named as unread: ${r.value.error.code ?? "?"} ${r.value.error.message ?? r.value.error}`,
        );
        unread.push(BUNDLE_READ_WORDS[table]);
      }
    }
    // The two order reads share one name in `unread`.
    unread.splice(0, unread.length, ...new Set(unread));

    // Per inventory row: bottles on order, null when an open order states no
    // bottle count. The whole map is null when the read failed — never
    // "nothing on order" (ADR 0067), the rule analytics.service.ts keeps.
    let onOrder: Map<string, number | null> | null = null;
    if (open.status === "fulfilled" && !open.value.error) {
      onOrder = new Map();
      for (const o of open.value.data || []) {
        if (!o.inventory_id) continue;
        const was = onOrder.has(o.inventory_id)
          ? onOrder.get(o.inventory_id)!
          : 0;
        const bottles = Number(o.bottles_total);
        onOrder.set(
          o.inventory_id,
          was === null || !(bottles > 0) ? null : was + bottles,
        );
      }
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
        itemId: c.inventory_id ?? null,
        // Bottles by the line's own mode, null when it carries no bottle
        // figure (ADR 0297). `quantity` counts servings, never bottles.
        qty: bottlesOf(c).bottles,
        how: bottlesOf(c).how,
        date: dayOf(c.created_at || ""),
      })),
      orders: ok<any>(ords).map((o: any) => ({
        vendorId: o.provider_id || "unknown",
        vendorName: o.providers?.name || o.provider_id || "unknown vendor",
        // Null when the order carries no price (F-701).
        cost: orderSpend(o),
        // The code the order was paid in; null when it names none (F-1015).
        currency: orderCurrency(o),
        date: dayOf(o.delivered_at || o.created_at || ""),
      })),
      inventory: ok<any>(inv),
      onOrder,
      // Each check carries its house day, by close else open (`houseDayOf`).
      checks: ok<any>(checks).map((c: any) => ({ ...c, houseDay: dayOf(c) })),
      tables: ok<any>(tables),
      venueFeatures:
        venue.status === "fulfilled" && !venue.value.error
          ? venue.value.data?.features || null
          : null,
      goals: ok<any>(goals),
      availability: new Set<DataRequirement>(),
      excludedDates: exclusions.dates,
      exclusionsReadable: exclusions.readable,
      unread,
      currency,
      locale,
      zone,
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

  /**
   * The bottle basis of these consumption lines (ADR 0297), in the bundle's
   * words: a line with no bottle figure is not "null" here, its day is
   * unobserved and its wine is left out (`unitsBasisSentence` "bundle").
   */
  private unitsOf(lines: Bundle["consumption"]): UnitsLabel {
    return unitsLabel(
      lines.map((c) => ({ how: c.how, inventoryId: c.itemId })),
      "bundle",
    );
  }

  /**
   * A daily series, and — separately — which of those days are EVIDENCE.
   *
   * The `values` array still carries 0 for a day with no rows, because every
   * downstream sum expects a dense series. `observed` is the correction: false
   * means "this restaurant filed nothing for this day", which is an ABSENCE,
   * not a measurement of zero. Before this distinction existed, a closure, a
   * POS outage and a genuinely dead day were the same number to every baseline,
   * and the running gateway said "Wednesday sales came in 100% lower than your
   * average Wednesday ($0 vs $104)" about a day it had no records for.
   *
   * A day the manager has excluded is also `observed: false` — from the
   * engine's point of view "we were shut" and "nothing was filed" are the same
   * instruction (do not treat this as a trading day), even though they reach
   * the code by different routes and are stored in different places.
   */
  private toDaily(
    rows: Array<{ date: string; value: number }>,
    days: number,
    zone: string | null,
    excluded?: ReadonlySet<string>,
  ): { dates: string[]; values: number[]; observed: boolean[] } {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (!r.date) continue;
      byDay.set(r.date, (byDay.get(r.date) || 0) + r.value);
    }
    const dates: string[] = [];
    const values: number[] = [];
    const observed: boolean[] = [];
    // The days are the house's (ADR 0296). With no zone no row carries a day
    // (`loadBundle`), so the series is empty and no day is named.
    if (!zone) return { dates, values, observed };
    const today = houseToday(zone);
    for (let d = days; d >= 1; d--) {
      // exclude today (partial day would distort baselines)
      const day = shiftHouseDay(today, -d);
      dates.push(day);
      values.push(byDay.get(day) || 0);
      observed.push(byDay.has(day) && !excluded?.has(day));
    }
    return { dates, values, observed };
  }

  /**
   * The days a drink's demand is averaged over (F-687, F-1192): the window,
   * or fewer when it was listed inside it, counting the listing day — the
   * rule analytics.service.ts `daysOnList` keeps, on this file's series,
   * which ends yesterday. A sale dated before the listing (an import) moves
   * the start back to it; an unknown listing date keeps the whole window.
   */
  private daysOnList(
    listedAt: string | null | undefined,
    rows: Array<{ date: string }>,
    days: number,
    zone: string | null,
  ): number {
    if (!listedAt || !zone) return days;
    let first = String(listedAt).slice(0, 10);
    for (const r of rows) if (r.date && r.date < first) first = r.date;
    const span = Math.floor(
      (Date.parse(houseToday(zone)) - Date.parse(first)) / 86400000,
    );
    return Number.isFinite(span) ? Math.min(days, Math.max(1, span)) : days;
  }

  // ==========================================================================
  // Family: consumption (wine demand) — sales/forecast/risk categories
  // ==========================================================================

  private computeConsumptionFamily(bundle: Bundle, push: Push) {
    if (!bundle.availability.has("consumption")) return;
    // A day holding a line with no bottle figure is short by an unknown
    // amount, so it joins the manager's exclusions as unobserved, and a wine
    // holding one has no demand to rank (ADR 0297).
    const uncountedDays = new Set<string>();
    const uncountedWines = new Set<string>();
    for (const c of bundle.consumption)
      if (c.qty == null) {
        if (c.date) uncountedDays.add(c.date);
        if (c.wineId) uncountedWines.add(c.wineId);
      }
    const counted = bundle.consumption.filter((c) => c.qty != null);
    const rows = counted.map((c) => ({
      date: c.date,
      value: c.qty as number,
    }));
    const { dates, values, observed } = this.toDaily(
      rows,
      90,
      bundle.zone,
      uncountedDays.size > 0
        ? new Set([...bundle.excludedDates, ...uncountedDays])
        : bundle.excludedDates,
    );
    const label = "bottles sold";
    // Every record below carries the bottle basis of the lines it was built
    // from: how many rest on the 750 ml stand-in, across how many items
    // (ADR 0297, fork 1: "labelled", with those counts).
    const inSeries = new Set(dates);
    const seriesUnits = this.unitsOf(
      bundle.consumption.filter((c) => inSeries.has(c.date)),
    );

    this.timeSeriesInsights({
      push: (r) => push(withUnits(r, seriesUnits)),
      dates,
      values,
      observed,
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
    for (const c of counted) {
      if (!c.wineId || uncountedWines.has(c.wineId)) continue;
      const arr = byWine.get(c.wineId) || [];
      arr.push({ date: c.date, value: c.qty as number });
      byWine.set(c.wineId, arr);
    }

    // Wine week-over-week movers. The sentence names the wine, and the name
    // is the inventory list's: when that read was refused or failed there is
    // no name to print, so the mover does not fire, rather than print the
    // wine's raw id as its name (ADR 0292, 2026-10-07; version 10).
    let bestMove: {
      wine: string;
      wineId: string;
      days: string[];
      cmp: E.MatchedPeriodComparison;
    } | null = null;
    const namesUnread = readWasRefused(bundle, "restaurant_inventory");
    // The two weeks are compared only when the HOUSE filed records on enough
    // days of each, by the same rule as the overall comparison: a wine with
    // no line on a trading day sold none, but a week with no records at all
    // is an absence, not "fell 100%" (F-381). `observed` is the overall
    // series' (it holds the manager's exclusions and the uncounted days), and
    // its last 28 days are the per-wine series' 28.
    const houseObserved = observed.slice(-28);
    const obsIn = (from: number, to: number) =>
      houseObserved.slice(from, to).filter(Boolean).length;
    const curObs = obsIn(21, 28);
    const prevObs = obsIn(14, 21);
    const weeksComparable =
      houseObserved.length === 28 &&
      curObs >= MIN_PERIOD_OBSERVED &&
      prevObs >= MIN_PERIOD_OBSERVED &&
      Math.abs(curObs - prevObs) <= MAX_PERIOD_OBSERVED_GAP;
    // Within those weeks, a wine's quiet day is a real zero only when the
    // house was open: its weeks are compared over the days the house traded
    // in both (F-707).
    const houseOpen = new Set(dates.filter((_, i) => observed[i]));
    for (const [wineId, wineRows] of namesUnread || !weeksComparable
      ? []
      : byWine) {
      const daily = this.toDaily(wineRows, 28, bundle.zone);
      const cmp = E.matchedPeriodOverPeriod(
        daily.values,
        daily.dates.map((d) => houseOpen.has(d)),
        7,
      );
      if (
        !cmp ||
        cmp.matchedDays < MIN_PERIOD_OBSERVED ||
        cmp.deltaPct === null ||
        cmp.previous < 2
      )
        continue;
      if (
        !bestMove ||
        Math.abs(cmp.deltaPct) > Math.abs(bestMove.cmp.deltaPct ?? 0)
      )
        bestMove = {
          wine: nameByWine.get(wineId) || wineId,
          wineId,
          // The two weeks the comparison reads, for its label.
          days: daily.dates.slice(-14),
          cmp,
        };
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
        openDays:
          bestMove.cmp.matchedDays < 7 ? bestMove.cmp.matchedDays : undefined,
      };
      const movedId = bestMove.wineId;
      const fortnight = new Set(bestMove.days);
      push(
        withUnits(
          this.record("wine.bottles.vs_prev_period_7d", "sales", "period", ev, {
            effectPct: bestMove.cmp.deltaPct,
            n: 14,
            entityLabel: bestMove.wine,
          }),
          this.unitsOf(
            bundle.consumption.filter(
              (c) => c.wineId === movedId && fortnight.has(c.date),
            ),
          ),
        ),
      );
    }

    // Concentration of demand across wines (risk).
    const totalsByWine = Array.from(byWine.entries()).map(([wineId, r]) => ({
      id: wineId,
      total: r.reduce((s, x) => s + x.value, 0),
    }));
    // A share of a total that misses an uncounted wine is not its share.
    if (totalsByWine.length >= 5 && uncountedWines.size === 0) {
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
          entityCount: totalsByWine.length,
        };
        push(
          withUnits(
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
            this.unitsOf(counted.filter((c) => !!c.wineId)),
          ),
        );
      }
    }

    // Forecast gap: train Holt-Winters on everything but the last 7 days, then
    // compare its out-of-sample forecast against what actually happened. This
    // is a genuine holdout — it scores `forecast`, never `fitted` (ADR 0064).
    // A day the manager ruled out keeps its real figure in `values` (toDaily
    // only marks it unobserved), so a 150-bottle event day read "127% ahead
    // of forecast" (F-1189). It is left out of both sides of the gap, and in
    // the training series it takes the figure from a week before.
    const ruledOut = (i: number) => bundle.excludedDates.has(dates[i]);
    const train = values.slice(0, -7);
    for (let i = 0; i < train.length; i++)
      if (ruledOut(i)) train[i] = i >= 7 ? train[i - 7] : 0;
    const hw = E.holtWintersAdditive(
      train,
      7,
      {
        alpha: 0.3,
        beta: 0.05,
        gamma: 0.3,
      },
      7,
    );
    if (hw && uncountedDays.size === 0) {
      const from = values.length - 7;
      let actual = 0;
      let predicted = 0;
      for (let k = 0; k < 7; k++) {
        if (ruledOut(from + k)) continue;
        actual += values[from + k];
        predicted += Math.max(0, hw.forecast[k]);
      }
      if (predicted > 0) {
        const gap = (actual - predicted) / predicted;
        const ev: InsightEvidence = {
          measureLabel: label,
          unit: "units",
          forecastGapPct: gap,
          windowLabel: "week",
        };
        push(
          withUnits(
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
            seriesUnits,
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
    // A delivery with no price would make the spend trend and the vendor
    // shares short, and a short figure reads as a real dip or a real share.
    // Nothing is said about spend until every order in the window is priced
    // (F-701).
    if (bundle.orders.some((o) => o.cost == null)) return;
    // Orders paid in two currencies have no one spend line and no shares:
    // there is no rate to add euros to lira, as COGS says (F-339). Nothing
    // is said about spend then either (F-1015). One named currency is the
    // money every figure below is printed in; an order naming none is read
    // as the house's, as COGS reads it, so an old no-code order beside a
    // euro one is two currencies, not one (F-1102).
    const codes = namedCurrencies(bundle.orders, bundle.currency);
    if (codes.length > 1) return;
    const spendCurrency = codes[0] ?? bundle.currency;
    const rows = bundle.orders.map((o) => ({
      date: o.date,
      value: o.cost as number,
    }));
    const { dates, values, observed } = this.toDaily(
      rows,
      90,
      bundle.zone,
      bundle.excludedDates,
    );

    this.timeSeriesInsights({
      push,
      dates,
      values,
      observed,
      measure: "purchase_spend",
      measureLabel: "purchasing spend",
      unit: "currency",
      currency: spendCurrency,
      locale: bundle.locale,
      dimension: "overall",
      category: "purchasing",
      periodWindow: 30,
      windowLabel: "30 days",
    });

    // Vendor concentration + peer rank.
    const byVendor = new Map<string, { name: string; total: number }>();
    for (const o of bundle.orders) {
      const e = byVendor.get(o.vendorId) || { name: o.vendorName, total: 0 };
      e.total += o.cost as number;
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
        currency: spendCurrency,
        locale: bundle.locale,
        topShare: sorted[0].total / total,
        topCount: 1,
        hhi,
        entityCount: byVendor.size,
      };
      // Filed where the catalogue files it (ADR 0291): `categorize()` sorts
      // every vendor dimension into purchasing, and a type recorded under any
      // other category is one the catalogue's narrowed read cannot find.
      push(
        this.record(
          "vendor.purchase_spend.concentration",
          "purchasing",
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

    // Counted lines only, and no item holding a line with no bottle figure:
    // its risk would rest on demand it understates (ADR 0297). Keyed by the
    // house's item, as getInventoryScience keys it: keyed by master wine,
    // every drink with no wine record had no demand and never ranked (F-1014,
    // F-1192).
    const byItem = new Map<string, Array<{ date: string; value: number }>>();
    const uncounted = new Set<string>();
    for (const c of bundle.consumption)
      if (c.qty == null && c.itemId) uncounted.add(c.itemId);
    for (const c of bundle.consumption) {
      if (!c.itemId || c.qty == null || uncounted.has(c.itemId)) continue;
      const arr = byItem.get(c.itemId) || [];
      arr.push({ date: c.date, value: c.qty });
      byItem.set(c.itemId, arr);
    }

    // Every wine the risk could be computed for, not just a running maximum:
    // the strict `prob > worst.prob` kept whichever wine of a tie came first
    // in inventory order and printed it as "#1" (Jameson, for an 8-way tie at
    // 61% on Tuzlu). A #1 that shares its value is not a finding — the same
    // rule as the weekday tie at advanced-analytics.service.ts (ADR 0272).
    const ranked: Array<{
      id: string;
      name: string;
      stockoutProbability: number;
      daysOfCover: number | null;
      onHand: number;
      onOrder: number | null;
      rows: number;
      itemId: string;
    }> = [];
    for (const item of bundle.inventory) {
      const rows = byItem.get(item.id) || [];
      if (rows.length < 5) continue;
      // Demand over the days the drink was on the list, not over 90 days it
      // could not have sold (F-687, F-1192).
      const days = this.daysOnList(item.created_at, rows, 90, bundle.zone);
      const values = this.toDaily(rows, days, bundle.zone).values;
      const dailyMean = values.reduce((a, b) => a + b, 0) / (days || 1);
      const profile = E.demandProfile(values);
      if (!profile || profile.mean <= 0) continue;
      const onHand = item.stock_live || 0;
      // What the shelf will hold once what is already ordered arrives
      // (F-630): an order with no bottle count adds nothing, and says so.
      const onOrder =
        bundle.onOrder === null
          ? null
          : bundle.onOrder.has(item.id)
            ? bundle.onOrder.get(item.id)!
            : 0;
      const prob = E.stockoutProbability({
        onHand: onHand + (onOrder ?? 0),
        avgDemandPerPeriod: profile.mean,
        demandStdev: profile.stdev,
        leadTime: 7,
      });
      if (prob !== null && dailyMean > 0.05) {
        ranked.push({
          id: String(item.id),
          name: item.wine_name || item.master_wine_id || String(item.id),
          stockoutProbability: prob,
          daysOfCover: E.daysOfCover(onHand, profile.mean),
          onHand,
          onOrder,
          rows: rows.length,
          itemId: String(item.id),
        });
      }
    }
    ranked.sort(E.byStockoutRisk);
    const worst = ranked[0];
    const tiedAtTop =
      ranked.length > 1 &&
      E.sameValue(ranked[1].stockoutProbability, worst.stockoutProbability);
    // An order the bottles of which cannot be counted leaves the risk unknown;
    // "reorder" over it is the F-630 sentence again, so it is withheld.
    if (worst?.onOrder === null) return;
    if (worst && worst.stockoutProbability > 0.25 && !tiedAtTop) {
      const coming = worst.onOrder ? `, ${worst.onOrder} on order` : "";
      const bottles = (n: number) => `${n} bottle${n === 1 ? "" : "s"}`;
      const ev: InsightEvidence = {
        entity: worst.name,
        measureLabel: "stockout risk",
        unit: "percent",
        value: worst.stockoutProbability,
        rank: 1,
        // The wines actually ranked — not every active inventory row, most of
        // which had too little demand to be given a risk at all.
        peerCount: ranked.length,
        // An empty shelf is out of stock, never "Only 0 bottles" (F-1191).
        attributeReading:
          worst.onHand <= 0
            ? `Out of stock${coming} — ${worst.onOrder ? "not enough for its demand before the next delivery window" : "reorder now"}.`
            : `Only ${bottles(worst.onHand)} on hand${coming} vs its demand pattern — reorder before the next delivery window.`,
      };
      push(
        withUnits(
          this.record("wine.stockout_risk.peer_rank", "risk", "peer", ev, {
            effectPct: worst.stockoutProbability,
            // A probability has no test statistic. This was a hard-coded 2 on
            // a hard-coded n of 30 — significance and support nobody measured.
            z: null,
            n: worst.rows,
            boost: 1.5,
          }),
          // Its demand's bottle basis (ADR 0297).
          this.unitsOf(
            bundle.consumption.filter((c) => c.itemId === worst.itemId),
          ),
        ),
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
      date: c.houseDay || "",
      value: c.total || 0,
    }));
    const { dates, values, observed } = this.toDaily(
      revRows,
      90,
      bundle.zone,
      bundle.excludedDates,
    );
    this.timeSeriesInsights({
      push,
      dates,
      values,
      observed,
      measure: "revenue",
      measureLabel: "sales",
      unit: "currency",
      currency: bundle.currency,
      locale: bundle.locale,
      dimension: "overall",
      category: "sales",
    });

    const tableById = new Map(bundle.tables.map((t: any) => [t.id, t]));
    // A hidden table leaves every table figure, these insights included
    // (ADR 0303, founder fork F2: "Out of every figure (Recommended)"). Only
    // a table the house shows is ranked, correlated, fitted or watched. A
    // check at a hidden or retired table stays in sales, in its server's
    // figures and, when it has a server, in the waiter adjustment's table
    // control (founder, 2026-10-05: "Keep them in the control
    // (Recommended)"). A check with no table stays in sales and in its
    // server's figures; the control, being a table control, never held it.
    const shownTableIds = new Set(
      bundle.tables.filter((t: any) => !t.hidden_at).map((t: any) => t.id),
    );
    // The per-table insights (the table "#1", its attribute and driver
    // readings, and the live surge) take each table's label and attributes
    // from the table list. When that read was refused or failed they do not
    // fire, where the "#1" printed "Top table" and the surge "A table" over a
    // list nobody could read (ADR 0292, 2026-10-07; version 10). The insights
    // built on the checks alone (the till's series, the server "#1", the
    // basket) still may: a check carries its own `table_id`.
    // [2026-10-08, merge of be9a16ccf (#652) into #625: both rules stand.
    // A refused list also leaves `shownTableIds` empty, so no table is
    // aggregated or watched either way; this gate says so outright rather
    // than leave the rule to that emptiness. The waiter control reads only
    // a check's own `table_id`, so it is not gated (ADR 0303, ADR 0292).]
    const tablesUnread = readWasRefused(bundle, "restaurant_tables");

    // ---- per-table aggregates --------------------------------------------
    // `sumSq` is the sum of squared check totals: with `revenue` and
    // `checks` it gives each group's variance, which the ranking gates need
    // (ADR 0272) — O(N), no per-check arrays kept.
    const byTable = new Map<
      string,
      {
        revenue: number;
        sumSq: number;
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
        sumSq: number;
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

      if (c.table_id && shownTableIds.has(c.table_id)) {
        const t = byTable.get(c.table_id) || {
          revenue: 0,
          sumSq: 0,
          checks: 0,
          covers: 0,
          wineChecks: 0,
          tips: 0,
        };
        t.revenue += c.total || 0;
        t.sumSq += (c.total || 0) ** 2;
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
          sumSq: 0,
          checks: 0,
          covers: 0,
          wineChecks: 0,
          tips: 0,
        };
        w.revenue += c.total || 0;
        w.sumSq += (c.total || 0) ** 2;
        w.checks += 1;
        w.covers += c.covers || 0;
        w.wineChecks += hasWine ? 1 : 0;
        w.tips += c.tip || 0;
        byWaiter.set(server, w);
        // The control takes every check here (one with a server) that has a
        // table, hidden or not: a hidden table still shapes what its servers
        // took (ADR 0303). The fit reads net sales, as the server register's
        // does (w113-net-readers, ADR 0341 bracket): sales tax and tips are
        // not what a server sold. A check with no stated net leaves the
        // whole fit, never read as its total.
        const net = netSalesOf(c);
        if (c.table_id && net !== null) {
          waiterObs.y.push(net);
          waiterObs.waiter.push(server);
          waiterObs.table.push(c.table_id);
        }
      }
    }

    // Table peer ranking on avg check, with distance attribution.
    if (!tablesUnread && byTable.size >= 3) {
      const entries = Array.from(byTable.entries())
        .filter(([, v]) => v.checks >= 3)
        .map(([id, v]) => ({
          entity: id,
          value: v.revenue / v.checks,
        }));
      if (entries.length >= 3) {
        // "#1 of N" only when the data can tell the leader apart (ADR 0272).
        const lead = E.leaderTest(momentsOf(byTable), {
          alpha: SIGNIFICANCE_ALPHA,
          minN: MIN_RANK_N,
          minGroups: 3,
        });
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
          let best: { name: string; r: number; n: number } | null = null;
          // Every attribute the strongest one was picked from: the pick is
          // corrected for all of them (Bonferroni), not tested as if alone.
          let tested = 0;
          for (const a of attrs) {
            const xs = withAttrs.map((x) => Number(x.t[a.key] ?? NaN));
            const pairs = withAttrs
              .map((x, i) => ({ x: xs[i], y: x.v }))
              .filter((p) => Number.isFinite(p.x));
            if (pairs.length < 4) continue;
            tested++;
            const r = E.pearson(
              pairs.map((p) => p.x),
              pairs.map((p) => p.y),
            );
            if (r !== null && (!best || Math.abs(r) > Math.abs(best.r)))
              best = { name: a.name, r, n: pairs.length };
          }
          // |r| ≥ 0.35 alone fired on noise: with 24 tables and four
          // attributes, the strongest of four null correlations clears 0.35
          // far more often than one time in twenty. Fisher's z decides.
          const corr = best
            ? E.correlationSignificance(best.r, best.n, tested)
            : null;
          if (
            best &&
            corr &&
            Math.abs(best.r) >= 0.35 &&
            corr.pAdjusted <= SIGNIFICANCE_ALPHA
          ) {
            attributeReading = tableAttributeReading(
              best.name,
              best.r,
              bundle.locale,
            );
            const evc: InsightEvidence = {
              entity: "tables",
              measureLabel: "average check",
              unit: "currency",
              currency: bundle.currency,
              locale: bundle.locale,
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
                  z: Math.abs(corr.z),
                  n: best.n,
                },
              ),
            );
          }

          // Driver weights via ridge on table attributes. An unknown is not
          // a zero (ADR 0051, ADR 0053): a table learned from the till has no
          // seat count, distance or outdoor flag (ADR 0303), and this step
          // used to fit `?? 0` and "not outdoor" as if they were measured.
          // The room register's rule now holds here too: an attribute enters
          // only when it is recorded, and not the same, on at least
          // DRIVER_MIN_RECORDED ranked tables, and the fit runs over the
          // tables that carry every attribute kept. With none kept, no fit.
          const kept = TABLE_DRIVERS.filter((f) => {
            const values = withAttrs
              .map((x) => f.of(x.t))
              .filter((v) => Number.isFinite(v));
            return (
              values.length >= DRIVER_MIN_RECORDED && new Set(values).size > 1
            );
          });
          const fitRows = withAttrs
            .map((x) => ({ x: kept.map((f) => f.of(x.t)), y: x.v }))
            .filter((r) => r.x.every((v) => Number.isFinite(v)));
          const reg =
            kept.length > 0 && fitRows.length >= DRIVER_MIN_RECORDED
              ? E.multipleRegression(
                  fitRows.map((r) => r.x),
                  fitRows.map((r) => r.y),
                  { ridgeLambda: 0.1 },
                )
              : null;
          // The founder's two rulings (2026-10-07, ADR 0303): the sentence
          // needs the fit's F-test at alpha and r² above DRIVER_MIN_R2; see
          // driverSentencePrints. Both read the ridge fit's own r², the fit
          // whose weights the sentence prints.
          if (
            reg &&
            driverSentencePrints(
              reg.r2,
              fitRows.map((r) => r.y),
              kept.length,
            )
          ) {
            const drivers = reg.standardizedBetas
              .map((w, i) => ({ attribute: kept[i].name, weight: w }))
              .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
            const evd: InsightEvidence = {
              measureLabel: "average check",
              unit: "currency",
              currency: bundle.currency,
              locale: bundle.locale,
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
                  n: fitRows.length,
                },
              ),
            );
          }
        }
        if (lead.separable) {
          const standings = E.peerComparison(
            lead.ranked.map((g) => ({ entity: g.entity, value: g.mean })),
          );
          const top = standings[0];
          const t: any = tableById.get(top.entity);
          const ev: InsightEvidence = {
            entity: t?.label ? `Table ${t.label}` : "Top table",
            measureLabel: "average check",
            unit: "currency",
            currency: bundle.currency,
            locale: bundle.locale,
            value: top.value,
            rank: 1,
            peerCount: standings.length,
            deltaPct: top.pctVsMean,
            attributeReading,
          };
          push(
            this.record("table.avg_check.peer_rank", "tables", "peer", ev, {
              effectPct: top.pctVsMean,
              z: lead.zVsRest,
              n: lead.ranked[0].n,
            }),
          );
        }
      }
    }

    // Waiter peer + adjusted effects.
    if (byWaiter.size >= 2) {
      // "#1 of N" only when the data can tell the leader apart (ADR 0272).
      const lead = E.leaderTest(momentsOf(byWaiter), {
        alpha: SIGNIFICANCE_ALPHA,
        minN: MIN_RANK_N,
        minGroups: 2,
      });
      if (lead.separable) {
        const standings = E.peerComparison(
          lead.ranked.map((g) => ({ entity: g.entity, value: g.mean })),
        );
        const top = standings[0];
        const eligible = new Set(lead.ranked.map((g) => g.entity));
        let attributeReading: string | undefined;
        // A lead that belongs to the tables, not the server: when the
        // table-adjusted fit puts someone else on top, the raw lead is table
        // assignment and nothing is printed. This replaces "X actually adds
        // the most per check" — a second ranking claim no test stood behind.
        let survivesTables = true;
        if (waiterObs.y.length >= 10 && new Set(waiterObs.table).size >= 2) {
          const adj = E.adjustedGroupEffects({
            y: waiterObs.y,
            target: waiterObs.waiter,
            controls: [waiterObs.table],
          });
          const adjTop = adj?.effects.find((e) => eligible.has(e.group));
          if (adjTop) {
            if (adjTop.group === top.entity)
              attributeReading = `Still #1 after adjusting for which tables they worked.`;
            else survivesTables = false;
          }
        }
        if (survivesTables) {
          const ev: InsightEvidence = {
            entity: top.entity,
            measureLabel: "average check",
            unit: "currency",
            currency: bundle.currency,
            locale: bundle.locale,
            value: top.value,
            rank: 1,
            peerCount: standings.length,
            deltaPct: top.pctVsMean,
            attributeReading,
          };
          push(
            this.record("waiter.avg_check.peer_rank", "staff", "peer", ev, {
              effectPct: top.pctVsMean,
              z: lead.zVsRest,
              n: lead.ranked[0].n,
            }),
          );
        }
      }
    }

    // Basket affinity. Every pair seen on BASKET_MIN_COUNT checks is tested
    // exactly and corrected for the whole family it was picked from; the old
    // pick — top 3 of ~7,000 pairs by lift, then the first with a χ² p under
    // 0.1 — chose the rarest pairs and an approximation invalid on them, and
    // fired on 200 of 200 shuffled copies of Tuzlu's data (A-002, ADR 0272).
    if (transactions.length >= 10) {
      const pairs = E.pairAssociations(transactions, {
        minCount: BASKET_MIN_COUNT,
      });
      const best = pairs
        .filter(
          (p) => p.lift >= BASKET_MIN_LIFT && p.pAdjusted <= SIGNIFICANCE_ALPHA,
        )
        .sort(
          (x, y) =>
            x.pUpper - y.pUpper ||
            y.count - x.count ||
            byCodeUnits(x.a, y.a) ||
            byCodeUnits(x.b, y.b),
        )[0];
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
            z: zOfUpperTail(best.pUpper),
            n: best.count,
          }),
        );
      }
    }

    // Hot tables — live surge detection on OPEN checks (no closed_at).
    const now = Date.now();
    // Only an open check at a table the house shows is watched (ADR 0303):
    // one at a hidden or retired table, or with no table, is no table's
    // surge. The last used to be paced against every table-less check and
    // printed as "A table". And none is watched when the table list could
    // not be read (ADR 0292, 2026-10-07; `tablesUnread` above).
    const open = tablesUnread
      ? []
      : checks.filter(
          (c: any) =>
            !c.closed_at && c.opened_at && shownTableIds.has(c.table_id),
        );
    for (const c of open) {
      const t: any = tableById.get(c.table_id);
      const minutes = (now - new Date(c.opened_at).getTime()) / 60000;
      if (minutes > 240) continue; // stale
      // A table's first bottle rings in early and the rest of the visit
      // slows, so the first minutes always read as a surge against a whole
      // visit's pace (F-1188). Pace is compared only once the table has sat
      // half an hour and rung at least two lines; a check whose lines are
      // not known has not shown two.
      const rings = Array.isArray(c.items) ? c.items.length : 0;
      if (minutes < HOT_TABLE_MIN_MINUTES || rings < HOT_TABLE_MIN_RINGS)
        continue;
      // Pace stays on the till's running total, not net sales (w113-net-
      // readers): a check still open may carry no subtotal yet, and a
      // running net beside closed totals would not compare. Its history
      // below is read on the same total.
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
          currency: bundle.currency,
          locale: bundle.locale,
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
      const baseline =
        g.baseline_value === null || g.baseline_value === undefined
          ? null
          : Number(g.baseline_value);
      const level = LEVEL_GOAL_METRICS.has(g.metric_key);
      // An average check or attach rate with nothing measured yet is stored
      // with no baseline and a 0 the column cannot leave empty. That 0 is
      // "not measured", not "0% of the way" and not behind (F-183): no card.
      if (level && baseline === null && current <= 0) continue;
      const atMost = g.direction === "at_most";
      let daysLeft: number | null = null;
      let onTrack: boolean | null = null;
      // The goals desk's own window and schedule (`goalWindow`,
      // `goalSchedule`): a "this month" goal is paced from the month's first
      // house day, as the stored `current_value` counts it, not from the day
      // it was created, and through the whole deadline day (F-864, F-865).
      // With no zone the desk computes no pace, and neither does this card.
      if (g.deadline && bundle.zone) {
        const win = goalWindow(g, bundle.zone);
        const schedule = goalSchedule(
          { ...win, deadlineDay: win.deadlineDay! },
          bundle.zone,
        );
        daysLeft = schedule.daysLeft;
        // The goals desk's own line (`getGoalProgress`): a level ramps from
        // its baseline, a total from nothing, and a "keep at most" goal is
        // on pace while it stays under the line, not over it (F-383).
        onTrack = goalPaceHolds(
          g.direction,
          current,
          goalExpectedByNow(
            g.metric_key,
            target,
            baseline,
            schedule.elapsedDays / schedule.totalDays,
          ),
        );
      }
      // "X% of the way" only means something for a running total chased
      // upward; a level or a ceiling is said by its pace alone.
      const share = current / target;
      const ev: InsightEvidence = {
        measureLabel: g.metric_key,
        unit: "ratio",
        goalName: g.name,
        goalProgressPct: atMost || level ? undefined : share,
        goalDaysLeft: daysLeft ?? undefined,
        goalOnTrack: onTrack ?? undefined,
      };
      if (ev.goalProgressPct === undefined && ev.goalOnTrack === undefined)
        continue;
      push(
        this.record("overall.revenue.goal_pace", "goals", "goal", ev, {
          // How far past (or short of) the line the goal stands, by its own
          // direction: under a ceiling is ahead, over it is behind.
          effectPct: atMost
            ? current > 0
              ? target / current - 1
              : 0
            : share - 1,
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
    /** Which days are evidence. Missing = every day is (legacy callers). */
    observed?: boolean[];
    measure: string;
    measureLabel: string;
    unit: InsightEvidence["unit"];
    /** The house's currency for a `currency` unit (F-341). */
    currency?: string | null;
    /** The house's formats tag for that figure (F-866). */
    locale?: string | null;
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
      currency,
      locale,
      dimension,
      category,
    } = params;
    const observed = params.observed ?? values.map(() => true);
    const nonZeroDays = values.filter((v) => v > 0).length;
    if (nonZeroDays < 7) return;

    // 1. Latest complete day vs same-weekday history.
    //
    // "Latest" means the latest day this restaurant actually filed something
    // for. Taking the last index unconditionally is what produced the sentence
    // the founder quoted: with no records for yesterday, `values[lastIdx]` is
    // 0, `deltaPct` is -1, and the template renders a 100% collapse from an
    // absence. When the day compared is NOT the newest day in the series, the
    // sentence carries its date, so a skipped-back comparison can never be
    // mistaken for one about yesterday.
    const lastIdx = values.length - 1;
    let dayIdx = lastIdx;
    while (dayIdx >= 0 && !observed[dayIdx]) dayIdx--;
    if (dayIdx >= 0) {
      const lastDate = dates[dayIdx];
      const weekday = new Date(`${lastDate}T00:00:00Z`).getUTCDay();
      const history: number[] = [];
      for (let i = 0; i < dayIdx; i++) {
        // Same weekday AND a day with records. A history of five Wednesdays,
        // three of them closures, is a history of two — and two Wednesdays are
        // not "your average Wednesday".
        if (!observed[i]) continue;
        if (new Date(`${dates[i]}T00:00:00Z`).getUTCDay() === weekday)
          history.push(values[i]);
      }
      if (history.length >= MIN_BASELINE_N) {
        const cmp = E.groupBaseline(values[dayIdx], history);
        // `deltaPct === null` means the baseline mean was 0 — a ratio against
        // nothing. `groupBaseline` reports that as `in_line` and the verbalizer
        // refuses it a second time; both are deliberate and both are asserted
        // in `baseline-honesty.spec.ts`.
        if (cmp && cmp.direction !== "in_line" && cmp.deltaPct !== null) {
          const ev: InsightEvidence = {
            entity: E.WEEKDAY_NAMES[weekday],
            measureLabel,
            unit,
            currency,
            locale,
            value: cmp.value,
            baseline: cmp.baselineMean,
            deltaPct: cmp.deltaPct,
            direction: cmp.direction,
            n: history.length,
            date: dayIdx === lastIdx ? undefined : lastDate,
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
                subject: E.WEEKDAY_NAMES[weekday],
                periodKey: dayGrain(lastDate),
              },
            ),
          );
        }
      }
    }

    // 2. Period over period — only between comparable windows.
    const window = params.periodWindow ?? 7;
    let cmp: E.PeriodComparison | null = null;
    let openDays: number | undefined;
    if (window % 7 === 0) {
      // Whole weeks: like for like, weekday against weekday (F-707).
      const m = E.matchedPeriodOverPeriod(values, observed, window);
      if (m && m.matchedDays >= MIN_PERIOD_OBSERVED) {
        cmp = m;
        if (m.matchedDays < window) openDays = m.matchedDays;
      }
    } else {
      const obsIn = (from: number, to: number) =>
        observed.slice(from, to).filter(Boolean).length;
      const curObs = obsIn(values.length - window, values.length);
      const prevObs = obsIn(values.length - 2 * window, values.length - window);
      const comparable =
        curObs >= MIN_PERIOD_OBSERVED &&
        prevObs >= MIN_PERIOD_OBSERVED &&
        Math.abs(curObs - prevObs) <= MAX_PERIOD_OBSERVED_GAP;
      cmp = comparable
        ? E.periodOverPeriod(
            values.map((v, i) => (observed[i] ? v : 0)),
            window,
          )
        : null;
    }
    if (cmp && cmp.deltaPct !== null && cmp.direction !== "flat") {
      const ev: InsightEvidence = {
        measureLabel,
        unit,
        currency,
        locale,
        value: cmp.current,
        baseline: cmp.previous,
        deltaPct: cmp.deltaPct,
        windowLabel: params.windowLabel ?? "week",
        openDays,
      };
      push(
        this.record(
          `${dimension}.${measure}.vs_prev_period_${window}d`,
          category,
          "period",
          ev,
          {
            effectPct: cmp.deltaPct,
            n: (openDays ?? window) * 2,
            periodKey: windowGrain(window, dates[values.length - 1]),
          },
        ),
      );
    }

    // 3. Trend (last 28 days, weekly slope as % of level) — over real days.
    //    Each open day keeps its calendar position (F-708), so the slope is
    //    per calendar day and `* 7` is per week, not per seven open days; the
    //    level it is a share of is the mean of an open day. The slope is
    //    fitted within each weekday (F-1187): a plain line through a week with
    //    a busy weekend tilts by which weekday the window happens to end on,
    //    and printed a trend on flat sales.
    const recent = values.slice(-28);
    const recentDates = dates.slice(-28);
    const recentObs = observed.slice(-28);
    const trendSeries = recent.filter((_, i) => recentObs[i]);
    const trendAt = recent.flatMap((_, i) => (recentObs[i] ? [i] : []));
    const trendWeekday = trendAt.map((i) =>
      new Date(`${recentDates[i]}T00:00:00Z`).getUTCDay(),
    );
    const trend =
      trendSeries.length >= MIN_TREND_OBSERVED
        ? E.seasonalTrendPerPeriodPct(trendSeries, trendAt, trendWeekday)
        : null;
    if (trend !== null && Math.abs(trend * 7) >= 0.05) {
      const ev: InsightEvidence = {
        measureLabel,
        unit,
        currency,
        locale,
        trendPctPerWeek: trend * 7,
        n: trendSeries.length,
        spanDays: recent.length,
      };
      push(
        this.record(
          `${dimension}.${measure}.trend_direction`,
          category,
          "trend",
          ev,
          {
            effectPct: trend * 7,
            n: trendSeries.length,
            periodKey: trendGrain(28, dates[values.length - 1]),
          },
        ),
      );
    }

    // 4. Anomaly scan over the last 14 days (robust z vs the 90-day window).
    //    A day with no records is neither a candidate nor part of the
    //    comparison set: "the 27th was 5σ below typical" about a closure is the
    //    same lie as the 100% one, told with a Greek letter. A day is scored
    //    against its own weekday only, as the baseline card above is (F-1186):
    //    against every day, an ordinary Friday read as unusual.
    const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
    for (let i = Math.max(0, values.length - 14); i < values.length; i++) {
      if (!observed[i]) continue;
      const wd = weekdayOf(dates[i]);
      const rest = values.filter(
        (_, j) => j !== i && observed[j] && weekdayOf(dates[j]) === wd,
      );
      if (rest.length < MIN_BASELINE_N) continue;
      const z = E.robustZScore(values[i], rest);
      if (z !== null && Math.abs(z) >= 3) {
        const ev: InsightEvidence = {
          measureLabel,
          unit,
          currency,
          locale,
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
              periodKey: dayGrain(dates[i]),
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
      /** What the sentence is ABOUT, for the suppression key. */
      subject?: string | null;
      /** The period it covers, at its grain ("d:2026-09-02"). */
      periodKey?: string | null;
    },
  ): InsightRecord | null {
    const sentence = verbalize(template, evidence);
    if (!sentence) return null;
    const subject =
      scoreParams.subject ?? scoreParams.entityLabel ?? evidence.entity ?? null;
    // A type that names no subject and no period is keyed by the week it
    // fired in, on the house's clock — `keyOnFiring`, applied as each
    // record is pushed in `generate()`.
    const target = {
      ruleId: insightRuleId(candidateKey),
      subject,
      periodKey: scoreParams.periodKey ?? null,
    };
    const periodKey = target.periodKey;
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
      subject,
      periodKey,
      // The three keys a dismissal could be written under, computed once, at
      // the only place that knows what this insight is about. The UI never
      // builds a key: one definition of "the same insight", server-side.
      suppression: {
        key: buildSuppressionKey(target, "insight"),
        scope: effectiveScope(target, "insight"),
        keys: suppressionKeys(target),
      },
      periodStart: null,
      periodEnd: null,
    };
  }
}

// ---------------------------------------------------------------------------

type Push = (r: InsightRecord | null) => void;

/**
 * "Each firing is one card" (ADR 0191 round 3, founder 2026-09-21): a type
 * that names no subject and no period is keyed by the week it fired in — the
 * founder's own example of a firing period, and the grain the catalogue's
 * types carry no other horizon for. A one-item dismiss or done then hides
 * this firing, not the whole type (which is the catalogue's On/Off), and the
 * item returns when it fires next week. The week is the house's when its
 * zone is known (F-796); with none it is UTC's. A record that names a
 * subject or a period is returned as it is.
 */
export function keyOnFiring(
  r: InsightRecord,
  at: Date,
  zone: string | null,
): InsightRecord {
  const own = {
    ruleId: insightRuleId(r.candidateKey),
    subject: r.subject,
    periodKey: r.periodKey,
  };
  const target = withFiring(own, "week", at, zone);
  if (target === own) return r;
  return {
    ...r,
    periodKey: target.periodKey ?? null,
    suppression: {
      key: buildSuppressionKey(target, "insight"),
      scope: effectiveScope(target, "insight"),
      keys: suppressionKeys(target),
    },
  };
}

/** The record with the bottle basis of the lines it rests on (ADR 0297). */
function withUnits(
  r: InsightRecord | null,
  units: UnitsLabel,
): InsightRecord | null {
  return r && { ...r, evidence: { ...r.evidence, units } };
}

/** Each group's count, mean and variance of check totals, for leaderTest. */
function momentsOf(
  groups: Map<string, { revenue: number; sumSq: number; checks: number }>,
): E.GroupMoments<string>[] {
  return Array.from(groups.entries()).map(([entity, g]) =>
    E.momentsFromSums(entity, g.checks, g.revenue, g.sumSq),
  );
}

/** Plain code-unit order: deterministic, whatever the server's locale. */
const byCodeUnits = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * The z whose upper tail is p — the significance the score weighs for an
 * exact test that has no z of its own. Capped: past 8σ the score's own cap
 * (3σ) has long since applied, and an exact p can underflow to 0.
 */
function zOfUpperTail(p: number): number {
  const Z_CAP = 8;
  if (!(p > 0)) return Z_CAP;
  const z = E.normalInv(Math.min(p, 0.5));
  return z === null ? Z_CAP : Math.min(Z_CAP, -z);
}

/**
 * The fewest ranked tables an attribute must be recorded on before the table
 * driver fit may use it, and the fewest tables that fit runs over: the room
 * register's number (`getTablePerformance`, ADR 0303).
 */
export const DRIVER_MIN_RECORDED = 5;

/**
 * The share of the variation in average check a table driver fit must
 * explain, strictly, before its sentence prints: the r² > 0.15 gate the
 * sentence had before the F-test, kept beside it as its effect floor by the
 * founder's second ruling of 2026-10-07 (ADR 0303), as ADR 0272 keeps
 * |r| ≥ 0.35 beside its correlation test.
 */
export const DRIVER_MIN_R2 = 0.15;

/**
 * How far apart, relative to the largest |average|, the fitted tables'
 * average checks must be before they count as varying. Each average is a sum
 * of check totals over a count, so averages equal to the cent can differ in
 * the last binary digits: 180.10 + 180.20 + 180.30 averages to
 * 180.19999999999996, and 180.00 + 180.10 + 180.50 to 180.20000000000002.
 * Compared exactly, that rounding was fitted and printed a "driver" (the
 * spec's eight-table case). A double carries about 16 significant digits,
 * so 1e-9 sits well above that rounding on a sum of a few thousand positive
 * totals, and still counts a one-cent spread as varying on any average
 * under 1,000,000.
 */
export const DRIVER_AVERAGES_REL_TOL = 1e-9;

/**
 * Does the table driver sentence print, for a fit of `k` attributes with
 * r² `r2` over tables whose average checks are `averages`? Only when all of:
 *
 *  - the averages vary (by DRIVER_AVERAGES_REL_TOL). Equal averages leave
 *    nothing to drive: multipleRegression calls their r² 1, and it is no fit;
 *  - the fit leaves a residual degree of freedom (n − k − 1 ≥ 1, n the
 *    number of averages), so there is a test to make;
 *  - its overall F-test passes at SIGNIFICANCE_ALPHA, ADR 0272's bar (the
 *    founder's first ruling of 2026-10-07; r² alone was no test, and five
 *    tables on four attributes fit almost exactly by chance);
 *  - r² is above DRIVER_MIN_R2 (his second ruling: real AND big enough).
 *
 * `r2` is the ridge fit's. A penalised fit never explains more than least
 * squares on the same rows, so its p is never the smaller one. Under the
 * F-test's assumptions (independent, normally distributed errors of equal
 * variance), a sentence on a fit with no real driver therefore prints at a
 * rate at or under alpha; the r² floor and the equal-averages check only
 * remove prints. Those assumptions are not checked here (ADR 0303, *Ruling
 * 2026-10-07*, residual 5).
 */
export function driverSentencePrints(
  r2: number,
  averages: number[],
  k: number,
): boolean {
  if (averages.length === 0) return false;
  let lo = Infinity;
  let hi = -Infinity;
  let scale = 0;
  for (const v of averages) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    scale = Math.max(scale, Math.abs(v));
  }
  if (!(hi - lo > DRIVER_AVERAGES_REL_TOL * scale)) return false;
  const test = E.regressionSignificance(r2, averages.length, k);
  return test !== null && test.p <= SIGNIFICANCE_ALPHA && r2 > DRIVER_MIN_R2;
}

/** A recorded number, or NaN: `Number(null)` is 0, a measurement nobody took. */
function recordedNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** The table attributes the driver fit may weigh; NaN where none was recorded. */
const TABLE_DRIVERS: Array<{ name: string; of: (t: any) => number }> = [
  {
    name: "kitchen distance",
    of: (t) => recordedNumber(t.distance_to_kitchen_m),
  },
  { name: "bar distance", of: (t) => recordedNumber(t.distance_to_bar_m) },
  { name: "seats", of: (t) => recordedNumber(t.seats) },
  {
    name: "outdoor",
    of: (t) =>
      typeof t.is_outdoor === "boolean" ? (t.is_outdoor ? 1 : 0) : NaN,
  },
];

export interface InsightRecord {
  candidateKey: string;
  category: InsightCategory;
  sentence: string;
  score: number;
  effectPct: number | null;
  z: number | null;
  entityKey: string | null;
  entityLabel: string | null;
  /**
   * `units` is set on every figure built on consumption lines: its bottle
   * basis, with the counts of the lines and items resting on the 750 ml
   * stand-in (ADR 0297). It rides in `evidence`, so a stored row carries it
   * too.
   */
  evidence: InsightEvidence & { units?: UnitsLabel };
  /** What the sentence is about ("Wednesday", "Table 4"), or null. */
  subject: string | null;
  /** The period it covers at its own grain ("d:2026-09-02"), or null. */
  periodKey: string | null;
  /**
   * How to silence this, and how wide that silence really is. Built here
   * because this is the only place that knows the subject and the period; the
   * web never constructs a key.
   */
  suppression: {
    key: string;
    scope: SuppressionScope;
    keys: Record<SuppressionScope, string>;
  };
  periodStart: string | null;
  periodEnd: string | null;
}

interface Bundle {
  restaurantId: string;
  /**
   * `qty` is bottles; null when the line carries no bottle figure. `how` is
   * where that figure came from and `itemId` the inventory row, so a figure
   * can say how many lines and items rest on the 750 ml stand-in (ADR 0297).
   */
  consumption: Array<{
    wineId: string;
    itemId: string | null;
    qty: number | null;
    how: BottleHow;
    date: string;
  }>;
  orders: Array<{
    vendorId: string;
    vendorName: string;
    /** Null when the order carries no price (F-701). */
    cost: number | null;
    /** The code the order was paid in; null when it names none (F-1015). */
    currency?: string | null;
    date: string;
  }>;
  inventory: any[];
  /**
   * Bottles ordered and not yet here, by inventory row; a row's null is an
   * order with no bottle count, and the whole map is null when the read
   * failed (F-1192).
   */
  onOrder: Map<string, number | null> | null;
  checks: any[];
  tables: any[];
  venueFeatures: Record<string, unknown> | null;
  goals: any[];
  availability: Set<DataRequirement>;
  /** Business dates the manager ruled out of every baseline. */
  excludedDates: Set<string>;
  /** False when that list could not be read — never the same as "empty". */
  exclusionsReadable: boolean;
  /**
   * The reads above that were refused or failed, in `BUNDLE_READ_WORDS`'
   * words. Their slices hold `[]`, which is NOT a house with no rows: an
   * insight that takes a name from one of them, other than its own family's
   * slice, asks `readWasRefused` first.
   */
  unread: string[];
  /** `restaurants.currency`; null when not recorded or not readable (F-341). */
  currency: string | null;
  /** The house's formats tag (`houseFrame().locale`); null keeps en-US (F-866). */
  locale: string | null;
  /** The house's IANA zone; every `date` above is a day on its clock (ADR 0296). */
  zone: string | null;
}
