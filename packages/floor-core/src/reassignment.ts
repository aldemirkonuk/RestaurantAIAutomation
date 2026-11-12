/**
 * Reassignment proposal (founder pick 4, 2026-10-30, ADR 0345 `:98-100`):
 * when a waiter leaves, calls out or runs late, propose who takes which of
 * their tables. It only proposes; nothing moves until a manager taps Apply.
 *
 * New in the port; the checker has no such function. The pick names "same
 * section, lightest load"; the order below, which makes the proposal the
 * same for the same input, is the executor's (OD-259).
 *
 * - Tables are placed one at a time: seated tables first (a party is waiting),
 *   then by label in numeric order ("2" before "10"), then by id.
 * - Each table goes to the eligible waiter with the lightest load; ties break
 *   on waiter id. The chosen waiter's load then counts that table, so a run of
 *   tables spreads instead of piling onto one person.
 * - Eligible means: not the waiter being replaced, and working the table's
 *   section.
 * - Load is the caller's count of tables each waiter holds now; this function
 *   does not decide what a load is.
 *
 * Open as OD-259, the executor's reading under OD-242, not the founder's pick:
 * - a table with no section (null or "") may go to anyone on the list,
 *   including a waiter whose section list is empty, by analogy with how the
 *   checker's merge list treats a sectionless table
 *   (`lib/floor-merge.ts:144` at `5958689`, a truthy test);
 * - a waiter listed more than once is one candidate who works every section
 *   any of their rows names, at the largest load listed (taking the first row
 *   made the proposal depend on input order);
 * - a load that is not a finite number reads as Infinity: that waiter is
 *   never proposed while a waiter with a readable load is eligible, and a NaN
 *   never wins the comparison by default; a finite load is used as given,
 *   negative or fractional included; when every eligible load is
 *   unreadable, Infinity + 1 is Infinity, so those tables all go to the
 *   lowest id instead of spreading;
 * - the placing order and tie-breaks above;
 * - a table listed twice is proposed once; its first row in that order wins
 *   (a seated row before an unseated one, then the lowest section id, a
 *   sectionless row last), never the input order.
 */

export interface ReassignTable {
  tableId: string;
  label: string;
  sectionId: string | null;
  /** The table has an open seating now. */
  seated: boolean;
}

export interface ReassignCandidate {
  waiterId: string;
  /** Sections this waiter is working. */
  sectionIds: string[];
  /** Tables the waiter holds now. */
  load: number;
}

export type ReassignReason =
  /** Lightest load among the waiters working the table's section. */
  | "lightest_in_section"
  /** The table has no section; lightest load among everyone listed. */
  | "lightest_on_shift"
  /** Nobody else works this section: the manager picks by hand. */
  | "no_one_in_section"
  /** The table has no section and nobody else is listed: by hand. */
  | "no_one_on_shift";

export interface ReassignProposal {
  tableId: string;
  toWaiterId: string | null;
  reason: ReassignReason;
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function proposeReassignment(input: {
  tables: readonly ReassignTable[];
  candidates: readonly ReassignCandidate[];
  /** The waiter leaving, calling out or running late; never proposed (an exact id match, no trimming or case folding). */
  fromWaiterId: string;
}): ReassignProposal[] {
  // A fixed locale ("en", numeric) keeps the label order stable across
  // callers; equal labels fall back to the id, a code-unit compare.
  const sorted = [...input.tables].sort((a, b) => {
    if (a.seated !== b.seated) return a.seated ? -1 : 1;
    const byLabel = a.label.localeCompare(b.label, "en", { numeric: true });
    if (byLabel !== 0) return byLabel;
    const byTable = byId(a.tableId, b.tableId);
    if (byTable !== 0) return byTable;
    // Two rows for one table: the lowest section wins, sectionless last, so
    // the input order never decides (OD-259).
    return byId(a.sectionId || "\uffff", b.sectionId || "\uffff");
  });
  const seen = new Set<string>();
  const tables = sorted.filter((t) => !seen.has(t.tableId) && seen.add(t.tableId));

  // One entry per waiter: sections unioned, the largest load kept. A load
  // that is not finite is the heaviest (OD-259).
  const load = new Map<string, number>();
  const sections = new Map<string, Set<string>>();
  for (const c of input.candidates) {
    if (c.waiterId === input.fromWaiterId) continue;
    const l = Number.isFinite(c.load) ? c.load : Infinity;
    const known = sections.get(c.waiterId);
    if (known) {
      for (const id of c.sectionIds) known.add(id);
      load.set(c.waiterId, Math.max(load.get(c.waiterId) ?? 0, l));
    } else {
      sections.set(c.waiterId, new Set(c.sectionIds));
      load.set(c.waiterId, l);
    }
  }
  const pool = [...sections.keys()];

  return tables.map((table): ReassignProposal => {
    // "" is no section, as the checker's truthy test reads it.
    const section = table.sectionId || null;
    const eligible = pool.filter((id) =>
      section === null ? true : sections.get(id)?.has(section) === true,
    );
    if (eligible.length === 0) {
      return {
        tableId: table.tableId,
        toWaiterId: null,
        reason: section === null ? "no_one_on_shift" : "no_one_in_section",
      };
    }
    const chosen = eligible.reduce((best, id) => {
      const lb = load.get(best) ?? 0;
      const lc = load.get(id) ?? 0;
      if (lc !== lb) return lc < lb ? id : best;
      return byId(id, best) < 0 ? id : best;
    });
    load.set(chosen, (load.get(chosen) ?? 0) + 1);
    return {
      tableId: table.tableId,
      toWaiterId: chosen,
      reason: section === null ? "lightest_on_shift" : "lightest_in_section",
    };
  });
}
