import { isReadingAllowedForRole, READING_CATALOGUE, shownFields } from "./reading-catalogue";
import { FIELD_CLASS, ROLE_POLICY, RolePolicyTable } from "./reading-data-classes";
import { ReadingId } from "./reading.types";

// Founder, batch 4, 2026-09-19, his words: "do not give money or sensitive
// incentives like sales etc to the staff, maybe we should exclude staff from
// this equation" -> price, vendor, open-order and sales readings are owner
// and manager only, enforced on the server PER READING. This file is the
// exhaustive matrix; bound-ask.service.spec.ts proves the same gate at the
// actual /ask dispatch boundary.
//
// FAILING BEFORE THIS CHANGE: `ReadingDescriptor` carried no `allowedRoles`
// field and `isReadingAllowedForRole` did not exist -- every one of the
// fifteen readings was reachable by every role, staff included. Deleting
// this file's import and the catalogue's `allowedRoles` entries (or
// widening every restricted entry back to `ALL_ROLES`) reproduces that: the
// "restricted readings" test below would then find zero rows.
//
// [CORRECTED 2026-09-21, KL round 5: `orders.late_deliveries` added to
// RESTRICTED. It reads the identical `open` order set `orders.open`
// computes (`reading-runner.ts`), filtered by date, and lists the same
// three columns -- left on `ALL_ROLES`, it let a staff caller refused
// `orders.open` reach the same rows through a wide-enough past window. Same
// category (open-order) as `orders.open`, so the same gate. Six restricted,
// not five; nine open, not ten.]
//
// [ANSWERED 2026-09-21, founder round 5 -- recorded answer, not a
// quotation: `goals.targets` (the posted-targets reading) is owner/manager
// only too, a money measure. Added to RESTRICTED. Seven restricted, not
// six; eight open, not nine. Recorded in ADR 0145's 2026-09-21 goals.targets
// amendment.]
//
// [REBUILT 2026-09-21, founder's option "Rules in code, label rows": the
// restricted set is no longer declared per Reading. It is DERIVED -- each
// Reading's shown fields carry data classes, and a role receives a Reading
// only when its ROLE_POLICY row sees every class. The matrix below is
// unchanged: the derivation produces exactly the seven / eight split above.
// FAILING BEFORE THIS CHANGE: `shows`, `classes` and `shownFields` did not
// exist, so the derivation tests below could not compile.]
//
// [ANSWERED 2026-09-21, founder round 6, his pick verbatim: "Yes, own-work
// only", meaning (approved, verbatim): "Staff can ask about stock, receiving
// and today's deliveries. Money, supplier prices and people data are refused
// with a one-line reason." The staff row now sees stock, receiving and
// today's deliveries: `calendar.upcoming` (people) joins RESTRICTED, and the
// new `orders.due_today` is open. Eight restricted, eight open.]

const RESTRICTED: ReadingId[] = ["receipts.verified_line", "vendors.active", "orders.open", "orders.late_deliveries", "sales.check_activity", "sales.consumption", "goals.targets", "calendar.upcoming"];
const OPEN: ReadingId[] = READING_CATALOGUE.map(r => r.id).filter(id => !RESTRICTED.includes(id));

describe("READING_CATALOGUE: the named restricted set matches the founder's categories exactly (six since round 6: people joined)", () => {
  it("names exactly the eight readings under price, vendor, open-order, sales, goals and people -- no more, no fewer", () => {
    const actuallyRestricted = READING_CATALOGUE.filter(r => !r.allowedRoles.includes("staff")).map(r => r.id);
    expect(actuallyRestricted.sort()).toEqual([...RESTRICTED].sort());
  });

  it("every Reading declares the fields it shows, and every one of them carries a data class", () => {
    for (const r of READING_CATALOGUE) {
      expect(r.shows.length).toBeGreaterThan(0);
      for (const field of shownFields(r)) expect(FIELD_CLASS[field]).toBeDefined();
    }
  });

  it("allowedRoles is derived from the classes, never declared: each restricted Reading shows a class staff does not see", () => {
    for (const id of RESTRICTED) {
      const r = READING_CATALOGUE.find(x => x.id === id)!;
      expect(r.classes.some(c => !ROLE_POLICY.staff.sees.includes(c))).toBe(true);
      expect(r.allowedRoles).toEqual(["owner", "manager"]);
    }
  });

  it("goals.targets stays owner/manager because every field it shows is money", () => {
    const goals = READING_CATALOGUE.find(r => r.id === "goals.targets")!;
    expect(goals.classes).toEqual(["money"]);
  });

  it("round 6: each open Reading shows only stock, receiving or today's deliveries, and the calendar is people", () => {
    const classesOf = (id: ReadingId) => READING_CATALOGUE.find(r => r.id === id)!.classes;
    for (const id of ["inventory.position", "inventory.low_stock", "inventory.in_transit", "inventory.locations", "inventory.movements"] as ReadingId[])
      expect(classesOf(id)).toEqual(["stock"]);
    expect(classesOf("orders.lines")).toEqual(["receiving"]);
    expect(classesOf("documents.waiting")).toEqual(["receiving"]);
    // The split: today's open deliveries are their own class; the whole order book stays suppliers.
    expect(classesOf("orders.due_today")).toEqual(["todays_deliveries"]);
    expect(classesOf("orders.open")).toContain("suppliers");
    expect(classesOf("calendar.upcoming")).toEqual(["people"]);
    expect(classesOf("receipts.verified_line")).toContain("money");
  });

  it("the eight open readings are reachable by owner, manager and staff", () => {
    for (const id of OPEN) {
      const descriptor = READING_CATALOGUE.find(r => r.id === id)!;
      expect(descriptor.allowedRoles).toEqual(["owner", "manager", "staff"]);
    }
    expect(OPEN.length).toBe(8);
    expect(OPEN).toContain("orders.due_today");
  });

  it("the gate follows the TABLE: a table in which staff also see money opens goals.targets and receipts to staff, and nothing else changes", () => {
    const widened: RolePolicyTable = { ...ROLE_POLICY, staff: { ...ROLE_POLICY.staff, sees: [...ROLE_POLICY.staff.sees, "money"] } };
    expect(isReadingAllowedForRole("goals.targets", "staff", widened)).toBe(true);
    expect(isReadingAllowedForRole("receipts.verified_line", "staff", widened)).toBe(true);
    expect(isReadingAllowedForRole("orders.open", "staff", widened)).toBe(false); // suppliers, still unseen
    expect(isReadingAllowedForRole("goals.targets", "staff")).toBe(false); // the real table is untouched
  });

  it("a row that is not given Reading answers receives no Reading, whatever it sees", () => {
    const noReadings: RolePolicyTable = { ...ROLE_POLICY, staff: { ...ROLE_POLICY.staff, answers: ["model_knowledge"] } };
    expect(isReadingAllowedForRole("inventory.position", "staff", noReadings)).toBe(false);
    expect(isReadingAllowedForRole("inventory.position", "owner", noReadings)).toBe(true);
  });
});

describe("isReadingAllowedForRole: the eight restricted readings (price, vendor, open-order, sales, goals, people)", () => {
  for (const id of RESTRICTED) {
    it(`${id}: owner yes, manager yes, staff no, admin yes (mirrors RolesGuard), unknown/null/empty no`, () => {
      expect(isReadingAllowedForRole(id, "owner")).toBe(true);
      expect(isReadingAllowedForRole(id, "manager")).toBe(true);
      expect(isReadingAllowedForRole(id, "staff")).toBe(false);
      expect(isReadingAllowedForRole(id, "admin")).toBe(true);
      expect(isReadingAllowedForRole(id, "chef")).toBe(false);
      expect(isReadingAllowedForRole(id, null)).toBe(false);
      expect(isReadingAllowedForRole(id, undefined)).toBe(false);
      expect(isReadingAllowedForRole(id, "")).toBe(false);
    });

    it(`${id}: role matching is case-insensitive, the same convention RolesGuard uses`, () => {
      expect(isReadingAllowedForRole(id, "Owner")).toBe(true);
      expect(isReadingAllowedForRole(id, "MANAGER")).toBe(true);
      expect(isReadingAllowedForRole(id, "Staff")).toBe(false);
    });
  }
});

describe("isReadingAllowedForRole: the eight open readings are reachable by every role, unchanged", () => {
  for (const id of OPEN) {
    it(`${id}: owner, manager, staff, admin, and even an unrecognised/null role all pass`, () => {
      expect(isReadingAllowedForRole(id, "owner")).toBe(true);
      expect(isReadingAllowedForRole(id, "manager")).toBe(true);
      expect(isReadingAllowedForRole(id, "staff")).toBe(true);
      expect(isReadingAllowedForRole(id, "admin")).toBe(true);
      expect(isReadingAllowedForRole(id, "chef")).toBe(true);
      expect(isReadingAllowedForRole(id, null)).toBe(true);
      expect(isReadingAllowedForRole(id, undefined)).toBe(true);
    });
  }
});

describe("isReadingAllowedForRole: an unknown reading id fails closed", () => {
  it("a string that is not a real ReadingId is never allowed, regardless of role", () => {
    expect(isReadingAllowedForRole("not.a.real.reading" as ReadingId, "owner")).toBe(false);
  });
});
