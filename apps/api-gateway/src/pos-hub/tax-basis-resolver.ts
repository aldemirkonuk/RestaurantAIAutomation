import { readWholeWindow } from "../common/read-whole-window";
import { houseDayOf } from "../common/house-day";
import { houseFrame } from "../common/house-frame";
import {
  asHouseTaxBasis,
  asTaxRateKeyKind,
  type HouseTaxBasis,
  type TaxRateKeyKind,
} from "../common/tax-basis";
import { rateRowInForce } from "../settings/house-tax-basis.service";

/**
 * A till's subtotal made pre-tax AT INGEST — lane 3 of the tax-inclusive
 * decision (F-620 / F-1537).
 *
 * THE FOUNDER'S PICKS, 2026-10-12 (sim ledger S218): F1 build it; F2 only from
 * now (no backfill: a check dated before the switch keeps the till's figure);
 * F3 stamp cost basis (lane 4's, not this file's).
 *
 * WHY. AW17 (ADR 0287) labels `pos_checks.subtotal` net sales. A Turkish till
 * prints prices with KDV inside, so its subtotal read 9-17% high as "net"
 * (F-1537). ADR 0295's draft (PR #615) keeps ONE stored definition of net and
 * rejects computing it at read time, so it is computed here, once, when the
 * check is written, and the row says how.
 *
 * THE RULES
 *   1. `unset` is a STRICT NO-OP: `resolveCheckSubtotal` answers `as_before`
 *      and the hub writes the row exactly as it did before this file, with no
 *      new key. Every house is unset until its owner or manager answers.
 *   2. `prices_exclude_tax` and `not_vat_charging`: the till's subtotal is the
 *      net, unchanged; the row only records the basis and the figure as sent.
 *   3. `prices_include_tax`, for a check on or after the switch day (the house
 *      day of `tax_basis_confirmed_at`), in this order of trust:
 *        rung 1  the tax the till states: the adapter already took it off
 *                (Square), or the check names `tax` (generic/CSV);
 *        rung 2  a rate for every line (the till's own line rate, else the
 *                house's rate in force on the check's house day, by item,
 *                then till category, then whole house), PRORATED from the
 *                till's own subtotal:
 *                  net = subtotal * sum(line_i/(1+r_i)) / sum(line_i)
 *                never summed from the lines, which would drop check-level
 *                discounts, comps and rounding;
 *        rung 3  one rate divided out of the whole check, when the house has
 *                a whole-house rate and every rate in force that day is that
 *                same one;
 *        rung 4  otherwise NULL, with the reason. Never a guess.
 *   4. A check dated before the switch day keeps the till's figure and writes
 *      the three stamp columns as NULL (F2), so a late re-send of an old check
 *      never carries a stamp that no longer describes its figure.
 *
 * Pure apart from `loadHouseTaxContext`, which reads the house row and, for an
 * inclusive house only, its rate rows.
 */

/** One `house_tax_rates` row, as ingest uses it. `rate` is a fraction. */
export interface HouseRateRow {
  version: number;
  keyKind: TaxRateKeyKind;
  key: string;
  rate: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface HouseTaxContext {
  /** `unset` also when the house row is not there (the upsert then fails as before). */
  basis: HouseTaxBasis;
  /** `tax_basis_confirmed_at`: the switch. Null exactly when unset. */
  confirmedAt: string | null;
  /** The house's zone (own, else its country's only one); null when none. */
  zone: string | null;
  /** Read only for `prices_include_tax`; empty otherwise. */
  rates: HouseRateRow[];
  /** The highest version read: "the table as of version V". */
  rateVersion: number | null;
}

export type HouseTaxContextRead =
  | { ok: true; ctx: HouseTaxContext }
  | { ok: false; message: string };

/** The subset of a Supabase client this file uses. */
interface TaxReadClient {
  from: (table: string) => any;
}

/**
 * The house's basis, switch moment and zone, and for an inclusive house its
 * whole rate table. A failed read, or a basis this build does not know, is
 * `ok: false`: the hub then refuses the house's checks rather than writing a
 * figure on a basis nobody read (ADR 0020).
 */
export async function loadHouseTaxContext(
  client: TaxReadClient,
  restaurantId: string,
): Promise<HouseTaxContextRead> {
  let data: any;
  try {
    const res = await client
      .from("restaurants")
      .select("tax_basis, tax_basis_confirmed_at, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (res?.error)
      return {
        ok: false,
        message: `the house's tax basis could not be read: ${res.error.message ?? String(res.error)}`,
      };
    data = res?.data ?? null;
  } catch (err: any) {
    return {
      ok: false,
      message: `the house's tax basis could not be read: ${err?.message ?? String(err)}`,
    };
  }
  if (data === null) {
    return {
      ok: true,
      ctx: {
        basis: "unset",
        confirmedAt: null,
        zone: null,
        rates: [],
        rateVersion: null,
      },
    };
  }
  const basis = asHouseTaxBasis(data.tax_basis);
  if (basis === null)
    return {
      ok: false,
      message: `the house's tax basis reads as ${JSON.stringify(data.tax_basis ?? null)}, which is not one this build knows`,
    };
  const zone = houseFrame(data).zone;
  const confirmedAt =
    typeof data.tax_basis_confirmed_at === "string"
      ? data.tax_basis_confirmed_at
      : null;
  if (basis !== "prices_include_tax") {
    return {
      ok: true,
      ctx: { basis, confirmedAt, zone, rates: [], rateVersion: null },
    };
  }
  let raw: any[];
  try {
    raw = await readWholeWindow<any>("The house's tax rates", () =>
      client
        .from("house_tax_rates")
        .select(
          "id, version, key_kind, key, rate, effective_from, effective_to",
          { count: "exact" },
        )
        .eq("restaurant_id", restaurantId),
    );
  } catch (err: any) {
    return {
      ok: false,
      message: `the house's tax rates could not be read: ${err?.message ?? String(err)}`,
    };
  }
  const rates: HouseRateRow[] = [];
  for (const r of raw) {
    const keyKind = asTaxRateKeyKind(r?.key_kind);
    const version = Number(r?.version);
    const rate =
      r?.rate === null || r?.rate === undefined ? null : Number(r.rate);
    if (
      keyKind === null ||
      !Number.isInteger(version) ||
      (rate !== null && !(Number.isFinite(rate) && rate >= 0 && rate < 1)) ||
      typeof r?.effective_from !== "string"
    ) {
      return {
        ok: false,
        message: `a tax rate of the house could not be read (version ${JSON.stringify(r?.version ?? null)})`,
      };
    }
    rates.push({
      version,
      keyKind,
      key: typeof r.key === "string" ? r.key : "",
      rate,
      effectiveFrom: r.effective_from.slice(0, 10),
      effectiveTo:
        typeof r.effective_to === "string" ? r.effective_to.slice(0, 10) : null,
    });
  }
  const rateVersion = rates.length
    ? Math.max(...rates.map((r) => r.version))
    : null;
  return { ok: true, ctx: { basis, confirmedAt, zone, rates, rateVersion } };
}

/** What the resolver needs of a check. */
export interface CheckForTax {
  /** The subtotal as the adapter read it from the till. */
  subtotal: number | null;
  total: number | null;
  tip: number | null;
  /** Tax the till states inside the subtotal (rung 1). */
  tax?: number;
  /** The adapter already took the till's tax off (rung 1). */
  subtotalPreTax?: boolean;
  /**
   * F-1584: the till sent a `tax` or a line `tax_rate` that could not be read.
   * Only an inclusive house on or after its switch day needs either, so only
   * there does it leave net not recorded; every other house ignores it.
   */
  taxUnread?: boolean;
  closedAt: string | null;
  openedAt: string | null;
  lines: {
    qty: number;
    price: number | null;
    category: string | null;
    inventoryId: string | null;
    /** The till's own line rate (fraction), when it states one. */
    taxRate?: number;
  }[];
}

export type TaxRung =
  | "not_inclusive"
  | "before_switch"
  | "no_subtotal"
  | "till_stated"
  | "rates_per_line"
  | "single_rate"
  | "unresolved";

export type TaxStamp =
  | { kind: "as_before" }
  | {
      kind: "stamped";
      rung: TaxRung;
      /** What `pos_checks.subtotal` receives. */
      subtotal: number | null;
      gross_subtotal: number | null;
      tax_basis: HouseTaxBasis | null;
      tax_rate_version: number | null;
      /** Why net was not recorded; null when it was (or nothing was to do). */
      unresolved: string | null;
    };

/** Sentences ingest groups in errors[] when a check's net is not recorded. */
export const NET_NOT_RECORDED = {
  noZone:
    "this house's time zone isn't set, so the rate in force on the check's day is not known",
  noRate: "no tax rate of this house is in force on the check's day",
  mixed:
    "its lines are sold at different rates and not every line could be matched to one",
  taxOverSubtotal: "the till's tax is more than its subtotal",
  taxOnTop:
    "the till adds its tax on top of the subtotal, but this house says its till prices include tax",
  taxUnread:
    "the till's tax, or a line's tax rate, could not be read — write tax as 12.50 and a rate as 20 for 20 percent",
} as const;

const round2 = (n: number): number =>
  (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;

/**
 * The house's rate in force for one line on `day`: by the house's own item,
 * then the till category exactly as the till names it, then the whole house.
 * A withdrawn key (rate NULL in force) falls through to the next.
 */
function houseRateForLine(
  rates: readonly HouseRateRow[],
  day: string,
  line: CheckForTax["lines"][number],
): number | null {
  const tries: [TaxRateKeyKind, string | null][] = [
    ["house_item", line.inventoryId],
    ["pos_category", line.category ? line.category.trim() : null],
    ["house", ""],
  ];
  for (const [kind, key] of tries) {
    if (key === null || (kind !== "house" && key === "")) continue;
    const row = rateRowInForce(rates, kind, key, day);
    if (row && row.rate !== null) return row.rate;
  }
  return null;
}

/** Every rate in force on `day`, and whether a whole-house one is among them. */
function ratesInForce(
  rates: readonly HouseRateRow[],
  day: string,
): { values: Set<number>; houseWide: number | null } {
  const values = new Set<number>();
  const keys = new Set(rates.map((r) => `${r.keyKind}\u0000${r.key}`));
  let houseWide: number | null = null;
  for (const k of keys) {
    const [kind, key] = k.split("\u0000");
    const row = rateRowInForce(rates, kind, key, day);
    if (!row || row.rate === null) continue;
    values.add(row.rate);
    if (kind === "house") houseWide = row.rate;
  }
  return { values, houseWide };
}

/**
 * How one check's subtotal is written under the house's basis. Pure.
 */
export function resolveCheckSubtotal(
  check: CheckForTax,
  ctx: HouseTaxContext,
): TaxStamp {
  if (ctx.basis === "unset") return { kind: "as_before" };
  const gross = check.subtotal;
  const stamped = (
    rung: TaxRung,
    subtotal: number | null,
    version: number | null = null,
    unresolved: string | null = null,
  ): TaxStamp => ({
    kind: "stamped",
    rung,
    subtotal,
    gross_subtotal: gross,
    tax_basis: ctx.basis,
    tax_rate_version: version,
    unresolved,
  });
  if (ctx.basis !== "prices_include_tax")
    return stamped("not_inclusive", gross);

  const day = ctx.zone
    ? houseDayOf(
        { closed_at: check.closedAt, opened_at: check.openedAt },
        ctx.zone,
      )
    : null;
  const switchDay =
    ctx.zone && ctx.confirmedAt ? houseDayOf(ctx.confirmedAt, ctx.zone) : null;
  if (day === null || switchDay === null)
    return stamped("unresolved", null, null, NET_NOT_RECORDED.noZone);
  // F2: only from now. A check filed before the switch day keeps the till's
  // figure and carries no stamp, whenever it arrives.
  if (day < switchDay)
    return {
      kind: "stamped",
      rung: "before_switch",
      subtotal: gross,
      gross_subtotal: null,
      tax_basis: null,
      tax_rate_version: null,
      unresolved: null,
    };
  if (gross === null) return stamped("no_subtotal", null);
  // F-1599: a check that took no money (fully comped, every line at 0) has a
  // net of 0 whatever its rates; it is not a check with net not recorded.
  if (gross === 0) return stamped("till_stated", 0);
  if (check.taxUnread === true)
    return stamped("unresolved", null, null, NET_NOT_RECORDED.taxUnread);

  // Rung 1: the tax the till states.
  if (check.subtotalPreTax === true) return stamped("till_stated", gross);
  if (check.tax !== undefined) {
    const tax = check.tax;
    if (tax < 0 || tax > Math.abs(gross))
      return stamped(
        "unresolved",
        null,
        null,
        NET_NOT_RECORDED.taxOverSubtotal,
      );
    if (
      tax > 0 &&
      check.total !== null &&
      check.total - (check.tip ?? 0) >= gross + tax - 0.005
    )
      return stamped("unresolved", null, null, NET_NOT_RECORDED.taxOnTop);
    return stamped("till_stated", round2(gross - tax));
  }

  // Rung 2: a rate for every line, prorated from the till's own subtotal.
  let usedHouseRate = false;
  const rated = check.lines.map((l) => {
    if (l.taxRate !== undefined) return l.taxRate;
    const r = houseRateForLine(ctx.rates, day, l);
    if (r !== null) usedHouseRate = true;
    return r;
  });
  const signed = check.lines.map((l) =>
    l.price === null ? null : l.qty * l.price,
  );
  // F-1599: a refund's lines sum below 0. It is prorated on the lines' sizes
  // (absolute weights), so each rate carries the same share as in a sale.
  const refund = !(signed.reduce<number>((a, w) => a + (w ?? 0), 0) > 0);
  const weights = refund
    ? signed.map((w) => (w === null ? null : Math.abs(w)))
    : signed;
  const lineSum = weights.reduce<number>((a, w) => a + (w ?? 0), 0);
  if (
    check.lines.length > 0 &&
    rated.every((r) => r !== null) &&
    weights.every((w) => w !== null) &&
    lineSum > 0
  ) {
    const netWeight = weights.reduce<number>(
      (a, w, i) => a + (w as number) / (1 + (rated[i] as number)),
      0,
    );
    const net = round2((gross * netWeight) / lineSum);
    return stamped(
      "rates_per_line",
      net,
      usedHouseRate ? ctx.rateVersion : null,
    );
  }

  // Rung 3: one whole-house rate, and no other rate in force that day.
  const { values, houseWide } = ratesInForce(ctx.rates, day);
  const tillRates = check.lines
    .map((l) => l.taxRate)
    .filter((r): r is number => r !== undefined);
  if (
    houseWide !== null &&
    values.size === 1 &&
    tillRates.every((r) => r === houseWide)
  ) {
    return stamped(
      "single_rate",
      round2(gross / (1 + houseWide)),
      ctx.rateVersion,
    );
  }

  // Rung 4: null, with the reason.
  return stamped(
    "unresolved",
    null,
    null,
    values.size === 0 && tillRates.length === 0
      ? NET_NOT_RECORDED.noRate
      : NET_NOT_RECORDED.mixed,
  );
}
