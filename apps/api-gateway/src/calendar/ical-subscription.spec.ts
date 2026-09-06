import { Test, TestingModule } from "@nestjs/testing";
import type { Request, Response } from "express";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { WeatherService } from "../weather/weather.service";
import { DayRecordService } from "./day-record.service";
import { CalendarPushService } from "./push/calendar-push.service";

/**
 * The two subscribe suspects that live in the CONTROLLER, not the feed body
 * (ADR 0111 §5, calendar.md §12 item 1).
 *
 *  - `Content-Disposition: attachment` told every client to save a file. A
 *    saved .ics imports once and never updates, which is exactly the reported
 *    symptom: "the feed has never been seen to subscribe".
 *  - The token endpoint returned a RELATIVE path. No calendar client can
 *    subscribe to `/api/v1/calendar/feed/….ics`; there is nothing to resolve it
 *    against once the string leaves the browser.
 *
 * The third assertion here is the honesty one: with no configured origin and no
 * Host header there is no absolute URL, and the response says `none` rather
 * than inventing `https://localhost` and handing the operator a link that
 * silently never resolves.
 */

const USER = { userId: "u-1", restaurantId: "r-1" };
const TOKEN = "a".repeat(64);

function req(headers: Record<string, string | undefined>): Request {
  return { headers, protocol: "http" } as unknown as Request;
}

describe("iCal subscription — the controller half", () => {
  let controller: CalendarController;
  const calendar = {
    getICalFeed: jest.fn(),
    getOrGenerateICalToken: jest.fn(),
    regenerateICalToken: jest.fn(),
  };
  const savedPublicUrl = process.env.API_PUBLIC_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.API_PUBLIC_URL;
    calendar.getOrGenerateICalToken.mockResolvedValue(TOKEN);
    calendar.regenerateICalToken.mockResolvedValue(TOKEN);
    calendar.getICalFeed.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR");

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: calendar },
        {
          provide: CalendarRemindersService,
          useValue: { statusFor: jest.fn() },
        },
        {
          // The weather overlay is a constructor dependency of the controller
          // now (GET /calendar/weather). Its behaviour is specified in
          // weather/weather.service.spec.ts; here it only has to resolve.
          provide: WeatherService,
          useValue: { windowFor: jest.fn() },
        },
        {
          // Slice 3's reconciliation (GET /calendar/day-record). Specified in
          // calendar/day-record.spec.ts; here it only has to resolve.
          provide: DayRecordService,
          useValue: { windowFor: jest.fn() },
        },
        {
          // ADR 0111 direction 1 (GET /calendar/push). Specified in
          // calendar/push/*.spec.ts; here it only has to resolve.
          provide: CalendarPushService,
          useValue: { status: jest.fn(), push: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CalendarController);
  });

  afterAll(() => {
    if (savedPublicUrl === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = savedPublicUrl;
  });

  it("serves the feed inline, never as an attachment", async () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      send: jest.fn(),
    } as unknown as Response;

    await controller.getICalFeed(TOKEN, res);

    expect(headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
    expect(headers["Content-Disposition"]).toMatch(/^inline;/);
    expect(headers["Content-Disposition"]).not.toContain("attachment");
  });

  it("returns an absolute URL and a webcal:// form from the configured origin", async () => {
    process.env.API_PUBLIC_URL = "https://api.mudavym.com/";

    const out = await controller.getICalToken(USER, req({ host: "ignored" }));

    expect(out.token).toBe(TOKEN);
    expect(out.feedUrl).toBe(`/api/v1/calendar/feed/${TOKEN}.ics`);
    expect(out.absoluteFeedUrl).toBe(
      `https://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.webcalUrl).toBe(
      `webcal://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.originSource).toBe("config");
  });

  it("derives the origin from the request when nothing is configured", async () => {
    const out = await controller.getICalToken(
      USER,
      req({ host: "gateway.example:4000", "x-forwarded-proto": "https, http" }),
    );

    expect(out.absoluteFeedUrl).toBe(
      `https://gateway.example:4000/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.originSource).toBe("request");
  });

  it("says 'none' rather than inventing an origin it does not have", async () => {
    const out = await controller.getICalToken(USER, req({}));

    expect(out.absoluteFeedUrl).toBeNull();
    expect(out.webcalUrl).toBeNull();
    expect(out.originSource).toBe("none");
    // The relative path is still returned, because it is true.
    expect(out.feedUrl).toBe(`/api/v1/calendar/feed/${TOKEN}.ics`);
  });

  it("regenerating a token answers in the same shape", async () => {
    process.env.API_PUBLIC_URL = "https://api.mudavym.com";

    const out = await controller.regenerateICalToken(
      USER,
      req({ host: "ignored" }),
    );

    expect(out.absoluteFeedUrl).toBe(
      `https://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.webcalUrl?.startsWith("webcal://")).toBe(true);
    expect(calendar.regenerateICalToken).toHaveBeenCalledWith("r-1");
  });
});
