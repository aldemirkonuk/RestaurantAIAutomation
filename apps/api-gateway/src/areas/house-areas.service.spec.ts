/**
 * Areas, lead marks and Away through the real service over an in-memory
 * Supabase that applies its filters (ADR 0218). Role gates, the house scope,
 * the house log and the KVKK minimum are each asserted on what was WRITTEN.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { asDatabaseService, makeStubDb, type StubDb } from "../team/testing/supabase-stub";
import { HouseAreasService, mayChangeAway, type HouseActor } from "./house-areas.service";
import { actorOf } from "./house-areas.controller";
import { houseLocalDay } from "./area-routing";

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OTHER_HOUSE = "22222222-2222-2222-2222-222222222222";
const OWNER = "aaaaaaaa-0000-0000-0000-000000000001";
const STAFF = "aaaaaaaa-0000-0000-0000-000000000002";
const COLLEAGUE = "aaaaaaaa-0000-0000-0000-000000000003";
const STRANGER = "aaaaaaaa-0000-0000-0000-000000000009";
const MANAGER = "aaaaaaaa-0000-0000-0000-000000000004";
const CO_OWNER = "aaaaaaaa-0000-0000-0000-000000000005";
// An owner known only through the legacy `users` row (no active access row).
// ADR 0164 ("Membership only"): that person is not a member of the house at
// all, so no one else changes their Away here (PR #441 audit at 6f036c90f).
const LEGACY_OWNER = "aaaaaaaa-0000-0000-0000-000000000006";
const M_STAFF = "bbbbbbbb-0000-0000-0000-000000000002";
const M_COLLEAGUE = "bbbbbbbb-0000-0000-0000-000000000003";
const M_ELSEWHERE = "bbbbbbbb-0000-0000-0000-000000000009";

const owner: HouseActor = { userId: OWNER, restaurantId: HOUSE, role: "owner", name: "Deniz" };
const staff: HouseActor = { userId: STAFF, restaurantId: HOUSE, role: "staff", name: "Ayşe" };
const manager: HouseActor = { userId: MANAGER, restaurantId: HOUSE, role: "manager", name: "Selin" };

const TODAY = houseLocalDay(new Date(), "UTC");
const plus = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function seed(extra: Partial<Record<string, any[]>> = {}): StubDb {
  return makeStubDb({
    restaurants: [
      { id: HOUSE, timezone: "UTC" },
      { id: OTHER_HOUSE, timezone: "UTC" },
    ],
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true },
      { user_id: COLLEAGUE, restaurant_id: HOUSE, role: "staff", is_active: true },
      { user_id: STRANGER, restaurant_id: OTHER_HOUSE, role: "staff", is_active: true },
      { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true },
      { user_id: CO_OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
    ],
    users: [
      { user_id: OWNER, name: "Deniz", restaurant_id: HOUSE },
      { user_id: STAFF, name: "Ayşe", restaurant_id: HOUSE },
      { user_id: COLLEAGUE, name: "Mert", restaurant_id: HOUSE },
      { user_id: STRANGER, name: "Kim", restaurant_id: OTHER_HOUSE },
      { user_id: MANAGER, name: "Selin", restaurant_id: HOUSE, role: "manager" },
      { user_id: CO_OWNER, name: "Cem", restaurant_id: HOUSE, role: "owner" },
      { user_id: LEGACY_OWNER, name: "Nur", restaurant_id: HOUSE, role: "owner" },
    ],
    team_members: [
      { id: M_STAFF, restaurant_id: HOUSE, user_id: STAFF, display_name: "Ayşe", hourly_wage: 21 },
      { id: M_COLLEAGUE, restaurant_id: HOUSE, user_id: COLLEAGUE, display_name: "Mert", hourly_wage: 19 },
      { id: M_ELSEWHERE, restaurant_id: OTHER_HOUSE, user_id: STRANGER, display_name: "Kim" },
    ],
    house_areas: [],
    house_area_members: [],
    house_away: [],
    system_audit_log: [],
    notifications: [],
    ...extra,
  });
}

function service(db: StubDb) {
  return new HouseAreasService(asDatabaseService(db));
}

describe("who may change areas", () => {
  it("refuses staff on every area, membership and lead write, and writes nothing", async () => {
    const db = seed();
    const svc = service(db);
    await expect(svc.setArea(staff, "bar", { name: "Pass" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.setMembership(staff, "bar", M_STAFF, { lead: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.removeMembership(staff, "bar", M_STAFF)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.house_areas).toEqual([]);
    expect(db.tables.house_area_members).toEqual([]);
    expect(db.tables.system_audit_log).toEqual([]);
  });

  it("will not put another house's roster row into this house's area", async () => {
    const db = seed();
    await expect(
      service(db).setMembership(owner, "bar", M_ELSEWHERE, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.house_area_members).toEqual([]);
  });

  it("refuses an area kind outside the six", async () => {
    await expect(service(seed()).setArea(owner, "dish", { name: "Dish" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("renaming and switching an area", () => {
  it("stores the house's name and files one log row with before and after, by the public.users id", async () => {
    const db = seed();
    const out = await service(db).setArea(owner, "kitchen", { name: "Garde manger", enabled: false });
    expect(out.area).toEqual({ kind: "kitchen", name: "Garde manger", enabled: false });
    expect(db.tables.house_areas).toHaveLength(1);
    expect(db.tables.house_areas[0]).toMatchObject({
      restaurant_id: HOUSE,
      kind: "kitchen",
      name: "Garde manger",
      enabled: false,
      updated_by: OWNER,
    });
    expect(db.tables.system_audit_log).toHaveLength(1);
    expect(db.tables.system_audit_log[0]).toMatchObject({
      actor_id: OWNER,
      restaurant_id: HOUSE,
      action: "house_area_changed",
      entity_type: "house_area",
      changes: {
        fields: {
          name: { from: "Kitchen", to: "Garde manger" },
          enabled: { from: true, to: false },
        },
      },
    });
    expect(out.receipt).toEqual({ audited: true, notified: false });
  });

  it("writes nothing and logs nothing for a change that changes nothing", async () => {
    const db = seed();
    const out = await service(db).setArea(owner, "bar", { name: "Bar", enabled: true });
    expect(out.changed).toBe(false);
    expect(db.tables.house_areas).toEqual([]);
    expect(db.tables.system_audit_log).toEqual([]);
  });

  it("refuses a blank name", async () => {
    await expect(service(seed()).setArea(owner, "bar", { name: "   " })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("membership and the lead mark", () => {
  it("adds a person to an area and logs it; granting the lead logs a second row and tells the person", async () => {
    const db = seed();
    const svc = service(db);
    await svc.setMembership(owner, "bar", M_STAFF, {});
    expect(db.tables.house_area_members).toHaveLength(1);
    expect(db.tables.house_area_members[0]).toMatchObject({
      restaurant_id: HOUSE,
      member_id: M_STAFF,
      kind: "bar",
      is_lead: false,
      created_by: OWNER,
    });
    expect(db.tables.system_audit_log.map((r) => r.action)).toEqual(["area_member_added"]);

    const out = await svc.setMembership(owner, "bar", M_STAFF, { lead: true });
    expect(out.membership.lead).toBe(true);
    expect(db.tables.house_area_members[0].is_lead).toBe(true);
    expect(db.tables.system_audit_log.map((r) => r.action)).toEqual([
      "area_member_added",
      "area_lead_granted",
    ]);
    expect(db.tables.system_audit_log[1]).toMatchObject({
      actor_id: OWNER,
      entity_id: M_STAFF,
      changes: { fields: { lead: { from: false, to: true } } },
    });
    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0]).toMatchObject({ user_id: STAFF, restaurant_id: HOUSE });
    expect(db.tables.notifications[0].title).toMatch(/lead Bar/);
  });

  it("the lead mark changes no house role, no wage and no roster row", async () => {
    const db = seed();
    await service(db).setMembership(owner, "bar", M_STAFF, { lead: true });
    expect(db.opsOn("user_restaurant_access").filter((o) => o.op !== "select")).toEqual([]);
    expect(db.opsOn("team_members").filter((o) => o.op !== "select")).toEqual([]);
    expect(db.tables.user_restaurant_access.find((r) => r.user_id === STAFF)?.role).toBe("staff");
  });

  it("removing a lead from the area logs the lead going with it", async () => {
    const db = seed({
      house_area_members: [
        { id: "hm1", restaurant_id: HOUSE, member_id: M_STAFF, kind: "bar", is_lead: true },
      ],
    });
    await service(db).removeMembership(owner, "bar", M_STAFF);
    expect(db.tables.house_area_members).toEqual([]);
    expect(db.tables.system_audit_log[0]).toMatchObject({
      action: "area_member_removed",
      changes: { fields: { area: { from: "bar", to: null }, lead: { from: true, to: false } } },
    });
  });
});

describe("what the areas readout shows", () => {
  const rows = [
    { id: "hm1", restaurant_id: HOUSE, member_id: M_STAFF, kind: "bar", is_lead: true },
    { id: "hm2", restaurant_id: HOUSE, member_id: M_COLLEAGUE, kind: "kitchen", is_lead: false },
    { id: "hm3", restaurant_id: OTHER_HOUSE, member_id: M_ELSEWHERE, kind: "bar", is_lead: false },
  ];

  it("gives owners every membership in THIS house only", async () => {
    const out = await service(seed({ house_area_members: rows })).readout(owner);
    expect(out.canManage).toBe(true);
    expect(out.inUse).toBe(true);
    expect(out.memberships.map((m) => m.memberId).sort()).toEqual([M_COLLEAGUE, M_STAFF].sort());
    expect(out.areas.find((a) => a.kind === "bar")).toMatchObject({ members: 1, leads: 1 });
  });

  it("gives staff their own areas and lead marks, and nobody else's", async () => {
    const out = await service(seed({ house_area_members: rows })).readout(staff);
    expect(out.canManage).toBe(false);
    expect(out.memberships.map((m) => m.memberId)).toEqual([M_STAFF]);
    expect(out.mine).toEqual({ memberId: M_STAFF, areas: ["bar"], leadOf: ["bar"] });
  });

  it("drops a switched-off area from what a person leads", async () => {
    const out = await service(
      seed({
        house_area_members: rows,
        house_areas: [{ restaurant_id: HOUSE, kind: "bar", name: "Bar", enabled: false }],
      }),
    ).readout(staff);
    expect(out.mine.leadOf).toEqual([]);
    expect(out.inUse).toBe(true); // the kitchen membership is still on
  });

  it("answers 503 when a register does not answer — never an empty house", async () => {
    const db = seed({ house_area_members: rows });
    db.errors["house_area_members:select"] = { message: "boom" };
    await expect(service(db).readout(owner)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("Away", () => {
  it("lets a person set their own dates, dates only, and files nothing in the house log", async () => {
    const db = seed();
    const out = await service(db).setAway(staff, STAFF, { from: TODAY, until: plus(7) });
    expect(out.receipt).toBeNull();
    expect(out.window).toMatchObject({ userId: STAFF, activeNow: true, setBySelf: true });
    expect(db.tables.house_away).toHaveLength(1);
    // KVKK: the row is the house, the person, two dates and who set them.
    expect(Object.keys(db.tables.house_away[0]).sort()).toEqual(
      ["away_from", "away_until", "created_at", "id", "restaurant_id", "set_by", "user_id"].sort(),
    );
    expect(db.tables.system_audit_log).toEqual([]);
    expect(db.opsOn("time_off_requests")).toEqual([]);
  });

  it("refuses staff setting or ending a colleague's Away", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: COLLEAGUE, away_from: TODAY, away_until: plus(2) }],
    });
    const svc = service(db);
    await expect(svc.setAway(staff, COLLEAGUE, { from: TODAY, until: plus(3) })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.endAway(staff, COLLEAGUE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.house_away).toHaveLength(1);
  });

  it("logs an owner setting someone's Away, and tells the person", async () => {
    const db = seed();
    const out = await service(db).setAway(owner, COLLEAGUE, { from: plus(1), until: plus(4) });
    expect(out.receipt).toEqual({ audited: true, notified: true });
    expect(db.tables.system_audit_log[0]).toMatchObject({
      actor_id: OWNER,
      action: "away_set_for_member",
      entity_type: "restaurant_member",
      entity_id: COLLEAGUE,
      changes: { fields: { away: { from: null, to: `${plus(1)} to ${plus(4)}` } } },
    });
    expect(db.tables.notifications[0]).toMatchObject({ user_id: COLLEAGUE });
  });

  it("will not set Away for someone outside this house", async () => {
    const db = seed();
    await expect(
      service(db).setAway(owner, STRANGER, { from: TODAY, until: plus(1) }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.tables.house_away).toEqual([]);
  });

  it("refuses dates that run backwards, are over, or span more than a year", async () => {
    const svc = service(seed());
    for (const body of [
      { from: plus(3), until: plus(1) },
      { from: plus(-5), until: plus(-1) },
      { from: TODAY, until: plus(400) },
      { from: "2026-02-30", until: "2026-03-02" },
    ]) {
      await expect(svc.setAway(staff, STAFF, body)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("ends Away early: the person's own end is quiet, an owner's end is logged", async () => {
    const db = seed({
      house_away: [
        { restaurant_id: HOUSE, user_id: STAFF, away_from: TODAY, away_until: plus(5) },
        { restaurant_id: HOUSE, user_id: COLLEAGUE, away_from: TODAY, away_until: plus(5) },
      ],
    });
    const svc = service(db);
    expect((await svc.endAway(staff, STAFF)).receipt).toBeNull();
    expect(db.tables.system_audit_log).toEqual([]);
    const byOwner = await svc.endAway(owner, COLLEAGUE);
    expect(byOwner.receipt?.audited).toBe(true);
    expect(db.tables.system_audit_log[0].action).toBe("away_ended_for_member");
    expect(db.tables.house_away).toEqual([]);
  });

  it("lists every current-or-upcoming window for owners/managers; staff never learn who set a colleague's", async () => {
    const db = seed({
      house_away: [
        { restaurant_id: HOUSE, user_id: STAFF, away_from: plus(2), away_until: plus(5), set_by: STAFF },
        { restaurant_id: HOUSE, user_id: COLLEAGUE, away_from: plus(2), away_until: plus(5), set_by: OWNER },
        { restaurant_id: HOUSE, user_id: MANAGER, away_from: TODAY, away_until: plus(1), set_by: MANAGER },
        { restaurant_id: HOUSE, user_id: OWNER, away_from: plus(-9), away_until: plus(-2), set_by: OWNER },
        { restaurant_id: OTHER_HOUSE, user_id: STRANGER, away_from: TODAY, away_until: plus(1), set_by: STRANGER },
      ],
    });
    // MANAGER needs a roster row to be named on the marker, same as any
    // other colleague (the base seed only names STAFF and COLLEAGUE).
    db.tables.team_members.push({
      id: "bbbbbbbb-0000-0000-0000-000000000004",
      restaurant_id: HOUSE,
      user_id: MANAGER,
      display_name: "Selin",
    });
    const svc = service(db);
    const forOwner = await svc.listAway(owner);
    // Owners and managers still see every window that has not ended, upcoming
    // ones included — round-3 answer 3 (2026-09-22) changes nothing for them.
    expect(forOwner.windows.map((w) => w.userId).sort()).toEqual([COLLEAGUE, MANAGER, STAFF].sort());
    expect(forOwner.windows.find((w) => w.userId === COLLEAGUE)).toMatchObject({
      activeNow: false,
      setBySelf: false,
    });

    // Round-3 answer 3 (2026-09-22, the founder's "Only once under way"):
    // staff meet a COLLEAGUE'S Away only once it is under way. COLLEAGUE's
    // window has not started yet, so staff do not see it at all — not even
    // dates.
    const forStaff = await svc.listAway(staff);
    expect(forStaff.role).toBe("staff");
    expect(forStaff.windows.map((w) => w.userId).sort()).toEqual([MANAGER, STAFF].sort());
    expect(forStaff.windows.find((w) => w.userId === COLLEAGUE)).toBeUndefined();

    // A colleague's window staff DO meet, because it is under way today.
    const colleague = forStaff.windows.find((w) => w.userId === MANAGER)!;
    expect(Object.keys(colleague).sort()).toEqual(["activeNow", "from", "name", "until", "userId"]);
    expect(colleague).toEqual({
      userId: MANAGER,
      from: TODAY,
      until: plus(1),
      activeNow: true,
      name: "Selin",
    });
    expect(forStaff.namesReadable).toBe(true);
    // Round-2 answer 5, unchanged by round 3: a staff reader still sees their
    // OWN window whichever way it runs — upcoming here — and it still says
    // who set it. This is a rule about a COLLEAGUE'S Away, not the reader's.
    expect(forStaff.windows.find((w) => w.userId === STAFF)).toMatchObject({
      activeNow: false,
      setBySelf: true,
    });
  });

  it("names a colleague from this house's roster only, and says so when the names cannot be read", async () => {
    const away = [
      { restaurant_id: HOUSE, user_id: COLLEAGUE, away_from: TODAY, away_until: plus(3), set_by: COLLEAGUE },
      { restaurant_id: HOUSE, user_id: MANAGER, away_from: TODAY, away_until: plus(3), set_by: MANAGER },
    ];
    // MANAGER has a roster row only in ANOTHER house: that name is not this house's.
    const elsewhere = {
      id: "bbbbbbbb-0000-0000-0000-000000000004",
      restaurant_id: OTHER_HOUSE,
      user_id: MANAGER,
      display_name: "Selin at the other house",
    };
    const db = seed({ house_away: away });
    db.tables.team_members.push(elsewhere);
    const out = await service(db).listAway(staff);
    expect(out.windows.find((w) => w.userId === COLLEAGUE)!.name).toBe("Mert");
    expect(out.windows.find((w) => w.userId === MANAGER)!.name).toBeNull();
    expect(out.namesReadable).toBe(true);

    const broken = seed({ house_away: away });
    broken.errors["team_members:select"] = { message: "boom" };
    const failed = await service(broken).listAway(staff);
    // The dates are still answered; the names are unknown, and it says so.
    expect(failed.windows).toHaveLength(2);
    expect(failed.namesReadable).toBe(false);
    expect(failed.windows.every((w) => w.name === null)).toBe(true);
  });

  it("accepts a window of exactly 366 days and refuses 367", async () => {
    const svc = service(seed());
    await expect(svc.setAway(staff, STAFF, { from: TODAY, until: plus(365) })).resolves.toBeTruthy();
    await expect(
      svc.setAway(staff, STAFF, { from: TODAY, until: plus(366) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("only an owner sets or ends an owner's Away (round-2 answer 7)", () => {
  const ownerAway = (userId: string) => ({
    restaurant_id: HOUSE,
    user_id: userId,
    away_from: TODAY,
    away_until: plus(3),
    set_by: userId,
  });

  it("is the whole matrix: self always; owners anyone; managers anyone but an owner; staff nobody else", () => {
    const who = (role: "owner" | "manager" | "staff") => ({ userId: `actor-${role}`, role });
    const target = (role: string | null) => ({ userId: "target", role });
    expect(mayChangeAway(who("staff"), { userId: "actor-staff", role: "staff" })).toBe(true);
    expect(mayChangeAway(who("manager"), { userId: "actor-manager", role: "manager" })).toBe(true);
    for (const t of ["owner", "Owner", "manager", "staff", null]) {
      expect(mayChangeAway(who("owner"), target(t))).toBe(true);
      expect(mayChangeAway(who("staff"), target(t))).toBe(false);
    }
    expect(mayChangeAway(who("manager"), target("owner"))).toBe(false);
    expect(mayChangeAway(who("manager"), target("OWNER"))).toBe(false);
    expect(mayChangeAway(who("manager"), target("manager"))).toBe(true);
    expect(mayChangeAway(who("manager"), target("staff"))).toBe(true);
    expect(mayChangeAway(who("manager"), target(null))).toBe(true);
  });

  it("refuses a manager setting an owner's Away, and writes and logs nothing", async () => {
    const db = seed();
    const err = await service(db)
      .setAway(manager, OWNER, { from: TODAY, until: plus(3) })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe("Only an owner can set or end an owner's Away dates.");
    expect(db.tables.house_away).toEqual([]);
    expect(db.tables.system_audit_log).toEqual([]);
    expect(db.tables.notifications).toEqual([]);
  });

  it("refuses a manager ending an owner's Away, and the dates stay", async () => {
    const db = seed({ house_away: [ownerAway(OWNER)] });
    await expect(service(db).endAway(manager, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.house_away).toHaveLength(1);
    expect(db.tables.system_audit_log).toEqual([]);
  });

  // ADR 0164 ("Membership only", 2026-09-18): an active `user_restaurant_access`
  // row is the only thing that makes a person a member of a house. A person
  // known only by the legacy `users.restaurant_id` pointer is therefore not a
  // member, and neither a manager nor an owner changes their Away. Until the
  // PR #441 audit (6f036c90f) that pointer still made them a member here while
  // `roleInHouse` gave them no role, so a manager could set or end the Away of
  // such an owner — against round-2 answer 7.
  it("refuses anyone changing the Away of a person known only by the legacy users row", async () => {
    for (const actor of [manager, owner]) {
      const db = seed({ house_away: [ownerAway(LEGACY_OWNER)] });
      const svc = service(db);
      await expect(
        svc.setAway(actor, LEGACY_OWNER, { from: TODAY, until: plus(2) }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.endAway(actor, LEGACY_OWNER)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.tables.house_away).toEqual([ownerAway(LEGACY_OWNER)]);
      expect(db.tables.system_audit_log).toEqual([]);
      expect(db.tables.notifications).toEqual([]);
    }
  });

  it("lets another owner set and end an owner's Away, logged", async () => {
    const db = seed();
    const svc = service(db);
    const out = await svc.setAway(owner, CO_OWNER, { from: TODAY, until: plus(2) });
    expect(out.receipt).toEqual({ audited: true, notified: true });
    const ended = await svc.endAway(owner, CO_OWNER);
    expect(ended.receipt?.audited).toBe(true);
    expect(db.tables.system_audit_log.map((r: any) => r.action)).toEqual([
      "away_set_for_member",
      "away_ended_for_member",
    ]);
  });

  it("still lets a manager set and end a staff member's or another manager's Away", async () => {
    const db = seed();
    const svc = service(db);
    await expect(svc.setAway(manager, COLLEAGUE, { from: TODAY, until: plus(2) })).resolves.toBeTruthy();
    await expect(svc.endAway(manager, COLLEAGUE)).resolves.toMatchObject({ ended: true });
  });

  it("lets a manager and an owner set their own", async () => {
    const svc = service(seed());
    await expect(svc.setAway(manager, MANAGER, { from: TODAY, until: plus(1) })).resolves.toBeTruthy();
    await expect(svc.setAway(owner, OWNER, { from: TODAY, until: plus(1) })).resolves.toBeTruthy();
  });

  it("answers 503 when the owner's role cannot be read — never a guess that lets a manager in", async () => {
    const db = seed({ house_away: [ownerAway(OWNER)] });
    db.errors["user_restaurant_access:select"] = { message: "boom" };
    await expect(service(db).endAway(manager, OWNER)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.tables.house_away).toHaveLength(1);
  });
});

describe("a change to Away releases what waited (round-2 answer 3)", () => {
  function withRelease(db: StubDb) {
    const release = { releaseFor: jest.fn(async () => ({})) } as any;
    return { svc: new HouseAreasService(asDatabaseService(db), release), release };
  }

  it("releases on End Away now, for that person in this house", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: STAFF, away_from: TODAY, away_until: plus(5) }],
    });
    const { svc, release } = withRelease(db);
    await svc.endAway(staff, STAFF);
    expect(release.releaseFor).toHaveBeenCalledWith(HOUSE, STAFF);
  });

  it("releases when the dates move off today, and not while today is still inside them", async () => {
    const db = seed();
    const { svc, release } = withRelease(db);
    await svc.setAway(staff, STAFF, { from: TODAY, until: plus(5) });
    expect(release.releaseFor).not.toHaveBeenCalled();
    await svc.setAway(staff, STAFF, { from: plus(3), until: plus(5) });
    expect(release.releaseFor).toHaveBeenCalledWith(HOUSE, STAFF);
  });

  it("keeps the Away change when the release throws", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: STAFF, away_from: TODAY, away_until: plus(5) }],
    });
    const release = { releaseFor: jest.fn(async () => { throw new Error("down"); }) } as any;
    const svc = new HouseAreasService(asDatabaseService(db), release);
    await expect(svc.endAway(staff, STAFF)).resolves.toMatchObject({ ended: true });
    expect(db.tables.house_away).toEqual([]);
  });
});

describe("the house and the role come from the token", () => {
  it("refuses a session with no house, and one with no role in it", () => {
    expect(() => actorOf({ user: { userId: OWNER, role: "owner" } })).toThrow(BadRequestException);
    expect(() => actorOf({ user: { userId: OWNER, restaurantId: HOUSE, role: null } })).toThrow(
      ForbiddenException,
    );
  });

  it("does not widen an area gate on the `admin` alias", () => {
    expect(actorOf({ user: { userId: OWNER, restaurantId: HOUSE, role: "admin" } }).role).toBe("staff");
    expect(actorOf({ user: { userId: OWNER, restaurantId: HOUSE, role: "Manager" } }).role).toBe("manager");
  });
});
