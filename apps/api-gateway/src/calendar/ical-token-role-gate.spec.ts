import { ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { CalendarRemindersService } from "./calendar-reminders.service";
import { WeatherService } from "../weather/weather.service";
import { DayRecordService } from "./day-record.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * Who may create, rotate or revoke a calendar link (fixed 2026-09-21).
 *
 * `createICalToken`, `regenerateICalToken` and `revokeICalToken` mint, replace
 * or destroy an unauthenticated bearer credential for this restaurant's whole
 * calendar — legacy `Settings.tsx` reached the mint with no role gate at all,
 * which is half of the lane defect. `getICalToken` (the GET) stays open to any
 * signed-in member of the house: it only reads.
 *
 * Follows `settings/flag-writes-are-role-gated.spec.ts`'s shape — the real
 * `assertCanManageRestaurant` delegate, with only the role READ stubbed, so
 * the rule under test is the actual gate and not a `jest.fn()` standing in
 * for it.
 */

const USER = { userId: "22222222-2222-4222-8222-222222222222", restaurantId: "r-1" };

function req(): Request {
  return { headers: {}, protocol: "http" } as unknown as Request;
}

function controller(opts: {
  role?: "owner" | "manager" | "staff" | null;
  createICalToken?: jest.Mock;
  regenerateICalToken?: jest.Mock;
  revokeICalToken?: jest.Mock;
  getICalToken?: jest.Mock;
}) {
  const calendar = {
    getICalToken: opts.getICalToken ?? jest.fn().mockResolvedValue("tok"),
    createICalToken:
      opts.createICalToken ??
      jest.fn().mockResolvedValue({ token: "new-tok", created: true }),
    regenerateICalToken:
      opts.regenerateICalToken ?? jest.fn().mockResolvedValue("rotated-tok"),
    revokeICalToken:
      opts.revokeICalToken ?? jest.fn().mockResolvedValue({ revoked: true }),
  } as unknown as CalendarService;

  // The real assertion, not a stub of it — see the file header.
  const organizations = new OrganizationsService({} as never);
  jest
    .spyOn(organizations, "resolveRestaurantRole")
    .mockResolvedValue(opts.role ?? null);

  const c = new CalendarController(
    calendar,
    { statusFor: jest.fn() } as unknown as CalendarRemindersService,
    { windowFor: jest.fn() } as unknown as WeatherService,
    { windowFor: jest.fn() } as unknown as DayRecordService,
    organizations,
  );

  return { controller: c, calendar };
}

describe("GET /calendar/ical-token — reads for anyone signed in, gates nobody", () => {
  it.each(["owner", "manager", "staff"] as const)(
    "a %s can read the existing link",
    async (role) => {
      const { controller: c } = controller({ role });
      const out = await c.getICalToken(USER, req());
      expect(out.token).toBe("tok");
      expect(out.exists).toBe(true);
    },
  );

  it("no role at all can still read — reading is not the gated act", async () => {
    const { controller: c } = controller({ role: null });
    const out = await c.getICalToken(USER, req());
    expect(out.token).toBe("tok");
  });
});

describe("POST /calendar/ical-token — create is manager/owner only", () => {
  it("an OWNER may create the link", async () => {
    const { controller: c, calendar } = controller({ role: "owner" });
    await c.createICalToken(USER, req());
    expect(calendar.createICalToken).toHaveBeenCalledWith(
      USER.restaurantId,
      USER.userId,
    );
  });

  it("a MANAGER may create the link", async () => {
    const { controller: c, calendar } = controller({ role: "manager" });
    await c.createICalToken(USER, req());
    expect(calendar.createICalToken).toHaveBeenCalled();
  });

  it("STAFF is refused, and NOTHING is created", async () => {
    const { controller: c, calendar } = controller({ role: "staff" });
    await expect(c.createICalToken(USER, req())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calendar.createICalToken).not.toHaveBeenCalled();
  });

  it("an unresolvable role is refused — unknown is not permission", async () => {
    const { controller: c, calendar } = controller({ role: null });
    await expect(c.createICalToken(USER, req())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calendar.createICalToken).not.toHaveBeenCalled();
  });
});

describe("POST /calendar/ical-token/regenerate — rotate is manager/owner only", () => {
  it("a MANAGER may rotate", async () => {
    const { controller: c, calendar } = controller({ role: "manager" });
    await c.regenerateICalToken(USER, req());
    expect(calendar.regenerateICalToken).toHaveBeenCalledWith(
      USER.restaurantId,
      USER.userId,
    );
  });

  it("STAFF is refused, and NOTHING is rotated", async () => {
    const { controller: c, calendar } = controller({ role: "staff" });
    await expect(c.regenerateICalToken(USER, req())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calendar.regenerateICalToken).not.toHaveBeenCalled();
  });
});

describe("DELETE /calendar/ical-token — revoke is manager/owner only", () => {
  it("an OWNER may revoke", async () => {
    const { controller: c, calendar } = controller({ role: "owner" });
    const out = await c.revokeICalToken(USER);
    expect(out).toEqual({ revoked: true });
    expect(calendar.revokeICalToken).toHaveBeenCalledWith(
      USER.restaurantId,
      USER.userId,
    );
  });

  it("STAFF is refused, and NOTHING is revoked", async () => {
    const { controller: c, calendar } = controller({ role: "staff" });
    await expect(c.revokeICalToken(USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(calendar.revokeICalToken).not.toHaveBeenCalled();
  });

  it("the refusal names what was refused", async () => {
    const { controller: c } = controller({ role: "staff" });
    await expect(c.revokeICalToken(USER)).rejects.toThrow(
      /Only managers and owners can revoke the calendar link for this restaurant/,
    );
  });
});
