/**
 * THE ALLOW-LIST, CHECKED AGAINST THE TYPE — which is what the controller's own
 * comment claimed and what did not exist until now.
 *
 * `settings-audit.controller.ts` says `?register=` refuses any value outside
 * `REGISTERS` with a 400 naming the ones it holds. So a register the list omits
 * reads to a caller as *"that register does not exist"* while rows for it are
 * being written all the same — [[absence-reported-as-health]] with a 400 on
 * top. It has happened once already: `currency` was missing from the day the
 * register was added, and `PUT /settings/currency` wrote rows that
 * `GET /settings-audit?register=currency` then refused to show.
 *
 * The fix commit (e7c24d2e) said the list was "now checked against the
 * `SettingsRegister` type in the spec". Its audit looked for that spec and found
 * none: `grep -rn "SettingsRegister\|REGISTERS" src/settings-audit/*.spec.ts`
 * returned nothing, and reverting `REGISTERS` to its five-entry state would have
 * passed all 354 gateway tests. This file is the missing check.
 *
 * TWO MECHANISMS, ON PURPOSE, because each catches what the other cannot:
 *
 *   `EVERY` is a `Record<SettingsRegister, true>` written out by hand. Add a
 *   member to the union and `tsc -p tsconfig.spec.json` fails HERE, at compile
 *   time, before any test runs — TS2741, the property is missing (measured, by
 *   the audit of 78861031, finding 2, against this repository's own TypeScript:
 *   TS2739 is what a Record missing SEVERAL members produces). Remove one
 *   and the extra key is an excess property, which `tsc` also refuses. So the
 *   record cannot silently drift from the union in either direction.
 *
 *   The runtime assertions then compare that record's keys with the array the
 *   controller actually filters on. `tsc` cannot do this half: `REGISTERS` is
 *   typed `SettingsRegister[]`, and an array missing an element is still a
 *   perfectly well-typed array. Only a run can tell.
 */

import { REGISTERS } from "./settings-audit.controller";
import type { SettingsRegister } from "./settings-audit.service";

/**
 * Every member of the union, written out by hand.
 *
 * Do NOT replace this with something derived from `REGISTERS` — deriving it
 * would make the two sides the same fact and the comparison below vacuous. The
 * whole point is that this object is maintained by the compiler and that array
 * is maintained by a person.
 */
const EVERY: Record<SettingsRegister, true> = {
  features: true,
  "vendor-terms": true,
  thresholds: true,
  notifications: true,
  preferences: true,
  currency: true,
  "carrying-cost": true,
};

describe("the ?register= allow-list holds every register the type admits", () => {
  it("names exactly the members of SettingsRegister, as sets", () => {
    expect(new Set(REGISTERS)).toEqual(new Set(Object.keys(EVERY)));
  });

  it("holds each one once, so a set comparison cannot hide a duplicate", () => {
    expect(REGISTERS).toHaveLength(Object.keys(EVERY).length);
    expect(new Set(REGISTERS).size).toBe(REGISTERS.length);
  });

  it("holds the two registers that were added late, by name", () => {
    // Named rather than counted: `currency` is the one that was actually
    // missing in production, and `carrying-cost` is the newest, which makes it
    // the likeliest next omission.
    expect(REGISTERS).toContain("currency");
    expect(REGISTERS).toContain("carrying-cost");
  });

  it("holds no register the type does not admit", () => {
    for (const register of REGISTERS) {
      expect(Object.prototype.hasOwnProperty.call(EVERY, register)).toBe(true);
    }
  });
});
