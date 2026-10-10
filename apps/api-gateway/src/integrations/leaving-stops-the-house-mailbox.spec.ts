import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { MembersService } from "../restaurants/members.service";
import { TeamService } from "../team/team.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import { stopGrantsOnLeaving } from "./stop-grants-on-leaving";

/**
 * F-458 and F-459 (sim wave 11, house-lifecycle report, 2026-10-09).
 *
 * F-458: no removal door touched `integration_oauth_connections`, so a removed
 * manager's Gmail kept sending the house's letters and the inbox kept reading
 * their mailbox. Every door that ends a membership now stops the person's
 * grants in that house (driven here for real, over the filter-honouring stub,
 * the same way `calendar/calendar-links-leaving.spec.ts` drives the calendar
 * stop), and `getAccessToken` — the one door every mail path takes its token
 * from — refuses a grant whose owner no longer works in the house.
 *
 * F-459: a grant is UNIQUE (user_id, integration_id), so connecting Gmail in
 * house B rewrote its house and took house A's sender away in silence. The
 * second connect is now refused, before Google is asked, naming house A.
 */

const A = "house-a";
const B = "house-b";
const OWNER_B = "user-owner-b";
const OWNER2_B = "user-owner2-b";
const MANAGER_B = "user-manager-b";
const P = "user-p";

type Row = Record<string, any>;

function grant(
  user: string,
  house: string | null,
  integration: string,
): Row {
  return {
    id: `grant-${user}-${integration}`,
    user_id: user,
    restaurant_id: house,
    provider: "google",
    integration_id: integration,
    account_email: `${user}@mail.test`,
    scopes: [],
    access_token_encrypted: `v1.tok-${user}-${integration}`,
    refresh_token_encrypted: `v1.ref-${user}-${integration}`,
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
  };
}

/**
 * House B: two owners, a manager, and P. P is staff of B and also of A. P's
 * Gmail sending was connected in B, P's Gmail reading in A; the manager's
 * Gmail sending in B.
 */
function world(opts: { pByUsersRowOnly?: boolean } = {}): StubDb {
  const access: Row[] = [
    { user_id: OWNER_B, restaurant_id: B, role: "owner", is_active: true },
    { user_id: OWNER2_B, restaurant_id: B, role: "owner", is_active: true },
    { user_id: MANAGER_B, restaurant_id: B, role: "manager", is_active: true },
    { user_id: P, restaurant_id: A, role: "staff", is_active: true },
  ];
  if (!opts.pByUsersRowOnly) {
    access.push({ user_id: P, restaurant_id: B, role: "staff", is_active: true });
  }
  return makeStubDb({
    user_restaurant_access: access,
    users: [
      { user_id: OWNER_B, restaurant_id: B, role: "owner", email: "o@b.test" },
      { user_id: OWNER2_B, restaurant_id: B, role: "owner", email: "o2@b.test" },
      { user_id: MANAGER_B, restaurant_id: B, role: "manager", email: "m@b.test" },
      { user_id: P, restaurant_id: B, role: "staff", email: "p@b.test" },
    ],
    team_members: [
      { id: "m-p", restaurant_id: B, user_id: P, display_name: "Pat" },
      { id: "m-o", restaurant_id: B, user_id: OWNER_B, display_name: "Olga" },
    ],
    restaurants: [
      { id: A, name: "Tuzlu Rüzgar", timezone: "UTC", organization_id: "org-1" },
      { id: B, name: "House B", timezone: "UTC", organization_id: "org-1" },
    ],
    integration_oauth_connections: [
      grant(P, B, "gmail_send"),
      grant(P, A, "gmail_read"),
      grant(MANAGER_B, B, "gmail_send"),
    ],
    restaurant_personal_grant_access: [],
    integration_consent_receipts: [],
    integration_oauth_states: [],
    calendar_feed_links: [],
    calendar_events: [],
    calendar_recurrence_rules: [],
    shifts: [],
    schedules: [],
    organization_invites: [],
    organization_members: [],
    user_oauth_accounts: [],
    system_audit_log: [],
    notifications: [],
  });
}

function services(db: StubDb) {
  const auth = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
    { sendEmail: async () => undefined } as any,
  );
  const team = new TeamService(asDatabaseService(db));
  const members = new MembersService(asDatabaseService(db), undefined, team);
  (auth as any).moduleRef = { get: () => members };
  const settings: Record<string, string> = {
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    FRONTEND_URL: "https://app.example.test",
    API_PUBLIC_URL: "https://api.example.test",
  };
  const oauth = new IntegrationsOauthService(
    asDatabaseService(db),
    { get: (k: string) => settings[k] } as any,
    {
      isConfigured: true,
      encrypt: (v: string) => `v1.${v}`,
      decrypt: (v: string) => v.replace(/^v1\./, ""),
      tryDecrypt: (v: string | null) => (v ? v.replace(/^v1\./, "") : null),
    } as any,
  );
  return { auth, members, team, oauth };
}

const grantOf = (db: StubDb, user: string, integration: string) =>
  db.tables.integration_oauth_connections.find(
    (r) => r.user_id === user && r.integration_id === integration,
  )!;

const stopAudits = (db: StubDb) =>
  db.tables.system_audit_log.filter(
    (r) => r.action === "integration_grant_stopped",
  );

function expectStopped(db: StubDb, actor: string, via: string, house = B) {
  const integration = house === B ? "gmail_send" : "gmail_read";
  const row = grantOf(db, P, integration);
  expect(row.revoked_at).toEqual(expect.any(String));
  // Our copy of the tokens is gone: nothing left to send or read with.
  expect(row.access_token_encrypted).toBeNull();
  expect(row.refresh_token_encrypted).toBeNull();
  const audit = stopAudits(db).find((r) => r.entity_id === row.id);
  expect(audit).toMatchObject({
    actor_type: "user",
    actor_id: actor,
    entity_type: "integration_grant",
    restaurant_id: house,
    reason: "left_house",
    changes: { for_user_id: P, integration_id: integration, via },
  });
  expect(JSON.stringify(audit)).not.toContain("tok-");
}

function expectNobodyElseTouched(db: StubDb) {
  expect(grantOf(db, MANAGER_B, "gmail_send").revoked_at).toBeNull();
  // P's grant in the OTHER house is that house's, and P still works there.
  expect(grantOf(db, P, "gmail_read").revoked_at).toBeNull();
  expect(grantOf(db, P, "gmail_read").access_token_encrypted).not.toBeNull();
}

describe("F-458: every door that ends a membership stops the leaver's grants in that house", () => {
  it("Settings' remove (MembersService.removeMember), by a manager", async () => {
    const db = world();
    await services(db).members.removeMember(MANAGER_B, B, P);
    expectStopped(db, MANAGER_B, "MembersService.removeMember");
    expectNobodyElseTouched(db);
  });

  it("Settings' remove of a member known only by their users row", async () => {
    const db = world({ pByUsersRowOnly: true });
    await services(db).members.removeMember(OWNER_B, B, P);
    expectStopped(db, OWNER_B, "MembersService.removeMember");
    expectNobodyElseTouched(db);
  });

  it("the Team page's remove (TeamService.deleteMember)", async () => {
    const db = world();
    await services(db).team.deleteMember(MANAGER_B, B, "m-p");
    expectStopped(db, MANAGER_B, "TeamService.deleteMember");
    expectNobodyElseTouched(db);
  });

  it("leaving on your own (AuthService.leaveRestaurant)", async () => {
    const db = world();
    await services(db).auth.leaveRestaurant(P, B);
    expectStopped(db, P, "MembersService.removeMember");
    expectNobodyElseTouched(db);
  });

  it("deleting your account (AuthService.deleteAccount) stops your grants in every house", async () => {
    const db = world();
    await services(db).auth.deleteAccount(P);
    expectStopped(db, P, "MembersService.removeMember", B);
    expectStopped(db, P, "MembersService.removeMember", A);
    expect(grantOf(db, MANAGER_B, "gmail_send").revoked_at).toBeNull();
  });

  it("stops the grant BEFORE the first membership write, so a leaver never keeps a live one", async () => {
    const db = world();
    await services(db).members.removeMember(MANAGER_B, B, P);
    const stop = db.ops.findIndex(
      (o) => o.table === "integration_oauth_connections" && o.op === "update",
    );
    const firstMembershipWrite = db.ops.findIndex(
      (o) =>
        (o.table === "user_restaurant_access" && o.op !== "select") ||
        (o.table === "users" && o.op === "update"),
    );
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(stop).toBeLessThan(firstMembershipWrite);
  });

  it("a stop that fails changes nothing, and says so", async () => {
    const db = world();
    db.errors["integration_oauth_connections:update"] = { message: "down" };
    await expect(
      services(db).members.removeMember(MANAGER_B, B, P),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(
      db.tables.user_restaurant_access.some(
        (r) => r.user_id === P && r.restaurant_id === B && r.is_active,
      ),
    ).toBe(true);
  });

  it("a refused removal stops nobody's grant", async () => {
    const db = world();
    await expect(
      services(db).members.removeMember(MANAGER_B, B, OWNER_B),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(stopAudits(db)).toHaveLength(0);
    expect(
      db.tables.integration_oauth_connections.every((r) => r.revoked_at === null),
    ).toBe(true);
  });

  it("never calls Google: the stop is local", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as any);
    const db = world();
    await stopGrantsOnLeaving(db.supabase, { error: () => undefined } as any, {
      restaurantId: B,
      userId: P,
      actorUserId: OWNER_B,
      via: "TeamService.deleteMember",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("F-458, defence in depth: the token door refuses a grant whose owner no longer works here", () => {
  it("a membership ended outside the doors: the grant stays live, but no token leaves", async () => {
    const db = world();
    // Nobody ran a removal door: the access row was switched off by hand.
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === P && r.restaurant_id === B,
    )!.is_active = false;
    const { oauth } = services(db);
    await expect(oauth.getAccessToken(P, B, "gmail_send")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // The inbox files this as the house having stopped (house-inbox.service.ts).
    await expect(oauth.getAccessToken(P, B, "gmail_send")).rejects.toThrow(
      /no longer works in this restaurant, so this restaurant has stopped using it/,
    );
  });

  it("a lapsed valid_until counts as gone", async () => {
    const db = world();
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === P && r.restaurant_id === B,
    )!.valid_until = "2020-01-01T00:00:00.000Z";
    await expect(
      services(db).oauth.getAccessToken(P, B, "gmail_send"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a person who still works here gets their token", async () => {
    const db = world();
    await expect(
      services(db).oauth.getAccessToken(MANAGER_B, B, "gmail_send"),
    ).resolves.toBe(`tok-${MANAGER_B}-gmail_send`);
  });

  it("a membership that cannot be read is not an answer either way", async () => {
    const db = world();
    db.errors["user_restaurant_access:select"] = { message: "down" };
    await expect(
      services(db).oauth.getAccessToken(MANAGER_B, B, "gmail_send"),
    ).rejects.toThrow(/could not be read/);
  });
});

describe("F-459: connecting a grant in a second house never takes it from the first in silence", () => {
  const consent = {
    sealId: "11111111-1111-4111-8111-111111111111",
    snapshot: { words: "Reviewed words" },
    digest: "d".repeat(64),
    browserProofHash: "a".repeat(64),
    browserRequestId: "22222222-2222-4222-8222-222222222222",
    frontendOrigin: "https://app.example.test",
  };

  it("refuses before Google is asked, naming the house that would lose it", async () => {
    const db = world();
    const { oauth } = services(db);
    // P's Gmail reading lives in A (Tuzlu Rüzgar); P now asks for it in B.
    const attempt = oauth.createAuthorizationUrl({
      userId: P,
      restaurantId: B,
      integrationId: "gmail_read" as any,
      consent,
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(
      oauth.createAuthorizationUrl({
        userId: P,
        restaurantId: B,
        integrationId: "gmail_read" as any,
        consent,
      }),
    ).rejects.toThrow(/connected for Tuzlu Rüzgar.*take it away from Tuzlu Rüzgar/);
    // No receipt, no state: no provider flow was opened.
    expect(db.tables.integration_consent_receipts).toHaveLength(0);
    expect(db.tables.integration_oauth_states).toHaveLength(0);
    expect(grantOf(db, P, "gmail_read").restaurant_id).toBe(A);
  });

  it("lets it through when the person no longer works in the house that has it", async () => {
    const db = world();
    db.tables.user_restaurant_access = db.tables.user_restaurant_access.filter(
      (r) => !(r.user_id === P && r.restaurant_id === A),
    );
    const { authorizationUrl } = await services(db).oauth.createAuthorizationUrl({
      userId: P,
      restaurantId: B,
      integrationId: "gmail_read" as any,
      consent,
    });
    expect(authorizationUrl).toContain("accounts.google.com");
  });

  it("lets a reconnect in the same house through", async () => {
    const db = world();
    const { authorizationUrl } = await services(db).oauth.createAuthorizationUrl({
      userId: P,
      restaurantId: B,
      integrationId: "gmail_send" as any,
      consent,
    });
    expect(authorizationUrl).toContain("accounts.google.com");
  });

  it("lets a grant with no recorded house be attached here", async () => {
    const db = world();
    grantOf(db, P, "gmail_read").restaurant_id = null;
    const { authorizationUrl } = await services(db).oauth.createAuthorizationUrl({
      userId: P,
      restaurantId: B,
      integrationId: "gmail_read" as any,
      consent,
    });
    expect(authorizationUrl).toContain("accounts.google.com");
  });
});
