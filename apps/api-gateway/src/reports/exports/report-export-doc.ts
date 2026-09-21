/**
 * The shape an export is written from — one cutting, reduced to figures,
 * tables, sentences and the server's own basis. Both renderers (CSV and the
 * print page, `report-export-render.ts`) draw from this and nothing else, so the
 * two files an export produces cannot disagree about a figure.
 *
 * THE ONE RULE THIS SHAPE EXISTS TO CARRY
 * ---------------------------------------
 * A figure the engine did not compute is a `Withheld`, never a number. The
 * analytics services return `null` for "unknown" in a dozen places
 * (`financial.cogs` with no delivered order, `forecast.totalForecastDemand` with
 * no fitted model, a table with no attributed check); the /reports page prints
 * those as em dashes. An export that wrote them as `0` would put a measured
 * zero into a spreadsheet where nobody can see the dash was ever there — so
 * `figure()` below turns every null into a `Withheld` that carries its reason,
 * and the renderers write the word `withheld`.
 */

/** How a number is read. `ratio` is 0–1; `percent` is already in percent. */
export type Unit =
  | "money"
  | "count"
  | "ratio"
  | "percent"
  | "bottles"
  | "days"
  | "text";

export interface Withheld {
  withheld: true;
  /** Why the engine has no figure here, in the page's own words. */
  why: string;
}

/** A number that carries its own unit — for a table whose rows mix units. */
export interface Typed {
  n: number;
  unit: Unit;
}

/** `null` is "not applicable" (a blank cell), which is not "withheld". */
export type Cell = number | string | Withheld | Typed | null;

export interface ExportFigure {
  label: string;
  value: Cell;
  unit: Unit;
}

export interface ExportColumn {
  label: string;
  unit: Unit;
}

export interface ExportTable {
  title: string;
  columns: ExportColumn[];
  rows: Cell[][];
  /** A sentence about the table as a whole — how many rows, what is absent. */
  note?: string;
}

export interface ExportDoc {
  /** The sentence the page shows INSTEAD of a drawing, when that is the honest rendering. */
  say: string | null;
  figures: ExportFigure[];
  tables: ExportTable[];
  notes: string[];
  /** The server's own sentences, verbatim. */
  basis: string[];
}

export function withheld(why: string): Withheld {
  return { withheld: true, why };
}

export function isWithheld(c: unknown): c is Withheld {
  return (
    typeof c === "object" && c !== null && (c as Withheld).withheld === true
  );
}

export function isTyped(c: unknown): c is Typed {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Typed).n === "number" &&
    typeof (c as Typed).unit === "string"
  );
}

/* ─────────────────────────────── defensive payload readers ────────────────
   A payload is data that came back from a service. These read it without ever
   inventing a value: a missing object is `{}`, a missing list is `[]`, and a
   NUMBER that is not a finite number is `null` — never 0. The same contract as
   the web page's `rp-spec.ts` / `rp-format.ts num()`. */

export const obj = (raw: unknown): Record<string, unknown> =>
  raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};

export const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

export const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A number, or the reason there is none. */
export function figure(v: unknown, why: string): number | Withheld {
  const n = num(v);
  return n === null ? withheld(why) : n;
}

/** Same, typed — for a cell in a table whose rows mix units. */
export function typed(v: unknown, unit: Unit, why: string): Typed | Withheld {
  const n = num(v);
  return n === null ? withheld(why) : { n, unit };
}

/** Drop the basis sentences a payload did not carry. */
export function sentences(...xs: unknown[]): string[] {
  return xs.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

/** Every withheld figure and cell in a document — the count the row stores. */
export function countWithheld(doc: ExportDoc): number {
  let n = doc.figures.filter((f) => isWithheld(f.value)).length;
  for (const t of doc.tables)
    for (const r of t.rows) n += r.filter((c) => isWithheld(c)).length;
  return n;
}
