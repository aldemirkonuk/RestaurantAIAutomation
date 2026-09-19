/**
 * "Should it mail a recommendations digest?" — sketch 109A, section IV.
 * ADR 0149 row 26 ("build the digest sender").
 *
 * `recommendation_digest_prefs` is one row per RESTAURANT — a house-wide hour,
 * urgency floor and ONE recipient email, not a per-person schedule and not a
 * weekday. Neither exists in the table (`baseline_from_production.sql:4935`)
 * or the route (`analytics.controller.ts:1143`) as of 2026-09-17 — see the
 * settings-build note's not_fixed list for the exact founder question.
 *
 * [Corrected 2026-09-19, kept in place rather than rewritten — see settings.md
 * §13.39 for the full evidence chain:] the "exact founder question" above is
 * NOT "does per-person still need building" — it already exists, in
 * `recommendation_digest_subscriptions` (open PR #391, `train/finish-2`), whose
 * sender (`recommendation-digest.service.ts:112-113`) never reads this row's
 * `recipient_email`. ~~This component's control will silently stop mattering
 * once that PR merges.~~ See settings.md's corrected §13.39 for the real open
 * question (cross-lane sequencing, not table design).
 *
 * [Corrected 2026-09-19, later pass — the sentence struck above was itself
 * wrong, kept rather than deleted (no-silent-rewrite rule): the founder
 * settled this directly ("Lane answers batch 2", ~09:30Z,
 * `founder-sketch-decisions-106-115.md:133`): "settings digest = correct the
 * dossier to the per-house control that shipped." The per-house control this
 * file edits (`digest_enabled`/`digest_hour`/`digest_min_urgency` on
 * `recommendation_digest_prefs`) IS the shipped, decided design. Verified
 * directly against `origin/train/finish-2` (not copied forward): #391's own
 * `readHousePref` (`recommendation-digest.service.ts:607`) selects exactly
 * `"restaurant_id, digest_enabled, digest_hour, digest_min_urgency,
 * updated_at"` (:612) — the same three columns this row edits — so the
 * control does not "stop mattering" once #391 merges; the house half of
 * #391's design IS this row. The one real residual is narrower: #391 never
 * mails `recipientEmail` (:112, "It never mails
 * `recommendation_digest_prefs.recipient_email`. That column is a free
 * address…"). Founder's follow-up ("Lane answers batch 4", ~10:00Z,
 * `founder-sketch-decisions-106-115.md:161`): drop the free `recipientEmail`
 * field WHEN #391 lands, and add a per-person "send me the digest" opt-in on
 * Settings. #391 is not yet on `main` (checked 2026-09-19: `train/finish-2`
 * is not an ancestor of `origin/main`), so this file is not changed to build
 * against its unmerged `recommendation_digest_subscriptions` table — tracked
 * as a named follow-up in settings.md §13.39's open items.]
 *
 * `stated` (added to the gateway by this pass, `recommendation-actions.
 * service.ts#getDigestPref`) is what makes the empty-controls state real
 * rather than assumed: without it, every never-written house would read back
 * `digestHour: 7, digestMinUrgency: "this_week"` — the service's OWN stored
 * defaults — and this row would show them as if a person had chosen them.
 */

import { useState } from 'react';
import { Action, Row } from './SectionKit';
import { EM, MONO, SANS } from './st-format';
import { digestCert } from './certaintyTally';
import type { SettingsNextData } from './useSettingsNextData';

const URGENCY_OPTIONS: Array<{ value: 'now' | 'this_week' | 'this_month'; label: string }> = [
  { value: 'now', label: 'only what is due now' },
  { value: 'this_week', label: 'this week or sooner' },
  { value: 'this_month', label: 'this month or sooner' },
];

export function DigestRow({ data }: { data: SettingsNextData }) {
  const { digest, saveDigest, writer, canManage } = data;
  const [hour, setHour] = useState('');
  const [urgency, setUrgency] = useState<'now' | 'this_week' | 'this_month' | ''>('');
  const [email, setEmail] = useState('');
  // Single source for every branch below (including the tally's own count —
  // `certaintyTally.ts`'s `digestCert` mirrors this component exactly, rather
  // than the other way around, so the two can never disagree).
  const cert = digestCert(digest);

  if (digest.status === 'idle' || digest.status === 'loading') {
    return (
      <Row
        label="Should it mail a recommendations digest?"
        cert={cert}
        consequence="Opening the digest register…"
      />
    );
  }
  if (digest.status === 'denied') {
    return (
      <Row
        label="Should it mail a recommendations digest?"
        cert={cert}
        consequence="Your role may not read this house's digest preference. Nothing below is claimed for it."
      />
    );
  }
  if (digest.status === 'error' || digest.data === null) {
    return (
      <Row
        label="Should it mail a recommendations digest?"
        cert={cert}
        consequence={
          <>
            Could not be read — {digest.error ?? 'unknown error'}. Not the same as unstated: this is a failed read.{' '}
            <button type="button" onClick={digest.reload} style={{ font: 'inherit', color: 'var(--seal-deep)', background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              Try again
            </button>
          </>
        }
      />
    );
  }

  const reg = digest.data;
  const answered = reg.stated;
  const canRecord = canManage && !answered ? hour.trim() !== '' && urgency !== '' && email.trim() !== '' : true;

  const record = () =>
    void saveDigest({
      digestEnabled: true,
      digestHour: Number(hour),
      digestMinUrgency: urgency as 'now' | 'this_week' | 'this_month',
      recipientEmail: email.trim(),
    });

  return (
    <Row
      label="Should it mail a recommendations digest?"
      cert={cert}
      provenance={{
        kept: 'restaurant',
        when: answered ? reg.lastSentAt : null,
        whenUnknown: 'never written',
        verb: 'last sent',
        readBy: (
          <>
            <code style={{ fontFamily: MONO }}>analytics/insights-scheduler</code> — feature-flagged, not yet
            scheduled by house (<code style={{ fontFamily: MONO }}>analytics.controller.ts:1143-1178</code>)
          </>
        ),
      }}
      consequence={
        answered
          ? `${reg.digestEnabled ? 'Yes' : 'Off'} · ${String(reg.digestHour).padStart(2, '0')}:00 · ${
              URGENCY_OPTIONS.find((o) => o.value === reg.digestMinUrgency)?.label ?? reg.digestMinUrgency
            } · to ${reg.recipientEmail ?? EM}`
          : 'The sender exists as of this pass. Off until someone answers: the hour, the least urgency worth a mail, and to whom. A stored default is not an answer.'
      }
      control={
        canManage ? (
          answered ? (
            <Action
              onClick={() => void saveDigest({ digestEnabled: !reg.digestEnabled })}
              disabled={writer.busy === 'digest'}
            >
              {writer.busy === 'digest' ? 'Working…' : reg.digestEnabled ? 'Turn off' : 'Turn on'}
            </Action>
          ) : (
            <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input
                aria-label="Digest hour (0-23)"
                placeholder="hour"
                inputMode="numeric"
                value={hour}
                onChange={(ev) => setHour(ev.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)', width: 56 }}
              />
              <select
                aria-label="Least urgency worth a mail"
                value={urgency}
                onChange={(ev) => setUrgency(ev.target.value as typeof urgency)}
                style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
              >
                <option value="" disabled>Choose the least urgency…</option>
                {URGENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                aria-label="Recipient email"
                placeholder="to whom"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)', width: 140 }}
              />
              <Action onClick={record} disabled={!canRecord || writer.busy === 'digest'}>
                {writer.busy === 'digest' ? 'Recording…' : 'Record'}
              </Action>
            </span>
          )
        ) : undefined
      }
    >
      {writer.failed?.key === 'digest' && (
        <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '6px 9px', margin: '6px 0 0' }}>
          That did not go through — {writer.failed.message}.
        </p>
      )}
    </Row>
  );
}
