import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SimposService } from "./simpos.service";
import { GoalsService } from "../analytics/goals.service";
import { TableAnalyticsService } from "../analytics/table-analytics.service";
import { InsightGeneratorService } from "../analytics/insights/insight-generator.service";
import { LowStockAlertsService } from "../notifications/low-stock-alerts.service";
import {
  isOpenAt,
  parseOperatingHours,
  serviceWindows,
} from "../common/operating-hours/operating-hours";
import {
  EXPECTATION_CONTRACT_VERSION,
  type ExpectedCheck,
  type ExpectedLine,
  type ReadRecord,
  type ScenarioExpectation,
  type ScenarioRunRow,
  type ScenarioVerifyResult,
  type VerifyCheckRow,
  type VerifyStatus,
} from "./scenario-types";

/**
 * ScenarioVerifyService — the scenario harness's verdict (ADR 0093 D2).
 *
 * A run posted by `scripts/simulate scenario …` carries its own expectation in
 * `sim_scenario_runs.expected`. This service reads what the PRODUCT actually
 * did — `pos_checks`, `inventory_transactions`, `pour_events`,
 * `inventory_lots`, `restaurant_inventory`, `wine_consumption_log`,
 * `pos_unresolved_lines`, `notifications`, `analytics_insights` and the two
 * analytics services — and compares the two, one row per named check.
 *
 * THREE RULES, and they are the whole point of the file:
 *
 *  1. **A failed read is never an empty one** (ADR 0067). Every `.from()` here
 *     destructures `error`, records the read in `reads[]`, and turns every
 *     check that depended on it into `unverifiable` with the error text in
 *     `detail`. A read that failed must never reach a comparison as `[]`.
 *  2. **An unknown renders as unknown** (ADR 0020). `unverifiable` is a third
 *     outcome, not a soft pass and not a soft fail. An empty expectation is
 *     `unverifiable`; a missing operating-hours answer is `unverifiable`; a
 *     dropped webhook is `unverifiable` because no detector exists (S09 §9).
 *  3. **Nothing is windowed silently.** No `.limit()` is issued here. Where a
 *     downstream service imposes its own window (table performance is a
 *     rolling `sinceDays` aggregate), the comparison is stated as a FLOOR and
 *     `detail` says so.
 */
@Injectable()
export class ScenarioVerifyService {
  private readonly logger = new Logger(ScenarioVerifyService.name);

  /**
   * PostgREST caps a response server-side (`db-max-rows`, 1000 by default).
   * We never ask for more than a run's own ids, but a response that lands
   * exactly on the cap is reported rather than trusted.
   */
  private static readonly POSTGREST_MAX_ROWS = 1000;

  /** `.in(...)` goes in the URL; chunk it so a long run cannot 414. */
  private static readonly IN_CHUNK = 100;

  /**
   * Every check this verifier can emit, and the sentence a founder reads.
   * Kept in one place so the "cannot verify anything" path can enumerate the
   * same ids rather than silently emitting a shorter table.
   */
  private static readonly TITLES: Record<string, string> = {
    "checks.landed": "Every posted check reached pos_checks",
    "checks.fields": "Each landed check carries the fields it was posted with",
    "checks.tables_resolved": "Each check with a table resolved to that table",
    "lines.wine_resolved": "Wine lines resolved to stock; food lines did not",
    "stock.bottle_transactions":
      "One bottle sale, one inventory transaction, exactly",
    "stock.pours": "One glass sale, one pour event, for the right millilitres",
    "stock.dedupe": "A duplicate webhook moved stock once, not twice",
    "stock.projection": "stock_live matches the lots it is projected from",
    "voids.returned": "A voided line returned its stock",
    "consumption.mirror":
      "Every depleting sale mirrored into the demand series",
    "unresolved.queued": "Unresolvable lines were queued, not dropped",
    "low_stock.notified": "Crossing par raised a notification",
    "low_stock.emailed": "That notification records whether the email left",
    "insights.generated":
      "The insight generator produced something about this day",
    "analytics.pos_revenue": "POS revenue for the service date matches",
    "analytics.tables": "Table performance sees this day's tables",
    "hours.outside": "Out-of-hours checks counted as expected",
    "hours.closed_day": "A closed day produced no checks",
    "webhook.dropped": "A dropped webhook — what the product can say about it",
    "webhook.duplicate": "A duplicate webhook produced one check row",
  };

  constructor(
    private readonly dbService: DatabaseService,
    private readonly simpos: SimposService,
    private readonly goals: GoalsService,
    private readonly tableAnalytics: TableAnalyticsService,
    private readonly insights: InsightGeneratorService,
    private readonly lowStockAlerts: LowStockAlertsService,
  ) {}

  // =========================================================================
  // Runs
  // =========================================================================

  /**
   * Newest runs for a sim restaurant. The cap is RETURNED, not hidden: the
   * page renders "showing N of ≥50" when it is hit, because a page of 50 is a
   * floor and printing it as a total is the defect
   * `scripts/check_windowed_figures.py` exists for.
   */
  async listRuns(
    restaurantId: string,
    cap = 50,
  ): Promise<{
    runs: Array<{
      id: string;
      scenario: string | null;
      seed: number | null;
      service_date: string | null;
      timezone: string | null;
      posted_at: string | null;
      created_at: string | null;
      totals: ScenarioExpectation["totals"] | null;
      scenarios: ScenarioExpectation["scenarios"] | null;
    }>;
    cap: number;
    capped: boolean;
  }> {
    await this.simpos.assertSimRestaurant(restaurantId);
    const { data, error } = await this.dbService
      .getClient()
      .from("sim_scenario_runs")
      .select(
        "id, scenario, seed, service_date, timezone, posted_at, created_at, expected",
      )
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(cap);
    // ADR 0067: a failed read is not "no runs". The caller gets a 500 and the
    // page renders the message, which is the only honest empty state here.
    if (error) {
      throw new Error(`sim_scenario_runs read failed: ${error.message}`);
    }
    const rows = data ?? [];
    return {
      runs: rows.map((r: any) => ({
        id: r.id,
        scenario: r.scenario ?? null,
        seed: r.seed ?? null,
        service_date: r.service_date ?? null,
        timezone: r.timezone ?? null,
        posted_at: r.posted_at ?? null,
        created_at: r.created_at ?? null,
        totals: (r.expected as ScenarioExpectation | null)?.totals ?? null,
        scenarios:
          (r.expected as ScenarioExpectation | null)?.scenarios ?? null,
      })),
      cap,
      capped: rows.length >= cap,
    };
  }

  async getRun(restaurantId: string, runId: string): Promise<ScenarioRunRow> {
    await this.simpos.assertSimRestaurant(restaurantId);
    return this.loadRun(restaurantId, runId);
  }

  private async loadRun(
    restaurantId: string,
    runId: string,
  ): Promise<ScenarioRunRow> {
    const { data, error } = await this.dbService
      .getClient()
      .from("sim_scenario_runs")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", runId)
      .maybeSingle();
    // `maybeSingle()` returns `data: null` for BOTH "no row" and "the query
    // failed". Separating them is the difference between a 404 and a 500, and
    // reporting a failure as a 404 is exactly the shape ADR 0067 names.
    if (error) {
      throw new Error(`sim_scenario_runs read failed: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(
        `Scenario run '${runId}' not found for restaurant '${restaurantId}'`,
      );
    }
    return data as ScenarioRunRow;
  }

  // =========================================================================
  // The two user-side levers
  // =========================================================================

  /**
   * Run the low-stock edge sweep NOW rather than waiting for its 2-minute
   * cron, then report what landed for this run. The notification rows come
   * back with `delivery_status` so "emailed" is a fact on the row (ADR 0093
   * D5), not an inference from a log line nobody can query.
   */
  async runSweep(restaurantId: string, runId: string) {
    await this.simpos.assertSimRestaurant(restaurantId);
    const run = await this.loadRun(restaurantId, runId);
    await this.lowStockAlerts.triggerEdgeSweep();
    const sweptAt = new Date().toISOString();

    const since = run.posted_at ?? run.created_at ?? new Date(0).toISOString();
    const { data, error } = await this.dbService
      .getClient()
      .from("notifications")
      .select(
        "id, type, title, message, priority, created_at, delivery_status, metadata",
      )
      .eq("restaurant_id", restaurantId)
      .eq("type", "inventory_low_stock")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(
        `Sweep ran, but the notifications read failed: ${error.message}`,
      );
    }
    return { swept_at: sweptAt, since, notifications: data ?? [] };
  }

  /** Generate + persist insights now rather than waiting for the hourly sweep. */
  async generateInsights(restaurantId: string) {
    await this.simpos.assertSimRestaurant(restaurantId);
    const result = await this.insights.generate(restaurantId, {
      persist: true,
    });
    return {
      generated_at: result.generatedAt,
      count: result.insights.length,
      availability: result.availability,
      // UPPER BOUND on types with the DATA to fire, not a promise that many
      // will — the distinction insight-generator.service.ts documents at
      // length and this surface must not quietly flatten.
      candidateTypesAvailable: result.candidateTypesAvailable,
      candidateTypesTotal: result.candidateTypesTotal,
      sample: result.insights.slice(0, 5).map((i: any) => i.sentence),
    };
  }
  // =========================================================================
  // Verify (ADR 0093 D2)
  // =========================================================================

  async verify(
    restaurantId: string,
    runId: string,
  ): Promise<ScenarioVerifyResult> {
    await this.simpos.assertSimRestaurant(restaurantId);
    const reads: ReadRecord[] = [];
    const run = await this.loadRun(restaurantId, runId);
    const verifiedAt = new Date().toISOString();
    const exp: ScenarioExpectation = (run.expected ??
      {}) as ScenarioExpectation;

    // A shape this build does not understand is compared against NOTHING —
    // silently reading v2 with a v1 reader is how a verifier starts lying.
    if (
      exp.contract_version !== undefined &&
      exp.contract_version !== EXPECTATION_CONTRACT_VERSION
    ) {
      return this.assemble(
        run,
        verifiedAt,
        this.everyCheckUnverifiable(
          `expectation contract_version ${exp.contract_version}; this build reads version ${EXPECTATION_CONTRACT_VERSION} only, so nothing was compared`,
        ),
        reads,
      );
    }
    if (!run.expected) {
      return this.assemble(
        run,
        verifiedAt,
        this.everyCheckUnverifiable(
          "this run carries no expectation (sim_scenario_runs.expected is null) — there is nothing to compare against",
        ),
        reads,
      );
    }

    const rows: VerifyCheckRow[] = [];
    const push = (
      id: string,
      status: VerifyStatus,
      expected: unknown,
      actual: unknown,
      detail: string,
      samples?: unknown[],
    ) => {
      rows.push({
        id,
        title: ScenarioVerifyService.TITLES[id] ?? id,
        status,
        expected,
        actual,
        detail,
        ...(samples && samples.length ? { samples: samples.slice(0, 8) } : {}),
      });
    };

    const source = exp.source ?? "generic_webhook";
    const expChecks = exp.checks ?? [];
    const droppedIds = exp.dropped_check_ids ?? [];
    const dropped = new Set(droppedIds);
    const duplicateIds = exp.duplicate_check_ids ?? [];
    const allIds = [...new Set(expChecks.map((c) => c.external_check_id))];
    const expectedToLand = expChecks.filter(
      (c) => c.posted !== false && !dropped.has(c.external_check_id),
    );
    const NOTHING = "nothing to compare — this run's expectation has no checks";
    const emptyRun = expChecks.length === 0;

    // ---- reads ------------------------------------------------------------
    const posChecks = await this.readIn<any>(
      "pos_checks",
      reads,
      allIds,
      (c, chunk) =>
        c
          .from("pos_checks")
          .select(
            "external_check_id, table_id, server_name, opened_at, closed_at, covers, subtotal, total, tip, voided, items",
          )
          .eq("restaurant_id", restaurantId)
          .eq("source", source)
          .in("external_check_id", chunk),
    );
    const landed = new Map<string, any>();
    if (posChecks.ok) {
      for (const r of posChecks.rows) landed.set(r.external_check_id, r);
    }

    const keyOf = (chk: ExpectedCheck, line: ExpectedLine) =>
      line.idempotency_key ??
      `pos:${source}:${chk.external_check_id}:${line.external_item_id ?? line.name}:${line.line_no}`;

    type Pair = { chk: ExpectedCheck; line: ExpectedLine; key: string };
    const pairs: Pair[] = [];
    for (const chk of expectedToLand) {
      for (const line of chk.lines ?? []) {
        pairs.push({ chk, line, key: keyOf(chk, line) });
      }
    }
    const bottleLines = pairs.filter((p) => p.line.expect === "bottle");
    const volumeLines = pairs.filter((p) => p.line.expect === "volume");
    const voidLines = pairs.filter((p) => p.line.expect === "void_return");
    const unresolvedLines = pairs.filter((p) =>
      p.line.expect.startsWith("unresolved"),
    );
    const depleting = [...bottleLines, ...volumeLines];

    // A void's stock movement uses a key DISTINCT from the sale's (ADR 0093
    // D5 — `apply_stock_movement` returns early on a key it has already seen,
    // so reusing the sale's key moved nothing). Both are read so a pre-fix
    // deployment reports the defect rather than an absence.
    const txKeys = [
      ...new Set([
        ...bottleLines.map((p) => p.key),
        ...voidLines.flatMap((p) => [p.key, `${p.key}:void`]),
      ]),
    ];
    const pourKeys = [...new Set(volumeLines.map((p) => p.key))];
    const consumptionKeys = [...new Set(depleting.map((p) => p.key))];

    const txns = await this.readIn<any>(
      "inventory_transactions",
      reads,
      txKeys,
      (c, chunk) =>
        c
          .from("inventory_transactions")
          .select(
            "id, inventory_id, transaction_type, source, quantity_change, quantity_before, quantity_after, idempotency_key, created_at",
          )
          .eq("restaurant_id", restaurantId)
          .in("idempotency_key", chunk),
    );
    const pours = await this.readIn<any>(
      "pour_events",
      reads,
      pourKeys,
      (c, chunk) =>
        c
          .from("pour_events")
          .select("id, inventory_id, pours, pour_ml, idempotency_key, source")
          .eq("restaurant_id", restaurantId)
          .in("idempotency_key", chunk),
    );
    const consumption = await this.readIn<any>(
      "wine_consumption_log",
      reads,
      consumptionKeys,
      (c, chunk) =>
        c
          .from("wine_consumption_log")
          .select(
            "id, inventory_id, wine_name, consumption_type, quantity, volume_ml, unit_price, notes, source",
          )
          .eq("restaurant_id", restaurantId)
          .in("notes", chunk),
    );
    const unresolvedRows = await this.readIn<any>(
      "pos_unresolved_lines",
      reads,
      allIds,
      (c, chunk) =>
        c
          .from("pos_unresolved_lines")
          .select("id, external_check_id, external_item_id, item_name, reason")
          .eq("restaurant_id", restaurantId)
          .eq("source", source)
          .in("external_check_id", chunk),
    );
    const tables = await this.readRows<any>("restaurant_tables", reads, (c) =>
      c
        .from("restaurant_tables")
        .select("id, label, seats, is_active")
        .eq("restaurant_id", restaurantId),
    );

    const depletion = exp.depletion ?? [];
    const depletionIds = [...new Set(depletion.map((d) => d.inventory_id))];
    const inventory = await this.readIn<any>(
      "restaurant_inventory",
      reads,
      depletionIds,
      (c, chunk) =>
        c
          .from("restaurant_inventory")
          .select("id, wine_name, stock_live, threshold_min")
          .eq("restaurant_id", restaurantId)
          .in("id", chunk),
    );
    const lots = await this.readIn<any>(
      "inventory_lots",
      reads,
      depletionIds,
      (c, chunk) =>
        c
          .from("inventory_lots")
          .select("inventory_id, qty, stock_state")
          .eq("restaurant_id", restaurantId)
          .eq("stock_state", "live")
          .in("inventory_id", chunk),
    );

    const postedAt = run.posted_at;
    const notifications = postedAt
      ? await this.readRows<any>("notifications", reads, (c) =>
          c
            .from("notifications")
            .select("id, created_at, metadata, delivery_status, title")
            .eq("restaurant_id", restaurantId)
            .eq("type", "inventory_low_stock")
            .gte("created_at", postedAt),
        )
      : ({ ok: false, error: "run has no posted_at" } as const);
    const insightRows = postedAt
      ? await this.readRows<any>("analytics_insights", reads, (c) =>
          c
            .from("analytics_insights")
            .select(
              "candidate_key, entity_key, entity_label, sentence, evidence, computed_at",
            )
            .eq("restaurant_id", restaurantId)
            .gte("computed_at", postedAt),
        )
      : ({ ok: false, error: "run has no posted_at" } as const);

    // ---- checks.landed ----------------------------------------------------
    if (!posChecks.ok) {
      push(
        "checks.landed",
        "unverifiable",
        expectedToLand.length,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else if (emptyRun) {
      push("checks.landed", "unverifiable", 0, landed.size, NOTHING);
    } else {
      const missing = expectedToLand
        .map((c) => c.external_check_id)
        .filter((id) => !landed.has(id));
      push(
        "checks.landed",
        missing.length === 0 ? "pass" : "fail",
        expectedToLand.length,
        expectedToLand.length - missing.length,
        missing.length === 0
          ? `all ${expectedToLand.length} posted check(s) present in pos_checks (source '${source}'); ${droppedIds.length} deliberately dropped id(s) excluded`
          : `${missing.length} posted check(s) never reached pos_checks`,
        missing,
      );
    }

    // ---- checks.fields ----------------------------------------------------
    if (!posChecks.ok) {
      push(
        "checks.fields",
        "unverifiable",
        null,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else if (emptyRun) {
      push("checks.fields", "unverifiable", 0, 0, NOTHING);
    } else {
      const problems: string[] = [];
      let compared = 0;
      for (const c of expectedToLand) {
        const a = landed.get(c.external_check_id);
        if (!a) continue; // absence is checks.landed's verdict, not this one's
        compared++;
        const id = c.external_check_id;
        if (!sameInstant(c.closed_at ?? null, a.closed_at ?? null)) {
          problems.push(`${id}: closed_at ${a.closed_at} ≠ ${c.closed_at}`);
        }
        if ((c.covers ?? null) !== (a.covers ?? null)) {
          problems.push(`${id}: covers ${a.covers} ≠ ${c.covers}`);
        }
        if (!within(c.total ?? null, a.total ?? null, 0.01)) {
          problems.push(`${id}: total ${a.total} ≠ ${c.total}`);
        }
        if ((c.voided ?? false) !== (a.voided === true)) {
          problems.push(`${id}: voided ${a.voided} ≠ ${c.voided ?? false}`);
        }
        const items = Array.isArray(a.items) ? a.items : [];
        if (items.length !== (c.lines ?? []).length) {
          problems.push(
            `${id}: ${items.length} item(s) stored, ${(c.lines ?? []).length} expected`,
          );
        }
      }
      push(
        "checks.fields",
        compared === 0
          ? "unverifiable"
          : problems.length === 0
            ? "pass"
            : "fail",
        `${expectedToLand.length} check(s) × (closed_at, covers, total ±0.01, voided, item count)`,
        `${compared} compared, ${problems.length} mismatch(es)`,
        compared === 0
          ? "no expected check landed, so no field could be compared"
          : problems.length === 0
            ? `every field matched on all ${compared} landed check(s)`
            : `${problems.length} field mismatch(es)`,
        problems,
      );
    }

    // ---- checks.tables_resolved ------------------------------------------
    const withLabel = expectedToLand.filter(
      (c) => c.table_label != null && c.table_label !== "",
    );
    if (!posChecks.ok || !tables.ok) {
      push(
        "checks.tables_resolved",
        "unverifiable",
        withLabel.length,
        null,
        !posChecks.ok
          ? `pos_checks could not be read: ${posChecks.error}`
          : `restaurant_tables could not be read: ${(tables as any).error}`,
      );
    } else if (withLabel.length === 0) {
      push(
        "checks.tables_resolved",
        "unverifiable",
        0,
        0,
        emptyRun ? NOTHING : "no expected check carries a table_label",
      );
    } else {
      const byId = new Map(tables.rows.map((t: any) => [t.id, t]));
      const problems: string[] = [];
      let resolved = 0;
      for (const c of withLabel) {
        const a = landed.get(c.external_check_id);
        if (!a) continue;
        if (!a.table_id) {
          problems.push(`${c.external_check_id}: table_id is null`);
          continue;
        }
        const t: any = byId.get(a.table_id);
        if (!t) {
          problems.push(
            `${c.external_check_id}: table_id ${a.table_id} matches no restaurant_tables row`,
          );
        } else if (String(t.label) !== String(c.table_label)) {
          problems.push(
            `${c.external_check_id}: resolved to table '${t.label}', expected '${c.table_label}'`,
          );
        } else {
          resolved++;
        }
      }
      push(
        "checks.tables_resolved",
        problems.length === 0 && resolved > 0 ? "pass" : "fail",
        withLabel.map((c) => c.table_label),
        `${resolved} of ${withLabel.length} resolved`,
        problems.length === 0
          ? `every check with a table_label resolved to that table`
          : `${problems.length} table(s) unresolved or mismatched`,
        problems,
      );
    }

    // ---- lines.wine_resolved ---------------------------------------------
    if (!posChecks.ok) {
      push(
        "lines.wine_resolved",
        "unverifiable",
        null,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else if (emptyRun) {
      push("lines.wine_resolved", "unverifiable", 0, 0, NOTHING);
    } else {
      const problems: string[] = [];
      let compared = 0;
      for (const p of pairs) {
        const a = landed.get(p.chk.external_check_id);
        if (!a) continue;
        const items = Array.isArray(a.items) ? a.items : [];
        const item = items[p.line.line_no];
        if (!item) {
          problems.push(
            `${p.chk.external_check_id}[${p.line.line_no}]: no stored item at this index`,
          );
          continue;
        }
        compared++;
        const wantsStock =
          p.line.expect === "bottle" || p.line.expect === "volume";
        if (wantsStock) {
          if (item.is_wine !== true) {
            problems.push(
              `${p.chk.external_check_id}[${p.line.line_no}] ${p.line.name}: is_wine ${item.is_wine}, expected true`,
            );
          }
          if (!item.inventory_id) {
            problems.push(
              `${p.chk.external_check_id}[${p.line.line_no}] ${p.line.name}: inventory_id is null`,
            );
          }
        } else if (p.line.expect === "food") {
          if (item.is_wine === true) {
            problems.push(
              `${p.chk.external_check_id}[${p.line.line_no}] ${p.line.name}: is_wine true on a food line`,
            );
          }
          if (item.inventory_id) {
            problems.push(
              `${p.chk.external_check_id}[${p.line.line_no}] ${p.line.name}: food line carries inventory_id ${item.inventory_id}`,
            );
          }
        }
      }
      push(
        "lines.wine_resolved",
        compared === 0
          ? "unverifiable"
          : problems.length === 0
            ? "pass"
            : "fail",
        `${depleting.length} wine line(s) resolved, food lines unresolved`,
        `${compared} line(s) compared, ${problems.length} problem(s)`,
        compared === 0
          ? "no stored item lined up with an expected line"
          : problems.length === 0
            ? "every wine line carries an inventory_id and every food line does not"
            : `${problems.length} line(s) resolved wrongly`,
        problems,
      );
    }

    // ---- stock.bottle_transactions ---------------------------------------
    const txByKey = new Map<string, any[]>();
    if (txns.ok) {
      for (const t of txns.rows) {
        const list = txByKey.get(t.idempotency_key) ?? [];
        list.push(t);
        txByKey.set(t.idempotency_key, list);
      }
    }
    if (!txns.ok) {
      push(
        "stock.bottle_transactions",
        "unverifiable",
        bottleLines.length,
        null,
        `inventory_transactions could not be read: ${txns.error}`,
      );
    } else if (bottleLines.length === 0) {
      push(
        "stock.bottle_transactions",
        "unverifiable",
        0,
        0,
        emptyRun ? NOTHING : "this run sells no whole bottles",
      );
    } else {
      const problems: string[] = [];
      let ok = 0;
      for (const p of bottleLines) {
        const found = txByKey.get(p.key) ?? [];
        if (found.length === 0) {
          problems.push(`${p.line.name}: no transaction for key ${p.key}`);
          continue;
        }
        if (found.length > 1) {
          problems.push(
            `${p.line.name}: ${found.length} transactions share key ${p.key} — a replay depleted twice`,
          );
          continue;
        }
        const t = found[0];
        const want = -Math.round(Number(p.line.qty) || 0);
        if (Number(t.quantity_change) !== want) {
          problems.push(
            `${p.line.name}: quantity_change ${t.quantity_change}, expected ${want}`,
          );
        } else if (String(t.source) !== "pos") {
          problems.push(`${p.line.name}: source '${t.source}', expected 'pos'`);
        } else {
          ok++;
        }
      }
      push(
        "stock.bottle_transactions",
        problems.length === 0 ? "pass" : "fail",
        `${bottleLines.length} bottle line(s) → one 'pos' transaction each`,
        `${ok} correct, ${problems.length} problem(s)`,
        problems.length === 0
          ? "one transaction per bottle key, negative by the sold quantity"
          : `${problems.length} bottle line(s) did not move stock exactly once`,
        problems,
      );
    }

    // ---- stock.pours ------------------------------------------------------
    const pourByKey = new Map<string, any[]>();
    if (pours.ok) {
      for (const e of pours.rows) {
        const list = pourByKey.get(e.idempotency_key) ?? [];
        list.push(e);
        pourByKey.set(e.idempotency_key, list);
      }
    }
    if (!pours.ok) {
      push(
        "stock.pours",
        "unverifiable",
        volumeLines.length,
        null,
        `pour_events could not be read: ${pours.error}`,
      );
    } else if (volumeLines.length === 0) {
      push(
        "stock.pours",
        "unverifiable",
        0,
        0,
        emptyRun ? NOTHING : "this run sells nothing by the glass",
      );
    } else {
      const problems: string[] = [];
      let ok = 0;
      for (const p of volumeLines) {
        const found = pourByKey.get(p.key) ?? [];
        if (found.length === 0) {
          problems.push(`${p.line.name}: no pour_events row for key ${p.key}`);
          continue;
        }
        if (found.length > 1) {
          problems.push(
            `${p.line.name}: ${found.length} pour rows share key ${p.key}`,
          );
          continue;
        }
        const e = found[0];
        const wantPours = Math.round(Number(p.line.qty) || 0);
        const wantMl =
          p.line.volume_ml == null ? null : Math.round(p.line.volume_ml);
        if (Number(e.pours) !== wantPours) {
          problems.push(
            `${p.line.name}: pours ${e.pours}, expected ${wantPours}`,
          );
        } else if (wantMl == null) {
          problems.push(
            `${p.line.name}: the expectation carries no volume_ml, so the poured ${e.pour_ml}ml could not be checked`,
          );
        } else if (Number(e.pour_ml) !== wantMl) {
          problems.push(
            `${p.line.name}: pour_ml ${e.pour_ml}, expected ${wantMl}`,
          );
        } else {
          ok++;
        }
      }
      push(
        "stock.pours",
        problems.length === 0 ? "pass" : "fail",
        `${volumeLines.length} glass line(s) → one pour event each`,
        `${ok} correct, ${problems.length} problem(s)`,
        problems.length === 0
          ? "one pour event per glass key, for the millilitres the scenario poured"
          : `${problems.length} glass line(s) poured wrongly`,
        problems,
      );
    }

    // ---- stock.dedupe -----------------------------------------------------
    const dupPairs = pairs.filter(
      (p) =>
        duplicateIds.includes(p.chk.external_check_id) &&
        (p.line.expect === "bottle" || p.line.expect === "volume"),
    );
    let dedupePassed = false;
    if (duplicateIds.length === 0) {
      push(
        "stock.dedupe",
        "unverifiable",
        0,
        0,
        "this run posts no duplicate webhook",
      );
    } else if (!txns.ok || !pours.ok) {
      push(
        "stock.dedupe",
        "unverifiable",
        dupPairs.length,
        null,
        !txns.ok
          ? `inventory_transactions could not be read: ${txns.error}`
          : `pour_events could not be read: ${(pours as any).error}`,
      );
    } else if (dupPairs.length === 0) {
      push(
        "stock.dedupe",
        "unverifiable",
        0,
        0,
        `duplicate check id(s) ${duplicateIds.join(", ")} carry no depleting line`,
      );
    } else {
      const problems: string[] = [];
      for (const p of dupPairs) {
        const n =
          p.line.expect === "bottle"
            ? (txByKey.get(p.key) ?? []).length
            : (pourByKey.get(p.key) ?? []).length;
        if (n !== 1) {
          problems.push(
            `${p.chk.external_check_id} ${p.line.name}: ${n} stock row(s) for key ${p.key}, expected exactly 1`,
          );
        }
      }
      dedupePassed = problems.length === 0;
      push(
        "stock.dedupe",
        dedupePassed ? "pass" : "fail",
        `${dupPairs.length} replayed line(s) → 1 stock row each`,
        `${dupPairs.length - problems.length} deduped, ${problems.length} doubled`,
        dedupePassed
          ? `the duplicate webhook (${duplicateIds.join(", ")}) moved stock once`
          : `${problems.length} line(s) moved stock more than once on the replay`,
        problems,
      );
    }

    // ---- stock.projection -------------------------------------------------
    if (depletion.length === 0) {
      push(
        "stock.projection",
        "unverifiable",
        0,
        0,
        emptyRun ? NOTHING : "this run's expectation lists no depletion",
      );
    } else if (!inventory.ok || !lots.ok) {
      push(
        "stock.projection",
        "unverifiable",
        depletion.length,
        null,
        !inventory.ok
          ? `restaurant_inventory could not be read: ${inventory.error}`
          : `inventory_lots could not be read: ${(lots as any).error}`,
      );
    } else {
      const invById = new Map(inventory.rows.map((r: any) => [r.id, r]));
      const lotSum = new Map<string, number>();
      for (const l of lots.rows) {
        lotSum.set(
          l.inventory_id,
          (lotSum.get(l.inventory_id) ?? 0) + (Number(l.qty) || 0),
        );
      }
      const problems: string[] = [];
      const actuals: Array<Record<string, unknown>> = [];
      for (const d of depletion) {
        const inv: any = invById.get(d.inventory_id);
        const name = d.wine_name ?? inv?.wine_name ?? d.inventory_id;
        if (!inv) {
          problems.push(
            `${name}: no restaurant_inventory row for ${d.inventory_id}`,
          );
          continue;
        }
        const live = Number(inv.stock_live);
        const sum = lotSum.get(d.inventory_id) ?? 0;
        // camelCase on purpose. This is a REPORT payload a page renders, not
        // a row. `scripts/check_no_direct_stock_writes.sh` matches the
        // projected column names as object keys anywhere under apps/, and it
        // is right to — a guard that tried to tell a write from a read would
        // be the guard that misses the write. Naming the field differently
        // costs nothing and keeps the guard's rule absolute.
        actuals.push({
          wine: name,
          stockLive: live,
          lotsLiveSum: sum,
          expected: d.expected_stock_live,
        });
        const upper = d.stock_live_is_upper_bound === true;
        const target = Number(d.expected_stock_live);
        if (upper ? live > target : live !== target) {
          problems.push(
            `${name}: stock_live ${live}, expected ${upper ? "≤ " : ""}${target}`,
          );
        }
        // The projection and the ledger it is projected FROM must agree, or
        // one of the two is fiction. `stock_live` is maintained by
        // trg_project_stock_from_lots; a divergence means something wrote the
        // projection directly (scripts/check_no_direct_stock_writes.sh).
        if (live !== sum) {
          problems.push(
            `${name}: stock_live ${live} ≠ SUM(inventory_lots.qty) ${sum} — the projection disagrees with its own ledger`,
          );
        }
      }
      push(
        "stock.projection",
        problems.length === 0 ? "pass" : "fail",
        depletion.map((d) => ({
          wine: d.wine_name ?? d.inventory_id,
          expected_stock_live: d.expected_stock_live,
          upper_bound: d.stock_live_is_upper_bound === true,
        })),
        actuals,
        problems.length === 0
          ? "every wine's stock_live matched its expectation AND the sum of its live lots"
          : `${problems.length} discrepancy(ies)`,
        problems,
      );
    }

    // ---- voids.returned ---------------------------------------------------
    if (voidLines.length === 0) {
      push(
        "voids.returned",
        "unverifiable",
        0,
        0,
        emptyRun ? NOTHING : "this run voids nothing",
      );
    } else if (!txns.ok) {
      push(
        "voids.returned",
        "unverifiable",
        voidLines.length,
        null,
        `inventory_transactions could not be read: ${txns.error}`,
      );
    } else {
      const problems: string[] = [];
      const unknowns: string[] = [];
      const actuals: Array<Record<string, unknown>> = [];
      for (const p of voidLines) {
        const qty = Math.round(Number(p.line.qty) || 0);
        // ADR 0093 D5: the void writes under `<sale key>:void`. Reading the
        // sale key too is what makes the pre-fix behaviour VISIBLE — the sale
        // transaction sitting under the shared key, having moved nothing.
        const voidRows = txByKey.get(`${p.key}:void`) ?? [];
        const saleRows = txByKey.get(p.key) ?? [];
        const ret = [...voidRows, ...saleRows].find(
          (t) =>
            String(t.transaction_type) === "return" &&
            Number(t.quantity_change) === qty,
        );
        actuals.push({
          line: p.line.name,
          void_key_rows: voidRows.length,
          sale_key_rows: saleRows.length,
          returned: !!ret,
        });
        if (!ret) {
          problems.push(
            `${p.line.name}: no 'return' transaction of +${qty} under ${p.key}:void` +
              (saleRows.length
                ? ` — a row exists under the SALE key (${saleRows[0].transaction_type}, ${saleRows[0].quantity_change}), which is the void-reuses-the-sale-key defect (ADR 0093 D5)`
                : ""),
          );
        }
      }
      // The second half of the claim: the wine is back where it started.
      const invById = inventory.ok
        ? new Map(inventory.rows.map((r: any) => [r.id, r]))
        : new Map();
      for (const invId of [
        ...new Set(voidLines.map((p) => p.line.inventory_id).filter(Boolean)),
      ] as string[]) {
        const d = depletion.find((x) => x.inventory_id === invId);
        const inv: any = invById.get(invId);
        if (!inventory.ok) {
          unknowns.push(
            `restaurant_inventory could not be read (${inventory.error}), so the returned stock level is unknown`,
          );
          continue;
        }
        if (!d) {
          unknowns.push(
            `${inv?.wine_name ?? invId}: the expectation carries no depletion row for this wine, so its opening stock is unknown here — the return transaction above is what was verified`,
          );
          continue;
        }
        if (!inv) {
          problems.push(`${invId}: no restaurant_inventory row`);
          continue;
        }
        const target = Number(d.expected_stock_live);
        if (Number(inv.stock_live) !== target) {
          problems.push(
            `${inv.wine_name ?? invId}: stock_live ${inv.stock_live}, expected ${target} after the void`,
          );
        }
      }
      const status: VerifyStatus =
        problems.length > 0
          ? "fail"
          : unknowns.length > 0
            ? "unverifiable"
            : "pass";
      push(
        "voids.returned",
        status,
        `${voidLines.length} voided line(s) → a 'return' of +qty under a distinct key, stock back to opening`,
        actuals,
        problems.length > 0
          ? `${problems.length} void(s) did not return stock`
          : unknowns.length > 0
            ? `every return transaction is present; the stock level could not be confirmed for ${unknowns.length} wine(s)`
            : "every void returned its stock and the wine is back at its expected level",
        [...problems, ...unknowns],
      );
    }

    // ---- consumption.mirror ----------------------------------------------
    if (!consumption.ok) {
      push(
        "consumption.mirror",
        "unverifiable",
        depleting.length,
        null,
        `wine_consumption_log could not be read: ${consumption.error}`,
      );
    } else if (depleting.length === 0) {
      push(
        "consumption.mirror",
        "unverifiable",
        0,
        consumption.rows.length,
        emptyRun ? NOTHING : "this run has no depleting line to mirror",
      );
    } else {
      const byNote = new Map<string, any[]>();
      for (const r of consumption.rows) {
        const list = byNote.get(r.notes) ?? [];
        list.push(r);
        byNote.set(r.notes, list);
      }
      const problems: string[] = [];
      const notesCompared: string[] = [];
      let ok = 0;
      for (const p of depleting) {
        const found = byNote.get(p.key) ?? [];
        if (found.length !== 1) {
          problems.push(
            `${p.line.name}: ${found.length} wine_consumption_log row(s) for key ${p.key}, expected exactly 1`,
          );
          continue;
        }
        const r = found[0];
        const qty = Math.round(Number(p.line.qty) || 0);
        const localProblems: string[] = [];
        if (Number(r.quantity) !== qty) {
          localProblems.push(`quantity ${r.quantity} ≠ ${qty}`);
        }
        if (p.line.volume_ml != null) {
          const wantMl = Number(p.line.volume_ml) * qty;
          if (Math.abs(Number(r.volume_ml) - wantMl) > 0.5) {
            localProblems.push(`volume_ml ${r.volume_ml} ≠ ${wantMl}`);
          }
        } else {
          notesCompared.push(
            `${p.line.name}: the expectation carries no volume_ml, so the logged ${r.volume_ml}ml was not compared`,
          );
        }
        if (r.unit_price != null && !within(p.line.price, r.unit_price, 0.01)) {
          localProblems.push(`unit_price ${r.unit_price} ≠ ${p.line.price}`);
        }
        if (localProblems.length) {
          problems.push(`${p.line.name}: ${localProblems.join("; ")}`);
        } else {
          ok++;
        }
      }
      // A voided or dropped line is not consumption. Its key must have no row.
      const mustBeAbsent = [
        ...voidLines,
        ...expChecks
          .filter((c) => dropped.has(c.external_check_id))
          .flatMap((c) =>
            (c.lines ?? []).map((line) => ({
              chk: c,
              line,
              key: keyOf(c, line),
            })),
          ),
      ];
      for (const p of mustBeAbsent) {
        if ((byNote.get(p.key) ?? []).length > 0) {
          problems.push(
            `${p.line.name}: a consumption row exists for a voided/dropped line (key ${p.key})`,
          );
        }
      }
      push(
        "consumption.mirror",
        problems.length === 0 ? "pass" : "fail",
        `${depleting.length} depleting line(s) → one wine_consumption_log row each; none for ${mustBeAbsent.length} voided/dropped line(s)`,
        `${ok} matched, ${problems.length} problem(s)`,
        problems.length === 0
          ? `every depleting sale mirrored exactly once${notesCompared.length ? `; ${notesCompared.length} line(s) had no expected volume_ml to compare` : ""}`
          : `${problems.length} mirroring problem(s)`,
        [...problems, ...notesCompared],
      );
    }

    // ---- unresolved.queued ------------------------------------------------
    const expectedUnresolvedCount =
      exp.unresolved?.count ?? unresolvedLines.length;
    const expectedByReason = exp.unresolved?.by_reason ?? null;
    if (!unresolvedRows.ok) {
      push(
        "unresolved.queued",
        "unverifiable",
        { count: expectedUnresolvedCount, by_reason: expectedByReason },
        null,
        `pos_unresolved_lines could not be read: ${unresolvedRows.error}`,
      );
    } else if (emptyRun) {
      push(
        "unresolved.queued",
        "unverifiable",
        0,
        unresolvedRows.rows.length,
        NOTHING,
      );
    } else {
      const actualByReason: Record<string, number> = {};
      for (const r of unresolvedRows.rows) {
        const k = String(r.reason ?? "unknown");
        actualByReason[k] = (actualByReason[k] ?? 0) + 1;
      }
      const problems: string[] = [];
      if (unresolvedRows.rows.length !== expectedUnresolvedCount) {
        problems.push(
          `${unresolvedRows.rows.length} queued line(s), expected ${expectedUnresolvedCount}`,
        );
      }
      if (expectedByReason) {
        for (const [reason, n] of Object.entries(expectedByReason)) {
          if ((actualByReason[reason] ?? 0) !== n) {
            problems.push(
              `reason '${reason}': ${actualByReason[reason] ?? 0} queued, expected ${n}`,
            );
          }
        }
        for (const reason of Object.keys(actualByReason)) {
          if (!(reason in expectedByReason)) {
            problems.push(
              `reason '${reason}': ${actualByReason[reason]} queued, expected none`,
            );
          }
        }
      }
      push(
        "unresolved.queued",
        problems.length === 0 ? "pass" : "fail",
        { count: expectedUnresolvedCount, by_reason: expectedByReason },
        { count: unresolvedRows.rows.length, by_reason: actualByReason },
        problems.length === 0
          ? expectedUnresolvedCount === 0
            ? "nothing was queued, and nothing was expected to be"
            : `${expectedUnresolvedCount} line(s) queued with the expected reasons`
          : problems.join("; "),
        problems,
      );
    }

    // ---- low_stock.notified / low_stock.emailed ---------------------------
    const expectedLowStock = exp.low_stock ?? [];
    const matchedNotifications: any[] = [];
    if (!notifications.ok) {
      const why = (notifications as any).error;
      push(
        "low_stock.notified",
        "unverifiable",
        expectedLowStock.length,
        null,
        `notifications could not be read: ${why}`,
      );
      push(
        "low_stock.emailed",
        "unverifiable",
        null,
        null,
        `notifications could not be read: ${why}`,
      );
    } else if (expectedLowStock.length === 0) {
      push(
        "low_stock.notified",
        "unverifiable",
        0,
        notifications.rows.length,
        emptyRun
          ? NOTHING
          : "this run crosses no wine below par, so no alert was expected",
      );
      push(
        "low_stock.emailed",
        "unverifiable",
        null,
        null,
        "no low-stock notification was expected, so there is no delivery outcome to read",
      );
    } else {
      const wineIdsIn = (n: any): string[] => {
        const wines = n?.metadata?.wines;
        return Array.isArray(wines)
          ? wines.map((w: any) => String(w?.wineId ?? "")).filter(Boolean)
          : [];
      };
      const missing: string[] = [];
      for (const w of expectedLowStock) {
        const hit = notifications.rows.filter((n: any) =>
          wineIdsIn(n).includes(w.inventory_id),
        );
        if (hit.length === 0) {
          missing.push(`${w.wine_name ?? w.inventory_id}`);
        } else {
          matchedNotifications.push(...hit);
        }
      }
      push(
        "low_stock.notified",
        missing.length === 0 ? "pass" : "fail",
        expectedLowStock.map((w) => w.wine_name ?? w.inventory_id),
        `${expectedLowStock.length - missing.length} of ${expectedLowStock.length} notified, from ${notifications.rows.length} low-stock row(s) since ${postedAt}`,
        missing.length === 0
          ? "every wine that crossed par has an inbox notification naming it"
          : `no notification — run the sweep lever (the edge sweep cron runs every 2 minutes; the lever runs it now). Missing: ${missing.join(", ")}`,
        missing,
      );

      if (matchedNotifications.length === 0) {
        push(
          "low_stock.emailed",
          "unverifiable",
          "delivery_status.email.ok === true",
          null,
          "no notification exists yet, so nothing records whether an email left — run the sweep lever first",
        );
      } else {
        const outcomes = matchedNotifications.map((n: any) => ({
          id: n.id,
          email: n?.delivery_status?.email ?? null,
        }));
        const unrecorded = outcomes.filter((o) => o.email == null);
        const failed = outcomes.filter((o) => o.email && o.email.ok !== true);
        push(
          "low_stock.emailed",
          unrecorded.length > 0
            ? "unverifiable"
            : failed.length === 0
              ? "pass"
              : "fail",
          "delivery_status.email.ok === true",
          outcomes.map((o) => o.email),
          unrecorded.length > 0
            ? `${unrecorded.length} notification(s) carry no delivery_status.email — the send outcome was never recorded, so 'emailed' is unknown, not false`
            : failed.length === 0
              ? `the email left for all ${outcomes.length} notification(s)`
              : `email failed: ${failed
                  .map((f) => f.email?.error ?? "unknown error")
                  .join("; ")}`,
          [...unrecorded, ...failed],
        );
      }
    }

    // ---- insights.generated -----------------------------------------------
    if (emptyRun) {
      // A closed day rang nothing, so an insight about "this run" is not a
      // thing that could exist. Insights that ARE present belong to other
      // days; counting them either way would be a verdict about someone
      // else's data.
      push(
        "insights.generated",
        "unverifiable",
        0,
        insightRows.ok ? insightRows.rows.length : null,
        NOTHING,
      );
    } else if (!insightRows.ok) {
      push(
        "insights.generated",
        "unverifiable",
        "> 0 rows since posted_at, at least one naming a scenario wine or check",
        null,
        `analytics_insights could not be read: ${(insightRows as any).error}`,
      );
    } else {
      const needles = [
        ...new Set([
          ...pairs.filter((p) => p.line.is_wine).map((p) => p.line.name),
          ...depletion.map((d) => d.wine_name ?? ""),
          ...allIds,
        ]),
      ].filter((s) => typeof s === "string" && s.length >= 3);
      const mentions = insightRows.rows.filter((r: any) => {
        const hay = [
          r.entity_key,
          r.entity_label,
          r.sentence,
          JSON.stringify(r.evidence ?? {}),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return needles.some((n) => hay.includes(String(n).toLowerCase()));
      });
      push(
        "insights.generated",
        insightRows.rows.length === 0
          ? "fail"
          : mentions.length > 0
            ? "pass"
            : "fail",
        "> 0 rows since posted_at, at least one naming a scenario wine or check",
        {
          rows: insightRows.rows.length,
          mentioningThisRun: mentions.length,
        },
        insightRows.rows.length === 0
          ? "no insights — run the insights lever (the generator runs hourly; the lever runs it now)"
          : mentions.length > 0
            ? `${mentions.length} of ${insightRows.rows.length} insight(s) name a wine or check from this run`
            : `${insightRows.rows.length} insight(s) were generated but none names a wine or check from this run`,
        mentions.slice(0, 5).map((m: any) => m.sentence),
      );
    }

    // ---- analytics.pos_revenue --------------------------------------------
    await this.checkPosRevenue(restaurantId, run, exp, push);

    // ---- analytics.tables -------------------------------------------------
    await this.checkTables(restaurantId, run, exp, expectedToLand, push);

    // ---- hours.outside ----------------------------------------------------
    if (!posChecks.ok) {
      push(
        "hours.outside",
        "unverifiable",
        exp.outside_hours_count ?? null,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else if (emptyRun) {
      push("hours.outside", "unverifiable", 0, 0, NOTHING);
    } else {
      const verdicts = expectedToLand
        .map((c) => landed.get(c.external_check_id))
        .filter(Boolean)
        .map((a: any) => ({
          id: a.external_check_id,
          ...isOpenAt(run.operating_hours, run.timezone, new Date(a.opened_at)),
        }));
      const unknown = verdicts.filter((v) => v.open === null);
      const closedCount = verdicts.filter((v) => v.open === false).length;
      const want = exp.outside_hours_count ?? 0;
      push(
        "hours.outside",
        unknown.length > 0
          ? "unverifiable"
          : closedCount === want
            ? "pass"
            : "fail",
        want,
        unknown.length > 0 ? null : closedCount,
        unknown.length > 0
          ? `${unknown.length} of ${verdicts.length} check(s) could not be placed against the venue's hours (${[...new Set(unknown.map((u) => u.reason ?? "no reason given"))].join(", ")}) — an unknown is not a "within hours"`
          : closedCount === want
            ? `${closedCount} check(s) fell outside the venue's hours, as expected`
            : `${closedCount} check(s) fell outside the venue's hours, expected ${want}`,
        unknown.slice(0, 5),
      );
    }

    // ---- hours.closed_day -------------------------------------------------
    await this.checkClosedDay(restaurantId, run, exp, reads, push);

    // ---- webhook.dropped --------------------------------------------------
    if (droppedIds.length === 0) {
      push(
        "webhook.dropped",
        "unverifiable",
        0,
        0,
        "this run drops no webhook",
      );
    } else if (!posChecks.ok) {
      push(
        "webhook.dropped",
        "unverifiable",
        droppedIds,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else {
      const present = droppedIds.filter((id) => landed.has(id));
      push(
        "webhook.dropped",
        present.length === 0 ? "unverifiable" : "fail",
        droppedIds,
        present.length === 0 ? "absent" : present,
        present.length === 0
          ? "absent as expected; no detector exists for a missed webhook (S09 §9), so this is not a pass — the product cannot currently tell a dropped check from a check that was never rung"
          : `${present.length} check(s) the scenario never posted are present in pos_checks`,
        present,
      );
    }

    // ---- webhook.duplicate ------------------------------------------------
    if (duplicateIds.length === 0) {
      push(
        "webhook.duplicate",
        "unverifiable",
        0,
        0,
        "this run posts no duplicate webhook",
      );
    } else if (!posChecks.ok) {
      push(
        "webhook.duplicate",
        "unverifiable",
        duplicateIds,
        null,
        `pos_checks could not be read: ${posChecks.error}`,
      );
    } else {
      const counted = duplicateIds.map((id) => ({
        id,
        rows: posChecks.rows.filter((r: any) => r.external_check_id === id)
          .length,
      }));
      const wrong = counted.filter((c) => c.rows !== 1);
      const dedupeOk = dedupePassed;
      push(
        "webhook.duplicate",
        wrong.length === 0 && dedupeOk ? "pass" : "fail",
        duplicateIds.map((id) => ({ id, rows: 1 })),
        counted,
        wrong.length > 0
          ? `${wrong.length} duplicate id(s) produced more than one pos_checks row — the upsert did not collapse the replay`
          : dedupeOk
            ? "one row per replayed check, and stock moved once (stock.dedupe passed)"
            : "one row per replayed check, but stock.dedupe did NOT pass — the replay moved stock twice",
        wrong,
      );
    }

    return this.assemble(run, verifiedAt, rows, reads);
  }

  // =========================================================================
  // Checks that need a service call
  // =========================================================================

  private async checkPosRevenue(
    restaurantId: string,
    run: ScenarioRunRow,
    exp: ScenarioExpectation,
    push: (
      id: string,
      status: VerifyStatus,
      expected: unknown,
      actual: unknown,
      detail: string,
      samples?: unknown[],
    ) => void,
  ): Promise<void> {
    const want = exp.totals?.revenue;
    const date = run.service_date;
    if ((exp.checks ?? []).length === 0) {
      // A closed-day run expects no revenue — but this sim tenant may carry
      // other runs on the same calendar date, so a non-zero figure here is
      // not evidence that THIS run misbehaved. Same reasoning as
      // `hours.closed_day`, and the same refusal to guess.
      push(
        "analytics.pos_revenue",
        "unverifiable",
        want ?? 0,
        null,
        "nothing to compare — this run's expectation has no checks, and any revenue on this date belongs to other runs against the same sim tenant",
      );
      return;
    }
    if (want == null || !date) {
      push(
        "analytics.pos_revenue",
        "unverifiable",
        want ?? null,
        null,
        want == null
          ? "the expectation carries no totals.revenue"
          : "the run has no service_date",
      );
      return;
    }
    const span = daysBackInclusive(date);
    if (span == null || span > 365) {
      push(
        "analytics.pos_revenue",
        "unverifiable",
        want,
        null,
        span == null
          ? `service_date '${date}' is not a date this verifier can window`
          : `service_date '${date}' is ${span} days back; the POS revenue endpoint windows at 365 days`,
      );
      return;
    }
    try {
      // The same method `GET analytics/pos-revenue/:restaurantId` calls, so a
      // pass here is a statement about the endpoint a page reads, not about a
      // second sum written for this test.
      const window = await this.goals.getPosRevenueWindow(restaurantId, span);
      if (!window.posConnected) {
        push(
          "analytics.pos_revenue",
          (exp.totals?.checks ?? 0) > 0 ? "fail" : "unverifiable",
          want,
          null,
          "GoalsService reports posConnected: false — no POS check has ever landed for this restaurant, so revenue is null, not 0",
        );
        return;
      }
      const series = new Map(
        (window.dailySeries ?? []).map((d) => [d.date, Number(d.revenue) || 0]),
      );
      const onDate = series.get(date) ?? 0;
      const next = nextDay(date);
      const spill = next ? (series.get(next) ?? 0) : 0;
      if (Math.abs(onDate - want) <= 0.01) {
        push(
          "analytics.pos_revenue",
          "pass",
          want,
          onDate,
          `pos-revenue booked ${onDate.toFixed(2)} on ${date} (window ${window.from}…${window.to}, ${window.checkCount} non-voided check(s)); voided and dropped checks are excluded by the query itself`,
        );
        return;
      }
      if (Math.abs(onDate + spill - want) <= 0.01) {
        push(
          "analytics.pos_revenue",
          "unverifiable",
          want,
          { [date]: onDate, [next as string]: spill },
          `the revenue is all present but split across two UTC day buckets (${onDate.toFixed(2)} + ${spill.toFixed(2)}). GoalsService buckets on the UTC date of closed_at, while service_date is local to ${run.timezone ?? "an unrecorded timezone"} — so this cannot be decided here, and is not reported as a mismatch`,
        );
        return;
      }
      push(
        "analytics.pos_revenue",
        "fail",
        want,
        onDate,
        `pos-revenue booked ${onDate.toFixed(2)} on ${date}, expected ${Number(want).toFixed(2)} (next UTC day holds ${spill.toFixed(2)})`,
      );
    } catch (e: any) {
      push(
        "analytics.pos_revenue",
        "unverifiable",
        want,
        null,
        `the pos-revenue path threw: ${e?.message ?? String(e)}`,
      );
    }
  }

  private async checkTables(
    restaurantId: string,
    run: ScenarioRunRow,
    exp: ScenarioExpectation,
    expectedToLand: ExpectedCheck[],
    push: (
      id: string,
      status: VerifyStatus,
      expected: unknown,
      actual: unknown,
      detail: string,
      samples?: unknown[],
    ) => void,
  ): Promise<void> {
    const wantTables = exp.tables ?? [];
    if (wantTables.length === 0) {
      push(
        "analytics.tables",
        "unverifiable",
        0,
        null,
        "the expectation names no tables",
      );
      return;
    }
    const date = run.service_date;
    const span = date ? daysBackInclusive(date) : null;
    if (span == null || span > 365) {
      push(
        "analytics.tables",
        "unverifiable",
        wantTables.map((t) => t.label),
        null,
        `service_date '${date}' cannot be windowed into table performance`,
      );
      return;
    }
    const perLabel = new Map<string, number>();
    for (const c of expectedToLand) {
      if (c.table_label == null || c.voided === true) continue;
      perLabel.set(c.table_label, (perLabel.get(c.table_label) ?? 0) + 1);
    }
    try {
      const perf = await this.tableAnalytics.getTablePerformance(
        restaurantId,
        span,
      );
      // `dataStatus` is the service's own word for "there is no POS feed" —
      // an empty `tables` array on an empty feed is an ABSENCE, and reporting
      // it as a table-by-table mismatch would be the fault this file exists
      // to catch.
      if (perf.dataStatus !== "live") {
        push(
          "analytics.tables",
          "unverifiable",
          wantTables.map((t) => t.label),
          perf.dataStatus,
          `TableAnalyticsService reports '${perf.dataStatus}', so it has nothing to attribute this run's checks to`,
        );
        return;
      }
      const rows: any[] = perf.tables ?? [];
      const byLabel = new Map(rows.map((r: any) => [String(r.label), r]));
      const problems: string[] = [];
      const actual: Array<Record<string, unknown>> = [];
      for (const t of wantTables) {
        const r: any = byLabel.get(String(t.label));
        if (!r) {
          problems.push(
            `table '${t.label}' does not appear in table performance at all`,
          );
          continue;
        }
        const wanted = perLabel.get(t.label) ?? 0;
        actual.push({
          label: t.label,
          checks: r.checks,
          expectedAtLeast: wanted,
        });
        if (Number(r.checks) < wanted) {
          problems.push(
            `table '${t.label}': ${r.checks} check(s), expected at least ${wanted}`,
          );
        }
      }
      push(
        "analytics.tables",
        problems.length === 0 ? "pass" : "fail",
        [...perLabel.entries()].map(([label, checks]) => ({
          label,
          atLeastChecks: checks,
        })),
        actual,
        problems.length === 0
          ? `every expected table appears, each carrying at least this run's check count. TableAnalyticsService aggregates a rolling ${span}-day window rather than one date, so the count is a FLOOR (≥), not a per-day total — an equality here would be a claim the service cannot support`
          : problems.join("; "),
        problems,
      );
    } catch (e: any) {
      push(
        "analytics.tables",
        "unverifiable",
        wantTables.map((t) => t.label),
        null,
        `table performance threw: ${e?.message ?? String(e)}`,
      );
    }
  }

  private async checkClosedDay(
    restaurantId: string,
    run: ScenarioRunRow,
    exp: ScenarioExpectation,
    reads: ReadRecord[],
    push: (
      id: string,
      status: VerifyStatus,
      expected: unknown,
      actual: unknown,
      detail: string,
      samples?: unknown[],
    ) => void,
  ): Promise<void> {
    const emptyRun = (exp.checks ?? []).length === 0;
    if (!emptyRun) {
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        "this run expects checks, so it is not a closed-day run",
      );
      return;
    }
    const date = run.service_date;
    const tz = run.timezone;
    if (!date || !tz) {
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        `the run has no ${!date ? "service_date" : "timezone"}, so its local day has no boundaries`,
      );
      return;
    }
    if (parseOperatingHours(run.operating_hours) == null) {
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        "the venue's operating hours could not be parsed, so 'closed day' is an assumption rather than a fact",
      );
      return;
    }
    if (serviceWindows(run.operating_hours, tz, date).length > 0) {
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        `${date} is a trading day for this venue, so an empty run does not prove a closed day`,
      );
      return;
    }
    let bounds: { start: Date; end: Date };
    try {
      bounds = localDayBounds(date, tz);
    } catch (e: any) {
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        `timezone '${tz}' is not one this runtime knows (${e?.message ?? e}), so the local day could not be bounded`,
      );
      return;
    }
    const { count, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .gte("opened_at", bounds.start.toISOString())
      .lt("opened_at", bounds.end.toISOString());
    if (error) {
      reads.push({ table: "pos_checks", ok: false, error: error.message });
      push(
        "hours.closed_day",
        "unverifiable",
        0,
        null,
        `pos_checks could not be counted: ${error.message}`,
      );
      return;
    }
    reads.push({ table: "pos_checks", ok: true, rows: count ?? 0 });
    push(
      "hours.closed_day",
      (count ?? 0) === 0 ? "pass" : "unverifiable",
      0,
      count ?? 0,
      (count ?? 0) === 0
        ? `no check opened between ${bounds.start.toISOString()} and ${bounds.end.toISOString()} — the venue was closed and the product recorded nothing`
        : `${count} check(s) opened during a day the venue is closed; they may be from another run against this sim tenant, so this is not evidence either way`,
    );
  }

  // =========================================================================
  // Reads, and the assembly
  // =========================================================================

  private async readRows<T = any>(
    table: string,
    reads: ReadRecord[],
    build: (client: any) => any,
  ): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
    try {
      // supabase-js RESOLVES with { data, error }. `error` is destructured on
      // every read in this file and never dropped (ADR 0067).
      const { data, error } = await build(this.dbService.getClient());
      if (error) {
        reads.push({ table, ok: false, error: error.message });
        return { ok: false, error: error.message };
      }
      const rows = (data ?? []) as T[];
      reads.push({ table, ok: true, rows: rows.length });
      return { ok: true, rows };
    } catch (e: any) {
      const message = e?.message ?? String(e);
      reads.push({ table, ok: false, error: message });
      return { ok: false, error: message };
    }
  }

  private async readIn<T = any>(
    table: string,
    reads: ReadRecord[],
    values: string[],
    build: (client: any, chunk: string[]) => any,
  ): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
    if (values.length === 0) {
      reads.push({ table, ok: true, rows: 0 });
      return { ok: true, rows: [] };
    }
    const out: T[] = [];
    for (let i = 0; i < values.length; i += ScenarioVerifyService.IN_CHUNK) {
      const chunk = values.slice(i, i + ScenarioVerifyService.IN_CHUNK);
      try {
        const { data, error } = await build(this.dbService.getClient(), chunk);
        if (error) {
          reads.push({ table, ok: false, error: error.message });
          return { ok: false, error: error.message };
        }
        const rows = (data ?? []) as T[];
        if (rows.length >= ScenarioVerifyService.POSTGREST_MAX_ROWS) {
          // Landing exactly on PostgREST's server-side cap means the response
          // is a page, not a set. Saying so is the whole rule.
          reads.push({
            table,
            ok: false,
            error: `response hit PostgREST's ${ScenarioVerifyService.POSTGREST_MAX_ROWS}-row cap — this is a page, not a complete set`,
            rows: rows.length,
          });
          return {
            ok: false,
            error: `response hit PostgREST's ${ScenarioVerifyService.POSTGREST_MAX_ROWS}-row cap`,
          };
        }
        out.push(...rows);
      } catch (e: any) {
        const message = e?.message ?? String(e);
        reads.push({ table, ok: false, error: message });
        return { ok: false, error: message };
      }
    }
    reads.push({ table, ok: true, rows: out.length });
    return { ok: true, rows: out };
  }

  /** Every check id, all `unverifiable`, with one reason. Never a short table. */
  private everyCheckUnverifiable(reason: string): VerifyCheckRow[] {
    return Object.entries(ScenarioVerifyService.TITLES).map(([id, title]) => ({
      id,
      title,
      status: "unverifiable" as const,
      expected: null,
      actual: null,
      detail: reason,
    }));
  }

  private assemble(
    run: ScenarioRunRow,
    verifiedAt: string,
    checks: VerifyCheckRow[],
    reads: ReadRecord[],
  ): ScenarioVerifyResult {
    const summary = {
      pass: checks.filter((c) => c.status === "pass").length,
      fail: checks.filter((c) => c.status === "fail").length,
      unverifiable: checks.filter((c) => c.status === "unverifiable").length,
      total: checks.length,
    };
    return {
      runId: run.id,
      restaurantId: run.restaurant_id,
      scenario: run.scenario ?? null,
      seed: run.seed ?? null,
      serviceDate: run.service_date ?? null,
      postedAt: run.posted_at ?? null,
      verifiedAt,
      summary,
      checks,
      reads,
    };
  }
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/** Two money-ish numbers within a tolerance; either being null is a mismatch. */
function within(
  a: number | null | undefined,
  b: number | null | undefined,
  tol: number,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

/** Same instant, compared as instants — not as strings. Both null is equal. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

/** Days from a YYYY-MM-DD to today, inclusive of both. `null` if unparseable. */
export function daysBackInclusive(
  date: string,
  now = new Date(),
): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const span = Math.floor((today - then) / 86400000) + 1;
  return span >= 1 ? span : null;
}

/** The calendar day after a YYYY-MM-DD, or null. */
export function nextDay(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1),
  );
  return d.toISOString().slice(0, 10);
}

/**
 * The UTC instants bounding one LOCAL calendar day in `timeZone`.
 *
 * Two passes: the first offset is measured at the naive UTC midnight, the
 * second at the instant that produced — which is what makes a DST transition
 * land on the right side of the boundary instead of an hour out.
 * Throws `RangeError` for a timezone this runtime does not know, which the
 * caller turns into `unverifiable` rather than a guess.
 */
export function localDayBounds(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`'${date}' is not a YYYY-MM-DD date`);
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const resolve = (target: number) => {
    let ts = target - tzOffsetMs(timeZone, new Date(target));
    ts = target - tzOffsetMs(timeZone, new Date(ts));
    return new Date(ts);
  };
  return { start: resolve(naive), end: resolve(naive + 86400000) };
}

function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  let hour = get("hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}
