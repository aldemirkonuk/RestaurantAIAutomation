import { LowStockAlertsService } from "./low-stock-alerts.service";

/**
 * "EMAILED" BECOMES A FACT ON THE ROW (ADR 0093 D5).
 *
 * Before this, the low-stock path persisted an inbox row, called
 * `GmailService.sendLowStockDigest`, and on failure logged a warning. Nothing
 * was written to `notifications.delivery_status`, which has existed as a
 * column the whole time. So the row for an email that never left was
 * byte-identical to the row for one that did, and the only difference lived in
 * a log line nobody can query — the [[absence-reported-as-health]] shape.
 *
 * Four outcomes, four assertions. The one that matters most is the third:
 * `gmail_not_configured` is a RECORDED failure, not silence. A row with no
 * `delivery_status.email` at all means "we never looked", and the verifier
 * renders that as `unverifiable` rather than as "not sent".
 */

type Row = Record<string, any>;

function makeDb(existingDeliveryStatus: Row | null = null) {
  const updates: Array<{ id: string; delivery_status: Row }> = [];
  const notificationRows = [
    { id: "n-1", delivery_status: existingDeliveryStatus },
    { id: "n-2", delivery_status: existingDeliveryStatus },
  ];

  const chain = (table: string): any => {
    const q: any = {
      _table: table,
      _updating: null as Row | null,
      select: () => q,
      eq: (_col: string, val: string) => {
        if (q._updating) {
          updates.push({
            id: val,
            delivery_status: q._updating.delivery_status,
          });
          return Promise.resolve({ error: null });
        }
        return q;
      },
      neq: () => q,
      in: (_col: string, _vals: string[]) =>
        table === "notifications"
          ? Promise.resolve({ data: notificationRows, error: null })
          : q,
      update: (patch: Row) => {
        q._updating = patch;
        return q;
      },
      upsert: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: { alert_count: 0 } }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    return q;
  };

  return {
    db: {
      supabase: { from: (t: string) => chain(t) },
      getClient: () => ({ from: (t: string) => chain(t) }),
      getRestaurantMemberIds: jest.fn().mockResolvedValue(["user-1"]),
    } as any,
    updates,
  };
}

const wines = [
  {
    inventoryId: "inv-1",
    wineId: "wine-1",
    wineName: "Opus One 2019",
    currentStock: 2,
    threshold: 8,
    severity: "critical" as const,
  },
];

function build(opts: {
  gmail?: any;
  recipients?: string[];
  existingDeliveryStatus?: Row | null;
}) {
  const { db, updates } = makeDb(opts.existingDeliveryStatus ?? null);
  const notifications = {
    persistForRestaurant: jest
      .fn()
      .mockResolvedValue({ inserted: 2, ids: ["n-1", "n-2"] }),
  };
  const config = { get: jest.fn().mockReturnValue("") };
  const recipientResolver =
    opts.recipients === undefined
      ? undefined
      : {
          resolveRecipients: jest
            .fn()
            .mockResolvedValue({ emails: opts.recipients }),
        };
  const service = new LowStockAlertsService(
    db,
    notifications as any,
    config as any,
    opts.gmail,
    recipientResolver as any,
  );
  return { service, updates, notifications };
}

/** The email object the service stamped, from the first update it issued. */
function stampedEmail(updates: Array<{ id: string; delivery_status: Row }>) {
  return updates[0]?.delivery_status?.email ?? null;
}

describe("LowStockAlertsService — delivery_status.email records the send", () => {
  it("gmail sent → ok: true, with a recipient COUNT and no addresses", async () => {
    const gmail = { sendLowStockDigest: jest.fn().mockResolvedValue({}) };
    const { service, updates } = build({
      gmail,
      recipients: ["a@x.com", "b@x.com"],
    });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    expect(gmail.sendLowStockDigest).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(2); // one per notification row
    const email = stampedEmail(updates);
    expect(email.ok).toBe(true);
    expect(email.error).toBeNull();
    expect(email.recipients).toBe(2);
    expect(email.mode).toBe("digest");
    expect(typeof email.attempted_at).toBe("string");
    // ADR 0040: the addresses must not be anywhere in what was written.
    expect(JSON.stringify(updates)).not.toContain("@x.com");
  });

  it("gmail threw → ok: false with the error text", async () => {
    const gmail = {
      sendLowStockDigest: jest
        .fn()
        .mockRejectedValue(new Error("invalid_grant")),
    };
    const { service, updates } = build({ gmail, recipients: ["a@x.com"] });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    const email = stampedEmail(updates);
    expect(email.ok).toBe(false);
    expect(email.error).toBe("invalid_grant");
    expect(email.recipients).toBe(1);
  });

  it("no Gmail service → ok: false, error 'gmail_not_configured' — recorded, not silent", async () => {
    const { service, updates } = build({
      gmail: undefined,
      recipients: ["a@x.com"],
    });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    const email = stampedEmail(updates);
    expect(email.ok).toBe(false);
    expect(email.error).toBe("gmail_not_configured");
    expect(email.recipients).toBe(0);
  });

  it("no recipients → ok: false, error 'no_recipients'", async () => {
    const gmail = { sendLowStockDigest: jest.fn() };
    const { service, updates } = build({ gmail, recipients: [] });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    expect(gmail.sendLowStockDigest).not.toHaveBeenCalled();
    const email = stampedEmail(updates);
    expect(email.ok).toBe(false);
    expect(email.error).toBe("no_recipients");
    expect(email.recipients).toBe(0);
  });

  it("merges into delivery_status rather than overwriting another channel's key", async () => {
    const gmail = { sendLowStockDigest: jest.fn().mockResolvedValue({}) };
    const { service, updates } = build({
      gmail,
      recipients: ["a@x.com"],
      existingDeliveryStatus: { push: { ok: true, devices: 3 } },
    });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    expect(updates[0].delivery_status.push).toEqual({ ok: true, devices: 3 });
    expect(updates[0].delivery_status.email.ok).toBe(true);
  });

  it("stamps nothing when persistForRestaurant returned no ids", async () => {
    const gmail = { sendLowStockDigest: jest.fn().mockResolvedValue({}) };
    const { service, updates, notifications } = build({
      gmail,
      recipients: ["a@x.com"],
    });
    // A deduped digest inserts nothing, so there is no row to stamp — and
    // inventing one would be worse than the gap.
    notifications.persistForRestaurant.mockResolvedValue({
      inserted: 0,
      ids: [],
    });

    await service.sendDigest("r-1", wines, "Nine Twenty");

    expect(updates).toHaveLength(0);
  });
});
