/**
 * The ledger's unit vocabulary, its conversions, and remainder-safe allocation.
 *
 * ADR 0070 (Locked): a ledger quantity stays an `integer` and states its own
 * unit; the canonical unit belongs to the ITEM, not the row.
 * ADR 0075: this file settles what the vocabulary is, and holds the allocation
 * algorithm ADR 0070 made mandatory.
 *
 * This is the code half of a pair. The SQL half is
 * `supabase/migrations/20260902120000_ledger_unit_typed_quantities.sql`, which
 * CHECK-constrains `inventory_lots.uom`, `inventory_transactions.uom` and
 * `restaurant_inventory.canonical_uom` to exactly `LEDGER_UOMS`.
 * `ledger-units.spec.ts` asserts the two lists agree and
 * `scripts/check_ledger_units.py` fails CI if they drift.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Every unit a ledger row may state. Base units only.
 *
 * A base unit cannot be decomposed into a smaller unit of the same dimension,
 * and its meaning does not depend on a pack size, a bottle format, or a serving
 * policy. That rule is what excludes `case`/`pack`/`split_case`/`keg` (pack
 * units, size varies per vendor), `g`/`kg`/`l` (coarser units of a dimension
 * that already has a base — admitting both `g` and `kg` is the 25-vs-25000
 * failure this whole mechanism exists to prevent), and `SHOT`/`GLASS` (serving
 * units, which is what `restaurant_inventory.unit_type` already records).
 *
 * `mg` and not `g`: saffron doses at 0.1-0.5 g, truffle at 2-5 g. At gram
 * resolution those movements round to zero and are rejected outright, so the
 * ledger is unusable for that ingredient class rather than merely lossy.
 *
 * `ml` and not `ul`: every neighbouring column in this codebase is already
 * millilitres (`open_bottle_ml`, `pour_size_ml`, `bottle_size_ml`,
 * `current_volume_ml`, `format_ml`), so ledger volumes convert 1:1 and no
 * boundary can be off by 1000x. The sub-millilitre class — a drop at ~0.05 ml,
 * a dash of bitters at ~0.9 ml — is REFUSED by the nonzero CHECK rather than
 * silently mis-stored, which is the correct failure mode (ADR 0051). See ADR
 * 0075 for the revisit trigger that would add `ul`.
 */
export const LEDGER_UOMS = ["each", "bottle", "mg", "ml"] as const;
export type LedgerUom = (typeof LEDGER_UOMS)[number];

/** The physical dimension a unit measures. Units of different dimensions never convert. */
export const LEDGER_UOM_DIMENSION: Readonly<Record<LedgerUom, "count" | "mass" | "volume">> = {
  each: "count",
  bottle: "count",
  mg: "mass",
  ml: "volume",
};

/**
 * Operator-facing units, and how many base units each is worth.
 *
 * A receiver types "4.5 kg"; the ledger stores 4_500_000 mg. Only the
 * multiplication direction is used on the write path, and multiplication by an
 * integer factor is exact — which is why the coarse units live here and not in
 * `LEDGER_UOMS`. Reading back the other way is a division and belongs to
 * display, not to storage; see `formatLedgerQty`.
 *
 * Deliberately unambiguous entries only. `oz` is absent because a fluid ounce
 * and an ounce of mass are different dimensions sharing a name, and guessing
 * which one a document meant is how `toBottles` describes producing "confident,
 * wrong cost math".
 */
const INPUT_UNIT_FACTORS: Readonly<Record<string, { base: LedgerUom; factor: number }>> = {
  each: { base: "each", factor: 1 },
  bottle: { base: "bottle", factor: 1 },
  mg: { base: "mg", factor: 1 },
  g: { base: "mg", factor: 1_000 },
  kg: { base: "mg", factor: 1_000_000 },
  ml: { base: "ml", factor: 1 },
  cl: { base: "ml", factor: 10 },
  l: { base: "ml", factor: 1_000 },
};

/** Spellings that map onto a key of INPUT_UNIT_FACTORS. */
const INPUT_UNIT_SPELLINGS: Readonly<Record<string, string>> = {
  each: "each",
  eaches: "each",
  ea: "each",
  unit: "each",
  units: "each",
  bottle: "bottle",
  bottles: "bottle",
  btl: "bottle",
  bt: "bottle",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  g: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  cl: "cl",
  centilitre: "cl",
  centilitres: "cl",
  centiliter: "cl",
  centiliters: "cl",
  l: "l",
  lt: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
};

/**
 * Coerce a free-text unit into the ledger's base vocabulary, or refuse.
 *
 * Mirrors `procurement/documents/document-types.ts#normalizeUom` deliberately,
 * including its refusal discipline: an unrecognised input returns `null` rather
 * than guessing, because a wrong unit produces confident, wrong quantity maths
 * and silence is worse than a refusal (ADR 0051).
 *
 * Note this returns only BASE units. `"kg"` normalises to `"mg"` as the unit,
 * which on its own would be a 1000x lie — so this function is not the
 * conversion. Use `convertToBase`, which returns the quantity and the unit
 * together, whenever a quantity is involved.
 */
export function normalizeLedgerUom(raw?: string | null): LedgerUom | null {
  const key = spellingKey(raw);
  if (key === null) return null;
  return INPUT_UNIT_FACTORS[key].base;
}

/**
 * Convert an operator-supplied quantity into the ledger's base unit, exactly.
 *
 * Returns `null` — never a guess and never a zero — when the unit is
 * unrecognised, the quantity is not finite, or the conversion would not land on
 * a whole number of base units. That last case is the point of the `mg` base:
 * `0.0004 g` is 0.4 mg, which this refuses rather than storing as 0 mg
 * (destroying the movement) or 1 mg (creating 150% of it from nothing).
 */
export function convertToBase(
  qty: number,
  inputUom: string,
): { qty: number; uom: LedgerUom } | null {
  const key = spellingKey(inputUom);
  if (key === null) return null;
  if (!Number.isFinite(qty)) return null;

  const { base, factor } = INPUT_UNIT_FACTORS[key];

  // Scale in integer space. `4.5 * 1_000_000` is exact in IEEE-754, but
  // `0.1 * 3` is not, so round the product and then prove the rounding was a
  // no-op rather than trusting it.
  const scaled = qty * factor;
  const whole = Math.round(scaled);
  if (Math.abs(scaled - whole) > 1e-6) return null;
  if (!Number.isSafeInteger(whole)) return null;

  return { qty: whole, uom: base };
}

function spellingKey(raw?: string | null): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
  if (s === "") return null;
  const key = INPUT_UNIT_SPELLINGS[s];
  return key === undefined ? null : key;
}

/** True when `value` is one of the four base units. */
export function isLedgerUom(value: unknown): value is LedgerUom {
  return (
    typeof value === "string" && (LEDGER_UOMS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Remainder-safe allocation
// ---------------------------------------------------------------------------

/**
 * Split an integer total into parts that sum EXACTLY to the total.
 *
 * ADR 0070 made this mandatory rather than optional, for a reason that no
 * amount of decimal precision removes: one third has no finite representation
 * at ANY scale. `1000` split three ways is 333.33..., so the naive
 * `Math.round(total / n)` produces 333+333+333 = 999 (one unit destroyed) or
 * 334+334+334 = 1002 (two units created from nothing), depending on which way
 * the rounding falls. Under a fixed-point column that residue becomes a lot
 * that never depletes and never deletes, and — because
 * `inventory_lot_rollup`'s weighted-average cost is guarded only by
 * `sum(qty) > 0` — a divisor that inflates WAC into COGS and menu pricing.
 *
 * This is the largest-remainder (Hamilton) method: floor every share, then hand
 * the leftover units out one at a time to the largest fractional remainders.
 * Ties go to the LAST index, so an equal three-way split of 1000 allocates
 * `[333, 333, 334]` — the shape ADR 0070 names literally.
 *
 * Guarantees, all asserted in `ledger-units.spec.ts`:
 *   - `sum(result) === total`, exactly, for every input
 *   - `result.length === weights.length`
 *   - every element is a non-negative integer when `total >= 0`
 *   - a weight of 0 receives 0
 *   - the result is deterministic: same inputs, same output
 *
 * @param total   the quantity to divide, in base units. Must be a safe integer.
 * @param weights relative shares. Any non-negative finite numbers; they are not
 *                required to be integers or to sum to anything in particular.
 * @throws when `total` is not a safe integer, when `weights` is empty, or when
 *         a weight is negative or not finite. Refusing beats apportioning
 *         nonsense.
 */
export function allocateRemainderSafe(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) {
    throw new RangeError(
      `allocateRemainderSafe: total must be a safe integer, got ${total}`,
    );
  }
  if (weights.length === 0) {
    throw new RangeError("allocateRemainderSafe: weights must not be empty");
  }
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) {
      throw new RangeError(
        `allocateRemainderSafe: weights must be finite and non-negative, got ${w}`,
      );
    }
  }

  const negative = total < 0;
  const magnitude = Math.abs(total);

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // No basis to apportion on. Everything to the first bucket keeps the sum
    // exact, which is the invariant that matters; there is no fairer answer
    // when every weight is zero.
    const out = weights.map(() => 0);
    out[0] = magnitude;
    return negative ? out.map((n) => -n) : out;
  }

  const exact = weights.map((w) => (magnitude * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let allocated = floors.reduce((a, b) => a + b, 0);
  let leftover = magnitude - allocated;

  // Order by fractional remainder, largest first. Ties break toward the LAST
  // index so `[1000, [1,1,1]]` gives `[333, 333, 334]` and not `[334, 333, 333]`.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (b.i - a.i));

  const out = floors.slice();
  let cursor = 0;
  while (leftover > 0) {
    // `leftover` is always < weights.length here on the first pass; the modulo
    // keeps the loop total even in the degenerate case where floating-point
    // floors leave more than one unit per bucket.
    out[order[cursor % order.length].i] += 1;
    leftover -= 1;
    cursor += 1;
  }
  allocated = out.reduce((a, b) => a + b, 0);
  /* istanbul ignore next -- the loop above makes this unreachable; it is a
     tripwire, not a branch. A silent mismatch here is the exact class of fault
     this function exists to prevent, so it must be loud. */
  if (allocated !== magnitude) {
    throw new Error(
      `allocateRemainderSafe: allocated ${allocated} of ${magnitude} — conservation broken`,
    );
  }

  return negative ? out.map((n) => -n) : out;
}

/**
 * The naive split, exported ONLY so the spec can demonstrate that it loses and
 * creates units. Never use it for a quantity.
 */
export function naiveEqualSplitForComparison(total: number, n: number): number[] {
  return Array.from({ length: n }, () => Math.round(total / n));
}

// ---------------------------------------------------------------------------
// Aggregation: convert or refuse, never silently sum
// ---------------------------------------------------------------------------

/** One unit's worth of a grouped total. */
export interface UomTotal {
  uom: LedgerUom;
  total: number;
}

/**
 * Sum quantities per unit. There is deliberately no overload that returns a
 * single number.
 *
 * ADR 0070's "Harder, or given up" clause: every consumer must respect `uom` in
 * every `GROUP BY`, and a cross-unit aggregate must convert or refuse rather
 * than silently sum. Adding 25 (kg of flour) to 25000 (mg of saffron) is not a
 * quantity, and the only honest shape for the answer is one row per unit.
 *
 * Rows whose `uom` is not a known base unit are collected into `unknownCount`
 * rather than dropped or defaulted — an unrecognised unit means the total is
 * incomplete, and a total that quietly omits rows is the absence-reported-as-
 * health fault.
 */
export function sumByUom(
  rows: ReadonlyArray<{ uom?: string | null; quantity: number }>,
): { totals: UomTotal[]; unknownCount: number } {
  const acc = new Map<LedgerUom, number>();
  let unknownCount = 0;

  for (const row of rows) {
    if (!isLedgerUom(row.uom) || !Number.isFinite(row.quantity)) {
      unknownCount += 1;
      continue;
    }
    acc.set(row.uom, (acc.get(row.uom) ?? 0) + row.quantity);
  }

  const totals = LEDGER_UOMS.filter((u) => acc.has(u)).map((u) => ({
    uom: u,
    total: acc.get(u) as number,
  }));

  return { totals, unknownCount };
}

/**
 * Render a base-unit quantity for a human, without lying about precision.
 *
 * This is the one place a ledger quantity is divided, and it is safe because
 * the output is a string for a person to read, never a number anything
 * arithmetics on. `12_500_000 mg` reads as `12.5 kg`; `1 mg` stays `1 mg`
 * rather than becoming `0 kg`.
 */
export function formatLedgerQty(qty: number, uom: LedgerUom): string {
  if (!Number.isFinite(qty)) return "—";

  if (uom === "mg") {
    if (Math.abs(qty) >= 1_000_000) return `${trim(qty / 1_000_000)} kg`;
    if (Math.abs(qty) >= 1_000) return `${trim(qty / 1_000)} g`;
    return `${qty} mg`;
  }
  if (uom === "ml") {
    if (Math.abs(qty) >= 1_000) return `${trim(qty / 1_000)} L`;
    return `${qty} ml`;
  }
  return `${qty} ${uom}`;
}

function trim(n: number): string {
  // Three decimals is exactly enough: every base unit is 1/1000 of the display
  // unit it rolls up into, so no representable quantity needs a fourth.
  return String(Number(n.toFixed(3)));
}
