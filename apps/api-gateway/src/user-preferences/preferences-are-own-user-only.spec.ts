import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { UserPreferencesController } from "./user-preferences.controller";
import { UserPreferencesService } from "./user-preferences.service";

/**
 * GET and PATCH /users/:userId/preferences answer only for the caller
 * (ADR 0147). Before this, both handlers took the path id and queried
 * `user_preferences` by it, so any signed-in user who named another uuid
 * could read or rewrite that person's JSONB blob.
 *
 * The web client already sends its own id (useUserPreferences.ts). A
 * mismatch is a visible 403, never a silent swap to the token's id.
 */

const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeController() {
  const getPreferences = jest.fn(async (userId: string) => ({
    userId,
    preferences: { theme: "system" },
  }));
  const updatePreferences = jest.fn(
    async (userId: string, preferences: Record<string, unknown>) => ({
      userId,
      preferences,
    }),
  );
  const controller = new UserPreferencesController({
    getPreferences,
    updatePreferences,
  } as unknown as UserPreferencesService);
  return { controller, getPreferences, updatePreferences };
}

const req = (userId: string | null) => ({ user: { userId } }) as never;

describe("GET /users/:userId/preferences is the caller's row", () => {
  it("lets the caller read their own id", async () => {
    const { controller, getPreferences } = makeController();
    const row = await controller.getPreferences(OWN, req(OWN));
    expect(row.userId).toBe(OWN);
    expect(getPreferences).toHaveBeenCalledWith(OWN);
  });

  it("refuses another user's id and does not read", async () => {
    const { controller, getPreferences } = makeController();
    await expect(
      controller.getPreferences(OTHER, req(OWN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(getPreferences).not.toHaveBeenCalled();
  });

  it("is 401 when the session names no user, never a fallback to the path", async () => {
    const { controller, getPreferences } = makeController();
    await expect(
      controller.getPreferences(OWN, req(null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getPreferences).not.toHaveBeenCalled();
  });
});

describe("PATCH /users/:userId/preferences is the caller's row", () => {
  const dto = { preferences: { theme: "dark" } };

  it("lets the caller write their own id", async () => {
    const { controller, updatePreferences } = makeController();
    const row = await controller.updatePreferences(OWN, dto, req(OWN));
    expect(row.userId).toBe(OWN);
    expect(updatePreferences).toHaveBeenCalledWith(OWN, dto.preferences);
  });

  it("refuses another user's id and writes nothing", async () => {
    const { controller, updatePreferences } = makeController();
    await expect(
      controller.updatePreferences(OTHER, dto, req(OWN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updatePreferences).not.toHaveBeenCalled();
  });
});
