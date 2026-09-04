/**
 * A grant belongs to a person AND is recorded in a house (G21), and the house
 * can let go of it without touching it (ADR 0114).
 *
 * G21, measured 2026-09-03: `listConnections` filtered on `user_id` alone while
 * `restaurant_id` was written on every grant
 * (`integrations-oauth.service.ts:150` on the state row, `:439` on the
 * connection). A Drive grant made while standing in restaurant A was listed
 * while standing in restaurant B — across a tenancy boundary, in a list whose
 * whole job is to say what can act here.
 *
 * Two tenants, one person, and the filter is asserted at the QUERY, because a
 * controller test proves only what the controller passed on.
 *
 * The second half pins the founder's rule of the same day: "a manager may SEE,
 * not approve, what a member has personally connected … and a manager can
 * revoke the HOUSE's access to it while the person keeps the grant for their
 * own use." The enforcement is at `getAccessToken` — the one door feature code
 * uses — and not at a hidden button.
 */

import { ForbiddenException } from "@nestjs/common";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import { DatabaseService } from "../database/database.service";
import { TokenCryptoService } from "../common/crypto/token-crypto.service";

const HOUSE_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

interface Recorded {
  /** Every `.eq(column, value)`, in order. */
  eq: Array<[string, unknown]>;
  /** Every raw `or=` filter string. This is where the tenant scope lives. */
  or: string[];
  /** Every table a query was opened on. */
  tables: string[];
}

function build(rows: Record<string, Record<string, unknown>[]>) {
  const rec: Recorded = { eq: [], or: [], tables: [] };

  const chain = (data: unknown) => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = (c: string, v: unknown) => {
      rec.eq.push([c, v]);
      return self;
    };
    self.is = () => self;
    self.in = () => self;
    self.or = (filter: string) => {
      rec.or.push(filter);
      return self;
    };
    self.delete = () => self;
    self.upsert = () => Promise.resolve({ data: null, error: null });
    self.maybeSingle = () =>
      Promise.resolve({
        data: Array.isArray(data) ? (data[0] ?? null) : data,
        error: null,
      });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : 0 }).then(
        resolve,
      );
    return self;
  };

  const db = {
    client: {
      from: (table: string) => {
        rec.tables.push(table);
        return chain(rows[table] ?? []);
      },
    },
  } as unknown as DatabaseService;

  const crypto = {
    encrypt: (v: string) => `v1.${v}`,
    tryDecrypt: (v: string | null) => (v ? v.replace(/^v1\./, "") : null),
  } as unknown as TokenCryptoService;

  const config = { get: () => undefined };

  return {
    rec,
    service: new IntegrationsOauthService(db, config as never, crypto),
  };
}

describe("listConnections is scoped to the restaurant on the token (G21)", () => {
  it("filters on the house as well as the person", async () => {
    const { service, rec } = build({ integration_oauth_connections: [] });

    await service.listConnections("u-hasan", HOUSE_A);

    expect(rec.eq).toContainEqual(["user_id", "u-hasan"]);
    // The one filter that was missing. `.or` rather than `.eq` because
    // `restaurant_id` is nullable and a grant with no recorded house is a live
    // grant, not an absent one.
    expect(rec.or).toEqual([
      `restaurant_id.eq.${HOUSE_A},restaurant_id.is.null`,
    ]);
  });

  it("asks a DIFFERENT question in a different restaurant", async () => {
    const { service, rec } = build({ integration_oauth_connections: [] });

    await service.listConnections("u-hasan", HOUSE_B);

    expect(rec.or).toEqual([
      `restaurant_id.eq.${HOUSE_B},restaurant_id.is.null`,
    ]);
    // The whole defect in one assertion: house A's filter must not appear when
    // standing in house B.
    expect(rec.or.join(" ")).not.toContain(HOUSE_A);
  });

  it("keeps a grant with no recorded house, and says so on the row", async () => {
    const { service } = build({
      integration_oauth_connections: [
        {
          integration_id: "google_drive",
          provider: "google",
          account_email: "hasan@example.test",
          scopes: ["drive.file"],
          connected_at: "2026-08-22T00:00:00.000Z",
          revoked_at: null,
          restaurant_id: null,
        },
      ],
    });

    const list = await service.listConnections("u-hasan", HOUSE_A);
    const drive = list.find((c) => c.integrationId === "google_drive");

    expect(drive?.connected).toBe(true);
    // Null, not HOUSE_A. Filling it in would invent the attribution the row is
    // there to say it lacks.
    expect(drive?.restaurantId).toBeNull();
  });

  it("asks about the person alone when the session carries no tenant", async () => {
    const { service, rec } = build({ integration_oauth_connections: [] });

    await service.listConnections("u-hasan", null);

    expect(rec.eq).toContainEqual(["user_id", "u-hasan"]);
    expect(rec.or).toEqual([]);
  });

  it("refuses a restaurant id that is not a UUID rather than building a raw filter from it", async () => {
    const { service } = build({ integration_oauth_connections: [] });

    await expect(
      service.listConnections("u-hasan", "*,restaurant_id.not.is.null"),
    ).rejects.toThrow(/not a UUID/);
  });
});

describe("the house's own access to a person's grant", () => {
  const grant = {
    id: "conn-1",
    user_id: "u-selin",
    integration_id: "google_drive",
    provider: "google",
    account_email: "selin@example.test",
    scopes: ["drive.file"],
    connected_at: "2026-08-22T00:00:00.000Z",
    token_expires_at: "2026-09-04T00:00:00.000Z",
  };

  it("shows a manager every grant recorded against the house, with its owner", async () => {
    const { service } = build({
      integration_oauth_connections: [grant],
      users: [{ user_id: "u-selin", name: "Selin Kara", email: "selin@example.test" }],
      restaurant_personal_grant_access: [],
      user_restaurant_access: [],
    });

    const { grants } = await service.listHouseGrants(HOUSE_A);

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      ownerName: "Selin Kara",
      integrationId: "google_drive",
      // Stored since 20260826170000:138 and read by no surface until now.
      tokenExpiresAt: "2026-09-04T00:00:00.000Z",
      houseAccess: { revoked: false },
    });
  });

  it("marks a grant the house has cut itself off from, with who and why", async () => {
    const { service } = build({
      integration_oauth_connections: [grant],
      users: [
        { user_id: "u-selin", name: "Selin Kara", email: "selin@example.test" },
        { user_id: "u-hasan", name: "Hasan Demir", email: "hasan@example.test" },
      ],
      restaurant_personal_grant_access: [
        {
          connection_id: "conn-1",
          revoked_at: "2026-09-03T08:00:00.000Z",
          revoked_by: "u-hasan",
          reason: "exports move to the house folder",
        },
      ],
      user_restaurant_access: [],
    });

    const { grants } = await service.listHouseGrants(HOUSE_A);

    expect(grants[0].houseAccess).toMatchObject({
      revoked: true,
      by: "u-hasan",
      reason: "exports move to the house folder",
    });
  });

  it("REFUSES a token for a grant the house has let go of", async () => {
    const { service } = build({
      integration_oauth_connections: [
        { ...grant, access_token_encrypted: "v1.tok", refresh_token_encrypted: null },
      ],
      restaurant_personal_grant_access: [
        {
          connection_id: "conn-1",
          revoked_at: "2026-09-03T08:00:00.000Z",
          revoked_by: "u-hasan",
          reason: "exports move to the house folder",
        },
      ],
    });

    // This is what makes the control real rather than decorative: the refusal
    // is at the single door feature code uses, so a caller cannot route round
    // it by not looking at the page.
    await expect(
      service.getAccessToken("u-selin", HOUSE_A, "google_drive"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getAccessToken("u-selin", HOUSE_A, "google_drive"),
    ).rejects.toThrow(/still belongs to the person who made it/i);
  });

  it("hands the token over when the house has not let go", async () => {
    const { service } = build({
      integration_oauth_connections: [
        {
          ...grant,
          access_token_encrypted: "v1.tok",
          refresh_token_encrypted: null,
          token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
      restaurant_personal_grant_access: [],
    });

    await expect(
      service.getAccessToken("u-selin", HOUSE_A, "google_drive"),
    ).resolves.toBe("tok");
  });
});
