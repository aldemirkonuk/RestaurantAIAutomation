import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  SettingsAuditService,
  type FieldChange,
} from "../settings-audit/settings-audit.service";
import {
  APPROVAL_RULES,
  retrospective,
  type ApprovalRule,
  type OrderUnderTest,
  type RetrospectiveCount,
  type ThresholdRow,
} from "./approval-thresholds";
import type { SetApprovalThresholdDto } from "../vendor-terms/dto/vendor-terms.dto";

/**
 * The house's own ceiling — stored, audited, and now enforced.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS SERVICE MUST NOT DO
 * ---------------------------------------------------------------------------
 * It must not let the register imply anything about enforcement that is not
 * true of the code. For two passes that meant carrying `enforcement.enforcedBy:
 * []` and the exact file where enforcement had to land, because
 * `ProcurementService.approveOrder` read neither a role nor an amount and a
 * policy page that let a manager believe a ceiling was holding would have been
 * [[absence-reported-as-health]] pointed at money.
 *
 * **Changed 2026-09-03 (ADR 0112).** `approveOrder` now reads the order, reads
 * these rules through THIS service, resolves the actor's role at the
 * restaurant, and refuses the seal — with the rule and the number in words —
 * when the actor ranks below what the rule demands. `enforcedBy` is therefore
 * non-empty, and the register's opening sentence flips itself. The rule that
 * matters is unchanged: the array is MEASURED. Remove the gate and it goes back
 * to `[]`, and the page goes back to admitting it.
 *
 * What the register does beside that: count how often each threshold WOULD have
 * fired over the orders already in the books, so the number a house chooses is
 * chosen against its own trade rather than guessed.
 *
 * WHO MAY WRITE ONE. Owner or manager only, checked server-side in
 * `SettingsController.setApprovalThreshold` via
 * `OrganizationsService.assertCanManageRestaurant`. This is the opposite call
 * from the one vendor terms made (a cutoff is operational knowledge anybody who
 * phones the vendor should record) and it is opposite on purpose: a threshold is
 * not knowledge about the world, it is the house's own limit on what may be
 * spent without a second signature, and a limit anybody may raise is not a
 * limit.
 */

/** PostgREST / Postgres codes that mean "the relation is not there". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

/** The window the retrospective reads. Matches the vendor-terms inference. */
export const RETROSPECTIVE_WINDOW_DAYS = 365;

/**
 * The one place that consults these rows before an order can be sealed.
 *
 * A constant, not a literal repeated in two fields, so `enforcedBy` and
 * `wouldBeEnforcedAt` cannot drift apart and describe two different worlds. If
 * the gate is ever removed, this constant is deleted and `enforcedBy` becomes
 * `[]` again — which is what the register renders its opening sentence from.
 */
export const ENFORCED_AT =
  "apps/api-gateway/src/procurement/procurement.service.ts approveOrder → assertApprovalAllowed";

const ORDER_ROW_CAP = 4000;

export interface ThresholdsReadout {
  restaurantId: string;
  thresholds: ThresholdRow[];
  /** True when this house has recorded no rule at all — not "unlimited". */
  policyEmpty: boolean;
  readable: boolean;
  reason: string | null;
  retrospective: {
    counts: RetrospectiveCount[];
    ordersRead: number;
    windowDays: number;
    /** Null when the ledger could not be read; never 0. */
    readable: boolean;
    reason: string | null;
    /**
     * Said in the payload rather than only in the UI: a "first order" is first
     * among the orders inside the window, so a vendor last used two years ago
     * counts as new here and would not be.
     */
    caveat: string;
  };
  enforcement: {
    /**
     * Every code path that consults these rows before letting an order be
     * sealed. EMPTY today, and the register prints that sentence.
     */
    enforcedBy: string[];
    /** Where enforcement has to be added, exactly. */
    wouldBeEnforcedAt: string;
    note: string;
  };
}

interface ThresholdDbRow {
  rule: ApprovalRule;
  enabled: boolean;
  amount_limit: string | number | null;
  percent_limit: string | number | null;
  required_role: "owner" | "manager";
  set_by: string | null;
  updated_at: string | null;
}

interface OrderRow {
  provider_id: string | null;
  inventory_id: string | null;
  requested_at: string | null;
  total_cost: string | number | null;
  final_price: string | number | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class ApprovalThresholdsService {
  private readonly logger = new Logger(ApprovalThresholdsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<ThresholdsReadout> {
    const base = this.emptyReadout(restaurantId);

    let rows: ThresholdDbRow[] = [];
    try {
      const { data, error } = await this.databaseService.client
        .from("restaurant_approval_thresholds")
        .select("rule, enabled, amount_limit, percent_limit, required_role, set_by, updated_at")
        .eq("restaurant_id", restaurantId);
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        return {
          ...base,
          readable: false,
          reason: MISSING_RELATION_CODES.has(code)
            ? "the approval-thresholds table is not present on this database"
            : error.message,
        };
      }
      rows = (data ?? []) as unknown as ThresholdDbRow[];
    } catch (err) {
      return {
        ...base,
        readable: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const actors = await this.resolveActors(
      rows.map((r) => r.set_by).filter((v): v is string => Boolean(v)),
    );

    const thresholds: ThresholdRow[] = rows.map((r) => ({
      rule: r.rule,
      enabled: r.enabled,
      amountLimit: num(r.amount_limit),
      percentLimit: num(r.percent_limit),
      requiredRole: r.required_role,
      setBy: r.set_by
        ? { userId: r.set_by, name: actors.get(r.set_by) ?? null }
        : null,
      updatedAt: r.updated_at,
    }));
    // Stable rule order, so the register does not reshuffle between reads.
    thresholds.sort(
      (a, b) => APPROVAL_RULES.indexOf(a.rule) - APPROVAL_RULES.indexOf(b.rule),
    );

    const orders = await this.readOrdersUnderTest(restaurantId);

    return {
      ...base,
      thresholds,
      policyEmpty: thresholds.length === 0,
      retrospective: {
        counts: retrospective(thresholds, orders.tests),
        ordersRead: orders.tests.length,
        windowDays: RETROSPECTIVE_WINDOW_DAYS,
        readable: orders.readable,
        reason: orders.reason,
        caveat: base.retrospective.caveat,
      },
    };
  }

  /**
   * Set or clear one rule.
   *
   * `enabled: false` KEEPS the row and its number — switching a rule back on
   * must not lose the figure somebody chose — while a `null` amount on an
   * enabled `manager_ceiling` is refused by the database's own CHECK
   * (`restaurant_approval_thresholds_rule_carries_its_number`), because a
   * ceiling with no number is a rule that cannot fire rendered as one that can.
   */
  async write(
    restaurantId: string,
    dto: SetApprovalThresholdDto,
    actorUserId: string | null,
  ): Promise<{ readout: ThresholdsReadout; audited: boolean; auditReason: string | null }> {
    const before = (await this.read(restaurantId)).thresholds.find(
      (t) => t.rule === dto.rule,
    );

    const patch = {
      restaurant_id: restaurantId,
      rule: dto.rule,
      enabled: dto.enabled,
      amount_limit: dto.amountLimit ?? null,
      percent_limit: dto.percentLimit ?? null,
      required_role: dto.requiredRole,
      set_by: actorUserId,
    };

    const { error } = await this.databaseService.client
      .from("restaurant_approval_thresholds")
      .upsert(patch, { onConflict: "restaurant_id,rule" });

    if (error) {
      this.logger.error(
        `Approval threshold ${dto.rule} was not saved: ${error.message}`,
      );
      throw new Error(
        MISSING_RELATION_CODES.has((error as { code?: string }).code ?? "")
          ? "The approval-thresholds table is not present on this database, so nothing was saved."
          : error.message,
      );
    }

    const fields: Record<string, FieldChange> = {};
    const compare = (
      key: string,
      from: unknown,
      to: unknown,
    ) => {
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
        fields[key] = { from: from ?? null, to: to ?? null };
      }
    };
    compare("enabled", before?.enabled, dto.enabled);
    compare("amount_limit", before?.amountLimit, dto.amountLimit ?? null);
    compare("percent_limit", before?.percentLimit, dto.percentLimit ?? null);
    compare("required_role", before?.requiredRole, dto.requiredRole);

    const receipt = await this.audit.record({
      restaurantId,
      actorUserId: actorUserId ?? "",
      action: "approval_threshold_changed",
      register: "thresholds",
      entityType: "approval_threshold",
      entityId: restaurantId,
      subject: dto.rule,
      fields,
    });

    return {
      readout: await this.read(restaurantId),
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /* ── Reads ─────────────────────────────────────────────────────────────── */

  /**
   * Every order in the window, reduced to the three facts a rule tests.
   *
   * `isFirstOrderToVendor` and `pricePremiumPct` are both computed IN THIS
   * WINDOW and nowhere else — the caveat travels with the number in the payload
   * rather than being left for the UI to remember.
   */
  private async readOrdersUnderTest(restaurantId: string): Promise<{
    tests: OrderUnderTest[];
    readable: boolean;
    reason: string | null;
  }> {
    const since = new Date(
      Date.now() - RETROSPECTIVE_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    let rows: OrderRow[] = [];
    try {
      const { data, error } = await this.databaseService.client
        .from("procurement_orders")
        .select("provider_id, inventory_id, requested_at, total_cost, final_price")
        .eq("restaurant_id", restaurantId)
        .gte("requested_at", since)
        .order("requested_at", { ascending: true })
        .limit(ORDER_ROW_CAP);
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        return {
          tests: [],
          readable: false,
          reason: MISSING_RELATION_CODES.has(code)
            ? "the order ledger is not present on this database"
            : error.message,
        };
      }
      rows = (data ?? []) as unknown as OrderRow[];
    } catch (err) {
      return {
        tests: [],
        readable: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const seenVendors = new Set<string>();
    const lastPriceByItem = new Map<string, number>();
    const tests: OrderUnderTest[] = [];

    // Ascending, so "first" and "last price" mean what they say as the walk
    // moves forward through the year.
    for (const r of rows) {
      const vendor = r.provider_id;
      const isFirst = vendor ? !seenVendors.has(vendor) : null;
      if (vendor) seenVendors.add(vendor);

      const unit = num(r.final_price);
      let premium: number | null = null;
      if (r.inventory_id && unit !== null && unit > 0) {
        const prior = lastPriceByItem.get(r.inventory_id);
        if (prior !== undefined && prior > 0) {
          premium = ((unit - prior) / prior) * 100;
        }
        lastPriceByItem.set(r.inventory_id, unit);
      }

      tests.push({
        total: num(r.total_cost),
        isFirstOrderToVendor: isFirst,
        pricePremiumPct: premium,
      });
    }

    return { tests, readable: true, reason: null };
  }

  private async resolveActors(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return out;
    try {
      const { data } = await this.databaseService.client
        .from("users")
        .select("user_id, name")
        .in("user_id", unique);
      for (const r of (data ?? []) as Array<{ user_id: string; name: string | null }>) {
        out.set(r.user_id, r.name ?? null);
      }
    } catch {
      // A name we cannot resolve renders as the id, never as "nobody".
    }
    return out;
  }

  private emptyReadout(restaurantId: string): ThresholdsReadout {
    return {
      restaurantId,
      thresholds: [],
      policyEmpty: true,
      readable: true,
      reason: null,
      retrospective: {
        counts: [],
        ordersRead: 0,
        windowDays: RETROSPECTIVE_WINDOW_DAYS,
        readable: true,
        reason: null,
        caveat: `Counted over the last ${RETROSPECTIVE_WINDOW_DAYS} days only: a vendor last used before that window reads as new here, and a price with no earlier price inside the window has no premium to compare.`,
      },
      enforcement: {
        // Measured, not assumed: every code path that consults these rows
        // before an order can be sealed. It was EMPTY for two passes and the
        // register's first sentence said so. It is no longer empty, and the
        // register now says THAT — from this array, not from a rewritten
        // string, so the day enforcement is removed the page goes back to
        // admitting it.
        enforcedBy: [ENFORCED_AT],
        wouldBeEnforcedAt: ENFORCED_AT,
        note: "approveOrder reads the order, reads these rules, resolves the actor's role at this restaurant, and refuses the seal with the rule and the number in words when the actor ranks below what the rule demands. The refused order is parked in APPROVAL_NEEDED and the refusal is filed in system_audit_log as order_approval_refused.",
      },
    };
  }
}
