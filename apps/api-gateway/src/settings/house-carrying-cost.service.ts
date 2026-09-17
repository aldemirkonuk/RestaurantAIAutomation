import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * What holding stock costs this house — read, and stated by a person.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * THE FOUNDER, 2026-09-05, batch 59, answering the commodity plan's §12 Q5
 * verbatim: **"Twice a year, and the house types its carrying cost."**
 *
 * The quant pass behind that answer measured the alert on 440 recorded FAO
 * months, walk-forward: a fire is followed by a higher index three months later
 * 66.7 % of the time against a 54.4 % benchmark — and the entire gain is spent
 * by a carrying cost of about **one percent a month**. The break-even sits at
 * 0.96 %/month on the headline index, 1.66 % on Dairy, 0.27 % on Meat. Between
 * 0.5 % and 1.0 % the recommendation flips from "worth having on six series" to
 * "worth having on one".
 *
 * **Nothing in this product had ever asked a house for that number.** So the
 * commodity alert's money clause is gated on it: a house that has not typed one
 * gets the sentence with the saving replaced by the word UNMEASURED and the
 * reason, and never a figure nobody stated.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES, AND THEY ARE THE CURRENCY REGISTER'S
 * ---------------------------------------------------------------------------
 *   1. **Explicit, never silent.** This service writes
 *      `restaurants.carrying_cost_percent_per_month` only from a number that
 *      arrived in the request body. It derives nothing from a country, a plan
 *      or a cost of capital, and it never writes on a read. There is no
 *      default anywhere: the migration
 *      (`20260906140000_a_carrying_cost_is_typed_by_a_person.sql`) asserts the
 *      column carries none and fails if one is ever added.
 *   2. **Shape checked here, exactly as the database checks it.** `>= 0.01` and
 *      `<= 25.000` percent a month is `restaurants_carrying_cost_is_a_plausible_percent`
 *      verbatim, so a value this route accepts is a value the database accepts.
 *      Those bounds are a UNITS check as much as a sanity one — see `write`.
 *   3. **Audited, or the caller is told it was not.** Every accepted write
 *      files a `system_audit_log` row naming the actor and both numbers, and
 *      the receipt travels back as `audited` / `auditReason`.
 *   4. **A failed read is never an empty one.** A read error answers
 *      `readable: false` with the reason in words. `percentPerMonth: null`
 *      means the question has not been answered. The two states are different
 *      and the page prints different sentences for them (ADR 0020).
 *
 * The value, the person and the moment are ONE fact, enforced by
 * `restaurants_carrying_cost_names_its_author`. So this service writes all
 * three columns in one update or none of them; it cannot leave a number with
 * nobody's name on it even if it tried, and the CHECK is what makes that true
 * rather than this comment.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller — the same helper the flags, the thresholds and the currency call.
 */

/** The bounds `restaurants_carrying_cost_is_a_plausible_percent` allows. */
export const CARRYING_COST_MIN_PERCENT = 0.01;
export const CARRYING_COST_MAX_PERCENT = 25;

/** The action string this service files. Also in `SETTINGS_AUDIT_ACTIONS`. */
export const CARRYING_COST_AUDIT_ACTION = "carrying_cost_changed" as const;

export interface HouseCarryingCostReadout {
  restaurantId: string;
  /**
   * PERCENT per month of the goods' value. `0.75` means three quarters of one
   * percent a month — not 75, and not 0.0075. `null` means nobody has typed
   * one, which is the state of every house today and is a real answer: the
   * commodity alert then says its saving is unmeasured and why.
   */
  percentPerMonth: number | null;
  /** What the person counted, in their own words. Optional, and often null. */
  basis: string | null;
  /** False when the row could not be READ. Never conflated with a null value. */
  readable: boolean;
  reason: string | null;
  /**
   * When it was stated, from the column itself rather than from the audit
   * trail. Unlike the currency, this fact carries its own moment — the CHECK
   * makes the value and the moment inseparable — so there is no need to
   * reconstruct the date from `system_audit_log` and no risk of printing
   * `updated_at`, which moves for any change to the row.
   */
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  /** Present on a write only. `false` means the change happened, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  carrying_cost_percent_per_month: number | string | null;
  carrying_cost_basis: string | null;
  carrying_cost_set_by: string | null;
  carrying_cost_set_at: string | null;
}

@Injectable()
export class HouseCarryingCostService {
  private readonly logger = new Logger(HouseCarryingCostService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseCarryingCostReadout> {
    const house = await this.readHouse(restaurantId);
    if (house.error !== null) {
      return {
        restaurantId,
        percentPerMonth: null,
        basis: null,
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    }
    return this.shape(restaurantId, house.row, await this.nameOf(house.row));
  }

  /**
   * State what holding stock costs this house.
   *
   * THE BOUNDS ARE A UNITS CHECK. `NUMERIC(5,3)` would happily store `0.0075`
   * and `75`, and both are the same mistake in opposite directions:
   *
   *   0.0075  — a person (or a caller) typing the FRACTION where the column
   *             wants a percent. Stored, it understates the cost by a hundred,
   *             which is precisely the direction that makes buying ahead look
   *             free and every commodity alert look profitable.
   *   75      — a person typing "75" meaning "0.75". Stored, it is 900 % a
   *             year and no alert would ever fire a saving again.
   *
   * Refusing both, in the same words the page prints, is how the mistake stays
   * a sentence instead of becoming a number under a money figure.
   *
   * There is deliberately no clear-to-null. Un-answering a question the alert's
   * money clause depends on is a different kind of act from answering it, and
   * the same rule the currency register holds.
   */
  async write(
    restaurantId: string,
    percentPerMonth: unknown,
    basis: unknown,
    actorUserId: string,
  ): Promise<HouseCarryingCostReadout> {
    const value =
      typeof percentPerMonth === "number" ? percentPerMonth : Number.NaN;
    if (!Number.isFinite(value)) {
      throw new BadRequestException(
        "A carrying cost is a number: what holding stock costs this house, as a percent of the goods' value per month. Nothing was recorded.",
      );
    }
    if (value < CARRYING_COST_MIN_PERCENT) {
      throw new BadRequestException(
        `${value} is below ${CARRYING_COST_MIN_PERCENT} percent a month, which is a tenth of a percent a year — no house holds stock that cheaply. This field is a PERCENT: three quarters of one percent a month is 0.75, not 0.0075. Nothing was recorded.`,
      );
    }
    if (value > CARRYING_COST_MAX_PERCENT) {
      throw new BadRequestException(
        `${value} percent a month is ${(value * 12).toFixed(0)} percent a year. This field is a percent a MONTH: if you meant three quarters of one percent, type 0.75. Nothing was recorded.`,
      );
    }

    const before = await this.readHouse(restaurantId);
    const previous = this.asNumber(
      before.row?.carrying_cost_percent_per_month ?? null,
    );

    const trimmedBasis =
      typeof basis === "string" && basis.trim().length > 0
        ? basis.trim()
        : null;

    // All three columns in ONE update. The CHECK makes the value, the author
    // and the moment inseparable, so a partial write is refused by the database
    // rather than caught here — and the moment is the server's `now`, never a
    // client's clock.
    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        carrying_cost_percent_per_month: value,
        carrying_cost_set_by: actorUserId,
        carrying_cost_set_at: new Date().toISOString(),
        carrying_cost_basis: trimmedBasis,
      })
      .eq("id", restaurantId);

    if (error) {
      this.logger.error(
        `Could not record the carrying cost for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the carrying cost. Nothing was changed.",
      );
    }

    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: CARRYING_COST_AUDIT_ACTION,
      register: "carrying-cost",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "carrying cost",
      fields: {
        carrying_cost_percent_per_month: { from: previous, to: value },
        carrying_cost_basis: {
          from: before.row?.carrying_cost_basis ?? null,
          to: trimmedBasis,
        },
      },
    });

    const after = await this.read(restaurantId);
    return {
      ...after,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  private shape(
    restaurantId: string,
    row: HouseRow | null,
    authorName: string | null,
  ): HouseCarryingCostReadout {
    const value = this.asNumber(row?.carrying_cost_percent_per_month ?? null);
    return {
      restaurantId,
      percentPerMonth: value,
      basis: row?.carrying_cost_basis ?? null,
      readable: true,
      reason: null,
      statedAt: row?.carrying_cost_set_at ?? null,
      statedBy: row?.carrying_cost_set_by
        ? { userId: row.carrying_cost_set_by, name: authorName }
        : null,
    };
  }

  /**
   * `NUMERIC` arrives from PostgREST as a STRING, not a number.
   *
   * Returning it untouched would put `"0.750"` where a number is declared, and
   * every arithmetic use downstream would concatenate rather than add. Anything
   * unparseable comes back null — which reads as "not stated" and is the safe
   * direction, because the alert then withholds its money clause rather than
   * pricing a fire off a value it could not read.
   */
  private asNumber(raw: number | string | null): number | null {
    if (raw === null || raw === undefined) return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * `public.users.user_id` — never an `auth.users` id; the two are disjoint.
   *
   * A failed lookup answers `null`, which the page renders as the number being
   * stated by somebody whose name could not be read. It never falls back to
   * the id, which would put a UUID where a person's name belongs.
   */
  private async nameOf(row: HouseRow | null): Promise<string | null> {
    const userId = row?.carrying_cost_set_by ?? null;
    if (!userId) return null;
    const { data, error } = await this.databaseService.client
      .from("users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `The carrying cost's author could not be named: ${error.message}`,
      );
      return null;
    }
    return (data as { name?: string | null } | null)?.name ?? null;
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select(
        "carrying_cost_percent_per_month, carrying_cost_basis, carrying_cost_set_by, carrying_cost_set_at",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `Could not read the carrying cost for ${restaurantId}: ${error.message}`,
      );
      return { row: null, error: error.message };
    }
    return { row: (data as HouseRow | null) ?? null, error: null };
  }
}
