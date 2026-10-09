/**
 * INV-W38: the page's view is the URL (ADR 0160, "the URL holds it").
 *
 * What a person narrowed the list to (chip, search, zone, type, sort, table or
 * map, the open row) survives a reload, Back, and a link sent to someone else.
 * Only what differs from the default is written, so a plain /inventory stays
 * plain. Every write replaces the history entry: typing a search is not twelve
 * Back presses.
 *
 * The links other places already send here are read as well:
 *   ?wine=<name>      Notifications' held band, the low-stock email and the
 *                     push action (sw.js) — the search, as the legacy page did.
 *   ?highlight=<id>   the dashboard's low-stock alert (a row id) and the one-tap
 *                     centre (a wine id) — that title, opened.
 * Both are folded into the page's own keys on the first write, so they cannot
 * override what the person does next. Every other parameter (?name-delivery=,
 * ?rec=, ?from=, ?verify=) is left as it came; the page reads those itself.
 */
import { CHIPS, type ChipId, type SortId } from './useInventoryNextData';

export interface IvView {
  chip: ChipId;
  q: string;
  zone: string;
  type: string;
  sort: SortId;
  view: 'table' | 'map';
  /** A row id, or a wine id from ?highlight= until the rows resolve it. */
  open: string | null;
}

const SORTS: readonly SortId[] = ['needs', 'name', 'value'];

export const IV_DEFAULT: IvView = { chip: 'all', q: '', zone: '', type: '', sort: 'needs', view: 'table', open: null };

const KEYS = ['chip', 'q', 'zone', 'type', 'sort', 'view', 'open'] as const;
const ALIASES = ['wine', 'highlight'] as const;

export function readView(p: URLSearchParams): IvView {
  const chip = p.get('chip');
  const sort = p.get('sort');
  return {
    chip: CHIPS.some((c) => c.id === chip) ? (chip as ChipId) : IV_DEFAULT.chip,
    q: p.get('q') ?? p.get('wine') ?? IV_DEFAULT.q,
    zone: p.get('zone') ?? IV_DEFAULT.zone,
    type: p.get('type') ?? IV_DEFAULT.type,
    sort: SORTS.includes(sort as SortId) ? (sort as SortId) : IV_DEFAULT.sort,
    view: p.get('view') === 'map' ? 'map' : IV_DEFAULT.view,
    open: p.get('open') || p.get('highlight') || IV_DEFAULT.open,
  };
}

export function writeView(base: URLSearchParams, v: IvView): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const k of [...KEYS, ...ALIASES]) out.delete(k);
  for (const k of KEYS) {
    const val = v[k];
    if (val !== null && val !== IV_DEFAULT[k]) out.set(k, val);
  }
  return out;
}
