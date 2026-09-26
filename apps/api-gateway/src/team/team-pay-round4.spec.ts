import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { FORMER_STAFF_RETENTION_YEARS, TeamService } from "./team.service";
import { seesMoney, wageWriteRefusal } from "./pay-rules";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team, ADR 0215 round 4 — the founder's three answers of 2026-09-25 (item
 * 19), verbatim option labels:
 *
 *   PA  "Pay visibility only (Recommended)" — "The switch decides whether
 *       that manager can see and edit pay; their other rights are unchanged."
 *   FS  "Owner-only history (Recommended)" — "Hidden from the team views; the
 *       owner can open a 'former staff' history for pay and legal records."
 *   CR  "Credentials yes, availability no (Recommended)" — a removed person's
 *       credentials are kept (and hidden from team views like their shifts
 *       and leave); availability is not kept (the database's cascade, proved
 *       in migration 20260925180210, not here).
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const MANAGER2 = "user-manager-2";
const STAFF = "user-staff";
const WEEK = "2026-09-07"; // a Monday
const GONE = "m-gone";

function seed(opts: { managerPay?: boolean } = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true, team_pay_access: false },
      { id: "a2", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true, team_pay_access: opts.managerPay === true },
      { id: "a4", user_id: MANAGER2, restaurant_id: RID, role: "manager", is_active: true, team_pay_access: false },
      // A wrongly-set switch on a staff row must never show them money.
      { id: "a3", user_id: STAFF, restaurant_id: RID, role: "staff", is_active: true, team_pay_access: true },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner", name: "Ada", email: "ada@example.test" },
      { user_id: MANAGER, restaurant_id: RID, role: "manager", name: "Moe", email: "moe@example.test" },
      { user_id: MANAGER2, restaurant_id: RID, role: "manager", name: "Mia", email: "mia@example.test" },
      { user_id: STAFF, restaurant_id: RID, role: "staff", name: "Sam", email: "sam@example.test" },
    ],
    team_members: [
      { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", hourly_wage: 40, created_at: "2026-01-01" },
      { id: "m-manager", restaurant_id: RID, user_id: MANAGER, display_name: "Moe", hourly_wage: 30, created_at: "2026-01-02" },
      { id: "m-manager2", restaurant_id: RID, user_id: MANAGER2, display_name: "Mia", hourly_wage: 31, created_at: "2026-01-04" },
      { id: "m-staff", restaurant_id: RID, user_id: STAFF, display_name: "Sam", hourly_wage: 20, created_at: "2026-01-03" },
    ],
    team_settings: [
      { restaurant_id: RID, labor_tracking_enabled: true, wage_visible: true, labor_target_pct: 30 },
    ],
    restaurants: [{ id: RID, currency: "TRY", country: "TR" }],
    schedules: [{ id: "s1", restaurant_id: RID, week_start: WEEK, status: "draft" }],
    shifts: [],
    shift_breaks: [],
    schedule_receipts: [],
    coverage_templates: [],
    time_off_requests: [],
    team_certifications: [],
    team_member_departures: [],
    team_member_wage_changes: [],
    notifications: [],
    system_audit_log: [],
  });
}

function teamOf(db: StubDb) {
  return new TeamService(asDatabaseService(db));
}
function scheduleOf(db: StubDb) {
  const team = teamOf(db);
  const notifications = { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
}
function shift(over: Record<string, any>) {
  return {
    restaurant_id: RID,
    schedule_id: "s1",
    shift_date: WEEK,
    start_time: "09:00",
    end_time: "17:00",
    state: "scheduled",
    shift_breaks: [],
    ...over,
  };
}
const pricedWeek = (db: StubDb) =>
  db.tables.shifts.push(
    shift({ id: "sh1", member_id: "m-staff", labor_cost: 150 }),
    shift({ id: "sh2", member_id: "m-manager", labor_cost: 225 }),
  );

// ── PA: the manager pay switch ───────────────────────────────────────────────

describe("PA — an owner may switch a manager's pay access on; nothing else changes", () => {
  it("the rule: owner always, a manager only with the switch on, staff never", () => {
    expect(seesMoney("owner")).toBe(true);
    expect(seesMoney({ role: "owner", payAccess: false })).toBe(true);
    expect(seesMoney("manager")).toBe(false);
    expect(seesMoney({ role: "manager", payAccess: false })).toBe(false);
    expect(seesMoney({ role: "manager", payAccess: null })).toBe(false);
    expect(seesMoney({ role: "manager", payAccess: true })).toBe(true);
    expect(seesMoney({ role: "staff", payAccess: true })).toBe(false);
    expect(wageWriteRefusal({ role: "manager", payAccess: true }, false)).toBeNull();
    expect(wageWriteRefusal({ role: "manager", payAccess: true }, true)).toMatch(/cannot set their own wage/);
    expect(wageWriteRefusal({ role: "manager", payAccess: false }, false)).toMatch(/Only an owner/);
    expect(wageWriteRefusal("owner", true)).toBeNull();
  });

  it("a switched-on manager's week carries the money; a switched-off one's does not", async () => {
    const on = seed({ managerPay: true });
    pricedWeek(on);
    const weekOn = await scheduleOf(on).getWeek(MANAGER, RID, WEEK);
    expect(weekOn.labor.moneyVisible).toBe(true);
    expect(weekOn.shifts.map((s: any) => s.labor_cost).sort()).toEqual([150, 225]);
    expect(weekOn.labor.totalCost).toBe(375);
    expect(weekOn.money).toMatchObject({ currency: "TRY", readable: true });

    const off = seed();
    pricedWeek(off);
    const weekOff = await scheduleOf(off).getWeek(MANAGER, RID, WEEK);
    expect(weekOff.labor.moneyVisible).toBe(false);
    for (const s of weekOff.shifts) expect("labor_cost" in s).toBe(false);
    expect("money" in weekOff).toBe(false);
    // The other manager, never switched on, still gets hours only.
    const weekOther = await scheduleOf(on).getWeek(MANAGER2, RID, WEEK);
    expect(weekOther.labor.moneyVisible).toBe(false);
  });

  it("a switched-on manager's roster carries wages, without anyone's pay switch", async () => {
    const db = seed({ managerPay: true });
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    expect(rows.find((m: any) => m.id === "m-staff")?.hourly_wage).toBe(20);
    for (const r of rows) expect("payAccess" in r).toBe(false);
  });

  it("the owner's roster says, per manager and only for managers, whether the switch is on", async () => {
    const db = seed({ managerPay: true });
    const rows = await teamOf(db).listMembers(OWNER, RID);
    const by = (id: string) => rows.find((m: any) => m.id === id);
    expect(by("m-manager")?.payAccess).toBe(true);
    expect(by("m-manager2")?.payAccess).toBe(false);
    expect("payAccess" in by("m-owner")).toBe(false);
    expect("payAccess" in by("m-staff")).toBe(false);
  });

  it("a switched-on manager sets a colleague's wage (recorded as theirs), never their own", async () => {
    const db = seed({ managerPay: true });
    const saved = await teamOf(db).updateMember(MANAGER, RID, "m-staff", { hourlyWage: 22 } as any);
    expect(saved.hourly_wage).toBe(22);
    expect(db.tables.team_members.find((m) => m.id === "m-staff")?.wage_changed_by).toBe(MANAGER);

    await expect(
      teamOf(db).updateMember(MANAGER, RID, "m-manager", { hourlyWage: 99 } as any),
    ).rejects.toThrow(/cannot set their own wage/);
    expect(db.tables.team_members.find((m) => m.id === "m-manager")?.hourly_wage).toBe(30);
  });

  it("a switched-off manager still sets no wage at all, a new person's included", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateMember(MANAGER, RID, "m-staff", { hourlyWage: 22 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      teamOf(db).createMember(MANAGER, RID, { displayName: "New", hourlyWage: 18 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.team_members.find((m) => m.id === "m-staff")?.hourly_wage).toBe(20);
    expect(db.tables.team_members).toHaveLength(4);
  });

  it("staff with a stray switch get no pay: the switch is read for managers only", async () => {
    const db = seed();
    const access = await teamOf(db).assertAccess(STAFF, RID, undefined, { payAccess: true });
    expect(access).toEqual({ role: "staff", payAccess: false });
  });

  it("the other manager rights are unchanged: a switched-on manager still cannot switch labour tracking off", async () => {
    const db = seed({ managerPay: true });
    await expect(
      teamOf(db).updateSettings(MANAGER, RID, { laborTrackingEnabled: false } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("the owner switches it on: written, audited from/to, and the manager is told", async () => {
    const db = seed();
    const res = await teamOf(db).setPayAccess(OWNER, RID, "m-manager", true);
    expect(res).toEqual({ memberId: "m-manager", payAccess: true, changed: true, audited: true, notified: true });
    expect(db.tables.user_restaurant_access.find((a) => a.user_id === MANAGER)?.team_pay_access).toBe(true);
    const audit = db.tables.system_audit_log.find((r) => r.action === "team_pay_access_changed");
    expect(audit).toMatchObject({
      actor_id: OWNER,
      entity_id: "m-manager",
      restaurant_id: RID,
      changes: { team_pay_access: { from: false, to: true } },
    });
    expect(db.tables.notifications.find((n) => n.user_id === MANAGER)?.title).toMatch(/see and set pay/);
    // …and it takes effect on the next read.
    pricedWeek(db);
    expect((await scheduleOf(db).getWeek(MANAGER, RID, WEEK)).labor.moneyVisible).toBe(true);
  });

  it("a save that moves nothing records nothing", async () => {
    const db = seed({ managerPay: true });
    const res = await teamOf(db).setPayAccess(OWNER, RID, "m-manager", true);
    expect(res).toMatchObject({ changed: false, audited: false });
    expect(db.opsOn("user_restaurant_access", "update")).toHaveLength(0);
    expect(db.tables.system_audit_log).toHaveLength(0);
  });

  it("only the owner switches it, and only a manager has one", async () => {
    const db = seed({ managerPay: true });
    await expect(teamOf(db).setPayAccess(MANAGER, RID, "m-manager2", true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(teamOf(db).setPayAccess(STAFF, RID, "m-manager2", true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(teamOf(db).setPayAccess(OWNER, RID, "m-staff", true)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(teamOf(db).setPayAccess(OWNER, RID, "m-owner", false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.opsOn("user_restaurant_access", "update")).toHaveLength(0);
    expect(db.tables.system_audit_log).toHaveLength(0);
  });

  it("a switch whose before-state cannot be read is not written", async () => {
    const db = seed();
    db.errors["team_members:select"] = { message: "boom" };
    await expect(teamOf(db).setPayAccess(OWNER, RID, "m-manager", true)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.opsOn("user_restaurant_access", "update")).toHaveLength(0);
  });

  it("before the column exists (migration not applied), /team still answers and pay is withheld from managers", async () => {
    const db = seed({ managerPay: true });
    // The deploy window: user_restaurant_access without team_pay_access.
    db.schema = {
      user_restaurant_access: ["id", "user_id", "restaurant_id", "role", "is_active"],
    };
    pricedWeek(db);
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.moneyVisible).toBe(false);
    for (const s of week.shifts) expect("labor_cost" in s).toBe(false);
    const rows = await teamOf(db).listMembers(OWNER, RID);
    expect(rows.find((m: any) => m.id === "m-manager")?.payAccess).toBeNull();
    expect(rows.find((m: any) => m.id === "m-staff")?.hourly_wage).toBe(20);
  });
});

// ── FS: the owner's former-staff history ─────────────────────────────────────

function withFormer(db: StubDb, opts: { audited?: boolean } = {}) {
  db.tables.team_member_departures.push({
    restaurant_id: RID,
    member_id: GONE,
    left_at: "2026-09-10T12:00:00.000Z",
  });
  db.tables.shifts.push(
    shift({ id: "g1", member_id: GONE, shift_date: "2026-09-01", labor_cost: 150 }),
    shift({ id: "g2", member_id: GONE, shift_date: "2026-09-02", labor_cost: 150, state: "callout" }),
    shift({ id: "live", member_id: "m-staff", labor_cost: 150 }),
  );
  db.tables.time_off_requests.push({
    id: "t-g",
    restaurant_id: RID,
    member_id: GONE,
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    status: "approved",
    leave_type: "paid",
    reason: "a private sentence",
  });
  db.tables.team_member_wage_changes.push({
    restaurant_id: RID,
    member_id: GONE,
    old_wage: null,
    new_wage: 20,
    currency: "TRY",
    changed_by: OWNER,
    changed_by_role: "owner",
    changed_at: "2026-01-05T00:00:00.000Z",
  });
  db.tables.team_certifications.push(
    { id: "c-g", restaurant_id: RID, member_id: GONE, cert_type: "food_handler", issued_at: "2025-01-01", expires_at: "2027-01-01", doc_url: null, status: "valid" },
    { id: "c-live", restaurant_id: RID, member_id: "m-staff", cert_type: "food_handler", issued_at: "2025-01-01", expires_at: "2027-02-01", doc_url: null, status: "valid" },
  );
  if (opts.audited !== false) {
    db.tables.system_audit_log.push({
      restaurant_id: RID,
      action: "team_member_removed",
      entity_type: "team_member",
      entity_id: GONE,
      changes: { display_name: "Gus", position: "Server", access_role: { from: "staff", to: null } },
      created_at: "2026-09-10T12:00:00.000Z",
    });
  }
}

describe("FS — the owner's former-staff history", () => {
  it("names each person who left and lists what is kept for them, for five years", async () => {
    const db = seed();
    withFormer(db);
    const res = await teamOf(db).listFormerStaff(OWNER, RID);
    expect(res.retentionYears).toBe(FORMER_STAFF_RETENTION_YEARS);
    expect(res.money).toEqual({ currency: "TRY", country: "TR", readable: true });
    expect(res.people).toHaveLength(1);
    const p = res.people[0];
    expect(p).toMatchObject({
      memberId: GONE,
      name: "Gus",
      position: "Server",
      leftAt: "2026-09-10T12:00:00.000Z",
      keptUntil: "2031-09-10T12:00:00.000Z",
    });
    expect(p.shifts.map((s: any) => s.id).sort()).toEqual(["g1", "g2"]);
    // The called-out shift is kept but not worked: 7.5 worked hours, one cost.
    expect(p.totals).toEqual({ shiftsWorked: 1, workedHours: 7.5, cost: 150, unpricedShifts: 0 });
    expect(p.leave).toEqual([
      { id: "t-g", start_date: "2026-08-20", end_date: "2026-08-21", status: "approved", leave_type: "paid" },
    ]);
    expect(JSON.stringify(p)).not.toContain("a private sentence");
    // …and it is never even asked for (KVKK: the minimum).
    for (const op of db.opsOn("time_off_requests", "select")) {
      expect(op.columns ?? "").not.toMatch(/\breason\b|\*/);
    }
    expect(p.wageChanges).toEqual([
      { old_wage: null, new_wage: 20, currency: "TRY", changed_by_role: "owner", changed_at: "2026-01-05T00:00:00.000Z" },
    ]);
    expect(p.credentials.map((c: any) => c.id)).toEqual(["c-g"]);
  });

  it("says the name was not recorded when the removal's audit row is missing, and invents none", async () => {
    const db = seed();
    withFormer(db, { audited: false });
    const res = await teamOf(db).listFormerStaff(OWNER, RID);
    expect(res.people[0]).toMatchObject({ memberId: GONE, name: null, position: null });
  });

  it("an unpriced worked shift makes the cost unknown, never a partial", async () => {
    const db = seed();
    withFormer(db);
    db.tables.shifts.push(shift({ id: "g3", member_id: GONE, shift_date: "2026-09-03", labor_cost: null }));
    const res = await teamOf(db).listFormerStaff(OWNER, RID);
    expect(res.people[0].totals).toMatchObject({ shiftsWorked: 2, cost: null, unpricedShifts: 1 });
  });

  it("is the owner's alone — a manager, even switched on for pay, and staff are refused", async () => {
    const db = seed({ managerPay: true });
    withFormer(db);
    await expect(teamOf(db).listFormerStaff(MANAGER, RID)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(teamOf(db).listFormerStaff(STAFF, RID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("nobody has left: an empty history, said as such", async () => {
    const db = seed();
    const res = await teamOf(db).listFormerStaff(OWNER, RID);
    expect(res.people).toEqual([]);
  });

  it.each([
    ["team_member_departures:select"],
    ["shifts:select"],
    ["time_off_requests:select"],
    ["team_member_wage_changes:select"],
    ["team_certifications:select"],
    ["system_audit_log:select"],
  ])("a failed read (%s) is a 500 in words, never an empty history", async (key) => {
    const db = seed();
    withFormer(db);
    db.errors[key] = { message: "boom" };
    await expect(teamOf(db).listFormerStaff(OWNER, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("the team views still leave them out: the week, and the manager's leave list", async () => {
    const db = seed();
    withFormer(db);
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.shifts.map((s: any) => s.id)).toEqual(["live"]);
    const leave = await teamOf(db).listTimeOff(MANAGER, RID);
    expect(leave).toEqual([]);
  });
});

// ── CR: credentials are kept, and hidden like shifts and leave ───────────────

describe("CR — a removed person's credentials are kept, not listed in team views", () => {
  it("a manager's credential file leaves the removed person's credential out, and deletes nothing", async () => {
    const db = seed();
    withFormer(db);
    const certs = await teamOf(db).listCertifications(MANAGER, RID);
    expect(certs.map((c: any) => c.id)).toEqual(["c-live"]);
    expect(db.tables.team_certifications).toHaveLength(2);
    expect(db.opsOn("team_certifications", "delete")).toHaveLength(0);
  });

  it("the owner's credential file leaves it out too — it lives in the former-staff history", async () => {
    const db = seed();
    withFormer(db);
    const certs = await teamOf(db).listCertifications(OWNER, RID);
    expect(certs.map((c: any) => c.id)).toEqual(["c-live"]);
  });

  it("a staff member still sees only their own", async () => {
    const db = seed();
    withFormer(db);
    const certs = await teamOf(db).listCertifications(STAFF, RID);
    expect(certs.map((c: any) => c.id)).toEqual(["c-live"]);
  });

  it("a credential file whose roster cannot be read is refused, not shown whole", async () => {
    const db = seed();
    withFormer(db);
    db.errors["team_members:select"] = { message: "boom" };
    await expect(teamOf(db).listCertifications(MANAGER, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
