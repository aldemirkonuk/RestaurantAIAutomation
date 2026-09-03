/**
 * HouseBand — "what the house did on its own", in the `--calm` idiom, and the
 * one-tap desk beside it.
 *
 * The calm contract (the same one ReceivingNext's credit drafts keep): a card
 * in this band is VISUALLY INCAPABLE of looking like something that was sent
 * or carried out. The edge is dashed, the chip names the author, and the line
 * underneath says what has NOT happened. The only forward control is a human
 * one.
 *
 * Two things qualify, and they qualify structurally rather than by tone:
 *
 *  - a `draft_ready` notification — the inbound responder understood a
 *    vendor's mail and drafted a reply it deliberately did not send;
 *  - a pending one-tap action with NO author — `createSystemAction` inserts
 *    no `user_id`, so an authorless row is one the house raised itself.
 *
 * Ceremony is rationed. Executing a one-tap action is a durable server write
 * stamped with your identity, so it gets the wax: HoldToApprove, completing
 * into the seal. Reviewing a draft is navigation, so it gets a link. And the
 * card says plainly what "done" does and does not do — the gateway's
 * `triggerWorkflow` is a set of TODO stubs (`one-tap-actions.service.ts:404`),
 * so marking an action done records the decision; it does not place an order.
 */

import { useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HoldToApprove } from '@/components/mudavym';
import type { Notification } from '@/services/api/notifications';
import { MONO, SANS, SERIF, timeAgo } from './nt-format';
import type { CreateOneTapInput, OneTapAction, Register } from './useNotificationsNextData';

const DASHED = '1.5px dashed var(--seal-ring)';

function CalmChip({ children }: { children: string }) {
  return (
    <span
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
      {children}
    </span>
  );
}

function DraftCard({ row, onRuleOff }: { row: Notification; onRuleOff: () => void }) {
  const to = row.actionUrl?.startsWith('/') ? row.actionUrl : '/communications';
  return (
    <li
      className="rounded-xl px-3.5 py-3"
      style={{ border: DASHED, background: 'var(--paper-0)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CalmChip>Drafted by the house · unsent</CalmChip>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
          {timeAgo(row.timestamp ?? row.createdAt)}
        </span>
      </div>
      <p
        className="mt-2 text-[13.5px] font-semibold"
        style={{ fontFamily: SERIF, color: 'var(--ink-1)' }}
      >
        {row.title || 'A reply was drafted'}
      </p>
      <p className="mt-0.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        {row.message || 'The house read the vendor’s mail and wrote a reply.'} Nothing has gone to
        the vendor — a person sends it, or nobody does.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Link
          to={to}
          className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{ fontFamily: SANS, border: '1px solid var(--seal-ring)', color: 'var(--seal-deep)' }}
        >
          Read the draft before it goes →
        </Link>
        <button
          type="button"
          onClick={onRuleOff}
          className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{
            fontFamily: SANS,
            border: '1px solid var(--paper-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          Rule it off
        </button>
      </div>
    </li>
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
      className="rounded-xl px-3.5 py-3"
      style={{
        border: byHouse ? DASHED : '1px solid var(--paper-2)',
        background: 'var(--paper-0)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CalmChip>{byHouse ? 'Raised by the house · not done' : 'Raised by a person here'}</CalmChip>
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
          {timeAgo(action.createdAt)}
        </span>
      </div>
      <p
        className="mt-2 text-[13.5px] font-semibold"
        style={{ fontFamily: SERIF, color: 'var(--ink-1)' }}
      >
        {action.title}
      </p>
      {action.description && (
        <p className="mt-0.5 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          {action.description}
        </p>
      )}
      <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        Marking it done records the decision against your name. It does not place the order itself
        — that happens where the link goes.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {action.actionUrl && (
          <Link
            to={action.actionUrl.startsWith('/') ? action.actionUrl : `/${action.actionUrl}`}
            className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
            style={{
              fontFamily: SANS,
              border: '1px solid var(--seal-ring)',
              color: 'var(--seal-deep)',
            }}
          >
            Go and do it →
          </Link>
        )}
        <button
          type="button"
          onClick={() => void onCancel(action.id).catch(() => undefined)}
          className="nt-ink rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          style={{
            fontFamily: SANS,
            border: '1px solid var(--paper-2)',
            background: 'transparent',
            color: 'var(--ink-2)',
            cursor: 'pointer',
          }}
        >
          Undo — rule it out
        </button>
        <div className="min-w-[200px] flex-1">
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

export interface HouseBandProps {
  drafts: Notification[];
  houseActions: OneTapAction[];
  actions: Register<OneTapAction>;
  /** The inbox itself could not be read — so "nothing" here is not a finding. */
  bookUnreadable: boolean;
  onRuleOff: (id: string) => void;
  onExecute: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}

export function HouseBand({
  drafts,
  houseActions,
  actions,
  bookUnreadable,
  onRuleOff,
  onExecute,
  onCancel,
}: HouseBandProps) {
  const empty = drafts.length === 0 && houseActions.length === 0;
  return (
    <section aria-labelledby="nt-house" className="mt-6">
      <h2
        id="nt-house"
        className="text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        What the house did on its own
      </h2>
      <ul className="mt-2 space-y-2">
        {drafts.map((row) => (
          <DraftCard key={row.id} row={row} onRuleOff={() => onRuleOff(row.id)} />
        ))}
        {houseActions.map((a) => (
          <ActionCard key={a.id} action={a} byHouse onExecute={onExecute} onCancel={onCancel} />
        ))}
      </ul>
      {actions.state === 'unreadable' && (
        <p role="status" className="mt-2 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
          {actions.failure.forbidden
            ? 'Your account is not allowed to read the one-tap register, so this band is incomplete — it shows only what the inbox itself records.'
            : `The one-tap register could not be read (${actions.failure.message}), so this band is incomplete — it shows only what the inbox itself records.`}
        </p>
      )}
      {empty && bookUnreadable && (
        <p role="status" className="mt-2 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
          This band is empty because the inbox could not be read — not because the house has been
          idle.
        </p>
      )}
      {empty && !bookUnreadable && actions.state === 'ready' && (
        <p className="mt-2 text-[11.5px] italic" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          The house has not acted unasked on any line in this book. Drafted vendor replies and
          actions the house raises for itself land here, dashed and unsent, until a person decides.
        </p>
      )}
    </section>
  );
}

/* ── The desk: your own standing one-tap actions, and making a new one ──── */

export interface OneTapDeskProps {
  mine: OneTapAction[];
  actions: Register<OneTapAction>;
  onExecute: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onCreate: (input: CreateOneTapInput) => Promise<void>;
}

export function OneTapDesk({ mine, actions, onExecute, onCancel, onCreate }: OneTapDeskProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate({ title: title.trim(), description, actionUrl, priority });
      setTitle('');
      setDescription('');
      setActionUrl('');
      setOpen(false);
    } catch {
      /* the page's own status line says what did not happen */
    } finally {
      setSaving(false);
    }
  };

  const field: CSSProperties = {
    fontFamily: SANS,
    fontSize: 12,
    width: '100%',
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid var(--paper-2)',
    background: 'var(--paper-0)',
    color: 'var(--ink-1)',
  };

  return (
    <section
      aria-labelledby="nt-desk"
      className="rounded-xl p-3.5"
      style={{ border: '1px solid var(--paper-2)', background: 'var(--paper-1)' }}
    >
      <h2
        id="nt-desk"
        className="text-[11px] uppercase tracking-[0.14em]"
        style={{ fontFamily: MONO, color: 'var(--ink-4)' }}
      >
        Your one-tap actions
      </h2>
      <p className="mt-1 text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
        Saved on the server against this restaurant — they survive a refresh, and everyone here
        sees them.
      </p>

      {actions.state === 'loading' && <div className="nt-skel mt-3 h-9" aria-hidden />}
      {actions.state === 'unreadable' && (
        <p role="status" className="mt-2 text-[11.5px]" style={{ fontFamily: SANS, color: 'var(--ink-2)' }}>
          {actions.failure.forbidden
            ? `The one-tap register refused this account (${actions.failure.status ?? 'refused'}). Nothing is listed because nothing could be read.`
            : `The one-tap register could not be read (${actions.failure.message}). Nothing is listed because nothing could be read — this is not an empty desk.`}
        </p>
      )}
      {actions.state === 'ready' && mine.length === 0 && (
        <p className="mt-2 text-[11.5px] italic" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
          No standing actions yet.
        </p>
      )}
      {mine.length > 0 && (
        <ul className="mt-2 space-y-2">
          {mine.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              byHouse={false}
              onExecute={onExecute}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="nt-ink mt-3 rounded px-2 py-1 text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        style={{
          fontFamily: SANS,
          border: '1px solid var(--seal-ring)',
          background: 'transparent',
          color: 'var(--seal-deep)',
          cursor: 'pointer',
        }}
      >
        {open ? 'Never mind' : 'Write a new one'}
      </button>

      <div className="nt-expand" data-open={open}>
        <div>
          <form onSubmit={submit} className="mt-3 space-y-2">
            <label className="block text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
              What is it
              <input
                style={field}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Call Bodega Álvaro about the Rioja"
                required
              />
            </label>
            <label className="block text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
              A line of context (optional)
              <input
                style={field}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
              Where it is done (optional, e.g. /inventory)
              <input
                style={field}
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
              />
            </label>
            <label className="block text-[11px]" style={{ fontFamily: SANS, color: 'var(--ink-4)' }}>
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
              className="nt-ink rounded px-2.5 py-1.5 text-[11.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
              style={{
                fontFamily: SANS,
                fontWeight: 600,
                border: '1px solid var(--seal-ring)',
                background: 'var(--seal-tint)',
                color: 'var(--seal-deep)',
                cursor: saving || title.trim() === '' ? 'default' : 'pointer',
                opacity: saving || title.trim() === '' ? 0.5 : 1,
              }}
            >
              {saving ? 'Writing it down…' : 'Write it into the book'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default HouseBand;
