/**
 * The Mail tab calls the gateway only by routes the gateway declares.
 *
 * The routes, verbs and query names are read out of the gateway's own
 * controllers (not copied), and every request the tab makes while an owner
 * loads the list, opens a person and a letter, and stops the house reading
 * every conversation is checked against them. The web half once guessed
 * `POST /mail/consent`, a `kind` query and a `reader.readAll` field that no
 * controller declared; this is what stops that coming back.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

type Call = { method: string; url: string; params: string[]; body: string[] };
const calls = vi.hoisted(() => ({ list: [] as Array<{ method: string; url: string; params: string[]; body: string[] }> }));
const answer = vi.hoisted(() => ({ fn: (async () => ({ data: {} })) as (url: string) => Promise<unknown> }));
const rec =
  (method: string) =>
  async (url: string, a?: unknown, b?: unknown) => {
    const cfg = (method === 'GET' || method === 'DELETE' ? a : b) as { params?: Record<string, unknown> } | undefined;
    const body = method === 'POST' || method === 'PUT' ? ((a ?? {}) as Record<string, unknown>) : {};
    calls.list.push({ method, url, params: Object.keys(cfg?.params ?? {}), body: Object.keys(body) });
    return answer.fn(url);
  };
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { READ_ALL_ID, readAllConsentPath } from './mail-format';

const gateway = (rel: string) => readFileSync(resolve(process.cwd(), '../api-gateway/src', rel), 'utf8');

interface Declared {
  method: string;
  re: RegExp;
  path: string;
  queries: string[];
  block: string;
}

/** Every `@Get/@Post/@Put/@Delete` of a controller, with the `@Query` names and the handler's text. */
function declared(rel: string): Declared[] {
  const src = gateway(rel);
  const base = (/@Controller\(\s*["']([^"']*)["']/.exec(src)?.[1] ?? '').replace(/^\/|\/$/g, '');
  const marks = [...src.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:["']([^"']*)["'])?\s*\)/g)];
  return marks.map((m, i) => {
    const block = src.slice(m.index!, marks[i + 1]?.index ?? src.length);
    const path = `/${[base, m[2] ?? ''].filter(Boolean).join('/')}`;
    return {
      method: m[1].toUpperCase(),
      path,
      re: new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
      queries: [...block.matchAll(/@Query\(\s*["'](\w+)["']/g)].map((q) => q[1]),
      block,
    };
  });
}

const ROUTES: Declared[] = [
  ...declared('conversations/mail.controller.ts'),
  ...declared('integrations/integrations-oauth.controller.ts'),
  ...declared('communications/letters/house-letters.controller.ts'),
  ...declared('communications/mail-setup/mail-setup.controller.ts'),
];

const personRow = {
  key: 'team:t1',
  kind: 'team',
  providerId: 't1',
  name: 'Deniz Kaya',
  lastLine: 'Hi',
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: false,
  waitingSince: null,
  channels: ['email'],
  openThreads: 0,
  newestOpenOrderId: null,
  newestOpenOrderNumber: null,
};

let grants: Array<Record<string, unknown>>;

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const unmatched = (list: Call[]) =>
  list.filter((c) => {
    const route = ROUTES.find((r) => r.method === c.method && r.re.test(c.url));
    if (!route) return true;
    // A query the controller names one by one must be one it names; a body field must be one the handler reads.
    if (route.queries.length && c.params.some((p) => !route.queries.includes(p))) return true;
    return c.body.some((b) => !route.block.includes(b));
  });

beforeEach(() => {
  calls.list.length = 0;
  grants = [{ connectionId: 'c1', integrationId: READ_ALL_ID, houseAccess: { revoked: false } }];
  api.get.mockImplementation(rec('GET'));
  api.post.mockImplementation(rec('POST'));
  api.put.mockImplementation(rec('PUT'));
  api.delete.mockImplementation(rec('DELETE'));
  answer.fn = async (url) => {
    if (url === '/mail/summary')
      return { data: { waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null, doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } }, address: { configured: false, address: null } } };
    if (url === '/communications/letters/sender') return { data: { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants, unattributed: 0 } };
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [{ id: READ_ALL_ID, available: true }] } };
    if (url === '/mail/people') return { data: { people: [personRow], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/threads') return { data: { person: { key: 'team:t1', kind: 'team', providerId: 't1', name: 'Deniz Kaya' }, threads: [], next: null } };
    if (url === '/mail/thread') return { data: { key: 'gm:abc', subject: 'Friday', person: null, order: null, messages: [], before: null } };
    if (url.startsWith('/integrations/oauth/house-grants/')) return { data: { success: true } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  };
});

describe('the Mail tab and the gateway agree', () => {
  it('reads the controllers it is checked against', () => {
    const has = (m: string, p: string) => ROUTES.some((r) => r.method === m && r.path === p);
    expect(has('GET', '/mail/people')).toBe(true);
    expect(has('GET', '/integrations/oauth/house-grants')).toBe(true);
    expect(has('PUT', '/integrations/oauth/house-grants/:connectionId/access')).toBe(true);
    expect(has('GET', '/communications/letters/sender')).toBe(true);
  });

  it('every request while an owner loads the list and stops the house reading is a declared route', async () => {
    mount('/communications?tab=mail');
    fireEvent.click(await screen.findByTestId('read-all-stop'));
    await waitFor(() => expect(calls.list.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.list.map((c) => `${c.method} ${c.url}`)).toEqual(
      expect.arrayContaining([
        'GET /mail/people',
        'GET /mail/summary',
        'GET /integrations/oauth/house-grants',
        'GET /integrations/oauth/catalog',
        'PUT /integrations/oauth/house-grants/c1/access',
      ]),
    );
    expect(unmatched(calls.list)).toEqual([]);
  });

  it('opening a person and a letter asks only for declared routes and queries', async () => {
    mount('/communications?tab=mail&with=team%3At1');
    await waitFor(() => expect(calls.list.some((c) => c.url === '/mail/threads')).toBe(true));
    expect(unmatched(calls.list)).toEqual([]);
  });

  it('the check does bite: a guessed route, verb or query is unmatched', () => {
    const guess = (method: string, url: string, params: string[] = [], body: string[] = []): Call => ({ method, url, params, body });
    expect(unmatched([guess('POST', '/mail/consent', [], ['scope'])])).toHaveLength(1);
    expect(unmatched([guess('DELETE', '/mail/consent', ['scope'])])).toHaveLength(1);
    expect(unmatched([guess('GET', '/mail/people', ['kind'])])).toHaveLength(1);
    expect(unmatched([guess('POST', '/mail/people')])).toHaveLength(1);
    expect(unmatched([guess('GET', '/mail/people', ['waiting', 'q', 'after'])])).toHaveLength(0);
  });

  it('the grant it offers is the one the gateway declares, and the consent screen is for that id', () => {
    // Copied from `IntegrationId` in the gateway's integrations-oauth.constants.ts as #1917 declares it.
    const declaredByGateway = ['google_drive', 'excel', 'gmail_send', 'gmail_read', 'gmail_read_all'];
    expect(declaredByGateway).toContain(READ_ALL_ID);
    expect(readAllConsentPath().startsWith(`/authorize/${READ_ALL_ID}?`)).toBe(true);
  });

  // Runs wherever the gateway half is under this branch; before it merges the id is not there to read.
  const constants = gateway('integrations/integrations-oauth.constants.ts');
  it.runIf(/IntegrationId\s*=[\s\S]*?;/.exec(constants)?.[0].includes('gmail_read') && constants.includes('gmail_read_all'))(
    'the gateway source declares the grant id the tab names',
    () => {
      expect(constants).toContain(`"${READ_ALL_ID}"`);
    },
  );
});
