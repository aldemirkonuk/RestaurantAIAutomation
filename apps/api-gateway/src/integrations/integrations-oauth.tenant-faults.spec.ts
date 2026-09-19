/**
 * Two faults on the grant routes the new pages read, each reproduced against
 * the code BEFORE it was changed (endpoint-faults wave, 2026-09-12; report at
 * p4-scratch/endpoint-faults/integrations-oauth.md).
 *
 *   1. `DELETE /integrations/oauth/:integrationId` took no tenant. The
 *      controller passed only the person, and `disconnect` looked the grant up
 *      by `(user_id, integration_id)` alone. A person whose token says house B
 *      revoked, at Google, the grant recorded against house A, and for a
 *      mirroring grant swept house A's raw mail, from a session scoped to B.
 *
 *   2. `GET /integrations/oauth/connections` logged a failed read and returned
 *      `[]`. The controller then served that as a success, and every consumer
 *      renders it as "nothing connected". A failed read must refuse, not answer.
 *
 * The provider revoke is irreversible, so the refusal in (1) is asserted to
 * happen BEFORE `fetch` is reached, not merely before the local update.
 */

import {
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { IntegrationsOauthController } from "./integrations-oauth.controller";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import type { DatabaseService } from "../database/database.service";
import type { TokenCryptoService } from "../common/crypto/token-crypto.service";
import type { RawMailRetentionService } from "../communications/retention/raw-mail-retention.service";
import type { OrganizationsService } from "../organizations/organizations.service";

const HOUSE_A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Row = Record<string, unknown>;

function build(opts: {
  row?: Row | null;
  readError?: { message: string } | null;
}) {
  const updates: Row[] = [];
  const sweeps: Array<{
    connectionId: string;
    restaurantId: string | null;
    ownerUserId: string | null;
  }> = [];

  const chain = () => {
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.is = pass;
    self.or = pass;
    self.in = pass;
    self.update = (body: Row) => {
      updates.push(body);
      return self;
    };
    self.maybeSingle = () =>
      Promise.resolve({
        data: opts.readError ? null : (opts.row ?? null),
        error: opts.readError ?? null,
      });
    self.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: opts.readError ? null : opts.row ? [opts.row] : [],
        error: opts.readError ?? null,
      }).then(resolve, reject);
    return self;
  };

  const db = { client: { from: () => chain() } } as unknown as DatabaseService;
  const config = { get: () => undefined } as unknown as ConfigService;
  const crypto = {
    isConfigured: true,
    encrypt: (v: string) => `v1.${v}`,
    tryDecrypt: (v: string | null) => (v ? v.replace(/^v1\./, "") : null),
  } as unknown as TokenCryptoService;
  const retention = {
    sweepForRevokedGrant: jest.fn(async (p: (typeof sweeps)[number]) => {
      sweeps.push(p);
      return { says: "swept", deleted: 0 };
    }),
  } as unknown as RawMailRetentionService;

  const service = new IntegrationsOauthService(db, config, crypto, retention);
  return { service, updates, sweeps };
}

/** A live grant with a real refresh token, so the provider revoke IS reachable. */
function grant(restaurantId: string | null, extra: Row = {}): Row {
  return {
    id: GRANT,
    provider: "google",
    restaurant_id: restaurantId,
    refresh_token_encrypted: "v1.refresh",
    access_token_encrypted: "v1.access",
    ...extra,
  };
}

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("fault 1: DELETE /integrations/oauth/:integrationId is scoped to the house on the token", () => {
  it("the controller hands the service the tenant from the token", async () => {
    const disconnect = jest.fn(async () => ({ success: true, retention: null }));
    const controller = new IntegrationsOauthController(
      { disconnect } as unknown as IntegrationsOauthService,
      {} as OrganizationsService,
      {} as never,
    );

    await controller.disconnect(
      { user: { userId: PERSON, restaurantId: HOUSE_B } } as never,
      "google_drive",
    );

    expect(disconnect).toHaveBeenCalledWith(PERSON, "google_drive", HOUSE_B);
  });

  it("REFUSES a person standing in house B the grant recorded against house A, before the provider revoke", async () => {
    const { service, updates, sweeps } = build({ row: grant(HOUSE_A) });

    await expect(
      service.disconnect(PERSON, "gmail_read", HOUSE_B),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Nothing irreversible happened: no revoke at Google, no local revoke, and
    // house A's mirrored mail was not swept from a session scoped to house B.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(sweeps).toHaveLength(0);
  });

  it("REFUSES a session with no tenant the grant recorded against a house", async () => {
    const { service, updates, sweeps } = build({ row: grant(HOUSE_A) });

    await expect(
      service.disconnect(PERSON, "gmail_read", null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(sweeps).toHaveLength(0);
  });

  it("still revokes the grant recorded against the house the person stands in", async () => {
    const { service, updates, sweeps } = build({ row: grant(HOUSE_A) });

    await expect(
      service.disconnect(PERSON, "gmail_read", HOUSE_A),
    ).resolves.toMatchObject({ success: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(sweeps).toEqual([
      { connectionId: GRANT, restaurantId: HOUSE_A, ownerUserId: PERSON },
    ]);
  });

  it("still revokes a grant with no recorded house, which /connections lists in every house", async () => {
    const { service, updates } = build({ row: grant(null) });

    await expect(
      service.disconnect(PERSON, "google_drive", HOUSE_B),
    ).resolves.toMatchObject({ success: true });
    expect(updates).toHaveLength(1);
  });

  it("still revokes a grant with no recorded house from a session with no tenant", async () => {
    const { service, updates } = build({ row: grant(null) });

    await expect(
      service.disconnect(PERSON, "google_drive", null),
    ).resolves.toMatchObject({ success: true });
    expect(updates).toHaveLength(1);
  });
});

describe("fault 2: GET /integrations/oauth/connections never reports a failed read as nothing connected", () => {
  it("the service REFUSES on a database error instead of answering", async () => {
    const { service } = build({
      readError: { message: "connection terminated unexpectedly" },
    });

    await expect(
      service.listConnections(PERSON, HOUSE_A),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("the route does not serve connected:false for every integration on a failed read", async () => {
    const { service } = build({
      readError: { message: "connection terminated unexpectedly" },
    });
    const controller = new IntegrationsOauthController(
      service,
      {} as OrganizationsService,
      {} as never,
    );

    await expect(
      controller.connections({
        user: { userId: PERSON, restaurantId: HOUSE_A },
      } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("a genuinely empty read still answers, one not-connected row per integration", async () => {
    const { service } = build({ row: null });

    const list = await service.listConnections(PERSON, HOUSE_A);

    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.connected === false)).toBe(true);
  });
});
