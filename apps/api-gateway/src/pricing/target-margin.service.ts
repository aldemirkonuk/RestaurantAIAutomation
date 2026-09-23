import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
 *      (20260922230300 asserts the columns carry none).
 *   2. Shape checked here exactly as the database checks it: a target is a
 *      PERCENT between 5 and 95 (0.65, the fraction spelling, is refused with
 *      a sentence), the band is 0 to 20 PERCENT OF THE ADVISED PRICE and is
 *      required with a target (founder, 2026-09-21, relayed: "close enough" is
 *      a percent of the advised price, required, no default; in his words,
 *      "percent is always shown everywhere").
 *   3. Audited, or the caller is told it was not (`audited` / `auditReason`).
 *   4. A failed read is never an empty one: `readable: false` with the reason.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller, the same helper the flags, thresholds and carrying cost use.
 */

export const TARGET_MARGIN_MIN_PCT = 5;
export const TARGET_MARGIN_MAX_PCT = 95;
export const TARGET_BAND_MIN_PCT = 0;
export const TARGET_BAND_MAX_PCT = 20;

/** The pour a house may confirm, in ml: the database CHECK's range. */
export const POUR_MIN_ML = 10;
export const POUR_MAX_ML = 500;

export const TARGET_MARGIN_AUDIT_ACTION = "target_margin_changed" as const;
export const POUR_SIZE_AUDIT_ACTION = "pour_size_confirmed" as const;

export interface TargetMarginReadout {
  restaurantId: string;
  /** PERCENT (65 = 65 % gross margin on a bottle). Null = not set. */
  bottlePct: number | null;
  /** PERCENT on a glass. Null = not set (the house may set one and not the other). */
  glassPct: number | null;
  /** "Close enough", a PERCENT of the advised price. Null = not set (and then no target is either). */
  bandPct: number | null;
  /**
   * The house's pour, and whether it has been confirmed (founder, 2026-09-21:
   * glass advice waits for this, once). `ml` is only reported once confirmed:
   * before that the column holds the database's 150 ml default, which nobody
   * at the house stated.
   */
  pour: {
    confirmed: boolean;
    ml: number | null;
    confirmedAt: string | null;
    confirmedBy: { userId: string | null; name: string | null } | null;
  };
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
  target_margin_band_pct: number | string | null;
  target_margin_set_by: string | null;
  target_margin_set_at: string | null;
  default_pour_ml?: number | string | null;
  pour_size_confirmed_by?: string | null;
  pour_size_confirmed_at?: string | null;
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
      "target_margin_bottle_pct, target_margin_glass_pct, target_margin_band_pct, target_margin_set_by, target_margin_set_at, default_pour_ml, pour_size_confirmed_by, pour_size_confirmed_at",
    )
    .eq("id", restaurantId)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as TargetRow | null) ?? null, error: null };
}

export function targetsFrom(row: TargetRow | null): {
  bottlePct: number | null;
  glassPct: number | null;
  bandPct: number | null;
} {
  return {
    bottlePct: asNumber(row?.target_margin_bottle_pct),
    glassPct: asNumber(row?.target_margin_glass_pct),
    bandPct: asNumber(row?.target_margin_band_pct),
  };
}

/**
 * The house's CONFIRMED pour, or null. The advice reads only this: an
 * unconfirmed `default_pour_ml` is the database's 150 ml default, never a
 * number the house stated (ADR 0193 F7, answered 2026-09-21).
 */
export function confirmedPourFrom(row: TargetRow | null): number | null {
  if (!row?.pour_size_confirmed_at || !row.pour_size_confirmed_by) return null;
  const ml = asNumber(row.default_pour_ml);
  return ml !== null && ml > 0 ? ml : null;
}

/** What the advice reads of a wine's own pour (round 6c answer 3). */
export interface WinePourRow {
  pour_size_ml?: number | string | null;
  pour_size_confirmed_by?: string | null;
  pour_size_confirmed_at?: string | null;
}

/**
 * A WINE's own CONFIRMED pour, or null (founder, 2026-09-21, round 6c:
 * "Yes, confirmed per wine"). `restaurant_inventory.pour_size_ml` carries a
 * database DEFAULT of 150 and any house member may write it, so the number is
 * used only with an owner's or a manager's confirmation beside it (who and
 * when). A pour changed after its confirmation loses it in the database
 * (20260922230900), so a confirmation here always describes this number.
 * Null means: use the house's confirmed pour.
 */
export function confirmedWinePourFrom(row: WinePourRow | null | undefined): number | null {
  if (!row?.pour_size_confirmed_at || !row.pour_size_confirmed_by) return null;
  const ml = asNumber(row.pour_size_ml);
  return ml !== null && ml >= POUR_MIN_ML && ml <= POUR_MAX_ML ? ml : null;
}

/** What `PUT /pricing/wines/:inventoryId/pour` answers. */
export interface WinePourReadout {
  inventoryId: string;
  wineName: string | null;
  /** This wine's own confirmed pour; null = it uses the house's confirmed pour. */
  pour: { confirmed: boolean; ml: number | null; confirmedAt: string | null; confirmedBy: string | null };
  audited: boolean;
  auditReason: string | null;
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
        bandPct: null,
        pour: { confirmed: false, ml: null, confirmedAt: null, confirmedBy: null },
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    }
    const [author, pourAuthor] = await Promise.all([
      this.nameOf(house.row?.target_margin_set_by ?? null),
      this.nameOf(house.row?.pour_size_confirmed_by ?? null),
    ]);
    return this.shape(restaurantId, house.row, author, pourAuthor);
  }

  /**
   * State the house's targets. `bottlePct` / `glassPct` may each be a number
   * or null (the house does not sell that way, or has no target for it), but
   * at least one must be a number: un-answering the question every piece of
   * price advice depends on is not a write this route offers, the same rule
   * the carrying cost holds. `bandPct` is required.
   */
  async write(
    restaurantId: string,
    body: { bottlePct?: unknown; glassPct?: unknown; bandPct?: unknown },
    actorUserId: string,
  ): Promise<TargetMarginReadout> {
    const bottle = checkPct("bottle", body.bottlePct === undefined ? null : body.bottlePct);
    const glass = checkPct("glass", body.glassPct === undefined ? null : body.glassPct);
    if (bottle === null && glass === null) {
      throw new BadRequestException(
        "Name a target for bottles, for glasses, or both. Nothing was recorded.",
      );
    }
    const band = body.bandPct;
    if (typeof band !== "number" || !Number.isFinite(band)) {
      throw new BadRequestException(
        "Say how close is close enough, as a percent of the advised price (3 means a wine priced within 3 percent of its advised price gets no advice; 0 means advise on any difference). Nothing was recorded.",
      );
    }
    if (band < TARGET_BAND_MIN_PCT || band > TARGET_BAND_MAX_PCT) {
      throw new BadRequestException(
        `"Close enough" is between ${TARGET_BAND_MIN_PCT} and ${TARGET_BAND_MAX_PCT} percent of the advised price; ${band} percent is outside it. Nothing was recorded.`,
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
        target_margin_band_pct: band,
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
    if (previous.bandPct !== band)
      fields.target_margin_band_pct = { from: previous.bandPct, to: band };

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

  /**
   * Confirm the house's pour size, once (founder, 2026-09-21, relayed: glass
   * advice appears only after the house confirms its pour size; bottle advice
   * is unaffected). Writes `default_pour_ml` and the person and moment in ONE
   * update -- the database CHECK makes them one fact -- so the number the
   * glass advice reads IS the number that was confirmed. Audited as
   * `pour_size_confirmed`. The role check (owner or manager) is the
   * controller's. Confirming again is allowed and restamps who and when: the
   * one-time part is that glass advice never waits again once it is done.
   */
  async confirmPour(
    restaurantId: string,
    body: { pourMl?: unknown },
    actorUserId: string,
  ): Promise<TargetMarginReadout> {
    const ml = body.pourMl;
    if (typeof ml !== "number" || !Number.isFinite(ml)) {
      throw new BadRequestException(
        "Say the pour this house serves, in ml (for example 125 or 150). Nothing was recorded.",
      );
    }
    if (ml < POUR_MIN_ML || ml > POUR_MAX_ML) {
      throw new BadRequestException(
        `A pour is between ${POUR_MIN_ML} and ${POUR_MAX_ML} ml; ${ml} ml is outside it. Nothing was recorded.`,
      );
    }

    const before = await readHouseTargetMargin(this.databaseService.client, restaurantId);
    if (before.error !== null) {
      throw new InternalServerErrorException(
        `The house's pour could not be read, so nothing was changed: ${before.error}`,
      );
    }
    const previous = confirmedPourFrom(before.row);

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        default_pour_ml: ml,
        pour_size_confirmed_by: actorUserId,
        pour_size_confirmed_at: new Date().toISOString(),
      })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(`Could not confirm the pour for ${restaurantId}: ${error.message}`);
      throw new InternalServerErrorException(
        `Could not confirm the pour size. Nothing was changed. ${error.message}`,
      );
    }

    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: POUR_SIZE_AUDIT_ACTION,
      register: "target-margin",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "pour size",
      fields: { default_pour_ml: { from: previous, to: ml } },
    });

    const after = await this.read(restaurantId);
    return { ...after, audited: receipt.recorded, auditReason: receipt.reason };
  }

  /**
   * Confirm ONE wine's own pour, or send it back to the house's pour (founder,
   * 2026-09-21, round 6c: "Yes, confirmed per wine"). A number writes
   * `pour_size_ml` with the person and the moment in ONE update; `null` clears
   * the confirmation, so the glass advice uses the house's confirmed pour
   * again (the stored number is left as it is). Audited as
   * `pour_size_confirmed` on the wine. The role check (owner or manager) is
   * the controller's.
   */
  async confirmWinePour(
    restaurantId: string,
    inventoryId: string,
    body: { pourMl?: unknown },
    actorUserId: string,
  ): Promise<WinePourReadout> {
    const ml = body.pourMl;
    if (ml !== null && (typeof ml !== "number" || !Number.isFinite(ml))) {
      throw new BadRequestException(
        "Say this wine's pour in ml (for example 75), or null to use the house's pour. Nothing was recorded.",
      );
    }
    if (ml !== null && (ml < POUR_MIN_ML || ml > POUR_MAX_ML)) {
      throw new BadRequestException(
        `A pour is between ${POUR_MIN_ML} and ${POUR_MAX_ML} ml; ${ml} ml is outside it. Nothing was recorded.`,
      );
    }
    const client = this.databaseService.client;
    const { data: before, error: readErr } = await client
      .from("restaurant_inventory")
      .select("id, wine_name, pour_size_ml, pour_size_confirmed_by, pour_size_confirmed_at")
      .eq("id", inventoryId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (readErr) {
      throw new InternalServerErrorException(
        `This wine's pour could not be read, so nothing was changed: ${readErr.message}`,
      );
    }
    if (!before) throw new NotFoundException("No wine of this house by that id. Nothing was changed.");
    const row = before as WinePourRow & { wine_name?: string | null };
    const previous = confirmedWinePourFrom(row);
    const now = new Date().toISOString();
    const patch =
      ml === null
        ? { pour_size_confirmed_by: null, pour_size_confirmed_at: null }
        : { pour_size_ml: ml, pour_size_confirmed_by: actorUserId, pour_size_confirmed_at: now };
    const { error } = await client
      .from("restaurant_inventory")
      .update(patch)
      .eq("id", inventoryId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.error(`Could not confirm the pour of ${restaurantId}/${inventoryId}: ${error.message}`);
      throw new InternalServerErrorException(
        `This wine's pour was not confirmed. Nothing was changed. ${error.message}`,
      );
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: POUR_SIZE_AUDIT_ACTION,
      register: "target-margin",
      entityType: "restaurant_inventory",
      entityId: inventoryId,
      subject: `pour size of ${row.wine_name ?? "a wine"}`,
      fields: { wine_pour_ml: { from: previous, to: ml as number | null } },
    });
    return {
      inventoryId,
      wineName: row.wine_name ?? null,
      pour: {
        confirmed: ml !== null,
        ml: ml as number | null,
        confirmedAt: ml === null ? null : now,
        confirmedBy: ml === null ? null : actorUserId,
      },
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  private shape(
    restaurantId: string,
    row: TargetRow | null,
    authorName: string | null,
    pourAuthorName: string | null,
  ): TargetMarginReadout {
    const pourMl = confirmedPourFrom(row);
    return {
      restaurantId,
      ...targetsFrom(row),
      pour: {
        confirmed: pourMl !== null,
        ml: pourMl,
        confirmedAt: pourMl !== null ? (row?.pour_size_confirmed_at ?? null) : null,
        confirmedBy:
          pourMl !== null && row?.pour_size_confirmed_by
            ? { userId: row.pour_size_confirmed_by, name: pourAuthorName }
            : null,
      },
      readable: true,
      reason: null,
      statedAt: row?.target_margin_set_at ?? null,
      statedBy: row?.target_margin_set_by
        ? { userId: row.target_margin_set_by, name: authorName }
        : null,
    };
  }

  /** `public.users.user_id`; a failed lookup is a null name, never the raw id. */
  private async nameOf(userId: string | null): Promise<string | null> {
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
