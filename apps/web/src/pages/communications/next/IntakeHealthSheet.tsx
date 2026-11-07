/**
 * The intake health sheet (proposal §2.5) — the one dense, technical surface
 * of the Mail tab. One row per way mail comes in: its status, its last read
 * and the last letter it stored; then which address letters leave from and
 * where vendors write back; then the house's Mudavym address with a copy act.
 * Every sentence is in the house's words: no "door", no "inbound domain", no
 * raw error (QA round 16, finding 3).
 *
 * Honesty rules:
 * - only the house mailbox keeps a record of its reads, so only it can be
 *   "reading" or "behind"; every other door is "cannot tell" until a durable
 *   cursor exists (proposal L3) — a stored letter is not proof a door is open;
 * - letters held before reaching the house are not recorded yet, and the
 *   line says so (never 0);
 * - no address is ever invented: a Mudavym address that cannot exist yet is
 *   said in words with nothing to copy, and so is an unread sender (QA M13).
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { Sheet } from '@/components/mudavym';
import type { Detent } from '@/components/mudavym/Sheet';
import { EM, MONO, SANS } from './cm-format';
import {
  houseMailboxStatus,
  lastStoredWords,
  senderLine,
  unrecordedDoorStatus,
  type DoorStatus,
  type MailboxReader,
  type MailSummary,
  type SenderLineInput,
} from './mail-format';

const FULL: readonly Detent[] = ['full'];

const TONE: Record<DoorStatus['tone'], string> = {
  ink: 'var(--ink-2, #4F473C)',
  seal: 'var(--seal-deep, #14515C)',
  warn: 'var(--warn, #96601A)',
  alarm: 'var(--alarm, #A33A2B)',
};

const LABEL: CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4, #665D50)',
  margin: '0 0 6px',
};
const CELL: CSSProperties = { fontSize: 12, color: 'var(--ink-2, #4F473C)', overflowWrap: 'anywhere' };
const DT: CSSProperties = { fontSize: 11, color: 'var(--ink-4, #665D50)' };

function Door({
  name,
  status,
  lastRead,
  lastStored,
  testId,
}: {
  name: string;
  status: DoorStatus;
  lastRead: string;
  lastStored: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      data-state={status.state}
      className="grid gap-1 py-2"
      style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>{name}</span>
        <span data-testid={`${testId}-status`} style={{ ...CELL, color: TONE[status.tone], fontWeight: 600 }}>
          {status.words}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5" style={{ margin: 0 }}>
        <dt style={DT}>Last read</dt>
        <dd style={{ ...CELL, margin: 0 }}>{lastRead}</dd>
        <dt style={DT}>Last letter stored</dt>
        <dd style={{ ...CELL, margin: 0 }}>{lastStored}</dd>
      </dl>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 style={LABEL}>{title}</h3>
      {children}
    </section>
  );
}

export function IntakeHealthSheet({
  open,
  onClose,
  summary,
  summaryFailed,
  reader,
  readerFailed,
  sender,
  senderFailed,
  conversationWords,
  now,
}: {
  open: boolean;
  onClose: () => void;
  summary: MailSummary | null;
  summaryFailed: boolean;
  reader: MailboxReader | null;
  readerFailed: boolean;
  /** The sender read; null while it is read or when it failed (`senderFailed`). */
  sender: SenderLineInput | null;
  senderFailed: boolean;
  conversationWords: string | null;
  now: number;
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const house = houseMailboxStatus(reader, { readFailed: readerFailed, now });
  const unrecorded = unrecordedDoorStatus();
  const known = summary !== null;
  const lastRead =
    reader?.lastReadAt && reader.granted === true ? lastStoredWords(reader.lastReadAt, true, now) : EM;
  const address = summary?.address ?? null;

  const copyAddress = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detents={FULL}
      label="How mail reaches the house"
      eyebrow="Mail"
      title="How mail reaches the house"
    >
      {/* The primitive's body has no inset of its own; 16px matches its header. */}
      <div className="grid gap-5" style={{ fontFamily: SANS, padding: '4px 16px 24px' }}>
        {summaryFailed && !known && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--alarm-deep, #8C3322)' }}>
            When the last letters came could not be read, so they show {EM}. That does not mean nothing arrived.
          </p>
        )}
        <Section title="Where mail comes in">
          <Door
            testId="door-house-mailbox"
            name="Your mailbox"
            status={house}
            lastRead={lastRead}
            lastStored={lastStoredWords(summary?.doors.houseMailbox.lastStoredAt, known, now)}
          />
          <Door
            testId="door-mudavym"
            name="Mudavym's mailbox and your Mudavym address"
            status={unrecorded}
            lastRead={`${EM} not recorded yet`}
            lastStored={lastStoredWords(summary?.doors.mudavymMail.lastStoredAt, known, now)}
          />
          <Door
            testId="door-whatsapp"
            name="WhatsApp"
            status={unrecorded}
            lastRead={`${EM} not recorded yet`}
            lastStored={lastStoredWords(summary?.doors.whatsapp.lastStoredAt, known, now)}
          />
          <p data-testid="held-at-door" style={{ ...CELL, margin: '6px 0 0' }}>
            Letters held before reaching the house: {summary?.heldAtDoor == null ? `${EM} not recorded yet.` : summary.heldAtDoor}
          </p>
        </Section>

        <Section title="Which address letters leave from">
          <p style={{ ...CELL, margin: 0 }} data-testid="sender-address">
            {senderLine(sender, { failed: senderFailed })}
          </p>
          {conversationWords && (
            <p style={{ ...CELL, margin: '4px 0 0' }} data-testid="conversation-words">
              {conversationWords}
            </p>
          )}
        </Section>

        <Section title="Your Mudavym address">
          {!address ? (
            <p style={{ ...CELL, margin: 0 }} data-testid="mudavym-address">
              {summaryFailed ? `${EM} The house's Mudavym address could not be read.` : `${EM} Reading…`}
            </p>
          ) : !address.configured ? (
            <p style={{ ...CELL, margin: 0 }} data-testid="mudavym-address">
              No Mudavym address yet: Mudavym cannot receive mail for houses yet, so there is no address to give vendors.
            </p>
          ) : !address.address ? (
            <p style={{ ...CELL, margin: 0 }} data-testid="mudavym-address">
              No Mudavym address has been made for this house yet.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2" data-testid="mudavym-address">
              <code style={{ fontFamily: MONO, fontSize: 12, color: 'var(--ink-1, #211C16)', overflowWrap: 'anywhere' }}>
                {address.address}
              </code>
              <button
                type="button"
                onClick={() => void copyAddress(address.address as string)}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                  background: 'transparent',
                  color: 'var(--seal-deep, #14515C)',
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
              {copy !== 'idle' && (
                <span role="status" style={{ fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                  {copy === 'copied' ? 'Copied.' : 'It could not be copied; select it and copy it by hand.'}
                </span>
              )}
              <p style={{ ...CELL, flexBasis: '100%', margin: 0 }}>
                A vendor who writes to this address reaches this house.
              </p>
            </div>
          )}
        </Section>
      </div>
    </Sheet>
  );
}
