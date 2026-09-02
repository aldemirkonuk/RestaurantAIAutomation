/**
 * invoice-match — single source of truth for the match verdict (backend authority).
 *
 * FOUR documents are reconciled when an order is delivered:
 *   ORDERED  (PO, EDI 850)          orderedQty          @ poUnitPrice      (agreed: final_price)
 *   SHIPPED  (packing slip, EDI 856) shippedQty                            (what the vendor says left)
 *   RECEIVED (physical)             acceptedQty + rejectedQty              (counted at the door)
 *   BILLED   (invoice, EDI 810)     invoiceQty          @ invoiceUnitPrice (charged)
 *
 * Why the packing slip is worth a whole extra document:
 * it is the DISTRIBUTOR'S OWN statement of what shipped. Every other
 * discrepancy is our word against theirs and gets argued on the phone. But when
 * their ship notice says 22 and their invoice says 24, their own paperwork
 * proves the overbill — nothing is left to dispute. That verdict
 * (`overbilled_vs_ship`) is the highest-confidence claim this system can make,
 * so it outranks everything except a missing invoice.
 *
 * Why `received` and not `accepted` is compared against the invoice:
 * "vendor sent 24, 2 arrived broken" and "only 22 ever left the warehouse" are
 * different failures with different remedies. Comparing accepted-vs-invoice
 * would collapse them into one number. Comparing received-vs-invoice keeps a
 * short ship (`qty_short`) distinct from damage (`rejected`), so vendor
 * accountability stays honest. With a packing slip in hand the distinction gets
 * sharper still: short-vs-ship is a carrier or warehouse problem, over-vs-ship
 * is a billing problem.
 *
 * ABSENCE IS NOT AGREEMENT. A null shippedQty or invoiceQty means "we do not
 * know", never "it matched". The caller must not substitute the PO for a
 * missing invoice: doing so makes the headline check compare a number to itself
 * and writes a price-verified assertion no human ever made.
 *
 * QUANTITIES ARE BOTTLE-EQUIVALENTS — AND THIS MODULE NOW ENFORCES THAT.
 *
 * It used to be a comment. Every field was a bare number, `MatchInput` had no
 * unit field at all, and the docblock asked callers to normalise through
 * `documents/document-types.ts#toBottles` first. `verifyReceipt` did not, and
 * nothing could tell: an order placed in cases of 12 and invoiced in bottles
 * produced a CONFIDENT WRONG VERDICT rather than an error — 2 vs 24 reads as a
 * 22-unit overage, the most common false alarm in beverage receiving — and the
 * wrong number was then stamped into `effectiveUnitCost` and the price series.
 *
 * A convention that cannot be checked is not a contract. So each of the four
 * documents now DECLARES its unit on the input, in a field that shares the
 * prefix of the quantities it governs (`invoiceUom` governs `invoiceQty*`), and
 * this function converts every operand to bottles itself before a single
 * comparison happens.
 *
 * REFUSAL RULES (ADR 0011's rule, as `order-units.ts` states it):
 *   - An **unrecognised** unit throws. "bxs" could mean anything.
 *   - A **multiplying** unit (case/pack/split_case) with no pack size throws,
 *     unless the ORDER is in that same unit, in which case the order's own
 *     stated pack size applies — a reference to a sibling fact, not a guess.
 *   - An **opaque** unit (keg/liter) may only be matched against the same
 *     opaque unit; mixing one with bottles throws. Inventing a keg-to-bottle
 *     factor produces confident, wrong cost maths.
 *   - An **absent** unit resolves to the ORDER's unit, and the order's own
 *     absent unit resolves to `bottle`. This is not the guess the ADR forbids:
 *     every existing client seeds its physical count from the order's own
 *     quantity (`ReceivingWorkspace.tsx` — `stockedQty = order.quantityReceived
 *     ?? order.quantity`), so the order's unit is what an undeclared number
 *     already IS. With no unit stated anywhere the whole call is in bottles and
 *     every conversion is the identity, which is exactly the old behaviour.
 *
 * Pure: no DB, no I/O. Throws only `MatchUnitError`, which the HTTP layer maps
 * to a 400 — a refusal a caller can act on, rather than a verdict it cannot
 * doubt. The frontend mirrors these rules in apps/web/src/lib/invoiceMatch.ts
 * for live feedback while counting; THIS module is authoritative and decides
 * what is persisted.
 */

import { normalizeUom, Uom } from "./documents/document-types";

export type MatchVerdict =
  | "matched"
  | "overbilled_vs_ship"
  | "price_variance"
  | "qty_over"
  | "qty_short"
  | "short_shipped"
  | "rejected"
  | "partial"
  | "unmatched";

export type MatchCheckId =
  | "price"
  | "bill_vs_po"
  | "bill_vs_ship"
  | "physical_vs_ship"
  | "physical_vs_bill"
  | "damage"
  | "fulfilment";

/**
 * Why a conversion was refused. Carried so the HTTP layer can say which
 * document's unit it could not read, rather than answering a bare 500.
 */
export type MatchUnitRefusal =
  | "unknown_unit"
  | "pack_size_required"
  | "not_comparable"
  | "alias_conflict";

/**
 * A quantity could not be put into bottles, so no verdict was computed.
 *
 * Thrown, never returned as a verdict. The failure this whole mechanism exists
 * to prevent is a confident wrong answer; degrading to "unmatched" would be one
 * more of those, because nobody reading `unmatched` would know a unit was
 * unreadable.
 */
export class MatchUnitError extends Error {
  readonly reason: MatchUnitRefusal;
  constructor(reason: MatchUnitRefusal, message: string) {
    super(message);
    this.name = "MatchUnitError";
    this.reason = reason;
  }
}

export interface MatchInput {
  // -------------------------------------------------------------------------
  // ORDERED (PO, EDI 850)
  // -------------------------------------------------------------------------
  /**
   * Ordered quantity from the PO, in `orderedUom`.
   *
   * Supersedes `orderedQty`, which named no unit at all.
   */
  orderedQtyInOrderedUom?: number | null;
  /**
   * Unit the order was placed in — bottle | case | keg | pack | split_case |
   * each | liter. Absent means bottles. Also the fallback unit for any other
   * document that does not state one (see the module docblock).
   */
  orderedUom?: string | null;
  /** Bottles in one ordered unit. Required when `orderedUom` multiplies. */
  orderedBottlesPerUnit?: number | null;

  /** Agreed unit price (final_price). PER BOTTLE. Null when the order never carried a price. */
  poUnitPrice?: number | null;

  // -------------------------------------------------------------------------
  // SHIPPED (packing slip, EDI 856)
  // -------------------------------------------------------------------------
  /**
   * Quantity the packing slip / ASN says shipped, in `shippedUom`. Null = no
   * packing slip, which is common and must read as unknown rather than as
   * agreement.
   */
  shippedQtyInShippedUom?: number | null;
  /** Unit the packing slip counts in. Absent falls back to `orderedUom`. */
  shippedUom?: string | null;
  /** Bottles in one shipped unit. Required when `shippedUom` multiplies. */
  shippedBottlesPerUnit?: number | null;

  // -------------------------------------------------------------------------
  // BILLED (invoice, EDI 810)
  // -------------------------------------------------------------------------
  /** Quantity the vendor invoice bills for, in `invoiceUom`. Null = invoice not in hand yet. */
  invoiceQtyInInvoiceUom?: number | null;
  /** Unit the invoice bills in. Absent falls back to `orderedUom`. */
  invoiceUom?: string | null;
  /** Bottles in one billed unit. Required when `invoiceUom` multiplies. */
  invoiceBottlesPerUnit?: number | null;
  /**
   * Unit price the vendor invoice bills. PER BOTTLE — it is compared directly
   * against `poUnitPrice`, which `upsertOrderLine` derives per bottle
   * (`line_total = final_unit_price * total_bottles`). Null = invoice not in
   * hand yet.
   */
  invoiceUnitPrice?: number | null;

  // -------------------------------------------------------------------------
  // RECEIVED (physical count at the door)
  // -------------------------------------------------------------------------
  /** Units accepted into stock, in `countedUom`. */
  acceptedQtyInCountedUom?: number | null;
  /** Units that arrived but were refused (damaged/corked), in `countedUom`. */
  rejectedQtyInCountedUom?: number | null;
  /**
   * Units supplied free under an agreed deal ("11 for the price of 10"), in
   * `countedUom`. Netted out of every quantity comparison. Without this an
   * ordinary, negotiated bonus reads as `qty_over` and fires a critical alert
   * every time — and a manager who is alarmed about good news stops reading
   * alarms.
   */
  freeGoodsQtyInCountedUom?: number | null;
  /**
   * Units actually added to the ledger at markDelivered time, in `countedUom` —
   * NOT what we wish had been stocked. The delivery path stocks optimistically
   * at invoice quantity before anyone counts, so this defaults to that, and
   * ledgerDelta is the correction back to reality. Defaulting it to the accepted
   * count would make ledgerDelta permanently zero and silently strand every
   * miscount.
   */
  stockedQtyInCountedUom?: number | null;
  /**
   * Unit the physical count was taken in. Absent falls back to `orderedUom` —
   * which is what every current client actually means, because each seeds its
   * count from the order's own quantity.
   */
  countedUom?: string | null;
  /** Bottles in one counted unit. Required when `countedUom` multiplies. */
  countedBottlesPerUnit?: number | null;

  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------
  /** Manager justification for accepting a price that differs from the PO. */
  priceOverrideReason?: string | null;
  /**
   * Freight, fuel surcharge and split-case fees apportioned to this line.
   * Folded into effectiveUnitCost so what lands on the books is landed cost, not
   * the sticker price. Freight is a cost component, not a price variance.
   */
  allocatedCharges?: number;

  // =========================================================================
  // DEPRECATED ALIASES — unitless names kept so nothing on the wire breaks.
  //
  // Each is the old name of the canonical field directly above its group. They
  // are accepted, never preferred, and they may not disagree: supplying an alias
  // AND its canonical twin with DIFFERENT values throws `alias_conflict` rather
  // than letting this function pick one, because silently picking one is the
  // same class of defect the unit fields exist to end.
  //
  // Kept rather than deleted because three independent things still hold these
  // names: the generated backtest fixture
  // (`invoice-match.backtest.spec.ts`, regenerated only by
  // `python3 -m scripts.docgen backtest`), the web and mobile mirrors of this
  // module, and the parity test that asserts the mirrors agree with this file.
  //
  // REMOVAL CONDITION — not "someday": delete each alias once no caller can
  // still hold the old name, i.e. when the docgen fixture has been regenerated
  // with the canonical names AND both mirrors and their parity test use them.
  // Those are all in-repo, so this group can go in one change as soon as
  // someone owns the fixture regeneration; it is not gated on client rollout
  // the way the HTTP DTO's aliases are.
  // =========================================================================

  /** @deprecated Unitless. Use `orderedQtyInOrderedUom` with `orderedUom`. */
  orderedQty?: number | null;
  /** @deprecated Unitless. Use `shippedQtyInShippedUom` with `shippedUom`. */
  shippedQty?: number | null;
  /** @deprecated Unitless. Use `invoiceQtyInInvoiceUom` with `invoiceUom`. */
  invoiceQty?: number | null;
  /** @deprecated Unitless. Use `acceptedQtyInCountedUom` with `countedUom`. */
  acceptedQty?: number | null;
  /** @deprecated Unitless. Use `rejectedQtyInCountedUom` with `countedUom`. */
  rejectedQty?: number | null;
  /** @deprecated Unitless. Use `freeGoodsQtyInCountedUom` with `countedUom`. */
  freeGoodsQty?: number | null;
  /** @deprecated Unitless. Use `stockedQtyInCountedUom` with `countedUom`. */
  stockedQty?: number | null;
}

export interface MatchCheck {
  id: MatchCheckId;
  /** null = could not be evaluated (document absent). Distinct from false. */
  ok: boolean | null;
  label: string;
  detail?: string;
}

export interface MatchResult {
  verdict: MatchVerdict;
  checks: MatchCheck[];
  summary: string;
  /** Ordered but not yet accepted — keeps the order open instead of stranding shadow stock. */
  backorderQty: number;
  /** Signed correction to apply to the ledger: what we accepted minus what we already stocked. */
  ledgerDelta: number;
  /** True when the invoice price differs from the PO price and no override reason was given. */
  requiresOverride: boolean;
  /** Reuses the existing price_verified column: true only on an exact price match. */
  priceVerified: boolean;
  /** Vendor owes money back (billed for units not accepted, or sent damaged goods). */
  creditDue: boolean;
  /** Money owed back, when it can be computed. Null when unpriced. */
  creditAmount: number | null;
  /**
   * True when the vendor's own packing slip proves the overbill. A claim carrying
   * this needs no argument, only the attachment.
   */
  selfEvidenced: boolean;
  /**
   * What each bottle in hand actually cost: (amount billed + allocated charges)
   * / units accepted. Handles free goods ("11 for the price of 10" -> 10x$22/11
   * = $20). Null when unpriced or nothing accepted. THIS is what must be written
   * to the stock lot — the whole match is theatre if the books keep the PO price.
   */
  effectiveUnitCost: number | null;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Compare two prices as money; avoids float noise like 22.00000000001 !== 22. */
const priceEquals = (a: number, b: number) =>
  Math.round(a * 100) === Math.round(b * 100);

/** Units where quantity x pack size is the bottle count. */
const MULTIPLYING: ReadonlySet<Uom> = new Set<Uom>([
  "case",
  "pack",
  "split_case",
]);

/** Units that are not bottle-convertible at all. See `toBottles`. */
const OPAQUE: ReadonlySet<Uom> = new Set<Uom>(["keg", "liter"]);

const present = (v: unknown) => v !== undefined && v !== null;

/**
 * Read a value that has a canonical name and a deprecated unitless alias.
 *
 * Both present and EQUAL is fine — an old client and a new one may legitimately
 * send the same number twice during a rollout. Both present and DIFFERENT is
 * refused, loudly, naming both fields and both values: an alias that can be
 * quietly overruled by its twin is not a compatibility shim, it is a second
 * silent-wrong-number channel, which is the defect this file is being fixed for.
 */
function readAliased(
  canonicalName: string,
  canonical: number | null | undefined,
  aliasName: string,
  alias: number | null | undefined,
): number | null {
  const hasCanonical = present(canonical);
  const hasAlias = present(alias);
  if (hasCanonical && hasAlias && Number(canonical) !== Number(alias)) {
    throw new MatchUnitError(
      "alias_conflict",
      `${canonicalName}=${canonical} disagrees with its deprecated alias ${aliasName}=${alias}. ` +
        `They name the same quantity, so one of them is wrong and this match cannot tell which. ` +
        `Send only ${canonicalName}.`,
    );
  }
  if (hasCanonical) return Number(canonical);
  if (hasAlias) return Number(alias);
  return null;
}

/** A unit plus the pack size that turns it into bottles. */
interface ResolvedUnit {
  uom: Uom;
  bottlesPerUnit: number;
}

/**
 * Turn one document's declared unit into something that can multiply, or refuse.
 *
 * `fallback` is the ORDER's resolved unit; see the module docblock for why an
 * undeclared unit means "the same unit the order was placed in" rather than
 * "bottles". Pass null for the order itself, whose own fallback is `bottle`.
 */
function resolveUnit(
  label: string,
  rawUom: string | null | undefined,
  rawPack: number | null | undefined,
  fallback: ResolvedUnit | null,
): ResolvedUnit {
  const raw = typeof rawUom === "string" ? rawUom.trim() : rawUom;

  if (raw === undefined || raw === null || raw === "") {
    // Absent -> the order's unit, or the identity for the order itself. A pack
    // size stated without a unit still has to mean something, so honour it.
    const base = fallback ?? { uom: "bottle" as Uom, bottlesPerUnit: 1 };
    if (!present(rawPack)) return base;
    const pack = Number(rawPack);
    if (!Number.isFinite(pack) || !Number.isInteger(pack) || pack < 1) {
      throw new MatchUnitError(
        "pack_size_required",
        `${label} pack size must be a whole number of at least 1 (got ${JSON.stringify(rawPack)}).`,
      );
    }
    if (!MULTIPLYING.has(base.uom) && pack !== 1) {
      throw new MatchUnitError(
        "pack_size_required",
        `${label} states ${pack} bottles per unit, but its unit is "${base.uom}", which holds exactly one.`,
      );
    }
    return { uom: base.uom, bottlesPerUnit: pack };
  }

  const uom = normalizeUom(raw);
  if (!uom) {
    throw new MatchUnitError(
      "unknown_unit",
      `${label} is stated in "${String(rawUom)}", which is not a unit this match can convert to bottles. ` +
        `Refusing rather than guessing — a guessed unit produces a confident, wrong verdict that nothing downstream can detect.`,
    );
  }

  const pack = present(rawPack) ? Number(rawPack) : null;
  if (
    pack !== null &&
    (!Number.isFinite(pack) || !Number.isInteger(pack) || pack < 1)
  ) {
    throw new MatchUnitError(
      "pack_size_required",
      `${label} pack size must be a whole number of at least 1 (got ${JSON.stringify(rawPack)}).`,
    );
  }

  if (MULTIPLYING.has(uom)) {
    if (pack === null) {
      // The order's own pack size applies when this document counts in the very
      // same unit. That is a reference to a stated sibling fact, not a guess —
      // and it is the ordinary case, where a manager counts the cases they
      // ordered without restating what a case holds.
      if (fallback && fallback.uom === uom) return fallback;
      throw new MatchUnitError(
        "pack_size_required",
        `${label} is stated in ${uom.replace("_", " ")}s but nothing says how many bottles are in one. ` +
          `Guessing 12 multiplies the delivery twelvefold and guessing 1 divides it by twelve; neither is knowledge.`,
      );
    }
    return { uom, bottlesPerUnit: pack };
  }

  if (pack !== null && pack !== 1) {
    throw new MatchUnitError(
      "pack_size_required",
      `${label} states ${pack} bottles per unit, which contradicts a unit of "${uom}" — it holds exactly one.`,
    );
  }
  return { uom, bottlesPerUnit: 1 };
}

/**
 * Normalise every operand of a match into bottles, or refuse.
 *
 * Exported so the refusal can be tested as arithmetic rather than only through
 * a verdict, and so callers that need to report the bottle figures back to a
 * human (the price series, the ledger correction) read the same numbers the
 * verdict was computed from.
 */
export function toBottleOperands(input: MatchInput): {
  orderedQty: number;
  shippedQty: number | null;
  invoiceQty: number | null;
  acceptedQty: number;
  rejectedQty: number;
  freeGoodsQty: number;
  stockedQty: number | null;
  units: {
    ordered: ResolvedUnit;
    shipped: ResolvedUnit;
    invoice: ResolvedUnit;
    counted: ResolvedUnit;
  };
} {
  const rawOrdered = readAliased(
    "orderedQtyInOrderedUom",
    input.orderedQtyInOrderedUom,
    "orderedQty",
    input.orderedQty,
  );
  const rawShipped = readAliased(
    "shippedQtyInShippedUom",
    input.shippedQtyInShippedUom,
    "shippedQty",
    input.shippedQty,
  );
  const rawInvoice = readAliased(
    "invoiceQtyInInvoiceUom",
    input.invoiceQtyInInvoiceUom,
    "invoiceQty",
    input.invoiceQty,
  );
  const rawAccepted = readAliased(
    "acceptedQtyInCountedUom",
    input.acceptedQtyInCountedUom,
    "acceptedQty",
    input.acceptedQty,
  );
  const rawRejected = readAliased(
    "rejectedQtyInCountedUom",
    input.rejectedQtyInCountedUom,
    "rejectedQty",
    input.rejectedQty,
  );
  const rawFreeGoods = readAliased(
    "freeGoodsQtyInCountedUom",
    input.freeGoodsQtyInCountedUom,
    "freeGoodsQty",
    input.freeGoodsQty,
  );
  const rawStocked = readAliased(
    "stockedQtyInCountedUom",
    input.stockedQtyInCountedUom,
    "stockedQty",
    input.stockedQty,
  );

  const ordered = resolveUnit(
    "The order",
    input.orderedUom,
    input.orderedBottlesPerUnit,
    null,
  );
  const shipped = resolveUnit(
    "The packing slip",
    input.shippedUom,
    input.shippedBottlesPerUnit,
    ordered,
  );
  const invoice = resolveUnit(
    "The invoice",
    input.invoiceUom,
    input.invoiceBottlesPerUnit,
    ordered,
  );
  const counted = resolveUnit(
    "The physical count",
    input.countedUom,
    input.countedBottlesPerUnit,
    ordered,
  );

  // Opaque units do not convert. A keg counted against a bottle order cannot be
  // compared at all, and inventing a factor is exactly the confident-wrong-cost
  // failure `toBottles` refuses to commit. Only units that actually contribute a
  // number are checked, so an absent packing slip cannot block a valid match.
  const participating: Array<[string, ResolvedUnit]> = [
    ["the order", ordered],
    ...(rawShipped !== null
      ? ([["the packing slip", shipped]] as Array<[string, ResolvedUnit]>)
      : []),
    ...(rawInvoice !== null
      ? ([["the invoice", invoice]] as Array<[string, ResolvedUnit]>)
      : []),
    ...(rawAccepted !== null || rawRejected !== null || rawFreeGoods !== null
      ? ([["the physical count", counted]] as Array<[string, ResolvedUnit]>)
      : []),
  ];
  const opaque = participating.filter(([, u]) => OPAQUE.has(u.uom));
  if (opaque.length > 0) {
    const mismatch = participating.find(([, u]) => u.uom !== opaque[0][1].uom);
    if (mismatch) {
      throw new MatchUnitError(
        "not_comparable",
        `${opaque[0][0]} is counted in ${opaque[0][1].uom}s and ${mismatch[0]} in ${mismatch[1].uom}s. ` +
          `A ${opaque[0][1].uom} is not a number of bottles in any way a receiver would accept, so these cannot be compared.`,
      );
    }
  }

  const conv = (qty: number, u: ResolvedUnit) => qty * u.bottlesPerUnit;

  return {
    orderedQty: Math.max(0, conv(rawOrdered ?? 0, ordered)),
    shippedQty: rawShipped === null ? null : Math.max(0, conv(rawShipped, shipped)),
    invoiceQty: rawInvoice === null ? null : Math.max(0, conv(rawInvoice, invoice)),
    acceptedQty: Math.max(0, conv(rawAccepted ?? 0, counted)),
    rejectedQty: Math.max(0, conv(rawRejected ?? 0, counted)),
    freeGoodsQty: Math.max(0, conv(rawFreeGoods ?? 0, counted)),
    stockedQty: rawStocked === null ? null : conv(rawStocked, counted),
    units: { ordered, shipped, invoice, counted },
  };
}

export function computeMatch(input: MatchInput): MatchResult {
  // EVERY operand is in bottles from here down. Nothing below this line may read
  // `input.<something>Qty` again — that is what made the units invisible before.
  const operands = toBottleOperands(input);

  const orderedQty = operands.orderedQty;
  const acceptedQty = operands.acceptedQty;
  const rejectedQty = operands.rejectedQty;
  const freeGoodsQty = operands.freeGoodsQty;
  const allocatedCharges = Math.max(0, input.allocatedCharges ?? 0);
  const receivedQty = acceptedQty + rejectedQty;

  // What the vendor is entitled to bill for: everything that arrived except the
  // units they gave us.
  const billableReceived = Math.max(0, receivedQty - freeGoodsQty);

  const shippedQty = operands.shippedQty;
  const hasShip = shippedQty != null;

  const invoiceQty = operands.invoiceQty;
  const hasInvoice = invoiceQty != null;

  const poUnitPrice = input.poUnitPrice ?? null;
  const invoiceUnitPrice = input.invoiceUnitPrice ?? null;
  const overrideReason = (input.priceOverrideReason ?? "").trim();

  const stockedQty = operands.stockedQty ?? invoiceQty ?? orderedQty;

  const checks: MatchCheck[] = [];

  // --- price: exact match, no tolerance band (D-B) --------------------------------------
  const bothPriced = poUnitPrice != null && invoiceUnitPrice != null;
  const priceVerified =
    bothPriced && priceEquals(poUnitPrice, invoiceUnitPrice);
  const priceMismatch = bothPriced && !priceVerified;
  const requiresOverride = priceMismatch && overrideReason.length === 0;

  checks.push({
    id: "price",
    ok: !bothPriced ? null : !priceMismatch,
    label: "Invoice price matches the agreed price",
    detail: !bothPriced
      ? "No price to compare"
      : priceMismatch
        ? `Agreed ${money(poUnitPrice)} vs billed ${money(invoiceUnitPrice)}` +
          (overrideReason ? " — accepted by override" : "")
        : `Both ${money(poUnitPrice as number)}`,
  });

  // --- bill vs PO: did they bill for what we ordered? ------------------------------------
  const billMatchesPo = hasInvoice && invoiceQty === orderedQty;
  checks.push({
    id: "bill_vs_po",
    ok: hasInvoice ? billMatchesPo : null,
    label: "Invoice quantity matches the order",
    detail: !hasInvoice
      ? "No invoice recorded"
      : billMatchesPo
        ? `Both ${orderedQty}`
        : `Ordered ${orderedQty}, billed ${invoiceQty}`,
  });

  // --- bill vs ship: the vendor's own two documents disagreeing ---------------------------
  // The single most valuable check in this file. No counting on our side is
  // involved, so there is nothing for the vendor to dispute.
  const canCompareBillShip = hasInvoice && hasShip;
  const overbilledVsShip =
    canCompareBillShip && (invoiceQty as number) > (shippedQty as number);
  checks.push({
    id: "bill_vs_ship",
    ok: canCompareBillShip
      ? (invoiceQty as number) === (shippedQty as number)
      : null,
    label: "Invoice matches the vendor's own packing slip",
    detail: !canCompareBillShip
      ? hasShip
        ? "No invoice recorded"
        : "No packing slip recorded"
      : (invoiceQty as number) === (shippedQty as number)
        ? `Both ${invoiceQty}`
        : `Their slip says ${shippedQty}, their invoice says ${invoiceQty}`,
  });

  // --- physical vs ship: did everything that left the warehouse get here? ------------------
  // BOTH SIDES MUST BE PHYSICAL COUNTS. The packing slip counts bottles on the
  // truck, free ones included, so this compares receivedQty and NOT
  // billableReceived. Netting free goods out of one side only made an agreed
  // 11-for-10 with a slip counting 11 read as "1 lost between the warehouse and
  // the door" — the free-goods false alarm, moved onto the transit axis.
  const shortShipped = hasShip && receivedQty < (shippedQty as number);
  checks.push({
    id: "physical_vs_ship",
    ok: hasShip ? receivedQty === (shippedQty as number) : null,
    label: "Everything on the packing slip arrived",
    detail: !hasShip
      ? "No packing slip recorded"
      : receivedQty === (shippedQty as number)
        ? `Both ${shippedQty}`
        : `Slip says ${shippedQty}, ${receivedQty} arrived`,
  });

  // --- physical vs bill: short ship / over delivery ---------------------------------------
  // The BILLING axis, so free goods come off: the vendor may not bill for what
  // they gave us. This is the one comparison billableReceived belongs in.
  const physicalMatchesBill =
    hasInvoice && billableReceived === (invoiceQty as number);
  checks.push({
    id: "physical_vs_bill",
    ok: hasInvoice ? physicalMatchesBill : null,
    label: "Delivered quantity matches the invoice",
    detail: !hasInvoice
      ? "No invoice recorded"
      : physicalMatchesBill
        ? `Both ${invoiceQty}`
        : `Billed ${invoiceQty}, ${billableReceived} arrived` +
          (freeGoodsQty > 0 ? ` (plus ${freeGoodsQty} free)` : ""),
  });

  // --- damage ----------------------------------------------------------------------------
  checks.push({
    id: "damage",
    ok: rejectedQty === 0,
    label: "No units rejected",
    detail:
      rejectedQty === 0
        ? "All units accepted"
        : `${rejectedQty} rejected on arrival`,
  });

  // --- fulfilment -------------------------------------------------------------------------
  const fullyFulfilled = acceptedQty >= orderedQty;
  const backorderQty = Math.max(0, orderedQty - acceptedQty);
  checks.push({
    id: "fulfilment",
    ok: fullyFulfilled,
    label: "Order fully fulfilled",
    detail: fullyFulfilled
      ? `${acceptedQty} of ${orderedQty} accepted`
      : `${acceptedQty} of ${orderedQty} accepted, ${backorderQty} outstanding`,
  });

  // --- verdict: one headline, ordered by evidentiary strength then severity ----------------
  let verdict: MatchVerdict;
  if (!hasInvoice) verdict = "unmatched";
  else if (overbilledVsShip) verdict = "overbilled_vs_ship";
  else if (requiresOverride) verdict = "price_variance";
  else if (billableReceived > (invoiceQty as number)) verdict = "qty_over";
  else if (billableReceived < (invoiceQty as number)) verdict = "qty_short";
  else if (shortShipped) verdict = "short_shipped";
  else if (rejectedQty > 0) verdict = "rejected";
  else if (!fullyFulfilled) verdict = "partial";
  else verdict = "matched";

  const creditDue =
    rejectedQty > 0 ||
    overbilledVsShip ||
    (hasInvoice && (invoiceQty as number) > billableReceived);

  // Money owed back: units billed but not usably received, at the billed price.
  const unitsOwed = hasInvoice
    ? Math.max(0, (invoiceQty as number) - (billableReceived - rejectedQty))
    : 0;
  const creditAmount =
    hasInvoice && invoiceUnitPrice != null && unitsOwed > 0
      ? Math.round(unitsOwed * invoiceUnitPrice * 100) / 100
      : null;

  const effectiveUnitCost =
    hasInvoice && invoiceUnitPrice != null && acceptedQty > 0
      ? ((invoiceQty as number) * invoiceUnitPrice + allocatedCharges) /
        acceptedQty
      : null;

  return {
    verdict,
    checks,
    summary: summarize(verdict, {
      orderedQty,
      shippedQty,
      invoiceQty,
      receivedQty,
      billableReceived,
      acceptedQty,
      rejectedQty,
      freeGoodsQty,
      backorderQty,
      poUnitPrice,
      invoiceUnitPrice,
    }),
    backorderQty,
    ledgerDelta: acceptedQty - stockedQty,
    requiresOverride,
    priceVerified,
    creditDue,
    creditAmount,
    selfEvidenced: overbilledVsShip,
    effectiveUnitCost,
  };
}

function summarize(
  verdict: MatchVerdict,
  f: {
    orderedQty: number;
    shippedQty: number | null;
    invoiceQty: number | null;
    /** Physical bottles at the door, free ones included. Use against the slip. */
    receivedQty: number;
    /** Physical minus free goods. Use against the invoice. */
    billableReceived: number;
    acceptedQty: number;
    rejectedQty: number;
    freeGoodsQty: number;
    backorderQty: number;
    poUnitPrice: number | null;
    invoiceUnitPrice: number | null;
  },
): string {
  switch (verdict) {
    case "matched":
      return (
        `All ${f.acceptedQty} accepted at the agreed price.` +
        (f.freeGoodsQty > 0 ? ` Includes ${f.freeGoodsQty} free.` : "")
      );
    case "overbilled_vs_ship":
      return `Their packing slip says ${f.shippedQty} but their invoice bills ${f.invoiceQty} — proven by their own paperwork.`;
    case "price_variance":
      return `Billed ${money(f.invoiceUnitPrice as number)} against an agreed ${money(
        f.poUnitPrice as number,
      )}.`;
    case "qty_over":
      return `${f.billableReceived} arrived but only ${f.invoiceQty} were billed.`;
    case "qty_short":
      return `Billed for ${f.invoiceQty} but only ${f.billableReceived} arrived — ${
        (f.invoiceQty as number) - f.billableReceived
      } short.`;
    case "short_shipped":
      // Physical, to match the check: the slip counted free bottles too, so
      // billableReceived here would overstate the loss (or invent one).
      return `Packing slip says ${f.shippedQty}, only ${f.receivedQty} arrived — ${
        (f.shippedQty as number) - f.receivedQty
      } lost between the warehouse and the door.`;
    case "rejected":
      // Physical again — how many of the bottles in front of the manager were
      // refused. receivedQty already includes the rejected units; adding them
      // again reported "2 of 26 rejected" on a 24-bottle delivery.
      return `${f.rejectedQty} of ${f.receivedQty} rejected on arrival — credit due.`;
    case "partial":
      return `${f.acceptedQty} of ${f.orderedQty} accepted, ${f.backorderQty} still outstanding.`;
    case "unmatched":
      return `${f.acceptedQty} accepted with no invoice on file yet.`;
  }
}

/** Verdicts that mean the manager must be told immediately (D-E). */
export function isDiscrepancy(verdict: MatchVerdict): boolean {
  return verdict !== "matched";
}

/**
 * Verdicts a claim can be raised on. Narrower than isDiscrepancy: `partial` and
 * `unmatched` are states of an unfinished delivery, not vendor errors, and
 * raising a claim on them would put a restaurant in front of its distributor
 * asking for money over paperwork that has not arrived yet.
 */
export function isClaimable(verdict: MatchVerdict): boolean {
  return (
    verdict === "overbilled_vs_ship" ||
    verdict === "qty_short" ||
    verdict === "short_shipped" ||
    verdict === "rejected" ||
    verdict === "price_variance"
  );
}
