import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { AuthService } from "./auth.service";
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
  errors?: Record<string, { message: string }>;
}) {
  const db = makeStubDb(
    {
      user_restaurant_access: seed.access ?? [],
      organization_invites: seed.invites ?? [],
      users: seed.users ?? [{ user_id: USER, email: "leaving@example.com" }],
      user_oauth_accounts: [],
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
  return { svc, db, gateway };
}

describe("deleteAccount — evicts sockets and cancels pending invites for every house it removed", () => {
  it("evicts the deleted account from its one active house and cancels the invite it issued there", async () => {
    const { svc, db, gateway } = makeService({
      access: [
        { user_id: USER, restaurant_id: HOUSE_A, role: "staff", is_active: true },
      ],
      invites: [invite({ restaurant_id: HOUSE_A })],
    });

    await svc.deleteAccount(USER);

    expect(gateway.evictFromHouse).toHaveBeenCalledTimes(1);
    expect(gateway.evictFromHouse).toHaveBeenCalledWith(USER, HOUSE_A);
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

    expect(gateway.evictFromHouse).toHaveBeenCalledTimes(2);
    expect(gateway.evictFromHouse).toHaveBeenCalledWith(USER, HOUSE_A);
    expect(gateway.evictFromHouse).toHaveBeenCalledWith(USER, HOUSE_B);
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
