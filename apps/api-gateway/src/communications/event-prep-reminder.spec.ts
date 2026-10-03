import { ScheduledTasksService } from "./scheduled-tasks.service";
import {
  EVENT_PREP_REMINDER_FLAG,
  eventPrepRemindersEnabled,
} from "./event-prep-reminder";
import { recurringRemindersEnabled } from "./recurring-order-reminder";

/**
 * Event-prep reminder — F-154, ADR 0131's 2026-10-02 amendment.
 *
 * `event-prep-check` mailed one email per `calendar_events` row two days out,
 * deliveries included, through the shared Gmail sender, with no arming flag.
 * It is now off unless EVENT_PREP_REMINDERS_ENABLED arms it. The test that
 * matters most is negative: while the flag is off, the job does not enumerate
 * a house, read a row, resolve a recipient or send a mail. The positive test
 * proves arming really gives the job back, so the flag is not a silent kill.
 */

/** A delivery row as the calendar holds one: a calendar row like any other. */
const DELIVERY_ROW = {
  id: "cal-1",
  restaurant_id: "tenant-b",
  title: "Delivery — Kumdere",
  event_type: "delivery",
  event_date: "2026-10-09T10:00:00",
};

/**
 * An event in the plain sense. The armed test uses this one, not the delivery:
 * which entry types the job should mail is an open founder question, and this
 * PR pins only that arming gives the job back, not what it mails.
 */
const EVENT_ROW = {
  id: "cal-2",
  restaurant_id: "tenant-b",
  title: "Wine dinner",
  event_type: "wine_dinner",
  event_date: "2026-10-09T19:00:00",
  guest_count: 40,
};

function makeHarness(opts: { flag?: string; events?: any[] }) {
  const queriedTables: string[] = [];
  const rowsByTable: Record<string, any[]> = {
    calendar_events: opts.events ?? [],
  };

  const makeQuery = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const q: any = {};
    const self = () => q;
    q.select = jest.fn(self);
    q.eq = jest.fn(self);
    q.in = jest.fn(self);
    q.lte = jest.fn(self);
    q.gte = jest.fn(self);
    q.order = jest.fn(self);
    // Thenable so `await client.from(x).select(y).eq(...)` resolves whatever
    // the chain ends in.
    q.then = (res: any, rej: any) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej);
    return q;
  };

  const client = {
    from: jest.fn((table: string) => {
      queriedTables.push(table);
      return makeQuery(table);
    }),
  };

  const tenant = {
    id: "tenant-b",
    name: "Tenant B",
    isLegacyDefault: false,
  };

  const resolveRecipients = jest.fn(async () => ({
    emails: ["manager@tenant-b.test"],
    phones: [],
  }));
  const sendEventPrepReminder = jest.fn(async () => ({ success: true }));
  const runPerTenant = jest.fn(async (_name: string, fn: any) => {
    await fn(tenant);
  });

  const cfg: Record<string, string | undefined> = {};
  if (opts.flag !== undefined) cfg[EVENT_PREP_REMINDER_FLAG] = opts.flag;

  const service = new ScheduledTasksService(
    { get: jest.fn((k: string) => cfg[k]) } as any,
    {} as any,
    { getClient: () => client } as any,
    { sendEventPrepReminder } as any,
    { resolveRecipients } as any,
    { runPerTenant } as any,
  );

  return {
    service,
    client,
    queriedTables,
    resolveRecipients,
    sendEventPrepReminder,
    runPerTenant,
  };
}

describe("eventPrepRemindersEnabled — off unless explicitly armed", () => {
  const OFF = [
    undefined,
    null,
    "",
    "   ",
    "false",
    "FALSE",
    "0",
    "no",
    "off",
    "yes",
    "on",
    "enabled",
    "ture",
    "true!",
    "2",
  ];
  const ON = ["true", "TRUE", " True ", " true ", "1", " 1 "];

  it.each(OFF)("reads %p as OFF", (raw) => {
    expect(eventPrepRemindersEnabled(raw as any)).toBe(false);
  });

  it.each(ON)("reads %p as ON", (raw) => {
    expect(eventPrepRemindersEnabled(raw)).toBe(true);
  });

  it("reads a non-string as OFF", () => {
    expect(eventPrepRemindersEnabled(1 as any)).toBe(false);
    expect(eventPrepRemindersEnabled(true as any)).toBe(false);
  });

  it("accepts exactly what RECURRING_ORDER_REMINDERS_ENABLED accepts", () => {
    // Not a parse of its own: one house rule for every arming flag, so the
    // founder sets each switch the same way.
    for (const raw of [...OFF, ...ON]) {
      expect(eventPrepRemindersEnabled(raw as any)).toBe(
        recurringRemindersEnabled(raw as any),
      );
    }
  });

  it("is its own variable, not another job's", () => {
    expect(EVENT_PREP_REMINDER_FLAG).toBe("EVENT_PREP_REMINDERS_ENABLED");
  });
});

describe("sendEventPrepReminders", () => {
  beforeEach(() => {
    delete process.env[EVENT_PREP_REMINDER_FLAG];
  });

  afterAll(() => {
    delete process.env[EVENT_PREP_REMINDER_FLAG];
  });

  it("sends nothing — and does not even look — while the flag is off", async () => {
    const h = makeHarness({ events: [DELIVERY_ROW] });

    await h.service.sendEventPrepReminders();

    expect(h.runPerTenant).not.toHaveBeenCalled();
    expect(h.client.from).not.toHaveBeenCalled();
    expect(h.queriedTables).toEqual([]);
    expect(h.resolveRecipients).not.toHaveBeenCalled();
    expect(h.sendEventPrepReminder).not.toHaveBeenCalled();
  });

  it("stays off for a flag value that is not exactly true/1", async () => {
    const h = makeHarness({ flag: "yes", events: [DELIVERY_ROW] });

    await h.service.sendEventPrepReminders();

    expect(h.runPerTenant).not.toHaveBeenCalled();
    expect(h.sendEventPrepReminder).not.toHaveBeenCalled();
  });

  it("the manual trigger hits the same guard", async () => {
    const h = makeHarness({ events: [DELIVERY_ROW] });

    await h.service.triggerEventPrepReminders();

    expect(h.runPerTenant).not.toHaveBeenCalled();
    expect(h.client.from).not.toHaveBeenCalled();
    expect(h.sendEventPrepReminder).not.toHaveBeenCalled();
  });

  it("reads the flag from process.env when ConfigService has none", async () => {
    process.env[EVENT_PREP_REMINDER_FLAG] = "true";
    const h = makeHarness({ events: [EVENT_ROW] });

    await h.service.sendEventPrepReminders();

    expect(h.runPerTenant).toHaveBeenCalledTimes(1);
    expect(h.sendEventPrepReminder).toHaveBeenCalledTimes(1);
  });

  it("armed, the job runs as before: it reads the day's rows and mails one", async () => {
    const h = makeHarness({ flag: "true", events: [EVENT_ROW] });

    await h.service.sendEventPrepReminders();

    expect(h.runPerTenant).toHaveBeenCalledWith(
      "event-prep-check",
      expect.any(Function),
    );
    expect(h.queriedTables).toEqual(["calendar_events"]);
    expect(h.resolveRecipients).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "tenant-b",
        roles: ["manager", "staff"],
        channels: ["email"],
        allowDefaultFallback: false,
      }),
    );
    expect(h.sendEventPrepReminder).toHaveBeenCalledTimes(1);
    expect(h.sendEventPrepReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["manager@tenant-b.test"],
        restaurantName: "Tenant B",
        eventName: "Wine dinner",
        eventType: "wine_dinner",
        guestCount: 40,
      }),
    );
  });
});
