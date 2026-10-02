/**
 * ReceiptsNext — the Mudavym redesign of `/receipts` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: KEEP+, "the most demanding brief in the set").
 *
 * The founder's four requirements, built:
 * 1. Everything from the orders is compressed into this surface — the
 *    review queue and the deliveries still WITHOUT paperwork share it.
 * 2. Backend integrated without overcrowding: one queue, one selected
 *    document, detail on demand.
 * 3. "Make sure it is the right invoice": THE SCAN ITSELF sits beside the
 *    lines — a screen that asks a human to certify a transcription must show
 *    them the page it was transcribed from — the linked order rides above
 *    them, and the matcher's pairings are shown with their reasons and their
 *    confidences.
 *
 *    Correction: this docblock previously said the matcher's pairings are
 *    "never auto-written". That was false. `POST :id/match` WRITES every
 *    unambiguous vendor-SKU pairing before it answers (line-matcher.ts:282-296,
 *    documents.controller.ts:209-224) and returns them under `applied`; only
 *    `suggested` is withheld pending a human. The page now names the applied
 *    ones, shows their confidence, and offers Unlink for each — a comment that
 *    misdescribes the code is worse than no comment.
 * 4. "We can edit, and we can just confirm it right away": qty / unit price
 *    / line total are editable in place (pre-verification only), the
 *    recomputed tie-out lands with the response, and confirmation is the
 *    swipe-up ceremony the founder named, asserting exactly what verify
 *    asserts: the transcription is faithful. Nothing here applies stock.
 *
 * Motions (06-pages/receipts.md §1b): swipe-up confirm (pour-rate fill,
 * tuck on early release); row settle for the doc open; ink micro-states.
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove, Wordmark } from '@/components/mudavym';
import {
  documentsApi,
  type DocumentLineMatch,
  type ProcurementDocument,
  type ProcurementDocumentLine,
} from '../../../services/api/documents';
import { getOrder } from '../../../services/api/orders';
import { canonicalApi } from '../../../services/api/canonical';
import { useAuth } from '@/contexts/AuthContext';
// The ONE ISO 4217 list, shared with the sign-up currency step. A second list
// here is how `TL` becomes a fourth kind of lira.
import {
  CURRENCY_CODES,
  CURRENCY_NOT_RECORDED,
  currencyLabel,
} from '@/lib/currency';
import { ink, settle } from '../../../lib/mudavym/motion';
import { vendorClause } from '../../../lib/mudavym/vendor';
import {
  EM,
  GE,
  MONO,
  SANS,
  SERIF,
  fmtConfidence,
  fmtDate,
  fmtMoney,
  isSignedUrlExpired,
  moneyName,
  parseCell,
  sentence,
  serverMessage,
} from './rc2-format';
import { DOC_TYPE_LABELS, nameCarriesYear } from '../../../components/documents/canonical-format';
import { SwipeToConfirm } from './SwipeToConfirm';
import {
  RECEIPTS_SERVER_WINDOWS,
  useActiveRestaurantId,
  useReceiptsNextData,
} from './useReceiptsNextData';

// The credit ledger is this page's second lane (ADR 0149 row 22). `/credits`
// lands here as `?tab=credits`. Until 2026-09-25 that tab lazy-loaded the
// LEGACY `ReceiptsPage`, so a live Mudavym route still rendered the old design
// for one tab; it now renders `ReceiptsCredits`, and nothing on a live route
// imports the legacy page (its only importer is App.tsx's `legacy` slot, which
// `receipts` being in LIVE_PAGES never reaches outside a QA override).
const ReceiptsCredits = lazy(() =>
  import('./ReceiptsCredits').then((m) => ({ default: m.ReceiptsCredits })),
);

/**
 * Whether this person is offered the credit ledger. ADR 0167 (founder
 * 2026-09-19, "Refuse staff on all four"; RolesGuard exact since ADR 0164):
 * the gateway answers the list, the figures and every move only for the
 * owner or a manager of the house in the token — `admin` is refused there
 * too, the same as staff. The role read is the one IN THIS HOUSE,
 * `activeRole`; `user.role` is the global `users.role` and only the fallback
 * while no house is active. An unrecognised role is treated as staff, as the
 * server does.
 *
 * Fixed in the PR #476 audit (round 1): this had reintroduced admin, the
 * exact bug PR #395's audit already found and fixed on the legacy
 * `ReceiptsPage.tsx` (`canSeeCredits`, which admits owner/manager only).
 */
export function canSeeCreditLedger(
  activeRole: string | null | undefined,
  globalRole: string | null | undefined,
): boolean {
  const role = (activeRole ?? globalRole ?? '').toLowerCase();
  return role === 'owner' || role === 'manager';
}
const CanonicalDocumentPage = lazy(() =>
  import('../../documents/next/CanonicalDocumentPage').then((m) => ({
    default: m.CanonicalDocumentPage,
  })),
);

/*
 * ONE WORD MAP, THE SHEET'S (walk-through RECEIPTS-W44, 2026-10-01). This page
 * kept its own copy with seven of the twelve types, so an irsaliye listed
 * among the clean papers read "delivery_note". A type outside the map is
 * "Document", never its stored code.
 */
const TYPE_LABELS: Record<string, string> = DOC_TYPE_LABELS;
const typeLabel = (t: string) => TYPE_LABELS[t] ?? TYPE_LABELS.unknown;

function TieOutLine({ doc }: { doc: ProcurementDocument }) {
  // In words, not as a meter reading (walk-through W23, 2026-10-01).
  if (doc.ties_out === null)
    return (
      <span style={{ fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
        No stated total to test the lines against.
      </span>
    );
  if (doc.ties_out)
    return (
      <span style={{ fontSize: 12, color: 'var(--seal-deep, #14515C)' }}>
        The lines add up to the stated total.
      </span>
    );
  return (
    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
      The total is off by{' '}
      {doc.tie_out_delta == null ? EM : fmtMoney(Math.abs(doc.tie_out_delta), doc.currency)} from the lines.
    </span>
  );
}

/**
 * RULE 3 — what money this invoice is in, and the house's deliberate change.
 *
 * Founder, 2026-09-06 (batch 63): *"take the houses own currency, but AI needs
 * to or otherwise house delibaretly chnage it to other currency if the invoice
 * is other than their default"*.
 *
 * WHAT THIS BLOCK SHOWS, IN ORDER
 *   1. What the money is filed under, and WHERE that came from — the vendor's
 *      own statement or this house's row. Those two are the whole difference
 *      between a bill and an assumption, and the page said neither before.
 *   2. The HOLD, when there is one. `notes` carries the server's sentence,
 *      which names which currency the file would take, which the model saw and
 *      where. It is rendered VERBATIM: it contains figures and a location this
 *      client does not have and could not paraphrase without inventing them.
 *   3. The control. Managers and owners pick a code; STAFF SEE IT DISABLED with
 *      the sentence, never hidden — a control that vanishes teaches a person
 *      the feature does not exist, and the next thing they do is retype the
 *      invoice somewhere else.
 *
 * The picker is `CURRENCY_CODES` — the same ISO 4217 list the sign-up step
 * offers — so "TL" and "$" cannot be typed in at all. There is no free-text
 * box, because a `varchar(3)` that accepts three spellings of one currency
 * holds three currencies.
 */
function CurrencyBlock({
  doc,
  onChanged,
}: {
  doc: ProcurementDocument;
  onChanged: () => void;
}) {
  const { activeRole, user } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  const canManage = role === 'owner' || role === 'manager';

  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  /*
   * FOCUS FOLLOWS THE FOLD (walk-through W12, 2026-10-01). Opening or keeping
   * removes the button that was pressed, so focus fell to the page body and a
   * keyboard reader lost their place. Opening now lands on the currency
   * picker (or "Keep" when the role cannot pick); keeping lands back on
   * "Change the currency". Only a press moves focus, never the first render.
   */
  const changeRef = useRef<HTMLButtonElement>(null);
  const pickRef = useRef<HTMLSelectElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    if (open) (pickRef.current && !pickRef.current.disabled ? pickRef.current : keepRef.current)?.focus();
    else changeRef.current?.focus();
  }, [open]);

  const restate = useMutation({
    /**
     * The restatement carries the seal minted when the hold began (founder,
     * 2026-09-06, batch 64). The gateway refuses without one, in words, and the
     * gate is still role FIRST: staff never reach the hold at all.
     */
    mutationFn: (challenge?: string | null) =>
      documentsApi.restateCurrency(doc.id, choice, reason || undefined, challenge),
    onSuccess: (res) => {
      setError(null);
      // The SERVER'S sentence, not ours. It names the figures that moved and
      // this component holds none of them.
      setMoved(
        res.lineFailures.length
          ? `${res.sentence} ${res.lineFailures.length} line(s) could NOT be re-filed: ${res.lineFailures.join('; ')}.`
          : res.sentence,
      );
      setChoice('');
      setReason('');
      onChanged();
    },
    onError: (e) => {
      setMoved(null);
      setError(serverMessage(e, 'The currency was not changed.'));
    },
  });

  // The hold and the provenance both live in `notes`, which is where
  // `document-intake.service.ts` joins every warning. A held document is the
  // one case where the sentence is load-bearing rather than informative.
  const held = (doc.notes ?? '')
    .split('\n')
    .filter((l) => l.includes('MONEY HELD') || l.includes('money on this document was REFUSED'));

  const filed = doc.currency && /^[A-Z]{3}$/.test(doc.currency) ? doc.currency : null;

  /*
   * SETTLED MONEY IS ONE LINE (walk-through W9, 2026-10-01). A filed currency
   * with no hold is the usual case, and the full changer sat between the
   * verdict and the lines on every review. It folds to a sentence and a
   * "Change the currency" button, which every role sees, so the act is never
   * hidden. A hold, a result or an error always opens it.
   */
  const settled = !!filed && held.length === 0 && !moved && !error && !restate.isPending;
  if (settled && !open)
    return (
      <p
        aria-label="What money this invoice is in"
        style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: 0 }}
      >
        This invoice&rsquo;s money is filed in {moneyName(filed)}.{' '}
        <button
          ref={changeRef}
          type="button"
          onClick={() => {
            pressed.current = true;
            setOpen(true);
          }}
          aria-expanded={false}
          className="rc-ink"
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            border: 'none',
            background: 'transparent',
            padding: 0,
            color: 'var(--seal-deep, #14515C)',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          Change the currency
        </button>
      </p>
    );

  return (
    <section
      aria-label="What money this invoice is in"
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 10,
        padding: '10px 12px',
        background: held.length ? 'var(--paper-2, #EAE4D8)' : undefined,
      }}
    >
      {/* W10: the card names this part "The money", so the box no longer
          repeats it as a label of its own. */}
      <p style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)', margin: 0 }}>
        {filed
          ? `Filed in ${moneyName(filed)}.`
          : `${CURRENCY_NOT_RECORDED} — nothing on this document is priced.`}
      </p>

      {held.map((sentence, i) => (
        <p
          key={i}
          role="alert"
          style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}
        >
          {sentence}
        </p>
      ))}

      {moved && (
        <p role="status" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
          {moved}
        </p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
          Change it to{' '}
          <select
            ref={pickRef}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={!canManage || restate.isPending}
            aria-label="Currency this invoice is denominated in"
            style={{
              fontSize: 11.5,
              padding: '3px 6px',
              borderRadius: 6,
              border: '1px solid var(--line-control, #8F8674)', // W39: a control's edge at 3:1
              background: 'var(--paper-0, #FBF8F1)',
            }}
          >
            <option value="">select a currency</option>
            {CURRENCY_CODES.filter((c) => c !== filed).map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!canManage || restate.isPending}
          placeholder="why (optional)"
          aria-label="Why this invoice's currency is being changed"
          style={{
            fontSize: 11.5,
            padding: '3px 6px',
            borderRadius: 6,
            border: '1px solid var(--line-control, #8F8674)', // W39: a control's edge at 3:1
            background: 'var(--paper-0, #FBF8F1)',
            minWidth: 180,
          }}
        />
      </div>

      {/*
        THE HOLD, not a button. Founder, 2026-09-06 (batch 64): "Decide as a
        module: seal all three." A restatement re-files a whole invoice's money,
        and its gate was role plus an append-only log — which answers "may this
        role" and cannot answer "did a person". The seal is minted when the hold
        STARTS, bound to this document and to the pair of codes, and a mint that
        fails says so and sends nothing.

        Disabled until a code is chosen, because a seal is minted OVER the code
        and there is nothing to mint one for yet.
      */}
      <div style={{ maxWidth: 300, marginTop: 8 }}>
        <HoldToApprove
          key={`restate-${choice}-${restate.failureCount}`}
          label={
            choice
              ? `Hold to file this invoice in ${choice}`
              : 'Choose a currency first'
          }
          approvedLabel="Sealed"
          disabled={!canManage || !choice || restate.isPending}
          onChallenge={() => documentsApi.mintCurrencySeal(doc.id, choice)}
          onApprove={(challenge) => restate.mutate(challenge)}
        />
      </div>

      {/*
        DISABLED WITH THE SENTENCE, NEVER HIDDEN. The person can see that the
        act exists, that it is somebody else's, and whose — which is what turns
        a dead end into an errand.
      */}
      {!canManage && (
        <p style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', margin: '5px 0 0' }}>
          Restating an invoice&rsquo;s currency re-files its money, so it is a manager&rsquo;s or an
          owner&rsquo;s decision.{' '}
          {role
            ? `You are signed in as ${role} at this house.`
            : 'This session could not be shown to hold any role at this house.'}{' '}
          Ask a manager or an owner.
        </p>
      )}
      <p style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: '5px 0 0' }}>
        Nothing is converted: there is no exchange rate in this system. The vendor&rsquo;s own
        figures stay as they are and only the money they are stated in changes. Who changed it,
        when, and what it was before are recorded.
      </p>
      {settled && (
        <button
          ref={keepRef}
          type="button"
          onClick={() => {
            pressed.current = true;
            setOpen(false);
            setChoice('');
            setReason('');
          }}
          aria-expanded
          className="rc-ink"
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            border: 'none',
            background: 'transparent',
            padding: 0,
            marginTop: 6,
            color: 'var(--seal-deep, #14515C)',
            cursor: 'pointer',
          }}
        >
          Keep {filed}
        </button>
      )}
    </section>
  );
}

/**
 * One editable money/number cell. Commits on blur or Enter; Escape reverts.
 * A non-nullable cell (qty) treats an emptied input as INVALID — silently
 * showing the unknown dash over a value the record still holds was the exact
 * false-unknown opus-honesty BLOCKER 1 describes. Locked cells are readOnly,
 * not disabled, so assistive tech can still reach the figures.
 */
function EditCell({
  value,
  ariaLabel,
  locked,
  nullable = true,
  onCommit,
}: {
  value: number | null;
  ariaLabel: string;
  locked: boolean;
  nullable?: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const shown = draft ?? (value == null ? '' : String(value));
  // The draft holds until the server round-trip moves `value` — clearing it
  // at commit time flashed the stale figure mid-flight (receipts-audit.md).
  useEffect(() => {
    setDraft(null);
  }, [value]);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseCell(draft);
    if (parsed === 'invalid' || (parsed === null && !nullable)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (parsed !== value) onCommit(parsed);
    else setDraft(null);
  };
  return (
    <input
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      value={shown}
      placeholder={EM}
      readOnly={locked}
      aria-readonly={locked || undefined}
      onChange={(e) => {
        setBad(false);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(null);
          setBad(false);
        }
      }}
      style={{
        width: 72,
        fontFamily: MONO,
        fontSize: 11.5,
        textAlign: 'right',
        padding: '3px 6px',
        borderRadius: 6,
        /*
         * AN EDGE YOU CAN SEE (walk-through RECEIPTS-W39, 2026-10-01). The box
         * was edged in paper-2: 1.3:1 against its own white and 1.1:1 against
         * the card, where a control's edge needs 3:1. `--line-control` is the
         * house-wide colour COLOR-CONTRAST-REPORT B2 proposes; it does not
         * exist yet (shared queue), so its stand-in #8F8674 applies until it
         * lands: 3.6:1 / 3.1:1 on paper, 5.2:1 on charcoal. The same holds for
         * every other box and picker on this page and its correction form.
         */
        border: bad
          ? '1px solid var(--ink-1, #211C16)'
          : '1px solid var(--line-control, #8F8674)',
        background: locked ? 'transparent' : 'var(--paper-0, #FAF7F1)',
        color: 'var(--ink-1, #211C16)',
      }}
    />
  );
}

const PAPER_NOTE: CSSProperties = {
  fontSize: 11.5,
  color: 'var(--ink-2, #4F473C)',
  textAlign: 'center',
  padding: '0 10px',
  margin: 0,
};

/**
 * THE PAPER, beside the lines.
 *
 * This is the page's reason to exist. Before this, `imageUrl` was read off the
 * LIST row — where the gateway never sets it, because only the detail handler
 * signs one — so the "Open the paper ↗" link never rendered at all, and the
 * screen asked a person to certify that a transcription matched a page it
 * never showed them. The legacy page it replaces did show it inline
 * (ReceiptsPage.tsx:337-340); an adjudication surface must not regress on the
 * one thing being adjudicated.
 *
 * Every not-shown state says WHICH not-shown state it is. "This document has
 * no stored file" (an EDI or text-only channel keeps its content in the
 * payload), "the file exists but could not be signed", and "the link has aged
 * out" are three different facts, and only the first means the manager should
 * stop looking for a scan.
 */
export function PaperPane({
  doc,
  detailKnown,
  fetchedAt,
  onRefresh,
  refreshing,
}: {
  doc: ProcurementDocument;
  detailKnown: boolean;
  fetchedAt: number;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  // A ticking clock, so a link that ages out while the tab sits open turns
  // into the expiry notice instead of quietly becoming a broken image.
  const [now, setNow] = useState(() => Date.now());
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [doc.imageUrl]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const expired = !!doc.imageUrl && isSignedUrlExpired(fetchedAt, now);
  const isPdf = /\.pdf$/i.test(doc.filename ?? '') || /\.pdf$/i.test(doc.storage_path ?? '');

  const frame = (children: ReactNode) => (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 10,
        background: 'var(--paper-0, #FAF7F1)',
        minHeight: 260,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 10,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );

  const again = (label: string) => (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      className="rc-ink"
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: '4px 11px',
        borderRadius: 7,
        border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
        background: 'transparent',
        color: 'var(--seal-deep, #14515C)',
        cursor: refreshing ? 'progress' : 'pointer',
      }}
    >
      {refreshing ? 'Fetching a fresh link…' : label}
    </button>
  );

  let body: ReactNode;
  if (!detailKnown) {
    body = <p style={PAPER_NOTE}>Reading the stored document…</p>;
  } else if (!doc.storage_path) {
    body = (
      <p style={PAPER_NOTE}>
        No file was stored for this document — it arrived by {doc.source_channel || 'an unrecorded channel'},
        and that channel keeps its content in the payload rather than as a scan.
      </p>
    );
  } else if (!doc.imageUrl) {
    body = (
      <>
        <p style={PAPER_NOTE}>
          A file is stored for this document, but a viewing link could not be created. The paper
          exists — this screen cannot reach it.
        </p>
        {again('Try again')}
      </>
    );
  } else if (expired) {
    body = (
      <>
        <p style={PAPER_NOTE}>
          The viewing link has aged out (they last an hour). The document has not changed.
        </p>
        {again('Fetch a fresh link')}
      </>
    );
  } else if (loadFailed) {
    body = (
      <>
        <p style={PAPER_NOTE}>The stored file did not load. This is the link failing, not the paper missing.</p>
        {again('Try again')}
      </>
    );
  } else if (isPdf) {
    body = (
      <object
        data={doc.imageUrl}
        type="application/pdf"
        aria-label="Stored document"
        style={{ width: '100%', height: '60vh', minHeight: 260, borderRadius: 8 }}
      >
        <p style={PAPER_NOTE}>
          This browser will not display the PDF inline. Open it in a new tab with the link below.
        </p>
      </object>
    );
  } else {
    body = (
      <img
        src={doc.imageUrl}
        alt="Stored document"
        onError={() => setLoadFailed(true)}
        style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }}
      />
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-4, #665D50)',
          }}
        >
          The paper
        </span>
        {doc.imageUrl && !expired && (
          <a
            href={doc.imageUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
          >
            Open the paper ↗
          </a>
        )}
      </div>
      {frame(body)}
    </div>
  );
}

/** Money/number fields the editor can move, and how they are labelled. */
const EDITABLE_FIELDS = [
  // `head` is the column's word, which a phone prints above each figure (W35).
  { key: 'qty', patch: 'qty', label: 'Quantity', head: 'Qty', nullable: false },
  { key: 'unit_price', patch: 'unitPrice', label: 'Unit price', head: 'Unit', nullable: true },
  { key: 'line_total', patch: 'lineTotal', label: 'Line total', head: 'Total', nullable: true },
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number]['key'];

/** The vendor the list endpoint names for a row (walk-through W8), if any. */
function vendorOf(d: ProcurementDocument): string | null {
  const name = (d as ProcurementDocument & { vendorName?: string | null }).vendorName;
  return name?.trim() ? name.trim() : null;
}

/**
 * What the pairing badge means.
 *
 * The old column printed `paired` or `—` with no referent — so a reader could
 * not tell WHAT a line was paired to, and `—` did double duty for "not paired"
 * and "pairing unknown". These are three separate facts and get three separate
 * sentences.
 *
 * The named target is as specific as the live data allows. An order in this
 * system is one wine (`Order.wineId/quantity`, services/api/types.ts:251-268)
 * and the gateway exposes no per-order-line list, so the honest label is the
 * ordered wine, the ordered quantity, and the order-line reference — not an
 * invented line description. When the order query has not answered, the badge
 * says the target is unread rather than naming nothing.
 *
 * Walk-through W6 (2026-10-01): the sheet above pairs a line with a SHELF; this
 * card pairs it with an ORDER LINE. Both said "paired", so the column now names
 * what it holds, and the method reads as a sentence, not the stored code. The
 * words cover every value `procurement_document_lines_match_method_check`
 * allows (baseline migration); an unknown code is printed as-is, never hidden.
 */
const MATCH_METHOD_WORDS: Record<string, string> = {
  vendor_sku: "matched by the supplier's code",
  description: 'matched by the description',
  qty_price: 'matched by quantity and price',
  manual: 'confirmed by hand',
  edi_reference: "matched by the supplier's reference",
};

function PairedCell({
  line,
  order,
  orderUnread,
}: {
  line: ProcurementDocumentLine;
  order: { wineName?: string; quantity?: number } | undefined;
  orderUnread: boolean;
}) {
  if (!line.order_line_id)
    return (
      <span style={{ color: 'var(--ink-4, #665D50)' }}>
        no order line yet
      </span>
    );
  /*
   * IN THE HOUSE'S WORDS, FOR ANY ITEM (walk-through RECEIPTS-W37, 2026-10-01).
   * This said "the wine is unnamed" — the house buys every drink and then food —
   * printed the first eight characters of the order line's database id, and a
   * bare "confidence 94%". The id is gone (the order's own number already heads
   * the card), the item is just "the item", and the certainty reads as a
   * sentence, as the reader's does since W23. `wineName` is the gateway's
   * field name, not a word on screen.
   */
  const conf = fmtConfidence(line.match_confidence);
  const how = line.match_method
    ? MATCH_METHOD_WORDS[line.match_method] ?? line.match_method
    : 'how it was matched is not recorded';
  const sure = conf === EM ? 'certainty not recorded' : `${conf} sure of the match`;
  return (
    <span style={{ color: 'var(--seal-deep, #14515C)' }}>
      {orderUnread
        ? 'paired with the order, which could not be read to name the item'
        : `${order?.wineName ?? 'the order does not name the item'} · ${
            order?.quantity == null ? EM : order.quantity
          } ordered`}
      {` · ${how} · ${sure}`}
    </span>
  );
}

/**
 * ONE PART OF THE CARD, NAMED (walk-through W10, 2026-10-01). The founder:
 * "every component and detail can be read easily … clear divisions". The card
 * stacked the verdict, the order, the money, the lines and the confirm with no
 * line between them; each now sits under its own label and a rule.
 */
function CardPart({ label, first = false, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        borderTop: first ? 'none' : '1px solid var(--paper-2, #EAE4D8)',
        marginTop: first ? 0 : 14,
        paddingTop: first ? 0 : 12,
      }}
    >
      <h3
        style={{
          fontFamily: MONO,
          fontSize: 8.5,
          fontWeight: 600,
          letterSpacing: '0.13em',
          textTransform: 'uppercase',
          color: 'var(--ink-4, #665D50)',
          margin: '0 0 6px',
        }}
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

function DocView({ doc, onVerified }: { doc: ProcurementDocument; onVerified: () => void }) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const detailKey = ['receipts-next', 'doc', rid, doc.id];
  /**
   * The formatted sheet above this card reads the same rows under its own keys
   * (founder walk-through, 2026-10-01, W2). A correction or a pairing saved
   * here left it showing the old figures until a reload — two faces of one
   * document disagreeing on screen. Every write that touches lines refreshes it.
   */
  const refreshSheet = () => {
    for (const k of ['canonical-document', 'canonical-document-items', 'canonical-document-mappings']) {
      void qc.invalidateQueries({ queryKey: [k, doc.id] });
    }
  };
  const detailQ = useQuery({
    queryKey: detailKey,
    queryFn: () => documentsApi.detail(doc.id),
    staleTime: 30_000,
  });
  /**
   * THE LINKED ORDER COMES FROM THE LINKS, NOT THE ROW (walk-through W4,
   * 2026-10-01). `procurement_documents` has no `order_id` column — a document
   * pairs with its orders through `procurement_document_links`, many-to-many,
   * and the matcher reads exactly that table. This card read `doc.order_id`,
   * which the gateway can never send, so every document said "No order is
   * linked" and the pairing check was disabled for good. `undefined` while the
   * detail is still loading: an unread link is not an absent one.
   */
  const linkedOrderIds: string[] | undefined = useMemo(() => {
    if (doc.order_id) return [doc.order_id];
    const links = detailQ.data?.links as Array<{ order_id?: string | null }> | undefined;
    if (!links) return undefined;
    return [...new Set(links.map((l) => l.order_id).filter((x): x is string => !!x))];
  }, [doc.order_id, detailQ.data]);
  const orderId = linkedOrderIds?.[0] ?? null;
  const orderQ = useQuery({
    queryKey: ['receipts-next', 'order', rid, orderId],
    queryFn: () => getOrder(orderId!),
    enabled: !!orderId,
    staleTime: 60_000,
  });
  const [matchResult, setMatchResult] = useState<Awaited<ReturnType<typeof documentsApi.match>> | null>(null);
  const [tieOut, setTieOut] = useState<{ tiesOut: boolean | null; tieOutDelta: number | null } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [collision, setCollision] = useState<string | null>(null);
  /**
   * What the extraction said BEFORE a human touched it, per line and field.
   *
   * The pre-edit value used to vanish the instant the PATCH succeeded, so the
   * person about to swear the transcription is faithful could no longer see
   * what they had changed it from. It is kept until verify (this component
   * unmounts on verify) and drives Undo.
   */
  const [originals, setOriginals] = useState<Record<string, number | null>>({});
  /**
   * The correction a person has typed and not yet sealed.
   *
   * One at a time, deliberately: a seal approves one act, and a queue of pending
   * edits behind a single gesture would be one hold standing for several
   * decisions. Typing in a second cell replaces this one, and the strip says
   * which correction is waiting.
   */
  const [pending, setPending] = useState<{
    lineId: string;
    lineNo: number;
    field: EditableKey;
    label: string;
    from: number | null;
    to: number | null;
    patch: Record<string, number | null>;
  } | null>(null);

  // The lines this view believes in, and the document as the DETAIL endpoint
  // returned it — the list row never carries `imageUrl`, `storage_path` or a
  // signed link, which is why the paper was invisible before.
  const detailDoc = detailQ.data?.document;
  const lines = detailQ.data?.lines;
  const shownDoc: ProcurementDocument = detailDoc ? { ...doc, ...detailDoc } : doc;

  const editable = doc.status === 'needs_review' || doc.status === 'received';
  // The canonical page's own gate, read here so the affordance and the route
  // can never disagree about who may see it.
  const canonicalOn = useMudavymDesign('document');

  const edit = useMutation({
    /**
     * The correction carries the seal minted when the hold began (founder,
     * 2026-09-06, batch 64). `challenge` never comes from here — it comes from
     * `HoldToApprove`'s `onChallenge`, which runs at the START of the gesture.
     */
    mutationFn: (p: {
      lineId: string;
      field: EditableKey;
      patch: Record<string, number | null>;
      challenge?: string | null;
    }) => documentsApi.editLine(doc.id, p.lineId, p.patch, p.challenge),
    onSuccess: (res, vars) => {
      setEditError(null);
      setPending(null);
      setTieOut(res.tieOut);
      // Pairing suggestions were computed against the pre-edit lines — a
      // stale reason must not invite a stale confirmation.
      setMatchResult(null);
      /**
       * Last-write-wins is unavoidable here (the table has no `updated_at` to
       * precondition on — see documents.ts), but it does not have to be
       * SILENT. One field goes out per PATCH, so every OTHER field the server
       * echoes back should still equal what this tab last saw. If one moved,
       * somebody else edited this document, and the reviewer is told before
       * they certify a transcription that includes a stranger's correction.
       */
      const before = (qc.getQueryData(detailKey) as
        | { lines: ProcurementDocumentLine[] }
        | undefined)?.lines?.find((l) => l.id === res.line.id);
      if (before) {
        const moved = EDITABLE_FIELDS.filter(
          (f) => f.key !== vars.field && before[f.key] !== res.line[f.key],
        ).map((f) => f.label.toLowerCase());
        setCollision(
          moved.length
            ? `Someone else changed the ${moved.join(' and ')} on line ${res.line.line_no} while this was open. The figures below are the server's, not yours.`
            : null,
        );
      }
      qc.setQueryData(
        detailKey,
        (cur: { document: ProcurementDocument; lines: ProcurementDocumentLine[]; links: unknown[] } | undefined) =>
          cur
            ? { ...cur, lines: cur.lines.map((l) => (l.id === res.line.id ? { ...l, ...res.line } : l)) }
            : cur,
      );
      refreshSheet();
    },
    onError: (e) => setEditError(serverMessage(e, 'The correction did not save.')),
  });

  /**
   * STAGE the correction. It is not written until the hold completes.
   *
   * Before 2026-09-06 this fired the PATCH on blur. The founder then sealed the
   * three document acts as a module, and a seal has to be minted when the
   * gesture BEGINS — which means there has to be a gesture. So a moved cell now
   * produces a PENDING correction, stated in words, and the hold below is what
   * sends it. Typing a figure is no longer a write.
   *
   * The extraction's own figure is captured HERE rather than at the write, so
   * "extracted 12 · undo" survives a correction the person then abandons.
   */
  const commitEdit = (line: ProcurementDocumentLine, field: EditableKey, patchKey: string, next: number | null) => {
    const k = `${line.id}:${field}`;
    setOriginals((cur) => (k in cur ? cur : { ...cur, [k]: line[field] }));
    setEditError(null);
    setPending({
      lineId: line.id,
      lineNo: line.line_no,
      field,
      label: EDITABLE_FIELDS.find((f) => f.key === field)?.label ?? field,
      from: line[field],
      to: next,
      patch: { [patchKey]: next },
    });
  };

  const runMatch = useMutation({
    mutationFn: () => documentsApi.match(doc.id),
    onSuccess: (res) => {
      setMatchResult(res);
      // `applied` was WRITTEN by that call. The rows on screen are now stale.
      void qc.invalidateQueries({ queryKey: detailKey });
      refreshSheet();
    },
  });

  const link = useMutation({
    mutationFn: (p: { lineId: string; orderLineId: string | null }) =>
      documentsApi.linkLine(doc.id, p.lineId, p.orderLineId),
    onSuccess: (_res, p) => {
      setMatchResult((cur) =>
        cur
          ? {
              ...cur,
              suggested: cur.suggested.filter((s) => s.documentLineId !== p.lineId),
              applied: cur.applied.filter((s) => s.documentLineId !== p.lineId),
            }
          : cur,
      );
      void qc.invalidateQueries({ queryKey: detailKey });
      refreshSheet();
    },
    onError: (e) => setEditError(serverMessage(e, 'The pairing change did not save.')),
  });

  const verify = useMutation({
    /**
     * The seal is REDEEMED, not asserted (founder, 2026-09-06, batch 64).
     *
     * `challenge` arrives from `SwipeToConfirm`, which mints it when the gesture
     * BEGINS — never here, because a token this request fetched for itself is
     * the assertion model with extra steps. A mint that fails never reaches this
     * mutation at all: the control says so and sends nothing.
     */
    mutationFn: (challenge?: string | null) => documentsApi.verify(doc.id, challenge),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['receipts-next'] });
      onVerified();
    },
  });

  /**
   * ONE VERDICT ON ONE SCREEN (walk-through W6, 2026-10-01). The sheet above
   * recomputes the tie-out from the rows on every read; this card printed the
   * verdict SAVED at intake. Once the VAT-breakdown rule was fixed (W5) the two
   * disagreed a few centimetres apart — "adds up" over "off by $43.47". The
   * card now shows the sheet's verdict: the same query key and fetch the sheet
   * uses, so React Query shares the one request. A correction made here still
   * wins, because its response is newer than either.
   */
  const sheetQ = useQuery({
    queryKey: ['canonical-document', doc.id],
    queryFn: () => canonicalApi.document(doc.id),
    staleTime: 30_000,
  });
  const sheetVerdict = sheetQ.data?.canonical.layer3;
  const shownTieOut: ProcurementDocument = tieOut
    ? { ...shownDoc, ties_out: tieOut.tiesOut, tie_out_delta: tieOut.tieOutDelta }
    : sheetVerdict
      ? {
          ...shownDoc,
          ties_out: sheetVerdict.tiesOut,
          tie_out_delta: sheetVerdict.tieOutDeltaCents == null ? null : sheetVerdict.tieOutDeltaCents / 100,
        }
      : shownDoc;

  const orderUnread = !!orderId && orderQ.data === undefined;

  const appliedByLine = useMemo(() => {
    const m = new Map<string, DocumentLineMatch>();
    for (const a of matchResult?.applied ?? []) m.set(a.documentLineId, a);
    return m;
  }, [matchResult]);

  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        background: 'var(--paper-1, #F3EFE6)',
        padding: '18px 20px',
        animation: `rc-settle ${settle.ms}ms ${settle.easing} both`,
        fontFamily: SANS,
      }}
    >
      {/*
        THE ACTS, NOT A SECOND HEADER (founder walk-through, 2026-10-01, W2:
        "Sheet first, card trimmed"). The formatted sheet above already states
        the type, number, date, total and the paper itself; this card used to
        restate all of it. It now opens on what only it does — check, correct,
        pair, confirm — and keeps the tie-out because a correction here moves it.
      */}
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="rc-check"
          tabIndex={-1}
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--seal-deep, #14515C)',
            margin: 0,
          }}
        >
          Check and correct
        </h2>
        {/*
          ADR 0104 D12 slice 2. The canonical view is the SECOND FACE of this
          page, not a replacement for it — so the way in is one link, and it
          exists only where the `document` gate is on. A tenant with the gate
          off sees this page byte-for-byte as it was: no link, and the route
          itself redirects back here.
        */}
        {canonicalOn && (
          <p style={{ margin: 0 }}>
            <Link
              to={`/documents/${doc.id}`}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--seal-deep, #14515C)' }}
            >
              Open this document on its own page →
            </Link>
          </p>
        )}
      </header>

      <CardPart label="The reading" first>
        <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)', margin: 0 }}>
          <TieOutLine doc={shownTieOut} />
        </p>
        {/*
          HOW GOOD THE READING IS, stated. This screen asks for trust in a
          transcription; hiding the model's own confidence in it made that
          an unqualified ask. `—` when the record holds no score: an
          unrecorded confidence is not a low one, and not a high one either.
        */}
        <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: '3px 0 0' }}>
          {fmtConfidence(shownDoc.extraction_confidence) === EM
            ? 'The reader recorded no confidence for this document.'
            : `The reader was ${fmtConfidence(shownDoc.extraction_confidence)} sure of what it read.`}
        </p>
      </CardPart>

      <CardPart label="The order">
        {orderId ? (
          orderQ.data ? (
            <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
              {/*
                `totalCost` is OrderResponseDto's own key. The cast that stood
                here read `totalPrice`, which the route has never sent, so the
                typeof guard was always false and the "ordered $X" clause
                silently vanished from every receipt — the route HAD the
                figure and this line dropped it.

                The vendor clause is back and REAL: `GET
                /procurement/orders/:id` joins `providers` since 2026-09-05.
                `vendorClause` prints nothing when there is no name — this is
                a running sentence with no slot to leave empty, and "Vendor
                not named" appended to every row of a receipts feed is news
                about the query, not about the pairing. `vendor.ts` argues
                that choice against the list rows, which do say the words.
              */}
              {/* No number says so, rather than a slice of the database id (W37). */}
              {orderQ.data.orderNumber ? `Against order ${orderQ.data.orderNumber}` : 'Against an order with no number'}
              {vendorClause(orderQ.data)}
              {/*
                THE ORDER'S OWN CURRENCY, WHICH DOES NOT EXIST. Neither
                `procurement_orders` nor `procurement_order_items` has a
                currency column (measured 2026-09-05,
                `procurement/price-currency.ts`'s `agreementCurrencyClaim`),
                so `null` is passed deliberately and this figure prints
                "(currency not recorded)". Borrowing the DOCUMENT's currency
                would state that the order was agreed in the money the vendor
                happened to bill in — a claim nobody made, and exactly wrong
                on a cross-currency order.
              */}
              {typeof orderQ.data.totalCost === 'number'
                ? ` · ordered ${fmtMoney(orderQ.data.totalCost, null)}`
                : ''}
              {(linkedOrderIds?.length ?? 0) > 1
                ? ` · and ${linkedOrderIds!.length - 1} more order${linkedOrderIds!.length - 1 === 1 ? '' : 's'}`
                : ''}
            </p>
          ) : orderQ.isError ? (
            <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
              The linked order could not be read — the pairing is unverified, not wrong.
            </p>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
              Reading the linked order…
            </p>
          )
        ) : linkedOrderIds === undefined ? (
          <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
            {detailQ.isError
              ? 'Whether an order is linked could not be read.'
              : 'Reading which order this pairs with…'}
          </p>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
            No order is linked to this document, so its lines have nothing to be checked against.
          </p>
        )}
        {/* the pairing check — the matcher WRITES its certain half, so say so */}
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <button
            type="button"
            onClick={() => runMatch.mutate()}
            disabled={runMatch.isPending || !orderId}
            className="rc-ink"
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              color: orderId ? 'var(--seal-deep, #14515C)' : 'var(--ink-4, #665D50)',
              cursor: orderId ? 'pointer' : 'not-allowed',
            }}
          >
            {runMatch.isPending ? 'Checking the pairing…' : 'Check line pairing'}
          </button>
          {linkedOrderIds?.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', alignSelf: 'center' }}>
              needs a linked order first
            </span>
          )}
          {/* W18-B: disabled while the link is unread, so it says why too */}
          {linkedOrderIds === undefined && (
            <span style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', alignSelf: 'center' }}>
              {detailQ.isError ? 'needs the order link, which could not be read' : 'waits for the order link'}
            </span>
          )}
          {runMatch.isError && (
            <span role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', flexBasis: '100%' }}>
              {serverMessage(runMatch.error, 'The pairing check did not run.')}
            </span>
          )}
          {matchResult && (
            <div style={{ flexBasis: '100%', fontSize: 12 }}>
              <p style={{ color: 'var(--ink-2, #4F473C)', margin: '2px 0 6px' }}>
                {matchResult.applied.length} written to the record by this check ·{' '}
                {matchResult.suggested.length} awaiting your confirmation ·{' '}
                {matchResult.unmatchedDocumentLineIds.length} on the paper with no order line
              </p>
              {matchResult.applied.length > 0 && (
                <p style={{ color: 'var(--ink-2, #4F473C)', margin: '0 0 6px' }}>
                  The {matchResult.applied.length} above were saved without asking — the matcher
                  writes an unambiguous vendor-SKU pairing. They are marked in the table and each
                  one can be unlinked there.
                </p>
              )}
              {matchResult.suggested.map((s) => (
                <div key={s.documentLineId} className="flex flex-wrap items-center gap-2 py-1" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                  <span style={{ color: 'var(--ink-2, #4F473C)' }}>
                    {s.reason}
                    {s.substitution ? ' — a substitution; accept it knowingly' : ''}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4, #665D50)' }}>
                    confidence {fmtConfidence(s.confidence)}
                  </span>
                  <button
                    type="button"
                    onClick={() => link.mutate({ lineId: s.documentLineId, orderLineId: s.orderLineId })}
                    disabled={link.isPending}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: 6,
                      border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                      background: 'transparent',
                      color: 'var(--seal-deep, #14515C)',
                      cursor: 'pointer',
                    }}
                  >
                    Confirm pairing
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardPart>

      {/* RULE 3 — the house's deliberate restatement of this invoice's money */}
      <CardPart label="The money">
        <CurrencyBlock doc={shownDoc} onChanged={() => void detailQ.refetch()} />
      </CardPart>

      {/*
        The paper is no longer beside these lines: the sheet above brings it on
        demand ("Bring the original"), and a second copy here pushed the lines
        into half the width (W2). `PaperPane` lives on as that on-demand pane.
      */}
      <CardPart label="The lines">
        <div>
          {/* the lines — editable in place while the document awaits review */}
          {detailQ.isError ? (
            /*
              A failed detail fetch used to fall into the same branch as an
              answered-but-empty one and render "No lines were extracted" — a
              dead endpoint reported as a blank invoice. It is now said in words.
            */
            <div role="alert">
              <p style={{ fontSize: 12, color: 'var(--ink-1, #211C16)', margin: 0 }}>
                {sentence(serverMessage(detailQ.error, 'This document could not be read.'))} Its lines
                are unknown, not empty. Nothing here is claimed.
              </p>
              <button
                type="button"
                onClick={() => void detailQ.refetch()}
                className="rc-ink"
                style={{
                  marginTop: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '4px 11px',
                  borderRadius: 7,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'transparent',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          ) : lines === undefined ? (
            <p style={{ fontSize: 12, color: 'var(--ink-4, #665D50)' }}>Reading the lines…</p>
          ) : lines.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
              No lines were extracted from this document.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              {/* Roles spelled out: on a phone the rows become blocks (W35, the
                  `.rc-lines` rules above), and a table whose display changes
                  loses its implicit roles in some screen readers. */}
              <table className="rc-lines" role="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead role="rowgroup">
                  <tr role="row" style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>
                    <th role="columnheader" style={{ textAlign: 'left', padding: '4px 6px' }}>Line</th>
                    <th role="columnheader" style={{ textAlign: 'right', padding: '4px 6px' }}>Qty</th>
                    <th role="columnheader" style={{ textAlign: 'right', padding: '4px 6px' }}>Unit</th>
                    <th role="columnheader" style={{ textAlign: 'right', padding: '4px 6px' }}>Total</th>
                    <th role="columnheader" style={{ textAlign: 'left', padding: '4px 6px' }}>Order line</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {lines.map((l) => (
                    <tr key={l.id} role="row" style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                      <td role="cell" data-cell="line" style={{ padding: '5px 6px', color: 'var(--ink-1, #211C16)', maxWidth: 260 }}>
                        {l.description || EM}
                        {l.vintage && !nameCarriesYear(l.description, l.vintage) ? ` · ${l.vintage}` : ''}
                      </td>
                      {EDITABLE_FIELDS.map((f) => {
                        const k = `${l.id}:${f.key}`;
                        const was = k in originals ? originals[k] : undefined;
                        const changed = was !== undefined && was !== l[f.key];
                        return (
                          <td key={f.key} role="cell" data-cell={f.key} data-label={f.head} style={{ textAlign: 'right', padding: '5px 6px' }}>
                            <EditCell
                              value={l[f.key]}
                              ariaLabel={`${f.label}, line ${l.line_no}`}
                              locked={!editable}
                              nullable={f.nullable}
                              onCommit={(v) => {
                                if (v === null && !f.nullable) return;
                                commitEdit(l, f.key, f.patch, v);
                              }}
                            />
                            {changed && (
                              <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-4, #665D50)', marginTop: 2 }}>
                                <span>
                                  extracted {was == null ? EM : f.key === 'qty' ? was : fmtMoney(was, shownDoc.currency)}
                                </span>{' '}
                                <button
                                  type="button"
                                  onClick={() => commitEdit(l, f.key, f.patch, was)}
                                  disabled={edit.isPending}
                                  aria-label={`Undo ${f.label.toLowerCase()} on line ${l.line_no}`}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    fontFamily: MONO,
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    color: 'var(--seal-deep, #14515C)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  undo
                                </button>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td role="cell" data-cell="order" data-label="Order line" style={{ padding: '5px 6px', fontFamily: MONO, fontSize: 10 }}>
                        <PairedCell
                          line={l}
                          order={orderQ.data as { wineName?: string; quantity?: number } | undefined}
                          orderUnread={orderUnread}
                        />
                        {appliedByLine.has(l.id) && (
                          <div style={{ color: 'var(--ink-2, #4F473C)', marginTop: 2 }}>
                            written by the matcher just now: {appliedByLine.get(l.id)!.reason}
                          </div>
                        )}
                        {l.order_line_id && editable && (
                          <button
                            type="button"
                            onClick={() => link.mutate({ lineId: l.id, orderLineId: null })}
                            disabled={link.isPending}
                            /* Its own line and its own name (W37): it ran on as
                               "…of the matchUnlink", and every row's said only
                               "Unlink" to a screen reader. */
                            aria-label={`Unlink line ${l.line_no} from the order`}
                            style={{
                              display: 'block',
                              marginTop: 2,
                              border: 'none',
                              background: 'transparent',
                              padding: 0,
                              fontFamily: MONO,
                              fontSize: 9.5,
                              fontWeight: 600,
                              textDecoration: 'underline',
                              color: 'var(--seal-deep, #14515C)',
                              cursor: 'pointer',
                            }}
                          >
                            Unlink
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!editable && (
            <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '6px 0 0' }}>
              This document is verified — the record a dispute leans on. Lines are read-only.
            </p>
          )}
          {/*
            THE PENDING CORRECTION, AND THE HOLD THAT SENDS IT.

            Founder, 2026-09-06 (batch 64): "Decide as a module: seal all three."
            A line correction is now one deliberate act with a one-time seal over
            the line AS IT STANDS and this exact patch, so a correction written
            on top of somebody else's is refused rather than reported afterwards.
            The strip says what will change, in figures, before anything is sent.
          */}
          {pending && (
            <div
              aria-label="Correction waiting to be sealed"
              style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'var(--paper-0, #FBF8F1)',
              }}
            >
              <p style={{ fontSize: 12, color: 'var(--ink-1, #211C16)', margin: 0 }}>
                Line {pending.lineNo} · {pending.label}:{' '}
                <span style={{ fontFamily: MONO }}>
                  {pending.from == null ? EM : pending.from}
                </span>{' '}
                &rarr;{' '}
                <span style={{ fontFamily: MONO, fontWeight: 600 }}>
                  {pending.to == null ? EM : pending.to}
                </span>
              </p>
              <p style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: '2px 0 8px' }}>
                Nothing has been written yet. The hold takes a one-time seal over this
                line as it stands and this exact change.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                  <HoldToApprove
                    key={`edit-${pending.lineId}-${pending.field}-${edit.failureCount}`}
                    label="Hold to seal this correction"
                    approvedLabel="Correction sealed"
                    disabled={edit.isPending}
                    onChallenge={() =>
                      documentsApi.mintLineEditSeal(doc.id, pending.lineId, pending.patch)
                    }
                    onApprove={(challenge) =>
                      edit.mutate({
                        lineId: pending.lineId,
                        field: pending.field,
                        patch: pending.patch,
                        challenge,
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 600,
                    textDecoration: 'underline',
                    color: 'var(--seal-deep, #14515C)',
                    cursor: 'pointer',
                  }}
                >
                  discard this correction
                </button>
              </div>
            </div>
          )}
          {collision && (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              {collision}
            </p>
          )}
          {editError && (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              {editError}
            </p>
          )}

        </div>
      </CardPart>

      {/* the ceremony — verify asserts the transcription, nothing more */}
      {editable && (
        <CardPart label="Confirm">
          <div className="mt-2">
            {/*
              NO CONFIRM OVER UNREAD LINES (walk-through W18, 2026-10-01). The
              swipe asserts "this transcription matches the paper"; while the
              lines are still loading, or could not be read at all, nobody has
              seen what it would vouch for. Found in P4 with the detail fetch
              failing on SYN-US-0112: the lines said "unknown, not empty" and
              the swipe under them still worked.
            */}
            {lines === undefined && (
              <p
                data-testid="confirm-waits"
                style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 8px' }}
              >
                {detailQ.isError
                  ? 'Confirm waits for the lines. They could not be read, so there is nothing yet to check against the paper.'
                  : 'Confirm opens once the lines are read.'}
              </p>
            )}
            <SwipeToConfirm
              key={`swipe-${verify.failureCount}`}
              label="Swipe up to confirm"
              assertion="Confirms this transcription matches the paper. It does not accept charges or touch stock. A one-time seal is taken when the gesture starts."
              disabled={verify.isPending || lines === undefined}
              onChallenge={() => documentsApi.mintVerifySeal(doc.id)}
              onConfirm={(challenge) => verify.mutate(challenge)}
            />
            {verify.isError && (
              <p role="alert" style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
                {sentence(serverMessage(verify.error, 'The confirmation did not go through.'))}{' '}
                The document is still unverified.
              </p>
            )}
          </div>
        </CardPart>
      )}
    </div>
  );
}

export default function ReceiptsNext() {
  const data = useReceiptsNextData();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeRole, user } = useAuth();
  const creditsOffered = canSeeCreditLedger(activeRole, user?.role);
  const askedForCredits = searchParams.get('tab') === 'credits';
  // A staff member who follows `/credits` lands on Receipts, as ADR 0167 has
  // it, and is told why rather than shown a ledger that can only refuse.
  const tab: 'receipts' | 'credits' = askedForCredits && creditsOffered ? 'credits' : 'receipts';
  const setTab = (next: 'receipts' | 'credits') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'credits') params.set('tab', 'credits');
    else params.delete('tab');
    params.delete('doc');
    params.delete('credit');
    setSearchParams(params);
  };
  /*
   * `?doc=<id>` opens that document straight away. The receiving workspace links
   * here when it refuses a unit price for an invoice whose money is held
   * (founder, 2026-09-06 batch 64), and a link that lands on the queue without
   * opening the document names an act the reader then has to go and find.
   *
   * THE URL IS THE SELECTION (ADR 0160; walk-through W3, 2026-10-01). It was
   * seeded once and then held in memory, so a reload, a shared link or the
   * browser's Back lost the open document. A click now writes `?doc=`, which
   * is also why it cannot fight the reader: the click and the query string
   * are the same act.
   */
  const selectedId = searchParams.get('doc');
  const select = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('doc', id);
    else params.delete('doc');
    setSearchParams(params);
  };
  const [showVerified, setShowVerified] = useState(false);
  const selected =
    data.queue.find((d) => d.id === selectedId) ??
    data.clean.find((d) => d.id === selectedId) ??
    data.verified.find((d) => d.id === selectedId) ??
    null;

  /*
   * ONE ROW, TWO GROUPS (walk-through RECEIPTS-W44, 2026-10-01). The papers
   * that need a look and the papers that read cleanly are drawn by the same
   * row, so the two groups differ only by the heading between them.
   */
  const queueRow = (d: ProcurementDocument) => (
    <button
      key={d.id}
      type="button"
      onClick={() => select(d.id)}
      aria-pressed={selectedId === d.id}
      className="rc-row block w-full text-left"
      style={{
        padding: '9px 8px',
        // shorthand first: 'border: none' would clobber a
        // longhand declared before it (receipts-audit.md)
        border: 'none',
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        borderLeft: selectedId === d.id ? '3px solid var(--seal, #1A5E6B)' : '3px solid transparent',
        background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : undefined,
        cursor: 'pointer',
        fontFamily: SANS,
      }}
    >
      {/* W8 (2026-10-01): who sent it comes first. Six invoices
          from one day read alike until the vendor is named;
          a row without one keeps the number as its title. */}
      {vendorOf(d) && (
        <span
          title={vendorOf(d) ?? undefined}
          style={{
            display: 'block',
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {vendorOf(d)}
        </span>
      )}
      <span
        style={
          vendorOf(d)
            ? { display: 'block', fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }
            : { display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }
        }
      >
        {typeLabel(d.doc_type)} · {d.doc_number || EM}
      </span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
        {fmtDate(d.doc_date)} · {fmtMoney(d.total, d.currency)} ·{' '}
        {/* The reading's own words (W23), short (walk-through W26). */}
        {d.ties_out === null ? 'no stated total' : d.ties_out ? 'adds up' : 'does not add up'}
      </span>
    </button>
  );

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        @keyframes rc-settle { from { transform: translateY(-4px); opacity: 0 } to { transform: none; opacity: 1 } }
        .rc-row, .rc-ink { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .rc-ink:hover:not(:disabled) { background: var(--seal-tint, rgba(26,94,107,.10)) }
        .rc-ink:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        .rc-row:hover { background: var(--paper-1, #F3EFE6) }
        /* W40: the skip link is out of sight until a keyboard reaches it. */
        .rc-skip { display: inline-block; margin-bottom: 8px; font-family: ${SANS}; font-size: 12px; font-weight: 600; color: var(--seal-deep, #14515C); text-decoration: underline }
        .rc-skip:not(:focus) { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }
        .rc-row:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: -2px }
        @media (prefers-reduced-motion: reduce) { .rc-row, [style*="rc-settle"] { animation: none !important; transition: none !important } }
        /* W35: on a phone each line of THE LINES is a short block: the name, then
           Qty, Unit and Total side by side under their own words, then the order
           line, so the total is never past the edge. Screen only. */
        @media screen and (max-width: 639px) {
          .rc-lines, .rc-lines tbody { display: block; width: 100% }
          .rc-lines thead { display: none }
          .rc-lines tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 8px; row-gap: 6px; padding: 8px 0 }
          .rc-lines td { display: block; min-width: 0; max-width: none !important; padding: 0 !important; text-align: left !important }
          .rc-lines td[data-cell="line"], .rc-lines td[data-cell="order"] { grid-column: 1 / -1 }
          .rc-lines td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 2px; font-family: ${MONO}; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-4, #665D50) }
          .rc-lines input { max-width: 100% }
        }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.1, margin: '4px 0 0' }}>
              {tab === 'credits' ? 'Credits' : 'Receipts'}
            </h1>
            {creditsOffered && (
              <div role="tablist" aria-label="Receipts or credits" style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                {(
                  [
                    ['receipts', 'Receipts'],
                    ['credits', 'Credits'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className="rc-ink"
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      padding: '4px 0',
                      border: 'none',
                      borderBottom: tab === key ? '2px solid var(--seal, #1A5E6B)' : '2px solid transparent',
                      background: 'transparent',
                      color: tab === key ? 'var(--ink-1, #211C16)' : 'var(--ink-4, #665D50)',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {tab === 'receipts' && (
          <span
            style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}
            title={
              data.queueCapped || data.verifiedCapped
                ? `Mudavym lists at most ${RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS} documents at a time, so a count marked ${GE} is a floor.`
                : undefined
            }
          >
            {/*
              A WINDOW IS NOT A TOTAL. `queue.length` is what fits inside the
              gateway's `.limit()` (RECEIPTS_SERVER_WINDOWS.QUEUE_ITEMS,
              documents.controller.ts:117); at the cap it is a floor and must
              carry the `≥`, exactly as the verified count already did. ADR
              0051 clause 2.
            */}
            {/* A failed read is not a read in progress (walk-through W26): the
                alert below names the failure, so the header stops saying
                "Reading the queue…" beside it. */}
            {data.queueKnown
              ? `${data.queueCapped ? GE : ''}${data.queue.length} awaiting review`
              : data.failures.some((f) => f.startsWith('the review queue'))
                ? 'queue not read'
                : 'Reading the queue…'}
            {/* W44: the clean papers are counted apart, never folded into
                "awaiting review" — they passed every check. */}
            {data.cleanKnown && data.clean.length > 0
              ? ` · ${data.cleanCapped ? GE : ''}${data.clean.length} read cleanly`
              : ''}
            {' · '}
            {data.verifiedCount !== null
              ? `${data.verifiedCapped ? GE : ''}${data.verifiedCount} verified`
              : data.failures.some((f) => f.startsWith('the verified book'))
                ? 'verified not read'
                : EM}
          </span>
          )}
        </header>

        {askedForCredits && !creditsOffered && (
          <p
            role="status"
            className="mb-4"
            style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}
          >
            The credit ledger is kept for the owner and managers of this house, so it is not shown
            here. The receipts are below.
          </p>
        )}

        {tab === 'credits' ? (
          <Suspense
            fallback={
              <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
                Opening the credit ledger…
              </p>
            }
          >
            <ReceiptsCredits />
          </Suspense>
        ) : (
        <>

        {data.noRestaurant && (
          <div
            role="alert"
            className="mb-4 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)', fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}
          >
            No restaurant is selected, so no paper trail was asked for. Nothing below is claimed —
            this is not an empty queue.
          </div>
        )}

        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              {data.queueKnown
                ? `Could not refresh ${data.errorMessage}. What is below is the last answer, not the present.`
                : `Could not read ${data.errorMessage}. The paper trail is unknown — nothing below is claimed.`}
            </span>
            <button
              type="button"
              onClick={data.refetch}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--seal-ring, rgba(26,94,107,.32))', background: 'transparent', color: 'var(--seal-deep, #14515C)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {/* deliveries the door counted that still have no paperwork — the
            orders side of the surface, so nothing waits invisibly elsewhere */}
        {/*
            An unanswered uncounted-deliveries query used to render exactly like
            a caught-up door: `[]`. It is now `null` until it answers, and the
            unknown says so instead of hiding behind the absent strip.
        */}
        {data.deliveriesWithoutPaper === null && !data.noRestaurant && (
          <p
            className="mb-4"
            style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}
          >
            Deliveries counted at the door: unknown — that list has not answered, so this page is
            not claiming the door is caught up.
          </p>
        )}
        {data.deliveriesWithoutPaper !== null && data.deliveriesWithoutPaper.length > 0 && (
          <div
            className="mb-4 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px dashed var(--ink-3, #7C7365)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4, #665D50)' }}>
              Counted at the door, no paperwork yet
            </span>
            <div style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', marginTop: 4 }}>
              {(data.deliveriesWithoutPaper ?? []).map((d) => (
                <span key={d.orderId} style={{ marginRight: 16 }}>
                  {/* "btl" was a wine word; the count is of whatever came in (W38). */}
                  {d.orderNumber ?? 'an order with no number'} · {d.countedQtyBottles} counted ·{' '}
                  {Math.round(d.ageHours)}h ago
                </span>
              ))}
            </div>
          </div>
        )}

        {/*
          AN OPEN DOCUMENT TAKES THE WIDTH (walk-through W3, 2026-10-01). Beside
          a 320px queue and the counter, the document got 336px at 1280 — the
          sheet's table needs ~450 and the lines table ~380, so both scrolled
          sideways. Below 1536px the queue folds behind a back link while a
          document is open; at 1536px and up they sit side by side as before.

          ONE COLUMN IS STILL A TEMPLATE (walk-through RECEIPTS-W34). With no
          columns named below the breakpoint, the grid's one implicit column is
          `auto`, which grows to the widest thing inside — the sheet's line
          table — so on a 375px phone the open document was 44px wider than the
          screen and its right edge was cut off. `grid-cols-1` is
          `minmax(0, 1fr)`: the column is the screen's width, and the table
          scrolls inside its own box as the sheet intends.
        */}
        <div
          className={
            selected
              ? 'grid grid-cols-1 gap-6 2xl:grid-cols-[320px_minmax(0,1fr)]'
              : 'grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]'
          }
        >
          {/* the queue */}
          <section aria-label="Awaiting review" className={selected ? 'hidden 2xl:block' : undefined}>
            {data.queueKnown && data.queue.length === 0 && !data.isError && !data.noRestaurant ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
                {/* Not "caught up" while clean papers still wait for a swipe (W44). */}
                {data.cleanKnown && data.clean.length > 0
                  ? 'Nothing needs a look.'
                  : 'Nothing awaits review — the paper trail is caught up.'}
              </p>
            ) : (
              <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                {data.queue.map(queueRow)}
              </div>
            )}

            {/* READ CLEANLY, NOT YET CONFIRMED (walk-through RECEIPTS-W44,
                2026-10-01). A paper that adds up with no warning was filed
                as `received` and never listed here, so nobody stood behind
                it. Listed after the papers that need a look, under their own
                heading, so every vendor paper reaches a person's swipe. */}
            {data.cleanKnown && data.clean.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3
                  style={{
                    margin: 0,
                    padding: '4px 0',
                    fontFamily: MONO,
                    fontSize: 9.5,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4, #665D50)',
                  }}
                >
                  Read cleanly · not yet confirmed · {data.cleanCapped ? GE : ''}
                  {data.clean.length}
                </h3>
                <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                  {data.clean.map(queueRow)}
                </div>
              </div>
            )}

            {/* the verified lane — the record, one click away, read-only
                (opus-fidelity R-1: "everything from all of the orders" must
                not shrink the verified book to a header integer) */}
            {data.verifiedKnown && data.verified.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => setShowVerified((v) => !v)}
                  aria-expanded={showVerified}
                  className="rc-ink"
                  style={{
                    fontFamily: MONO,
                    fontSize: 9.5,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-4, #665D50)',
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                  }}
                >
                  Verified · {data.verifiedCapped ? GE : ''}{data.verified.length} {showVerified ? '▾' : '▸'}
                </button>
                {showVerified && (
                  <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                    {data.verified.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => select(d.id)}
                        aria-pressed={selectedId === d.id}
                        className="rc-row block w-full text-left"
                        style={{
                          padding: '7px 8px',
                          border: 'none',
                          borderBottom: '1px solid var(--paper-2, #EAE4D8)',
                          borderLeft: selectedId === d.id ? '3px solid var(--seal, #1A5E6B)' : '3px solid transparent',
                          background: selectedId === d.id ? 'var(--paper-1, #F3EFE6)' : undefined,
                          cursor: 'pointer',
                          fontFamily: SANS,
                        }}
                      >
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                          {typeLabel(d.doc_type)} · {d.doc_number || EM} · {fmtDate(d.doc_date)} · {fmtMoney(d.total, d.currency)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* the selected document */}
          <section aria-label="Document detail">
            {selected ? (
              <>
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="rc-ink mb-3 2xl:hidden"
                  style={{
                    fontFamily: SANS,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--seal-deep, #14515C)',
                    border: 'none',
                    background: 'transparent',
                    padding: '2px 0',
                    cursor: 'pointer',
                  }}
                >
                  ← All receipts · {data.queueCapped ? GE : ''}{data.queue.length} awaiting review
                </button>
                {/*
                  SKIP PAST THE SHEET (walk-through RECEIPTS-W40, 2026-10-01).
                  Every figure on the sheet is three Tab stops — the figure,
                  "Correct this", "I have checked this" (W30) — so reaching the
                  card's swipe on SYN-TR-0001 took about 94 presses. This link
                  is the first stop of the document, shows itself only when
                  focused, and moves focus to the card's heading. W30 is
                  unchanged. No `#` is written to the address: `?doc=` is the
                  page's state and a fragment would add a history step.
                */}
                <a
                  href="#rc-check"
                  className="rc-skip"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('rc-check')?.focus();
                  }}
                >
                  Skip to the review card
                </a>
                <div aria-label="Formatted document" className="mb-6">
                  <Suspense fallback={null}>
                    <CanonicalDocumentPage documentId={selected.id} embedded />
                  </Suspense>
                </div>
                <DocView key={selected.id} doc={selected} onVerified={() => select(null)} />
              </>
            ) : selectedId && data.queueKnown && data.cleanKnown && data.verifiedKnown ? (
              /*
               * A LINK THAT OPENS NOTHING SAYS SO (walk-through W19, 2026-10-01).
               * `?doc=` only opens a document this page already holds: the
               * review queue or the verified book. Anything else (another
               * house's document, one still being read, one set aside, one
               * older than the verified window) fell through to "Choose a
               * document", as if no link had been followed. Found in P4 as the
               * Sim manager opening a Sim Meyhouse link from Sim Bistro.
               */
              <div data-testid="doc-not-here" style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
                <p style={{ margin: '0 0 6px' }}>
                  The link asked for a document that is not in this house&apos;s review queue
                  {data.verifiedCapped ? ' or its latest verified documents' : ' or its verified book'}.
                  It may belong to another house, still be reading, or have been set aside.
                </p>
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="rc-ink"
                  style={{
                    fontFamily: SANS,
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--seal-deep, #14515C)',
                    border: 'none',
                    background: 'transparent',
                    padding: '2px 0',
                    cursor: 'pointer',
                  }}
                >
                  Show the queue
                </button>
              </div>
            ) : (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>
                {selectedId
                  ? 'Opening the linked document…'
                  : 'Choose a document from the queue to see its lines and its order, and to confirm it.'}
              </p>
            )}
          </section>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
