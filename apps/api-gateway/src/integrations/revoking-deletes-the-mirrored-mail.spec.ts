/**
 * Revoking a reading grant deletes the raw mail it mirrored (ADR 0118,
 * retention, decided 2026-09-05).
 *
 * The consent screen makes one promise with two halves — "stop reads AND
 * delete the raw mail" — and the half that is easy to ship and easy to lose is
 * the second. Four things:
 *
 *   1. DISCONNECTING A MIRRORING GRANT SWEEPS IT, scoped to that connection.
 *   2. DISCONNECTING A NON-MIRRORING GRANT SWEEPS NOTHING. `gmail_send` is a
 *      Gmail grant that reads nothing and stores no raw mail; a rule keyed on
 *      the id's prefix would delete on revoking it and make the promise
 *      describe an act that never happens.
 *   3. THE DELETION IS NOT OPTIONAL IN PRACTICE. With no retention service in
 *      the injector, `disconnect` REFUSES rather than returning success for a
 *      revocation whose second half silently did not run.
 *   4. THE SWEEP RUNS AFTER THE LOCAL REVOKE, so a failure there leaves a dead
 *      grant rather than a live reader refilling what was just deleted.
 *
 * A separate file from `integrations-oauth.service.spec.ts` on purpose: that
 * file belongs to the OAuth handshake and this branch is a retention rule that
 * happens to hang off it.
 */

import { InternalServerErrorException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import { MIRRORING_INTEGRATION_IDS } from "./integrations-oauth.constants";
import type { DatabaseService } from "../database/database.service";
import type { TokenCryptoService } from "../common/crypto/token-crypto.service";
import type { RawMailRetentionService } from "../communications/retention/raw-mail-retention.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";

function build(row: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const order: string[] = [];

  const chain = () => {
    const self: Record<string, unknown> = {};
    const pass = () => self;
    self.select = pass;
    self.eq = pass;
    self.is = pass;
    self.limit = pass;
    self.update = (body: Record<string, unknown>) => {
      updates.push(body);
      order.push("local_revoke");
      return self;
    };
    self.maybeSingle = () => Promise.resolve({ data: row, error: null });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve);
    return self;
  };

  const db = {
    client: { from: () => chain() },
  } as unknown as DatabaseService;

  const config = {
    get: () => undefined,
  } as unknown as ConfigService;

  const crypto = {
    isConfigured: true,
    encrypt: (v: string) => `enc:${v}`,
    // No token, so `revokeAtProvider` (and its `fetch`) is never reached.
    tryDecrypt: () => null,
  } as unknown as TokenCryptoService;

  return { db, config, crypto, updates, order };
}

function retentionStub(order: string[]) {
  const calls: Array<{
    connectionId: string;
    restaurantId: string | null;
    ownerUserId: string | null;
  }> = [];
  const service = {
    sweepForRevokedGrant: jest.fn(async (p: (typeof calls)[number]) => {
      calls.push(p);
      order.push("sweep");
      return {
        restaurantId: p.restaurantId,
        reason: "grant_revoked" as const,
        connectionId: p.connectionId,
        considered: 2,
        deleted: 2,
        attachmentsDeleted: 1,
        windowDays: null,
        notice: "told",
        error: null,
        says: "two replies deleted",
      };
    }),
  } as unknown as RawMailRetentionService;
  return { service, calls };
}

const LIVE_GRANT = {
  id: GRANT,
  provider: "google",
  restaurant_id: HOUSE,
  refresh_token_encrypted: null,
  access_token_encrypted: null,
};

describe("disconnecting a grant that mirrors mail", () => {
  it("names exactly which grants mirror, and gmail_send is not one", () => {
    expect(MIRRORING_INTEGRATION_IDS).toEqual(["gmail_read"]);
  });

  it("sweeps the raw mail, scoped to that connection, after the local revoke", async () => {
    const { db, config, crypto, order } = build(LIVE_GRANT);
    const retention = retentionStub(order);
    const service = new IntegrationsOauthService(
      db,
      config,
      crypto,
      retention.service,
    );

    const result = await service.disconnect(PERSON, "gmail_read");

    expect(retention.calls).toEqual([
      { connectionId: GRANT, restaurantId: HOUSE, ownerUserId: PERSON },
    ]);
    expect((result as { retention: { deleted: number } }).retention.deleted).toBe(
      2,
    );
    // Revoke first, delete second: deleting first and then failing to revoke
    // would leave a live reader refilling what was just deleted.
    expect(order).toEqual(["local_revoke", "sweep"]);
  });

  it("sweeps nothing when the grant does not mirror mail", async () => {
    const { db, config, crypto, order } = build({
      ...LIVE_GRANT,
      id: "another",
    });
    const retention = retentionStub(order);
    const service = new IntegrationsOauthService(
      db,
      config,
      crypto,
      retention.service,
    );

    const result = await service.disconnect(PERSON, "gmail_send");

    expect(retention.calls).toHaveLength(0);
    expect((result as { retention: unknown }).retention).toBeNull();
  });

  it("REFUSES rather than reporting a revocation whose deletion did not run", async () => {
    const { db, config, crypto } = build(LIVE_GRANT);
    // No retention service: the shape `CommunicationsModule` gets when it
    // provides this class bare from its file.
    const service = new IntegrationsOauthService(db, config, crypto);

    await expect(service.disconnect(PERSON, "gmail_read")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(service.disconnect(PERSON, "gmail_read")).rejects.toThrow(
      /was NOT deleted/,
    );
  });
});
