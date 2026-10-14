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
import {
  readTaxBasisHistory,
  stretchOn,
  taxBasisStretches,
  type TaxBasisStretch,
} from "../common/tax-basis-history";

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
 *   5. F-1700: the answer is the one in force on the check's own house day
 *      (`house_tax_basis_answers`, the stretches the readers mark), not the
 *      one in force when the check arrives. A late or corrected check of an
 *      "include" day is made pre-tax after the house says "added on top", and
 *      one of the first "include" days still is after it says "include" again.
 *      A day before the house's first answer is as rules 2 and 4 say.
 *
 * Pure apart from `loadHouseTaxContext`, which reads the house row, its
 * answer history when asked, and, for a house that has ever said "include",
 * its rate rows.
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
  /** Read only when an answer in force on some day is `prices_include_tax`; empty otherwise. */
  rates: HouseRateRow[];
  /** The highest version read: "the table as of version V". */
  rateVersion: number | null;
  /**
   * F-1700: every answer the house gave and the house days each covers
   * (`taxBasisStretches`). Read for ingest only; absent, every check is on
   * the answer in force now.
   */
  stretches?: TaxBasisStretch[];
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
 * whole rate table. With `history`, also every answer it gave (F-1700), and
 * the rate table when any of them is "include". A failed read, or a basis
 * this build does not know, is `ok: false`: the hub then refuses the house's
 * checks rather than writing a figure on a basis nobody read (ADR 0020).
 */
export async function loadHouseTaxContext(
  client: TaxReadClient,
  restaurantId: string,
  opts: { history?: boolean } = {},
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
  let stretches: TaxBasisStretch[] | undefined;
  if (opts.history === true && basis !== "unset") {
    try {
      stretches = taxBasisStretches(
        await readTaxBasisHistory(client, restaurantId, {
          basis,
          confirmedAt,
        }),
        zone,
      );
    } catch (err: any) {
      // readTaxBasisHistory's sentence already names what failed.
      const m = String(err?.message ?? err);
      return { ok: false, message: m.charAt(0).toLowerCase() + m.slice(1) };
    }
  }
  const history = stretches ? { stretches } : {};
  if (
    basis !== "prices_include_tax" &&
    !(stretches ?? []).some((s) => s.basis === "prices_include_tax")
  ) {
    return {
      ok: true,
      ctx: {
        basis,
        confirmedAt,
        zone,
        rates: [],
        rateVersion: null,
        ...history,
      },
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
  return {
    ok: true,
    ctx: { basis, confirmedAt, zone, rates, rateVersion, ...history },
  };
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
      /**
       * F-1612: the same reason as a code, stored on the check
       * (`pos_checks.net_not_recorded_reason`) so the pages that count these
       * checks can say which cause each one has. Null exactly when
       * `unresolved` is.
       */
      reason: NetNotRecordedReason | null;
    };

/** Sentences ingest groups in errors[] when a check's net is not recorded. */
export const NET_NOT_RECORDED = {
  noZone:
    "this house's time zone isn't set, so the rate in force on the check's day is not known",
  noRate: "no tax rate of this house is in force on the check's day",
  mixed:
    "its lines are sold at different rates and not every line could be matched to one",
  taxOverSubtotal:
    "the till's tax is more than its subtotal, or runs the other way from it",
  taxOnTop:
    "the till adds its tax on top of the subtotal, but this house says its till prices include tax",
  taxUnread:
    "the till's tax, or a line's tax rate, could not be read — write tax as 12.50 and a rate as 20 for 20 percent",
} as const;

/**
 * F-1612: the code each sentence above is stored as on the check. The
 * database holds the same six (pos_checks_net_not_recorded_reason_known);
 * the dashboard and the registers count by it and word each one.
 */
export const NET_NOT_RECORDED_REASON = {
  noZone: "no_zone",
  noRate: "no_rate",
  mixed: "mixed_rates",
  taxOverSubtotal: "tax_over_subtotal",
  taxOnTop: "tax_on_top",
  taxUnread: "tax_unread",
} as const satisfies Record<keyof typeof NET_NOT_RECORDED, string>;

export type NetNotRecordedReason =
  (typeof NET_NOT_RECORDED_REASON)[keyof typeof NET_NOT_RECORDED_REASON];

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
 * F-1700: the house's answer as it stood on the check's own house day, with
 * that answer's moment as the switch. The answer in force now when there is
 * no history, no zone, no day, or the day is before the house's first answer.
 */
function answerOnCheckDay(
  check: Pick<CheckForTax, "closedAt" | "openedAt">,
  ctx: HouseTaxContext,
): HouseTaxContext {
  if (!ctx.stretches?.length || !ctx.zone) return ctx;
  const day = houseDayOf(
    { closed_at: check.closedAt, opened_at: check.openedAt },
    ctx.zone,
  );
  const inForce = day === null ? null : stretchOn(ctx.stretches, day);
  if (inForce === null) return ctx;
  return { ...ctx, basis: inForce.basis, confirmedAt: inForce.answeredAt };
}

/**
 * How one check's subtotal is written under the house's basis. Pure.
 */
export function resolveCheckSubtotal(
  check: CheckForTax,
  ctx: HouseTaxContext,
): TaxStamp {
  if (ctx.basis === "unset") return { kind: "as_before" };
  const at = answerOnCheckDay(check, ctx);
  const gross = check.subtotal;
  const stamped = (
    rung: TaxRung,
    subtotal: number | null,
    version: number | null = null,
    why: keyof typeof NET_NOT_RECORDED | null = null,
  ): TaxStamp => ({
    kind: "stamped",
    rung,
    subtotal,
    gross_subtotal: gross,
    tax_basis: at.basis,
    tax_rate_version: version,
    unresolved: why === null ? null : NET_NOT_RECORDED[why],
    reason: why === null ? null : NET_NOT_RECORDED_REASON[why],
  });
  if (at.basis !== "prices_include_tax") return stamped("not_inclusive", gross);

  const day = at.zone
    ? houseDayOf(
        { closed_at: check.closedAt, opened_at: check.openedAt },
        at.zone,
      )
    : null;
  const switchDay =
    at.zone && at.confirmedAt ? houseDayOf(at.confirmedAt, at.zone) : null;
  if (day === null || switchDay === null)
    return stamped("unresolved", null, null, "noZone");
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
      reason: null,
    };
  if (gross === null) return stamped("no_subtotal", null);
  // F-1599: a check that took no money (fully comped, every line at 0) has a
  // net of 0 whatever its rates; it is not a check with net not recorded.
  if (gross === 0) return stamped("till_stated", 0);
  if (check.taxUnread === true)
    return stamped("unresolved", null, null, "taxUnread");

  // Rung 1: the tax the till states.
  if (check.subtotalPreTax === true) return stamped("till_stated", gross);
  if (check.tax !== undefined) {
    const tax = check.tax;
    // F-1613: a refund's tax runs the same way as its subtotal (subtotal
    // -118, tax -18: net -100). A tax of the other sign, or larger than the
    // subtotal, is not taken off.
    const way = Math.sign(gross);
    if (way * tax < 0 || Math.abs(tax) > Math.abs(gross))
      return stamped("unresolved", null, null, "taxOverSubtotal");
    if (
      tax !== 0 &&
      check.total !== null &&
      way * (check.total - (check.tip ?? 0)) >= way * (gross + tax) - 0.005
    )
      return stamped("unresolved", null, null, "taxOnTop");
    return stamped("till_stated", round2(gross - tax));
  }

  // Rung 2: a rate for every line, prorated from the till's own subtotal.
  let usedHouseRate = false;
  const rated = check.lines.map((l) => {
    if (l.taxRate !== undefined) return l.taxRate;
    const r = houseRateForLine(at.rates, day, l);
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
      usedHouseRate ? at.rateVersion : null,
    );
  }

  // Rung 3: one whole-house rate, and no other rate in force that day.
  const { values, houseWide } = ratesInForce(at.rates, day);
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
      at.rateVersion,
    );
  }

  // Rung 4: null, with the reason.
  return stamped(
    "unresolved",
    null,
    null,
    values.size === 0 && tillRates.length === 0 ? "noRate" : "mixed",
  );
}

/** What of a check's stored copy decides whether it keeps its stamp. */
export interface StoredTaxStamp {
  subtotal: number | string | null;
  gross_subtotal: number | string | null;
  tax_basis: string | null;
}

const cents = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * F-1624: a check already stored keeps the figure and stamp it was written
 * with once the house's answer has changed since, so the till sending it
 * again never re-stamps it ("Checks already recorded are not changed"). It
 * keeps them when the stored copy is under another basis, or when the check
 * is dated before the day of the answer in force now (include, exclude, then
 * include again: a check of the first include days stays as it was written).
 * A copy whose subtotal the till changed is a new figure, and is written
 * under the answer in force on its own day (F-1700, rule 5). Pure; `unset`
 * never keeps (rule 1).
 */
export function keepsStoredStamp(
  check: Pick<CheckForTax, "subtotal" | "closedAt" | "openedAt">,
  ctx: HouseTaxContext,
  stored: StoredTaxStamp | null,
): boolean {
  if (ctx.basis === "unset" || stored === null) return false;
  const storedGross =
    stored.tax_basis === null ? stored.subtotal : stored.gross_subtotal;
  if (cents(storedGross) !== cents(check.subtotal)) return false;
  if (stored.tax_basis !== null && stored.tax_basis !== ctx.basis) return true;
  if (!ctx.zone || !ctx.confirmedAt) return false;
  const day = houseDayOf(
    { closed_at: check.closedAt, opened_at: check.openedAt },
    ctx.zone,
  );
  const switchDay = houseDayOf(ctx.confirmedAt, ctx.zone);
  return day !== null && switchDay !== null && day < switchDay;
}
