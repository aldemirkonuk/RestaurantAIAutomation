/**
 * Test-only reader for the ADD/DROP COLUMN clauses of every ALTER TABLE in a
 * migration file. Shared by the specs that rebuild a table's column list out
 * of supabase/migrations (order-schema-drift, order-calendar-event,
 * order-calendar-event-lifecycle) so the three cannot drift apart again.
 *
 * Two defects this exists to close, both measured on the real corpus:
 *
 * 1. Multi-column statements. One ALTER TABLE may ADD or DROP several columns
 *    as comma-separated clauses:
 *        ALTER TABLE t ADD COLUMN a text, ADD COLUMN b text;
 *    A regex matching "ALTER TABLE ... ADD COLUMN" as one literal run finds
 *    only the FIRST clause, so "b" was invisible and a real select naming it
 *    read as 42703.
 *
 * 2. Comments. The statement body runs to its terminating `;`, and a `;` in a
 *    `--` comment inside the statement ended the body early:
 *        ALTER TABLE public.procurement_orders
 *          -- ... Set once; never advanced.
 *          ADD COLUMN IF NOT EXISTS recurrence_anchored_on date, ...
 *    hid every clause after the comment (23 real columns in 5 tables on
 *    2026-09-25). A commented-out rollback (`-- ALTER TABLE t -- DROP COLUMN
 *    x;`) was also read as a live DROP. Comments are therefore blanked before
 *    statements are matched, by a scanner that knows string literals and
 *    quoted identifiers, and a `;` inside a string literal no longer ends the
 *    statement either.
 *
 * Known limits, stated so nobody reads this as a SQL parser: dollar-quoted
 * bodies ($$ ... $$) are scanned as ordinary SQL, which is what makes an
 * ALTER TABLE inside a DO block count (it is real); an ADD without the COLUMN
 * keyword (`ADD foo text`) and RENAME COLUMN are not read; E'' strings with a
 * backslash-escaped quote are not modelled. None occurs in an ALTER TABLE body
 * in the corpus today.
 */

/**
 * Blank every `--` and (nested) `/* *\/` comment, keeping line breaks and
 * string literals, and replace a `;` inside a single-quoted string literal
 * with a space so it cannot be mistaken for a statement terminator.
 */
export function blankSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";
    if (c === "'" || c === '"') {
      // String literal or quoted identifier; a doubled quote is an escape.
      out += c;
      i++;
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) {
            out += c + c;
            i += 2;
            continue;
          }
          out += c;
          i++;
          break;
        }
        out += c === "'" && sql[i] === ";" ? " " : sql[i];
        i++;
      }
      continue;
    }
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 0;
      while (i < n) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          out += "  ";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          out += "  ";
          i += 2;
          if (depth === 0) break;
        } else {
          out += sql[i] === "\n" ? "\n" : " ";
          i++;
        }
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface AlterColumnClause {
  /** Table name as written, unquoted and without a `public.` prefix. */
  table: string;
  op: "ADD" | "DROP";
  column: string;
}

/**
 * Every ADD COLUMN / DROP COLUMN clause of every ALTER TABLE in `sql`, in
 * the order they appear, so a caller replaying them reproduces the schema
 * Postgres would end up with (a DROP followed by a re-ADD keeps the column).
 */
export function alterTableColumnClauses(sql: string): AlterColumnClause[] {
  const text = blankSqlComments(sql);
  // `\s+` after the name is load-bearing: without it `ALTER TABLE auth.users`
  // would bind "auth" as the table and read users' clauses into it.
  const stmtRe =
    /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?public"?\.)?"?(\w+)"?\s+([^;]*);/gi;
  const clauseRe =
    /\b(ADD|DROP)\s+COLUMN\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?(\w+)"?/gi;
  const out: AlterColumnClause[] = [];
  let s: RegExpExecArray | null;
  while ((s = stmtRe.exec(text)) !== null) {
    clauseRe.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = clauseRe.exec(s[2])) !== null) {
      out.push({
        table: s[1],
        op: c[1].toUpperCase() as "ADD" | "DROP",
        column: c[2],
      });
    }
  }
  return out;
}
