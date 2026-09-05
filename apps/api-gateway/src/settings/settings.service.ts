import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  SettingsAuditService,
  type FieldChange,
} from "../settings-audit/settings-audit.service";
import {
  FeatureFlagsDto,
  UpdateFeatureFlagsDto,
} from "./dto/feature-flags.dto";
import {
  ACTIVE_FEATURE_FLAGS,
  ACTIVE_FEATURE_FLAG_KEYS,
  FEATURE_FLAGS_TABLE,
  SETTINGS_ROW_FLAG_NAME,
  defaultActiveFlags,
  isActiveFeatureFlag,
} from "./feature-flag-registry";

const ACTIVE_COLUMNS = ACTIVE_FEATURE_FLAG_KEYS.join(", ");

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  /**
   * Read the restaurant's settings row.
   *
   * No row means "never configured", which is a real state and answers with the
   * registry defaults. A read ERROR is not that state, and is raised rather
   * than swallowed: silently returning defaults would show a manager an
   * autonomy dial reading OFF when the truth is that we could not find out
   * (ADR 0020 — an error must never render as emptiness).
   */
  async getFeatureFlags(restaurantId: string): Promise<FeatureFlagsDto> {
    const { data, error } = await this.databaseService.client
      .from(FEATURE_FLAGS_TABLE)
      .select(ACTIVE_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("flag_name", SETTINGS_ROW_FLAG_NAME)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Error fetching feature flags for ${restaurantId}: ${(error as { message?: string }).message}`,
      );
      throw new InternalServerErrorException(
        "Could not read your feature settings.",
      );
    }

    return this.normalize(data as unknown as Record<string, unknown> | null);
  }

  /**
   * Write the restaurant's settings row.
   *
   * Only keys in the registry are forwarded. The previous implementation
   * forwarded every DTO key straight to PostgREST, and since none of those 22
   * columns exist, the statement failed and the user saw "Failed to save
   * settings" with no explanation of which of their 22 switches was at fault
   * (the answer being: all of them).
   *
   * WHY THE BEFORE-STATE IS READ (added 2026-09-03)
   * ----------------------------------------------
   * `restaurant_feature_flags` has `created_at` and no update column
   * (baseline:5097-5105), so until now the most consequential switch in the
   * product — `enable_ai_autonomous_send`, which lets an AI email a vendor with
   * nobody reading it — could be granted with no record of who granted it or
   * when. The upsert below already had every value it needed EXCEPT the
   * previous one, and threw it away. It now reads first, so the audit row can
   * carry `{from, to}` per key rather than only "somebody set this to true".
   *
   * The read is best-effort by design: if it fails, the write still happens and
   * the audit row records `from: null`. Refusing to change a setting because
   * the *previous* value could not be read would make a database hiccup look
   * like a permissions failure.
   */
  async updateFeatureFlags(
    restaurantId: string,
    updateDto: UpdateFeatureFlagsDto,
    actorUserId?: string | null,
  ): Promise<FeatureFlagsDto> {
    const patch: Record<string, boolean> = {};
    for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
      const value = (updateDto as Record<string, unknown>)[key];
      if (typeof value === "boolean") patch[key] = value;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException(
        `No settable feature flag in the request. Settable flags: ${ACTIVE_FEATURE_FLAG_KEYS.join(", ")}.`,
      );
    }

    const before = await this.readFlagsForAudit(restaurantId);

    const { data, error } = await this.databaseService.client
      .from(FEATURE_FLAGS_TABLE)
      .upsert(
        {
          restaurant_id: restaurantId,
          flag_name: SETTINGS_ROW_FLAG_NAME,
          ...patch,
        },
        { onConflict: "restaurant_id,flag_name" },
      )
      .select(ACTIVE_COLUMNS)
      .single();

    if (error) {
      this.logger.error(
        `Error saving feature flags for ${restaurantId}: ${(error as { message?: string }).message}`,
      );
      throw new InternalServerErrorException(
        "Could not save your feature settings. Nothing was changed.",
      );
    }

    const after = this.normalize(
      data as unknown as Record<string, unknown> | null,
    ) as unknown as Record<string, boolean>;

    // One audit row per SAVE, carrying only the keys that actually moved. A row
    // per key would fill the ledger with a burst every time somebody toggles
    // two switches, and a row per save with no diff would say nothing at all.
    // The keys are walked from the ALLOWLIST, not from the request. Going
    // through `Object.keys(patch)` launders a request-controlled string into a
    // property write (`__proto__` included); iterating the constant keeps the
    // allowlist visible at the write itself.
    const fields: Record<string, FieldChange> = {};
    for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const from = before ? (before[key] ?? null) : null;
      const to = after[key] ?? patch[key];
      if (from !== to) fields[key] = { from, to };
    }
    await this.audit.record({
      restaurantId,
      actorUserId: actorUserId ?? "",
      action: "feature_flag_changed",
      register: "features",
      entityType: "restaurant_feature_flag",
      // The flags row is per restaurant, so the restaurant IS the entity.
      entityId: restaurantId,
      subject: Object.keys(fields).join(", ") || null,
      fields,
    });

    return after as unknown as FeatureFlagsDto;
  }

  /**
   * The flags as they stand, for the audit diff only.
   *
   * Deliberately NOT `getFeatureFlags`: that one throws on a read error, which
   * is right for a page asking what the settings are and wrong here, where a
   * failed read must not cancel a write the user has already asked for.
   */
  private async readFlagsForAudit(
    restaurantId: string,
  ): Promise<Record<string, boolean> | null> {
    try {
      const { data, error } = await this.databaseService.client
        .from(FEATURE_FLAGS_TABLE)
        .select(ACTIVE_COLUMNS)
        .eq("restaurant_id", restaurantId)
        .eq("flag_name", SETTINGS_ROW_FLAG_NAME)
        .maybeSingle();
      if (error) {
        this.logger.warn(
          `Feature flags could not be read before the write; the audit row will show no previous value: ${error.message}`,
        );
        return null;
      }
      return this.normalize(
        data as unknown as Record<string, unknown> | null,
      ) as unknown as Record<string, boolean>;
    } catch (err: unknown) {
      this.logger.warn(
        `Feature flags could not be read before the write: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Answer for one named flag.
   *
   * `active: false` is the important half. This used to call a
   * `get_restaurant_feature_flag()` RPC that exists in no applied migration,
   * and returned TRUE whenever the call errored — so every dead flag, and every
   * misspelling, answered "enabled: true".
   */
  async isFeatureEnabled(
    restaurantId: string,
    featureName: string,
  ): Promise<{ enabled: boolean; active: boolean }> {
    if (!isActiveFeatureFlag(featureName)) {
      return { enabled: false, active: false };
    }
    const flags = await this.getFeatureFlags(restaurantId);
    return {
      enabled:
        (flags as unknown as Record<string, boolean>)[featureName] === true,
      active: true,
    };
  }

  /**
   * Coerce a row (or its absence) into definite booleans. Anything that is not
   * literally `true`/`false` in the column falls back to the registry default,
   * so a NULL can never be read as "on".
   */
  private normalize(row: Record<string, unknown> | null): FeatureFlagsDto {
    const defaults = defaultActiveFlags();
    const out: Record<string, boolean> = {};
    for (const spec of ACTIVE_FEATURE_FLAGS) {
      const value = row?.[spec.key];
      out[spec.key] = typeof value === "boolean" ? value : defaults[spec.key];
    }
    return out as unknown as FeatureFlagsDto;
  }
}
