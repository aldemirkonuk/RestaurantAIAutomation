import { createHash } from 'crypto';
import { validate } from 'class-validator';
import { IntegrationConsentService } from './integration-consent.service';
import { IntegrationsOauthService, RedeemedIntegrationConsent } from './integrations-oauth.service';
import { IntegrationConsentChallengeDto, IntegrationConsentCompleteDto } from './integration-consent.dto';
import { hashCallArgs, hashSealToken } from '../common/seal/seal-token';

const USER = '11111111-1111-4111-8111-111111111111';
const HOUSE = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const PROOF = 'a'.repeat(64);
const SEAL = '44444444-4444-4444-8444-444444444444';
const STATE = 's'.repeat(43);
// A stand-in "already parked" delivery secret for tests that push a parked
// row directly rather than going through handleCallback. Tests that need the
// REAL secret a given callback minted read it off that call's own returned
// destination fragment with deliveryFrom(), never this constant, because the
// whole point of KL audit D1's fix is that this value is unguessable ahead of
// the callback that mints it.
const DELIVERY = 'e'.repeat(64);

/** The `delivery` fragment param handleCallback's destination carries. */
function deliveryFrom(destination: string): string {
  const value = new URL(destination).hash.slice(1);
  return new URLSearchParams(value).get('delivery') ?? '';
}
const consent: RedeemedIntegrationConsent = {
  sealId: SEAL, snapshot: { exact: 'Permission words' }, digest: 'd'.repeat(64),
  browserProofHash: hashSealToken(PROOF), browserRequestId: REQUEST,
  frontendOrigin: 'https://app.example.test',
};

/** Query double executes filters at mutation time, including the consumed-at
 * predicate. This makes racing requests exercise the actual service sequence. */
function fixture() {
  const tables: Record<string, any[]> = {
    integration_oauth_states: [], integration_consent_receipts: [], integration_oauth_connections: [],
    users: [{ user_id: USER, restaurant_id: HOUSE, email_verified: true }],
    user_restaurant_access: [{ user_id: USER, restaurant_id: HOUSE, is_active: true, role: "staff" }],
  };
  const faults = new Set<string>();
  const calls: { table: string; action: string; payload?: any }[] = [];
  const db = { client: { from(table: string) {
    let action = 'select'; let payload: any; const filters: ((row: any) => boolean)[] = [];
    const run = () => {
      calls.push({ table, action, payload });
      if (faults.has(`${table}:${action}`)) return { data: null, error: { message: 'database unavailable' } };
      const rows = tables[table] ?? (tables[table] = []);
      if (action === 'insert') {
        if (table === 'integration_consent_receipts' && rows.some(row => row.seal_id === payload.seal_id)) return { data: null, error: { code: '23505' } };
        rows.push(structuredClone(payload)); return { data: null, error: null };
      }
      if (action === 'upsert') { rows.push(structuredClone(payload)); return { data: null, error: null }; }
      const found = rows.filter(row => filters.every(matches => matches(row)));
      if (action === 'update') found.forEach(row => Object.assign(row, structuredClone(payload)));
      return { data: structuredClone(found), error: null };
    };
    const query: any = {
      select: () => query,
      insert: (value: any) => { action = 'insert'; payload = value; return query; },
      update: (value: any) => { action = 'update'; payload = value; return query; },
      upsert: (value: any) => { action = 'upsert'; payload = value; return query; },
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: any) => { filters.push(row => (row[key] ?? null) === value); return query; },
      gt: (key: string, value: any) => { filters.push(row => row[key] > value); return query; },
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
    };
    return query;
  } } };
  const settings: Record<string, string> = {
    FRONTEND_URL: 'https://app.example.test,https://preview.example.test', API_PUBLIC_URL: 'https://api.example.test',
    GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret',
    MICROSOFT_CLIENT_ID: 'microsoft-id', MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
  };
  const crypto = { isConfigured: true, encrypt: jest.fn((text: string) => `enc:${text}`), decrypt: (text: string) => text.slice(4), tryDecrypt: () => null };
  const oauth = new IntegrationsOauthService(db as never, { get: (key: string) => settings[key] } as never, crypto as never);
  const row = {
    state: STATE, user_id: USER, restaurant_id: HOUSE, provider: 'google', integration_id: 'gmail_send',
    return_path: '/profile?section=connections', frontend_origin: consent.frontendOrigin,
    consent_receipt_id: SEAL, browser_proof_hash: consent.browserProofHash, browser_request_id: REQUEST,
    pkce_verifier_encrypted: 'enc:verifier', expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  return { tables, faults, calls, oauth, settings, row, crypto };
}

describe('a consent seal covers the displayed disclosure and the browser', () => {
  function bindingFixture() {
    const { oauth } = fixture();
    const issued: any[] = [];
    let spent = false;
    const seals = {
      issue: jest.fn(async (value: any) => { issued.push(value); return { challenge: 'token' }; }),
      redeem: jest.fn(async (value: any) => {
        if (spent || value.challenge !== 'token' || hashCallArgs(issued[0]?.args) !== hashCallArgs(value.args)) throw new Error('seal refused');
        spent = true; return { sealId: SEAL };
      }),
    };
    const retention = { disclosureFor: jest.fn(async () => ({ figureDays: 30, basis: 'House evidence' })) };
    const service = new IntegrationConsentService(oauth, retention as never, seals as never);
    return { service, seals, retention, oauth };
  }

  it('refuses changed retention before redeeming or opening a provider flow', async () => {
    const f = bindingFixture();
    const doc = await f.service.disclosure('gmail_read', HOUSE);
    const params = { userId: USER, restaurantId: HOUSE, integrationId: 'gmail_read' as const, browserOrigin: consent.frontendOrigin,
      body: { disclosureDigest: doc.digest, browserProofHash: consent.browserProofHash, browserRequestId: REQUEST, returnPath: '/profile' } };
    await f.service.challenge(params);
    f.retention.disclosureFor.mockResolvedValue({ figureDays: 60, basis: 'New evidence' });
    await expect(f.service.authorize({ ...params, body: { ...params.body, challenge: 'token' } })).rejects.toMatchObject({ status: 409 });
    expect(f.seals.redeem).not.toHaveBeenCalled();
  });

  it('binds browser proof, request id, return address, actor and house, and refuses a substituted browser', async () => {
    const f = bindingFixture(); const doc = await f.service.disclosure('gmail_send', HOUSE);
    const params = { userId: USER, restaurantId: HOUSE, integrationId: 'gmail_send' as const, browserOrigin: consent.frontendOrigin,
      body: { disclosureDigest: doc.digest, browserProofHash: consent.browserProofHash, browserRequestId: REQUEST, returnPath: '/profile' } };
    await f.service.challenge(params);
    expect(f.seals.issue).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: USER, restaurantId: HOUSE,
      args: expect.objectContaining({ restaurantId: HOUSE, browserRequestId: REQUEST, providerTarget: expect.stringContaining('accounts.google.com') }) }));
    await expect(f.service.authorize({ ...params, body: { ...params.body, browserProofHash: 'b'.repeat(64), challenge: 'token' } })).rejects.toThrow('seal refused');
  });

  it('does not issue a challenge if current retention cannot be read', async () => {
    const f = bindingFixture(); f.retention.disclosureFor.mockRejectedValue(new Error('read failed'));
    await expect(f.service.challenge({ userId: USER, restaurantId: HOUSE, integrationId: 'gmail_read', browserOrigin: consent.frontendOrigin,
      body: { disclosureDigest: 'd'.repeat(64), browserProofHash: consent.browserProofHash, browserRequestId: REQUEST, returnPath: '/profile' } })).rejects.toThrow('read failed');
    expect(f.seals.issue).not.toHaveBeenCalled();
  });
});

describe('browser-bound OAuth continuation', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'access', scope: 'email', email: 'person@example.test' }) })) as never; });
  afterEach(() => { global.fetch = originalFetch; });

  it.each(['google_drive', 'excel'] as const)('adds S256 PKCE and durable consent to %s without disclosing the browser proof', async integrationId => {
    const f = fixture(); const result = await f.oauth.createAuthorizationUrl({ userId: USER, restaurantId: HOUSE, integrationId, consent });
    const state = f.tables.integration_oauth_states[0]; const url = new URL(result.authorizationUrl);
    const verifier = f.crypto.encrypt.mock.calls[0][0];
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(result.authorizationUrl).not.toContain(PROOF);
    expect(result.authorizationUrl).not.toContain(consent.browserProofHash);
    expect(state.consent_receipt_id).toBe(SEAL);
    expect(f.tables.integration_consent_receipts[0].disclosure_snapshot).toEqual(consent.snapshot);
  });

  it('refuses receipt persistence failure before creating a provider state', async () => {
    const f = fixture(); f.faults.add('integration_consent_receipts:insert');
    await expect(f.oauth.createAuthorizationUrl({ userId: USER, restaurantId: HOUSE, integrationId: 'gmail_send', consent })).rejects.toThrow('receipt');
    expect(f.tables.integration_oauth_states).toHaveLength(0);
  });

  it.each(['/\\evil.test', '//evil.test', '/\n/evil.test', 'https://evil.test'])('rejects unsafe return path %p', value => {
    expect(fixture().oauth.safeReturnPath(value)).toBe('/settings');
  });

  it('parks a provider code encrypted and returns only opaque state to the initiating origin', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push(f.row);
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'sensitive-code' });
    expect(destination).toContain('https://app.example.test/authorize/complete#');
    expect(destination).not.toContain('sensitive-code');
    // KL audit D1: a delivery secret travels with THIS redirect, minted only
    // now — never known ahead of time by whoever sealed the flow.
    expect(deliveryFrom(destination)).toMatch(/^[a-f0-9]{64}$/);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(f.tables.integration_oauth_states[0].callback_payload_encrypted).toContain('enc:');
    expect(f.tables.integration_oauth_states[0].browser_delivery_secret_hash).toBe(hashSealToken(deliveryFrom(destination)));
  });

  it('refuses a leaked provider URL completed in another browser before exchange or connection write', async () => {
    const f = fixture();
    f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: 'b'.repeat(64), deliverySecret: DELIVERY })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled(); expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('only one racing completion exchanges; it clears the transient code and links the connection receipt', async () => {
    const f = fixture();
    f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    const results = await Promise.allSettled([
      f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY }),
      f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY }),
    ]);
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(f.tables.integration_oauth_connections).toHaveLength(1);
    expect(f.tables.integration_oauth_connections[0].consent_receipt_id).toBe(SEAL);
    expect(f.tables.integration_oauth_states[0].callback_payload_encrypted).toBeNull();
    expect(f.tables.integration_oauth_states[0].pkce_verifier_encrypted).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1].body).toContain('code_verifier=verifier');
  });

  it.each(['unsealed', 'expired', 'other-provider'])('refuses %s states without contacting a provider', async mode => {
    const f = fixture();
    f.tables.integration_oauth_states.push({ ...f.row, ...(mode === 'unsealed' ? { consent_receipt_id: null } : {}),
      ...(mode === 'expired' ? { expires_at: new Date(0).toISOString() } : {}) });
    const result = await f.oauth.handleCallback({ state: STATE, provider: mode === 'other-provider' ? 'microsoft' : 'google', code: 'code' });
    expect(result).toContain('integration_status=error'); expect(global.fetch).not.toHaveBeenCalled();
  });

  // A revoked membership is not an exchange failure, and an unreadable one is
  // not a refusal (KL audit J12): each cause names itself on the return URL.
  it.each([
    ['revoked', 'membership_refused'],
    ['unverified', 'membership_refused'],
    ['unreadable access row', 'membership_unreadable'],
    ['unreadable person row', 'membership_unreadable'],
  ])('refuses a %s account before the provider exchange, as %s', async (mode, reason) => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    if (mode === 'revoked') f.tables.user_restaurant_access[0].is_active = false;
    if (mode === 'unverified') f.tables.users[0].email_verified = false;
    if (mode === 'unreadable access row') f.faults.add('user_restaurant_access:select');
    if (mode === 'unreadable person row') f.faults.add('users:select');
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY });
    const url = new URL(result.destination);
    expect(url.searchParams.get('integration_status')).toBe('error');
    expect(url.searchParams.get('integration_reason')).toBe(reason);
    expect(global.fetch).not.toHaveBeenCalled(); expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('names a membership revoked DURING the provider exchange, and stores nothing', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      // The token call is the moment the grant is in flight at the provider.
      if (String(url).includes('/token')) f.tables.user_restaurant_access[0].is_active = false;
      return { ok: true, json: async () => ({ access_token: 'access', scope: 'email', email: 'person@example.test' }) };
    });
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY });
    expect(new URL(result.destination).searchParams.get('integration_reason')).toBe('membership_refused');
    expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(1);
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('still reports a real exchange failure as exchange_failed', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    (global.fetch as jest.Mock).mockImplementation(async () => ({ ok: true, json: async () => ({ error: 'invalid_grant' }) }));
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY });
    expect(new URL(result.destination).searchParams.get('integration_reason')).toBe('exchange_failed');
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  // KL audit D3: include_granted_scopes=true means a Google token can carry
  // scopes the person granted an EARLIER, different integration. Storing the
  // token's scope list as-is would make the receipt cover more than the
  // disclosed digest promised.
  it('stores only the scopes THIS integration disclosed, dropping any extra scope a shared Google token carries', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}', browser_delivery_secret_hash: hashSealToken(DELIVERY) });
    (global.fetch as jest.Mock).mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access',
        // gmail_send discloses only gmail.send; calendar.readonly here stands
        // in for a scope granted to a DIFFERENT integration on this account.
        scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly',
        email: 'person@example.test',
      }),
    }));
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY });
    expect(new URL(result.destination).searchParams.get('integration_status')).toBe('connected');
    expect(f.tables.integration_oauth_connections).toHaveLength(1);
    expect(f.tables.integration_oauth_connections[0].scopes).toEqual(['https://www.googleapis.com/auth/gmail.send']);
  });

  it('reports denial only after the correct browser claims the state, with no exchange', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push(f.row);
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', error: 'access_denied' });
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: deliveryFrom(destination) });
    expect(result.destination).toContain('integration_reason=denied'); expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires bounded typed proof and challenge fields at the public boundary', async () => {
    const challenge = Object.assign(new IntegrationConsentChallengeDto(), { disclosureDigest: 'bad', browserProofHash: PROOF, browserRequestId: 'not-uuid', returnPath: '/profile' });
    expect((await validate(challenge)).map(error => error.property)).toEqual(expect.arrayContaining(['disclosureDigest', 'browserRequestId']));
    const complete = Object.assign(new IntegrationConsentCompleteDto(), { state: STATE, browserProof: PROOF, deliverySecret: DELIVERY });
    expect(await validate(complete)).toHaveLength(0);
  });
});

describe('a leaked provider URL cannot bind another account to the sealing tab (KL audit J1)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'access', scope: 'email', email: 'attacker@example.test' }) })) as never; });
  afterEach(() => { global.fetch = originalFetch; });

  it.each([
    ['the attacker finishes at the provider first', ['attacker-code', 'victim-code']],
    ['the person finishes at the provider first', ['victim-code', 'attacker-code']],
  ])('%s: the second callback voids the grant and the sealing tab exchanges nothing', async (_order, codes) => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });

    const first = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: codes[0] });
    expect(first).toContain('/authorize/complete#');
    const second = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: codes[1] });
    expect(new URL(second).searchParams.get('integration_reason')).toBe('invalid_state');

    // The state is consumed and nothing exchangeable is left in it.
    const row = f.tables.integration_oauth_states[0];
    expect(row.consumed_at).toEqual(expect.any(String));
    expect(row.callback_payload_encrypted).toBeNull();
    expect(row.pkce_verifier_encrypted).toBeNull();

    // The sealing tab, holding the real proof but a delivery secret it can
    // only guess (the state was already poisoned above), is refused before
    // any exchange.
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('two callbacks racing each other also void the grant', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });
    await Promise.all([
      f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'one' }),
      f.oauth.handleCallback({ state: STATE, provider: 'google', error: 'access_denied' }),
    ]);
    const row = f.tables.integration_oauth_states[0];
    expect(row.consumed_at).toEqual(expect.any(String));
    expect(row.callback_payload_encrypted).toBeNull();
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: DELIVERY })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a single callback still parks and completes normally', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'the-code' });
    expect(f.tables.integration_oauth_states[0].consumed_at ?? null).toBeNull();
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: deliveryFrom(destination) });
    expect(new URL(result.destination).searchParams.get('integration_status')).toBe('connected');
    expect(f.tables.integration_oauth_connections).toHaveLength(1);
  });
});

// KL audit D1, second fix round. J1's poisonState only fired on a SECOND
// provider callback. This describes the one-callback attack it missed: a
// dishonest sealer mints browser_proof_hash herself (it is chosen up front,
// integration-consent.service.ts:70) and forwards the provider URL without
// ever clicking Allow; a stranger does, and exactly ONE callback occurs, so
// J1's double-park detection never fires. The sealer then completes with her
// own real proof and binds the stranger's provider account into her own
// house. The fix: a second secret, `browser_delivery_secret_hash`, minted
// only when a callback actually parks a result and sent only in that
// redirect's own fragment — so it is never in the sealer's hands unless her
// own browser is the one that returned from the provider.
describe('completing a grant needs the delivery secret from THIS callback, not just the sealing proof (KL audit D1, round 2)', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'stranger-access', scope: 'email', email: 'stranger@example.test' }) })) as never; });
  afterEach(() => { global.fetch = originalFetch; });

  it('the sealer holding only her own proof, guessing at the delivery secret a stranger\'s callback minted, is refused and poisons the state so a later, correct-looking retry also fails', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });
    // Exactly one callback — a stranger clicked Allow on the forwarded link.
    // Not the J1 double-callback path: poisonState there never fires here.
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'strangers-code' });
    expect(f.tables.integration_oauth_states[0].consumed_at ?? null).toBeNull();

    // The sealer never received this redirect, so she cannot know its secret.
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: 'f'.repeat(64) }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();

    // The wrong guess poisoned the state: even reading the REAL delivery
    // secret off the redirect this test captured cannot complete it now —
    // closing the path where the sealer later obtains it some other way.
    const real = deliveryFrom(destination);
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: real }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('the stranger\'s own browser, holding the delivery secret but no sealing proof, cannot complete it either — and its wrong guess poisons the state against the sealer too', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'strangers-code' });
    const real = deliveryFrom(destination);

    // The stranger never sealed anything in this browser, so she holds no
    // proof at all; a guess is refused, not silently accepted.
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: 'b'.repeat(64), deliverySecret: real }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.tables.integration_oauth_connections).toHaveLength(0);

    // The sealer's fully-correct attempt — her real proof AND the real
    // delivery secret, however she might have obtained both — still fails:
    // the wrong attempt above already consumed the state.
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: real }))
      .rejects.toMatchObject({ status: 403 });
    expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('a legitimate single-browser completion never accepts a caller-supplied identity: the stored connection is always the user and house recorded when the state was minted', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row });
    const destination = await f.oauth.handleCallback({ state: STATE, provider: 'google', code: 'the-code' });
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF, deliverySecret: deliveryFrom(destination) });
    expect(new URL(result.destination).searchParams.get('integration_status')).toBe('connected');
    expect(f.tables.integration_oauth_connections).toHaveLength(1);
    expect(f.tables.integration_oauth_connections[0].user_id).toBe(USER);
    expect(f.tables.integration_oauth_connections[0].restaurant_id).toBe(HOUSE);
    // The public request DTO carries only a state and two secrets — no user
    // or house field exists for a caller to supply, by construction.
    const complete = Object.assign(new IntegrationConsentCompleteDto(), {
      state: STATE, browserProof: PROOF, deliverySecret: deliveryFrom(destination),
    });
    expect(Object.keys(complete).sort()).toEqual(['browserProof', 'deliverySecret', 'state']);
  });
});

describe('a malformed FRONTEND_URL is skipped, never a 500 (KL audit J2)', () => {
  const malformed = ['mudavym.com', 'https://mudavym.com,', 'https://mudavym.com, www.mudavym.com', 'localhost:3000'];

  it.each(malformed)('FRONTEND_URL=%p still admits the production origin and refuses a foreign one', value => {
    const f = fixture(); f.settings.FRONTEND_URL = value;
    expect(f.oauth.consentFrontendOrigin('https://mudavym.com')).toBe('https://mudavym.com');
    expect(() => f.oauth.consentFrontendOrigin('https://evil.test')).toThrow(expect.objectContaining({ status: 403 }));
    expect(f.oauth.safeReturnPath('/profile?section=connections')).toBe('/profile?section=connections');
  });

  it.each(malformed)('FRONTEND_URL=%p lets a sealed grant open its provider flow', async value => {
    const f = fixture(); f.settings.FRONTEND_URL = value;
    const result = await f.oauth.createAuthorizationUrl({ userId: USER, restaurantId: HOUSE, integrationId: 'gmail_send',
      returnPath: '/profile', consent: { ...consent, frontendOrigin: 'https://mudavym.com' } });
    expect(result.authorizationUrl).toContain('accounts.google.com');
    expect(f.tables.integration_oauth_states[0].frontend_origin).toBe('https://mudavym.com');
  });

  it.each(malformed)('FRONTEND_URL=%p still redirects a bad callback instead of throwing', async value => {
    const f = fixture(); f.settings.FRONTEND_URL = value;
    const result = await f.oauth.handleCallback({ provider: 'google' });
    expect(new URL(result).searchParams.get('integration_reason')).toBe('missing_state');
  });

  it('keeps a parseable entry beside a malformed one', () => {
    const f = fixture(); f.settings.FRONTEND_URL = 'not a url, https://staging.example.test';
    expect(f.oauth.consentFrontendOrigin('https://staging.example.test')).toBe('https://staging.example.test');
  });

  it('admits the production origin with no FRONTEND_URL at all, and not a CORS-pattern preview origin', () => {
    const f = fixture(); delete f.settings.FRONTEND_URL;
    expect(f.oauth.consentFrontendOrigin('https://mudavym.com')).toBe('https://mudavym.com');
    expect(f.oauth.consentFrontendOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    // cors-origins.ts admits *.vercel.app by pattern; the consent return origin
    // is an exact list on purpose, because it receives the completion state.
    expect(() => f.oauth.consentFrontendOrigin('https://preview-abc.vercel.app')).toThrow(expect.objectContaining({ status: 403 }));
  });
});
