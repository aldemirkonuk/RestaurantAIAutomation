import { AuthService } from "./auth.service";

/**
 * Guards the SELECT list itself, not just the returned value.
 *
 * The tests shipped with ADR 0023 assert what `getProfileForUser` returns,
 * using a mock whose `.select()` ignores its argument. That means trimming
 * `email_verified` out of the query would leave every one of them green while
 * the field silently became `undefined` in production — reproducing OD-79
 * exactly, since `undefined` is what made the gate inert in the first place.
 *
 * This came from an agent that stalled before it could report; the test was
 * the one thing in its work that the shipped version did not already have.
 */
describe("getProfileForUser — the query, not just the result", () => {
  it("asks the database for email_verified", async () => {
    const captured: string[] = [];

    const row = {
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      phone: null,
      role: "manager",
      password_hash: "hash",
      oauth_provider: null,
      restaurant_id: null,
      email_verified: true,
    };

    const usersChain: any = {
      select: (cols: string) => {
        captured.push(cols);
        return usersChain;
      },
      eq: () => usersChain,
      single: async () => ({ data: row, error: null }),
      maybeSingle: async () => ({ data: row, error: null }),
    };

    const oauthChain: any = {
      select: () => ({
        eq: () => ({
          then: (resolve: any) => resolve({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    };

    const databaseService = {
      supabase: {
        from: (table: string) =>
          table === "user_oauth_accounts" ? oauthChain : usersChain,
      },
    } as any;

    const service = new AuthService(
      { sign: jest.fn(), verify: jest.fn(), decode: jest.fn() } as any,
      { get: jest.fn() } as any,
      databaseService,
      { blacklistToken: jest.fn() } as any,
      {} as any,
    );

    await service.getProfileForUser("u1");

    // Name the regression directly: if this fails, the message says which
    // column went missing rather than "expected true, received false".
    expect(captured.join(" ")).toContain("email_verified");
  });
});
