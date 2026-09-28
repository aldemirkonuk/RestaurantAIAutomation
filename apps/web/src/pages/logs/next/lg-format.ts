/**
 * /logs formatting and the pure vocabulary of the ledger.
 *
 * Everything here is a pure function over the gateway's own shape so it can be
 * tested without a DOM. The rules it carries, each of which the page used to
 * hold in prose alone:
 *
 *   - an unknown is an em dash, never a zero (`EM`), and a windowed count is
 *     a floor (`GE`) — both named exports so `scripts/check_windowed_figures.py`
 *     can see the marker is USED, not merely imported;
 *   - an undated row prints "not recorded", never "Invalid Date" and never a
 *     borrowed timestamp;
 *   - a register the gateway names and this file has not mirrored still gets
 *     a label — its raw key, ugly on purpose — because a lookup that returns
 *     `undefined` renders an empty badge, which is an unknown printed as nothing;
 *   - a link out of the timeline is computed here, from the row's own detail,
 *     and is `null` when the register has no page of its own. A null is drawn
 *     as a sentence saying so, never as a dead control.
 *
 * The types restate `apps/api-gateway/src/logs/logs-timeline.service.ts`; the
 * web app has no import path into the gateway. Keep the two in step.
 */

export const EM = '—';

/**
 * The floor mark. A count taken inside a window renders `≥ n`, never a total
 * the page cannot know (ADR 0051 clause 2).
 */
export const GE = '≥';

export const SERIF = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", "Plus Jakarta Sans", system-ui, sans-serif';
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/* ── Fraunces, loaded by this page for itself ─────────────────────────────
   index.html is shared and does not carry the house serif. Same element id as
   the other rebuilt pages, so one session adds one stylesheet. */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/* ── the gateway's shape, restated ───────────────────────────────────────── */

export type TimelineSource =
  | 'pos_checks'
  | 'decision_log'
  | 'inventory_transactions'
  | 'procurement_documents'
  | 'system_audit_log'
  | 'event_store';

export interface TimelineEvent {
  id: string;
  source: TimelineSource;
  /** Null when the row's timestamp column is null — a real, undated row. */
  occurredAt: string | null;
  correlationId: string | null;
  summary: string;
  detail: Record<string, unknown>;
}

/** One page as the gateway returns it. Every field past `events` is optional
 *  on purpose: a gateway that predates it has told the page nothing, and
 *  nothing is not "all clear". */
export interface TimelinePage {
  events: TimelineEvent[];
  correlationId: string | null;
  sourcesQueried?: TimelineSource[];
  failedSources?: TimelineSource[];
  window?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

/** Fixed render order — the register strip does not depend on key order. */
export const SOURCE_ORDER: TimelineSource[] = [
  'pos_checks',
  'decision_log',
  'inventory_transactions',
  'procurement_documents',
  'system_audit_log',
  'event_store',
];

const SOURCE_LABEL: Record<TimelineSource, string> = {
  pos_checks: 'Till',
  decision_log: 'Agent',
  inventory_transactions: 'Stock',
  procurement_documents: 'Paper',
  system_audit_log: 'Audit',
  event_store: 'Event',
};

/** Long-form names — a sentence needs more than a mark does. */
const SOURCE_NAME: Record<TimelineSource, string> = {
  pos_checks: 'the till',
  decision_log: 'the agents',
  inventory_transactions: 'stock movements',
  procurement_documents: 'the paper',
  system_audit_log: 'the audit trail',
  event_store: 'the event store',
};

/** What each register IS, for the sheet's eyebrow and the strip's hint. */
const SOURCE_DESCRIPTION: Record<TimelineSource, string> = {
  pos_checks: 'Checks the till opened and closed',
  decision_log: 'What an agent decided, and how sure it was',
  inventory_transactions: 'Every movement the stock ledger booked',
  procurement_documents: 'Invoices, receipts and credits that arrived',
  system_audit_log: 'Who changed what, and why they said they did',
  event_store: 'The platform event stream, read only along a thread',
};

/** A source this file has not mirrored falls back to its raw key: never blank. */
export function labelOf(s: TimelineSource | string): string {
  return SOURCE_LABEL[s as TimelineSource] ?? s;
}
export function nameOf(s: TimelineSource | string): string {
  return SOURCE_NAME[s as TimelineSource] ?? s;
}
export function describeOf(s: TimelineSource | string): string {
  return SOURCE_DESCRIPTION[s as TimelineSource] ?? 'A register this page has not been taught';
}

export function listSources(sources: readonly string[]): string {
  const names = sources.map(nameOf);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* ── time ─────────────────────────────────────────────────────────────────── */

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/** The words for an undated or unparseable row. Never "Invalid Date". */
export const NOT_RECORDED = 'not recorded';

/** "14:05:31" — the time of day, to the second, for a row inside a day group. */
export function fmtClock(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return NOT_RECORDED;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "Thu 11 Sep 2026 · 14:05:31" — the full stamp, for the sheet and the thread. */
export function fmtStamp(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return NOT_RECORDED;
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${day} · ${fmtClock(iso)}`;
}

/** "Thu 11 Sep 2026" — a day heading. */
export function fmtDay(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return 'No date recorded';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Local calendar day key, or `null` for an undated row. */
export function dayKeyOf(iso: string | null | undefined): string | null {
  const d = parse(iso);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export interface DayGroup {
  /** `null` is the undated tail — the gateway sorts those rows last. */
  key: string | null;
  heading: string;
  events: TimelineEvent[];
}

/**
 * Group a newest-first feed into days, in the order the feed already has.
 * Undated rows collect under one trailing group. Nothing is re-sorted here:
 * the gateway's order is the record's order.
 */
export function groupByDay(events: readonly TimelineEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let undated: DayGroup | null = null;
  for (const e of events) {
    const key = dayKeyOf(e.occurredAt);
    if (key === null) {
      if (!undated) undated = { key: null, heading: fmtDay(null), events: [] };
      undated.events.push(e);
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, heading: fmtDay(e.occurredAt), events: [e] });
  }
  if (undated) groups.push(undated);
  return groups;
}

/**
 * A thread reads like a ledger page: oldest first, undated rows last. The
 * feed's newest-first order is the right one for "what just happened"; a
 * thread is "what happened, in order", and a person reads a ledger downward.
 */
export function orderForThread(events: readonly TimelineEvent[]): TimelineEvent[] {
  const dated = events.filter((e) => parse(e.occurredAt) !== null);
  const undated = events.filter((e) => parse(e.occurredAt) === null);
  dated.sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  return [...dated, ...undated];
}

export interface ThreadSpan {
  first: string | null;
  last: string | null;
  registers: number;
}

/** The first and last dated moments on a thread, and how many registers it touched. */
export function threadSpan(events: readonly TimelineEvent[]): ThreadSpan {
  const ordered = orderForThread(events).filter((e) => parse(e.occurredAt) !== null);
  return {
    first: ordered.length ? ordered[0].occurredAt : null,
    last: ordered.length ? ordered[ordered.length - 1].occurredAt : null,
    registers: new Set(events.map((e) => e.source)).size,
  };
}

/* ── counts ───────────────────────────────────────────────────────────────── */

export function countBySource(events: readonly TimelineEvent[]): Partial<Record<string, number>> {
  const counts: Partial<Record<string, number>> = {};
  for (const e of events) counts[e.source] = (counts[e.source] ?? 0) + 1;
  return counts;
}

/**
 * Every register either side knows about — this file's order, then anything
 * the gateway named that this file has not mirrored. One list drives the strip
 * AND the tally, so the two cannot disagree ("Read 7 of 6" was the fault).
 */
export function displaySources(sourcesQueried: readonly string[] | null): string[] {
  return [...new Set<string>([...SOURCE_ORDER, ...(sourcesQueried ?? [])])];
}

/** "one" … "six"; digits past that. For a sentence, not a figure. */
export function word(n: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[n] ?? String(n);
}

/* ── the way out ──────────────────────────────────────────────────────────── */

export interface LinkOut {
  to: string;
  label: string;
}

export interface LinkContext {
  /** The rebuilt `/documents/:id` is on for this house (its flag-off face is `/receipts`). */
  documentPageOn: boolean;
  /** The SimPOS order log is a development surface: `App.tsx` redirects it to `/` in a production build. */
  posLogAvailable: boolean;
  restaurantId: string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Where a row leads, or `null` when its register has no page of its own.
 *
 * Each target is a route that exists in `App.tsx` and, where the target page
 * reads a deep link, the parameter it reads (`/receipts?doc=` —
 * `ReceiptsNext.tsx:1154`). `/inventory` reads only `?verify=<orderId>`
 * (`InventoryCommandPage.tsx:315`), so a stock movement opens the ledger and
 * the sheet says the item itself has no address yet. `/orders` reads no
 * parameter at all.
 */
export function linkOutFor(e: TimelineEvent, ctx: LinkContext): LinkOut | null {
  switch (e.source) {
    case 'procurement_documents':
      return ctx.documentPageOn
        ? { to: `/documents/${e.id}`, label: 'Open the document' }
        : { to: `/receipts?doc=${e.id}`, label: 'Open in receipts' };
    case 'inventory_transactions':
      return { to: '/inventory', label: 'Open the stock ledger' };
    case 'pos_checks':
      if (!ctx.posLogAvailable || !ctx.restaurantId) return null;
      return { to: `/simpos/${ctx.restaurantId}/orders`, label: 'Open the till log' };
    case 'system_audit_log': {
      const entity = str(e.detail.entityType);
      if (entity === 'procurement_order') return { to: '/orders', label: 'Open the orders' };
      if (entity === 'generated_report') return { to: '/documents-reports', label: 'Open the reports' };
      if (entity === 'restaurant_feature_flag') return { to: '/settings?tab=features', label: 'Open the features' };
      if (entity === 'restaurant_member') return { to: '/team', label: 'Open the team' };
      return null;
    }
    default:
      return null;
  }
}

/** Why a row has no way out — said in words beside the missing control. */
export function noLinkReason(e: TimelineEvent, ctx: LinkContext): string {
  switch (e.source) {
    case 'decision_log':
      return 'An agent’s decision has no page of its own; its working is the row below.';
    case 'event_store':
      return 'The event store has no page; a thread is the only way to read it.';
    case 'pos_checks':
      return ctx.posLogAvailable
        ? 'No house is selected, so the till log has no address.'
        : 'The till log is a development surface and is not served here.';
    case 'system_audit_log':
      return 'This audit entry names a record that has no page of its own.';
    default:
      return 'This register has no page of its own.';
  }
}

/* ── the payload ──────────────────────────────────────────────────────────── */

export interface PayloadLine {
  key: string;
  value: string;
}

/** A row's detail as key/value lines; nested objects are printed as JSON. */
export function payloadLines(detail: Record<string, unknown> | null | undefined): PayloadLine[] {
  if (!detail) return [];
  return Object.entries(detail).map(([key, v]) => ({
    key,
    value:
      v === null || v === undefined
        ? NOT_RECORDED
        : typeof v === 'string'
          ? v
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : JSON.stringify(v, null, 2),
  }));
}
