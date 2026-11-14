import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { keepFreshWindows, KEYS_THAT_KEEP_THEIR_FRESH_WINDOW } from './freshWindows';

/**
 * r41 inventory audit gap 5: reads a component mounts many times over keep
 * their own `staleTime`; every other read still re-reads on mount. Each test
 * counts how often the read itself runs, on a client with App.tsx's query
 * defaults. Keys mirror the drawer chain's (`inventoryItemKeys`) and
 * NameThisWine's; ids are synthetic.
 */
const appClient = () =>
  keepFreshWindows(
    new QueryClient({
      defaultOptions: {
        queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1, throwOnError: false },
      },
    }),
  );
const settle = () => new Promise((r) => setTimeout(r, 15));

describe('keepFreshWindows', () => {
  let client: QueryClient;
  const unsubscribes: (() => void)[] = [];
  afterEach(() => {
    unsubscribes.splice(0).forEach((u) => u());
    client?.clear();
  });

  function counted(queryKey: QueryKey, extra: Record<string, unknown> = {}) {
    let reads = 0;
    const options = {
      queryKey,
      queryFn: async () => {
        reads += 1;
        return reads;
      },
      ...extra,
    };
    const mount = async (n = 1) => {
      for (let i = 0; i < n; i += 1) unsubscribes.push(new QueryObserver(client, options).subscribe(() => {}));
      await settle();
    };
    const unmountAll = () => unsubscribes.splice(0).forEach((u) => u());
    return { mount, unmountAll, reads: () => reads };
  }

  it('returns the same client and leaves its defaults as they were', () => {
    const raw = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always' } } });
    expect(keepFreshWindows(raw)).toBe(raw);
    expect(raw.getDefaultOptions().queries).toEqual({ staleTime: 5_000, refetchOnMount: 'always' });
    expect(raw.getQueryDefaults(['inventory', 'list', 'rest-1'])).toEqual({});
    expect(raw.getQueryDefaults(['inventory', 'item', 'rest-1', 'item-1', 'figures'])).toMatchObject({ refetchOnMount: true });
  });

  it('names the drawer reads and the item research, and nothing wider', () => {
    expect(KEYS_THAT_KEEP_THEIR_FRESH_WINDOW).toEqual([
      ['inventory', 'item'],
      ['inventory', 'research'],
    ]);
  });

  it('re-opening a good reads its nutrition once, not once per mount', async () => {
    client = appClient();
    const nutrition = counted(['inventory', 'item', 'rest-1', 'item-1', 'nutrition'], { staleTime: 60_000 });
    await nutrition.mount(); // the drawer
    await nutrition.mount(); // the KPI evidence's nutrition card, same key
    nutrition.unmountAll();
    await nutrition.mount(); // the drawer opened again
    expect(nutrition.reads()).toBe(1);
  });

  it('rows coming back read the house item research once', async () => {
    client = appClient();
    const research = counted(['inventory', 'research'], { staleTime: 60_000 });
    await research.mount();
    await research.mount(300);
    research.unmountAll();
    await research.mount(40);
    expect(research.reads()).toBe(1);
  });

  it('the stock list still re-reads on every mount', async () => {
    client = appClient();
    const list = counted(['inventory', 'list', 'rest-1', undefined], { staleTime: 30_000 });
    await list.mount();
    await list.mount();
    expect(list.reads()).toBe(2);
  });

  it('a drawer read a write invalidated is read again on the next mount', async () => {
    client = appClient();
    const figures = counted(['inventory', 'item', 'rest-1', 'item-1', 'figures'], { staleTime: 30_000 });
    await figures.mount();
    figures.unmountAll();
    await client.invalidateQueries({ queryKey: ['inventory'] });
    await figures.mount();
    expect(figures.reads()).toBe(2);
  });

  it('a drawer read past its own staleTime is read again on mount', async () => {
    client = appClient();
    const usedIn = counted(['inventory', 'item', 'rest-1', 'item-1', 'used-in'], { staleTime: 0 });
    await usedIn.mount();
    await usedIn.mount();
    expect(usedIn.reads()).toBe(2);
  });

  it('a query that asks for a read on every mount still gets one', async () => {
    client = appClient();
    const figures = counted(['inventory', 'item', 'rest-1', 'item-1', 'figures'], {
      staleTime: 30_000,
      refetchOnMount: 'always',
    });
    await figures.mount();
    await figures.mount();
    expect(figures.reads()).toBe(2);
  });
});
