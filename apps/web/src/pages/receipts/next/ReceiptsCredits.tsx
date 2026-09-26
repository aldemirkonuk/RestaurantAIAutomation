/**
 * ReceiptsCredits — the credit ledger as a lane of the rebuilt /receipts
 * (ADR 0149 row 22: "a credits lane in /receipts", one of the four capabilities
 * with no Mudavym home before the cutover). `/credits` lands here as
 * `?tab=credits`.
 *
 * WHAT THIS LANE KEEPS HONEST
 *   1. CLAIMED IS NOT RECOVERED (credit-ledger.ts). A claim counts as recovered
 *      only once the vendor's credit memo is filed against it, at the amount the
 *      vendor allowed. The settle form therefore asks for both, and picks the
 *      memo from the documents this house already holds instead of asking a
 *      person to type an id (the legacy tab's `window.prompt`).
 *   2. NOTHING LEAVES THE BUILDING. Moving a claim to `requested` stamps who and
 *      when; no email, no message, no queue (credits.controller.ts, the
 *      `requested` branch). So the move says "I asked the vendor", in the
 *      person's own voice, and the lane says plainly that Mudavym did not.
 *   3. NO SUM ACROSS CURRENCIES. The gateway's combined figures add every claim
 *      whatever its currency; this lane prints `byCurrency`, one group per code,
 *      and each claim in its own code. Nothing is converted.
 *   4. A WINDOW IS NOT A TOTAL (ADR 0051 clause 2). The list is the oldest 200
 *      and the figures are computed behind 5,000 rows; either at its cap is a
 *      floor and carries `≥`.
 *   5. ABSENCE IS NOT HEALTH. An unanswered list is "reaching the gateway", a
 *      failed one says which source failed and in whose words, and a refusal
 *      (ADR 0167: owner or manager only) says who the ledger is kept for.
 *
 * The ledger is offered to the owner and managers of this house only
 * (ADR 0167, founder 2026-09-19: "Refuse staff on all four"); ReceiptsNext
 * decides that from the role IN THIS HOUSE and never mounts this for staff.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sheet } from '@/components/mudavym/Sheet';
import { useAuth } from '@/contexts/AuthContext';
import { useProviders } from '@/hooks/queries/useProviderQueries';
import { VENDOR_UNNAMED } from '@/lib/mudavym/vendor';
import type { CreditState, ProcurementCredit, RecoveryFigures } from '../../../services/api/credits';
import type { ProcurementDocument } from '../../../services/api/documents';
import { EM, GE, MONO, SANS, SERIF, fmtDate, fmtMoney, serverMessage } from './rc2-format';
import {
  CHASED_STATES,
  CREDIT_MOVES,
  RECEIPTS_SERVER_WINDOWS,
  useActiveRestaurantId,
  useCreditMove,
  useReceiptsCreditsData,
  type ReceiptsCreditsData,
} from './useReceiptsNextData';

/* ─────────────────────────────────────────────────────────────── words ── */

/** The reason codes (`procurement_credits_reason_check`) in the house's words. */
export const REASON_WORDS: Record<string, string> = {
  overbilled_vs_ship: 'Billed for more than their packing slip shipped',
  qty_short: 'Billed for more than arrived',
  short_shipped: 'Lost between their warehouse and the door',
  damaged: 'Refused at the door',
  price_variance: 'Billed above the agreed price',
  never_ordered: 'Billed for something never ordered',
  other: 'Another reason',
};

export function reasonWords(code: string | null | undefined): string {
  if (!code) return 'No reason recorded';
  return REASON_WORDS[code] ?? `Recorded as “${code}”`;
}

/** What each state means, said so it cannot be mistaken for a sent letter. */
export const STATE_WORDS: Record<CreditState, string> = {
  open: 'Opened — the vendor has not been asked',
  requested: 'Asked — someone here asked the vendor',
  promised: 'Promised — the vendor said yes; not money yet',
  credited: 'Recovered — settled by a credit memo',
  rejected: 'Refused by the vendor',
  written_off: 'Written off',
};

/** The move buttons, and the sentence each one writes to the ledger. */
export const MOVE_WORDS: Record<CreditState, { verb: string; writes: string }> = {
  open: { verb: 'Reopen', writes: '' },
  requested: {
    verb: 'I asked the vendor',
    writes:
      'Records that you asked the vendor for this credit, with your name and today’s date. Mudavym sends nothing to the vendor.',
  },
  promised: {
    verb: 'The vendor promised it',
    writes:
      'Records the vendor’s yes. A promise is not money: it is not counted as recovered until the credit memo is filed.',
  },
  credited: {
    verb: 'Settle against a credit memo',
    writes: 'Records the amount the vendor allowed and the credit memo that proves it. This closes the claim for good.',
  },
  rejected: {
    verb: 'The vendor refused',
    writes: 'Records the vendor’s refusal. The claim can still be asked again later.',
  },
  written_off: {
    verb: 'Write it off',
    writes: 'Stops chasing this claim. Nothing is recovered and it cannot be reopened.',
  },
};

/* ─────────────────────────────────────────────────────────────── style ── */

const CAP: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
};

const NOTE: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  color: 'var(--ink-3, #7C7365)',
  margin: 0,
};

const LINK_BUTTON: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--seal-deep, #14515C)',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: SANS,
};

const MOVE_BUTTON: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
};

const PRIMARY_BUTTON: CSSProperties = {
  ...MOVE_BUTTON,
  background: 'var(--seal, #1A5E6B)',
  borderColor: 'var(--seal, #1A5E6B)',
  color: 'var(--paper-0, #FFFDF8)',
};

/* ────────────────────────────────────────────────────────────── helpers ── */

function ageDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function fmtRate(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return EM;
  return `${Math.round(r * 100)}%`;
}

function useVendorNames(): Map<string, string> {
  const rid = useActiveRestaurantId();
  const providers = useProviders(rid ?? '');
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const p of providers.data ?? []) {
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (p.id && name) out.set(p.id, name);
    }
    return out;
  }, [providers.data]);
}

/**
 * Which memos already settle other claims. A vendor may settle two claims on
 * one memo, so the server allows it; the picker says so rather than letting a
 * person file the same memo twice without noticing.
 */
function settledByMemo(claims: ProcurementCredit[] | null, except: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of claims ?? [])
    if (c.id !== except && c.credit_document_id)
      out.set(c.credit_document_id, (out.get(c.credit_document_id) ?? 0) + 1);
  return out;
}

function vendorOf(c: ProcurementCredit, names: Map<string, string>): string {
  return (c.provider_id && names.get(c.provider_id)) || VENDOR_UNNAMED;
}

/* ──────────────────────────────────────────────────────────── figures ── */

function FigureTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        padding: '10px 12px',
        background: 'var(--paper-0, #FFFDF8)',
      }}
    >
      <span style={CAP}>{label}</span>
      <p
        style={{
          fontFamily: MONO,
          fontSize: 17,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--ink-1, #211C16)',
          margin: '4px 0 0',
        }}
      >
        {value}
      </p>
      <p style={{ ...NOTE, fontSize: 11, marginTop: 2 }}>{hint}</p>
    </div>
  );
}

function CurrencyFigures({
  code,
  figures,
  floor,
}: {
  code: string | null;
  figures: RecoveryFigures;
  floor: string;
}) {
  const money = (n: number) => `${floor}${fmtMoney(n, code)}`;
  return (
    <div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
      >
        <FigureTile label="Recovered" value={money(figures.recovered)} hint="Settled by a credit memo, at the amount allowed" />
        <FigureTile label="Outstanding" value={money(figures.outstanding)} hint="Opened or asked, not yet answered" />
        <FigureTile label="Promised" value={money(figures.promised)} hint="The vendor said yes — not money yet" />
        <FigureTile label="Refused" value={money(figures.rejected)} hint="Asked for and turned down" />
      </div>
      <p style={{ ...NOTE, marginTop: 6 }}>
        {floor}
        {figures.openClaims} open {figures.openClaims === 1 ? 'claim' : 'claims'}
        {' · '}
        {figures.oldestOpenDays == null
          ? 'no claim is waiting'
          : `the oldest has waited ${floor}${figures.oldestOpenDays} ${figures.oldestOpenDays === 1 ? 'day' : 'days'}`}
        {' · '}
        {figures.settlementRate == null
          ? 'no claim has been answered yet, so there is no settlement rate'
          : `${fmtRate(figures.settlementRate)} of answered claims were credited`}
      </p>
    </div>
  );
}

function Figures({ data }: { data: ReceiptsCreditsData }) {
  const { stats } = data;
  if (stats === null) return null;
  const floor = data.statsFloor ? GE : '';
  const groups = stats.byCurrency ? Object.entries(stats.byCurrency) : null;

  return (
    <section aria-label="Recovery figures" style={{ display: 'grid', gap: 12 }}>
      {data.statsFloor && (
        <p style={NOTE}>
          {stats.capped
            ? `These figures were computed from the first ${RECEIPTS_SERVER_WINDOWS.RECOVERY_STATS.toLocaleString()} claims the gateway read, so each one is a floor (${GE}).`
            : `The gateway did not say whether it read every claim (it reads at most ${RECEIPTS_SERVER_WINDOWS.RECOVERY_STATS.toLocaleString()}), so each figure is shown as a floor (${GE}).`}
        </p>
      )}
      {groups === null ? (
        // An older gateway with no per-currency figures: the combined ones are
        // all there is, and their currency is not stated.
        <CurrencyFigures code={null} figures={stats} floor={floor} />
      ) : groups.length === 0 ? (
        <p style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>
          No credit claim has been opened at this house. When an invoice bills more than was
          agreed or arrived, the house opens the claim here.
        </p>
      ) : (
        groups.map(([code, figures]) => (
          <div key={code}>
            {groups.length > 1 && (
              <p style={{ ...CAP, marginBottom: 6 }}>
                Claims in {code} — kept apart, nothing is converted
              </p>
            )}
            <CurrencyFigures code={code} figures={figures} floor={floor} />
          </div>
        ))
      )}
      {stats.selfEvidencedOpen > 0 && (
        <p style={NOTE}>
          {floor}
          {stats.selfEvidencedOpen} open {stats.selfEvidencedOpen === 1 ? 'claim is' : 'claims are'}{' '}
          provable from the vendor’s own paperwork — worth a phone call first.
        </p>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── the list ── */

function ClaimRow({
  claim,
  vendor,
  now,
  selected,
  onOpen,
}: {
  claim: ProcurementCredit;
  vendor: string;
  now: number;
  selected: boolean;
  onOpen: () => void;
}) {
  const age = ageDays(claim.opened_at, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      className="rc-row block w-full text-left"
      style={{
        padding: '9px 8px',
        border: 'none',
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        borderLeft: selected ? '3px solid var(--seal, #1A5E6B)' : '3px solid transparent',
        background: selected ? 'var(--paper-1, #F3EFE6)' : undefined,
        cursor: 'pointer',
        fontFamily: SANS,
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
          {reasonWords(claim.reason)}
          {claim.self_evidenced && (
            <span
              title="Provable from the vendor's own paperwork"
              style={{
                fontFamily: MONO,
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--seal-deep, #14515C)',
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                borderRadius: 3,
                padding: '1px 5px',
                marginLeft: 8,
                verticalAlign: 'middle',
              }}
            >
              Provable
            </span>
          )}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-1, #211C16)',
            whiteSpace: 'nowrap',
          }}
        >
          {fmtMoney(claim.claimed_amount, claim.currency)}
        </span>
      </span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)', marginTop: 2 }}>
        {vendor} · {STATE_WORDS[claim.state] ?? claim.state} · opened {fmtDate(claim.opened_at)}
        {age == null ? '' : ` · ${age} ${age === 1 ? 'day' : 'days'} ago`}
      </span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────── the sheet ── */

function SettleForm({
  claim,
  memos,
  memosCapped,
  memosFailed,
  settledBy,
  pending,
  onSettle,
  onCancel,
}: {
  claim: ProcurementCredit;
  memos: ProcurementDocument[] | null;
  /** Memo id → how many OTHER claims it already settles (from the loaded list). */
  settledBy: Map<string, number>;
  memosCapped: boolean;
  memosFailed: boolean;
  pending: boolean;
  onSettle: (amount: number, memoId: string) => void;
  onCancel: () => void;
}) {
  const [memoId, setMemoId] = useState<string | null>(null);
  const [amountRaw, setAmountRaw] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // The claim's own vendor first: a memo from another vendor settles nothing
  // here, but the house may file memos without a vendor, so none is hidden.
  const ordered = useMemo(() => {
    if (!memos) return null;
    const same = memos.filter((m) => claim.provider_id && m.provider_id === claim.provider_id);
    const rest = memos.filter((m) => !(claim.provider_id && m.provider_id === claim.provider_id));
    return [...same, ...rest];
  }, [memos, claim.provider_id]);

  const submit = () => {
    const amount = Number(amountRaw.trim());
    if (!memoId) {
      setProblem('Choose the credit memo that settles this claim.');
      return;
    }
    if (amountRaw.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setProblem('Enter the amount the vendor allowed, as a number of zero or more.');
      return;
    }
    setProblem(null);
    onSettle(amount, memoId);
  };

  return (
    <div
      style={{
        border: '1px solid var(--paper-2, #EAE4D8)',
        borderRadius: 12,
        padding: '12px 14px',
        display: 'grid',
        gap: 10,
      }}
    >
      <p style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>{MOVE_WORDS.credited.writes}</p>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ ...CAP, marginBottom: 6 }}>The credit memo</legend>
        {ordered === null ? (
          <p style={NOTE}>
            {memosFailed
              ? 'The credit memos on file could not be read, so none can be chosen. Try again from the ledger.'
              : 'Reaching the gateway for the credit memos on file…'}
          </p>
        ) : ordered.length === 0 ? (
          <p style={NOTE}>
            No credit memo is on file at this house. When the vendor sends it, it lands in Receipts;
            the claim can be settled then. Until then it stays unrecovered, however firm the promise.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {memosCapped && (
              <p style={NOTE}>
                Showing the newest {GE}
                {RECEIPTS_SERVER_WINDOWS.CREDIT_MEMOS} credit memos; an older one is not listed here.
              </p>
            )}
            {ordered.map((m) => {
              const sameVendor = !!claim.provider_id && m.provider_id === claim.provider_id;
              const otherCurrency =
                !!m.currency && !!claim.currency && m.currency !== claim.currency;
              return (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    fontFamily: SANS,
                    fontSize: 12,
                    color: 'var(--ink-1, #211C16)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name={`memo-${claim.id}`}
                    value={m.id}
                    checked={memoId === m.id}
                    onChange={() => setMemoId(m.id)}
                  />
                  <span>
                    Credit memo {m.doc_number || EM} · {fmtDate(m.doc_date)} ·{' '}
                    {fmtMoney(m.total, m.currency)}
                    {sameVendor ? ' · this claim’s vendor' : ''}
                    {m.status !== 'verified' ? ' · not yet verified' : ''}
                    {otherCurrency ? ` · in ${m.currency}, the claim is in ${claim.currency}` : ''}
                    {settledBy.get(m.id)
                      ? ` · already settles ${settledBy.get(m.id)} other ${settledBy.get(m.id) === 1 ? 'claim' : 'claims'}`
                      : ''}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      <label style={{ display: 'grid', gap: 4, fontFamily: SANS, fontSize: 12 }}>
        <span style={CAP}>What the vendor allowed</span>
        <input
          inputMode="decimal"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          placeholder={`claimed ${fmtMoney(claim.claimed_amount, claim.currency)}`}
          aria-describedby={`allowed-hint-${claim.id}`}
          style={{
            fontFamily: MONO,
            fontSize: 13,
            padding: '6px 8px',
            borderRadius: 8,
            border: '1px solid var(--paper-2, #EAE4D8)',
            background: 'var(--paper-0, #FFFDF8)',
            color: 'var(--ink-1, #211C16)',
            maxWidth: 200,
          }}
        />
        <span id={`allowed-hint-${claim.id}`} style={{ ...NOTE, fontSize: 11 }}>
          The memo’s figure, not the claim’s: vendors often allow part of what was asked.
        </span>
      </label>

      {problem && (
        <p role="alert" style={{ ...NOTE, color: 'var(--ink-1, #211C16)' }}>
          {problem}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !ordered || ordered.length === 0}
          style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}
        >
          {pending ? 'Recording…' : 'Record the settlement'}
        </button>
        <button type="button" onClick={onCancel} style={MOVE_BUTTON} disabled={pending}>
          Not now
        </button>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 8, padding: '5px 0' }}>
      <dt style={CAP}>{label}</dt>
      <dd style={{ margin: 0, fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>{children}</dd>
    </div>
  );
}

function ClaimSheet({
  claim,
  vendor,
  data,
  onClose,
}: {
  claim: ProcurementCredit;
  vendor: string;
  data: ReceiptsCreditsData;
  onClose: () => void;
}) {
  const move = useCreditMove();
  const [armed, setArmed] = useState<CreditState | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const moves = CREDIT_MOVES[claim.state] ?? [];
  const memo = claim.credit_document_id
    ? data.memos?.find((m) => m.id === claim.credit_document_id) ?? null
    : null;

  const run = (to: CreditState, extra: { creditedAmount?: number; creditDocumentId?: string } = {}) => {
    setRefusal(null);
    setDone(null);
    move.mutate(
      { id: claim.id, to, ...extra },
      {
        onSuccess: () => {
          setArmed(null);
          setDone(`Recorded: ${STATE_WORDS[to]}.`);
        },
        onError: (e) =>
          setRefusal(
            `${serverMessage(e, 'The gateway did not record it')} — the claim is unchanged.`,
          ),
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label="One vendor credit claim. Each move below writes the claim's new state to the ledger; closing writes nothing."
      eyebrow="Credit claim"
      title={reasonWords(claim.reason)}
      closeLabel="Close"
    >
      <dl style={{ margin: 0 }}>
        <Fact label="Vendor">{vendor}</Fact>
        <Fact label="Claimed">
          {fmtMoney(claim.claimed_amount, claim.currency)}
          {claim.claimed_qty != null ? ` · ${claim.claimed_qty} btl` : ''}
        </Fact>
        <Fact label="What happened">{claim.summary?.trim() || EM}</Fact>
        <Fact label="State">{STATE_WORDS[claim.state] ?? claim.state}</Fact>
        <Fact label="Evidence">
          {claim.self_evidenced
            ? 'Provable from the vendor’s own paperwork'
            : 'Our count or our price against their invoice'}
        </Fact>
        <Fact label="Opened">{fmtDate(claim.opened_at)}</Fact>
        <Fact label="Asked">{claim.requested_at ? fmtDate(claim.requested_at) : 'Not recorded'}</Fact>
        {claim.promised_at && <Fact label="Promised">{fmtDate(claim.promised_at)}</Fact>}
        {claim.settled_at && <Fact label="Closed">{fmtDate(claim.settled_at)}</Fact>}
        {claim.state === 'credited' && (
          <Fact label="Allowed">{fmtMoney(claim.credited_amount, claim.currency)}</Fact>
        )}
        <Fact label="Invoice">
          {claim.document_id ? (
            <Link to={`/documents/${claim.document_id}`} style={{ color: 'var(--seal-deep, #14515C)' }}>
              Open the invoice this claim was raised on
            </Link>
          ) : (
            'No invoice is attached to this claim'
          )}
        </Fact>
        {claim.credit_document_id && (
          <Fact label="Credit memo">
            <Link to={`/documents/${claim.credit_document_id}`} style={{ color: 'var(--seal-deep, #14515C)' }}>
              {memo?.doc_number ? `Open credit memo ${memo.doc_number}` : 'Open the credit memo'}
            </Link>
          </Fact>
        )}
        {claim.notes?.trim() && <Fact label="Notes">{claim.notes.trim()}</Fact>}
      </dl>

      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        {moves.length === 0 ? (
          <p style={NOTE}>
            {claim.state === 'credited'
              ? 'Settled. A recovered claim cannot be reopened, so the same money is never counted twice.'
              : 'Written off. This claim is closed and cannot be reopened.'}
          </p>
        ) : armed === 'credited' ? (
          <SettleForm
            claim={claim}
            memos={data.memos}
            memosCapped={data.memosCapped}
            memosFailed={data.memos === null && data.failures.some((f) => f.startsWith('the credit memos'))}
            settledBy={settledByMemo(data.claims, claim.id)}
            pending={move.isPending}
            onSettle={(amount, memoId) => run('credited', { creditedAmount: amount, creditDocumentId: memoId })}
            onCancel={() => setArmed(null)}
          />
        ) : armed ? (
          <div
            style={{
              border: '1px solid var(--paper-2, #EAE4D8)',
              borderRadius: 12,
              padding: '12px 14px',
              display: 'grid',
              gap: 10,
            }}
          >
            <p style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>{MOVE_WORDS[armed].writes}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => run(armed)}
                disabled={move.isPending}
                style={{ ...PRIMARY_BUTTON, opacity: move.isPending ? 0.6 : 1 }}
              >
                {move.isPending ? 'Recording…' : `Record: ${MOVE_WORDS[armed].verb.toLowerCase()}`}
              </button>
              <button type="button" onClick={() => setArmed(null)} style={MOVE_BUTTON} disabled={move.isPending}>
                Not now
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={CAP}>What happened next</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {moves.map((to) => (
                <button key={to} type="button" onClick={() => setArmed(to)} style={MOVE_BUTTON}>
                  {claim.state === 'rejected' && to === 'requested' ? 'I asked the vendor again' : MOVE_WORDS[to].verb}
                </button>
              ))}
            </div>
            {claim.state === 'open' && (
              <p style={NOTE}>Mudavym does not send this claim to the vendor. When you ask them, record it here.</p>
            )}
          </div>
        )}

        {refusal && (
          <p role="alert" style={{ ...NOTE, color: 'var(--ink-1, #211C16)' }}>
            {refusal}
          </p>
        )}
        {done && (
          <p role="status" style={{ ...NOTE, color: 'var(--seal-deep, #14515C)' }}>
            {done}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────── the lane ── */

export function ReceiptsCredits() {
  const data = useReceiptsCreditsData(true);
  const names = useVendorNames();
  const { activeRole, user } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  // One clock per render of the list, so every row ages against the same now.
  const now = Date.now();

  const chased = (data.claims ?? []).filter((c) => CHASED_STATES.includes(c.state));
  const closed = (data.claims ?? []).filter((c) => !CHASED_STATES.includes(c.state));
  const selected = data.claims?.find((c) => c.id === selectedId) ?? null;
  const listFloor = data.claimsCapped ? GE : '';

  if (data.noRestaurant) {
    return (
      <p role="alert" style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>
        No restaurant is selected, so this house’s credit ledger was never requested. Nothing here is
        claimed — this is not an empty ledger.
      </p>
    );
  }

  if (data.refused) {
    const role = activeRole ?? user?.role ?? null;
    return (
      <p role="alert" style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>
        The credit ledger is kept for the owner and managers of this house, and the gateway refused
        it to this session
        {role ? ` (signed in as ${role} here)` : ''}. Nothing below is claimed.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <p style={{ ...NOTE, color: 'var(--ink-2, #4F473C)', maxWidth: 720 }}>
        What vendors owe this house back. A claim counts as recovered only when the vendor’s credit
        memo is filed against it. Mudavym does not send these claims; when someone asks the vendor,
        they record it here.
      </p>

      {data.failures.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
            Could not read {data.failures.join('; ')}. What is not shown is unknown, not empty.
          </span>
          <button type="button" onClick={data.refetch} style={LINK_BUTTON}>
            Try again
          </button>
        </div>
      )}

      {data.stats === null && !data.failures.some((f) => f.startsWith('the recovery')) && (
        <p style={NOTE}>Reaching the gateway for the recovery figures…</p>
      )}
      <Figures data={data} />

      <section aria-label="Claims being chased">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, margin: 0, color: 'var(--ink-1, #211C16)' }}>
            Being chased
          </h2>
          {data.claims !== null && (
            <span style={CAP}>
              {listFloor}
              {chased.length} · oldest first
            </span>
          )}
        </div>
        {data.claimsCapped && (
          <p style={{ ...NOTE, marginBottom: 6 }}>
            The gateway returns the oldest {RECEIPTS_SERVER_WINDOWS.CREDITS_LIST} claims, and this
            list is full — newer claims exist that are not shown here, and every count is a floor (
            {GE}).
          </p>
        )}
        {data.claims === null ? (
          !data.failures.some((f) => f.startsWith('the claims')) && (
            <p style={NOTE}>Reaching the gateway for the claims…</p>
          )
        ) : chased.length === 0 ? (
          <p style={NOTE}>No claim is being chased right now.</p>
        ) : (
          <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
            {chased.map((c) => (
              <ClaimRow
                key={c.id}
                claim={c}
                vendor={vendorOf(c, names)}
                now={now}
                selected={c.id === selectedId}
                onOpen={() => setSelectedId(c.id)}
              />
            ))}
          </div>
        )}
      </section>

      {data.claims !== null && closed.length > 0 && (
        <section aria-label="Closed claims">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="rc-ink"
            style={{ ...CAP, border: 'none', padding: '4px 0', cursor: 'pointer', background: 'transparent' }}
          >
            Closed · {listFloor}
            {closed.length} {showClosed ? '▾' : '▸'}
          </button>
          {showClosed && (
            <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
              {closed.map((c) => (
                <ClaimRow
                  key={c.id}
                  claim={c}
                  vendor={vendorOf(c, names)}
                  now={now}
                  selected={c.id === selectedId}
                  onOpen={() => setSelectedId(c.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {selected && (
        <ClaimSheet
          key={selected.id}
          claim={selected}
          vendor={vendorOf(selected, names)}
          data={data}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

export default ReceiptsCredits;
