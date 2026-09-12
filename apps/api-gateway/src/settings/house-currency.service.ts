import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { isIso4217, notACurrencyBecause } from "../common/iso-4217";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";

/**
 * The money this house reports in — read, and stated by a person.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `restaurants.currency` carried `DEFAULT 'USD'::character varying`
 * (`20260805000000_baseline_from_production.sql:3576`) and the only insert that
 * creates a house — `AuthService.registerRestaurant` — named no `currency` key,
 * so the COLUMN was the writer. Measured on production 2026-09-05: `USD` on all
 * fourteen rows, two of them in Turkiye and one in London, none of them ever
 * asked (ADR 0117 Q25; the fault is [[absence-reported-as-health]]).
 *
 * `20260905120000_a_house_names_its_money.sql` dropped that default and added
 * `restaurants_currency_check (currency is null or currency ~ '^[A-Z]{3}$')`,
 * and the founder's Q30 call cleared every unattributable value to NULL. As of
 * today production holds GBP 1, TRY 3, NULL 11.
 *
 * That left a hole this service fills. `CurrencyStep`
 * (`apps/web/src/components/onboarding/CurrencyStep.tsx`) asks a house being
 * CREATED. An EXISTING house had no way to answer at all: eleven of them print
 * "currency not recorded" against every money figure
 * (`lib/mudavym/format.ts` `fmtMoney`, `lib/utils.ts` `formatCurrency`) with no
 * control anywhere in the product that could change it. A state the product can
 * be in, and cannot be got out of, is not a gap in copy — it is a missing field.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES
 * ---------------------------------------------------------------------------
 *   1. **Explicit, never silent.** This service writes `restaurants.currency`
 *      only from a code that arrived in the request body. It never derives one
 *      from the country, never falls back to USD, and never writes on a read.
 *      The DEFAULT the page offers is computed in the browser from
 *      `lib/countries.ts` and shown as a sentence BEFORE it is recorded (ADR
 *      0083); it reaches this service only once a person has accepted it.
 *   2. **Membership checked here, not just shape.** CORRECTED 2026-09-06. This
 *      rule used to read "shape checked here, vocabulary checked in the
 *      browser", and argued that duplicating the code list in the gateway would
 *      be a second table of the same fact. The argument was wrong in the one
 *      way that mattered: a browser is not a validator. `PUT /settings/currency`
 *      is an HTTP route, the shape check admitted `ZZZ`, and `restaurants
 *      .currency` is the rung `invoice-currency.ts` files an invoice's money
 *      under when the paper states none — so a house could be denominated in a
 *      currency that does not exist and every figure on every screen would
 *      inherit it. The list now lives in `common/iso-4217.ts` and
 *      `iso-4217.spec.ts` fails if it ever differs from
 *      `apps/web/src/lib/currency.ts` by a single code, so the copy cannot
 *      become a second table. The migration's CHECK stays `^[A-Z]{3}$` — a
 *      value this route accepts is still a value the database accepts — and
 *      membership is enforced in this service, where a list can be corrected
 *      without a migration.
 *   3. **Audited, or the caller is told it was not.** Every accepted write files
 *      a `system_audit_log` row naming the actor and both codes, and the receipt
 *      travels back on the readout as `audited` / `auditReason` — an audit row
 *      that failed is VISIBLE rather than assumed, exactly as the approval
 *      thresholds route does it.
 *   4. **A failed read is never an empty one.** A read error answers
 *      `readable: false` with the reason in words. `code: null` means the
 *      question has not been answered; the two states are different and the
 *      page prints different sentences for them (ADR 0020).
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller, the same helper the feature flags and the approval thresholds
 * call, so "may this person manage this house" keeps one implementation and one
 * spec behind it.
 */

/**
 * The SHAPE `restaurants_currency_check` allows. Kept exported and kept true —
 * it is what the database will admit — but it is no longer the whole gate:
 * `isIso4217` decides whether a well-formed code names any money. Three
 * capitals is a shape, and `ZZZ` passes it.
 */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** The action string this service files. Also in `SETTINGS_AUDIT_ACTIONS`. */
export const CURRENCY_AUDIT_ACTION = "reporting_currency_changed" as const;

export interface HouseCurrencyReadout {
  restaurantId: string;
  /**
   * ISO 4217 alpha-3, or `null` when nobody has stated one. `null` is a real
   * answer — it is what eleven production houses hold today — and must render
   * as "not recorded", never as USD and never as a bare symbol.
   */
  code: string | null;
  /**
   * `restaurants.country` verbatim, so the browser can derive the offered
   * default from `lib/countries.ts`. The country -> currency table is NOT
   * duplicated in the gateway: one table, in one file, keyed by ISO 3166-1.
   */
  country: string | null;
  /** False when the row could not be READ. Never conflated with `code: null`. */
  readable: boolean;
  reason: string | null;
  /**
   * When the code was last stated, taken from the audit trail rather than from
   * `restaurants.updated_at`. That column moves for any change to the row — a
   * rename, a city, a calendar token — so printing it as the date the currency
   * was stated would be a confident lie about a true number.
   */
  statedAt: string | null;
  statedBy: { userId: string | null; name: string | null } | null;
  /** Present on a write only. `false` means the change happened, the paper did not. */
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  currency: string | null;
  country: string | null;
}

@Injectable()
export class HouseCurrencyService {
  private readonly logger = new Logger(HouseCurrencyService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  async read(restaurantId: string): Promise<HouseCurrencyReadout> {
    const house = await this.readHouse(restaurantId);
    if (house.error !== null) {
      return {
        restaurantId,
        code: null,
        country: null,
        readable: false,
        reason: house.error,
        statedAt: null,
        statedBy: null,
      };
    }
    const stated = await this.lastStated(restaurantId);
    return {
      restaurantId,
      code: house.row?.currency ?? null,
      country: house.row?.country ?? null,
      readable: true,
      reason: null,
      statedAt: stated.at,
      statedBy: stated.by,
    };
  }

  /**
   * State the house's reporting currency.
   *
   * Refuses anything the database's own CHECK would refuse, in the same words
   * the page will print. It does not accept a clear-to-null: nulling the column
   * is what the correction script did once, under the founder's word, and a
   * button that silently un-answers a question every money figure depends on is
   * not the same kind of act as answering it.
   */
  async write(
    restaurantId: string,
    code: unknown,
    actorUserId: string,
  ): Promise<HouseCurrencyReadout> {
    // MEMBERSHIP, NOT SHAPE. `CURRENCY_CODE_PATTERN` is what the database will
    // take; `isIso4217` is whether the code names money. Both are asked, and
    // the refusal quotes what was sent — a house's reporting currency is the
    // rung an invoice with no stated currency is filed under, so a fake code
    // here denominates a vendor's paper.
    //
    // BOTH are asked, and the shape one is not redundant: `isIso4217` folds
    // case and whitespace, so it would admit `" try "`, and this method writes
    // the string it was GIVEN — which the database's own CHECK would then
    // refuse. The pattern keeps the write exact; membership keeps it money.
    if (
      typeof code !== "string" ||
      !CURRENCY_CODE_PATTERN.test(code) ||
      !isIso4217(code)
    ) {
      throw new BadRequestException(
        `${notACurrencyBecause(code)} Nothing was recorded.`,
      );
    }

    const before = await this.readHouse(restaurantId);
    // A failed read of the PREVIOUS value must not cancel a write the manager
    // has already asked for; the audit row then carries `from: null` and says
    // so. A failed read of the ROW ITSELF is different and is not reached here:
    // `readHouse` distinguishes them only by `row === null`, which the update
    // below would fail on anyway.
    const previous = before.row?.currency ?? null;

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({ currency: code })
      .eq("id", restaurantId);

    if (error) {
      this.logger.error(
        `Could not record the reporting currency for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not record the currency. Nothing was changed.",
      );
    }

    const receipt =
      previous === code
        ? { recorded: false, reason: "nothing changed" }
        : await this.audit.record({
            restaurantId,
            actorUserId,
            action: CURRENCY_AUDIT_ACTION,
            register: "currency",
            entityType: "restaurant",
            // The currency is a column on the restaurant, so the house IS the
            // entity the change happened to.
            entityId: restaurantId,
            subject: "reporting currency",
            fields: { currency: { from: previous, to: code } },
          });

    const after = await this.read(restaurantId);
    return {
      ...after,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("currency, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `Could not read the reporting currency for ${restaurantId}: ${error.message}`,
      );
      return { row: null, error: error.message };
    }
    return { row: (data as HouseRow | null) ?? null, error: null };
  }

  /**
   * Who last stated it, and when — from `system_audit_log`.
   *
   * Best-effort by design: a house whose currency was set before this route
   * existed (or corrected by `scripts/correct_restaurant_currency.py`) has no
   * row, and the answer is `null` with the page saying why. A failed read of
   * the trail returns `null` too, which is the one place this file cannot tell
   * "nobody" from "could not tell" — so the page's sentence for a null date
   * covers both rather than asserting either.
   */
  private async lastStated(restaurantId: string): Promise<{
    at: string | null;
    by: { userId: string | null; name: string | null } | null;
  }> {
    const { data, error } = await this.databaseService.client
      .from("system_audit_log")
      .select("actor_id, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("action", CURRENCY_AUDIT_ACTION)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) {
      if (error) {
        this.logger.warn(
          `The currency's own trail could not be read for ${restaurantId}: ${error.message}`,
        );
      }
      return { at: null, by: null };
    }
    const row = data[0] as { actor_id: string | null; created_at: string | null };
    const name = row.actor_id ? await this.nameOf(row.actor_id) : null;
    return {
      at: row.created_at ?? null,
      by: { userId: row.actor_id ?? null, name },
    };
  }

  /** `public.users.user_id` — never an `auth.users` id; the two are disjoint. */
  private async nameOf(userId: string): Promise<string | null> {
    const { data, error } = await this.databaseService.client
      .from("users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return (data as { name?: string | null } | null)?.name ?? null;
  }
}
