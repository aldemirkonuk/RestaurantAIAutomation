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
const HOUSE_ALLOWANCE_COLUMNS =
  "restaurant_id, monthly_allowance, stated_source, set_via, set_by, set_at";
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
  /**
   * WHICH row the allowance came from. `"house"` is this restaurant's own
   * override, `"plan"` its plan's, `"none"` neither. Reported rather than left
   * implicit because the founder's answer to question 8 is that ONE house gets
   * a number first — so "this house has 200 because we set it for this house"
   * and "this house has 200 because every house on its plan does" are different
   * facts, and only one of them was decided.
   */
  allowanceScope: "house" | "plan" | "none";
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

    // THE HOUSE'S OWN ROW WINS, and the reason is the founder's answer to
    // question 8: he sets a number on ONE named house and watches it before any
    // plan-wide figure exists. A plan row would land on every house sharing a
    // `subscription_tier`, and that column carries DEFAULT 'pilot' on houses
    // that never chose it — so plan-first would make "one house, deliberately"
    // impossible to express. Which row answered is itself reported.
    const allowance = await this.allowanceForHouse(restaurantId, planCode);
    if (!allowance.readable) failures.push("this house's allowance");

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
      allowanceScope: allowance.scope,
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

  /**
   * This house's allowance: its own row if it has one, else its plan's.
   *
   * `readable` is false when EITHER read failed, and the caller then shows the
   * allowance as unknown rather than as absent. A house-row read that failed
   * must NOT fall through to the plan row: answering with the fleet's number
   * when the house's own could not be read is the shape where a wrong answer
   * looks exactly like a right one.
   */
  private async allowanceForHouse(
    restaurantId: string,
    planCode: string | null,
  ): Promise<{
    value: number | null;
    source: string | null;
    readable: boolean;
    scope: "house" | "plan" | "none";
  }> {
    const { data, error } = await this.sb
      .from("house_message_allowances")
      .select(HOUSE_ALLOWANCE_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `house_message_allowances read failed: ${error.message}`,
      );
      return { value: null, source: null, readable: false, scope: "none" };
    }

    const row = (data as Record<string, unknown> | null) ?? null;
    if (row) {
      const raw = row.monthly_allowance;
      return {
        value: typeof raw === "number" ? raw : null,
        source: (row.stated_source as string | null) ?? null,
        readable: true,
        scope: "house",
      };
    }

    if (!planCode) {
      return { value: null, source: null, readable: true, scope: "none" };
    }
    const plan = await this.allowanceFor(planCode);
    return {
      value: plan.value,
      source: plan.source,
      readable: plan.readable,
      // "plan" only when a plan ROW actually answered. A missing plan row and a
      // plan row carrying NULL are different facts: the first means nobody has
      // said anything about this plan, the second means somebody looked and set
      // nothing, and a scope of "plan" on the first would attribute a silence
      // to a decision.
      scope: plan.readable && plan.found ? "plan" : "none",
    };
  }

  private async allowanceFor(planCode: string): Promise<{
    value: number | null;
    source: string | null;
    readable: boolean;
    /** Whether a row for this plan EXISTS, which is not the same as its number. */
    found: boolean;
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
      return { value: null, source: null, readable: false, found: false };
    }
    const row = (data as Record<string, unknown> | null) ?? null;
    if (!row)
      return { value: null, source: null, readable: true, found: false };
    const raw = row.monthly_allowance;
    return {
      value: typeof raw === "number" ? raw : null,
      source: (row.stated_source as string | null) ?? null,
      readable: true,
      found: true,
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
    /**
     * The Stripe PaymentIntent id the money moved on. REQUIRED since the
     * founder's answer to question 7 (2026-09-05): a purchase names the payment
     * behind it or it is not written. `house_message_credits_purchase_is_paid`
     * enforces the same rule one layer down, so a caller that got past the type
     * meets a database refusal rather than writing free credits.
     */
    paymentRef: string;
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
    if (!params.paymentRef || !params.paymentRef.trim()) {
      // Reachable only from JavaScript that bypassed the type. Kept because the
      // rule it enforces — credits never appear without a payment behind them —
      // is the one thing on this table a house would dispute.
      return {
        recorded: false,
        entryId: null,
        words:
          "A credit purchase names the payment it was charged on. Nothing was recorded, because credits with no payment behind them are a balance nobody can audit.",
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
        payment_ref: params.paymentRef,
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
   * Has this seal already bought credits?
   *
   * The recovery read for the one window this design cannot close inside a
   * single request: the charge succeeds and the ledger write fails. The seal is
   * spent by then, so the ordinary retry path cannot reach the charge again —
   * but a caller that wants to finish the job needs to know whether the row
   * landed. `null` means the READ failed and is not "no".
   */
  async purchaseForSeal(
    restaurantId: string,
    sealId: string,
  ): Promise<{ found: boolean; entryId: string | null; readable: boolean }> {
    const { data, error } = await this.sb
      .from("house_message_credits")
      .select("id, seal_id, entry_kind, restaurant_id")
      .eq("restaurant_id", restaurantId)
      .eq("seal_id", sealId)
      .eq("entry_kind", "purchase")
      .maybeSingle();

    if (error) {
      this.logger.error(`purchaseForSeal read failed: ${error.message}`);
      return { found: false, entryId: null, readable: false };
    }
    const row = (data as Record<string, unknown> | null) ?? null;
    return {
      found: row !== null,
      entryId: row ? String(row.id) : null,
      readable: true,
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
      scope: "house" | "plan" | "none";
    },
  ): string {
    if (!allowance.readable) {
      return "This house's allowance could not be read, so how many messages are included is unknown. That is not the same as none being included.";
    }
    if (allowance.value === null) {
      if (allowance.scope === "house") {
        // A house row that EXISTS with a NULL number: somebody looked at this
        // house deliberately and set none. A different fact from no row at all,
        // and the sentence says which.
        return `No allowance stated for this house. ${allowance.source ?? "No reason is recorded."} Nothing is counted against an allowance — this is not an allowance of zero.`;
      }
      if (!planCode) {
        return "This house has no plan recorded and no allowance of its own, so no allowance applies to it yet.";
      }
      return "No allowance stated. The number is set from measured usage after a quarter of it, so today nothing is counted against one — this is not an allowance of zero.";
    }
    if (allowance.scope === "house") {
      return `${allowance.value} messages a month are included for THIS house specifically, not for its plan. ${allowance.source ?? "The source of that number is not recorded."}`;
    }
    return `${allowance.value} messages a month are included on this plan. ${allowance.source ?? "The source of that number is not recorded."}`;
  }
}
