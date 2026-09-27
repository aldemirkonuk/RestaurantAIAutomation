/**
 * The two acts of "Who is writing" — sketch 113 direction A, frame 4c, both
 * drawn as centred panels at 620 (ADR 0112's only panel width):
 *
 *   TrustPanel      — trusting a domain lifts the spoof quarantine on its
 *                     future mail. A security act, so it takes the hold
 *                     (`HoldToApprove`): "an argued exception, since trust is
 *                     neither money nor on F10's undo-after list" (sketch 113
 *                     README, founder question 8). The founder, ADR 0160
 *                     §113: "hold the truss [hold to trust] is great. 4C. Yep."
 *   AddVendorPanel  — the "Add as a vendor" ask. It creates a vendor row and
 *                     trusts nothing, so it is a plain create with a button,
 *                     not a hold.
 *
 * Both moved here from `/promotions` (ADR 0160 Open item 3, founder
 * 2026-09-18). They are pure views over a caller-supplied write: the write
 * throws on failure, and the panel says so in words instead of sealing.
 */

import { useState, type CSSProperties } from 'react';
import { HoldToApprove, Panel } from '@/components/mudavym';
import type { ProspectDto, SenderReputationDto } from '../../../hooks/queries/usePromotionsQueries';
import { EM, MONO, SANS } from './cm-format';
import { fmtCount, fmtDay, promoteOutcome, readFailure, senderState, writeFailureSentence } from './senders-format';

export const BTN: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
export const BTN_PRIMARY: CSSProperties = {
  ...BTN,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  background: 'transparent',
  color: 'var(--seal-deep, #14515C)',
};
export const BTN_QUIET: CSSProperties = {
  ...BTN,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'transparent',
  color: 'var(--ink-2, #4F473C)',
};

const EYEBROW: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
};
/** The overlay body is unpadded by design (`.mdv-ovl__body`); the head and foot inset 16px, so the content does too. */
const BODY: CSSProperties = { padding: '12px 16px' };
const NOTE: CSSProperties = { fontFamily: SANS, fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '0 0 10px' };
const ALERT: CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  color: 'var(--alarm-deep, #8C3322)',
  margin: '10px 0 0',
};

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '4px 12px', margin: '0 0 10px', fontSize: 12 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>{k}</dt>
          <dd style={{ fontFamily: MONO, fontSize: 11.5, margin: 0, color: 'var(--ink-1, #211C16)' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TrustPanelProps {
  sender: SenderReputationDto | null;
  houseName: string | null;
  onClose: () => void;
  /** Writes the trust and READS IT BACK; rejects when the register does not show the domain trusted. */
  onTrust: (sender: SenderReputationDto) => Promise<void>;
}

export function TrustPanel({ sender, houseName, onClose, onTrust }: TrustPanelProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [landed, setLanded] = useState(false);
  if (!sender) return null;
  const state = senderState(sender);
  const house = houseName ?? 'this house';

  return (
    <Panel
      open
      onClose={onClose}
      closeLabel="Close"
      label={`Trust ${sender.domain} — future mail from this domain skips the spoof quarantine for ${house}. Holding writes the trust to the sender register; leaving writes nothing.`}
      eyebrow={`Trust a sender · ${house}`}
      title={`Trust ${sender.domain}?`}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <HoldToApprove
            label="Hold to trust"
            approvedLabel="Trusted"
            holdMs={620}
            copy={{ unconfirmed: 'Not saved — the register did not show this domain as trusted. Nothing changed.' }}
            disabled={landed}
            onApprove={async () => {
              setFailure(null);
              try {
                await onTrust(sender);
                setLanded(true);
              } catch (err) {
                setFailure(writeFailureSentence('Trusting this domain', readFailure(err)));
                throw err;
              }
            }}
          />
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            Reversible from the same row; the register keeps when.
          </span>
        </div>
      }
    >
      <div style={BODY}>
      <p style={NOTE}>
        Future mail from this domain skips the spoof quarantine for {house}. Mail already quarantined stays where it is.
        Trust lifts that one gate and nothing else — every other guardrail still applies, and trust suspends itself on an
        injection attempt or sustained spam.
      </p>
      {state.tone === 'suspended' && (
        <p style={NOTE}>
          This domain is <b>{state.word}</b>. Trusting it again clears the suspension.
        </p>
      )}
      <Kv
        rows={[
          ['completed_orders', fmtCount(sender.completed_orders)],
          ['injection_signals', fmtCount(sender.injection_signals)],
          ['spam_signals', fmtCount(sender.spam_signals)],
          ['updated_at', fmtDay(sender.updated_at)],
        ]}
      />
      <p style={{ ...NOTE, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
        Written to the sender register for this house, then read back. A write that did not land is reported as not
        saved.
      </p>
      {landed && (
        <p role="status" style={{ ...NOTE, color: 'var(--seal-deep, #14515C)', margin: '10px 0 0' }}>
          {sender.domain} is trusted — the register now reads it back as trusted.
        </p>
      )}
      {failure && (
        <p role="alert" style={ALERT}>
          {failure}
        </p>
      )}
      </div>
    </Panel>
  );
}

export interface AddVendorPanelProps {
  prospect: ProspectDto | null;
  houseName: string | null;
  onClose: () => void;
  /** Resolves with the gateway's answer; rejects on a transport or gateway failure. */
  onAdd: (p: ProspectDto) => Promise<{ promoted?: boolean; reused?: boolean }>;
}

export function AddVendorPanel({ prospect, houseName, onClose, onAdd }: AddVendorPanelProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReturnType<typeof promoteOutcome> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  if (!prospect) return null;
  const who = prospect.sender_name || prospect.domain;
  const house = houseName ?? 'this house';
  const done = outcome !== null && outcome.kind !== 'not-added';

  const create = async () => {
    setBusy(true);
    setFailure(null);
    try {
      setOutcome(promoteOutcome(await onAdd(prospect), who));
    } catch (err) {
      setFailure(writeFailureSentence('The vendor', readFailure(err)));
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string | null) => (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, marginBottom: 6, alignItems: 'baseline' }}>
      <span style={{ ...EYEBROW, fontSize: 9 }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink-1, #211C16)' }}>{value || EM}</span>
    </div>
  );

  return (
    <Panel
      open
      onClose={onClose}
      closeLabel="Close"
      label={`Add ${who} as a vendor — creates a vendor row for ${house} from the sender's own header fields and trusts nothing. Leaving writes nothing.`}
      eyebrow={`Add a vendor · from a stranger's mail · ${house} only`}
      title={`Add ${who} as a vendor?`}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={BTN_QUIET} onClick={onClose}>
            {done ? 'Close' : 'Not now'}
          </button>
          {!done && (
            <button type="button" style={BTN_PRIMARY} disabled={busy} onClick={create}>
              Create the vendor
            </button>
          )}
        </div>
      }
    >
      <div style={BODY}>
      {field('Name', prospect.sender_name)}
      {field('Domain', prospect.domain)}
      {field('Contact', prospect.sender_email)}
      <p style={{ ...NOTE, marginTop: 10 }}>
        Creates a vendor row for {house} from the sender's own header fields — for this house only, even when Strangers is
        read across every house. It trusts nothing: their mail stays under the spoof check until the domain is trusted, and
        their offers read “cannot be graded” until an invoice from them is accepted.
      </p>
      {outcome && (
        <p role="status" style={{ ...NOTE, color: outcome.kind === 'not-added' ? 'var(--alarm-deep, #8C3322)' : 'var(--seal-deep, #14515C)' }}>
          {outcome.sentence}
        </p>
      )}
      {failure && (
        <p role="alert" style={ALERT}>
          {failure}
        </p>
      )}
      </div>
    </Panel>
  );
}
