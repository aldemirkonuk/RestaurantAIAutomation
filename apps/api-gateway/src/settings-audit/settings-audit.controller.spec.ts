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

import { Logger } from "@nestjs/common";
import { REGISTERS } from "./settings-audit.controller";
import {
  SettingsAuditService,
  type SettingsRegister,
} from "./settings-audit.service";

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
  "time-zone": true,
  "tone-scoring": true,
  "data-terms": true,
  "target-margin": true,
  "ask-training": true,
  "state-and-country": true,
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

/**
 * EVERY REGISTER READS BACK BY NAME (ADR 0289 R5).
 *
 * The allow-list above only proves `?register=` ACCEPTS a name. Until
 * 2026-10-04 the service's `readRegister` knew five of the twelve registers by
 * a hand-typed list, so a row filed under `currency`, `time-zone`,
 * `ask-training` or any of the four others read back with `register: null`,
 * and `list(rid, 50, register)` filtered it away: the route answered 200 with
 * an empty trail for rows it had written (ConsentPanel's ask-training trail
 * among them). A new register would have been born with the same fault.
 *
 * So each member of `EVERY` — the compiler-held list — is stored as a real
 * row and must come back carrying its register, and through the filter.
 */
describe("every register the type admits reads back by name", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  function serviceHolding(register: string): SettingsAuditService {
    const row = {
      id: `row-${register}`,
      actor_id: "u-1",
      // Any read-back action: the register comes from the row, not the action.
      action: "house_state_country_changed",
      entity_type: "restaurant",
      entity_id: "rest-1",
      changes: {
        register,
        subject: "Tuzlu Rüzgar",
        fields: { x: { from: 1, to: 2 } },
      },
      created_at: "2026-10-04T00:30:00Z",
    };
    const tables: Record<string, unknown[]> = {
      system_audit_log: [row],
      users: [{ user_id: "u-1", name: "Deniz", email: null }],
    };
    const client = {
      from(table: string) {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: tables[table] ?? [], error: null }).then(
              resolve,
            ),
        };
        return chain;
      },
    };
    return new SettingsAuditService({ client } as never);
  }

  it.each(Object.keys(EVERY) as SettingsRegister[])(
    "%s: a stored row carries its register, and ?register= returns it",
    async (register) => {
      const service = serviceHolding(register);

      const all = await service.list("rest-1", 50, undefined, "owner");
      expect(all.entries.map((e) => e.register)).toEqual([register]);

      const filtered = await service.list("rest-1", 50, register, "owner");
      expect(filtered.entries.map((e) => e.id)).toEqual([`row-${register}`]);
    },
  );

  it("still reads a register the type does not admit as unfiled, never as a guess", async () => {
    const service = serviceHolding("not-a-register");
    const all = await service.list("rest-1", 50, undefined, "owner");
    expect(all.entries.map((e) => e.register)).toEqual([null]);
  });
});
