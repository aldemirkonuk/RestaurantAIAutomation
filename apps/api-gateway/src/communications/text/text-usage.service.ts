/**
 * The meter, the allowance, and the sentence that refuses (OD-23, answered).
 *
 * THE FOUNDER'S DECISION THIS IMPLEMENTS, 2026-09-05
 * --------------------------------------------------
 * Each plan includes a monthly message allowance, set from MEASURED usage after
 * one quarter and generous at first. Past it, the house either buys Mudavym
 * credits — provider cost passed through plus a stated platform fee, with the
 * meter visible — or connects its own Twilio / Meta account and pays them
 * directly while Mudavym bills only the platform.
 *
 * THE STATE THIS SHIPS IN, STATED PLAINLY
 * ---------------------------------------
 * `plan_message_allowances` is EMPTY, by that same decision: the number comes
 * from a quarter of measurement that has not happened. So every house today
 * reads **"no allowance stated"**, which is true, and is not zero. A product
 * that rendered an unset allowance as `0 / 0` would refuse every message on the
 * strength of a number nobody chose — the same fault
 * `restaurants.subscription_tier DEFAULT 'pilot'` already caused one column
 * over.
 *
 * The consequence is deliberate and worth naming: **an unstated allowance does
 * not refuse.** It cannot, honestly. What refuses is a STATED allowance that
 * has been passed with no credits and no own keys, and that combination cannot
 * occur until somebody sets a number with a source.
 *
 * WHY THE COUNTER IS A QUERY AND NOT A COLUMN
 * -------------------------------------------
 * `house_message_meter` is a ledger and this reads it with `count`. A stored
 * running total would be a second bookkeeping of the same fact, and the repo
 * already knows what that costs (`inventory-sota-rebuild-plan`: dual
 * bookkeeping was the root cause). A count that disagrees with the rows can be
 * recomputed; a total that disagrees with the rows cannot be adjudicated.
 *
 * FOUR STATES EVERYWHERE. `null` from a count means THE READ FAILED. Zero means
 * zero. A meter that showed a failed read as "0 used" would tell a house it had
 * its whole allowance left on the day the database was down.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";

/** Columns read here, as module-level literals for check_read_columns_exist.py. */
const ALLOWANCE_COLUMNS =
  "plan_code, monthly_allowance, stated_source, stated_at";
const CREDIT_COLUMNS =
  "id, entry_kind, amount_minor, currency, provider_cost_minor, platform_fee_minor, fee_basis, detail, recorded_at";
const RESTAURANT_COLUMNS = "id, subscription_tier, timezone, currency";

/**
 * The platform fee, in words, as it stands on the day an entry is written.
 *
 * A SENTENCE AND NOT A NUMBER, and the reason is the founder's own framing:
 * "provider cost passed through plus a stated platform fee". Nobody has stated
 * one. Writing `0.15` here would be inventing the answer to a question that is
 * still open, and every debit written under it would carry that invention
 * forever. Until a rate is decided this string is what a debit records, and it
 * says outright that the fee has not been set.
 */
export const PLATFORM_FEE_BASIS_UNSET =
  "Provider cost passed through at the price the provider reported. No platform fee has been set: the rate is undecided (ADR 0121 addendum), and this entry records that rather than a figure nobody chose.";

export interface MeterReadout {
  /** True only when EVERY read below succeeded. */
  readable: boolean;
  /** The gateway's own sentence when something could not be read. */
  reason: string | null;

  /** `YYYY-MM` in the HOUSE's timezone, not the server's. */
  monthKey: string;
  monthTimezone: string;

  /** Messages this month that counted against the allowance. `null` = read failed. */
  usedThisMonth: number | null;
  /** Messages this month the provider charges nothing for. `null` = read failed. */
  freeThisMonth: number | null;

  /** The plan the house is on, as recorded. */
  planCode: string | null;
  /** `null` means NOT STATED. It is never 0. */
  allowance: number | null;
  /** Where the allowance number came from, when there is one. */
  allowanceSource: string | null;
  /** The sentence a page prints about the allowance. Always populated. */
  allowanceWords: string;

  /** Credit balance in minor units. `null` = read failed. */
  creditBalanceMinor: number | null;
  /** The currency the balance is in. `null` when there are no entries. */
  creditCurrency: string | null;
  /** True when the ledger holds entries in more than one currency. */
  creditCurrencyMixed: boolean;
}

export type SendGateVerdict = "allowed" | "refused" | "unknown";

export interface SendGate {
  verdict: SendGateVerdict;
  /** The sentence the manager reads. Always populated. */
  words: string;
  readout: MeterReadout;
}

@Injectable()
export class TextUsageService {
  private readonly logger = new Logger(TextUsageService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.client;
  }

  /**
   * `YYYY-MM` in a named timezone.
   *
   * Meta applies its rate cards "based on WhatsApp Business account timezone"
   * (developers.facebook.com/.../pricing, fetched 2026-09-05), so a month
   * computed in UTC puts a Türkiye house's late-evening messages in the wrong
   * month at every boundary. An unknown timezone falls back to UTC and SAYS SO
   * in `monthTimezone`, so a reader can tell a real timezone from a default.
   */
  monthKeyFor(
    timezone: string | null,
    now: Date = new Date(),
  ): {
    monthKey: string;
    monthTimezone: string;
  } {
    const tz = timezone && timezone.trim().length > 0 ? timezone : "UTC";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
      }).formatToParts(now);
      const year = parts.find((p) => p.type === "year")?.value;
      const month = parts.find((p) => p.type === "month")?.value;
      if (year && month)
        return { monthKey: `${year}-${month}`, monthTimezone: tz };
    } catch {
      // An unrecognised IANA name. Falls through to UTC rather than throwing:
      // a bad timezone string on a restaurant row must not make the meter
      // unreadable, and the returned `monthTimezone` names what was actually
      // used.
    }
    const iso = now.toISOString();
    return { monthKey: iso.slice(0, 7), monthTimezone: "UTC" };
  }

  /**
   * The whole meter for one house.
   *
   * Every one of the four reads can fail independently and each failure is
   * carried rather than collapsed: `readable` is false and `reason` names which
   * read failed, while the fields that DID load keep their values.
   */
  async readout(
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<MeterReadout> {
    const failures: string[] = [];

    const { data: houseRow, error: houseError } = await this.sb
      .from("restaurants")
      .select(RESTAURANT_COLUMNS)
      .eq("id", restaurantId)
      .maybeSingle();

    if (houseError) {
      this.logger.error(`restaurants read failed: ${houseError.message}`);
      failures.push(`the house's plan and timezone (${houseError.message})`);
    }

    const house = (houseRow as Record<string, unknown> | null) ?? null;
    const planCode = (house?.subscription_tier as string | null) ?? null;
    const { monthKey, monthTimezone } = this.monthKeyFor(
      (house?.timezone as string | null) ?? null,
      now,
    );

    const used = await this.countMeter(restaurantId, monthKey, true);
    if (used === null) failures.push("this month's counted messages");
    const free = await this.countMeter(restaurantId, monthKey, false);
    if (free === null) failures.push("this month's uncounted messages");

    const allowance = planCode
      ? await this.allowanceFor(planCode)
      : {
          value: null as number | null,
          source: null as string | null,
          readable: true,
        };
    if (!allowance.readable) failures.push("the plan's allowance");

    const credits = await this.creditBalance(restaurantId);
    if (!credits.readable) failures.push("the credit ledger");

    return {
      readable: failures.length === 0,
      reason:
        failures.length === 0
          ? null
          : `Some of this meter could not be read: ${failures.join("; ")}. What is missing is shown as unknown rather than as zero.`,
      monthKey,
      monthTimezone,
      usedThisMonth: used,
      freeThisMonth: free,
      planCode,
      allowance: allowance.value,
      allowanceSource: allowance.source,
      allowanceWords: this.allowanceSentence(planCode, allowance),
      creditBalanceMinor: credits.readable ? credits.minor : null,
      creditCurrency: credits.currency,
      creditCurrencyMixed: credits.mixed,
    };
  }

  /**
   * May a message leave, on the money question alone?
   *
   * `ownKeys` is the third way out the founder named: a house on its own Twilio
   * or Meta account is billed by that provider directly, so Mudavym's allowance
   * and credit balance do not gate it at all. Passed in rather than re-read
   * here, because the send path has already resolved the credential and a
   * second read could disagree with the first.
   */
  async gate(params: {
    restaurantId: string;
    ownKeys: boolean;
    now?: Date;
  }): Promise<SendGate> {
    const readout = await this.readout(params.restaurantId, params.now);

    if (params.ownKeys) {
      return {
        verdict: "allowed",
        words:
          "This house is on its own provider account, so its messages are billed to it by that provider and Mudavym's allowance does not apply.",
        readout,
      };
    }

    if (readout.usedThisMonth === null || readout.creditBalanceMinor === null) {
      // THE READ FAILED. Not a refusal and not a pass: a third answer, because
      // treating it as "allowed" spends money we cannot account for and
      // treating it as "refused" silences a house over our own outage.
      return {
        verdict: "unknown",
        words: `Whether this house is within its allowance could not be determined: ${readout.reason ?? "a read failed"}. Nothing was attempted, and that is not the same as the allowance being spent.`,
        readout,
      };
    }

    if (readout.allowance === null) {
      // The state every house is in today. It is honest and it does not refuse.
      return {
        verdict: "allowed",
        words:
          "This plan has no message allowance stated yet, so nothing is being counted against one. The number is set from measured usage, and the meter is what measures it.",
        readout,
      };
    }

    if (readout.usedThisMonth < readout.allowance) {
      const left = readout.allowance - readout.usedThisMonth;
      return {
        verdict: "allowed",
        words: `${left} of this month's ${readout.allowance} included messages are left.`,
        readout,
      };
    }

    if (readout.creditBalanceMinor > 0) {
      return {
        verdict: "allowed",
        words: `This month's ${readout.allowance} included messages are used, so this one is paid for out of credits.`,
        readout,
      };
    }

    // THE REFUSAL. It names the two ways to continue, in the founder's own
    // terms, and it says what did NOT happen — nothing queued, nothing dropped
    // silently, nothing that will arrive later.
    return {
      verdict: "refused",
      words:
        `This month's ${readout.allowance} included messages are used and this house has no credits left, so nothing was sent. ` +
        "Nothing has been queued and nothing will arrive later. There are two ways to carry on: buy credits, which pass the provider's cost through with a stated platform fee and keep this meter visible; or connect this house's own Twilio or Meta account, in which case the provider bills the house directly and Mudavym bills only the platform.",
      readout,
    };
  }

  /** `null` means THE READ FAILED. Zero means zero. */
  private async countMeter(
    restaurantId: string,
    monthKey: string,
    counted: boolean,
  ): Promise<number | null> {
    const { count, error } = await this.sb
      .from("house_message_meter")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("month_key", monthKey)
      .eq("counts_against_allowance", counted);

    if (error) {
      this.logger.error(`house_message_meter count failed: ${error.message}`);
      return null;
    }
    return count ?? 0;
  }

  private async allowanceFor(planCode: string): Promise<{
    value: number | null;
    source: string | null;
    readable: boolean;
  }> {
    const { data, error } = await this.sb
      .from("plan_message_allowances")
      .select(ALLOWANCE_COLUMNS)
      .eq("plan_code", planCode)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `plan_message_allowances read failed: ${error.message}`,
      );
      return { value: null, source: null, readable: false };
    }
    const row = (data as Record<string, unknown> | null) ?? null;
    if (!row) return { value: null, source: null, readable: true };
    const raw = row.monthly_allowance;
    return {
      value: typeof raw === "number" ? raw : null,
      source: (row.stated_source as string | null) ?? null,
      readable: true,
    };
  }

  /**
   * The credit balance, summed from the ledger.
   *
   * MIXED CURRENCIES ARE REPORTED, NOT SUMMED. Adding 5000 USD-minor to 5000
   * TRY-minor produces a number that is not money in any currency, and the
   * repo has already paid for that shape once (fourteen houses all reading USD
   * because a column defaulted). When the ledger holds more than one currency
   * the balance is returned for the most recent one and `mixed` is true, so a
   * surface can say so rather than print a fiction.
   */
  private async creditBalance(restaurantId: string): Promise<{
    readable: boolean;
    minor: number;
    currency: string | null;
    mixed: boolean;
  }> {
    const { data, error } = await this.sb
      .from("house_message_credits")
      .select(CREDIT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .order("recorded_at", { ascending: false });

    if (error) {
      this.logger.error(`house_message_credits read failed: ${error.message}`);
      return { readable: false, minor: 0, currency: null, mixed: false };
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      return { readable: true, minor: 0, currency: null, mixed: false };
    }

    const newest = String(rows[0].currency ?? "");
    const currencies = new Set(rows.map((r) => String(r.currency ?? "")));
    const minor = rows
      .filter((r) => String(r.currency ?? "") === newest)
      .reduce((sum, r) => sum + Number(r.amount_minor ?? 0), 0);

    return {
      readable: true,
      minor,
      currency: newest || null,
      mixed: currencies.size > 1,
    };
  }

  /**
   * Record a purchase of message credits.
   *
   * SEALED BEFORE IT REACHES HERE. The seal id is a required argument and the
   * migration's `house_message_credits_purchase_shape` CHECK refuses a purchase
   * without one, so a caller that forgot the seal gets a database refusal
   * rather than a credit. Two independent enforcements of the same rule,
   * because the controller boundary is the one the last money bug crossed
   * (ADR 0110's addendum: the seal was on the door nobody used).
   *
   * NO MONEY MOVES HERE. This records that credits were bought; taking the
   * payment is `/billing`'s job and is not wired to this route. `paymentRef` is
   * where the provider's own reference goes when it exists, and it is NULL
   * today — stated, not implied.
   */
  async recordPurchase(params: {
    restaurantId: string;
    sealId: string;
    amountMinor: number;
    currency: string;
    recordedBy: string;
    paymentRef?: string | null;
  }): Promise<{ recorded: boolean; entryId: string | null; words: string }> {
    if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) {
      return {
        recorded: false,
        entryId: null,
        words:
          "A credit purchase is a whole number of minor units above zero. Nothing was recorded.",
      };
    }
    if (!/^[A-Z]{3}$/.test(params.currency)) {
      return {
        recorded: false,
        entryId: null,
        words:
          "A credit purchase names its currency as a three-letter ISO 4217 code. An amount with no currency is not money, so nothing was recorded.",
      };
    }

    const { data, error } = await this.sb
      .from("house_message_credits")
      .insert({
        restaurant_id: params.restaurantId,
        entry_kind: "purchase",
        amount_minor: params.amountMinor,
        currency: params.currency,
        // A purchase has neither half of a debit's cost split.
        provider_cost_minor: null,
        platform_fee_minor: null,
        fee_basis: PLATFORM_FEE_BASIS_UNSET,
        meter_id: null,
        seal_id: params.sealId,
        payment_ref: params.paymentRef ?? null,
        detail: `Credits bought: ${params.amountMinor} ${params.currency} minor units. ${PLATFORM_FEE_BASIS_UNSET}`,
        recorded_by: params.recordedBy,
      })
      .select("id")
      .single();

    if (error || !data) {
      this.logger.error(`credit purchase insert failed: ${error?.message}`);
      return {
        recorded: false,
        entryId: null,
        words: `The purchase was NOT recorded, so this house's balance is unchanged: ${error?.message ?? "no row came back"}.`,
      };
    }

    return {
      recorded: true,
      entryId: String((data as Record<string, unknown>).id),
      words:
        "Recorded. The balance below now includes it, and every message charged against it will appear on this meter with the provider's own cost beside it.",
    };
  }

  /**
   * The ledger a house may read: what it bought, what was charged, and why.
   *
   * `null` means THE READ FAILED, and the surface must say so rather than
   * drawing an empty list — an empty ledger and an unreadable one look
   * identical on a page and only one of them means "you have spent nothing".
   */
  async entries(
    restaurantId: string,
    limit = 50,
  ): Promise<{
    rows: Record<string, unknown>[] | null;
    reason: string | null;
  }> {
    const { data, error } = await this.sb
      .from("house_message_credits")
      .select(CREDIT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .order("recorded_at", { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`house_message_credits list failed: ${error.message}`);
      return { rows: null, reason: error.message };
    }
    return { rows: (data ?? []) as Record<string, unknown>[], reason: null };
  }

  private allowanceSentence(
    planCode: string | null,
    allowance: {
      value: number | null;
      source: string | null;
      readable: boolean;
    },
  ): string {
    if (!allowance.readable) {
      return "This plan's allowance could not be read, so how many messages are included is unknown. That is not the same as none being included.";
    }
    if (!planCode) {
      return "This house has no plan recorded, so no allowance applies to it yet.";
    }
    if (allowance.value === null) {
      return "No allowance stated. The number is set from measured usage after a quarter of it, so today nothing is counted against one — this is not an allowance of zero.";
    }
    return `${allowance.value} messages a month are included on this plan. ${allowance.source ?? "The source of that number is not recorded."}`;
  }
}
