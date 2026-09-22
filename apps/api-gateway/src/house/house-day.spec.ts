import { ForbiddenException } from "@nestjs/common";
import { HouseDayService, DAY_REGISTER_TIMEOUT_MS } from "./house-day.service";
import { wallToInstant } from "../common/operating-hours/operating-hours";
import type { DayRegister, DayRegisterKey, HouseDayResponse } from "./house-day.types";

/**
 * The day line's one read (sketch 119 §E; the founder's pick of 2026-09-21;
 * built as a PAGE element, not chrome). `HouseDayService` is real; what it
 * reads through — `ReceivingService`, `CalendarService`,
 * `OperatingHoursService` — is faked, the same seam `house-counter.spec.ts`
 * uses for the counter.
 *
 * Every case below is a way the day line could lie:
 *
 *   1. print a delivery from yesterday as if it happened today;
 *   2. print a calendar/reminder tick for an event with no time — "missing
 *      is not a time";
 *   3. let one hung source hold the whole line hostage;
 *   4. print the database's own error text;
 *   5. draw a tick after the hours read failed as if the hours were known;
 *   6. lose the tail of a service window that crosses local midnight, either
 *      direction (yesterday INTO today, today PAST tomorrow).
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TZ = "America/Chicago";
const NOW = "2026-09-21T12:00:00.000Z"; // 07:00 CDT — mid-morning, no boundary ambiguity

function sources(over: Partial<Record<string, jest.Mock>> = {}) {
  return {
    receiving: {
      // `HouseDayService` passes the house-local today window straight
      // through to `arrivedToday`, which does the date-range filtering — so
      // this fake, unlike `listUnverified`'s old one, returns only what a
      // real scoped read for that window would: no yesterday row to drop.
      arrivedToday:
        over.arrivedToday ??
        jest.fn(async () => ({
          rows: [
            {
              orderId: "o-today",
              orderNumber: "ORD-1",
              countedAt: "2026-09-21T16:00:00.000Z", // 11:00 CDT today
            },
          ],
          capped: false,
        })),
    },
    calendar: {
      listEvents:
        over.listEvents ??
        jest.fn(async () => ({
          events: [
            {
              id: "e-meeting",
              title: "Kermit Lynch tasting",
              eventType: "tasting",
              eventDate: "2026-09-21",
              eventTime: "14:00",
              allDay: false,
            },
            {
              id: "e-reminder",
              title: "Count due at close",
              eventType: "inventory_count",
              eventDate: "2026-09-21",
              eventTime: "22:00",
              allDay: false,
            },
            {
              id: "e-allday",
              title: "Holiday",
              eventType: "holiday",
              eventDate: "2026-09-21",
              eventTime: undefined,
              allDay: true,
            },
          ],
          total: 3,
          page: 1,
          limit: 100,
          hasMore: false,
        })),
    },
    operatingHours: {
      getOperatingHours:
        over.getOperatingHours ??
        jest.fn(async () => ({
          restaurantId: HOUSE,
          timezone: TZ,
          operatingHours: {
            mon: [{ open: "11:00", close: "23:00" }],
            tue: [{ open: "11:00", close: "23:00" }],
            wed: [{ open: "11:00", close: "23:00" }],
            thu: [{ open: "11:00", close: "23:00" }],
            fri: [{ open: "11:00", close: "23:00" }],
            sat: [{ open: "11:00", close: "23:00" }],
            sun: [{ open: "11:00", close: "23:00" }],
          },
          updatedAt: "2026-09-01T00:00:00.000Z",
        })),
    },
  };
}

function build(src = sources()) {
  const svc = new HouseDayService(
    src.receiving as any,
    src.calendar as any,
    src.operatingHours as any,
  );
  return { svc, src };
}

function reg(res: HouseDayResponse, key: DayRegisterKey): DayRegister {
  const r = res.registers.find((x) => x.key === key);
  if (!r) throw new Error(`no register ${key}`);
  return r;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(() => {
  jest.useRealTimers();
});

describe("no house names no session", () => {
  it("refuses before reading anything", async () => {
    const { svc } = build();
    await expect(svc.read("", USER)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("deliveryArrived — today only, and counts what its label says", () => {
  it("draws a tick straight from arrivedToday's rows, house-local window and all", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER);
    const r = reg(res, "deliveryArrived");
    expect(r.state).toBe("answered");
    if (r.state !== "answered") throw new Error("unreachable");
    expect(r.count).toBe(1);
    expect(r.ticks).toEqual([
      {
        id: "delivery-o-today",
        at: "2026-09-21T16:00:00.000Z",
        label: "Order ORD-1 — counted at the door",
        href: "/orders?highlight=o-today",
      },
    ]);
  });

  it("passes arrivedToday the house-local (not UTC) day window", async () => {
    const arrivedToday = jest.fn(async () => ({ rows: [], capped: false }));
    const { svc } = build(sources({ arrivedToday }));
    await svc.read(HOUSE, USER);
    expect(arrivedToday).toHaveBeenCalledWith(
      HOUSE,
      // Midnight-to-midnight for 2026-09-21 in the house's OWN zone, as
      // instants — proves the window is computed in local time, not sliced
      // at UTC midnight.
      wallToInstant(TZ, 2026, 9, 21, 0, 0),
      wallToInstant(TZ, 2026, 9, 22, 0, 0),
    );
  });

  it("still counts a delivery that was ALSO bottle-verified today — arrived is not the same as unverified", async () => {
    // The bug this fixes: the register used to read `listUnverified`, which
    // drops an order the moment it is bottle-counted or reconciled — so a
    // delivery checked the same day it arrived vanished from "Deliveries
    // that arrived". `arrivedToday` carries no verified/unverified
    // distinction at all (receiving.spec.ts pins that at the source); this
    // test pins that the day line does not re-introduce a filter on top of
    // whatever `arrivedToday` hands back.
    const { svc } = build(
      sources({
        arrivedToday: jest.fn(async () => ({
          rows: [
            {
              orderId: "o-checked-same-day",
              orderNumber: "ORD-2",
              countedAt: "2026-09-21T15:00:00.000Z",
            },
          ],
          capped: false,
        })),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    const r = reg(res, "deliveryArrived");
    expect(r.state).toBe("answered");
    if (r.state !== "answered") throw new Error("unreachable");
    expect(r.count).toBe(1);
    expect(r.ticks[0].id).toBe("delivery-o-checked-same-day");
  });

  it("an empty house has an answered, empty register — not a refusal", async () => {
    const { svc } = build(
      sources({ arrivedToday: jest.fn(async () => ({ rows: [], capped: false })) }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(reg(res, "deliveryArrived")).toMatchObject({
      state: "answered",
      count: 0,
      complete: true,
    });
  });

  it("is a floor, not a total, when the day's read lands on its page cap", async () => {
    // The same rule the counter's `deliveries` register follows: a read that
    // stopped at its page size did not finish, so `complete` must say so. The
    // day line used to print a literal `complete: true` here.
    const { svc } = build(
      sources({
        arrivedToday: jest.fn(async () => ({
          rows: [
            {
              orderId: "o-today",
              orderNumber: "ORD-1",
              countedAt: "2026-09-21T16:00:00.000Z",
            },
          ],
          capped: true,
        })),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(reg(res, "deliveryArrived")).toMatchObject({
      state: "answered",
      count: 1,
      complete: false,
    });
  });
});

describe("calendar and reminders — one read, two keys", () => {
  it("splits by event type; the same underlying read serves both", async () => {
    const { svc, src } = build();
    const res = await svc.read(HOUSE, USER);

    expect(reg(res, "calendar")).toMatchObject({
      state: "answered",
      count: 1,
      ticks: [{ id: "e-meeting", label: "Kermit Lynch tasting" }],
    });
    expect(reg(res, "reminders")).toMatchObject({
      state: "answered",
      count: 1,
      ticks: [{ id: "e-reminder", label: "Count due at close" }],
    });
    // One call, not two — "no new endpoint, only a second key" (README).
    expect(src.calendar.listEvents).toHaveBeenCalledTimes(1);
  });

  it("an all-day event gets no tick — missing is not a time", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER);
    const all = [...(reg(res, "calendar") as any).ticks, ...(reg(res, "reminders") as any).ticks];
    expect(all.some((t: { id: string }) => t.id === "e-allday")).toBe(false);
  });

  it("a tick's instant is computed from the event's local time in the house's zone", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER);
    const tick = (reg(res, "calendar") as any).ticks[0];
    expect(tick.at).toBe(wallToInstant(TZ, 2026, 9, 21, 14, 0).toISOString());
  });

  it("the calendar source's own DB error text never reaches the response", async () => {
    const { svc } = build(
      sources({
        listEvents: jest.fn(async () => {
          throw new Error("canceling statement due to statement timeout");
        }),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(reg(res, "calendar")).toMatchObject({ state: "unreadable", status: 500 });
    expect(reg(res, "reminders")).toMatchObject({ state: "unreadable", status: 500 });
    expect(JSON.stringify(res)).not.toContain("statement timeout");
  });

  it("a source that hangs is unreadable after the timeout; it does not hold the line", async () => {
    const { svc } = build(
      sources({ listEvents: jest.fn(() => new Promise<never>(() => undefined)) }),
    );
    const pending = svc.read(HOUSE, USER);
    await jest.advanceTimersByTimeAsync(DAY_REGISTER_TIMEOUT_MS + 1);
    const res = await pending;
    expect(reg(res, "calendar")).toMatchObject({ state: "unreadable", status: null });
    expect(reg(res, "reminders")).toMatchObject({ state: "unreadable", status: null });
    // A register that hung did not hold the ONE that answered fine.
    expect(reg(res, "deliveryArrived").state).toBe("answered");
  });
});

describe("hours — the band, never a register in the N-of-3", () => {
  it("clips a window that crosses local midnight, both directions", async () => {
    const { svc } = build(
      sources({
        getOperatingHours: jest.fn(async () => ({
          restaurantId: HOUSE,
          timezone: TZ,
          // Every day the same overnight window (weekday-independent, so
          // this test does not need to know what day NOW falls on).
          operatingHours: {
            mon: [{ open: "22:00", close: "02:00" }],
            tue: [{ open: "22:00", close: "02:00" }],
            wed: [{ open: "22:00", close: "02:00" }],
            thu: [{ open: "22:00", close: "02:00" }],
            fri: [{ open: "22:00", close: "02:00" }],
            sat: [{ open: "22:00", close: "02:00" }],
            sun: [{ open: "22:00", close: "02:00" }],
          },
          updatedAt: null,
        })),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(res.hours.state).toBe("recorded");
    expect(res.hours.windows).toEqual([
      {
        // Yesterday's overnight window, clipped at the start of today.
        startAt: wallToInstant(TZ, 2026, 9, 21, 0, 0).toISOString(),
        endAt: wallToInstant(TZ, 2026, 9, 21, 2, 0).toISOString(),
      },
      {
        // Today's own overnight window, clipped at the start of tomorrow.
        startAt: wallToInstant(TZ, 2026, 9, 21, 22, 0).toISOString(),
        endAt: wallToInstant(TZ, 2026, 9, 22, 0, 0).toISOString(),
      },
    ]);
  });

  it("hours not set: not_recorded, in words, and the ticks still draw (registers are independent)", async () => {
    const { svc } = build(
      sources({
        getOperatingHours: jest.fn(async () => ({
          restaurantId: HOUSE,
          timezone: TZ,
          operatingHours: null,
          updatedAt: null,
        })),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(res.hours).toMatchObject({ state: "not_recorded", windows: [] });
    expect(res.hours.sentence).toMatch(/hours not set/i);
    // The registers do not depend on hours at all.
    expect(reg(res, "calendar").state).toBe("answered");
  });

  it("timezone not set: not_recorded, and every tick still computes (falls back to UTC, never crashes)", async () => {
    const { svc } = build(
      sources({
        getOperatingHours: jest.fn(async () => ({
          restaurantId: HOUSE,
          timezone: null,
          operatingHours: null,
          updatedAt: null,
        })),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(res.hours.state).toBe("not_recorded");
    expect(res.house.timezone).toBeNull();
    expect(reg(res, "calendar").state).toBe("answered");
  });

  it("a failed hours read is unreadable, never printed as not_recorded", async () => {
    const { svc } = build(
      sources({
        getOperatingHours: jest.fn(async () => {
          throw new Error("connection reset");
        }),
      }),
    );
    const res = await svc.read(HOUSE, USER);
    expect(res.hours.state).toBe("unreadable");
    expect(JSON.stringify(res)).not.toContain("connection reset");
  });
});

/**
 * "Count what's built" — the founder, 2026-09-21, on the day line. The read
 * returns exactly the three registers this build reads, in order, and nothing
 * for the sketch's other three: no `not_built` row, no market, no shifts, no
 * deliveries-expected. The web head counts out of what comes back, so this is
 * what makes it "N of 3".
 */
describe("count what's built", () => {
  it("returns exactly the three built registers, and no placeholder", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER);
    expect(res.registers.map((r) => r.key)).toEqual([
      "deliveryArrived",
      "calendar",
      "reminders",
    ]);
    for (const r of res.registers) {
      expect(["answered", "refused", "unreadable"]).toContain(r.state);
    }
    const body = JSON.stringify(res);
    expect(body).not.toMatch(/not_built|"market"|"shifts"|"deliveryExpected"/);
  });
});

describe("no total, ever", () => {
  it("the response has no top-level count/total field", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER);
    expect(res).not.toHaveProperty("total");
    expect(res).not.toHaveProperty("count");
  });
});
