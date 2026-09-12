import { MicrosoftStrategy } from "./microsoft.strategy";

/**
 * `oid` is optional in `passport-azure-ad`'s `IProfile` and Azure omits it for
 * some account shapes. It was passed unguarded into
 * `findOrCreateOAuthUser({ providerId: string })` and written to
 * `users.oauth_id`, which is nullable `text` — so the account was created with
 * no provider id, silently.
 *
 * These assert the refusal, and equally that a good profile is NOT refused: a
 * guard that rejects everything looks identical to one that works.
 */
describe("MicrosoftStrategy.validate — a missing oid must not create an account", () => {
  const build = () => {
    const findOrCreateOAuthUser = jest.fn().mockResolvedValue({
      user_id: "u1",
      email: "a@b.com",
      name: "A",
      role: "owner",
      restaurant_id: "r1",
    });
    // The strategy's constructor reaches into passport; build the instance
    // without it and exercise `validate`, which is the logic under test.
    const strategy = Object.create(
      MicrosoftStrategy.prototype,
    ) as MicrosoftStrategy;
    (strategy as any).authService = { findOrCreateOAuthUser };
    return { strategy, findOrCreateOAuthUser };
  };

  it("refuses a profile with no oid, and creates nothing", async () => {
    const { strategy, findOrCreateOAuthUser } = build();
    const result = await strategy.validate({
      upn: "a@b.com",
      displayName: "A",
    } as any);
    expect(result).toBeNull();
    expect(findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it("refuses an empty-string oid too — it is not a subject identifier", async () => {
    const { strategy, findOrCreateOAuthUser } = build();
    expect(
      await strategy.validate({ upn: "a@b.com", oid: "" } as any),
    ).toBeNull();
    expect(findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it("still refuses a profile with no email, as before", async () => {
    const { strategy, findOrCreateOAuthUser } = build();
    expect(await strategy.validate({ oid: "oid-1" } as any)).toBeNull();
    expect(findOrCreateOAuthUser).not.toHaveBeenCalled();
  });

  it("accepts a complete profile — the guard is not refusing everything", async () => {
    const { strategy, findOrCreateOAuthUser } = build();
    const result = await strategy.validate({
      upn: "a@b.com",
      oid: "oid-1",
      displayName: "A",
    } as any);
    expect(result).toMatchObject({ userId: "u1", email: "a@b.com" });
    expect(findOrCreateOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "microsoft", providerId: "oid-1" }),
    );
  });

  it("falls back to preferred_username for the email, as before", async () => {
    const { strategy, findOrCreateOAuthUser } = build();
    await strategy.validate({
      oid: "oid-1",
      _json: { preferred_username: "a@b.com" },
    } as any);
    expect(findOrCreateOAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com" }),
    );
  });
});
