/**
 * Reading the LWIN database file — the pure half.
 *
 * WHOSE QUESTION THIS ANSWERS
 * ---------------------------
 * ADR 0124 Q4, the founder 2026-09-05 (batch 49): **"LWIN search + hand
 * nominations."** *"A house searches the LWIN file and confirms identities from
 * it, and can also nominate a wine by hand ... Two ways in; nothing invented."*
 * And batch 43 settled the file itself: taken as a **recorded one-off file
 * refreshed on a stated cadence**, not a live fetch.
 *
 * WHY THERE IS NO LWIN FILE IN THIS REPO, AND WHY THAT IS NOT A GAP
 * ----------------------------------------------------------------
 * Liv-ex publishes the database free under **CC BY 4.0**
 * (https://www.liv-ex.com/lwin/lwin-creative-commons/, read 2026-09-05) and it
 * covers *"over 200,000 wines and spirits"* — but it is served through a form,
 * not a URL. Probed on 2026-09-05 with an identifying UA: the LWIN page
 * (147,184 bytes) carries **no `.csv`, `.xlsx` or `.zip` link at all**, and
 * three guessed paths under `wp-content/uploads` and `/lwin/download/` all
 * returned **404**. So the file is obtained by a person, put where
 * `LWIN_FILE_PATH` points, and refreshed on the cadence recorded in the ADR.
 *
 * Until it is there, the search route says the file is ABSENT and names the
 * path, the licence and the download page. It does not return an empty list:
 * "no wine matched" and "there is no file" are different answers and only one
 * of them is about the wine.
 *
 * The fixture beside this file is SYNTHETIC and named so. Not one real LWIN row
 * is committed here — inventing rows that claimed to be Liv-ex's would be the
 * exact failure this register exists to prevent, and it would also be a licence
 * problem wearing a data problem's clothes.
 */

import { IdentityInput } from "./beverage-identity";
import { normalizeIdentityText } from "./wine-identity";

/**
 * The columns this reader requires, and refuses a file without.
 *
 * These are the field NAMES the reader binds to. They are declared here rather
 * than sniffed, so a file with a different shape is refused BY NAME instead of
 * silently parsing into empty strings — the shape ADR 0117's staleness gate had
 * to be invented for, one level down.
 */
export const LWIN_REQUIRED_COLUMNS = Object.freeze([
  "LWIN",
  "DISPLAY_NAME",
  "PRODUCER_NAME",
]);

/** Columns the reader uses when present and does not require. */
export const LWIN_OPTIONAL_COLUMNS = Object.freeze([
  "PRODUCER_TITLE",
  "REGION",
  "COUNTRY",
  "COLOUR",
  "TYPE",
  "SUB_TYPE",
  "DESIGNATION",
  "CLASSIFICATION",
  "VINTAGE_CONFIG",
  "FIRST_VINTAGE",
  "FINAL_VINTAGE",
  "STATUS",
]);

export interface LwinRow {
  lwin: string;
  displayName: string;
  producer: string;
  region: string | null;
  country: string | null;
  colour: string | null;
  status: string | null;
  /** Everything the file said, kept so a reader can see what was not used. */
  raw: Record<string, string>;
}

export interface LwinFileReading {
  ok: true;
  rows: LwinRow[];
  rowsRead: number;
  refusals: Record<string, number>;
}
export interface LwinFileRefusal {
  ok: false;
  reason: "empty_file" | "missing_columns" | "no_rows";
  note: string;
  missing?: string[];
}

/** Split one CSV line, honouring double-quoted fields with embedded commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/**
 * Parse the recorded file.
 *
 * A row missing an LWIN, a display name or a producer is REFUSED and counted by
 * reason, never defaulted — the same rule every other reader in this module
 * follows, and the reason a house can be told "4,102 rows read, 11 refused"
 * instead of a number that quietly means something else.
 */
export function readLwinFile(text: string): LwinFileReading | LwinFileRefusal {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0 && !l.startsWith("#"));
  if (lines.length === 0) {
    return { ok: false, reason: "empty_file", note: "The file has no lines." };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toUpperCase());
  const missing = LWIN_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_columns",
      missing,
      note: `The file does not carry ${missing.join(", ")}. A file whose shape this reader does not recognise is refused rather than parsed into empty strings.`,
    };
  }

  const at = (cells: string[], col: string): string => {
    const i = header.indexOf(col);
    return i >= 0 ? (cells[i] ?? "") : "";
  };

  const rows: LwinRow[] = [];
  const refusals: Record<string, number> = {};
  const refuse = (why: string) => {
    refusals[why] = (refusals[why] ?? 0) + 1;
  };

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const lwin = at(cells, "LWIN");
    const displayName = at(cells, "DISPLAY_NAME");
    const producer = at(cells, "PRODUCER_NAME") || at(cells, "PRODUCER_TITLE");

    if (!/^\d{7}$/.test(lwin)) {
      refuse("lwin_not_seven_digits");
      continue;
    }
    if (!displayName) {
      refuse("no_display_name");
      continue;
    }
    if (!producer) {
      refuse("no_producer");
      continue;
    }

    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (cells[idx]) raw[h] = cells[idx];
    });

    rows.push({
      lwin,
      displayName,
      producer,
      region: at(cells, "REGION") || null,
      country: at(cells, "COUNTRY") || null,
      colour: at(cells, "COLOUR") || null,
      status: at(cells, "STATUS") || null,
      raw,
    });
  }

  if (rows.length === 0) {
    return {
      ok: false,
      reason: "no_rows",
      note: `${lines.length - 1} data line(s) were read and every one was refused (${JSON.stringify(refusals)}). An empty result here is about the file, not about the wine.`,
    };
  }

  return { ok: true, rows, rowsRead: lines.length - 1, refusals };
}

export interface LwinSearchHit extends LwinRow {
  /** How many of the query's words the row's producer + name matched, 0..1. */
  score: number;
}

/**
 * Search the file by words, not by prefix.
 *
 * A house types "margaux 2015" or "krug grande cuvee"; a prefix match would
 * find neither. Every query word must appear somewhere in the producer or the
 * display name, which is strict enough that a two-word query is a real filter
 * and loose enough that word order does not matter.
 *
 * The LWIN file carries no vintage per row (LWIN-7 IS the wine; the vintage
 * lives in the longer forms), so a year in the query is matched against the
 * text like any other word and is NOT treated as a vintage filter. Pretending
 * otherwise would silently drop every row for a query that named a year.
 */
export function searchLwin(
  rows: readonly LwinRow[],
  query: string,
  limit = 20,
): LwinSearchHit[] {
  const words = normalizeIdentityText(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const hits: LwinSearchHit[] = [];
  for (const row of rows) {
    const hay = `${normalizeIdentityText(row.producer)} ${normalizeIdentityText(row.displayName)}`;
    const matched = words.filter((w) => hay.includes(w)).length;
    if (matched < words.length) continue;
    hits.push({ ...row, score: Number((matched / words.length).toFixed(3)) });
  }

  // Shortest display name first among equal scores: the file holds a producer's
  // whole range, and the plainest name is the one a person meant.
  hits.sort(
    (a, b) => b.score - a.score || a.displayName.length - b.displayName.length,
  );
  return hits.slice(0, limit);
}

/**
 * Turn one LWIN row plus the format a house states into an identity input.
 *
 * The VINTAGE, SIZE AND PACK COME FROM THE HOUSE, not from the file: an LWIN-7
 * names the wine and nothing else. This function refuses to invent them — an
 * absent vintage stays `unstated` and an absent size stays null, which is
 * exactly what `readIdentity` will record.
 */
export function identityFromLwin(
  row: LwinRow,
  stated: { vintage?: string | number | null; sizeMl?: number | null; pack?: number | null } = {},
): IdentityInput {
  return {
    producer: row.producer,
    name: row.displayName,
    vintage: stated.vintage ?? null,
    sizeMl: stated.sizeMl ?? null,
    pack: stated.pack ?? null,
  };
}
