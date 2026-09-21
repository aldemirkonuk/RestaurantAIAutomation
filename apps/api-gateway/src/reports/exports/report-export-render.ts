/**
 * The two files an export is: a CSV and a print-ready HTML page, both drawn
 * from one `ExportDoc` so they cannot disagree about a figure.
 *
 * Pure functions — no I/O, no clock (the written-at instant is passed in), so
 * the specs pin the bytes.
 *
 * WHAT EACH ONE REFUSES
 * ---------------------
 *  - A withheld figure is written as the word `withheld`, with its reason, in
 *    both files. Never `0`, never a blank a spreadsheet would sum as zero.
 *  - No currency is invented. Money is a bare number under a header naming the
 *    house's recorded reporting currency, or saying it is not recorded
 *    (`restaurants.currency`, ADR 0117 Q25/Q30).
 *  - The CSV neutralises spreadsheet formulas: a TEXT cell that begins with
 *    `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (OWASP CSV injection).
 *    Numbers are written from numbers, so a negative figure stays a number.
 *  - The HTML escapes every interpolated string and carries a CSP that forbids
 *    script outright. A wine name or an insight sentence is data a vendor or a
 *    POS typed; the page is opened from the app's own origin, so an escape miss
 *    must still not be able to run anything.
 */

import {
  isTyped,
  isWithheld,
  type Cell,
  type ExportDoc,
  type ExportTable,
  type Unit,
} from "./report-export-doc";

export interface ExportHeader {
  houseName: string | null;
  /** ISO 4217 alpha-3, or null when the house has not stated one. */
  currency: string | null;
  title: string;
  windowLabel: string;
  /** ISO instant the export was written. */
  writtenAt: string;
  withheldCount: number;
}

export const WITHHELD_WORD = "withheld";

/* ─────────────────────────────────────────────────────────── shared ───── */

function currencyLabel(currency: string | null): string {
  return currency ? currency : "currency not recorded";
}

/** The unit in words: what a column header or the figures' Unit column says. */
function unitWord(unit: Unit, currency: string | null): string {
  switch (unit) {
    case "money":
      return currencyLabel(currency);
    case "ratio":
      return "share, 0–1";
    case "percent":
      return "%";
    case "bottles":
      return "bottles";
    case "days":
      return "days";
    case "count":
      return "count";
    default:
      return "";
  }
}

/** A header suffix. A count column needs none: its label already says what it counts. */
function unitSuffix(unit: Unit, currency: string | null): string {
  return unit === "text" || unit === "count" ? "" : ` (${unitWord(unit, currency)})`;
}

/** A number as data: integers as-is, fractions to six places, no separators. */
function rawNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

/** Distinct withheld reasons in a table, keyed by column, for its footnote. */
function withheldReasons(t: ExportTable): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of t.rows)
    row.forEach((c, i) => {
      if (!isWithheld(c)) return;
      const line = `${t.columns[i]?.label ?? "Column"}: ${c.why}`;
      if (seen.has(line)) return;
      seen.add(line);
      out.push(line);
    });
  return out;
}

/* ─────────────────────────────────────────────────────────────── CSV ───── */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvText(s: string): string {
  const safe = FORMULA_LEAD.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvCell(c: Cell): string {
  if (c === null) return "";
  if (typeof c === "number") return Number.isFinite(c) ? rawNumber(c) : WITHHELD_WORD;
  if (typeof c === "string") return csvText(c);
  if (isWithheld(c)) return WITHHELD_WORD;
  if (isTyped(c)) return rawNumber(c.n);
  return "";
}

/**
 * A table cell. A column that is numeric names its unit in its header; a TEXT
 * column whose rows mix units (Against ourselves: money on one row, a percent
 * on the next) has no header that can, so a typed number there carries its
 * unit in the cell — otherwise a spreadsheet reader could not tell 12.5 dollars
 * from 12.5 percent.
 */
function csvTableCell(c: Cell, columnUnit: Unit, currency: string | null): string {
  if (columnUnit === "text" && isTyped(c)) {
    // Built from a number, not from text anyone typed, so there is no formula
    // to neutralise — a leading minus is a negative figure. Quoted when the
    // unit word carries a comma ("share, 0–1").
    const word = unitWord(c.unit, currency);
    const s = word ? `${rawNumber(c.n)} ${word}` : rawNumber(c.n);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  return csvCell(c);
}

function csvLine(cells: string[]): string {
  return cells.join(",");
}

export function renderCsv(doc: ExportDoc, h: ExportHeader): string {
  const lines: string[] = [];
  const push = (...cells: string[]) => lines.push(csvLine(cells));

  push(csvText("Mudavym report export"));
  push("House", csvText(h.houseName ?? "name not recorded"));
  push("Cutting", csvText(h.title));
  push("Window", csvText(h.windowLabel));
  push("Written", csvText(h.writtenAt));
  push(
    "Money",
    csvText(
      h.currency
        ? `${h.currency}, the house's reporting currency; money is written as a bare number`
        : "currency not recorded for this house; money is written as a bare number with no currency",
    ),
  );
  push(
    "Withheld",
    csvText(
      `${h.withheldCount} figure${h.withheldCount === 1 ? "" : "s"} the engine could not compute ${h.withheldCount === 1 ? "is" : "are"} written as "${WITHHELD_WORD}", never as 0`,
    ),
  );

  if (doc.say) {
    lines.push("");
    push("Reading", csvText(doc.say));
  }

  if (doc.figures.length > 0) {
    lines.push("");
    push("Figures");
    push("Figure", "Value", "Unit", "Withheld because");
    for (const fig of doc.figures) {
      const unit = isTyped(fig.value) ? fig.value.unit : fig.unit;
      push(
        csvText(fig.label),
        csvCell(fig.value),
        csvText(unitWord(unit, h.currency)),
        isWithheld(fig.value) ? csvText(fig.value.why) : "",
      );
    }
  }

  for (const t of doc.tables) {
    lines.push("");
    push(csvText(t.title));
    push(...t.columns.map((c) => csvText(`${c.label}${unitSuffix(c.unit, h.currency)}`)));
    for (const row of t.rows)
      push(...t.columns.map((col, i) => csvTableCell(row[i] ?? null, col.unit, h.currency)));
    if (t.note) push("Note", csvText(t.note));
    for (const reason of withheldReasons(t)) push("Withheld", csvText(reason));
  }

  if (doc.notes.length > 0) {
    lines.push("");
    push("Notes");
    for (const n of doc.notes) push(csvText(n));
  }

  if (doc.basis.length > 0) {
    lines.push("");
    push("Basis");
    for (const b of doc.basis) push(csvText(b));
  }

  // BOM so a spreadsheet opens it as UTF-8 (em dashes, Turkish letters);
  // CRLF per RFC 4180.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/* ────────────────────────────────────────────────────────────── HTML ───── */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function humanNumber(n: number, unit: Unit): string {
  switch (unit) {
    case "money":
      return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "ratio":
      return `${(n * 100).toFixed(1)}%`;
    case "percent":
      return `${n.toFixed(1)}%`;
    case "days":
      return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
    default:
      return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

function htmlCell(c: Cell, unit: Unit): { html: string; numeric: boolean } {
  if (c === null) return { html: "", numeric: false };
  if (typeof c === "number")
    return { html: escapeHtml(humanNumber(c, unit)), numeric: true };
  if (typeof c === "string") return { html: escapeHtml(c), numeric: false };
  if (isWithheld(c))
    return { html: `<span class="withheld">${WITHHELD_WORD}</span>`, numeric: false };
  if (isTyped(c)) return { html: escapeHtml(humanNumber(c.n, c.unit)), numeric: true };
  return { html: "", numeric: false };
}

const STYLE = `
@page { size: A4; margin: 16mm 14mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 182mm; padding: 10mm 6mm 14mm; background: #fff; color: #1f1b16;
  font: 11pt/1.5 Georgia, "Times New Roman", serif; }
.sans { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.screen-only { font: 9pt ui-sans-serif, system-ui, sans-serif; color: #6b6255; border: 0.5pt dashed #cfc6b6;
  padding: 4pt 8pt; border-radius: 4pt; margin: 0 0 12pt; }
@media print { .screen-only { display: none; } body { padding: 0; } }
.house { font: 600 8.5pt ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: #6b6255; margin: 0; }
h1 { font-size: 22pt; line-height: 1.15; margin: 4pt 0 2pt; font-weight: 600; }
h2 { font: 600 10pt ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; color: #4f473c;
  margin: 16pt 0 4pt; page-break-after: avoid; }
.meta { font: 8.5pt ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #6b6255; margin: 0; }
.say { font-style: italic; margin: 10pt 0 0; max-width: 64ch; }
dl.figures { display: grid; grid-template-columns: 1fr auto; column-gap: 18pt; row-gap: 2pt; margin: 0; }
dl.figures dt { font: 10pt ui-sans-serif, system-ui, sans-serif; color: #4f473c; }
dl.figures dd { margin: 0; text-align: right; font: 10pt ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
dl.figures dd .reason { display: block; font-size: 8pt; color: #6b6255; text-align: right; }
.withheld { font-style: italic; color: #7a4e00; }
table { width: 100%; border-collapse: collapse; font: 9pt ui-sans-serif, system-ui, sans-serif; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th { text-align: left; font-weight: 600; color: #4f473c; border-bottom: 0.8pt solid #1f1b16; padding: 3pt 6pt; vertical-align: bottom; }
td { border-bottom: 0.5pt solid #e0d9cc; padding: 3pt 6pt; vertical-align: top; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.note { font: 8.5pt ui-sans-serif, system-ui, sans-serif; color: #4f473c; margin: 4pt 0 0; }
ul.reasons, ul.plain { margin: 4pt 0 0; padding-left: 14pt; font: 8.5pt ui-sans-serif, system-ui, sans-serif; color: #4f473c; }
footer { margin-top: 18pt; padding-top: 6pt; border-top: 0.5pt solid #cfc6b6; font: 8pt ui-sans-serif, system-ui, sans-serif; color: #6b6255; }
`;

function htmlTable(t: ExportTable, currency: string | null): string {
  const numericCol = t.columns.map((c) => c.unit !== "text");
  const head = t.columns
    .map(
      (c, i) =>
        `<th scope="col"${numericCol[i] ? ' class="num"' : ""}>${escapeHtml(`${c.label}${unitSuffix(c.unit, currency)}`)}</th>`,
    )
    .join("");
  const body = t.rows
    .map((row) => {
      const cells = t.columns
        .map((col, i) => {
          const { html, numeric } = htmlCell(row[i] ?? null, col.unit);
          return `<td${numeric || numericCol[i] ? ' class="num"' : ""}>${html}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  const reasons = withheldReasons(t);
  return [
    `<section><h2>${escapeHtml(t.title)}</h2>`,
    `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`,
    t.note ? `<p class="note">${escapeHtml(t.note)}</p>` : "",
    reasons.length > 0
      ? `<ul class="reasons">${reasons.map((r) => `<li><span class="withheld">${WITHHELD_WORD}</span> — ${escapeHtml(r)}</li>`).join("")}</ul>`
      : "",
    `</section>`,
  ].join("\n");
}

export function renderHtml(doc: ExportDoc, h: ExportHeader): string {
  const house = h.houseName ?? "House name not recorded";
  const written = h.writtenAt;
  const money = h.currency
    ? `Money in ${h.currency}, the house's reporting currency.`
    : "Money is shown with no currency: this house's reporting currency is not recorded.";

  const figures =
    doc.figures.length === 0
      ? ""
      : [
          `<section><h2>Figures</h2><dl class="figures">`,
          ...doc.figures.map((fig) => {
            const unit = isTyped(fig.value) ? fig.value.unit : fig.unit;
            const { html } = htmlCell(fig.value, unit);
            const suffix =
              unit === "money" && !isWithheld(fig.value) && h.currency
                ? ` ${escapeHtml(h.currency)}`
                : "";
            const reason = isWithheld(fig.value)
              ? `<span class="reason">${escapeHtml(fig.value.why)}</span>`
              : "";
            return `<dt>${escapeHtml(fig.label)}</dt><dd>${html}${suffix}${reason}</dd>`;
          }),
          `</dl></section>`,
        ].join("\n");

  const list = (title: string, items: string[]) =>
    items.length === 0
      ? ""
      : `<section><h2>${escapeHtml(title)}</h2><ul class="plain">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul></section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${h.title} — ${house}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<p class="screen-only">Laid out for paper. Print it with Ctrl-P or ⌘P; this note does not print.</p>
<header>
<p class="house">Mudavym · ${escapeHtml(house)}</p>
<h1>${escapeHtml(h.title)}</h1>
<p class="meta">${escapeHtml(h.windowLabel)}</p>
<p class="meta">Written ${escapeHtml(written)} · ${escapeHtml(money)}</p>
${doc.say ? `<p class="say">${escapeHtml(doc.say)}</p>` : ""}
</header>
${figures}
${doc.tables.map((t) => htmlTable(t, h.currency)).join("\n")}
${list("Notes", doc.notes)}
${list("Basis", doc.basis)}
<footer>
${escapeHtml(`${h.withheldCount} figure${h.withheldCount === 1 ? "" : "s"} marked "${WITHHELD_WORD}" ${h.withheldCount === 1 ? "is" : "are"} one the engine could not compute from this house's rows. A withheld figure is not zero.`)}
Written by Mudavym from this house's own registers; no other restaurant's books are in it.
</footer>
</body>
</html>
`;
}
