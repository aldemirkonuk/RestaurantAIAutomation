import { describeReadFailure, interpretRead } from "./scheduled-read";

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
