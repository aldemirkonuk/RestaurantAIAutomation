/**
 * Register 14 — What changed here.
 *
 * For two passes this page opened by admitting it could not answer its own most
 * important question: *"Nothing here records who changed a setting — no table
 * on this page carries an author column."* That sentence was true of the
 * settings tables and false of the database. `public.system_audit_log` has
 * existed since the baseline (20260805000000:5553-5568) with `actor_type`,
 * `actor_id`, `action`, `entity_type`, `entity_id`, `changes jsonb`,
 * `restaurant_id` and `created_at`; `recordAccessChange`
 * (`apps/api-gateway/src/team/access-audit.ts:81`) has been filing role changes
 * and removals into it since ADR 0088; the /logs timeline already reads it.
 * Settings simply never called it.
 *
 * So this register is not a new table and not a migration. It is the caller
 * settings never had (`apps/api-gateway/src/settings-audit/`), wired into the
 * three writes this page owns, plus one read route.
 *
 * TWO HONESTY RULES IT LIVES BY.
 *
 * 1. **An empty list is not a quiet house.** Recording began on the day this
 *    shipped; everything before it left no row anywhere and never will. The
 *    register says so above the list rather than letting a reader conclude
 *    nobody has ever changed anything.
 * 2. **An unreadable log is not an empty one.** `readable: false` renders as a
 *    sentence naming the failure, with a Try again — the same four states every
 *    other register on this page has.
 *
 * WHAT IT CANNOT DO, SAID PLAINLY: it covers the registers whose writes go
 * through the modules this pass owns — Features, Vendor terms, Approval
 * thresholds — plus the two team-access actions that already filed. The other
 * eight registers write through services this pass was not cleared to edit, and
 * the footer names them rather than letting their silence read as "nothing
 * changed there".
 */

import { AlertTriangle } from 'lucide-react';
import { Micro, Note, Register } from './SectionKit';
import { EM, MONO, SANS, SERIF, fmtExact, fmtWhen } from './st-format';
import type { LedgerEntry, LedgerRegister, SettingsNextData } from './useSettingsNextData';

/** Registers whose writes do NOT reach this log yet, and where they go instead. */
const NOT_YET_FILED: Array<{ id: string; label: string; hint: string }> = [
  { id: 'email', label: 'Email sign-off', hint: 'restaurant-templates.service.ts' },
  { id: 'notifications', label: 'Notifications', hint: 'notifications.service.ts' },
  { id: 'locations', label: 'Locations & chains', hint: 'organizations.service.ts' },
  { id: 'map', label: 'Map', hint: 'user-preferences.service.ts' },
  { id: 'services', label: 'Services & permissions', hint: 'user-preferences.service.ts' },
  { id: 'pos', label: 'Point of sale', hint: 'user-preferences.service.ts' },
  { id: 'calendar', label: 'Calendar subscription', hint: 'calendar ical-token route' },
  { id: 'cellar', label: 'Cellar registers', hint: 'cellar-registers.service.ts' },
];

/** Actions whose consequence deserves the seal-tinted band. */
const GRAVE = new Set(['team_member_removed']);

function isGrave(entry: LedgerEntry): boolean {
  if (GRAVE.has(entry.action)) return true;
  // Granting autonomous sending is the one settings change that can put an
  // unread email in front of a vendor. It reads differently from a unit change.
  return Boolean(
    entry.fields.enable_ai_autonomous_send &&
      entry.fields.enable_ai_autonomous_send.to === true,
  );
}

function readable(value: unknown): string {
  if (value === null || value === undefined) return EM;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** "Anadolu Şarapçılık order cutoff" — what the row is about, in a phrase. */
function headline(entry: LedgerEntry): string {
  if (entry.action === 'member_role_changed') return 'A person’s role';
  if (entry.action === 'team_member_removed') return 'A person’s access, withdrawn';
  if (entry.action === 'vendor_terms_changed') {
    return entry.subject ? `${entry.subject} — terms` : 'Vendor terms';
  }
  if (entry.action === 'approval_threshold_changed') {
    return entry.subject ? `Approval rule: ${entry.subject}` : 'An approval rule';
  }
  if (entry.action === 'feature_flag_changed') {
    return entry.subject ? `Feature: ${entry.subject}` : 'A feature switch';
  }
  return entry.action.replace(/_/g, ' ');
}

function Entry({ entry }: { entry: LedgerEntry }) {
  const grave = isGrave(entry);
  const fields = Object.entries(entry.fields);
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(96px, auto) minmax(0, 1fr)',
        gap: '2px 16px',
        padding: '11px 12px 11px 10px',
        borderTop: '1px solid var(--paper-2)',
        background: grave ? 'var(--seal-tint)' : undefined,
        borderRadius: grave ? 8 : undefined,
      }}
    >
      <span
        style={{
          fontFamily: MONO, fontSize: 11, color: 'var(--ink-3)',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}
        title={fmtExact(entry.occurredAt)}
      >
        {entry.occurredAt ? fmtWhen(entry.occurredAt) : EM}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', margin: 0 }}>
          {grave && (
            <AlertTriangle
              size={12}
              aria-hidden
              style={{ color: 'var(--seal-deep)', marginRight: 5, verticalAlign: '-1px' }}
            />
          )}
          {headline(entry)}
        </p>
        <p style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)', margin: '2px 0 0' }}>
          {entry.actor.name ??
            entry.actor.email ??
            (entry.actor.userId
              ? 'an account that can no longer be named'
              : 'nobody was recorded')}
        </p>
        {fields.length === 0 ? (
          <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '3px 0 0' }}>
            {EM} the row carries no before-and-after, so what moved is not recorded.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'grid', gap: 2 }}>
            {fields.map(([key, change]) => (
              <li
                key={key}
                style={{
                  fontFamily: MONO, fontSize: 11.5, color: 'var(--ink-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <span style={{ color: 'var(--ink-3)' }}>{key}</span>{' '}
                <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>
                  {readable(change.from)}
                </span>{' '}
                <span aria-hidden style={{ opacity: 0.5 }}>→</span>{' '}
                <span style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{readable(change.to)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function LedgerSection({ data }: { data: SettingsNextData }) {
  return (
    <Register<LedgerRegister> remote={data.ledger} name="the settings record">
      {(reg) => (
        <div>
          {!reg.readable ? (
            <p
              role="alert"
              style={{
                fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-1)',
                background: 'var(--paper-2)', borderRadius: 8, padding: '9px 12px', margin: '0 0 12px',
              }}
            >
              The record could not be read — {reg.reason}. Nothing below is
              claimed; this is not a house where nothing has changed.
            </p>
          ) : (
            <Note>
              Every line here ends at a person. The register is written on the way
              through — a change to a feature switch, a vendor&rsquo;s terms or an
              approval rule files a row as it is saved — and nothing on this page
              can edit or delete one, including the person who made it.
            </Note>
          )}

          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '0 0 12px' }}>
            Settings changes began being recorded on{' '}
            <strong>{reg.recordingSince}</strong>. Anything changed before that
            left no row anywhere and cannot be recovered — an empty list here is
            not evidence that nobody changed anything.
          </p>

          {reg.readable && (
            <Micro tone="seal">
              {reg.entries.length === 0
                ? 'No change recorded yet'
                : `${reg.entries.length} change${reg.entries.length === 1 ? '' : 's'}${
                    reg.oldestAt ? ` · oldest ${fmtWhen(reg.oldestAt)}` : ''
                  }`}
            </Micro>
          )}

          {reg.readable && reg.entries.length === 0 ? (
            <Note role="status">
              Nothing has been changed on this restaurant since recording began.
              The log itself answered; it is empty, not unreadable.
            </Note>
          ) : (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
              {reg.entries.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
            </ul>
          )}

          <div style={{ borderTop: '1px solid var(--paper-2)', marginTop: 18, paddingTop: 12 }}>
            <Micro>What this record does not yet cover</Micro>
            <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-2)', margin: '5px 0 0', maxWidth: 720 }}>
              Eight registers write through services this pass did not touch, so
              a change made in one of them files no row and its silence here means
              nothing. Each needs the same two lines the three above got: read the
              row before the write, then call the recorder.
            </p>
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
              {NOT_YET_FILED.map((r) => (
                <li key={r.id} style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {r.label}{' '}
                  <span style={{ fontFamily: MONO, fontSize: 10, opacity: 0.8 }}>{r.hint}</span>
                </li>
              ))}
            </ul>
          </div>

          <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)', margin: '14px 0 0', maxWidth: 720 }}>
            The provenance line under every setting on this page ends at a date.
            This is the one that ends at a name.
          </p>
        </div>
      )}
    </Register>
  );
}

export default LedgerSection;
