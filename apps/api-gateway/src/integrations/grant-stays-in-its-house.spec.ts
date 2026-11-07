import {
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { TokenCryptoService } from "../common/crypto/token-crypto.service";
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
import {
  GRANT_HELD_IN_ANOTHER_HOUSE,
  IntegrationsOauthService,
} from "./integrations-oauth.service";
import { INTEGRATION_DEFINITIONS } from "./integrations-oauth.constants";

/**
 * Connecting an integration in a second house does not take it from the
 * first (QA round 11, R11-05).
 *
 * `integration_oauth_connections` is UNIQUE (user_id, integration_id) and
 * `storeConnection` upserts on that key, so a manager of two houses who
 * connected Drive in house B overwrote the row's `restaurant_id`: house A's
 * list went empty and its mail archive stopped. The connect is now refused in
 * B while A holds a live grant -- at the start, before a receipt is filed or a
 * provider flow opens, and again at the write.
 *
 * PRE-FIX PROOF: with `grantHeldInAnotherHouse` returning false, the "refused
 * at the start" case opens a flow (receipt filed) and the "refused at the
 * write" case moves the row to house B, and the callback case exchanges the code --
 * all three fail. The same-house, revoked
 * and houseless cases pass both ways.
 */

const A = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const B = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";

const consent = {
  sealId: "11111111-1111-4111-8111-111111111111",
  snapshot: { words: "Reviewed words" },
  digest: "d".repeat(64),
  browserProofHash: "a".repeat(64),
  browserRequestId: "22222222-2222-4222-8222-222222222222",
  frontendOrigin: "https://app.example.test",
};

function grant(over: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    user_id: "u1",
    restaurant_id: A,
    provider: "google",
    integration_id: "google_drive",
    account_email: "chef@bistro.com",
    revoked_at: null,
    ...over,
  };
}

function service(
  connections: Record<string, unknown>[],
  errors: Record<string, { message: string }> = {},
) {
  const db = makeStubDb(
    {
      integration_oauth_connections: connections,
      integration_consent_receipts: [],
      integration_oauth_states: [],
    },
    errors,
  );
  const settings: Record<string, string> = {
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    FRONTEND_URL: "https://app.example.test",
    API_PUBLIC_URL: "https://api.example.test",
  };
  const crypto = {
    isConfigured: true,
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ""),
    tryDecrypt: (v: string | null | undefined) =>
      typeof v === "string" ? v.replace(/^enc:/, "") : null,
  } as unknown as TokenCryptoService;
  const svc = new IntegrationsOauthService(
    asDatabaseService(db),
    { get: (k: string) => settings[k] } as unknown as ConfigService,
    crypto,
  );
  return { db, svc };
}

const start = (svc: IntegrationsOauthService, restaurantId: string) =>
  svc.createAuthorizationUrl({
    userId: "u1",
    restaurantId,
    integrationId: "google_drive",
    consent,
  });

const store = (svc: IntegrationsOauthService, restaurantId: string) =>
  (svc as any).storeConnection({
    userId: "u1",
    restaurantId,
    definition: INTEGRATION_DEFINITIONS.google_drive,
    tokens: { access_token: "at-new", refresh_token: "rt-new" },
    account: "chef@bistro.com",
    consentReceiptId: "receipt-b",
  });

describe("an integration connected in one house is not moved by a connect in another (R11-05)", () => {
  it("refused at the start: no receipt filed, no flow opened, house A keeps it", async () => {
    const { db, svc } = service([grant()]);

    const err = await start(svc, B).then(
      () => null,
      (e) => e,
    );

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(GRANT_HELD_IN_ANOTHER_HOUSE);
    expect(db.tables.integration_consent_receipts).toHaveLength(0);
    expect(db.tables.integration_oauth_states).toHaveLength(0);
    expect(db.tables.integration_oauth_connections[0].restaurant_id).toBe(A);
  });

  it("refused at the write: a flow already open in B does not move the row", async () => {
    const { db, svc } = service([grant()]);

    await expect(store(svc, B)).rejects.toMatchObject({
      reason: "connected_in_another_house",
    });
    const row = db.tables.integration_oauth_connections[0];
    expect(row.restaurant_id).toBe(A);
    expect(row.consent_receipt_id).toBeUndefined();
  });

  it("the same house reconnects as before", async () => {
    const { db, svc } = service([grant()]);
    await expect(start(svc, A)).resolves.toHaveProperty("authorizationUrl");
    await store(svc, A);
    expect(db.tables.integration_oauth_connections).toHaveLength(1);
    expect(db.tables.integration_oauth_connections[0]).toMatchObject({
      restaurant_id: A,
      consent_receipt_id: "receipt-b",
    });
  });

  it("a revoked grant elsewhere does not block", async () => {
    const { svc } = service([grant({ revoked_at: "2026-11-01T00:00:00Z" })]);
    await expect(start(svc, B)).resolves.toHaveProperty("authorizationUrl");
  });

  it("a legacy grant with no house does not block", async () => {
    const { svc } = service([grant({ restaurant_id: null })]);
    await expect(start(svc, B)).resolves.toHaveProperty("authorizationUrl");
  });

  it("refused at the callback, before the code is exchanged: no token is minted", async () => {
    const { db, svc } = service([grant()]);
    const exchange = jest.fn();
    Object.assign(svc as any, {
      consumeBrowserState: jest.fn().mockResolvedValue({
        user_id: "u1",
        restaurant_id: B,
        integration_id: "google_drive",
        frontend_origin: "https://app.example.test",
        return_path: "/settings",
        callback_payload_encrypted: `enc:${JSON.stringify({ code: "c" })}`,
        pkce_verifier_encrypted: "enc:v",
        consent_receipt_id: "receipt-b",
      }),
      assertConsentMembership: jest.fn().mockResolvedValue(undefined),
      exchangeCode: exchange,
    });

    const { destination } = await svc.completeCallback({
      state: "s",
      browserProof: "p",
      deliverySecret: "d",
    });

    expect(destination).toContain("connected_in_another_house");
    expect(exchange).not.toHaveBeenCalled();
    expect(db.tables.integration_oauth_connections[0].restaurant_id).toBe(A);
  });

  it("an unreadable answer refuses rather than guessing", async () => {
    const { db, svc } = service([], {
      "integration_oauth_connections:select": { message: "db down" },
    });
    await expect(start(svc, B)).rejects.toThrow(ServiceUnavailableException);
    expect(db.tables.integration_consent_receipts).toHaveLength(0);
  });
});
