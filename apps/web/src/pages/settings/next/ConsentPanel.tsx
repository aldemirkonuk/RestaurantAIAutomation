/**
 * The consent panel — real switches only (ADR 0134 fork 14; ADR 0222).
 *
 * THE FOUNDER, 2026-09-21, round 6r, his pick verbatim: **"Bring back, real
 * switches (Recommended)"**. As ADR 0134 recorded it: the panel comes back,
 * opened from the rebuilt `/settings`, and holds ONLY switches the product
 * actually reads — the per-house ask-training opt-out, Jev scoring on or off,
 * and any legacy consent once something is wired to read it. Owner only; every
 * flip audited. This supersedes ADR 0149 row 14 ("delete the consent panel"),
 * which deleted a panel of four switches nothing read.
 *
 * WHAT IT HOLDS ON THIS BUILD, MEASURED 2026-09-25 AT origin/main
 * ---------------------------------------------------------------
 *   - **Questions and training** — `ask_training_opt_outs`, read by the
 *     training export (`ask_folio_training_export`), written through
 *     `PUT /settings/ask-training` (owner only, audited
 *     `ask_training_opt_out_changed`). The switch is `AskTrainingSection`
 *     itself, not a copy: one component, so the panel and the page cannot
 *     disagree about what the switch means or who may flip it.
 *   - **Not Jev.** The owner's acceptance that turns vendor tone scoring on is
 *     ADR 0207's, on an unmerged branch; nothing on this build reads a Jev
 *     switch, so there is none to draw. It joins `CONSENT_SWITCHES` when its
 *     store lands — one entry, no new surface.
 *   - **Not the four legacy consents** (email access, web access, product
 *     analytics, partner sharing): nothing reads them.
 *
 * WHERE THE SWITCHES PERSIST IS AN OPEN QUESTION (ADR 0222 fork 3). As built,
 * each switch keeps its own store — the one its reader already reads — and
 * this panel only gathers them. It adds no table.
 *
 * "EVERY FLIP AUDITED", SHOWN. Each switch carries its own trail, read from
 * `GET /settings-audit?register=<its register>` — the same system_audit_log
 * rows "What changed here" reads, filtered to this one switch. An unreadable
 * trail says so; it is never drawn as "never changed".
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { AskTrainingSection } from './AskTrainingSection';
import { Action, Micro, Note } from './SectionKit';
import { EM, MONO, SANS, SERIF, fmtWhen } from './st-format';
import type { LedgerEntry, LedgerRegister, SettingsNextData } from './useSettingsNextData';

export interface ConsentSwitchSpec {
  key: string;
  title: string;
  /** The settings-audit register its flips are filed under. */
  register: string;
  /** One flip, in words. */
  describe: (entry: LedgerEntry) => string;
  render: (data: SettingsNextData) => ReactNode;
}

function who(entry: LedgerEntry): string {
  return entry.actor.name ?? entry.actor.email ?? 'Someone the trail cannot name';
}

/** The switches the product reads. Nothing is listed here that nothing reads. */
export const CONSENT_SWITCHES: ConsentSwitchSpec[] = [
  {
    key: 'ask-training',
    title: 'Questions and training',
    register: 'ask-training',
    describe: (e) => {
      const to = e.fields?.ask_training_opted_out?.to;
      const word = to === true ? 'turned it off' : to === false ? 'turned it on' : 'changed it';
      return `${who(e)} ${word}`;
    },
    render: (data) => <AskTrainingSection data={data} />,
  },
];

/** What is deliberately not a switch here, and why — stated, not hidden. */
export const NOT_SWITCHES: { title: string; why: string }[] = [
  {
    title: 'Vendor tone scoring',
    why: 'Turned on by the owner accepting the data and privacy terms, which is not built yet. It joins this panel when it is.',
  },
  {
    title: 'Email access, web access, product analytics, partner sharing',
    why: 'Four consents an older page asked for. Nothing in Mudavym reads any of them, so a switch would promise something it could not keep.',
  },
];

const TRAIL_ROWS = 10;

async function readTrail(register: string): Promise<LedgerRegister> {
  const { data } = await apiClient.get<LedgerRegister>(
    `/settings-audit?register=${encodeURIComponent(register)}&limit=${TRAIL_ROWS}`,
  );
  return data;
}

export function ConsentTrail({ spec }: { spec: ConsentSwitchSpec }) {
  const q = useQuery({ queryKey: ['consent-trail', spec.register], queryFn: () => readTrail(spec.register), retry: false });
  const line: CSSProperties = { fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '4px 0 0' };

  if (q.isPending) return <p style={line}>Reading who changed it…</p>;
  if (q.isError || !q.data || !q.data.readable) {
    const why = q.isError ? getErrorMessage(q.error) : (q.data?.reason ?? 'no reason was given');
    return (
      <p role="alert" style={line}>
        Who changed it could not be read — {why}. This is not the same as nobody having changed it.
      </p>
    );
  }
  const { entries, recordingSince } = q.data;
  if (entries.length === 0) {
    return (
      <p style={line}>
        Nobody has changed it since changes started being recorded on {recordingSince}.
      </p>
    );
  }
  return (
    <ol aria-label={`Changes to ${spec.title}`} style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
      {entries.map((e) => (
        <li key={e.id} style={{ ...line, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--ink-4)', minWidth: 96 }}>
            {e.occurredAt ? fmtWhen(e.occurredAt) : EM}
          </span>
          <span>{spec.describe(e)}</span>
        </li>
      ))}
    </ol>
  );
}

export function ConsentPanel({ data, open, onClose }: { data: SettingsNextData; open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="What this house has agreed to"
      eyebrow="Consents"
      title="What this house has agreed to"
      footer={<span>Only the house’s owner can change these. Every change is written to the trail under its switch.</span>}
    >
      <Note>
        Every switch here is one Mudavym actually reads. A consent nothing reads is not shown as a switch, because
        turning it on or off would change nothing.
      </Note>

      {CONSENT_SWITCHES.map((spec) => (
        <section key={spec.key} data-testid={`consent-${spec.key}`} style={{ margin: '18px 0 0' }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>{spec.title}</h3>
          {spec.render(data)}
          <div style={{ margin: '10px 0 0' }}>
            <Micro>Who changed it</Micro>
            <ConsentTrail spec={spec} />
          </div>
        </section>
      ))}

      <section style={{ margin: '24px 0 0' }}>
        <Micro>Not switches here, and why</Micro>
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
          {NOT_SWITCHES.map((n) => (
            <li key={n.title} style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', margin: '0 0 8px' }}>
              <strong style={{ fontWeight: 600 }}>{n.title}.</strong> {n.why}
            </li>
          ))}
        </ul>
      </section>
    </Sheet>
  );
}

/**
 * The one way in from `/settings`. The panel is mounted only while open, so
 * its trail reads cost nothing until someone asks for them.
 */
export function ConsentPanelOpener({ data }: { data: SettingsNextData }) {
  const [open, setOpen] = useState(false);
  const count = CONSENT_SWITCHES.length;
  return (
    <div data-testid="consent-panel-opener" style={{ margin: '14px 0 0', display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <Action onClick={() => setOpen(true)}>Open the consent panel</Action>
      <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
        {count === 1 ? 'One consent this house gives' : `${count} consents this house gives`}, with who changed
        {count === 1 ? ' it' : ' each'} and when.
      </span>
      {open && <ConsentPanel data={data} open onClose={() => setOpen(false)} />}
    </div>
  );
}

export default ConsentPanel;
