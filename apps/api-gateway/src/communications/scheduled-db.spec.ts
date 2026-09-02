import {
  describeReadFailure,
  describeWriteFailure,
  interpretRead,
  interpretWrite,
} from "./scheduled-db";

/**
 * The one distinction three dead crons could not make: a query that FAILED
 * versus a query that matched nothing. See ADR 0077.
 */
describe("interpretRead", () => {
  it("a 42703 is a failure, and says which column shape broke it", () => {
    const out = interpretRead("payment-due-reminder", "procurement_orders", {
      data: null,
      error: {
        code: "42703",
        message: "column procurement_orders.payment_due_date does not exist",
      },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toContain("payment-due-reminder");
    expect(out.reason).toContain("procurement_orders");
    expect(out.reason).toContain("42703");
    expect(out.reason).toContain("COLUMN that does not exist");
    expect(out.reason).toContain("nothing was sent");
  });

  it("an empty result is a SUCCESS, and is not confusable with a failure", () => {
    const empty = interpretRead(
      "delivery-eta-notification",
      "procurement_orders",
      {
        data: [],
        error: null,
      },
    );
    const failed = interpretRead(
      "delivery-eta-notification",
      "procurement_orders",
      {
        data: null,
        error: { code: "42P01", message: "relation does not exist" },
      },
    );
    expect(empty).toEqual({ ok: true, rows: [] });
    expect(failed.ok).toBe(false);
    // The whole defect in one assertion: these two must not be the same value.
    expect(empty.ok).not.toEqual(failed.ok);
  });

  it("rows come through untouched", () => {
    const out = interpretRead("custom-reminders-check", "custom_reminders", {
      data: [{ id: "r-1" }, { id: "r-2" }],
      error: null,
    });
    expect(out).toEqual({ ok: true, rows: [{ id: "r-1" }, { id: "r-2" }] });
  });

  it("neither rows nor an error is a failure, not an empty list", () => {
    // supabase-js should not do this, but a mock or a proxy can, and reading it
    // as "nothing matched" is precisely the fault being fixed.
    const out = interpretRead("event-prep-check", "calendar_events", {
      data: null,
      error: null,
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toContain("neither rows nor an error");
  });

  it("a missing envelope is a failure rather than a crash", () => {
    const out = interpretRead("weekly-email-report", "providers", undefined);
    expect(out.ok).toBe(false);
  });
});

describe("describeReadFailure", () => {
  it("still names the job and table when the error carries nothing", () => {
    const msg = describeReadFailure("event-prep-check", "calendar_events", {});
    expect(msg).toContain("event-prep-check");
    expect(msg).toContain("calendar_events");
    expect(msg).toContain("[no code]");
    expect(msg).toContain("no message from the database");
  });

  it("passes through details and hint when the database supplies them", () => {
    const msg = describeReadFailure("weekly-email-report", "providers", {
      code: "42501",
      message: "permission denied for table providers",
      details: "role anon",
      hint: "check the policy",
    });
    expect(msg).toContain("check RLS for this role");
    expect(msg).toContain("details: role anon");
    expect(msg).toContain("hint: check the policy");
  });
});

/**
 * The write side of the same trap. supabase-js RETURNS `{error}` rather than
 * throwing, so the `try/catch` these calls sat inside was inert and a lost row
 * looked exactly like a saved one. Nothing is corrupted — something is missing,
 * which cannot be found by querying for it later. See ADR 0077.
 */
describe("interpretWrite", () => {
  it("a clean envelope is a success", () => {
    expect(
      interpretWrite("custom-reminders-check", "notifications", "a row", {
        error: null,
      }),
    ).toEqual({ ok: true });
  });

  it("names what was lost, not just that something failed", () => {
    const out = interpretWrite(
      "persistRestaurantNotification",
      "notifications",
      '3 in-app notification row(s) of type "payment_due" for restaurant r-1',
      { error: { code: "PGRST204", message: "column x not found" } },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toContain("3 in-app notification row(s)");
    expect(out.reason).toContain("was NOT saved");
    expect(out.reason).toContain("COLUMN the table does not have");
    expect(out.reason).toContain("something is MISSING");
  });

  it("a missing envelope is a failure — silence is not a saved row", () => {
    expect(
      interpretWrite("custom-reminders-check", "custom_reminders", "x", null)
        .ok,
    ).toBe(false);
  });

  it("a 23503 points at the auth.users / public.users trap by name", () => {
    // These two tables share ZERO ids, and an actor FK aimed at the wrong one
    // 23503s on every write while CI stays green (a fresh DB has no rows to
    // violate). The message has to say so, because the code alone does not.
    const msg = describeWriteFailure(
      "custom-reminders-check",
      "notifications",
      "one row",
      { code: "23503", message: "violates foreign key constraint" },
    );
    expect(msg).toContain("public.users(user_id)");
    expect(msg).toContain("auth.users");
  });

  it("says nothing was saved even when the error carries nothing", () => {
    const msg = describeWriteFailure("job", "notifications", "one row", {});
    expect(msg).toContain("was NOT saved");
    expect(msg).toContain("[no code]");
  });
});
