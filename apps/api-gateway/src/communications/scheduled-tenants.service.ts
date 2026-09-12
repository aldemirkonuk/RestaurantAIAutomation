import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";

/**
 * One restaurant a scheduled job is meant to serve.
 *
 * `timezone` is carried but NOT yet honoured — every `@Cron` in
 * scheduled-tasks.service.ts is still pinned to `America/New_York`, so a 9am
 * digest fires at 9am New York for a restaurant in Istanbul. That is a separate
 * defect (OD-90), deliberately not fixed here: honouring it needs per-tenant
 * scheduling, not a per-tenant loop. The field exists so the fix has somewhere
 * to land and so the gap is visible in the type rather than only in prose.
 */
export interface ScheduledTenant {
  id: string;
  name: string;
  timezone: string;
  /**
   * True for the single restaurant named by `DEFAULT_RESTAURANT_ID` — the one
   * that already receives scheduled mail today.
   *
   * It exists to freeze that restaurant's behaviour byte-for-byte while the
   * jobs learn to serve others: the legacy tenant keeps reading MANAGER_EMAIL /
   * MANAGER_PHONE and keeps the resolver's env fallback, and no newly opted-in
   * tenant gets either. Without this flag, opting in a second restaurant mails
   * ITS data to the FIRST one's configured address (see
   * RecipientResolverService.getDefaultRecipients).
   */
  isLegacyDefault: boolean;
}

export interface PerTenantRunSummary {
  tenants: number;
  succeeded: number;
  failed: number;
}

/**
 * Which restaurants do the scheduled communications jobs serve?
 *
 * ADR 0022. Every cron in `scheduled-tasks.service.ts` used to read one
 * `DEFAULT_RESTAURANT_ID` env var, so every other restaurant silently received
 * no email, SMS or notification at all (OD-87).
 *
 * The naive repair — "loop over all active restaurants" — is worse than the
 * bug. Verified against production on 2026-08-26: `restaurants` holds 10 rows,
 * all `is_active = true` and none soft-deleted, but only ONE
 * (`Meyhouse Palo Alto`, 3 members / 50 inventory rows) is a real tenant. The
 * other nine are the founder's own dev and demo signups, indistinguishable by
 * any column. Iterating them would turn a quiet no-op into ten restaurants'
 * worth of outbound mail on the first run after deploy.
 *
 * So enumeration is EXPLICIT OPT-IN, held in the `restaurant_feature_flags` EAV
 * table under `flag_name = 'scheduled_communications'`:
 *
 *   - Today no such flag row exists, so `list()` returns exactly
 *     `[DEFAULT_RESTAURANT_ID]` and behaviour is unchanged for everyone.
 *   - Onboarding a second restaurant is one INSERT, no deploy.
 *
 * Whether every existing tenant should be opted in by default is the founder's
 * call, recorded as OD-91 — not defaulted here.
 */
@Injectable()
export class ScheduledTenantsService {
  private readonly logger = new Logger(ScheduledTenantsService.name);

  /** `restaurant_feature_flags.flag_name` that opts a restaurant in. */
  static readonly OPT_IN_FLAG = "scheduled_communications";

  private readonly legacyTenantId: string | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {
    this.legacyTenantId =
      this.configService.get<string>("DEFAULT_RESTAURANT_ID") || null;
  }

  /**
   * The restaurants scheduled jobs should serve, in a stable order.
   *
   * Throws rather than returning `[]` on a database failure. Returning an empty
   * list would reproduce OD-87 exactly — jobs doing nothing, quietly — and the
   * whole point of this change is that silence is the disease.
   */
  async list(): Promise<ScheduledTenant[]> {
    const client = this.databaseService.getClient();

    const { data: flagRows, error: flagError } = await client
      .from("restaurant_feature_flags")
      .select("restaurant_id")
      .eq("flag_name", ScheduledTenantsService.OPT_IN_FLAG)
      .eq("enabled", true);

    if (flagError) {
      throw new Error(
        `could not read ${ScheduledTenantsService.OPT_IN_FLAG} flags: ${flagError.message}`,
      );
    }

    const ids = new Set<string>();
    if (this.legacyTenantId) ids.add(this.legacyTenantId);
    for (const row of flagRows || []) {
      if (row?.restaurant_id) ids.add(row.restaurant_id);
    }

    if (ids.size === 0) {
      this.logger.warn(
        "SCHEDULED_TENANTS_EMPTY — no DEFAULT_RESTAURANT_ID and no restaurant " +
          `opted in via ${ScheduledTenantsService.OPT_IN_FLAG}; scheduled jobs will do nothing.`,
      );
      return [];
    }

    // `is_active` / `deleted_at` are applied to the legacy tenant too: a
    // deactivated restaurant must stop receiving mail. When that silences the
    // configured default it is said out loud below rather than inferred from an
    // empty inbox.
    const { data: rows, error } = await client
      .from("restaurants")
      .select("id, name, timezone")
      .in("id", Array.from(ids))
      .eq("is_active", true)
      .is("deleted_at", null);

    if (error) {
      throw new Error(`could not enumerate restaurants: ${error.message}`);
    }

    const tenants: ScheduledTenant[] = (rows || []).map((row: any) => ({
      id: row.id,
      name: row.name || "Restaurant",
      timezone: row.timezone || "America/New_York",
      isLegacyDefault: row.id === this.legacyTenantId,
    }));

    if (this.legacyTenantId && !tenants.some((t) => t.isLegacyDefault)) {
      this.logger.error(
        `SCHEDULED_TENANTS_DEFAULT_MISSING restaurant=${this.legacyTenantId} — ` +
          "DEFAULT_RESTAURANT_ID names a restaurant that is inactive, deleted or absent. " +
          "It will receive no scheduled communications.",
      );
    }

    // Stable order so a run is reproducible and logs line up between runs.
    tenants.sort((a, b) => a.id.localeCompare(b.id));
    return tenants;
  }

  /**
   * Run one job body once per tenant, sequentially, isolating failures.
   *
   * SEQUENTIAL, not concurrent, and uncapped — both deliberate. These bodies
   * send email and SMS through shared provider credentials, where parallelism
   * buys nothing at this scale and risks a rate-limit burst; and because
   * enumeration is opt-in, the tenant count is bounded by an explicit human
   * INSERT rather than by table growth, so a per-run cap here would be
   * machinery that could never fire.
   *
   * One tenant throwing must never cost the others their run, so every body is
   * wrapped individually. The per-run summary is logged unconditionally: a job
   * that fails for 9 of 10 restaurants must not look like a job that worked.
   */
  async runPerTenant(
    jobName: string,
    body: (tenant: ScheduledTenant) => Promise<void>,
  ): Promise<PerTenantRunSummary> {
    let tenants: ScheduledTenant[];
    try {
      tenants = await this.list();
    } catch (error: any) {
      this.logger.error(
        `SCHEDULED_JOB_ENUMERATION_FAILED job=${jobName} — ${error?.message}. ` +
          "No restaurant was served by this run.",
      );
      return { tenants: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const tenant of tenants) {
      try {
        await body(tenant);
        succeeded++;
      } catch (error: any) {
        failed++;
        this.logger.error(
          `SCHEDULED_JOB_TENANT_FAILED job=${jobName} restaurant=${tenant.id} ` +
            `(${tenant.name}) — ${error?.message}`,
        );
      }
    }

    const summary: PerTenantRunSummary = {
      tenants: tenants.length,
      succeeded,
      failed,
    };
    this.logger.log(
      `SCHEDULED_JOB_SUMMARY job=${jobName} tenants=${summary.tenants} ` +
        `succeeded=${summary.succeeded} failed=${summary.failed}`,
    );
    return summary;
  }
}
