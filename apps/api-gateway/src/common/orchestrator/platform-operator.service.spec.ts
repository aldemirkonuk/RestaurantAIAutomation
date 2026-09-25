import { PlatformOperatorGuard, PlatformOperatorService } from "./platform-operator.service";

/**
 * A fake of the two permission reads that APPLIES the filters it is given, so a grant row
 * that is disabled or revoked, or a Studio role that is revoked or not `developer`, is
 * filtered out by the service's own query rather than by the fixture's choice of answer.
 */
type Row = Record<string, unknown>;
function database(tables: { grants: Row[]; roles: Row[] }, failed = false) {
  const calls: Array<[string, ...unknown[]]> = [];
  const client = {
    from: jest.fn((table: string) => {
      let rows = table === "platform_operator_grants" ? tables.grants : tables.roles;
      const query: any = {};
      query.select = jest.fn((...args: unknown[]) => { calls.push(["select", ...args]); return query; });
      query.eq = jest.fn((column: string, value: unknown) => {
        calls.push(["eq", column, value]); rows = rows.filter(row => row[column] === value); return query;
      });
      query.is = jest.fn((column: string, value: unknown) => {
        calls.push(["is", column, value]); rows = rows.filter(row => (row[column] ?? null) === value); return query;
      });
      const answer = (data: unknown) => Promise.resolve({ data: failed ? null : data, error: failed ? { message: "unavailable" } : null });
      query.maybeSingle = jest.fn(() => answer(rows[0] ?? null));
      query.limit = jest.fn((n: number) => answer(rows.slice(0, n)));
      return query;
    }),
  };
  return { calls, client };
}

const USER = "11111111-1111-4111-8111-111111111111";
const grant = (extra: Row = {}) => ({ user_id: USER, enabled: true, revoked_at: null, ...extra });
const role = (extra: Row = {}) => ({ user_id: USER, role: "developer", revoked_at: null, ...extra });

describe("platform authority (ADR 0143)", () => {
  it.each([
    ["no grant, no role", [], [], false],
    ["grant only", [grant()], [], false],
    ["developer role only", [], [role()], false],
    ["grant and developer role", [grant()], [role()], true],
    ["a disabled grant", [grant({ enabled: false })], [role()], false],
    ["a revoked grant", [grant({ enabled: false, revoked_at: "2026-09-17T00:00:00Z" })], [role()], false],
    ["a revoked developer role", [grant()], [role({ revoked_at: "2026-09-17T00:00:00Z" })], false],
    ["an owner role instead of developer", [grant()], [role({ role: "owner" })], false],
    ["another user's grant and role", [grant({ user_id: "someone-else" })], [role({ user_id: "someone-else" })], false],
  ])("%s => permitted=%s", async (_label, grants, roles, permitted) => {
    const service = new PlatformOperatorService(database({ grants: grants as Row[], roles: roles as Row[] }) as any);
    expect(await service.isOperator(USER)).toBe(permitted);
  });

  it("fails closed on permission-store errors", async () => {
    await expect(new PlatformOperatorService(database({ grants: [grant()], roles: [role()] }, true) as any).isOperator(USER))
      .rejects.toMatchObject({ status: 503 });
  });

  it("never treats a missing user id as an operator, and does not query for one", async () => {
    const db = database({ grants: [grant()], roles: [role()] });
    expect(await new PlatformOperatorService(db as any).isOperator(undefined)).toBe(false);
    expect(db.client.from).not.toHaveBeenCalled();
  });

  it("rechecks revocation on every request without caching permission", async () => {
    const tables = { grants: [grant()], roles: [role()] };
    const service = new PlatformOperatorService(database(tables) as any);
    expect(await service.isOperator(USER)).toBe(true);
    tables.grants = [grant({ enabled: false, revoked_at: "2026-09-17T00:00:00Z" })];
    expect(await service.isOperator(USER)).toBe(false);
  });

  it("the guard consults the store for the JWT's user id and ignores role claims on the request", async () => {
    // A request carrying an owner role and cached Studio claims, for a user with no grant.
    const db = database({ grants: [], roles: [role()] });
    const guard = new PlatformOperatorGuard(new PlatformOperatorService(db as any));
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { userId: USER, role: "owner", studioRoles: ["developer"] } }) }) };
    await expect(guard.canActivate(context as any)).rejects.toMatchObject({ status: 403 });
    expect(db.calls).toEqual(expect.arrayContaining([["eq", "user_id", USER], ["eq", "role", "developer"]]));
  });
});
