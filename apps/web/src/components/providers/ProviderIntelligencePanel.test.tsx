import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProviderIntelligencePanel } from './ProviderIntelligencePanel';

// The three tabs each make a read that is owner/manager at the gateway since
// 2026-10-07 (fix/promotions-gate-every-route); outreach and onboarding are not.
const reads = vi.hoisted(() => ({ knowledge: 0, promotions: 0, conversations: 0 }));
vi.mock('./ProviderKnowledgePanel', () => ({
  ProviderKnowledgePanel: () => {
    reads.knowledge += 1;
    return <div data-testid="knowledge-tab" />;
  },
}));
vi.mock('./ProviderPromotionsPanel', () => ({
  ProviderPromotionsPanel: () => {
    reads.promotions += 1;
    return <div data-testid="promotions-tab" />;
  },
}));
vi.mock('./ProviderConversationMemory', () => ({
  ProviderConversationMemory: () => {
    reads.conversations += 1;
    return <div data-testid="conversations-tab" />;
  },
}));
const api = vi.hoisted(() => ({
  triggerOutreach: vi.fn(async () => ({ success: true })),
  triggerOnboarding: vi.fn(async () => ({ success: true })),
}));
vi.mock('../../services/api/provider-intelligence', () => api);

function mount(learned?: boolean) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderIntelligencePanel providerId="p-1" providerName="Bodega Álvaro" learned={learned} />
    </QueryClientProvider>,
  );
}

describe('ProviderIntelligencePanel', () => {
  beforeEach(() => {
    reads.knowledge = reads.promotions = reads.conversations = 0;
    api.triggerOutreach.mockClear();
    api.triggerOnboarding.mockClear();
  });

  it('mounts the tabs by default', () => {
    mount();
    expect(screen.getByText('Digital Twin')).toBeInTheDocument();
    expect(screen.getByTestId('knowledge-tab')).toBeInTheDocument();
  });

  it('with learned={false} mounts no tab and makes no read, and keeps the Actions menu working', async () => {
    mount(false);
    expect(screen.queryByText('Digital Twin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-tab')).not.toBeInTheDocument();
    expect(reads).toEqual({ knowledge: 0, promotions: 0, conversations: 0 });

    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByText('General Check-in'));
    await waitFor(() =>
      expect(api.triggerOutreach).toHaveBeenCalledWith('p-1', 'relationship_building', 'general check-in'),
    );

    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByText('Start Onboarding Flow'));
    await waitFor(() => expect(api.triggerOnboarding).toHaveBeenCalledWith('p-1'));
  });
});
