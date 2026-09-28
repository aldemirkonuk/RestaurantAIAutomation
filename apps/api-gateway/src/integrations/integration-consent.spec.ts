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
  const crypto = { isConfigured: true, encrypt: (text: string) => `enc:${text}`, decrypt: (text: string) => text.slice(4), tryDecrypt: () => null };
  const oauth = new IntegrationsOauthService(db as never, { get: (key: string) => settings[key] } as never, crypto as never);
  const row = {
    state: STATE, user_id: USER, restaurant_id: HOUSE, provider: 'google', integration_id: 'gmail_send',
    return_path: '/profile?section=connections', frontend_origin: consent.frontendOrigin,
    consent_receipt_id: SEAL, browser_proof_hash: consent.browserProofHash, browser_request_id: REQUEST,
    pkce_verifier_encrypted: 'enc:verifier', expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  return { tables, faults, calls, oauth, settings, row };
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
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(state.pkce_verifier_encrypted.slice(4)).digest('base64url'));
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
    expect(global.fetch).not.toHaveBeenCalled();
    expect(f.tables.integration_oauth_states[0].callback_payload_encrypted).toContain('enc:');
  });

  it('refuses a leaked provider URL completed in another browser before exchange or connection write', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}' });
    await expect(f.oauth.completeCallback({ state: STATE, browserProof: 'b'.repeat(64) })).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).not.toHaveBeenCalled(); expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('only one racing completion exchanges; it clears the transient code and links the connection receipt', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}' });
    const results = await Promise.allSettled([f.oauth.completeCallback({ state: STATE, browserProof: PROOF }), f.oauth.completeCallback({ state: STATE, browserProof: PROOF })]);
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

  it.each(['revoked', 'unverified', 'unreadable'])('refuses a %s account before the provider exchange', async mode => {
    const f = fixture(); f.tables.integration_oauth_states.push({ ...f.row, callback_payload_encrypted: 'enc:{"code":"abc"}' });
    if (mode === 'revoked') f.tables.user_restaurant_access[0].is_active = false;
    if (mode === 'unverified') f.tables.users[0].email_verified = false;
    if (mode === 'unreadable') f.faults.add('user_restaurant_access:select');
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF });
    expect(result.destination).toContain('integration_status=error');
    expect(global.fetch).not.toHaveBeenCalled(); expect(f.tables.integration_oauth_connections).toHaveLength(0);
  });

  it('reports denial only after the correct browser claims the state, with no exchange', async () => {
    const f = fixture(); f.tables.integration_oauth_states.push(f.row);
    await f.oauth.handleCallback({ state: STATE, provider: 'google', error: 'access_denied' });
    const result = await f.oauth.completeCallback({ state: STATE, browserProof: PROOF });
    expect(result.destination).toContain('integration_reason=denied'); expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires bounded typed proof and challenge fields at the public boundary', async () => {
    const challenge = Object.assign(new IntegrationConsentChallengeDto(), { disclosureDigest: 'bad', browserProofHash: PROOF, browserRequestId: 'not-uuid', returnPath: '/profile' });
    expect((await validate(challenge)).map(error => error.property)).toEqual(expect.arrayContaining(['disclosureDigest', 'browserRequestId']));
    const complete = Object.assign(new IntegrationConsentCompleteDto(), { state: STATE, browserProof: PROOF });
    expect(await validate(complete)).toHaveLength(0);
  });
});
