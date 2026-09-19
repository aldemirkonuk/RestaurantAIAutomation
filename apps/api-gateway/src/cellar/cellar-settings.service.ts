import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import type { SetCellarSettingsDto } from "./dto/cellar-settings.dto";
import {
  DEFAULT_GAZETTEER_MEASURES,
  GAZETTEER_MEASURE_IDS,
  type GazetteerMeasureId,
  type HoldCeremony,
} from "./dto/hold-ceremony";

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
  setBy: string | null;
  setAt: string | null;
  /** Null when the table could not be read — genuinely unknown, never a default dressed up as one. */
  readable: boolean;
  readError: string | null;
}

interface SettingsRow {
  hold_ceremony: string;
  gazetteer_measures: string[] | null;
  set_by: string | null;
  set_at: string | null;
}

function sanitizeMeasures(ids: string[] | null): GazetteerMeasureId[] | null {
  if (ids === null) return null;
  const known = new Set<string>(GAZETTEER_MEASURE_IDS);
  return ids.filter((id): id is GazetteerMeasureId => known.has(id));
}

@Injectable()
export class CellarSettingsService {
  private readonly logger = new Logger(CellarSettingsService.name);

  constructor(private readonly dbService: DatabaseService) {}

  async read(restaurantId: string): Promise<CellarSettingsReadout> {
    const { data, error } = await this.dbService
      .getClient()
      .from("restaurant_cellar_settings")
      .select("hold_ceremony, gazetteer_measures, set_by, set_at")
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
        readable: false,
        readError: missing
          ? "the restaurant_cellar_settings table is not on this database yet — the migration has not been applied"
          : error.message,
      };
    }

    const row = data as SettingsRow | null;
    const storedMeasures = row ? sanitizeMeasures(row.gazetteer_measures) : null;

    return {
      restaurantId,
      holdCeremony: (row?.hold_ceremony as HoldCeremony | undefined) ?? "hold",
      holdCeremonyConfigured: row !== null,
      gazetteerMeasures: storedMeasures ?? DEFAULT_GAZETTEER_MEASURES,
      gazetteerMeasuresConfigured: storedMeasures !== null,
      setBy: row?.set_by ?? null,
      setAt: row?.set_at ?? null,
      readable: true,
      readError: null,
    };
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
        ? sanitizeMeasures(dto.gazetteerMeasures) ?? []
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
            MISSING_RELATION_CODES.has(String((error as { code?: string }).code))
              ? " (the restaurant_cellar_settings table is not on this database yet — the migration has not been applied)"
              : ""
          }`,
        ),
        { code: (error as { code?: string }).code },
      );
    }

    return this.read(restaurantId);
  }
}
