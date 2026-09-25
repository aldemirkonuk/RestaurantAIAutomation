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
 *            denominator (only credit memos count) PLUS the same decision
 *            queue as manager — ADR 0149 row 44 (2026-09-18): production has
 *            owner and manager rows (6 of 10 restaurants are owner-only; a
 *            single staff row exists too, Sim Bistro, re-measured 2026-09-19),
 *            so the owner is often the only person who can act on it.
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
import { useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/mudavym';
import { DayLine } from '@/components/mudavym/DayLine';
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
  owner: 'What actually came back — and what needs a decision.',
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

/**
 * The decision queue itself — shared by the manager and owner renderings
 * (ADR 0149 row 44, 2026-09-18: the queue now opens for owner too, since
 * production is majority owner-only (6 of 10 restaurants;
 * production-tenant-shape, re-measured live 2026-09-19) — so an owner is
 * often the only person who can act on it). Kept
 * as one component so the two renderings cannot drift on what "the decision
 * queue" actually shows.
 */
function DecisionQueue({ highlightOrderId }: { highlightOrderId: string | null }) {
  const queue = useManagerQueue();
  const drafts = useCreditDrafts();
  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px]" style={{ alignItems: 'start' }}>
      <RcManagerQueue data={queue} highlightOrderId={highlightOrderId} />
      <RcCreditDrafts data={drafts} />
    </div>
  );
}

function ManagerBody({ highlightOrderId }: { highlightOrderId: string | null }) {
  return <DecisionQueue highlightOrderId={highlightOrderId} />;
}

function OwnerBody({ highlightOrderId }: { highlightOrderId: string | null }) {
  const recovery = useOwnerRecovery();
  return (
    <div className="grid gap-8">
      <RcOwnerLedger data={recovery} />
      <DecisionQueue highlightOrderId={highlightOrderId} />
    </div>
  );
}

/**
 * `?order=` (`/deliveries/:id`, DeliveryRedirect.tsx) names a delivery the
 * founder's "worst money first" decision queue is where it gets acted on.
 * ADR 0149 row 44 (2026-09-18) opened that queue to the
 * owner rendering too — production is majority owner-only (6 of 10
 * restaurants; production-tenant-shape, re-measured live 2026-09-19) — so
 * only the staff rendering still lacks it and needs pointing elsewhere.
 * Without this, the person most likely to actually tap "Open the delivery"
 * from a notification landed on a page that said
 * nothing about why they were there at all. The staff
 * rendering has no per-delivery read to confirm or deny anything about this
 * specific order, so — same honesty rule as `OrdersNext.tsx`'s
 * `targetMissing` — this says only what IS known: a hand-off arrived, and
 * where the actual decision lives.
 */
function HighlightElsewhereNote({ orderId }: { orderId: string }) {
  return (
    <div
      role="status"
      data-testid="highlight-elsewhere-note"
      className="mb-4 rounded-xl px-4 py-3"
      style={{
        fontFamily: SANS,
        fontSize: 12.5,
        color: 'var(--ink-2, #4F473C)',
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-1, #F3EFE6)',
      }}
    >
      A delivery hand-off pointed here at order {orderId} — that decision lives in the decision
      queue on the manager or owner view. Ask a manager or owner to open it from Receiving.
    </div>
  );
}

export default function ReceivingNext() {
  const { user } = useAuth();
  const actual = renderingForRole((user?.role ?? '').toLowerCase());
  const [preview, setPreview] = useState<Rendering | null>(null);
  const rendering = preview ?? actual;
  const outbox = useDoorOutbox();
  /**
   * One order asked for from OUTSIDE the page — `/deliveries/:id`
   * (DeliveryRedirect.tsx) resolves a delivery to its order and lands here
   * with it, because the decision queue is where the founder's "worst money
   * first" verdicts on an unresolved delivery live. Read once; the queue
   * opens for both manager and owner (ADR 0149 row 44), so only the staff
   * rendering has no queue to highlight it IN — it still says so by name
   * (`HighlightElsewhereNote`) rather than the silence this used to be, since
   * the majority of production is owner-only (6 of 10 restaurants;
   * production-tenant-shape, re-measured live 2026-09-19).
   */
  const [searchParams] = useSearchParams();
  const highlightOrderId = searchParams.get('order');

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

        {/* ── the day line (sketch 119 §E) ─────────────────────────────── */}
        {/* A PAGE element, self-gated by the shell flag — renders nothing
            when the shell is off. Shared under all three renderings, the
            same as the masthead above it. */}
        <DayLine />

        {/* ── the rendering, with the shared outbox rail beside it ─────── */}
        <div
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]"
          style={{ alignItems: 'start' }}
        >
          <main>
            {highlightOrderId && rendering === 'staff' && (
              <HighlightElsewhereNote orderId={highlightOrderId} />
            )}
            {rendering === 'staff' && <StaffBody />}
            {rendering === 'manager' && <ManagerBody highlightOrderId={highlightOrderId} />}
            {rendering === 'owner' && <OwnerBody highlightOrderId={highlightOrderId} />}
          </main>
          <aside>
            <RcOutboxRail data={outbox} />
          </aside>
        </div>
      </div>
    </div>
  );
}
