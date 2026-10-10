import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";
import type { SetCellarSettingsDto } from "./dto/cellar-settings.dto";
import {
  DEFAULT_GAZETTEER_MEASURES,
  GAZETTEER_MEASURE_IDS,
  type GazetteerMeasureId,
  type HoldCeremony,
} from "./dto/hold-ceremony";

/**
 * F-503: each field files its own row under the "cellar-settings" register,
 * and the newest row of each action is that field's setter. The table's own
 * `set_by` / `set_at` are shared by both fields, so they only ever say who
 * touched either one last.
 */
export const HOLD_CEREMONY_AUDIT_ACTION =
  "cellar_hold_ceremony_changed" as const;
export const TILES_AUDIT_ACTION = "cellar_tiles_changed" as const;

/**
 * Rows created before the fields filed their own setters. On those a row
 * meant "somebody saved the ceremony" (the only way in at the time this was
 * read that way), so they keep reading as a chosen ceremony. A row created
 * after it counts as a chosen ceremony only when the ceremony itself was
 * filed — a tile-only first save no longer reads as one.
 */
export const CELLAR_FIELD_STAMPS_SINCE = "2026-10-10T00:00:00Z";

/** The table does not exist on every database until the migration lands. */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST202"]);

export interface CellarSettingsReadout {
  restaurantId: string;
  holdCeremony: HoldCeremony;
  /** True only once a person has actually saved a ceremony choice. */
  holdCeremonyConfigured: boolean;
  gazetteerMeasures: GazetteerMeasureId[];
  /** True only once a person has actually saved a measure list. */
  gazetteerMeasuresConfigured: boolean;
  /** Who touched EITHER field last — the row's own shared stamp. */
  setBy: string | null;
  setAt: string | null;
  /** Who chose the ceremony, and when; null when no filed row says so. */
  holdCeremonySetBy: string | null;
  holdCeremonySetAt: string | null;
  /** Who chose the tiles, and when; null when no filed row says so. */
  gazetteerMeasuresSetBy: string | null;
  gazetteerMeasuresSetAt: string | null;
  /** Null when the table could not be read — genuinely unknown, never a default dressed up as one. */
  readable: boolean;
  readError: string | null;
}

interface SettingsRow {
  hold_ceremony: string;
  gazetteer_measures: string[] | null;
  set_by: string | null;
  set_at: string | null;
  created_at?: string | null;
}

interface FieldStamp {
  by: string | null;
  at: string | null;
}

const NO_STAMPS = {
  holdCeremonySetBy: null,
  holdCeremonySetAt: null,
  gazetteerMeasuresSetBy: null,
  gazetteerMeasuresSetAt: null,
};

function sanitizeMeasures(ids: string[] | null): GazetteerMeasureId[] | null {
  if (ids === null) return null;
  const known = new Set<string>(GAZETTEER_MEASURE_IDS);
  return ids.filter((id): id is GazetteerMeasureId => known.has(id));
}

@Injectable()
export class CellarSettingsService {
  private readonly logger = new Logger(CellarSettingsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<CellarSettingsReadout> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_cellar_settings")
      .select("hold_ceremony, gazetteer_measures, set_by, set_at, created_at")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      const missing = MISSING_RELATION_CODES.has(
        String((error as { code?: string }).code),
      );
      if (!missing) {
        this.logger.error(
          `Failed to read cellar settings for ${restaurantId}: ${error.message}`,
        );
      }
      return {
        restaurantId,
        holdCeremony: "hold",
        holdCeremonyConfigured: false,
        gazetteerMeasures: DEFAULT_GAZETTEER_MEASURES,
        gazetteerMeasuresConfigured: false,
        setBy: null,
        setAt: null,
        ...NO_STAMPS,
        readable: false,
        readError: missing
          ? "the restaurant_cellar_settings table is not on this database yet — the migration has not been applied"
          : error.message,
      };
    }

    const row = data as SettingsRow | null;
    const storedMeasures = row
      ? sanitizeMeasures(row.gazetteer_measures)
      : null;
    const stamps = row ? await this.fieldStamps(restaurantId) : null;
    const createdMs = row?.created_at ? Date.parse(row.created_at) : NaN;
    const legacyRow =
      !Number.isFinite(createdMs) ||
      createdMs < Date.parse(CELLAR_FIELD_STAMPS_SINCE);

    return {
      restaurantId,
      holdCeremony: (row?.hold_ceremony as HoldCeremony | undefined) ?? "hold",
      // An unreadable trail keeps the row's old meaning rather than hiding a
      // ceremony somebody chose.
      holdCeremonyConfigured:
        row !== null &&
        (stamps === null || stamps.ceremony !== null || legacyRow),
      gazetteerMeasures: storedMeasures ?? DEFAULT_GAZETTEER_MEASURES,
      gazetteerMeasuresConfigured: storedMeasures !== null,
      setBy: row?.set_by ?? null,
      setAt: row?.set_at ?? null,
      holdCeremonySetBy: stamps?.ceremony?.by ?? null,
      holdCeremonySetAt: stamps?.ceremony?.at ?? null,
      gazetteerMeasuresSetBy: stamps?.tiles?.by ?? null,
      gazetteerMeasuresSetAt: stamps?.tiles?.at ?? null,
      readable: true,
      readError: null,
    };
  }

  /**
   * The newest filed row for each field, or null when the trail could not be
   * read (said in the log, never read as "nobody chose").
   */
  private async fieldStamps(
    restaurantId: string,
  ): Promise<{ ceremony: FieldStamp | null; tiles: FieldStamp | null } | null> {
    try {
      const { data, error } = await this.dbService
        .getClient()
        .from("system_audit_log")
        .select("actor_id, action, created_at")
        .eq("restaurant_id", restaurantId)
        .in("action", [HOLD_CEREMONY_AUDIT_ACTION, TILES_AUDIT_ACTION])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        this.logger.warn(
          `The cellar settings' own trail could not be read for ${restaurantId}: ${error.message}`,
        );
        return null;
      }
      const rows = (data ?? []) as Array<{
        actor_id: string | null;
        action: string;
        created_at: string | null;
      }>;
      const newest = (action: string): FieldStamp | null => {
        const r = rows.find((x) => x.action === action);
        return r ? { by: r.actor_id ?? null, at: r.created_at ?? null } : null;
      };
      return {
        ceremony: newest(HOLD_CEREMONY_AUDIT_ACTION),
        tiles: newest(TILES_AUDIT_ACTION),
      };
    } catch (err: unknown) {
      this.logger.warn(
        `The cellar settings' own trail threw for ${restaurantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async write(
    restaurantId: string,
    dto: SetCellarSettingsDto,
    userId: string | null,
    userRole: string | null,
  ): Promise<CellarSettingsReadout> {
    // ADR 0160 sec110 item 6, answered 2026-09-18: "owners and managers" may
    // change the order-hold ceremony; staff see it but cannot change it — a
    // one-click "auto" switch is a standing decision to skip the
    // are-you-sure on every future order, so it gets the same gate as any
    // other money-moving setting (RolesGuard's own owner/manager/admin
    // vocabulary, `auth/guards/roles.guard.ts`). `gazetteerMeasures` is NOT
    // gated — the founder never restricted who may choose which tiles show —
    // so this checks the ONE field this PATCH is actually changing rather
    // than gating the whole endpoint, which would also block a server whose
    // request only touches the tile list.
    const role = userRole?.toLowerCase() ?? null;
    if (
      dto.holdCeremony !== undefined &&
      role !== "owner" &&
      role !== "manager" &&
      role !== "admin"
    ) {
      throw Object.assign(
        new Error(
          "Only an owner or a manager of this house may change the order-hold ceremony. Nothing was changed.",
        ),
        { code: "CELLAR_HOLD_CEREMONY_FORBIDDEN" },
      );
    }

    const before = await this.read(restaurantId);

    // A transient read failure must refuse the write, not proceed on
    // `before`'s unread-default shape. Proceeding used to upsert
    // `holdCeremony: 'hold'` and `gazetteerMeasures: null` over whatever the
    // house had actually stored — a silent overwrite of the untouched field
    // triggered by a write that only meant to change the OTHER one, on
    // nothing more than a flaky read.
    if (!before.readable) {
      throw Object.assign(
        new Error(
          `The house's current cellar settings could not be read, so nothing was changed: ${before.readError ?? "unknown reason"}`,
        ),
        { code: "CELLAR_SETTINGS_UNREADABLE" },
      );
    }

    const now = new Date().toISOString();

    const nextCeremony = dto.holdCeremony ?? before.holdCeremony;
    const nextMeasures =
      dto.gazetteerMeasures !== undefined
        ? (sanitizeMeasures(dto.gazetteerMeasures) ?? [])
        : before.gazetteerMeasuresConfigured
          ? before.gazetteerMeasures
          : null;

    const { error } = await this.dbService
      .getClient()
      .from("restaurant_cellar_settings")
      .upsert(
        {
          restaurant_id: restaurantId,
          hold_ceremony: nextCeremony,
          gazetteer_measures: nextMeasures,
          set_by: userId,
          set_at: now,
          updated_at: now,
        },
        { onConflict: "restaurant_id" },
      );

    if (error) {
      this.logger.error(
        `Failed to record cellar settings for ${restaurantId}: ${error.message}`,
      );
      throw Object.assign(
        new Error(
          `The house's cellar settings were not saved: ${error.message}${
            MISSING_RELATION_CODES.has(
              String((error as { code?: string }).code),
            )
              ? " (the restaurant_cellar_settings table is not on this database yet — the migration has not been applied)"
              : ""
          }`,
        ),
        { code: (error as { code?: string }).code },
      );
    }

    // F-503: each field files its own row, and only a field this write moved.
    // A ceremony that was never chosen counts as moved even when the choice
    // matches the default: choosing "hold" is still a choice.
    if (userId) {
      if (
        dto.holdCeremony !== undefined &&
        (!before.holdCeremonyConfigured ||
          dto.holdCeremony !== before.holdCeremony)
      ) {
        await this.audit.record({
          restaurantId,
          actorUserId: userId,
          action: HOLD_CEREMONY_AUDIT_ACTION,
          register: "cellar-settings",
          entityType: "restaurant_cellar_settings",
          entityId: restaurantId,
          subject: "order-hold ceremony",
          fields: {
            hold_ceremony: {
              from: before.holdCeremonyConfigured ? before.holdCeremony : null,
              to: nextCeremony,
            },
          },
        });
      }
      const priorMeasures = before.gazetteerMeasuresConfigured
        ? before.gazetteerMeasures
        : null;
      if (
        dto.gazetteerMeasures !== undefined &&
        JSON.stringify(priorMeasures) !== JSON.stringify(nextMeasures)
      ) {
        await this.audit.record({
          restaurantId,
          actorUserId: userId,
          action: TILES_AUDIT_ACTION,
          register: "cellar-settings",
          entityType: "restaurant_cellar_settings",
          entityId: restaurantId,
          subject: "tiles shown tonight",
          fields: {
            gazetteer_measures: { from: priorMeasures, to: nextMeasures },
          },
        });
      }
    }

    return this.read(restaurantId);
  }
}
