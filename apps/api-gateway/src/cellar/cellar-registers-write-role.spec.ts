import { ForbiddenException } from "@nestjs/common";
import { CellarController } from "./cellar.controller";

/**
 * F-1219: which registers the cellar carries is house setup — switching Wines
 * off drops it from the spine and renames the cellar — so only an owner, a
 * manager or an admin may write it, the same gate as the order-hold ceremony.
 * The service is a stub that records whether it was ever reached.
 */
function controller() {
  const write = jest.fn().mockResolvedValue({ registers: [] });
  const c = new CellarController({ write } as never, {} as never, {} as never);
  return { c, write };
}

const RID = "550e8400-e29b-41d4-a716-446655440000";
const DTO = { registers: [{ id: "wines", carried: false }], source: "manual" };

describe("PUT /cellar/:rid/registers — owner or manager only (F-1219)", () => {
  it.each(["staff", "server", undefined])(
    "a %s is refused and nothing is written",
    async (role) => {
      const { c, write } = controller();
      await expect(
        c.write(RID, DTO as never, { user: { userId: "u1", role } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it.each(["owner", "Manager", "admin"])("a %s may write", async (role) => {
    const { c, write } = controller();
    await c.write(RID, DTO as never, { user: { userId: "u1", role } });
    expect(write).toHaveBeenCalledWith(RID, DTO, "u1");
  });
});
