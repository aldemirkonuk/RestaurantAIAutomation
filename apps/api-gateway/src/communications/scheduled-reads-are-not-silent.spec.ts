import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Every read in `scheduled-tasks.service.ts` must name columns that exist, and
 * must be able to tell a FAILED read from an EMPTY one.
 *
 * Three crons in this one file have died the same death. The `status =
 * 'RECURRING'` filter matched nothing for its whole life (ADR 0058); the
 * recurring reminder was pointed at a table that does not hold the concept
 * (ADR 0061); and the payment-due reminder filtered on `payment_due_date`, a
 * column no table in the schema declares, so PostgREST answered 42703, the
 * whole query failed, and
 *
 *     const { data: invoices } = await client.from("procurement_orders")...
 *     if (!invoices || invoices.length === 0) return;
 *
 * read that failure as "nothing is due" and returned. Not one reminder in the
 * job's lifetime, and not one log line saying so.
 *
 * The column half and the error half are the same defect seen twice: a query
 * that CANNOT succeed, wired to a caller that CANNOT notice. So this file
 * asserts both, over the whole service rather than the one job that was
 * reported.
 *
 * THE ORACLE IS `supabase/migrations/`, NOT A LIST TYPED HERE. A test that
 * checks the code against column names I wrote down is a test that agrees with
 * me. Parsing the schema means the assertion can actually disagree.
 *
 * NEVER VACUOUS. Every "found nothing" path fails: no migrations, no declared
 * columns, no read sites, or fewer read sites than the file is known to have.
 * A scan that silently stops finding call sites reports a clean file, which is
 * the same lie in a new place.
 */

const SERVICE = join(__dirname, "scheduled-tasks.service.ts");
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

/**
 * The file holds this many `.from(t).select(...)` reads. A floor, not an exact
 * count: if the scan finds fewer, the extractor has rotted and every assertion
 * below is vacuously true.
 */
const MIN_READ_SITES = 6;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Columns `supabase/migrations/` declares for one table, replayed in version
 * order: CREATE TABLE body, then ADD COLUMN / DROP COLUMN / RENAME COLUMN.
 * Same walker as `conversation-log-columns.spec.ts` (ADR 0065).
 */
function declaredColumns(table: string): Set<string> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const cols = new Set<string>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");

    const create = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?"?${table}"?\\s*\\(`,
      "i",
    ).exec(sql);
    if (create) {
      let depth = 0;
      let end = -1;
      for (let i = create.index + create[0].length - 1; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) throw new Error(`unterminated CREATE TABLE ${table}`);
      const body = sql.slice(create.index + create[0].length, end);
      let paren = 0;
      let current = "";
      for (const ch of body) {
        if (ch === "(") paren++;
        else if (ch === ")") paren--;
        if (ch === "," && paren === 0) {
          addColumn(cols, current);
          current = "";
        } else {
          current += ch;
        }
      }
      addColumn(cols, current);
    }

    const alterRe = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?"?${table}"?([\\s\\S]*?);`,
      "gi",
    );
    for (const alter of sql.matchAll(alterRe)) {
      const clause = alter[1];
      for (const m of clause.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.add(m[1].toLowerCase());
      }
      for (const m of clause.matchAll(
        /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.delete(m[1].toLowerCase());
      }
      for (const m of clause.matchAll(
        /RENAME\s+COLUMN\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+TO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.delete(m[1].toLowerCase());
        cols.add(m[2].toLowerCase());
      }
    }
  }
  return cols;
}

function addColumn(into: Set<string>, fragment: string): void {
  const line = fragment.trim();
  if (!line) return;
  if (
    /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i.test(
      line,
    )
  )
    return;
  const name = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?/.exec(line);
  if (name) into.add(name[1].toLowerCase());
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ReadSite {
  table: string;
  line: number;
  /** The builder chain, from `.from(` to the end of the statement. */
  chain: string;
  /** ~200 chars before `.from(` — where an assignment or a wrapper call sits. */
  lead: string;
  /** ~200 chars after the statement — where a trailing check sits. */
  trail: string;
}

const SOURCE = readFileSync(SERVICE, "utf8");

/**
 * The same file with comment BODIES blanked but every newline kept, so line
 * numbers still line up with the real file.
 *
 * Every assertion below runs on this, not on SOURCE. Without it the checks are
 * satisfiable by prose: a comment near a read that happens to contain the word
 * "error" passes the error-handling test, and one naming `payment_due_date`
 * fails the deletion test. Both actually happened while writing this file —
 * which is the point, since a check that a comment can satisfy is a check that
 * measures nothing.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) =>
  m.replace(/[^\n]/g, " "),
);

/**
 * The file holds this many `.insert(` / `.update(` writes. Same floor logic as
 * MIN_READ_SITES: fewer means the extractor rotted, not that the file got clean.
 */
const MIN_WRITE_SITES = 6;

/** `.from("t")` plus everything up to the next `.from(` or `;`. */
function readSites(src: string): ReadSite[] {
  const sites: ReadSite[] = [];
  const re = /\.from\(\s*["']([a-z][a-z0-9_]*)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    let end = start + m[0].length;
    while (end < src.length) {
      if (src[end] === ";") break;
      if (src.startsWith(".from(", end)) break;
      end++;
    }
    const chain = src.slice(start, end);
    if (!/\.select\(/.test(chain)) continue; // writes are a different guard
    sites.push({
      table: m[1],
      line: src.slice(0, start).split("\n").length,
      chain,
      lead: src.slice(Math.max(0, start - 200), start),
      trail: src.slice(end, end + 200),
    });
  }
  return sites;
}

/** The same windows, but the ones that WRITE rather than read. */
function writeSites(src: string): ReadSite[] {
  const sites: ReadSite[] = [];
  const re = /\.from\(\s*["']([a-z][a-z0-9_]*)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    const start = m.index!;
    let end = start + m[0].length;
    while (end < src.length) {
      if (src[end] === ";") break;
      if (src.startsWith(".from(", end)) break;
      end++;
    }
    const chain = src.slice(start, end);
    if (!/\.(insert|update|upsert|delete)\(/.test(chain)) continue;
    sites.push({
      table: m[1],
      line: src.slice(0, start).split("\n").length,
      chain,
      lead: src.slice(Math.max(0, start - 400), start),
      trail: src.slice(end, end + 300),
    });
  }
  return sites;
}

/**
 * Columns a chain names: the literal `.select("…")` list plus every filter
 * argument. Embeds (`providers(name)`), `*` and non-literal selects are
 * skipped — unresolvable, not clean, and reported separately.
 */
function namedColumns(chain: string): { cols: Set<string>; literal: boolean } {
  const cols = new Set<string>();
  let literal = false;

  const sel = /\.select\(\s*(["'`])([\s\S]*?)\1/.exec(chain);
  if (sel) {
    literal = true;
    for (const raw of sel[2].split(",")) {
      const part = raw.trim();
      if (!part || part === "*") continue;
      if (part.includes("(") || part.includes(")")) continue; // embed
      if (part.includes(":")) continue; // aliased embed
      const name = /^([a-z_][a-z0-9_]*)/i.exec(part);
      if (name) cols.add(name[1].toLowerCase());
    }
  }

  const filterRe =
    /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|order|not|filter)\(\s*["']([a-z_][a-z0-9_.]*)["']/g;
  for (const f of chain.matchAll(filterRe)) {
    const col = f[2].toLowerCase();
    if (col.includes(".")) continue; // embedded-resource filter
    cols.add(col);
  }

  return { cols, literal };
}

// ---------------------------------------------------------------------------

describe("scheduled-tasks reads: columns exist, and a failure is not an empty result", () => {
  const sites = readSites(CODE);

  it("the scan actually found something to check", () => {
    expect(
      readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).length,
    ).toBeGreaterThan(0);
    expect(declaredColumns("procurement_orders").size).toBeGreaterThan(20);
    expect(sites.length).toBeGreaterThanOrEqual(MIN_READ_SITES);
  });

  it("names no column the schema does not declare", () => {
    const findings: string[] = [];
    for (const site of sites) {
      const declared = declaredColumns(site.table);
      if (declared.size === 0) continue; // relation-level absence is another guard's job
      const { cols } = namedColumns(site.chain);
      for (const col of cols) {
        if (!declared.has(col)) {
          findings.push(
            `scheduled-tasks.service.ts:${site.line} reads ` +
              `${site.table}.${col}, which no migration declares. PostgREST ` +
              `answers 42703 and the WHOLE query fails.`,
          );
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it("reads the error on every read, so a failure cannot pass for empty", () => {
    const findings: string[] = [];
    for (const site of sites) {
      const handled =
        /\berror\b/.test(site.lead) || /readRows\s*[<(]/.test(site.lead);
      if (!handled) {
        findings.push(
          `scheduled-tasks.service.ts:${site.line} reads ${site.table} and ` +
            `discards \`error\`. A failed query arrives as data: null, which ` +
            `the caller cannot tell from "nothing matched".`,
        );
      }
    }
    expect(findings).toEqual([]);
  });

  it("reads the error on every WRITE too, so a lost row cannot pass for a saved one", () => {
    // supabase-js RETURNS `{error}` rather than throwing, so a `try/catch`
    // around a write is inert for database errors. Nothing is corrupted; a good
    // row is simply never written, and nothing records that it failed — damage
    // that cannot be enumerated afterwards, let alone repaired. Two of these
    // dropped an in-app notification; the other four leave a custom reminder
    // still due, so the 15-minute cron re-mails it indefinitely.
    const writes = writeSites(CODE);
    expect(writes.length).toBeGreaterThanOrEqual(MIN_WRITE_SITES);
    const findings: string[] = [];
    for (const site of writes) {
      // A wrapper reads `this.wrote(await client.from(…))` — the call is in the
      // lead. An assignment reads `const x = await client.from(…);` and the
      // check follows — so the trail counts too.
      const near = site.lead + site.trail;
      const handled = /\berror\b/.test(near) || /\bwrote\s*\(/.test(near);
      if (!handled) {
        findings.push(
          `scheduled-tasks.service.ts:${site.line} writes ${site.table} and ` +
            `never reads \`error\`. The row may never have landed.`,
        );
      }
    }
    expect(findings).toEqual([]);
  });

  it("has no payment-due reminder, because nothing in the schema can answer it", () => {
    // `payment_due_date` is declared by no table; `procurement_orders` has no
    // `payment_terms`, no `final_price_per_bottle`, no
    // `negotiated_price_per_bottle`; no table anywhere carries a paid state.
    // The job was a stub for an accounts-payable module that was never built.
    // See ADR 0077. If AP is built, this test is what should be deleted first.
    // Matched against CODE, not the file: the tombstone comment left in its
    // place names `payment_due_date` on purpose, and a test that forbade the
    // word would be a test against the explanation rather than the defect.
    expect(CODE).not.toMatch(/payment_due_date/);
    expect(CODE).not.toMatch(/sendPaymentDueReminders/);
    expect(CODE).not.toMatch(/payment-due-reminder/);
  });
});
