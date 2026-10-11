import {
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import {
  ACCOUNT_NOT_CREATED,
  AuthService,
  EMAIL_IN_USE,
  HOUSE_ACCESS_NOT_GRANTED,
} from "./auth.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";

/**
 * F-1213 (re-hit of F-897/F-243): the invite join and the signed-in accept
 * returned Postgres text to the joiner ("User creation failed: duplicate key
 * value ...", "Failed to grant restaurant access: ..."). They now say fixed
 * words, and the raw code and message go to the server log only.
 */

const ISSUER = "user-issuer";
const JOINER = "user-joiner";
const HOUSE = "house-1";
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const RAW = 'duplicate key value violates unique constraint "users_email_key"';

function makeService(
  errors: Record<string, { message: string; code?: string }>,
  joinerHasAccount: boolean,
) {
  const db = makeStubDb(
    {
      user_restaurant_access: [
        {
          id: "ura-issuer",
          user_id: ISSUER,
          restaurant_id: HOUSE,
          role: "owner",
          is_active: true,
        },
      ],
      organization_invites: [
        {
          id: "invite-1",
          organization_id: "org-1",
          restaurant_id: HOUSE,
          code: "ABCD1234",
          invited_by: ISSUER,
          role: "staff",
          expires_at: FUTURE,
          used_at: null,
          used_by_email: null,
          target_email: null,
          email_secret_hash: null,
        },
      ],
      users: joinerHasAccount
        ? [{ user_id: JOINER, email: "joiner@example.com" }]
        : [],
      restaurants: [{ id: HOUSE, name: "House One" }],
      team_members: [],
      organization_members: [],
    },
    errors,
  );
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendEmail: async () => undefined } as any,
  );
  (svc as any).claimTeamMemberFromInvite = jest
    .fn()
    .mockResolvedValue(undefined);
  (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);
  const logged = jest
    .spyOn((svc as any).logger, "error")
    .mockImplementation(() => undefined);
  return { svc, db, logged };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as Error & { getStatus?: () => number };
  }
  throw new Error("expected a refusal");
}

const join = (svc: AuthService) =>
  svc.joinViaInvite({
    code: "ABCD1234",
    email: "joiner@example.com",
    name: "Joiner",
    password: "long-enough-password",
  } as any);

describe("invite join and accept say fixed words, never Postgres text (F-1213)", () => {
  it("a new joiner who loses a same-address race is told to sign in", async () => {
    const { svc, logged } = makeService(
      { "users:insert": { code: "23505", message: RAW } },
      false,
    );
    const error = await refusal(join(svc));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(EMAIL_IN_USE);
    expect(error.message).not.toContain("duplicate key");
    expect(logged.mock.calls.flat().join(" ")).toContain(RAW);
  });

  it("any other failed account row is said plainly", async () => {
    const { svc, db } = makeService(
      { "users:insert": { code: "XX000", message: "internal error" } },
      false,
    );
    const error = await refusal(join(svc));
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toBe(ACCOUNT_NOT_CREATED);
    expect(db.tables.organization_invites[0].used_at).toBeNull();
  });

  it("a join whose place in the house was not written is said plainly", async () => {
    const raw =
      'insert or update on table "user_restaurant_access" violates foreign key';
    const { svc, db, logged } = makeService(
      { "user_restaurant_access:insert": { code: "23503", message: raw } },
      false,
    );
    const error = await refusal(join(svc));
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toBe(HOUSE_ACCESS_NOT_GRANTED);
    expect(error.message).not.toContain("violates");
    expect(logged.mock.calls.flat().join(" ")).toContain(raw);
    expect(db.tables.organization_invites[0].used_at).toBeNull();
  });

  it("a signed-in accept whose place was not written is said plainly", async () => {
    const raw = 'new row violates check constraint "ura_role_check"';
    const { svc, db, logged } = makeService(
      { "user_restaurant_access:insert": { code: "23514", message: raw } },
      true,
    );
    const error = await refusal(
      svc.acceptInviteAsExistingUser(JOINER, "abcd1234"),
    );
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).toBe(HOUSE_ACCESS_NOT_GRANTED);
    expect(error.message).not.toContain("violates");
    expect(logged.mock.calls.flat().join(" ")).toContain(raw);
    expect(db.tables.organization_invites[0].used_at).toBeNull();
  });
});
