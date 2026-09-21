import { ALL_ROLES, isReadingAllowedForRole, OWNER_MANAGER_ONLY, READING_CATALOGUE } from "./reading-catalogue";
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

const RESTRICTED: ReadingId[] = ["receipts.verified_line", "vendors.active", "orders.open", "orders.late_deliveries", "sales.check_activity", "sales.consumption", "goals.targets"];
const OPEN: ReadingId[] = READING_CATALOGUE.map(r => r.id).filter(id => !RESTRICTED.includes(id));

describe("READING_CATALOGUE: the named restricted set matches the founder's five categories exactly", () => {
  it("names exactly the seven readings under price, vendor, open-order, sales and goals -- no more, no fewer", () => {
    const actuallyRestricted = READING_CATALOGUE.filter(r => r.allowedRoles === OWNER_MANAGER_ONLY || !r.allowedRoles.includes("staff")).map(r => r.id);
    expect(actuallyRestricted.sort()).toEqual([...RESTRICTED].sort());
  });

  it("every catalogue entry declares allowedRoles explicitly -- never omitted, never empty", () => {
    for (const r of READING_CATALOGUE) {
      expect(Array.isArray(r.allowedRoles)).toBe(true);
      expect(r.allowedRoles.length).toBeGreaterThan(0);
    }
  });

  it("the eight open readings are untouched: ALL_ROLES, staff included", () => {
    for (const id of OPEN) {
      const descriptor = READING_CATALOGUE.find(r => r.id === id)!;
      expect(descriptor.allowedRoles).toEqual(ALL_ROLES);
    }
    expect(OPEN.length).toBe(8);
  });
});

describe("isReadingAllowedForRole: the seven restricted readings (price, vendor, open-order, sales, goals)", () => {
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
