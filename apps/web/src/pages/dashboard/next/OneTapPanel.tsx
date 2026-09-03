/**
 * OneTapPanel — the one-tap actions desk, on the dashboard rail directly under
 * "Waiting on you".
 *
 * WHY IT LIVES HERE (founder's decision, 2026-09-03). One-tap actions were
 * built inside `/notifications` in the p4 first pass. They do not belong
 * there: the day-book is a RECORD — lines the house wrote, worked downwards
 * until the account is ruled off — and a standing action is not a line, it is
 * a piece of work with a next step. The rail already holds the page's
 * work-to-do column ("Waiting on you" → approvals), so an action the house
 * raised sits one panel below the approvals it is a cousin of, and the
 * day-book goes back to being only a book. The two other homes considered and
 * the cost of each are argued in `.planning/06-pages/notifications.md` §1b.
 *
 * SELF-CONTAINED BY CONSTRUCTION. It takes a restaurant id and nothing else:
 * its own read, its own writes, its own view models, its own honesty states.
 * Nothing here imports from `pages/notifications/**` (pages do not import
 * across pages) and nothing here needs the dashboard spine.
 *
 * THE CALM CONTRACT it keeps. A card the house raised is VISUALLY INCAPABLE of
 * looking like something that was carried out: the edge is dashed, the chip
 * names the author, and the line underneath says what has NOT happened.
 * `createSystemAction` inserts no `user_id`
 * (`one-tap-actions.service.ts:366-382`) while `POST /one-tap-actions` stamps
 * the caller (`:150-152`), so an absent author is the STRUCTURAL proof that
 * the house raised the row rather than a person here — not a tone.
 *
 * AND THE HONESTY LINE THAT MUST NOT BE DROPPED. The gateway's
 * `triggerWorkflow` is three `// TODO` branches and a default log
 * (`one-tap-actions.service.ts:404-430`). Marking an action done RECORDS the
 * decision against your name and stamps `executed_at`; it does not place an
 * order, send a mail, or move stock. The card says so above the die, because
 * a seal that implies a reorder it never made is the exact lie this house's
 * ceremony exists to prevent.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Hand, PenLine, Undo2, UserRound } from 'lucide-react';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { timeAgo } from './format';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const DASHED = '1.5px dashed var(--seal-ring)';

/* ── shapes ──────────────────────────────────────────────────────────────── */

export type OneTapStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired';

/** `OneTapActionResponseDto`, as it reaches the browser. */
export interface OneTapAction {
  id: string;
  restaurantId: string;
  /** The AUTHOR. Absent ⇒ the house raised it (see the header note). */
  userId?: string | null;
  actionType: string;
  title: string;
  description?: string;
  actionUrl?: string;
  priority: string;
  status: OneTapStatus;
  createdAt: string;
  executedAt?: string;
  expiresAt?: string;
}

export interface CreateOneTapInput {
  title: string;
  description?: string;
  actionUrl?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface FailureVM {
  status: number | null;
  message: string;
  /** 403/401 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

/**
 * loading — the request is genuinely in flight
 * unreadable — refused (403/401) or broken; the panel SAYS WHICH
 * ready — a real answer, including a real empty desk
 */
export type Register =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: FailureVM }
  | { state: 'ready'; rows: OneTapAction[] };

function failureOf(error: unknown): FailureVM {
  const raw = (error as { response?: { status?: unknown } } | null)?.response?.status;
  const status = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  return { status, message: getErrorMessage(error), forbidden: status === 403 || status === 401 };
}

function rowsOf(payload: unknown): OneTapAction[] {
  if (Array.isArray(payload)) return payload as OneTapAction[];
  const p = payload as { actions?: unknown; data?: unknown } | null;
  for (const candidate of [p?.actions, p?.data]) {
    if (Array.isArray(candidate)) return candidate as OneTapAction[];
  }
  return [];
}

/* ── the read, tenant-keyed ──────────────────────────────────────────────── */

export interface OneTapDesk {
  register: Register;
  /** The last thing that did not happen, in words. Cleared on the next try. */
  failureNote: string | null;
  refresh: () => void;
  execute: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  create: (input: CreateOneTapInput) => Promise<void>;
}

/**
 * Every read and write is keyed by `restaurantId`, and a response that arrives
 * after the restaurant has been switched is discarded rather than rendered —
 * a tenant switch must never leave the previous house's actions on screen.
 */
export function useOneTapActions(restaurantId: string | null): OneTapDesk {
  const [register, setRegister] = useState<Register>({ state: 'loading' });
  const [failureNote, setFailureNote] = useState<string | null>(null);
  const tenant = useRef<string | null>(restaurantId);
  const alive = useRef(true);

  useEffect(() => {
    tenant.current = restaurantId;
    setRegister({ state: 'loading' });
    setFailureNote(null);
  }, [restaurantId]);

  const read = useCallback(async () => {
    if (!restaurantId) return; // identity still resolving — stay loading
    const forTenant = restaurantId;
    try {
      const res = await apiClient.get('/one-tap-actions', {
        params: { restaurantId: forTenant },
      });
      if (!alive.current || tenant.current !== forTenant) return;
      setRegister({ state: 'ready', rows: rowsOf(res.data) });
    } catch (err) {
      if (!alive.current || tenant.current !== forTenant) return;
      setRegister({ state: 'unreadable', failure: failureOf(err) });
    }
  }, [restaurantId]);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  const act = useCallback(
    async (id: string, path: 'execute' | 'cancel', what: string) => {
      setFailureNote(null);
      try {
        await apiClient.post(`/one-tap-actions/${id}/${path}`, {});
        await read();
      } catch (err) {
        setFailureNote(`${what} was refused (${failureOf(err).message}) — the action is unchanged.`);
        throw err;
      }
    },
    [read],
  );

  const execute = useCallback((id: string) => act(id, 'execute', 'Marking it done'), [act]);
  const cancel = useCallback((id: string) => act(id, 'cancel', 'Ruling it out'), [act]);

  const create = useCallback(
    async (input: CreateOneTapInput) => {
      setFailureNote(null);
      try {
        await apiClient.post('/one-tap-actions', {
          title: input.title,
          description: input.description || undefined,
          actionUrl: input.actionUrl || undefined,
          actionType: 'custom',
          priority: input.priority,
        });
        await read();
      } catch (err) {
        setFailureNote(`The action was not saved (${failureOf(err).message}) — nothing was created.`);
        throw err;
      }
    },
    [read],
  );

  return { register, failureNote, refresh: () => void read(), execute, cancel, create };
}

/* ── the card ────────────────────────────────────────────────────────────── */

function CalmChip({ children, icon: Icon }: { children: string; icon: typeof Hand }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--seal-deep)',
        border: DASHED,
        borderRadius: 3,
        padding: '2px 6px',
      }}
    >
      <Icon size={10} strokeWidth={1.75} aria-hidden />
      {children}
    </span>
  );
}

export function ActionCard({
  action,
  byHouse,
  onExecute,
  onCancel,
}: {
  action: OneTapAction;
  byHouse: boolean;
  onExecute: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  // Bumped after a refusal so the die remounts at rest rather than staying sealed.
  const [attempt, setAttempt] = useState(0);
  return (
    <li
      className="rounded-md px-3 py-2.5"
      style={{
        border: byHouse ? DASHED : '1px solid var(--paper-2)',
        background: 'var(--paper-1)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CalmChip icon={byHouse ? Hand : UserRound}>
          {byHouse ? 'Raised by the house · not done' : 'Raised by a person here'}
        </CalmChip>
        <span style={{ fontFamily: MONO, fontSize: 10.5 }} className="text-inkm-4">
          {timeAgo(action.createdAt)}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-inkm-1">{action.title}</p>
      {action.description && (
        <p className="mt-0.5 text-[11.5px] text-inkm-4">{action.description}</p>
      )}
      <p className="mt-1 text-[11px] text-inkm-4">
        Marking it done records the decision against your name. It does not place the order itself
        — that happens where the link goes.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action.actionUrl && (
          <Link
            to={action.actionUrl.startsWith('/') ? action.actionUrl : `/${action.actionUrl}`}
            className="dn-ink inline-flex items-center gap-1.5 rounded border border-seal-ring px-2 py-1 text-[11px] text-seal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          >
            Go and do it
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
          </Link>
        )}
        <button
          type="button"
          onClick={() => void onCancel(action.id).catch(() => undefined)}
          className="dn-ink inline-flex items-center gap-1.5 rounded border border-paper-2 px-2 py-1 text-[11px] text-inkm-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        >
          <Undo2 size={12} strokeWidth={1.75} aria-hidden />
          Undo — rule it out
        </button>
        <div className="min-w-[180px] flex-1">
          <HoldToApprove
            key={attempt}
            label="Hold to mark it done"
            approvedLabel="Recorded"
            onApprove={() => {
              void onExecute(action.id).catch(() => setAttempt((a) => a + 1));
            }}
          />
        </div>
      </div>
    </li>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────── */

export interface OneTapPanelProps {
  restaurantId: string | null;
}

export function OneTapPanel({ restaurantId }: OneTapPanelProps) {
  const desk = useOneTapActions(restaurantId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);

  const rows = desk.register.state === 'ready' ? desk.register.rows : [];
  const pending = rows.filter((a) => a.status === 'pending');
  const byHouse = pending.filter((a) => !a.userId);
  const byPeople = pending.filter((a) => !!a.userId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await desk.create({ title: title.trim(), description, actionUrl, priority });
      setTitle('');
      setDescription('');
      setActionUrl('');
      setOpen(false);
    } catch {
      /* desk.failureNote says what did not happen */
    } finally {
      setSaving(false);
    }
  };

  const field: CSSProperties = {
    fontSize: 12,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--paper-2)',
    background: 'var(--paper-0)',
    color: 'var(--ink-1)',
  };

  return (
    <section
      className="rounded-lg border border-paper-2 bg-paper-0 p-4"
      aria-label="One-tap actions"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-inkm-1">
          <Hand size={13} strokeWidth={1.75} aria-hidden />
          One-tap actions
        </h2>
        <span className="text-[11px] uppercase tracking-[0.1em] text-inkm-4" style={{ fontFamily: MONO }}>
          {desk.register.state === 'ready' ? pending.length : '—'}
        </span>
      </div>

      <div className="mt-3">
        {desk.register.state === 'loading' && (
          <div className="space-y-2">
            <div className="dn-skel h-9" aria-hidden />
            <div className="dn-skel h-9 w-4/5" aria-hidden />
          </div>
        )}

        {desk.register.state === 'unreadable' && (
          <p role="status" className="text-[12px] text-inkm-2">
            {desk.register.failure.forbidden
              ? `The one-tap register refused this account (${desk.register.failure.status ?? 'refused'}). Nothing is listed because nothing could be read — an owner or manager account can read it.`
              : `The one-tap register could not be read (${desk.register.failure.message}). Nothing is listed because nothing could be read — this is not an empty desk.`}
          </p>
        )}

        {desk.register.state === 'ready' && pending.length === 0 && (
          <p className="text-[12px] italic text-inkm-4">
            Nothing standing. Actions the house raises for itself land here, dashed and unsent,
            until a person decides.
          </p>
        )}

        {pending.length > 0 && (
          <ul className="space-y-2">
            {byHouse.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                byHouse
                onExecute={desk.execute}
                onCancel={desk.cancel}
              />
            ))}
            {byPeople.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                byHouse={false}
                onExecute={desk.execute}
                onCancel={desk.cancel}
              />
            ))}
          </ul>
        )}

        {desk.failureNote && (
          <p role="status" className="mt-2 text-[11.5px] text-inkm-2">
            {desk.failureNote}
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="dn-ink mt-3 inline-flex items-center gap-1.5 rounded border border-seal-ring px-2 py-1 text-[11px] text-seal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        >
          <PenLine size={12} strokeWidth={1.75} aria-hidden />
          {open ? 'Never mind' : 'Write a new one'}
        </button>

        <div className="dn-expand" data-open={open}>
          <div>
            <form onSubmit={submit} className="mt-3 space-y-2">
              <label className="block text-[11px] text-inkm-4">
                What is it
                <input
                  style={field}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Call Bodega Álvaro about the Rioja"
                  required
                />
              </label>
              <label className="block text-[11px] text-inkm-4">
                A line of context (optional)
                <input
                  style={field}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label className="block text-[11px] text-inkm-4">
                Where it is done (optional, e.g. /inventory)
                <input
                  style={field}
                  value={actionUrl}
                  onChange={(e) => setActionUrl(e.target.value)}
                />
              </label>
              <label className="block text-[11px] text-inkm-4">
                How much it presses
                <select
                  style={field}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={saving || title.trim() === ''}
                className="dn-ink rounded border border-seal-ring bg-seal-tint px-2.5 py-1.5 text-[11.5px] font-semibold text-seal disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
              >
                {saving ? 'Writing it down…' : 'Write it into the book'}
              </button>
            </form>
          </div>
        </div>

        <p className="mt-3 border-t border-paper-2 pt-2 text-[11px] text-inkm-4">
          Marking an action done records the decision and stamps who made it. It does not place an
          order or send a mail — the gateway’s workflow trigger is not built
          (<code style={{ fontFamily: MONO }}>one-tap-actions.service.ts:404</code>), so the
          seal here means “decided”, never “done by the house”.
        </p>
      </div>
    </section>
  );
}

export default OneTapPanel;
