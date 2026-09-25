import { mayTouchNote, mayUndo } from "./insights/item-state";
import {
  FORGET_OLD_CREATORS_RPC,
  RecommendationHistoryRetention,
} from "./recommendation-history-retention";

/**
 * ADR 0191 round 6 — the founder's one answer (2026-09-22, "Clear them too
 * (Recommended)"):
 *
 *   Round 5 left this open: `pinned_by`, `rated_by` and `assigned_by`
 *   (round 5's own "Gate like acts" answer) did not exist when he answered
 *   "History + created_by", so that answer could not have named them. Asked
 *   again now that they do, he took the recommended option: the SAME
 *   two-year sweep that clears `created_by` ALSO clears `pinned_by`,
 *   `rated_by` and `assigned_by`. `system_audit_log` keeps its own
 *   retention. After clearing, the note gate treats that note as
 *   owner/manager-only to change — which it already does, unchanged, for
 *   any note with no recorded author (round 5).
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * --------------------------------------------
 * The SQL is migration 20260922021000, proven by its own self-asserting
 * test (`supabase/tests/20260922021000_..._test.sql`, T1-T12) and the
 * PGlite probe (`p4-scratch/pglite-probe/RECS6-note-authors-kept-two-
 * years.mjs`) — that a row past two years really does end up with all four
 * author columns NULL, on one call, and that a row inside two years does not
 * move. This file does not re-prove SQL; it has no database.
 *
 * What THIS file proves is the other half the founder asked to be tested:
 * that once a column is cleared, the note gate — `mayTouchNote`, unchanged
 * by this round — reads it exactly the way it already reads a note made
 * before the author columns existed (round 5,
 * `recommendation-round5.spec.ts`, "a note with no recorded author... fails
 * closed"). Round 6 adds no new gate logic; it adds new ROWS that can reach
 * the existing one. Both halves — the SQL clearing and the gate's reading —
 * are named here so they are findable from each other.
 */

const STAFF = { userId: "u-staff-a", role: "staff" };
const OTHER_STAFF = { userId: "u-staff-b", role: "staff" };
const MANAGER = { userId: "u-manager", role: "manager" };
const OWNER = { userId: "u-owner", role: "owner" };
const ADMIN = { userId: "u-admin", role: "admin" };

describe("round 6: after the sweep clears a note's author, the gate is owner/manager-only", () => {
  it("before the sweep: the note is the staff member's own to change or clear", () => {
    expect(mayTouchNote(STAFF, true, "u-staff-a")).toBe(true);
    expect(mayTouchNote(OTHER_STAFF, true, "u-staff-a")).toBe(false);
  });

  it("after the sweep clears the author column (pinned_by/rated_by/assigned_by = null): the SAME staff member who made the note can no longer touch it", () => {
    // This is exactly the row shape recommendation_actions_forget_old_
    // creators() (20260922021000) leaves behind on a row past two years:
    // the note's value (pinned/feedback/assigned_to) is untouched, only the
    // *_by column is null. Proven at the SQL layer by the migration's own
    // test, T3/T4/T6/T10.
    expect(mayTouchNote(STAFF, true, null)).toBe(false);
  });

  it("after the sweep: an owner or manager can still change or clear it — the fail-closed door stays open to the house", () => {
    expect(mayTouchNote(OWNER, true, null)).toBe(true);
    expect(mayTouchNote(MANAGER, true, null)).toBe(true);
  });

  it("after the sweep: the platform admin still makes no note at all (round 4/5's line, untouched by round 6)", () => {
    // mayTouchNote itself does not special-case the admin — that refusal is
    // planAct's, before this is ever asked (round 5). Reading mayTouchNote
    // in isolation would wrongly say true for an unset field; named here so
    // nobody mistakes this file's narrow scope for the whole gate.
    expect(mayTouchNote(ADMIN, false, null)).toBe(true); // planAct refuses first
  });

  it("a note the sweep has not reached yet (author still recorded) is unaffected — clearing is not retroactive to notes inside two years", () => {
    expect(mayTouchNote(STAFF, true, "u-staff-a")).toBe(true);
  });

  it("mayTouchNote is the same function mayUndo already uses for a pre-history act (round 4) — one fail-closed reading, reused, not a second rule invented for round 6", () => {
    expect(mayTouchNote(STAFF, true, null)).toBe(mayUndo(STAFF, null));
    expect(mayTouchNote(OWNER, true, null)).toBe(mayUndo(OWNER, null));
  });

  it("round 6 is the SAME sweep, not a second job: one RPC name, called once a day, whose SQL body now reaches four columns instead of one", () => {
    // No new RPC constant exists for the note-author columns — see
    // recommendation-history-retention.ts's ROUND 6 doc comment and
    // migration 20260922021000's CREATE OR REPLACE of this exact function.
    expect(FORGET_OLD_CREATORS_RPC).toBe(
      "recommendation_actions_forget_old_creators",
    );
    expect(typeof RecommendationHistoryRetention.prototype.forgetOldCreators).toBe(
      "function",
    );
    // No second method was added for "forget old note authors" — grep the
    // class for one and find none:
    expect(
      Object.getOwnPropertyNames(RecommendationHistoryRetention.prototype),
    ).not.toContain("forgetOldNoteAuthors");
  });
});
