/** GroundAskWatch is wired to the signed-in person and to the real mutation cache. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('../../stores', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: authState.userId ? { userId: authState.userId } : null }),
}));

import { GroundAskWatch } from './GroundAskWatch';
import { applyAccountGroundAsk, getGroundAskGate, resetGroundAskForTests } from './groundAsk';
import { applyAccountGround, resetGroundChoiceForTests, setGroundOwner } from './groundChoice';

let client: QueryClient;
beforeEach(() => {
  resetGroundChoiceForTests();
  resetGroundAskForTests();
  client = new QueryClient();
  setGroundOwner('u1');
  applyAccountGround(undefined);
  applyAccountGroundAsk(undefined);
});
afterEach(() => {
  cleanup();
  authState.userId = null;
  resetGroundChoiceForTests();
  resetGroundAskForTests();
});

async function save() {
  window.dispatchEvent(new Event('pointerdown'));
  await act(async () => {
    await client.getMutationCache().build(client, { mutationFn: async () => 'ok' }).execute(undefined);
  });
}

describe('GroundAskWatch', () => {
  it('[REVERT-FAILS] notes the first task of a signed-in person', async () => {
    authState.userId = 'u1';
    render(
      <QueryClientProvider client={client}>
        <GroundAskWatch />
      </QueryClientProvider>,
    );
    await save();
    expect(getGroundAskGate().firstTaskAt).not.toBeNull();
  });

  it('[REVERT-FAILS] a preferences write behind a tap is not a task', async () => {
    authState.userId = 'u1';
    render(
      <QueryClientProvider client={client}>
        <GroundAskWatch />
      </QueryClientProvider>,
    );
    window.dispatchEvent(new Event('pointerdown'));
    await act(async () => {
      await client
        .getMutationCache()
        .build(client, { mutationKey: ['user-preferences'], mutationFn: async () => 'ok' })
        .execute(undefined);
    });
    expect(getGroundAskGate().firstTaskAt).toBeNull();
  });

  it('watches nothing while nobody is signed in', async () => {
    render(
      <QueryClientProvider client={client}>
        <GroundAskWatch />
      </QueryClientProvider>,
    );
    await save();
    expect(getGroundAskGate().firstTaskAt).toBeNull();
  });
});
