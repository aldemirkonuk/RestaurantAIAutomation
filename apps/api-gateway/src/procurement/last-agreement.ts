/**
 * What this house last agreed with this vendor for this item — and, when there
 * is nothing, the difference between "nothing was agreed" and "we could not
 * look".
 *
 * WHY THIS EXISTS (packet 2 of the overlay layer, 2026-09-06). The census draws
 * the new-order sheet with one sentence under its lines: *"Price and unit come
 * from the agreement on the vendor's row; a line without one asks first."*
 * Nothing in the gateway could answer that. `agreement-currency` answers which
 * MONEY to offer; `vendor-terms` carries cutoffs and lead times and no prices;
 * the price register is a visibility module with no controller. So the route is
 * new, and this file is the part of it with no database in it.
 *
 * THE THREE ANSWERS, KEPT APART
 * -----------------------------
 *   found      — a real agreement, with the date it was struck and the order it
 *                was struck on, so the sheet can show its working.
 *   none       — this house has never agreed a price with this vendor for this
 *                item. A true, ordinary state.
 *   unreadable — the read FAILED. Not "none".
 *
 * The third is the whole reason this file is not four lines. A failed read
 * rendered as "no agreement on file" is the fault this house calls *absence
 * reported as health*: the sheet would quietly ask a vendor to quote a wine it
 * has an agreed price for, and nobody downstream could tell.
 *
 * WHAT IS DELIBERATELY NOT HERE. No conversion between units and no conversion
 * between currencies. The pair (`priceUom`, `pricePackSize`) is carried whole or
 * not at all — ADR 0119's rule, and the database CHECK
 * `..._price_unit_pair_check` refuses either half alone — and a price whose
 * unit was never stated is reported as UNSTATED rather than assumed to be per
 * bottle.
 */

export type LastAgreementState = "found" | "none" | "unreadable";

export interface LastAgreementLine {
  /** `final_unit_price` on the line. Null when the order recorded no price. */
  price: number | null;
  /** The unit the price was stated in, or null for UNSTATED (ADR 0119). */
  priceUom: string | null;
  /** Bottles in one `priceUom`. Always travels with `priceUom` or not at all. */
  pricePackSize: number | null;
  /** The money the line was recorded in, or null when none was stated. */
  currency: string | null;
  /** The unit the ORDER was counted in — independent of `priceUom`. */
  unitType: string | null;
  /** Bottles in one `unitType`. */
  bottlesPerUnit: number | null;
  /** When the order was asked for. ISO, or null when the row carries none. */
  agreedOn: string | null;
  /** The order this came off, so a person can go and read it. */
  orderNumber: string | null;
}

export interface LastAgreement extends Partial<LastAgreementLine> {
  state: LastAgreementState;
  /**
   * What the sheet prints under the line. Present in ALL THREE states — an
   * answer with no sentence is what lets a failure render as an empty field.
   */
  sentence: string;
}

/** A price stated with no unit is not a price per bottle. It is unstated. */
function priceWords(line: LastAgreementLine): string {
  if (line.price == null) {
    return "the order recorded no price";
  }
  const money =
    line.currency === null ? `${line.price}` : `${line.currency} ${line.price}`;
  if (line.priceUom === null) {
    return `${money}, with the unit NOT stated — it does not enter the price register and it is not a per-bottle price`;
  }
  const pack =
    line.pricePackSize !== null && line.pricePackSize > 1
      ? ` of ${line.pricePackSize}`
      : "";
  return `${money} per ${line.priceUom}${pack}`;
}

/** The date, as a day rather than a timestamp; the dash when there is none. */
function dayWords(iso: string | null): string {
  if (!iso) return "on a date the row does not carry";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "on a date the row does not carry"
    : `on ${d.toISOString().slice(0, 10)}`;
}

/**
 * The answer, from what the caller read.
 *
 * `line === null` means the query ran and matched nothing. `readFailed` means it
 * did not run — and the caller must pass that rather than translating a thrown
 * error into an empty result, which is the exact substitution this function
 * exists to make impossible.
 */
export function lastAgreementAnswer(
  line: LastAgreementLine | null,
  readFailed: boolean,
  vendorName?: string | null,
): LastAgreement {
  const vendor = vendorName?.trim() ? vendorName.trim() : "this vendor";

  if (readFailed) {
    return {
      state: "unreadable",
      sentence:
        `The last agreement with ${vendor} could not be read, so this line ` +
        `shows no price. That is a failed read, NOT an empty book — state the ` +
        `price yourself, or try again.`,
    };
  }

  if (line === null) {
    return {
      state: "none",
      sentence:
        `No agreed price with ${vendor} is on file for this item. The order ` +
        `goes out asking for one; nothing is assumed.`,
    };
  }

  return {
    state: "found",
    price: line.price,
    priceUom: line.priceUom,
    pricePackSize: line.pricePackSize,
    currency: line.currency,
    unitType: line.unitType,
    bottlesPerUnit: line.bottlesPerUnit,
    agreedOn: line.agreedOn,
    orderNumber: line.orderNumber,
    sentence:
      `Last agreed with ${vendor} ${dayWords(line.agreedOn)}: ` +
      `${priceWords(line)}` +
      (line.orderNumber ? ` (order ${line.orderNumber})` : "") +
      `. Offered, not applied — change it if the vendor has moved.`,
  };
}
