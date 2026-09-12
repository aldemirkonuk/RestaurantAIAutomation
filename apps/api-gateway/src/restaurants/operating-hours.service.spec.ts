import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { MembersService } from "./members.service";
import { OperatingHoursService } from "./operating-hours.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * `GET`/`PUT /restaurants/:id/operating-hours` (ADR 0093 D1).
 *
 * The four properties worth a test are all about a value that could be faked:
 * an unknown hours column reading back as unknown rather than as closed; a
 * failed read reading as a failure rather than as unknown (ADR 0067); a bad
 * body coming back with EVERY fault rather than the first; and the write being
 * shut to anyone who is not an owner or a manager of THAT restaurant.
 */

const RID = "restaurant-1";
const OTHER_RID = "restaurant-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const OUTSIDER = "user-outsider";

const BISTRO = {
  mon: [],
  tue: [{ open: "12:00", close: "23:00" }],
  wed: [{ open: "12:00", close: "23:00" }],
  thu: [{ open: "12:00", close: "23:00" }],
  fri: [{ open: "12:00", close: "23:30" }],
  sat: [{ open: "12:00", close: "23:30" }],
  sun: [{ open: "12:00", close: "22:00" }],
};

function seed(overrides: Record<string, unknown> = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a1",
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        is_active: true,
      },
      {
        id: "a2",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a3",
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
      {
        id: "a4",
        user_id: OUTSIDER,
        restaurant_id: OTHER_RID,
        role: "owner",
        is_active: true,
      },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner" },
      { user_id: MANAGER, restaurant_id: RID, role: "manager" },
      { user_id: STAFF, restaurant_id: RID, role: "staff" },
      { user_id: OUTSIDER, restaurant_id: OTHER_RID, role: "owner" },
    ],
    restaurants: [
      {
        id: RID,
        timezone: "America/Chicago",
        operating_hours: null,
        updated_at: "2026-09-02T00:00:00.000Z",
        ...overrides,
      },
      {
        id: OTHER_RID,
        timezone: "Europe/Istanbul",
        operating_hours: null,
        updated_at: "2026-09-02T00:00:00.000Z",
      },
    ],
  });
}

function service(db: StubDb): OperatingHoursService {
  const svc = new OperatingHoursService(
    asDatabaseService(db),
    new MembersService(asDatabaseService(db)),
  );
  jest.spyOn((svc as any).logger, "error").mockImplementation(() => undefined);
  return svc;
}

describe("OperatingHoursService — null round-trip", () => {
  it("an unset column reads back as null, not {} and not an all-closed week", async () => {
    const res = await service(seed()).getOperatingHours(OWNER, RID);
    expect(res.operatingHours).toBeNull();
    expect(res.timezone).toBe("America/Chicago");
    expect(res.restaurantId).toBe(RID);
    // The three facts that must stay distinct: unknown, empty object, closed
    // all week. Rendering the first as either of the other two is the ADR 0020
    // fabrication this endpoint exists to refuse.
    expect(res.operatingHours).not.toEqual({});
  });

  it("writing null stores null and reads back null", async () => {
    const db = seed({ operating_hours: BISTRO });
    const svc = service(db);
    expect((await svc.getOperatingHours(OWNER, RID)).operatingHours).toEqual(
      BISTRO,
    );

    const after = await svc.putOperatingHours(OWNER, RID, null);
    expect(after.operatingHours).toBeNull();
    expect(db.tables.restaurants[0].operating_hours).toBeNull();
    expect((await svc.getOperatingHours(OWNER, RID)).operatingHours).toBeNull();
  });

  it("writing hours round-trips them exactly", async () => {
    const db = seed();
    const res = await service(db).putOperatingHours(OWNER, RID, BISTRO);
    expect(res.operatingHours).toEqual(BISTRO);
    expect(db.tables.restaurants[0].operating_hours).toEqual(BISTRO);
    // Only the addressed restaurant moved.
    expect(db.tables.restaurants[1].operating_hours).toBeNull();
  });

  it("a stored value that does not parse is reported as invalid, not as unset", async () => {
    // Otherwise corrupt hours and never-set hours arrive identically and the
    // editor shows "Hours not set" over data that IS set and IS wrong.
    const res = await service(
      seed({ operating_hours: { mon: [] } }),
    ).getOperatingHours(OWNER, RID);
    expect(res.operatingHours).toBeNull();
    expect(res.storedHoursErrors).toBeDefined();
    expect(res.storedHoursErrors!.join(" ")).toContain("missing keys");
  });
});

describe("OperatingHoursService — an invalid body is refused with every fault", () => {
  it("400 carrying errors[], not the first error only", async () => {
    const svc = service(seed());
    let caught: BadRequestException | null = null;
    try {
      await svc.putOperatingHours(OWNER, RID, {
        mon: [{ open: "12:00", close: "25:00" }],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
        hol: [],
      });
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = caught!.getResponse() as { message: string; errors: string[] };
    expect(body.message).toBe("operating_hours invalid");
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.errors.join("\n")).toContain("unknown keys: hol");
    expect(body.errors.join("\n")).toContain("not HH:MM");
  });

  it("an invalid body writes nothing", async () => {
    const db = seed({ operating_hours: BISTRO });
    await expect(
      service(db).putOperatingHours(OWNER, RID, "12:00-23:00"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.restaurants[0].operating_hours).toEqual(BISTRO);
    expect(db.opsOn("restaurants", "update")).toHaveLength(0);
  });

  it("a body with no operatingHours key is refused, not read as null", async () => {
    const db = seed({ operating_hours: BISTRO });
    await expect(
      service(db).putOperatingHours(OWNER, RID, undefined, { explicit: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.restaurants[0].operating_hours).toEqual(BISTRO);
  });
});

describe("OperatingHoursService — only an owner or manager of THAT restaurant writes", () => {
  it("an owner may write", async () => {
    await expect(
      service(seed()).putOperatingHours(OWNER, RID, BISTRO),
    ).resolves.toBeDefined();
  });

  it("a manager may write", async () => {
    await expect(
      service(seed()).putOperatingHours(MANAGER, RID, BISTRO),
    ).resolves.toBeDefined();
  });

  it("staff get 403 and write nothing", async () => {
    const db = seed();
    await expect(
      service(db).putOperatingHours(STAFF, RID, BISTRO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.restaurants[0].operating_hours).toBeNull();
  });

  it("an owner of ANOTHER restaurant gets 403", async () => {
    const db = seed();
    await expect(
      service(db).putOperatingHours(OUTSIDER, RID, BISTRO),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.restaurants[0].operating_hours).toBeNull();
  });

  it("a non-member cannot even read", async () => {
    await expect(
      service(seed()).getOperatingHours("nobody", RID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("staff may read — the gate is on the write", async () => {
    await expect(
      service(seed()).getOperatingHours(STAFF, RID),
    ).resolves.toEqual(expect.objectContaining({ operatingHours: null }));
  });
});

describe("OperatingHoursService — a failed read is never an empty one (ADR 0067)", () => {
  it("a failed SELECT throws rather than answering `hours not set`", async () => {
    const db = seed();
    db.errors["restaurants:select"] = { message: "statement timeout" };
    await expect(
      service(db).getOperatingHours(OWNER, RID),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("a failed UPDATE throws rather than reporting a save", async () => {
    const db = seed();
    db.errors["restaurants:update"] = { message: "statement timeout" };
    await expect(
      service(db).putOperatingHours(OWNER, RID, BISTRO),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("a genuinely missing restaurant is a 404, not a 500", async () => {
    // The paired case. Without it the fix trades a silent failure for a
    // permanent false alarm, which reports nothing just as effectively.
    const db = seed();
    db.tables.user_restaurant_access.push({
      id: "a9",
      user_id: OWNER,
      restaurant_id: "ghost",
      role: "owner",
      is_active: true,
    });
    await expect(
      service(db).getOperatingHours(OWNER, "ghost"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
