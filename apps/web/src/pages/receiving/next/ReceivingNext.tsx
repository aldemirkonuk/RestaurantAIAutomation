/**
 * ReceivingNext — the Mudavym redesign of `/receiving` (ADR 0044 P2).
 *
 * The founder's verdict on the first redesign was REWORK: "I really like the
 * idea, but it needs way more improvement… more things, more structure." The
 * idea that is kept — LOCKED from the legacy page — is one event, three
 * renderings, chosen deterministically by role:
 *
 *   STAFF    today's expected deliveries — vendor, PO, line, count — and one
 *            big hand-off per delivery into the door flow. NO PRICES, ever.
 *   MANAGER  the decision queue worst-money-first, the three outcomes
 *            (accepted · short · refused) as first-class lanes, and the
 *            drafted-but-unsent credit requests rendered --calm with a
 *            hold-to-approve die beside each — the platform drafts, a person
 *            sends. Line-item editing hands off to /receipts, deliberately.
 *   OWNER    the recovered-money figure with its real trend and the honest
 *            denominator. Only credit memos count.
 *
 * Shared under all three: the door outbox rail — what is queued on phones
 * right now, and every receipt the outbox permanently dropped, pinned by
 * name until a person deals with it (the inv-09 defect fix; the legacy page
 * throws the flush's `failed` count away).
 *
 * Role source: useAuth, not the store — the legacy page documented why
 * (taking the role from the wrong source silently rendered the staff view to
 * an owner, and staff deliberately sees no money). Unrecognised roles fall
 * to the cost-free staff view: if the role cannot be established, showing
 * less is the safe direction to fail.
 */

import { useState } from 'react';
import { Wordmark } from '@/components/mudavym';
import { ink } from '@/lib/mudavym/motion';
import { useAuth } from '@/contexts/AuthContext';
import { RcCreditDrafts } from './RcCreditDrafts';
import { RcManagerQueue } from './RcManagerQueue';
import { RcOutboxRail } from './RcOutboxRail';
import { RcOwnerLedger } from './RcOwnerLedger';
import { RcStaffLane } from './RcStaffLane';
import { MONO, SANS, SERIF, capStyle } from './rc-format';
import {
  useCreditDrafts,
  useDoorOutbox,
  useManagerQueue,
  useOwnerRecovery,
  useStaffDeliveries,
} from './useReceivingNextData';

type Rendering = 'staff' | 'manager' | 'owner';

const RENDERING_SENTENCE: Record<Rendering, string> = {
  staff: 'Which delivery are you receiving?',
  manager: 'What needs a decision — worst money first.',
  owner: 'What actually came back.',
};

function renderingForRole(role: string): Rendering {
  if (role === 'owner') return 'owner';
  if (role === 'manager' || role === 'admin') return 'manager';
  return 'staff';
}

/**
 * Dev-only role preview. The demo fixture signs in as an owner, so without
 * this the other two renderings are unreachable on a dev machine. It renders
 * ONLY in dev builds, changes nothing about the session, and says so.
 */
function RolePreview({
  actual,
  preview,
  onPreview,
}: {
  actual: Rendering;
  preview: Rendering | null;
  onPreview: (r: Rendering | null) => void;
}) {
  if (!import.meta.env.DEV) return null;
  const options: Rendering[] = ['staff', 'manager', 'owner'];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        border: '1px dashed var(--ink-3, #7C7365)',
        borderRadius: 8,
        padding: '4px 8px',
        fontFamily: MONO,
      }}
    >
      <span
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        Preview · dev only · account unchanged
      </span>
      {options.map((r) => {
        const active = (preview ?? actual) === r;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onPreview(r === actual ? null : r)}
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              padding: '2px 8px',
              borderRadius: 5,
              border: `1px solid ${active ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)'}`,
              background: active ? 'var(--seal-tint, rgba(26,94,107,.10))' : 'transparent',
              color: active ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)',
              cursor: 'pointer',
              transition: `border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}`,
            }}
          >
            {r}
            {r === actual ? ' (yours)' : ''}
          </button>
        );
      })}
    </div>
  );
}

/* Each rendering mounts only its own queries — a porter's phone does not
   fetch credit stats it will never show. */

function StaffBody() {
  const staff = useStaffDeliveries();
  return <RcStaffLane data={staff} />;
}

function ManagerBody() {
  const queue = useManagerQueue();
  const drafts = useCreditDrafts();
  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px]" style={{ alignItems: 'start' }}>
      <RcManagerQueue data={queue} />
      <RcCreditDrafts data={drafts} />
    </div>
  );
}

function OwnerBody() {
  const recovery = useOwnerRecovery();
  return <RcOwnerLedger data={recovery} />;
}

export default function ReceivingNext() {
  const { user } = useAuth();
  const actual = renderingForRole((user?.role ?? '').toLowerCase());
  const [preview, setPreview] = useState<Rendering | null>(null);
  const rendering = preview ?? actual;
  const outbox = useDoorOutbox();

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* ── masthead ─────────────────────────────────────────────────── */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
              }}
            >
              Receiving
            </h1>
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)', margin: '4px 0 0' }}>
              {RENDERING_SENTENCE[rendering]}
            </p>
          </div>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
            <span style={capStyle}>
              one event · three renderings · this one is {rendering}
            </span>
            <RolePreview actual={actual} preview={preview} onPreview={setPreview} />
          </div>
        </header>

        {/* ── the rendering, with the shared outbox rail beside it ─────── */}
        <div
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
          style={{ alignItems: 'start' }}
        >
          <main>
            {rendering === 'staff' && <StaffBody />}
            {rendering === 'manager' && <ManagerBody />}
            {rendering === 'owner' && <OwnerBody />}
          </main>
          <aside>
            <RcOutboxRail data={outbox} />
          </aside>
        </div>
      </div>
    </div>
  );
}
