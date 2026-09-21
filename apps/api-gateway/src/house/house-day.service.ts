import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ReceivingService } from "../procurement/receiving.service";
import { CalendarService } from "../calendar/calendar.service";
import { OperatingHoursService } from "../restaurants/operating-hours.service";
import {
  OperatingHoursError,
  parseOperatingHours,
  serviceWindows,
  wallToInstant,
} from "../common/operating-hours/operating-hours";
import {
  DAY_REGISTERS,
  DayHours,
  DayRegister,
  DayRegisterKey,
  DayTick,
  HouseDayResponse,
} from "./house-day.types";

/** Same ceiling the counter uses (house-counter.service.ts) — a register that
 * has not answered in this long is not read. */
export const DAY_REGISTER_TIMEOUT_MS = 8_000;

class RegisterTimeout extends Error {
  constructor() {
    super("register timed out");
  }
}

interface Answer {
  ticks: DayTick[];
  count: number;
  complete: boolean;
}

const LABELS: Record<DayRegisterKey, string> = {
  deliveryArrived: "Deliveries that arrived",
  calendar: "Today's calendar",
  reminders: "Today's reminders",
};

/**
 * What a failed read is, in the counter's three words — the exact rule
 * `house-counter.service.ts`'s `outcomeOfFailure` uses, copied rather than
 * imported: the two services read genuinely different sources (this one has
 * no `HouseCounterService` dependency, so the day line can still answer if
 * the counter's own module were ever down) and the day line's registers
 * never emit `refused` today (none of the three is role-gated — the
 * comment on each `load()` below says why), so importing a fourth outcome
 * branch (`refused`, a 403's own sentence) for code this file cannot
 * exercise would be untested by construction.
 */
function outcomeOfFailure(
  err: unknown,
  label: string,
): { state: "unreadable"; status: number | null; sentence: string } {
  if (err instanceof RegisterTimeout) {
    return {
      state: "unreadable",
      status: null,
      sentence: `${label} did not answer within ${DAY_REGISTER_TIMEOUT_MS / 1000} s.`,
    };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    return {
      state: "unreadable",
      status,
      sentence: `${label} could not be read (${status}).`,
    };
  }
  return { state: "unreadable", status: 500, sentence: `${label} could not be read.` };
}

/** `YYYY-MM-DD` for `instant` as read in `tz` — `Intl`, not a locale trick:
 * built from `formatToParts` so the separators never depend on ICU's idea of
 * a locale's date order. */
function localDateParts(
  tz: string,
  instant: Date,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoDate(d: { year: number; month: number; day: number }): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function addDaysLocal(
  d: { year: number; month: number; day: number },
  delta: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

@Injectable()
export class HouseDayService {
  private readonly logger = new Logger(HouseDayService.name);

  constructor(
    private readonly receiving: ReceivingService,
    private readonly calendar: CalendarService,
    private readonly operatingHours: OperatingHoursService,
  ) {}

  /**
   * Read the day for `house` as `userId`. `house` comes from the token, never
   * a parameter (mirrors `HouseCounterService.read`).
   */
  async read(house: string, userId: string): Promise<HouseDayResponse> {
    if (!house) {
      throw new ForbiddenException("This session names no restaurant.");
    }

    const [hoursResult, timezone] = await this.readHoursAndTimezone(
      house,
      userId,
    );

    // ONE read of today's calendar events feeds BOTH the `calendar` and
    // `reminders` registers (sketch 119 §E: "both read the SAME calendar/today
    // call … only a second key in the aggregate's response") — so a failure
    // or a slow answer is shared between them, never one masking the other.
    const todayLocal = isoDate(localDateParts(timezone ?? "UTC", new Date()));
    const eventsPromise = this.calendar.listEvents(house, {
      startDate: todayLocal,
      endDate: todayLocal,
      includeRecurring: true,
      limit: 100,
    });

    const plans: Record<
      DayRegisterKey,
      () => Promise<Answer>
    > = {
      // The receiving routes carry no role gate (house-counter.service.ts's
      // own note) — every member reads this.
      deliveryArrived: async () => {
        const all = await this.receiving.listUnverified(house);
        const zone = timezone ?? "UTC";
        const { start, end } = this.todayWindow(zone);
        const today = all.filter((d) => {
          const t = new Date(d.countedAt).getTime();
          return t >= start.getTime() && t < end.getTime();
        });
        return {
          count: today.length,
          complete: true,
          ticks: today.map((d) => ({
            id: `delivery-${d.orderId}`,
            at: d.countedAt,
            label: d.orderNumber ? `Order ${d.orderNumber} — counted at the door` : "Counted at the door",
            href: `/orders?highlight=${d.orderId}`,
          })),
        };
      },
      // `calendar/today` carries only JwtAuthGuard (README, re-measured) —
      // every role reads the same events.
      calendar: async () => {
        const res = await eventsPromise;
        return this.ticksFromEvents(
          res.events.filter((e) => !this.isReminderType(e.eventType)),
          timezone ?? "UTC",
          !res.hasMore,
        );
      },
      // Same read as `calendar` — `getTodayEvents` applies no role filter
      // (`calendar.controller.ts`'s own comment on `getTodayEvents`).
      reminders: async () => {
        const res = await eventsPromise;
        return this.ticksFromEvents(
          res.events.filter((e) => this.isReminderType(e.eventType)),
          timezone ?? "UTC",
          !res.hasMore,
        );
      },
    };

    const registers = await Promise.all(
      DAY_REGISTERS.map((key) => this.readOne(key, plans[key])),
    );

    return {
      readAt: new Date().toISOString(),
      house: { id: house, timezone },
      hours: hoursResult,
      registers,
    };
  }

  private isReminderType(eventType: unknown): boolean {
    return eventType === "reminder" || eventType === "inventory_count";
  }

  private ticksFromEvents(
    events: Array<{
      id: string;
      title: string;
      eventDate: string;
      eventTime?: string;
      allDay: boolean;
    }>,
    tz: string,
    complete: boolean,
  ): Answer {
    // An event with no time is not a tick — "missing is not a time" (the
    // README's rule for an order with no delivery window, applied the same
    // way here).
    const timed = events.filter((e) => !e.allDay && e.eventTime);
    const ticks: DayTick[] = timed.map((e) => {
      const [y, m, d] = e.eventDate.split("-").map(Number);
      const [hh, mm] = (e.eventTime as string).split(":").map(Number);
      const at = wallToInstant(tz, y, m, d, hh, mm);
      return {
        id: e.id,
        at: at.toISOString(),
        label: e.title,
        href: `/calendar?event=${e.id}`,
      };
    });
    return { count: ticks.length, complete, ticks };
  }

  private todayWindow(tz: string): { start: Date; end: Date } {
    const today = localDateParts(tz, new Date());
    const tomorrow = addDaysLocal(today, 1);
    return {
      start: wallToInstant(tz, today.year, today.month, today.day, 0, 0),
      end: wallToInstant(tz, tomorrow.year, tomorrow.month, tomorrow.day, 0, 0),
    };
  }

  /**
   * The band's source. `timezone` travels out separately (the ticks need it
   * too) even on failure — `null` there degrades every tick to UTC-as-if-local
   * rather than crashing the whole read over a hours problem.
   */
  private async readHoursAndTimezone(
    house: string,
    userId: string,
  ): Promise<[DayHours, string | null]> {
    try {
      const res = await this.operatingHours.getOperatingHours(userId, house);
      if (res.timezone === null) {
        return [
          { state: "not_recorded", windows: [], sentence: "This house's timezone is not set." },
          null,
        ];
      }
      if (res.operatingHours === null) {
        return [
          { state: "not_recorded", windows: [], sentence: "Hours not set — no prep, doors or close today." },
          res.timezone,
        ];
      }
      const windows = this.windowsForToday(
        res.operatingHours,
        res.timezone,
      );
      return [{ state: "recorded", windows }, res.timezone];
    } catch (err) {
      this.logger.warn(
        `house day hours for ${house}: ${(err as Error)?.message ?? err}`,
      );
      return [{ state: "unreadable", windows: [], sentence: "Hours could not be read." }, null];
    }
  }

  /** Mirrors `isOpenAt`'s candidate-gathering (operating-hours.ts): a window
   * from YESTERDAY may cross midnight into today, so both days' windows are
   * gathered and then clipped to [start of today, start of tomorrow). */
  private windowsForToday(
    hours: unknown,
    tz: string,
  ): Array<{ startAt: string; endAt: string }> {
    let parsed;
    try {
      parsed = parseOperatingHours(hours);
    } catch (err) {
      if (err instanceof OperatingHoursError) return [];
      throw err;
    }
    const today = localDateParts(tz, new Date());
    const yesterday = addDaysLocal(today, -1);
    const { start: todayStart, end: tomorrowStart } = this.todayWindow(tz);

    const raw = [
      ...serviceWindows(parsed, tz, isoDate(yesterday)),
      ...serviceWindows(parsed, tz, isoDate(today)),
    ];
    const out: Array<{ startAt: string; endAt: string }> = [];
    for (const w of raw) {
      const clipStart = Math.max(w.start.getTime(), todayStart.getTime());
      const clipEnd = Math.min(w.end.getTime(), tomorrowStart.getTime());
      if (clipStart < clipEnd) {
        out.push({
          startAt: new Date(clipStart).toISOString(),
          endAt: new Date(clipEnd).toISOString(),
        });
      }
    }
    return out;
  }

  private async readOne(
    key: DayRegisterKey,
    load: () => Promise<Answer>,
  ): Promise<DayRegister> {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answer = await Promise.race([
        load(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RegisterTimeout()), DAY_REGISTER_TIMEOUT_MS);
        }),
      ]);
      return {
        key,
        state: "answered",
        readAt: new Date().toISOString(),
        ms: Date.now() - started,
        count: answer.count,
        complete: answer.complete,
        ticks: answer.ticks,
      };
    } catch (err) {
      const outcome = outcomeOfFailure(err, LABELS[key]);
      this.logger.warn(
        `day register ${key}: ${outcome.state} — ${(err as Error)?.message ?? String(err)}`,
      );
      return {
        key,
        readAt: new Date().toISOString(),
        ms: Date.now() - started,
        ...outcome,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
