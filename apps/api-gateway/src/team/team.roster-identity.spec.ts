import { InternalServerErrorException } from "@nestjs/common";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * The roster's names — the defect measured on 2026-09-04, and the shape of it.
 *
 * `/team`'s roster showed "Team member" for every person in the demo tenant.
 * `GET /restaurants/:rid/team/members` returned three rows with
 * `display_name: "Team member"`, `email: null` and `linkedUser: null`, while
 * `GET /restaurants/:rid/members` — a different module, over the SAME three
 * user ids — returned "Demo User", "Sarah Johnson" and "David Chen".
 *
 * The cause is one column name. `public.users` has never had `avatar_url`
 * (baseline `20260805000000_baseline_from_production.sql:5848-5861`; avatars
 * live on `team_members`), and `team.service.ts` asked for it in two places:
 *
 *   - the `listMembers` enrichment, where PostgREST's 42703 arrived as
 *     `data: null` through a destructure that dropped `error`, so every
 *     member came back with no linked identity;
 *   - `ensureRosterFromAccess`, where the same empty map made the name
 *     expression fall through to its last resort and WRITE the literal
 *     "Team member" into a NOT NULL column. Those rows are durable: fixing
 *     the read does not rename them.
 *
 * `restaurants/members.service.ts:101-117` had the identical bug and fixed it;
 * this module did not, which is why the spec below judges the column list
 * against a declared schema rather than trusting the shape of a fixture.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const NEWCOMER = "user-newcomer";

/**
 * `public.users` as the baseline actually creates it — every column, and
 * nothing else. This is what makes the spec able to fail: with the pre-fix
 * `select("user_id, name, email, avatar_url")` the stub answers 42703 exactly
 * as PostgREST did in production, and the two assertions about names go red.
 * Verified against the pre-fix file before this spec was committed.
 */
const USERS_COLUMNS = [
  "user_id",
  "email",
  "password_hash",
  "name",
  "restaurant_id",
  "role",
  "phone",
  "oauth_provider",
  "oauth_id",
  "created_at",
  "updated_at",
  "email_verified",
];

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        {
          id: "a1",
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          is_active: true,
        },
        {
          id: "a2",
          user_id: NEWCOMER,
          restaurant_id: RID,
          role: "staff",
          is_active: true,
        },
      ],
      users: [
        {
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          name: "Demo User",
          email: "demo@example.test",
        },
        {
          user_id: NEWCOMER,
          restaurant_id: RID,
          role: "staff",
          name: "Sarah Johnson",
          email: "sarah@example.test",
        },
      ],
      team_members: [],
      team_settings: [],
    },
    errors,
    { users: USERS_COLUMNS },
  );
}

function service(db: StubDb): TeamService {
  return new TeamService(asDatabaseService(db));
}

describe("TeamService — the roster is named, or says it could not be", () => {
  it("returns the linked account's real name instead of an anonymous row", async () => {
    const db = seed();
    const members = await service(db).listMembers(OWNER, RID);

    // Pre-fix this array was three `linkedUser: null`s, which the page had no
    // way to tell apart from "this person has no account".
    const names = members.map((m: any) => m.linkedUser?.name).sort();
    expect(names).toEqual(["Demo User", "Sarah Johnson"]);
  });

  it("asks `users` only for columns that table has", async () => {
    const db = seed();
    await service(db).listMembers(OWNER, RID);

    const asked = db
      .opsOn("users", "select")
      .flatMap((op) => (op.columns ?? "").split(","))
      .map((c) => c.trim())
      .filter(Boolean);
    expect(asked.length).toBeGreaterThan(0);
    for (const column of asked) expect(USERS_COLUMNS).toContain(column);
  });

  it("writes the real name into the roster row it backfills", async () => {
    const db = seed();
    await service(db).listMembers(OWNER, RID);

    const written = db.tables.team_members.map((m: any) => m.display_name).sort();
    expect(written).toEqual(["Demo User", "Sarah Johnson"]);
    // The whole defect in one assertion.
    expect(written).not.toContain("Team member");
  });

  it("takes the avatar from `team_members`, never from a users column", async () => {
    const db = seed();
    await service(db).listMembers(OWNER, RID);
    for (const m of db.tables.team_members) expect(m.avatar_url).toBeNull();
  });

  it("fails loudly when the identities cannot be read, rather than anonymising the roster", async () => {
    const db = seed({ "users:select": { message: "connection reset" } });
    await expect(service(db).listMembers(OWNER, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("creates no roster row it cannot name when the identity read fails", async () => {
    const db = seed({ "users:select": { message: "connection reset" } });
    await service(db)
      .listMembers(OWNER, RID)
      .catch(() => undefined);

    // The rule this pins: a name nobody chose is worse than a missing row,
    // because the row is durable and the page cannot tell it from a real name.
    expect(db.tables.team_members).toHaveLength(0);
  });
});
