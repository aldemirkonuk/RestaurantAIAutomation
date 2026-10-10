import { ConflictException, HttpStatus } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TeamService } from "./team/team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./team/testing/supabase-stub";
import {
  CreateCoverageTemplateDto,
  UpdateCertDto,
  UpdateTeamMemberDto,
} from "./team/dto/team.dto";
import { CreateProviderDto, UpdateProviderDto } from "./providers/dto/providers.dto";
import { CalendarService } from "./calendar/calendar.service";
import { CalendarController } from "./calendar/calendar.controller";

/**
 * The forms tell the truth about what they save (sim wave 25, lane
 * form-truth): what the gateway accepts and refuses, and that a refusal the
 * person can fix reaches them in words.
 *
 * F-713 an edit sends an emptied box as `null`; the gateway must accept it
 *       and write the column as none (a cert's expiry included).
 * F-715 a vendor's minimum order is a whole amount of zero or more.
 * F-717 a custom calendar type with a name already on file is a 409 in
 *       words, not the database's text under a 500.
 * F-718 a coverage rule asks for at least one person, and the same role,
 *       day and service twice is refused in words.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";

function seed(): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
    ],
    users: [{ user_id: MANAGER, restaurant_id: RID, role: "manager", name: "Moe" }],
    team_members: [
      {
        id: "m1",
        restaurant_id: RID,
        user_id: null,
        display_name: "Ayşe",
        email: "ayse@tuzlu.com.tr",
        phone: "0532",
        position: "Server",
        home_location: "Kadıköy",
        notes: "old",
        hourly_wage: null,
      },
    ],
    team_certifications: [
      {
        id: "c1",
        restaurant_id: RID,
        member_id: "m1",
        cert_type: "food-handler",
        issued_at: "2025-08-01",
        expires_at: "2026-08-20",
        status: "expired",
      },
    ],
    coverage_templates: [
      { id: "t1", restaurant_id: RID, role: "Bar", day_of_week: 5, shift_period: "pm", min_staff: 2 },
    ],
    team_settings: [],
    system_audit_log: [],
    notifications: [],
  });
}

const service = (db: StubDb) => new TeamService(asDatabaseService(db));

async function errorsOf<T extends object>(cls: new () => T, body: object) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe("F-713 — an emptied field on an edit is cleared, not kept", () => {
  it("lets null through the member and cert DTOs", async () => {
    expect(
      await errorsOf(UpdateTeamMemberDto, {
        email: null,
        phone: null,
        position: null,
        homeLocation: null,
        hourlyWage: null,
        notes: null,
      }),
    ).toEqual([]);
    expect(await errorsOf(UpdateCertDto, { issuedAt: null, expiresAt: null })).toEqual([]);
  });

  it("writes the member's emptied fields as none", async () => {
    const db = seed();
    await service(db).updateMember(MANAGER, RID, "m1", {
      email: null,
      phone: null,
      position: null,
      homeLocation: null,
      notes: null,
    });
    expect(db.tables.team_members[0]).toMatchObject({
      email: null,
      phone: null,
      position: null,
      home_location: null,
      notes: null,
    });
  });

  it("takes a wrong expiry off a certificate, and it is no longer expired", async () => {
    const db = seed();
    await service(db).updateCert(MANAGER, RID, "c1", { expiresAt: null });
    expect(db.tables.team_certifications[0]).toMatchObject({
      expires_at: null,
      status: "valid",
    });
  });
});

describe("F-718 — a coverage rule asks for someone, once", () => {
  it("refuses a rule for no one, and a fraction of a person", async () => {
    const base = { shiftPeriod: "pm", role: "Floor" };
    expect(await errorsOf(CreateCoverageTemplateDto, { ...base, minStaff: 0 })).toEqual(["minStaff"]);
    expect(await errorsOf(CreateCoverageTemplateDto, { ...base, minStaff: 2.5 })).toEqual(["minStaff"]);
    expect(await errorsOf(CreateCoverageTemplateDto, { ...base, minStaff: 1 })).toEqual([]);
  });

  it("refuses the same role, day and service twice, in words, and writes nothing", async () => {
    const db = seed();
    const refused = service(db).createCoverageTemplate(MANAGER, RID, {
      role: " bar ",
      dayOfWeek: 5,
      shiftPeriod: "pm",
      minStaff: 3,
    });
    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toThrow(/already on file, asking for 2 Bar/);
    expect(db.tables.coverage_templates).toHaveLength(1);
  });

  it("adds the same role on another day or service", async () => {
    const db = seed();
    await service(db).createCoverageTemplate(MANAGER, RID, {
      role: "Bar",
      dayOfWeek: 6,
      shiftPeriod: "pm",
      minStaff: 2,
    });
    await service(db).createCoverageTemplate(MANAGER, RID, {
      role: "Bar",
      shiftPeriod: "pm",
      minStaff: 1,
    });
    expect(db.tables.coverage_templates).toHaveLength(3);
  });
});

describe("F-715 — a vendor's minimum order is a whole amount, never below zero", () => {
  it("refuses a negative minimum order on add and on edit", async () => {
    expect(await errorsOf(UpdateProviderDto, { minimumOrder: -500 })).toEqual(["minimumOrder"]);
    const add = await errorsOf(CreateProviderDto, { minimumOrder: -500 });
    expect(add).toContain("minimumOrder");
    expect(await errorsOf(UpdateProviderDto, { minimumOrder: 0 })).toEqual([]);
  });
});

describe("F-717 — a custom type name already on the calendar", () => {
  const dto = { restaurantId: "r1", name: "Tasting", color: "#1A5E6B", icon: "tag" };

  function calendarService(error: { code: string; message: string }) {
    const single = jest.fn().mockResolvedValue({ data: null, error });
    const db = { supabase: { from: () => ({ insert: () => ({ select: () => ({ single }) }) }) } };
    return new CalendarService(db as never, {} as never);
  }

  it("the service words the UNIQUE (restaurant_id, name) violation as a 409", async () => {
    const refused = calendarService({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }).createEventType(dto);
    await expect(refused).rejects.toBeInstanceOf(ConflictException);
    await expect(refused).rejects.toThrow(/A type called "Tasting" is already on this calendar/);
  });

  it("the controller passes the 409 through, and still wraps other faults as a 500", async () => {
    const user = { userId: "u1", restaurantId: "r1" };
    const taken = Object.create(CalendarController.prototype) as CalendarController;
    Object.assign(taken, {
      calendarService: calendarService({ code: "23505", message: "dup" }),
      logger: { error: jest.fn() },
    });
    await expect(taken.createEventType(dto, user)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });

    const broken = Object.create(CalendarController.prototype) as CalendarController;
    Object.assign(broken, {
      calendarService: calendarService({ code: "08006", message: "connection lost" }),
      logger: { error: jest.fn() },
    });
    await expect(broken.createEventType(dto, user)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });
});
