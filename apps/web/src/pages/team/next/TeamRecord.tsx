/**
 * What this desk is configured to do, and who last touched it.
 *
 * THE THREE CHEAP HONESTY PIECES the `/settings` builder proposed for `/team`
 * (page note §13.5), built here because all three cost nothing and need no data
 * a house has to produce first:
 *
 * 1. **Every stated value is a RECORD.** It says what it does, where it is
 *    kept, and when it was last written — or an em dash naming the column that
 *    was checked. `team_settings` carries `updated_at` and NO author column
 *    (baseline `:5653-5658`), so every line here has a date and no name, and
 *    says so rather than leaving the reader to assume one.
 * 2. **The labour target is read against its column default.**
 *    `labor_target_pct` is `numeric(5,2) DEFAULT 28 NOT NULL` (baseline
 *    `:5656`) — exactly the shape of `providers.lead_time_days DEFAULT 7` that
 *    the vendor-terms register exists to catch. A stored 28 with no provenance
 *    is NOT a target: the first house to toggle `wage_visible` acquires it
 *    without choosing it, and nothing on the page could tell that apart from a
 *    target somebody set. It renders as unknown, with the default named, and
 *    the week is never measured against it. The migration that drops the
 *    column default is not this branch's — §13.
 * 3. **The trail ends at a name.** `recordAccessChange`
 *    (`apps/api-gateway/src/team/access-audit.ts:73`) already files
 *    `member_role_changed` and `team_member_removed` into `system_audit_log`,
 *    and `GET /settings-audit` already reads both back
 *    (`settings-audit.service.ts:80-84`). So the trail is one existing route
 *    and no new table — the reader is reused, not forked.
 *
 * WHAT IS STILL MISSING, AND IT IS NAMED ON SCREEN: nothing files an audit row
 * when a labour setting or a coverage rule changes, so those two lines can show
 * a date and never an author. §13 carries the `record()` calls that would close
 * it.
 */

import { useMemo } from 'react';
import { Sheet } from '@/components/mudavym';
import { EM, LE, fmtDayShort, resolveName } from './tm-format';
import { Alert } from './tm-bits';
import {
  LABOR_TARGET_COLUMN_DEFAULT,
  TEAM_SERVER_WINDOWS,
  TEAM_TRAIL_ACTIONS,
  type TargetReading,
  type TeamTrail,
} from './useTeamNextData';
import type { TeamMember } from '../../../services/api/team';

/** Relative time, the way `/settings` says it. */
function fmtWhen(iso: string | null): string {
  if (!iso) return EM;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return EM;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? 'yesterday' : `${d} days ago`;
  return fmtDayShort(iso.slice(0, 10));
}

/**
 * The line under a stated value. `kept` names the table, `when` the write, and
 * `whoUnknown` the reason there is no author — required, never left blank,
 * because a provenance line with a silent gap is the gap this pattern exists
 * to close.
 */
function Provenance({
  kept,
  when,
  whenUnknown,
  whoUnknown,
}: {
  kept: string;
  when: string | null;
  whenUnknown?: string;
  whoUnknown: string;
}) {
  return (
    <p
      className="tm-fact__k"
      style={{ marginTop: 5, letterSpacing: '0.1em', fontWeight: 500, textTransform: 'none' }}
    >
      kept · {kept}
      <span aria-hidden style={{ opacity: 0.45 }}> — </span>
      written · {when ? fmtWhen(when) : `${EM} ${whenUnknown ?? 'no date is recorded'}`}
      <span aria-hidden style={{ opacity: 0.45 }}> — </span>
      by · {EM} {whoUnknown}
    </p>
  );
}

function Record({
  label,
  value,
  consequence,
  provenance,
}: {
  label: string;
  value: string;
  consequence: string;
  provenance: React.ReactNode;
}) {
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--paper-2)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', flex: 1 }}>
          {label}
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--tm-mono)',
            fontSize: 12.5,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-1)',
          }}
        >
          {value}
        </p>
      </div>
      <p className="tm-note" style={{ fontSize: 12, marginTop: 3 }}>
        {consequence}
      </p>
      {provenance}
    </div>
  );
}

export function TeamRecordSection({
  labourEnabled,
  wageVisible,
  target,
  settingsUpdatedAt,
  settingsConfigured,
  coverageRuleCount,
  certsOnFile,
  onOpenTrail,
}: {
  /** `null` when the week has not answered. */
  labourEnabled: boolean | null;
  wageVisible: boolean;
  target: TargetReading;
  settingsUpdatedAt: string | null;
  settingsConfigured: boolean;
  coverageRuleCount: number | null;
  certsOnFile: number | null;
  onOpenTrail: () => void;
}) {
  const whenUnknown = settingsConfigured
    ? 'the settings row has no changed-at value'
    : 'no team_settings row exists, so these are the code defaults and nothing was written';
  const writtenAt = settingsConfigured ? settingsUpdatedAt : null;

  return (
    <section className="tm-panel" aria-label="How this desk is configured">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <h2 className="tm-panel__title">How this desk is configured</h2>
        <button type="button" className="tm-ctl tm-ctl--quiet tm-ctl--sm" onClick={onOpenTrail}>
          What changed here
        </button>
      </div>

      <Record
        label="Labour tracking"
        value={labourEnabled === null ? EM : labourEnabled ? 'on' : 'off'}
        consequence="When it is off no cost is computed for any shift, and the week's labour figure is held back rather than printed as nothing."
        provenance={
          <Provenance
            kept="this restaurant, in team_settings"
            when={writtenAt}
            whenUnknown={whenUnknown}
            whoUnknown="team_settings has no author column"
          />
        }
      />

      <Record
        label="Wages visible"
        value={wageVisible ? 'yes' : 'no'}
        consequence="When wages are hidden the gateway blanks hourly_wage on every roster row before it leaves the server, so this page could not show one even if it wanted to."
        provenance={
          <Provenance
            kept="this restaurant, in team_settings"
            when={writtenAt}
            whenUnknown={whenUnknown}
            whoUnknown="team_settings has no author column"
          />
        }
      />

      <Record
        label="Labour target"
        value={target.pct === null ? EM : `${target.pct}%`}
        consequence={target.why}
        provenance={
          <Provenance
            kept="this restaurant, in team_settings.labor_target_pct"
            when={target.pct === null ? null : writtenAt}
            whenUnknown={
              target.pct === null
                ? `the stored value cannot be told apart from the column default of ${LABOR_TARGET_COLUMN_DEFAULT}`
                : whenUnknown
            }
            whoUnknown="nothing files an audit row when a labour setting changes"
          />
        }
      />

      <Record
        label="Coverage rules"
        value={coverageRuleCount === null ? EM : String(coverageRuleCount)}
        consequence="Each rule is a role, a day and a number of people the week is measured against. With none on file nothing has ever been required, so a week showing no gaps is an idle engine rather than a staffed house."
        provenance={
          <Provenance
            kept="this restaurant, in coverage_templates"
            when={null}
            whenUnknown="coverage_templates has no changed-at column"
            whoUnknown="nothing files an audit row when a coverage rule changes"
          />
        }
      />

      <Record
        label="Credentials on file"
        value={certsOnFile === null ? EM : String(certsOnFile)}
        consequence="A certification carries no role and no applies-to column, so nothing in the data connects a credential to a shift. The page can say who has lapsed and how much of their week is at stake, and no more than that."
        provenance={
          <Provenance
            kept="this restaurant, in team_certifications"
            when={null}
            whenUnknown="the credential rows carry issued_at and expires_at, not a changed-at"
            whoUnknown="nothing files an audit row when a credential changes"
          />
        }
      />
    </section>
  );
}

/* ── the trail ───────────────────────────────────────────────────────────── */

function describe(action: string): string {
  if (action === 'member_role_changed') return 'changed what someone may do';
  if (action === 'team_member_removed') return 'removed someone from the team';
  return action.replace(/_/g, ' ');
}

export function TrailSheet({
  trail,
  failed,
  members,
  onClose,
}: {
  trail: TeamTrail | null;
  failed: boolean;
  members: TeamMember[] | null;
  onClose: () => void;
}) {
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of members ?? []) if (x.user_id) m.set(x.user_id, resolveName(x).text);
    return m;
  }, [members]);

  const rows = (trail?.entries ?? []).filter((e) =>
    (TEAM_TRAIL_ACTIONS as readonly string[]).includes(e.action),
  );

  return (
    <Sheet
      open
      onClose={onClose}
      label="What changed here"
      eyebrow="The record"
      title="What changed here"
      footer={
        <span>
          The last {LE}
          {TEAM_SERVER_WINDOWS.TRAIL_ROWS} changes on this restaurant, from the same trail
          `/settings` reads, filtered to the two actions that are about people. A ceiling,
          not a total: the route caps the read and offers no count of what is behind it.
          There is no write route and no delete route — a log a manager can edit is not a
          log.
        </span>
      }
    >
      <div className="tm-in" style={{ padding: '12px 16px 16px' }}>
        {failed || (trail !== null && !trail.readable) ? (
          <Alert>
            The record could not be read
            {trail?.reason ? ` (${trail.reason})` : ''}, so what changed here is unknown —
            not nothing.
          </Alert>
        ) : trail === null ? (
          <p className="tm-quiet">Reaching the gateway…</p>
        ) : rows.length === 0 ? (
          <>
            <p className="tm-note">
              Nothing about this team has been recorded
              {trail.oldestAt ? ` since ${fmtDayShort(trail.oldestAt.slice(0, 10))}` : ''}.
            </p>
            <p className="tm-hint">
              Recording began on {fmtDayShort(trail.recordingSince)}. Anything done before
              that left no row anywhere and cannot be recovered, so an empty list here
              means &quot;nothing since then&quot;, never &quot;nobody ever changed
              anything&quot;.
            </p>
          </>
        ) : (
          <>
            {rows.map((e) => (
              <div key={e.id} style={{ padding: '9px 0', borderTop: '1px solid var(--paper-2)' }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-1)' }}>
                  {e.actor.name ??
                    (e.actor.userId ? (nameOf.get(e.actor.userId) ?? null) : null) ??
                    e.actor.email ??
                    `${EM} the actor is not named on this row`}{' '}
                  {describe(e.action)}
                  {e.subject ? ` — ${e.subject}` : ''}
                </p>
                <p className="tm-fact__k" style={{ textTransform: 'none', letterSpacing: '0.1em' }}>
                  {fmtWhen(e.occurredAt)}
                  {Object.entries(e.fields).map(([field, change]) => (
                    <span key={field}>
                      {' · '}
                      {field}: {String(change.from ?? EM)} → {String(change.to ?? EM)}
                    </span>
                  ))}
                </p>
              </div>
            ))}
            <p className="tm-hint">
              Recording began on {fmtDayShort(trail.recordingSince)}. Labour settings and
              coverage rules file nothing yet, so a change to either is real and absent
              from this list.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
