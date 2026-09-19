import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VERDICT_CURSOR_RE,
  formatVerdictCursor,
  parseVerdictCursor,
  readableLedgerRefusal,
  verdictCursorFilter,
} from "./receiving-verdict-ledger";

/**
 * The verdict ledger's two pure helpers: the paging cursor and the trigger
 * refusal sentence. The SQL the second one reads is not a mock — the drift
 * guard below reads the migration file itself.
 */

const UUID = "3f0c1c5e-0000-4000-8000-000000000001";
const TS = "2026-09-19T10:00:00.123456+00:00";

describe("verdict cursor", () => {
  it("round-trips (recorded_at, id) exactly, microseconds and offset intact", () => {
    const cursor = formatVerdictCursor({ recorded_at: TS, id: UUID });
    expect(cursor).toBe(`${TS}|${UUID}`);
    expect(parseVerdictCursor(cursor)).toEqual({ recordedAt: TS, id: UUID });
  });

  it("accepts a bare timestamp (an older client) with no id", () => {
    expect(parseVerdictCursor("2026-09-16T14:12:00Z")).toEqual({
      recordedAt: "2026-09-16T14:12:00Z",
      id: null,
    });
  });

  it.each([
    `${TS},id.gt.0`,
    `${TS}|${UUID}|extra`,
    `${TS}|)`,
    `(${TS}`,
    "yesterday",
    "",
  ])("rejects %j — nothing outside the timestamp/uuid grammar reaches a filter string", (bad) => {
    expect(parseVerdictCursor(bad)).toBeNull();
    expect(VERDICT_CURSOR_RE.test(bad)).toBe(false);
  });

  it("builds `before` as strictly-before under (recorded_at desc, id desc)", () => {
    expect(verdictCursorFilter({ recordedAt: TS, id: UUID })).toBe(
      `recorded_at.lt.${TS},and(recorded_at.eq.${TS},id.lt.${UUID})`,
    );
  });
});

describe("readableLedgerRefusal", () => {
  it("names what is left when a row is partly taken", () => {
    expect(
      readableLedgerRefusal(`over-take on row ${UUID}: 5 already taken + 3 now = 8 bottles, more than its 6 bottles`),
    ).toBe(
      "That entry has only 1 of its 6 bottles left — 5 are already taken by later entries — so it cannot give up 3 more. Nothing was appended.",
    );
  });

  it("says so plainly when nothing is left", () => {
    expect(
      readableLedgerRefusal(`over-take on row ${UUID}: 6 already taken + 1 now = 7 bottles, more than its 6 bottles`),
    ).toBe(
      "All 6 bottles of that entry are already taken by later entries, so it cannot give up 1 more. Nothing was appended.",
    );
  });

  it("returns null for a message it has not been taught — the caller must not echo it", () => {
    expect(readableLedgerRefusal("permission denied for table x")).toBeNull();
  });

  it("covers every message the guard trigger in the migration can raise (drift guard)", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "../../../../supabase/migrations/20260919170000_receiving_line_verdicts_are_append_only.sql",
      ),
      "utf8",
    );
    const start = sql.indexOf("function public.receiving_line_verdicts_guard_supersedes()");
    const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, end);

    const literals = Array.from(body.matchAll(/raise exception\s+'((?:[^']|'')*)'/g)).map((m) =>
      m[1].replace(/''/g, "'"),
    );
    // If the trigger grows a rule, this count moves and a human decides
    // whether its wording needs a sentence here.
    expect(literals.length).toBe(7);
    for (const lit of literals) {
      const sample = lit.replace(/%/g, "7");
      expect({ lit, sentence: readableLedgerRefusal(sample) }).toEqual({
        lit,
        sentence: expect.stringMatching(/Nothing was appended\.$/),
      });
    }
  });
});
