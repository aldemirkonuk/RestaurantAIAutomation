/**
 * F-1348 (sibling of Security and Connections): a refused consent write on
 * /profile printed axios's "Request failed with status code 400". It now
 * prints the gateway's own sentence.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { ConsentRegister } from './ConsentRegister';
import type { McpServerVM, ProfileNextData } from './useProfileNextData';

const refused = (message: string) =>
  new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 400,
    data: { message },
  } as AxiosResponse);

vi.mock('../../../services/api/textSenders', () => ({
  getTextSenders: vi.fn().mockResolvedValue({
    senders: { whatsapp: null, sms: null },
    readable: true,
    reason: null,
    transport: { built: false, words: '' },
    myConsent: { consent: null, readable: true, reason: null },
  }),
  giveTextConsent: vi.fn(() => Promise.reject(refused('That number cannot receive texts.'))),
  withdrawTextConsent: vi.fn(),
}));

function mount(setMcpConsent: ProfileNextData['setMcpConsent'] = vi.fn()) {
  const server = {
    id: 'm1',
    name: 'Stock reader',
    url: 'https://mcp.example.test',
    status: 'active',
    revokedAt: null,
    consent: { given: false, at: null, liveCount: 0 },
  } as unknown as McpServerVM;
  const data = {
    mcpServers: [server],
    mcpState: 'ok',
    mcpError: null,
    refetchMcp: vi.fn(),
    isManagerOrOwner: false,
    mcpRuntime: null,
    setMcpConsent,
  } as unknown as ProfileNextData;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConsentRegister data={data} />
    </QueryClientProvider>,
  );
}

describe('a refused consent write says why, in words (F-1348)', () => {
  it('[REVERT-FAILS] agreeing to a server prints the gateway\'s sentence', async () => {
    mount(vi.fn(() => Promise.reject(refused('The house revoked this server a moment ago.'))));
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));
    expect(await screen.findByText('Nothing changed — The house revoked this server a moment ago.')).toBeInTheDocument();
    expect(screen.queryByText(/status code/)).toBeNull();
  });

  it('[REVERT-FAILS] agreeing to be texted prints the gateway\'s sentence', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('The number this house may text you at'), {
      target: { value: '+90 555 000 0000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'I agree' }));
    expect(await screen.findByText('Nothing changed — That number cannot receive texts.')).toBeInTheDocument();
    expect(screen.queryByText(/status code/)).toBeNull();
  });
});
