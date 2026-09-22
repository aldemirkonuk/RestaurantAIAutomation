import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { WeatherService } from "../weather/weather.service";
import { DayRecordService } from "./day-record.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { CalendarLinksService } from "./calendar-links.service";

/**
 * Who may act on which calendar link (ADR 0111, review trail 2026-09-21).
 *
 *  - Your OWN link — read, connect, get a new one, stop — is every member's,
 *    and the controller hands the service the caller's own id from the token,
 *    never an id from the request. Staff must pass: "Ayse connects HER OWN
 *    link to her phone".
 *  - SOMEONE ELSE's — the register of who has connected, and stopping a
 *    person's link — is an owner's or a manager's. Which of them may stop an
 *    OWNER's link (only an owner; the founder, round 6t: "No, owners only
 *    (Recommended)") is decided in the service on both roles, and tested both
 *    ways in `calendar-links.service.spec.ts`.
 *
 * Follows `settings/flag-writes-are-role-gated.spec.ts`'s shape — the real
 * `assertCanManageRestaurant` delegate with only the role READ stubbed, so the
 * rule under test is the actual gate and not a `jest.fn()` standing in for it.
 * Which person a link serves, and what it shows, is
 * `calendar-links.service.spec.ts`.
 */

const USER = {
  userId: "22222222-2222-4222-8222-222222222222",
  restaurantId: "r-1",
};
const TARGET = "33333333-3333-4333-8333-333333333333";

function req(): Request {
  return { headers: {}, protocol: "http" } as unknown as Request;
}

function controller(role: "owner" | "manager" | "staff" | null) {
  const links = {
    getMine: jest.fn().mockResolvedValue({ connected: false }),
    create: jest
      .fn()
      .mockResolvedValue({ link: { connected: true }, secret: "a".repeat(64) }),
    rotate: jest
      .fn()
      .mockResolvedValue({ link: { connected: true }, secret: "b".repeat(64) }),
    revokeMine: jest.fn().mockResolvedValue({ revoked: true }),
    setCategories: jest.fn().mockResolvedValue({ connected: true }),
    listHouse: jest.fn().mockResolvedValue([]),
    revokeFor: jest.fn().mockResolvedValue({ revoked: true }),
  };

  // The real assertion, not a stub of it — see the file header.
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);

  const c = new CalendarController(
    {} as unknown as CalendarService,
    { statusFor: jest.fn() } as unknown as CalendarRemindersService,
    { windowFor: jest.fn() } as unknown as WeatherService,
    { windowFor: jest.fn() } as unknown as DayRecordService,
    links as unknown as CalendarLinksService,
    organizations,
  );
  return { controller: c, links };
}

describe("your own link is every member's — staff included", () => {
  it("staff may read, connect, renew and stop their own, for themselves only", async () => {
    const { controller: c, links } = controller("staff");
    await c.getICalToken(USER);
    await c.createICalToken(USER, {}, req());
    await c.regenerateICalToken(USER, req());
    await c.revokeICalToken(USER);
    expect(links.getMine).toHaveBeenCalledWith("r-1", USER.userId);
    expect(links.create).toHaveBeenCalledWith("r-1", USER.userId, undefined);
    expect(links.rotate).toHaveBeenCalledWith("r-1", USER.userId);
    expect(links.revokeMine).toHaveBeenCalledWith("r-1", USER.userId);
  });
});

describe("GET /calendar/ical-links — the register is owner/manager only", () => {
  it.each(["owner", "manager"] as const)("%s may read it", async (role) => {
    const { controller: c, links } = controller(role);
    await expect(c.listICalLinks(USER)).resolves.toEqual([]);
    // The caller's own id goes with it: the register says, per row, whether
    // THIS caller may stop that link (owners manage owners, service spec).
    expect(links.listHouse).toHaveBeenCalledWith("r-1", USER.userId);
  });

  it.each(["staff", null] as const)(
    "%s is refused, and nothing is read",
    async (role) => {
      const { controller: c, links } = controller(role);
      await expect(c.listICalLinks(USER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(links.listHouse).not.toHaveBeenCalled();
    },
  );
});

describe("DELETE /calendar/ical-links/:userId — stopping someone's link is owner/manager only", () => {
  it.each(["owner", "manager"] as const)(
    "%s may stop it, and the actor is the caller",
    async (role) => {
      const { controller: c, links } = controller(role);
      await expect(c.revokeICalLinkFor(USER, TARGET)).resolves.toEqual({
        revoked: true,
      });
      expect(links.revokeFor).toHaveBeenCalledWith("r-1", USER.userId, TARGET);
    },
  );

  it.each(["staff", null] as const)(
    "%s is refused, and NOTHING is stopped",
    async (role) => {
      const { controller: c, links } = controller(role);
      await expect(c.revokeICalLinkFor(USER, TARGET)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(links.revokeFor).not.toHaveBeenCalled();
    },
  );

  it("the refusal names what was refused", async () => {
    const { controller: c } = controller("staff");
    await expect(c.revokeICalLinkFor(USER, TARGET)).rejects.toThrow(
      /stop someone else's calendar link/,
    );
  });
});
