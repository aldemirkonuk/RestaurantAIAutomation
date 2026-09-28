import { PlatformOperatorGuard, PlatformOperatorService } from "./platform-operator.service";

function database(granted: boolean, developer: boolean, failed = false) {
  const calls: Array<[string, ...unknown[]]> = [];
  return { calls, client: { from: jest.fn((table: string) => {
    const query: any = {};
    for (const method of ["select", "eq", "is"]) query[method] = jest.fn((...args: unknown[]) => { calls.push([method, ...args]); return query; });
    const result = { data: table === "platform_operator_grants" ? (granted ? { enabled: true } : null) : (developer ? [{ id: "studio-grant" }] : []), error: failed ? { message: "unavailable" } : null };
    query.maybeSingle = jest.fn().mockResolvedValue(result);
    query.limit = jest.fn().mockResolvedValue(result);
    return query;
  }) } };
}

describe("platform authority (ADR 0143)", () => {
  it.each([[false, false, false], [true, false, false], [false, true, false], [true, true, true]])(
    "SQL grant=%s and current Studio developer=%s => %s", async (grant, role, permitted) => {
      const db = database(grant, role); const service = new PlatformOperatorService(db as any);
      expect(await service.isOperator("public-user-id")).toBe(permitted);
      expect(db.calls).toEqual(expect.arrayContaining([["eq", "user_id", "public-user-id"], ["eq", "role", "developer"], ["is", "revoked_at", null]]));
    },
  );
  it("fails closed on permission-store errors", async () => {
    await expect(new PlatformOperatorService(database(true, true, true) as any).isOperator("user")).rejects.toMatchObject({ status: 503 });
  });
  it("does not accept owner or cached Studio claims", async () => {
    const service = { isOperator: jest.fn().mockResolvedValue(false) };
    const guard = new PlatformOperatorGuard(service as any);
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ user: { userId: "owner", role: "owner", studioRoles: ["developer"] } }) }) } as any)).rejects.toMatchObject({ status: 403 });
    expect(service.isOperator).toHaveBeenCalledWith("owner");
  });
  it("rechecks revocation without caching permission", async () => {
    const db = database(true, true); const service = new PlatformOperatorService(db as any);
    await service.isOperator("user"); await service.isOperator("user");
    expect(db.client.from).toHaveBeenCalledTimes(4);
  });
});
