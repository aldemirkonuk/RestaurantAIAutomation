/**
 * The Cmd-K palette's Goods (r108 inventory g13): find any good by its house
 * name, producer or library name, and open its drawer at /inventory?open=<id>
 * (Linear's quick look on issues, Raycast's entity search).
 *
 * One cache with /inventory: on open the palette asks for the list under the
 * exact key and fetcher the page reads (`inventoryListQuery`). A list already
 * read is not read again; no keystroke reaches the network, the ranking is
 * local (`fuzzyScore`) and capped at 8 rows. The key carries the active
 * house, and a list is drawn only for the house it was read for, so a house
 * switch never shows the last house's goods.
 *
 * A row says the house's name, then the good's kind and what is on hand in
 * its own unit. No money for any role: no cost, value or price is read here.
 *
 * Stated limit: drinks and dishes are not in this section. They would come
 * only from their own list caches, and on main neither list is kept in the
 * query cache, so nothing is read for them here.
 *
 * Motion: the rows are the palette's own rows; this adds no animation.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import type { InventoryItem } from '../../services/api/types';
import { inventoryListQuery } from '../../hooks/queries/useInventoryQueries';
import { fuzzyScore, type Command } from './commands';

export const GOODS_CAP = 8;

export interface GoodEntry {
  id: string;
  name: string;
  producer: string | null;
  library: string | null;
  kind: string | null;
  stock: number | null;
  unit: string | null;
}

type Raw = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The goods of one list read, by the names the house and the library give them. */
export function goodsFrom(items: InventoryItem[] | null | undefined): GoodEntry[] {
  return (items ?? []).flatMap((i) => {
    const r = i as unknown as Raw;
    const name = text(r.wineName) ?? text(r.display_name) ?? text(r.libraryName);
    if (!name || !text(r.id)) return [];
    const library = text(r.libraryName);
    const stock = typeof r.stockLive === 'number' && Number.isFinite(r.stockLive) ? r.stockLive : null;
    return [
      {
        id: String(r.id),
        name,
        producer: text(r.wineProducer),
        library: library && library !== name ? library : null,
        kind: text(r.kind),
        stock,
        unit: text(r.uom),
      },
    ];
  });
}

// Pieces take a plural; a measure (kg, ml, each) does not.
const COUNTED = new Set(['bottle', 'keg', 'case', 'pack', 'can', 'shot', 'glass', 'piece', 'box', 'bag', 'jar', 'tin']);
const plural = (u: string) => (u.endsWith('s') || u.endsWith('x') ? `${u}es` : `${u}s`);

/** "12 bottles", "3.5 kg", "Not counted"; never a money figure. */
export function onHandWords(stock: number | null, unit: string | null): string {
  if (stock === null) return 'On hand not read';
  const n = stock.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  if (!unit) return `${n} on hand`;
  const u = unit.toLowerCase();
  return `${n} ${COUNTED.has(u) && stock !== 1 ? plural(u) : u}`;
}

const kindWords = (k: string | null) => (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, '-') : 'Good');

export const goodHref = (id: string) => `/inventory?open=${encodeURIComponent(id)}`;

/** The best GOODS_CAP goods for the query: name matches weigh more, then producer and library name. */
export function rankGoods(goods: GoodEntry[], query: string, cap = GOODS_CAP): Command[] {
  if (!query.trim()) return [];
  const scored: Array<{ g: GoodEntry; score: number }> = [];
  for (const g of goods) {
    const nameScore = fuzzyScore(query, g.name);
    const hayScore = fuzzyScore(query, `${g.name} ${g.producer ?? ''} ${g.library ?? ''}`);
    const best = nameScore != null && hayScore != null ? Math.max(nameScore + 3, hayScore) : (nameScore ?? hayScore);
    if (best != null) scored.push({ g, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name))
    .slice(0, cap)
    .map(({ g }) => ({
      id: `good-${g.id}`,
      title: g.name,
      subtitle: `${kindWords(g.kind)} · ${onHandWords(g.stock, g.unit)}`,
      section: 'Goods',
      icon: Package,
      href: goodHref(g.id),
    }));
}

/**
 * The Goods rows for an open palette. Reads the list once per open through
 * the shared cache (no read when it is already cached), and ranks it locally.
 */
export function usePaletteGoods(open: boolean, restaurantId: string | null | undefined, query: string): Command[] {
  const queryClient = useQueryClient();
  const [read, setRead] = useState<{ rid: string; goods: GoodEntry[] } | null>(null);

  useEffect(() => {
    if (!open || !restaurantId) return;
    let live = true;
    queryClient
      .ensureQueryData(inventoryListQuery(restaurantId))
      .then((items) => {
        if (live) setRead({ rid: restaurantId, goods: goodsFrom(items) });
      })
      // A list that could not be read leaves Goods out; the rest of the palette works.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, restaurantId, queryClient]);

  // Only the list read for the active house is ever ranked.
  const goods = read && restaurantId && read.rid === restaurantId ? read.goods : null;
  return useMemo(() => (open && goods ? rankGoods(goods, query) : []), [open, goods, query]);
}
