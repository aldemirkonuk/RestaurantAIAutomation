/**
 * One menu price from the string as written. ADR 0020 (no invented number):
 * an amount only when the string has ONE reading (`45,50`, `1.250,00`,
 * `1,250.00`, `45.5`). `1.250`, `1,250` and two numbers in one cell
 * (`12 / 45`) get no amount and `two_readings`; the caller leaves the price
 * blank. No currency is taken or converted (`₺450` reads 450, the symbol
 * stays in `raw`); resolving by the house's currency is MU-9, not done here.
 */
export type MenuPriceReason =
  | "empty"
  | "no_number"
  | "two_readings"
  /** Separators that fit no reading (`1.25.0`). */
  | "unreadable";

export interface MenuPriceRead {
  amount: number | null;
  raw: string;
  reason: MenuPriceReason | null;
}

const none = (raw: string, reason: MenuPriceReason): MenuPriceRead => ({
  amount: null,
  raw,
  reason,
});

/** `1`, `12`, `123`, then any number of `.123` / `,123` groups, all with `sep`. */
const groupedBy = (s: string, sep: string): boolean => {
  const parts = s.split(sep);
  return (
    /^[1-9]\d{0,2}$/.test(parts[0]) &&
    parts.slice(1).every((p) => /^\d{3}$/.test(p))
  );
};

export function readMenuPrice(input: string): MenuPriceRead {
  const raw = (input ?? "").trim();
  if (!raw) return none(raw, "empty");

  // Number tokens: digits joined by single `.` or `,` marks. A space ends a
  // token, so `1 250,50` and `12 / 45` are two numbers, read two ways.
  const tokens = raw.match(/\d(?:[.,]?\d)*/g);
  if (!tokens) return none(raw, "no_number");
  if (tokens.length > 1) return none(raw, "two_readings");

  const token = tokens[0];
  const dots = (token.match(/\./g) ?? []).length;
  const commas = (token.match(/,/g) ?? []).length;

  if (dots === 0 && commas === 0)
    return { amount: Number(token), raw, reason: null };

  if (dots > 0 && commas > 0) {
    // Both marks: the last is the decimal mark, the other groups thousands.
    const decimal = token.lastIndexOf(".") > token.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const at = token.lastIndexOf(decimal);
    const whole = token.slice(0, at);
    const frac = token.slice(at + 1);
    if (whole.includes(decimal) || !groupedBy(whole, thousands))
      return none(raw, "unreadable");
    return {
      amount: Number(`${whole.split(thousands).join("")}.${frac}`),
      raw,
      reason: null,
    };
  }

  const sep = dots > 0 ? "." : ",";
  const count = dots + commas;
  if (count > 1) {
    // `1.250.000`: a mark used twice can only group thousands.
    if (!groupedBy(token, sep)) return none(raw, "unreadable");
    return { amount: Number(token.split(sep).join("")), raw, reason: null };
  }

  const [whole, frac] = token.split(sep);
  // Three digits after one mark read two ways, unless the whole part cannot
  // lead a thousands group (`0,250` is 0.25).
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(whole))
    return none(raw, "two_readings");
  return { amount: Number(`${whole}.${frac}`), raw, reason: null };
}
