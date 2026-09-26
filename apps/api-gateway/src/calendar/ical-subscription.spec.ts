import { Test, TestingModule } from "@nestjs/testing";
import type { Request, Response } from "express";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { WeatherService } from "../weather/weather.service";
import { DayRecordService } from "./day-record.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  CalendarLinksService,
  FeedUnavailableError,
} from "./calendar-links.service";

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
 *
 * Since 2026-09-21 the link is personal and its secret is shown ONCE, on the
 * answer to the act that made it (ADR 0111 review trail): the URL shape is
 * asserted on create and on a new link, and a failed read answers 503 so the
 * subscriber keeps its last good copy.
 */

const USER = { userId: "u-1", restaurantId: "r-1" };
const TOKEN = "a".repeat(64);

function req(headers: Record<string, string | undefined>): Request {
  return { headers, protocol: "http" } as unknown as Request;
}

const MINE = {
  connected: true,
  createdAt: "2026-09-21T12:00:00.000Z",
  issuedAt: "2026-09-21T12:00:00.000Z",
  lastFetchedAt: null,
  role: "staff" as const,
  scope: "Your link shows your own shifts.",
  categories: null,
  canPickCategories: false,
  areasModelled: false,
  houseLinkRetired: false,
};

describe("iCal subscription — the controller half", () => {
  let controller: CalendarController;
  const links = {
    renderFor: jest.fn(),
    getMine: jest.fn(),
    create: jest.fn(),
    rotate: jest.fn(),
  };
  const savedPublicUrl = process.env.API_PUBLIC_URL;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.API_PUBLIC_URL;
    links.getMine.mockResolvedValue(MINE);
    links.create.mockResolvedValue({ link: MINE, secret: TOKEN });
    links.rotate.mockResolvedValue({ link: MINE, secret: TOKEN });
    links.renderFor.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR");

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CalendarController],
      providers: [
        { provide: CalendarService, useValue: {} },
        { provide: CalendarLinksService, useValue: links },
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
          // The owner/manager gate on someone else's link. Who may pass it is
          // `calendar-links.gate.spec.ts`'s job.
          provide: OrganizationsService,
          useValue: { assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined) },
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

  function fakeRes() {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      send: jest.fn(),
    };
    return { res, headers };
  }

  it("serves the feed inline, never as an attachment", async () => {
    const { res, headers } = fakeRes();

    await controller.getICalFeed(TOKEN, res as unknown as Response);

    expect(headers["Content-Type"]).toBe("text/calendar; charset=utf-8");
    expect(headers["Content-Disposition"]).toMatch(/^inline;/);
    expect(headers["Content-Disposition"]).not.toContain("attachment");
  });

  it("a failed read answers 503 with Retry-After — never a calendar, empty or expired", async () => {
    links.renderFor.mockRejectedValueOnce(new FeedUnavailableError("db down"));
    const { res, headers } = fakeRes();

    await controller.getICalFeed(TOKEN, res as unknown as Response);

    expect(res.statusCode).toBe(503);
    expect(headers["Retry-After"]).toBe("300");
    expect(headers["Content-Type"]).not.toContain("text/calendar");
    expect(String(res.send.mock.calls[0][0])).not.toContain("VCALENDAR");
  });

  it("returns an absolute URL and a webcal:// form from the configured origin", async () => {
    process.env.API_PUBLIC_URL = "https://api.mudavym.com/";

    const out = await controller.createICalToken(USER, {}, req({ host: "ignored" }));

    expect(out.issued?.feedUrl).toBe(`/api/v1/calendar/feed/${TOKEN}.ics`);
    expect(out.issued?.absoluteFeedUrl).toBe(
      `https://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.issued?.webcalUrl).toBe(
      `webcal://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.issued?.originSource).toBe("config");
  });

  it("derives the origin from the request when nothing is configured", async () => {
    const out = await controller.createICalToken(
      USER,
      {},
      req({ host: "gateway.example:4000", "x-forwarded-proto": "https, http" }),
    );

    expect(out.issued?.absoluteFeedUrl).toBe(
      `https://gateway.example:4000/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.issued?.originSource).toBe("request");
  });

  it("says 'none' rather than inventing an origin it does not have", async () => {
    const out = await controller.createICalToken(USER, {}, req({}));

    expect(out.issued?.absoluteFeedUrl).toBeNull();
    expect(out.issued?.webcalUrl).toBeNull();
    expect(out.issued?.originSource).toBe("none");
    // The relative path is still returned, because it is true.
    expect(out.issued?.feedUrl).toBe(`/api/v1/calendar/feed/${TOKEN}.ics`);
  });

  it("a create that found a link already made carries no address", async () => {
    links.create.mockResolvedValueOnce({ link: MINE, secret: null });
    const out = await controller.createICalToken(USER, {}, req({ host: "h" }));
    expect(out.issued).toBeNull();
    expect(out.connected).toBe(true);
  });

  it("the read never carries an address", async () => {
    const out = await controller.getICalToken(USER);
    expect(out).not.toHaveProperty("issued");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it("a new link answers in the same shape, for the caller's own house and self", async () => {
    process.env.API_PUBLIC_URL = "https://api.mudavym.com";

    const out = await controller.regenerateICalToken(USER, req({ host: "ignored" }));

    expect(out.issued?.absoluteFeedUrl).toBe(
      `https://api.mudavym.com/api/v1/calendar/feed/${TOKEN}.ics`,
    );
    expect(out.issued?.webcalUrl?.startsWith("webcal://")).toBe(true);
    expect(links.rotate).toHaveBeenCalledWith("r-1", USER.userId);
  });
});
