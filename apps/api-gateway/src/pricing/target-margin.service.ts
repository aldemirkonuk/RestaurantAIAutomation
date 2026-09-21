import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * The margin this house needs on a bottle and on a glass, and how close is
 * close enough (ADR 0193).
 *
 * THE FOUNDER, 2026-09-21, verbatim: "... advise the manager or owner to
 * increase decrease the prices so that the profit margin is where it's
 * needed." He picked "Advise to target margin". "Where it's needed" is a
 * number only the house knows, so it is typed by an owner or manager and
 * NEVER defaulted: a house with no target gets "no target set" on every wine.
 *
 * The rules are the carrying-cost register's (house-carrying-cost.service.ts):
 *   1. Explicit, never silent. Written only from numbers in the request body;
 *      nothing derived, nothing written on a read, no default anywhere
 *      (20260921113100 asserts the columns carry none).
 *   2. Shape checked here exactly as the database checks it: a target is a
 *      PERCENT between 5 and 95 (0.65, the fraction spelling, is refused with
 *      a sentence), the band is 0 to 20 margin points and is required with a
 *      target.
 *   3. Audited, or the caller is told it was not (`audited` / `auditReason`).
 *   4. A failed read is never an empty one: `readable: false` with the reason.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller, the same helper the flags, thresholds and carrying cost use.
 */

export const TARGET_MARGIN_MIN_PCT = 5;
export const TARGET_MARGIN_MAX_PCT = 95;
export const TARGET_BAND_MIN_PTS = 0;
export const TARGET_BAND_MAX_PTS = 20;

export const TARGET_MARGIN_AUDIT_ACTION = "target_margin_changed" as const;

export interface TargetMarginReadout {
  restaurantId: string;
  /** PERCENT (65 = 65 % gross margin on a bottle). Null = not set. */
  bottlePct: number | null;
  /** PERCENT on a glass. Null = not set (the house may set one and not the other). */
  glassPct: number | null;
  /** "Close enough", in margin points. Null = not set (and then no target is either). */
  bandPts: number | null;
  readable: boolean;
  reason: string | null;
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  audited?: boolean;
  auditReason?: string | null;
}

interface TargetRow {
  target_margin_bottle_pct: number | string | null;
  target_margin_glass_pct: number | string | null;
  target_margin_band_pts: number | string | null;
  target_margin_set_by: string | null;
  target_margin_set_at: string | null;
}

/** NUMERIC arrives from PostgREST as a string; anything unparseable is "not set". */
function asNumber(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the house's targets with the client given. Shared by this service and
 * the advice, so there is one reading of the columns. A read error is
 * returned, never swallowed into "not set".
 */
export async function readHouseTargetMargin(
  client: DatabaseService["client"],
  restaurantId: string,
): Promise<{ row: TargetRow | null; error: string | null }> {
  const { data, error } = await client
    .from("restaurants")
    .select(
      "target_margin_bottle_pct, target_margin_glass_pct, target_margin_band_pts, target_margin_set_by, target_margin_set_at",
    )
    .eq("id", restaurantId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as TargetRow | null) ?? null, error: null };
}

export function targetsFrom(row: TargetRow | null): {
  bottlePct: number | null;
  glassPct: number | null;
  bandPts: number | null;
} {
  return {
    bottlePct: asNumber(row?.target_margin_bottle_pct),
    glassPct: asNumber(row?.target_margin_glass_pct),
    bandPts: asNumber(row?.target_margin_band_pts),
  };
}

function checkPct(label: string, value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException(
      `The ${label} target is a number: the gross margin you need, as a percent of the price. Nothing was recorded.`,
    );
  }
  if (value < TARGET_MARGIN_MIN_PCT) {
    throw new BadRequestException(
      `${value} is below ${TARGET_MARGIN_MIN_PCT} percent. The ${label} target is a PERCENT: a 65 percent margin is 65, not 0.65. Nothing was recorded.`,
    );
  }
  if (value > TARGET_MARGIN_MAX_PCT) {
    throw new BadRequestException(
      `${value} percent is above ${TARGET_MARGIN_MAX_PCT}: that is a cost under a twentieth of the price. If you meant a markup, a 3x markup is a 66.7 percent margin. Nothing was recorded.`,
    );
  }
  return value;
}

@Injectable()
export class TargetMarginService {
  private readonly logger = new Logger(TargetMarginService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<TargetMarginReadout> {
    const house = await readHouseTargetMargin(this.databaseService.client, restaurantId);
    if (house.error !== null) {
      this.logger.error(`Could not read the target margin for ${restaurantId}: ${house.error}`);
      return {
        restaurantId,
        bottlePct: null,
        glassPct: null,
        bandPts: null,
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    }
    return this.shape(restaurantId, house.row, await this.nameOf(house.row));
  }

  /**
   * State the house's targets. `bottlePct` / `glassPct` may each be a number
   * or null (the house does not sell that way, or has no target for it), but
   * at least one must be a number: un-answering the question every piece of
   * price advice depends on is not a write this route offers, the same rule
   * the carrying cost holds. `bandPts` is required.
   */
  async write(
    restaurantId: string,
    body: { bottlePct?: unknown; glassPct?: unknown; bandPts?: unknown },
    actorUserId: string,
  ): Promise<TargetMarginReadout> {
    const bottle = checkPct("bottle", body.bottlePct === undefined ? null : body.bottlePct);
    const glass = checkPct("glass", body.glassPct === undefined ? null : body.glassPct);
    if (bottle === null && glass === null) {
      throw new BadRequestException(
        "Name a target for bottles, for glasses, or both. Nothing was recorded.",
      );
    }
    const band = body.bandPts;
    if (typeof band !== "number" || !Number.isFinite(band)) {
      throw new BadRequestException(
        "Say how close is close enough, in margin points (2 means a wine within 2 points of the target gets no advice; 0 means advise on any difference). Nothing was recorded.",
      );
    }
    if (band < TARGET_BAND_MIN_PTS || band > TARGET_BAND_MAX_PTS) {
      throw new BadRequestException(
        `"Close enough" is between ${TARGET_BAND_MIN_PTS} and ${TARGET_BAND_MAX_PTS} margin points; ${band} is outside it. Nothing was recorded.`,
      );
    }

    const before = await readHouseTargetMargin(this.databaseService.client, restaurantId);
    if (before.error !== null) {
      // Refuse rather than write over a value this write could not see.
      throw new InternalServerErrorException(
        `The house's current target margin could not be read, so nothing was changed: ${before.error}`,
      );
    }
    const previous = targetsFrom(before.row);

    // All five columns in ONE update: the CHECK makes the targets, the band,
    // the person and the moment one fact.
    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        target_margin_bottle_pct: bottle,
        target_margin_glass_pct: glass,
        target_margin_band_pts: band,
        target_margin_set_by: actorUserId,
        target_margin_set_at: new Date().toISOString(),
      })
      .eq("id", restaurantId);

    if (error) {
      this.logger.error(`Could not record the target margin for ${restaurantId}: ${error.message}`);
      throw new InternalServerErrorException(
        `Could not record the target margin. Nothing was changed. ${error.message}`,
      );
    }

    const fields: Record<string, { from: unknown; to: unknown }> = {};
    if (previous.bottlePct !== bottle)
      fields.target_margin_bottle_pct = { from: previous.bottlePct, to: bottle };
    if (previous.glassPct !== glass)
      fields.target_margin_glass_pct = { from: previous.glassPct, to: glass };
    if (previous.bandPts !== band)
      fields.target_margin_band_pts = { from: previous.bandPts, to: band };

    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: TARGET_MARGIN_AUDIT_ACTION,
      register: "target-margin",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "target margin",
      fields,
    });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  private shape(
    restaurantId: string,
    row: TargetRow | null,
    authorName: string | null,
  ): TargetMarginReadout {
    return {
      restaurantId,
      ...targetsFrom(row),
      readable: true,
      reason: null,
      statedAt: row?.target_margin_set_at ?? null,
      statedBy: row?.target_margin_set_by
        ? { userId: row.target_margin_set_by, name: authorName }
        : null,
    };
  }

  /** `public.users.user_id`; a failed lookup is a null name, never the raw id. */
  private async nameOf(row: TargetRow | null): Promise<string | null> {
    const userId = row?.target_margin_set_by ?? null;
    if (!userId) return null;
    const { data, error } = await this.databaseService.client
      .from("users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`The target margin's author could not be named: ${error.message}`);
      return null;
    }
    return (data as { name?: string | null } | null)?.name ?? null;
  }
}
