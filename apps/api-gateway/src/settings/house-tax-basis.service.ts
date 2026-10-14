import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SettingsAuditService } from "../settings-audit/settings-audit.service";
import {
  asHouseTaxBasis,
  asTaxRateKeyKind,
  type HouseTaxBasis,
  type TaxRateKeyKind,
} from "../common/tax-basis";
import { countryCodeOf, houseFrame } from "../common/house-frame";
import { houseDayOf, houseToday, shiftHouseDay } from "../common/house-day";

/**
 * Whether this house's till prices include tax, and the rates it charges —
 * lane 2 of the tax-inclusive decision (F-620 / F-1537).
 *
 * THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S218): F1 build it; F2 only from
 * now (no backfill: checks already stored stay as the till sent them, and the
 * confirmation moment is the switch date reports mark); F3 stamp cost basis
 * (margin advice is lane 4's, not this file's).
 *
 * THE RULES IT HOLDS
 *   1. Never defaulted, never inferred. `restaurants.tax_basis` starts `unset`
 *      on every house and is written ONLY from the answer in the request body,
 *      with the person and the moment, in ONE update (the database CHECK makes
 *      the three one fact). The house's country fills a PROPOSAL the page
 *      shows ("Prices on your till include KDV" for a house in Türkiye); a
 *      proposal is never written by a read, and nothing reads it but the page.
 *   2. Confirm once. Re-sending the answer already recorded writes nothing and
 *      files nothing: the confirmation moment is the switch date (F2), and
 *      re-stamping it on a same answer would mark a switch that did not
 *      happen (and would re-ask lane 4's target re-confirm for nothing).
 *   3. No un-answering. `unset` is the absence of an answer, so it is not a
 *      value this route writes, the rule the target margin holds.
 *   4. Rates are appended, never edited (`house_tax_rates` is append-only in
 *      the database). A rate is a PERCENT here (20 = 20 percent) and a
 *      fraction in the table. Withdrawing a rate (F-1586) is appended too:
 *      rows that restate, from the withdrawal day, what was in force for that
 *      key as if the withdrawn row had never been added (`withdrawalRows`). A rate keyed to one of the house's own items
 *      must be an item OF THIS HOUSE; any other id answers 404 (ADR 0147), so
 *      the answer never says whether another house's item exists.
 *   5. A failed read is never an empty one: `readable: false` with the reason.
 *   6. A house that never answers is a strict no-op: nothing here runs on a
 *      read but SELECTs, and ingest (lane 3) reads only a stated basis.
 *
 * The role check is NOT here. It is `assertCanManageRestaurant` on the
 * controller: owner or manager, the gate the target margin and the pour use.
 */

export const TAX_BASIS_AUDIT_ACTION = "house_tax_basis_confirmed" as const;
export const TAX_RATE_AUDIT_ACTION = "house_tax_rate_added" as const;
export const COCKTAIL_TAX_CATEGORY_AUDIT_ACTION =
  "house_cocktail_tax_category_set" as const;

/** The three answers a person may give. `unset` is not one of them. */
export const TAX_BASIS_ANSWERS = [
  "prices_include_tax",
  "prices_exclude_tax",
  "not_vat_charging",
] as const satisfies readonly HouseTaxBasis[];

export type TaxBasisAnswer = (typeof TAX_BASIS_ANSWERS)[number];

/** A rate is a percent: 0 up to (not including) 100, at most two decimals. */
export const TAX_RATE_MAX_PCT = 100;

/** A till category name is at most this long. */
export const POS_CATEGORY_MAX_LENGTH = 120;

/** How many rate rows a readout carries; the table is append-only, so it is capped. */
export const TAX_RATE_READ_CAP = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What the house calls the tax, in its own country's words; never a setting. */
export function taxWordFor(countryCode: string | null): string {
  if (countryCode === "TR") return "KDV";
  if (countryCode === "US") return "sales tax";
  return "tax";
}

export interface TaxBasisProposal {
  basis: TaxBasisAnswer;
  /** Rates the page may fill in, unkeyed; the owner chooses what each covers. */
  rates: { label: string; ratePct: number }[];
  /** Why it is proposed, in plain words. */
  why: string;
}

/**
 * The pre-fill the house's recorded COUNTRY allows (decision §1). A proposal,
 * never a value: nothing writes it, and a country with no line here proposes
 * nothing rather than guessing.
 *
 * Türkiye: menus must print prices with every tax included (Fiyat Etiketi
 * Yönetmeliği, 2022 amendment), and restaurant service carries 10% KDV on food
 * and soft drinks and 20% on alcohol (Presidential Decree 7346, July 2023). 1%
 * is a real KDV rate but not one restaurant service carries, so it is not
 * offered. United States: menu prices are shown before sales tax, which the
 * till adds on top; no rates are proposed, because rates are read only when
 * prices include tax.
 */
export function proposalFor(
  countryCode: string | null,
): TaxBasisProposal | null {
  if (countryCode === "TR") {
    return {
      basis: "prices_include_tax",
      rates: [
        { label: "Food and soft drinks", ratePct: 10 },
        { label: "Alcohol", ratePct: 20 },
      ],
      why: "Menus in Türkiye must show prices with KDV included. Restaurant food and soft drinks carry 10% KDV and alcohol 20% (Decree 7346, July 2023).",
    };
  }
  if (countryCode === "US") {
    return {
      basis: "prices_exclude_tax",
      rates: [],
      why: "In the United States menu prices are usually shown before sales tax, and the till adds the tax on top.",
    };
  }
  return null;
}

export interface TaxRateRow {
  version: number;
  keyKind: TaxRateKeyKind;
  /** '' for the whole house; the till's category name; or an item id. */
  key: string;
  /** For a `house_item` key, the item's name when it could be read. */
  itemName: string | null;
  /** PERCENT; null withdraws the key from `effectiveFrom`. */
  ratePct: number | null;
  effectiveFrom: string;
  /** Exclusive; null is open. */
  effectiveTo: string | null;
  /** This row is the one in force for its key on `today`. */
  inForceToday: boolean;
  /**
   * It starts after `today` and is the row in force for its key on its own
   * first day, so it will apply unless withdrawn (F-1586). A row a later
   * version masks from its first day is not upcoming.
   */
  upcoming: boolean;
  createdAt: string | null;
}

export interface HouseTaxBasisReadout {
  restaurantId: string;
  readable: boolean;
  reason: string | null;
  /** The stored basis, or null when the row holds a value this build does not know. */
  basis: HouseTaxBasis | null;
  /** Someone at the house has answered (the basis is not `unset`). */
  answered: boolean;
  /** The switch date reports mark (F2). Null while unset. */
  confirmedAt: string | null;
  /**
   * The house day of `confirmedAt`: the first day ingest makes net pre-tax
   * (tax-basis-resolver.ts compares house days, not instants; F-1585). Null
   * while unset or when the house has no time zone.
   */
  switchDay: string | null;
  confirmedBy: { userId: string; name: string | null } | null;
  /** The house's recorded country, as a code; null when none is recorded or known. */
  country: string | null;
  /** KDV, sales tax, or tax: the word the page uses. */
  taxWord: string;
  proposal: TaxBasisProposal | null;
  /** Every rate row, newest version first; null when they could not be read. */
  rates: TaxRateRow[] | null;
  ratesReason: string | null;
  /**
   * F-1615: the till category whose rate a cocktail's price holds, as an
   * owner or manager chose it; null when nobody has (or it was not read).
   */
  cocktailCategory: string | null;
  /** Why `cocktailCategory` could not be read; null when it was. */
  cocktailCategoryReason: string | null;
  /** The house's date `inForceToday` is judged on. */
  today: string;
  /** False when the house has no time zone and `today` is the UTC date. */
  todayOnHouseClock: boolean;
  /** Set by a write: whether it changed anything. */
  changed?: boolean;
  audited?: boolean;
  auditReason?: string | null;
}

interface HouseRow {
  tax_basis: string | null;
  tax_basis_confirmed_by: string | null;
  tax_basis_confirmed_at: string | null;
  country: string | null;
  timezone: string | null;
}

interface RateDbRow {
  version: number | string;
  key_kind: string;
  key: string | null;
  rate: number | string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string | null;
}

function asNumber(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A fraction to a percent, without float dust (0.2 -> 20, 0.085 -> 8.5). */
function toPct(fraction: number): number {
  return Math.round(fraction * 1_000_000) / 10_000;
}

/** A percent to the fraction the table keeps (numeric(6,4)). */
function toFraction(pct: number): number {
  return Math.round(pct * 100) / 10_000;
}

function realDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

/**
 * The row in force for one key on one business date: the highest version
 * among the key's rows whose span holds the date (`effective_to` exclusive).
 * Null when none does. A row it returns may carry a null rate: withdrawn.
 * The rule the migration's comment states, in one place lane 3 can call.
 */
export function rateRowInForce<
  R extends {
    keyKind: string;
    key: string;
    version: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  },
>(rows: readonly R[], keyKind: string, key: string, date: string): R | null {
  let best: R | null = null;
  for (const r of rows) {
    if (r.keyKind !== keyKind || r.key !== key) continue;
    if (r.effectiveFrom > date) continue;
    if (r.effectiveTo !== null && r.effectiveTo <= date) continue;
    if (best === null || r.version > best.version) best = r;
  }
  return best;
}

/** Null when the rate body may be written; otherwise the sentence the page prints. */
export function notARateBecause(body: {
  keyKind?: unknown;
  key?: unknown;
  ratePct?: unknown;
  effectiveFrom?: unknown;
  effectiveTo?: unknown;
}): string | null {
  const kind = asTaxRateKeyKind(body.keyKind);
  if (kind === null)
    return "Say what the rate covers: the whole house, one till category, or one of the house's items. Nothing was recorded.";
  if (kind === "pos_category") {
    if (typeof body.key !== "string" || body.key.trim() === "")
      return "Name the till category the rate covers, as the till names it. Nothing was recorded.";
    if (body.key.trim().length > POS_CATEGORY_MAX_LENGTH)
      return `A till category name is at most ${POS_CATEGORY_MAX_LENGTH} characters. Nothing was recorded.`;
  }
  if (
    kind === "house_item" &&
    (typeof body.key !== "string" || !UUID.test(body.key.toLowerCase()))
  )
    return "Name the item the rate covers by its id. Nothing was recorded.";
  const pct = body.ratePct;
  if (pct !== null) {
    if (typeof pct !== "number" || !Number.isFinite(pct))
      return "Say the rate as a percent (20 means 20 percent), or none to withdraw the rate from that date. Nothing was recorded.";
    if (pct < 0 || pct >= TAX_RATE_MAX_PCT)
      return `A rate is a percent from 0 up to ${TAX_RATE_MAX_PCT}; ${pct} is outside it. Nothing was recorded.`;
    if (pct > 0 && pct < 1)
      return `${pct} reads as under one percent. A rate is a PERCENT: 20 percent is 20, not 0.20. Nothing was recorded.`;
    if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-6)
      return "A rate has at most two decimals (8.25 percent). Nothing was recorded.";
  }
  if (!realDate(body.effectiveFrom))
    return "Say the first day the rate applies, as a date (2026-10-12). Nothing was recorded.";
  if (body.effectiveTo !== undefined && body.effectiveTo !== null) {
    if (!realDate(body.effectiveTo))
      return "The last day is a date (2026-12-31), or none for a rate with no end. Nothing was recorded.";
    if (body.effectiveTo <= (body.effectiveFrom as string))
      return "The rate must end after it starts. Nothing was recorded.";
  }
  return null;
}

/** A row `withdrawalRows` asks to append: PERCENT, null for no rate. */
export interface RestatedRate {
  ratePct: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The day a withdrawal starts (F-1586): a rate not yet in force is withdrawn
 * from its own first day, so it never applies; one already in force from
 * the house's next day, so a day already trading is never split between two
 * rates. Null when the row has ended by then and there is nothing to stop.
 */
export function withdrawalStart(
  row: { effectiveFrom: string; effectiveTo: string | null },
  today: string,
): string | null {
  const from =
    row.effectiveFrom > today ? row.effectiveFrom : shiftHouseDay(today, 1);
  if (row.effectiveTo !== null && row.effectiveTo <= from) return null;
  return from;
}

/**
 * How a rate is withdrawn on an append-only table (F-1586). The table refuses
 * UPDATE and DELETE, and a row with no rate would also cut off whatever rate
 * the key had before (a 20% from January withdrawn by a NULL row leaves the
 * key with no rate at all, not with the 18% it had). So the withdrawal
 * appends rows that restate, from `from` to the end of the withdrawn row's
 * span, what was in force for the key WITHOUT that row. Each piece runs
 * until the restated row ends or another of the key's rows starts, so the
 * newest-version-wins rule (`rateRowInForce`) reads exactly the table the
 * house would have had; a piece with nothing to restate is a NULL row, the
 * migration's own spelling of "this key has no rate from here".
 */
export function withdrawalRows(
  rows: readonly TaxRateRow[],
  withdrawn: TaxRateRow,
  from: string,
): RestatedRate[] {
  const others = rows.filter(
    (r) =>
      r.keyKind === withdrawn.keyKind &&
      r.key === withdrawn.key &&
      r.version !== withdrawn.version,
  );
  const end = withdrawn.effectiveTo;
  const out: RestatedRate[] = [];
  let start = from;
  while (end === null || start < end) {
    const before = rateRowInForce(
      others,
      withdrawn.keyKind,
      withdrawn.key,
      start,
    );
    let stop: string | null = end;
    if (before?.effectiveTo && (stop === null || before.effectiveTo < stop))
      stop = before.effectiveTo;
    for (const o of others)
      if (o.effectiveFrom > start && (stop === null || o.effectiveFrom < stop))
        stop = o.effectiveFrom;
    out.push({
      ratePct: before?.ratePct ?? null,
      effectiveFrom: start,
      effectiveTo: stop,
    });
    if (stop === null) break;
    start = stop;
  }
  return out;
}

@Injectable()
export class HouseTaxBasisService {
  private readonly logger = new Logger(HouseTaxBasisService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: SettingsAuditService,
  ) {}

  /** Only SELECTs. A house that never answers is never written by reading it. */
  async read(
    restaurantId: string,
    now: Date = new Date(),
  ): Promise<HouseTaxBasisReadout> {
    const house = await this.readHouse(restaurantId);
    const frame = houseFrame(house.row);
    const todayOnHouseClock = frame.zone !== null;
    const today = frame.zone
      ? houseToday(frame.zone, now)
      : now.toISOString().slice(0, 10);
    const country = countryCodeOf(house.row?.country ?? null);
    const base = {
      restaurantId,
      country,
      taxWord: taxWordFor(country),
      proposal: proposalFor(country),
      today,
      todayOnHouseClock,
    };
    if (house.error !== null) {
      return {
        ...base,
        readable: false,
        reason: house.error,
        basis: null,
        answered: false,
        confirmedAt: null,
        switchDay: null,
        confirmedBy: null,
        rates: null,
        ratesReason: null,
        cocktailCategory: null,
        cocktailCategoryReason: null,
      };
    }
    const basis = asHouseTaxBasis(house.row?.tax_basis ?? "unset");
    const answered = basis !== null && basis !== "unset";
    const by = answered ? (house.row?.tax_basis_confirmed_by ?? null) : null;
    const [name, rates, cocktail] = await Promise.all([
      this.nameOf(by),
      this.readRates(restaurantId, today),
      this.readCocktailCategory(restaurantId),
    ]);
    const confirmedAt = answered
      ? (house.row?.tax_basis_confirmed_at ?? null)
      : null;
    return {
      ...base,
      readable: true,
      reason: null,
      basis,
      answered,
      confirmedAt,
      switchDay:
        confirmedAt && frame.zone ? houseDayOf(confirmedAt, frame.zone) : null,
      confirmedBy: by ? { userId: by, name } : null,
      rates: rates.rows,
      ratesReason: rates.error,
      cocktailCategory: cocktail.category,
      cocktailCategoryReason: cocktail.error,
    };
  }

  /**
   * F-1615 (coordinator's call S230, within ADR 0341 §6: category or item
   * rate mapping is owner work): say which of the house's till categories
   * prices its cocktails, or null to take the choice back. Only a category
   * the house has a rate row for may be chosen; nothing is inferred from a
   * name. The same choice as recorded writes nothing.
   */
  async setCocktailCategory(
    restaurantId: string,
    body: { category?: unknown },
    actorUserId: string,
  ): Promise<HouseTaxBasisReadout> {
    const raw = body?.category;
    if (raw !== null && typeof raw !== "string")
      throw new BadRequestException(
        "Name the till category that prices cocktails, or none to take the choice back. Nothing was recorded.",
      );
    const category = raw === null ? null : raw.trim() || null;
    const current = await this.read(restaurantId);
    if (!current.readable || current.rates === null) {
      throw new InternalServerErrorException(
        `This house's rates could not be read, so nothing was changed: ${current.reason ?? current.ratesReason ?? "no reason was given"}`,
      );
    }
    if (current.cocktailCategoryReason !== null) {
      throw new InternalServerErrorException(
        `Which till category prices cocktails could not be read, so nothing was changed: ${current.cocktailCategoryReason}`,
      );
    }
    if (
      category !== null &&
      !current.rates.some(
        (r) => r.keyKind === "pos_category" && r.key === category,
      )
    )
      throw new BadRequestException(
        `This house has no rate for a till category named “${category}”. Choose one of its till-category rates, or add that rate first. Nothing was recorded.`,
      );
    if (current.cocktailCategory === category) {
      return {
        ...current,
        changed: false,
        audited: false,
        auditReason: "nothing changed, so nothing was filed",
      };
    }
    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({ cocktail_tax_category: category })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the cocktail tax category for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not record which till category prices cocktails. Nothing was changed. ${error.message}`,
      );
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: COCKTAIL_TAX_CATEGORY_AUDIT_ACTION,
      register: "tax-basis",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "which till category's tax rate prices cocktails",
      fields: {
        cocktail_tax_category: { from: current.cocktailCategory, to: category },
      },
    });
    const after = await this.read(restaurantId);
    return {
      ...after,
      changed: true,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /**
   * Confirm the house's basis. One of the three answers; the same answer as
   * recorded is a no-op (rule 2). The basis, the person and the moment go in
   * ONE update.
   */
  async confirm(
    restaurantId: string,
    body: { basis?: unknown },
    actorUserId: string,
  ): Promise<HouseTaxBasisReadout> {
    const answer = body?.basis;
    if (
      typeof answer !== "string" ||
      !(TAX_BASIS_ANSWERS as readonly string[]).includes(answer)
    ) {
      throw new BadRequestException(
        answer === "unset"
          ? "An answer cannot be taken back to “not stated” here. Choose which is true of this house's till. Nothing was recorded."
          : "Say which is true of this house's till: its prices include tax, tax is added on top, or the house charges no VAT. Nothing was recorded.",
      );
    }
    const before = await this.readHouse(restaurantId);
    if (before.error !== null) {
      throw new InternalServerErrorException(
        `This house's tax setting could not be read, so nothing was changed: ${before.error}`,
      );
    }
    if (!before.row)
      throw new NotFoundException("No such house. Nothing was changed.");
    const previous = before.row.tax_basis ?? "unset";
    if (previous === answer) {
      const same = await this.read(restaurantId);
      return {
        ...same,
        changed: false,
        audited: false,
        auditReason: "nothing changed, so nothing was filed",
      };
    }

    const { error } = await this.databaseService.client
      .from("restaurants")
      .update({
        tax_basis: answer,
        tax_basis_confirmed_by: actorUserId,
        tax_basis_confirmed_at: new Date().toISOString(),
      })
      .eq("id", restaurantId);
    if (error) {
      this.logger.error(
        `Could not record the tax basis for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `Could not record whether this house's prices include tax. Nothing was changed. ${error.message}`,
      );
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: TAX_BASIS_AUDIT_ACTION,
      register: "tax-basis",
      entityType: "restaurant",
      entityId: restaurantId,
      subject: "whether till prices include tax",
      fields: { tax_basis: { from: previous, to: answer } },
    });
    const after = await this.read(restaurantId);
    return {
      ...after,
      changed: true,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /**
   * Append one rate row. The database numbers it (the house's next version)
   * and refuses any edit later; a correction is another row.
   */
  async addRate(
    restaurantId: string,
    body: {
      keyKind?: unknown;
      key?: unknown;
      ratePct?: unknown;
      effectiveFrom?: unknown;
      effectiveTo?: unknown;
    },
    actorUserId: string,
  ): Promise<HouseTaxBasisReadout> {
    const why = notARateBecause(body ?? {});
    if (why !== null) throw new BadRequestException(why);
    const keyKind = asTaxRateKeyKind(body.keyKind) as TaxRateKeyKind;
    const key =
      keyKind === "house"
        ? ""
        : keyKind === "house_item"
          ? String(body.key).toLowerCase()
          : String(body.key).trim();
    const ratePct = body.ratePct as number | null;
    const client = this.databaseService.client;

    let subject = "the house's tax rate";
    if (keyKind === "house_item") {
      const { data, error } = await client
        .from("restaurant_inventory")
        .select("id, wine_name")
        .eq("id", key)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (error) {
        throw new InternalServerErrorException(
          `The item could not be read, so no rate was recorded: ${error.message}`,
        );
      }
      // ADR 0147: another house's id and no id at all answer the same.
      if (!data)
        throw new NotFoundException(
          "No item of this house by that id. Nothing was recorded.",
        );
      subject = `the tax rate on ${(data as { wine_name?: string | null }).wine_name ?? "an item"}`;
    } else if (keyKind === "pos_category") {
      subject = `the tax rate on the till category “${key}”`;
    }

    const { error } = await client.from("house_tax_rates").insert({
      restaurant_id: restaurantId,
      key_kind: keyKind,
      key,
      rate: ratePct === null ? null : toFraction(ratePct),
      effective_from: body.effectiveFrom as string,
      effective_to: (body.effectiveTo as string | null | undefined) ?? null,
      created_by: actorUserId,
    });
    if (error) {
      this.logger.error(
        `Could not add a tax rate for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `The rate was not recorded. Nothing was changed. ${error.message}`,
      );
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: TAX_RATE_AUDIT_ACTION,
      register: "tax-basis",
      entityType: "house_tax_rates",
      entityId: restaurantId,
      subject,
      fields: {
        rate_pct: { from: null, to: ratePct },
        effective_from: { from: null, to: body.effectiveFrom },
        ...(body.effectiveTo
          ? { effective_to: { from: null, to: body.effectiveTo } }
          : {}),
      },
    });
    const after = await this.read(restaurantId);
    return {
      ...after,
      changed: true,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  /**
   * Withdraw one rate row (F-1586), by appending the rows `withdrawalRows`
   * restates, in ONE insert so the house never reads half a withdrawal. The
   * row is named by its version within THIS house; any other answers 404.
   */
  async withdrawRate(
    restaurantId: string,
    version: unknown,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<HouseTaxBasisReadout> {
    const v = typeof version === "string" ? Number(version) : version;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      throw new BadRequestException(
        "Name the rate to withdraw by its number. Nothing was recorded.",
      );
    const current = await this.read(restaurantId, now);
    if (!current.readable || current.rates === null) {
      throw new InternalServerErrorException(
        `This house's rates could not be read, so nothing was withdrawn: ${current.reason ?? current.ratesReason ?? "no reason was given"}`,
      );
    }
    // The restated rows are worked out from the key's whole history; a read
    // cut at the cap could miss a row and restate the wrong rate.
    if (current.rates.length >= TAX_RATE_READ_CAP)
      throw new InternalServerErrorException(
        `This house has more than ${TAX_RATE_READ_CAP} rate rows, so a withdrawal cannot be worked out safely here. Nothing was changed.`,
      );
    const row = current.rates.find((r) => r.version === v);
    if (!row)
      throw new NotFoundException(
        "No rate of this house by that number. Nothing was recorded.",
      );
    if (row.ratePct === null)
      throw new BadRequestException(
        "That row already says the rate is withdrawn. Nothing was recorded.",
      );
    const from = withdrawalStart(row, current.today);
    if (from === null)
      throw new BadRequestException(
        `That rate ended on ${row.effectiveTo}, so there is nothing to withdraw. Nothing was recorded.`,
      );
    const restated = withdrawalRows(current.rates, row, from);
    const { error } = await this.databaseService.client
      .from("house_tax_rates")
      .insert(
        restated.map((r) => ({
          restaurant_id: restaurantId,
          key_kind: row.keyKind,
          key: row.key,
          rate: r.ratePct === null ? null : toFraction(r.ratePct),
          effective_from: r.effectiveFrom,
          effective_to: r.effectiveTo,
          created_by: actorUserId,
        })),
      );
    if (error) {
      this.logger.error(
        `Could not withdraw tax rate ${v} for ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        `The rate was not withdrawn. Nothing was changed. ${error.message}`,
      );
    }
    const receipt = await this.audit.record({
      restaurantId,
      actorUserId,
      action: TAX_RATE_AUDIT_ACTION,
      register: "tax-basis",
      entityType: "house_tax_rates",
      entityId: restaurantId,
      subject: `withdrawing the ${row.ratePct}% tax rate on ${row.keyKind === "house" ? "everything" : row.keyKind === "pos_category" ? `the till category “${row.key}”` : (row.itemName ?? "an item")}`,
      fields: {
        withdrawn_version: { from: v, to: null },
        effective_from: { from: null, to: from },
      },
    });
    const after = await this.read(restaurantId, now);
    return {
      ...after,
      changed: true,
      audited: receipt.recorded,
      auditReason: receipt.reason,
    };
  }

  private async readHouse(
    restaurantId: string,
  ): Promise<{ row: HouseRow | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select(
        "tax_basis, tax_basis_confirmed_by, tax_basis_confirmed_at, country, timezone",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return { row: null, error: error.message };
    return { row: (data as HouseRow | null) ?? null, error: null };
  }

  private async readRates(
    restaurantId: string,
    today: string,
  ): Promise<{ rows: TaxRateRow[] | null; error: string | null }> {
    const client = this.databaseService.client;
    const { data, error } = await client
      .from("house_tax_rates")
      .select(
        "version, key_kind, key, rate, effective_from, effective_to, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .order("version", { ascending: false })
      .limit(TAX_RATE_READ_CAP);
    if (error) {
      this.logger.warn(
        `The tax rates of ${restaurantId} could not be read: ${error.message}`,
      );
      return { rows: null, error: error.message };
    }
    const rows: TaxRateRow[] = [];
    for (const r of (data as RateDbRow[] | null) ?? []) {
      const keyKind = asTaxRateKeyKind(r.key_kind);
      const version = asNumber(r.version);
      if (keyKind === null || version === null) continue;
      const fraction = asNumber(r.rate);
      rows.push({
        version,
        keyKind,
        key: r.key ?? "",
        itemName: null,
        ratePct: fraction === null ? null : toPct(fraction),
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        inForceToday: false,
        upcoming: false,
        createdAt: r.created_at,
      });
    }
    for (const r of rows) {
      r.inForceToday = rateRowInForce(rows, r.keyKind, r.key, today) === r;
      r.upcoming =
        r.effectiveFrom > today &&
        rateRowInForce(rows, r.keyKind, r.key, r.effectiveFrom) === r;
    }
    const itemIds = [
      ...new Set(
        rows.filter((r) => r.keyKind === "house_item").map((r) => r.key),
      ),
    ];
    if (itemIds.length > 0) {
      const { data: items, error: itemsErr } = await client
        .from("restaurant_inventory")
        .select("id, wine_name")
        .eq("restaurant_id", restaurantId)
        .in("id", itemIds);
      if (!itemsErr) {
        const names = new Map(
          (
            (items as { id: string; wine_name: string | null }[] | null) ?? []
          ).map((i) => [i.id, i.wine_name]),
        );
        for (const r of rows)
          if (r.keyKind === "house_item") r.itemName = names.get(r.key) ?? null;
      }
    }
    return { rows, error: null };
  }

  /**
   * F-1615: read on its own, so a failure says itself and never makes the
   * basis or the rates unreadable.
   */
  private async readCocktailCategory(
    restaurantId: string,
  ): Promise<{ category: string | null; error: string | null }> {
    const { data, error } = await this.databaseService.client
      .from("restaurants")
      .select("cocktail_tax_category")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) return { category: null, error: error.message };
    const raw = (data as { cocktail_tax_category?: unknown } | null)
      ?.cocktail_tax_category;
    return {
      category: typeof raw === "string" && raw !== "" ? raw : null,
      error: null,
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
    if (error) return null;
    return (data as { name?: string | null } | null)?.name ?? null;
  }
}
