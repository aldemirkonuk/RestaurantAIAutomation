import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { MembersService } from "../restaurants/members.service";
import { TeamService } from "../team/team.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * P9, round 3, 2026-09-19 (adversarial pass on round 2's diff). `deleteAccount`
 * is the fourth path that ends a person's membership in a house — alongside
 * `leaveRestaurant`, `MembersService.removeMember` and `TeamService.deleteMember`
 * — but was the only one never wired to `websocketGateway.evictFromHouse` or
 * `cancelPendingInvitesFrom`. A socket already subscribed to a house's room
 * before its own owner self-deletes stayed subscribed (bounded by that
 * socket's own access token's remaining life, and only reachable by the
 * deleted account's own already-open connection); any invite that account had
 * issued for a house kept granting exactly what it said until it lapsed on
 * its own, rather than being cancelled immediately like every other removal.
 */

const USER = "user-deleting";
const HOUSE_A = "house-a";
const HOUSE_B = "house-b";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

function invite(overrides: Record<string, any> = {}) {
  return {
    id: "invite-x",
    organization_id: "org-1",
    restaurant_id: HOUSE_A,
    code: "ZZZZ9999",
    invited_by: USER,
    role: "staff",
    expires_at: FUTURE,
    used_at: null,
    used_by_email: null,
    ...overrides,
  };
}

function makeService(seed: {
  access?: Record<string, any>[];
  invites?: Record<string, any>[];
  users?: Record<string, any>[];
  oauth?: Record<string, any>[];
  blockers?: Record<string, any>[];
  errors?: Record<string, { message: string }>;
}) {
  const db = makeStubDb(
    {
      user_restaurant_access: seed.access ?? [],
      organization_invites: seed.invites ?? [],
      users: seed.users ?? [{ user_id: USER, email: "leaving@example.com" }],
      user_oauth_accounts: seed.oauth ?? [],
      account_delete_blockers: seed.blockers ?? [],
      team_members: [],
      notifications: [],
      system_audit_log: [],
    },
    seed.errors ?? {},
  );
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
    { sendEmail: async () => undefined } as any,
  );
  const gateway = { evictFromHouse: jest.fn() };
  (svc as any).websocketGateway = gateway;
  wireRemoval(svc, db, gateway);
  return { svc, db, gateway };
}

/**
 * ADR 0242 (OD-204): an account that goes leaves each house through the one
 * removal path (`MembersService.removeMember` → `TeamService.removeFromHouse`
 * for a rostered person), looked up at call time. That leave evicts and
 * cancels too, so a house is evicted from more than once; what these cases
 * pin is WHICH houses, never how many calls.
 */
function wireRemoval(svc: AuthService, db: any, gateway?: any) {
  const members = new MembersService(
    asDatabaseService(db),
    gateway,
    new TeamService(asDatabaseService(db), gateway),
  );
  (svc as any).moduleRef = { get: () => members };
}

const housesEvicted = (gateway: { evictFromHouse: jest.Mock }) =>
  [...new Set(gateway.evictFromHouse.mock.calls.map((c) => `${c[0]}@${c[1]}`))].sort();

describe("deleteAccount — evicts sockets and cancels pending invites for every house it removed", () => {
  it("evicts the deleted account from its one active house and cancels the invite it issued there", async () => {
    const { svc, db, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      ],
      invites: [invite({ restaurant_id: HOUSE_A })],
    });

    await svc.deleteAccount(USER);

    expect(housesEvicted(gateway)).toEqual([`${USER}@${HOUSE_A}`]);
    expect(
      new Date(db.tables.organization_invites[0].expires_at).getTime(),
    ).toBeLessThanOrEqual(Date.now());
  });

  it("evicts from EVERY active house, not just one, when the account belonged to several", async () => {
    const { svc, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "manager", is_active: true },
        { user_id: USER, restaurant_id: HOUSE_B, role: "staff", is_active: true },
      ],
    });

    await svc.deleteAccount(USER);

    expect(housesEvicted(gateway)).toEqual(
      [`${USER}@${HOUSE_A}`, `${USER}@${HOUSE_B}`].sort(),
    );
  });

  it("does not evict from an already-inactive row, and does not crash with no websocketGateway wired", async () => {
    const db = makeStubDb({
      user_restaurant_access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: false },
      ],
      users: [{ user_id: USER, email: "leaving@example.com" }],
    });
    const svc = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
      { sendEmail: async () => undefined } as any,
    );
    // websocketGateway left undefined, same as every pre-existing spec here.
    wireRemoval(svc, db);

    await expect(svc.deleteAccount(USER)).resolves.toBeUndefined();
  });

  it("refuses with 503 when the pre-delete houses read errors, and deletes nothing (round 5, 2026-09-21 — ci.yml:527's check_read_errors_not_swallowed.py)", async () => {
    const { svc, db, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      ],
      errors: {
        "user_restaurant_access:select": { message: "connection reset" },
      },
    });

    await expect(svc.deleteAccount(USER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(gateway.evictFromHouse).not.toHaveBeenCalled();
    expect(db.opsOn("user_oauth_accounts", "delete")).toHaveLength(0);
    expect(db.opsOn("user_restaurant_access", "delete")).toHaveLength(0);
    expect(db.opsOn("users", "delete")).toHaveLength(0);
  });

  it("still blocks deletion when the account is the sole owner of a house, before anything is evicted", async () => {
    const { svc, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "owner", is_active: true },
      ],
    });

    await expect(svc.deleteAccount(USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(gateway.evictFromHouse).not.toHaveBeenCalled();
  });
});

/**
 * F-457 (house-lifecycle sim, 2026-10-09). The house's own records refuse the
 * `users` delete once the person wrote a crew note or changed a menu price
 * (ON DELETE RESTRICT). The delete used to leave every house and drop the
 * sign-in links first, then fail: account kept, houses gone. The stub's
 * `users:delete` error stands for that RESTRICT refusal.
 */
describe("deleteAccount — refused up front when records keep the person's name (F-457)", () => {
  const RESTRICTED = {
    "users:delete": {
      message:
        'update or delete on table "users" violates foreign key constraint "team_notes_author_user_id_fkey"',
    },
  };

  it("names the records and writes nothing: still in every house, sign-in links kept, no account delete tried", async () => {
    const { svc, db, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "manager", is_active: true },
        { user_id: USER, restaurant_id: HOUSE_B, role: "staff", is_active: true },
      ],
      oauth: [{ user_id: USER, provider: "google", provider_user_id: "g-1" }],
      invites: [invite({ restaurant_id: HOUSE_A })],
      blockers: [
        { table_name: "team_notes", column_name: "author_user_id", row_count: 3 },
        { table_name: "menu_price_versions", column_name: "changed_by", row_count: 12 },
      ],
      errors: RESTRICTED,
    });

    const refusal = svc.deleteAccount(USER);
    await expect(refusal).rejects.toBeInstanceOf(BadRequestException);
    await expect(refusal).rejects.toThrow(
      /crew notes and menu price changes.*Nothing was changed/,
    );

    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
    expect(gateway.evictFromHouse).not.toHaveBeenCalled();
    expect(
      db.tables.user_restaurant_access.map((r) => [r.restaurant_id, r.is_active]),
    ).toEqual([
      [HOUSE_A, true],
      [HOUSE_B, true],
    ]);
    expect(db.tables.user_oauth_accounts).toHaveLength(1);
    expect(db.tables.users).toHaveLength(1);
    expect(
      new Date(db.tables.organization_invites[0].expires_at).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("refuses with 503 and writes nothing when the check itself cannot be read", async () => {
    const { svc, db, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      ],
      errors: { "rpc:account_delete_blockers": { message: "connection reset" } },
    });

    await expect(svc.deleteAccount(USER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(db.ops.filter((o) => o.op !== "select")).toEqual([]);
    expect(gateway.evictFromHouse).not.toHaveBeenCalled();
  });

  it("if the account delete is still refused after the check, the sign-in links stay and the message says the houses were left", async () => {
    const { svc, db } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      ],
      oauth: [{ user_id: USER, provider: "google", provider_user_id: "g-1" }],
      errors: RESTRICTED,
    });

    await expect(svc.deleteAccount(USER)).rejects.toThrow(
      /left your restaurants, but the account itself was not deleted/,
    );
    expect(db.opsOn("user_oauth_accounts", "delete")).toHaveLength(0);
    expect(db.tables.user_oauth_accounts).toHaveLength(1);
  });
});
