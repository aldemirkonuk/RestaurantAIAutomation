/**
 * hp-readiness — turns the gateway's own reads into the three-fact state line
 * ADR 0144 §2 requires: which connections are live, what is waiting on the
 * house, what last failed. Pure; every branch has a sentence for `unknown`
 * (ADR 0051 clause 3), and a failed READ is never rendered the same as a
 * clean answer (ADR 0067 / help.md §9 honesty traps).
 *
 * Every source composed here is read individually by `useHelpNextData.ts` —
 * see that file for the endpoint table and the fork this scope closes (F1
 * narrow set, F2 role-conditional reads, F5 client-side composition, all in
 * the wave dossier `p4-scratch/wave/help.md`). Nothing here calls the
 * network; everything here is given a `Fetched<T>` and returns words.
 */

import { fmtAgo, fmtFloor } from './hp-format';

export type ItemTone = 'ok' | 'attention' | 'unknown' | 'refused';

export interface ReadinessItem {
  id: string;
  label: string;
  tone: ItemTone;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
}

/** One read's outcome. `refused` is 403 — a real answer ("not yours to see"),
 * never folded into `error`, which means the read itself broke. */
export type Fetched<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refused'; message: string }
  | { status: 'ok'; data: T };

export function isSettled<T>(f: Fetched<T>): f is Exclude<Fetched<T>, { status: 'loading' }> {
  return f.status !== 'loading';
}

/* ── Raw shapes read from the gateway (see useHelpNextData.ts for the calls) ── */

export interface McpProbeRaw {
  status: 'ok' | 'unreachable' | 'refused' | 'protocol_error' | 'unconfigured';
  detail?: string | null;
}
export interface McpConnectionRaw {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  probe: McpProbeRaw | null;
  lastProbeAt: string | null;
}

export interface OauthGrantRow {
  integrationId: string;
  connected: boolean;
  connectedAt: string | null;
  ownerName?: string | null;
}
/** `scope: 'own'` = the caller's own grants (any member); `'house'` = every
 * member's grant against this house (manager/owner only — F2). */
export interface OauthGrants {
  scope: 'own' | 'house';
  rows: OauthGrantRow[];
}

export interface PosStatusRaw {
  unavailable?: boolean;
  totalChecks?: number | null;
  sources?: Array<{ source: string; checks?: number; open?: number; latest?: string | null }> | null;
}

export interface LetterSenderRaw {
  reader: {
    granted: boolean | 'unknown';
    enabled: boolean;
    lastReadAt: string | null;
    lastError: string | null;
  };
}

export interface ProducerRunRaw {
  producer: string;
  lastRun: { started_at: string; failed: number; error: string | null } | null;
  lastRunUnreadable: string | null;
}
export interface ProducersStatusRaw {
  served: boolean | null;
  producers: ProducerRunRaw[];
}

export interface ReminderStatusRaw {
  served: boolean | null;
  ledgerReadable: boolean;
  lastRun: { failed: number; error: string | null; startedAt: string } | null;
}

export interface OneTapActionRaw {
  id: string;
  title: string;
  priority: string;
}

/* ── I. Connections ──────────────────────────────────────────────────────── */

function mcpItem(f: Fetched<McpConnectionRaw[]>, now: Date): ReadinessItem {
  const id = 'mcp';
  const label = 'Model-context servers';
  if (f.status === 'loading') return { id, label, tone: 'unknown', detail: 'Reading.' };
  if (f.status === 'refused') return { id, label, tone: 'refused', detail: 'Not yours to see.' };
  if (f.status === 'error') return { id, label, tone: 'unknown', detail: `Could not be read — ${f.message}` };
  const active = f.data.filter((c) => c.status === 'active');
  if (active.length === 0) return { id, label, tone: 'ok', detail: 'None declared for this house.' };
  const bad = active.filter((c) => c.probe && c.probe.status !== 'ok');
  const neverProbed = active.filter((c) => !c.probe);
  if (bad.length > 0) {
    const worst = bad[0];
    return {
      id,
      label,
      tone: 'attention',
      detail: `${bad.length} of ${active.length} last answered ${worst.probe?.status} — "${worst.name}", ${fmtAgo(worst.lastProbeAt, now)}.`,
      actionUrl: '/connections',
      actionLabel: 'Open Connections',
    };
  }
  if (neverProbed.length > 0) {
    return {
      id,
      label,
      tone: 'unknown',
      detail: `${neverProbed.length} of ${active.length} have never been probed, so whether they answer is unknown.`,
      actionUrl: '/connections',
      actionLabel: 'Open Connections',
    };
  }
  const oldest = active.reduce((a, b) => (
    !a.lastProbeAt ? a : !b.lastProbeAt ? b : new Date(a.lastProbeAt) < new Date(b.lastProbeAt) ? a : b
  ));
  return {
    id,
    label,
    tone: 'ok',
    detail: `${active.length} declared, all last answered ok — oldest reading ${fmtAgo(oldest.lastProbeAt, now)}.`,
  };
}

function oauthItem(f: Fetched<OauthGrants>): ReadinessItem {
  const id = 'oauth';
  const label = 'Personal grants (Google / Microsoft)';
  if (f.status === 'loading') return { id, label, tone: 'unknown', detail: 'Reading.' };
  if (f.status === 'refused') return { id, label, tone: 'refused', detail: 'Not yours to see.' };
  if (f.status === 'error') return { id, label, tone: 'unknown', detail: `Could not be read — ${f.message}` };
  const connected = f.data.rows.filter((r) => r.connected);
  const scopeWord = f.data.scope === 'house' ? 'across this house' : 'of your own';
  if (connected.length === 0) {
    return { id, label, tone: 'ok', detail: `None connected ${scopeWord}.`, actionUrl: '/profile', actionLabel: 'Open Profile' };
  }
  return {
    id,
    label,
    tone: 'ok',
    detail: `${connected.length} recorded ${scopeWord}. Recorded means listed, not proven working since — a stale token is only caught on its next real use.`,
    actionUrl: f.data.scope === 'house' ? '/connections' : '/profile',
    actionLabel: f.data.scope === 'house' ? 'Open Connections' : 'Open Profile',
  };
}

function posItem(f: Fetched<PosStatusRaw>): ReadinessItem {
  const id = 'pos';
  const label = 'Point of sale';
  if (f.status === 'loading') return { id, label, tone: 'unknown', detail: 'Reading.' };
  if (f.status === 'refused') return { id, label, tone: 'refused', detail: 'Not yours to see.' };
  if (f.status === 'error') return { id, label, tone: 'unknown', detail: `Could not be read — ${f.message}` };
  if (f.data.unavailable) {
    return { id, label, tone: 'unknown', detail: 'Our own database read failed — whether the till is connected is unknown, not "no".' };
  }
  const total = f.data.totalChecks ?? 0;
  const sources = f.data.sources ?? [];
  if (total === 0 || sources.length === 0) {
    return { id, label, tone: 'unknown', detail: 'No checks recorded — a quiet integration and a disconnected one read identically here.' };
  }
  const latest = sources
    .map((s) => s.latest)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  return {
    id,
    label,
    tone: 'ok',
    detail: `${sources.length} source${sources.length === 1 ? '' : 's'}, ${total} checks recorded${latest ? `, most recent ${latest.slice(0, 10)}` : ''}.`,
  };
}

function mailItem(f: Fetched<LetterSenderRaw>, now: Date): ReadinessItem {
  const id = 'mail';
  const label = 'Mail reading (vendor replies)';
  if (f.status === 'loading') return { id, label, tone: 'unknown', detail: 'Reading.' };
  if (f.status === 'refused') return { id, label, tone: 'refused', detail: 'Not yours to see.' };
  if (f.status === 'error') return { id, label, tone: 'unknown', detail: `Could not be read — ${f.message}` };
  const r = f.data.reader;
  if (!r.enabled) return { id, label, tone: 'ok', detail: 'Off — this house has not turned on reading its own inbox.' };
  if (r.granted === 'unknown') {
    return { id, label, tone: 'unknown', detail: 'On, but whether a grant backs it could not be read.' };
  }
  if (r.granted === false) {
    return {
      id,
      label,
      tone: 'attention',
      detail: 'On, and no live grant backs it — either none was connected, or the one that was has been revoked.',
      actionUrl: '/connections',
      actionLabel: 'Reconnect',
    };
  }
  if (r.lastError) {
    return { id, label, tone: 'attention', detail: `Granted, but the last read failed: ${r.lastError}` };
  }
  return {
    id,
    label,
    tone: 'ok',
    detail: r.lastReadAt ? `Granted, last read ${fmtAgo(r.lastReadAt, now)}.` : 'Granted, never read yet — the cron has not run since this was connected.',
  };
}

export function connectionItems(
  input: {
    mcp: Fetched<McpConnectionRaw[]>;
    oauth: Fetched<OauthGrants>;
    pos: Fetched<PosStatusRaw>;
    mail: Fetched<LetterSenderRaw>;
  },
  now: Date = new Date(),
): ReadinessItem[] {
  return [mcpItem(input.mcp, now), oauthItem(input.oauth), posItem(input.pos), mailItem(input.mail, now)];
}

/* ── II. Waiting on the house ────────────────────────────────────────────── */

/** ADR 0051: a capped list renders as a floor, `n+`, never a bare count. */
const ASK_AI_CAP = 20;

export function waitingItems(input: {
  oneTap: Fetched<OneTapActionRaw[]>;
  ordersPending: Fetched<{ count: number }>;
  askAi: Fetched<unknown[]>;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];

  const oneTap = input.oneTap;
  items.push(
    oneTap.status === 'loading'
      ? { id: 'one-tap', label: 'One-tap actions', tone: 'unknown', detail: 'Reading.' }
      : oneTap.status === 'refused'
        ? { id: 'one-tap', label: 'One-tap actions', tone: 'refused', detail: 'Not yours to see.' }
        : oneTap.status === 'error'
          ? { id: 'one-tap', label: 'One-tap actions', tone: 'unknown', detail: `Could not be read — ${oneTap.message}` }
          : oneTap.data.length === 0
            ? { id: 'one-tap', label: 'One-tap actions', tone: 'ok', detail: 'Nothing pending.' }
            : {
                id: 'one-tap',
                label: 'One-tap actions',
                tone: 'attention',
                detail: `${oneTap.data.length} pending — acted on from the Dashboard.`,
                actionUrl: '/',
                actionLabel: 'Open Dashboard',
              },
  );

  const orders = input.ordersPending;
  items.push(
    orders.status === 'loading'
      ? { id: 'orders', label: 'Orders awaiting approval', tone: 'unknown', detail: 'Reading.' }
      : orders.status === 'refused'
        ? { id: 'orders', label: 'Orders awaiting approval', tone: 'refused', detail: 'Not yours to see.' }
        : orders.status === 'error'
          ? { id: 'orders', label: 'Orders awaiting approval', tone: 'unknown', detail: `Could not be read — ${orders.message}` }
          : orders.data.count === 0
            ? { id: 'orders', label: 'Orders awaiting approval', tone: 'ok', detail: 'None pending.' }
            : {
                id: 'orders',
                label: 'Orders awaiting approval',
                tone: 'attention',
                detail: `${orders.data.count} pending.`,
                actionUrl: '/orders',
                actionLabel: 'Open Orders',
              },
  );

  const ask = input.askAi;
  items.push(
    ask.status === 'loading'
      ? { id: 'ask-ai', label: 'Ask AI proposals', tone: 'unknown', detail: 'Reading.' }
      : ask.status === 'refused'
        ? { id: 'ask-ai', label: 'Ask AI proposals', tone: 'refused', detail: 'Not yours to see.' }
        : ask.status === 'error'
          ? { id: 'ask-ai', label: 'Ask AI proposals', tone: 'unknown', detail: `Could not be read — ${ask.message}` }
          : ask.data.length === 0
            ? { id: 'ask-ai', label: 'Ask AI proposals', tone: 'ok', detail: 'None waiting on a confirm.' }
            : {
                id: 'ask-ai',
                label: 'Ask AI proposals',
                tone: 'attention',
                detail: `${fmtFloor(ask.data.length, ASK_AI_CAP)} waiting on your confirm or discard.`,
              },
  );

  return items;
}

/* ── III. What last failed ───────────────────────────────────────────────── */

export function failedItems(
  input: {
    producers: Fetched<ProducersStatusRaw>;
    reminders: Fetched<ReminderStatusRaw>;
    mail: Fetched<LetterSenderRaw>;
    mcp: Fetched<McpConnectionRaw[]>;
  },
  now: Date = new Date(),
): { items: ReadinessItem[]; allChecked: boolean } {
  const items: ReadinessItem[] = [];
  let allChecked = true;

  const p = input.producers;
  if (p.status === 'loading') allChecked = false;
  else if (p.status === 'error') {
    allChecked = false;
    items.push({ id: 'producers-read', label: 'Notification jobs', tone: 'unknown', detail: `Could not be read — ${p.message}` });
  } else if (p.status === 'ok') {
    for (const run of p.data.producers) {
      if (run.lastRunUnreadable) {
        items.push({ id: `producer-${run.producer}`, label: `Notification job “${run.producer}”`, tone: 'unknown', detail: `Its run ledger could not be read: ${run.lastRunUnreadable}` });
      } else if (run.lastRun && (run.lastRun.failed > 0 || run.lastRun.error)) {
        items.push({
          id: `producer-${run.producer}`,
          label: `Notification job “${run.producer}”`,
          tone: 'attention',
          detail: `${run.lastRun.failed} failed on its run ${fmtAgo(run.lastRun.started_at, now)}${run.lastRun.error ? ` — ${run.lastRun.error}` : ''}.`,
        });
      }
    }
  }

  const r = input.reminders;
  if (r.status === 'loading') allChecked = false;
  else if (r.status === 'error') {
    allChecked = false;
    items.push({ id: 'reminders-read', label: 'Calendar reminders', tone: 'unknown', detail: `Could not be read — ${r.message}` });
  } else if (r.status === 'ok') {
    if (!r.data.ledgerReadable) {
      items.push({ id: 'reminders-ledger', label: 'Calendar reminders', tone: 'unknown', detail: 'The run ledger could not be read, so whether reminders are sending is unknown.' });
    } else if (r.data.lastRun && (r.data.lastRun.failed > 0 || r.data.lastRun.error)) {
      items.push({
        id: 'reminders',
        label: 'Calendar reminders',
        tone: 'attention',
        detail: `${r.data.lastRun.failed} failed on its run ${fmtAgo(r.data.lastRun.startedAt, now)}${r.data.lastRun.error ? ` — ${r.data.lastRun.error}` : ''}.`,
      });
    }
  }

  const m = input.mail;
  if (m.status === 'loading') allChecked = false;
  else if (m.status === 'error') {
    allChecked = false;
    items.push({ id: 'mail-read', label: 'Mail reading', tone: 'unknown', detail: `Could not be read — ${m.message}` });
  } else if (m.status === 'ok' && m.data.reader.lastError) {
    items.push({ id: 'mail', label: 'Mail reading', tone: 'attention', detail: m.data.reader.lastError });
  }

  const mc = input.mcp;
  if (mc.status === 'loading') allChecked = false;
  else if (mc.status === 'error') {
    allChecked = false;
    items.push({ id: 'mcp-read', label: 'Model-context servers', tone: 'unknown', detail: `Could not be read — ${mc.message}` });
  } else if (mc.status === 'ok') {
    for (const c of mc.data.filter((c) => c.status === 'active' && c.probe && c.probe.status !== 'ok')) {
      items.push({
        id: `mcp-${c.id}`,
        label: `Model-context server “${c.name}”`,
        tone: 'attention',
        detail: `Last answered ${c.probe?.status}, ${fmtAgo(c.lastProbeAt, now)}${c.probe?.detail ? ` — ${c.probe.detail}` : ''}.`,
      });
    }
  }

  // A refused read (403) is a real answer, not a blocker on "allChecked" —
  // it means this role is not the one meant to see that source, and the
  // group can still say "nothing else recorded as failed" honestly.

  return { items, allChecked };
}
