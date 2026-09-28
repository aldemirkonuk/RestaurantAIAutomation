import { AuthService } from "./auth.service";

const user = { user_id: "u1", restaurant_id: "home", role: "owner" };
function validate(
  restaurantId: string,
  membership: any,
  membershipError: any = null,
) {
  const filters: Record<string, any>[] = [];
  const supabase = {
    from: (table: string) => {
      const where = {};
      filters.push(where);
      const q: any = {
        select: () => q,
        eq: (key: string, value: any) => {
          where[key] = value;
          return q;
        },
        single: async () => ({ data: user, error: null }),
        maybeSingle: async () => ({ data: membership, error: membershipError }),
      };
      return q;
    },
  };
  const service = Object.create(AuthService.prototype);
  service.databaseService = { supabase };
  return {
    filters,
    result: service.validateJwtPayload({ sub: "u1", restaurantId }),
    service,
  };
}

describe("active branch authorization", () => {
  it("uses the active branch's staff role instead of the home owner role", async () => {
    const test = validate("branch", { role: "staff", is_active: true });
    await expect(test.result).resolves.toMatchObject({ role: "staff" });
    expect(test.filters[1]).toEqual({ user_id: "u1", restaurant_id: "branch" });
  });
  it("refuses a revoked membership even in the home house", async () => {
    await expect(
      validate("home", { role: "owner", is_active: false }).result,
    ).rejects.toThrow(/revoked/);
  });
  it("refuses an unproved foreign membership and membership read faults", async () => {
    await expect(validate("branch", null).result).rejects.toThrow(
      /do not have access/,
    );
    await expect(
      validate("home", null, { message: "offline" }).result,
    ).rejects.toThrow(/could not be verified/);
  });
  it("retains legacy home-house access at staff privilege when no membership row exists", async () => {
    await expect(validate("home", null).result).resolves.toMatchObject({
      role: "staff",
    });
  });
  it("never mints a switch token for a revoked sibling branch", async () => {
    const test = validate("branch", { role: "owner", is_active: false });
    await expect(test.result).rejects.toThrow(/revoked/);
    test.service.generateTokens = jest.fn();
    await expect(test.service.switchRestaurant("u1", "branch")).rejects.toThrow(
      /revoked/,
    );
    expect(test.service.generateTokens).not.toHaveBeenCalled();
  });
});
