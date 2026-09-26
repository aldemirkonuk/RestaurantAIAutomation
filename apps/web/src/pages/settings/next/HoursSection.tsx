/**
 * When is this house open? — sketch 109A's graft B, ADR 0149 row 22.
 *
 * The operating-hours editor has had a real GET/PUT since ADR 0093 D1
 * (`restaurants/:id/operating-hours`), but its only Mudavym-era home was the
 * legacy `components/settings/OperatingHoursSection.tsx` — this register did
 * not exist anywhere in `settings/next/`. This ports that component's real
 * behaviour rather than re-deriving it: the same client
 * (`services/api/restaurants.ts`), the same four states kept visibly apart
 * (loading · failed · not set · closed all week), and the same rule that
 * clearing the hours or opening the "set hours" editor never becomes a save
 * by itself — only a deliberate Save does.
 *
 * What direction A drew and this build does NOT have: the hours-from-till
 * proposal (median first/last `pos_checks` check per weekday). That is a new
 * read-time computation with no endpoint anywhere in the gateway (grepped
 * 2026-09-17 — no file under `apps/api-gateway/src` reads `pos_checks` for
 * anything hours-shaped), named in the sketch's own README as a cost shared
 * by all three directions and built by none of them. This register therefore
 * shows a real "not stated" with a manual editor, never an invented proposal
 * — see the settings-build note's not_fixed list.
 *
 * The graft itself — B's day sheet — is here as ONE `Sheet` (ADR 0112: one
 * object, this house's whole week) rather than seven separate overlays, with
 * each day laid out as its own mini-editor inside it. `restaurants.timezone`
 * is read from the same response and printed, but is NOT editable from this
 * sheet or anywhere else in the gateway (grepped: no `PUT`/`PATCH` route
 * writes it) — shown as a plain fact with the gap said out loud.
 */

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Sheet } from '@/components/mudavym';
import {
  restaurantsApi,
  WEEKDAYS,
  WEEKDAY_LABELS,
  MAX_RANGES_PER_DAY,
  operatingHoursErrorsFrom,
  type OperatingHours,
  type Weekday,
} from '@/services/api/restaurants';
import { Action, Note, Register, Row, fieldStyle } from './SectionKit';
import { EM, MONO, SANS, PROVENANCE_UNKNOWN } from './st-format';
import { hoursOpenCert, hoursTimezoneCert } from './certaintyTally';
import type { SettingsNextData } from './useSettingsNextData';

const EMPTY_WEEK: OperatingHours = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
const DEFAULT_RANGE = { open: '12:00', close: '23:00' };

function cloneWeek(hours: OperatingHours): OperatingHours {
  return WEEKDAYS.reduce((acc, d) => {
    acc[d] = (hours[d] ?? []).map((r) => ({ ...r }));
    return acc;
  }, {} as OperatingHours);
}

function summarise(hours: OperatingHours | null): string {
  if (hours === null) return EM + ' not stated';
  const openDays = WEEKDAYS.filter((d) => (hours[d] ?? []).length > 0);
  if (openDays.length === 0) return 'Closed every day';
  if (openDays.length === 7) {
    const allSame = WEEKDAYS.every((d) => JSON.stringify(hours[d]) === JSON.stringify(hours.mon));
    if (allSame) {
      return `Every day ${hours.mon.map((r) => `${r.open}–${r.close}`).join(', ')}`;
    }
  }
  return openDays
    .map((d) => `${WEEKDAY_LABELS[d].slice(0, 3)} ${hours[d].map((r) => `${r.open}–${r.close}`).join(', ')}`)
    .join(' · ');
}

function DaySheet({
  restaurantId, initial, onClose, onSaved,
}: {
  restaurantId: string;
  initial: OperatingHours | null;
  onClose: () => void;
  onSaved: (next: OperatingHours | null, timezone: string | null) => void;
}) {
  const [draft, setDraft] = useState<OperatingHours>(initial ? cloneWeek(initial) : cloneWeek(EMPTY_WEEK));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);

  const setDay = (day: Weekday, ranges: { open: string; close: string }[]) => {
    setDraft((prev) => ({ ...prev, [day]: ranges }));
    setErrors(null);
  };

  const save = async () => {
    setSaving(true);
    setErrors(null);
    try {
      const res = await restaurantsApi.putOperatingHours(restaurantId, draft);
      onSaved(res.operatingHours, res.timezone);
    } catch (e) {
      const fromServer = operatingHoursErrorsFrom(e);
      // The gateway lists EVERY fault at once (`parseOperatingHours` collects
      // rather than stops at the first) — showing one would send a person
      // back around the loop per mistake, so all of them render, in the
      // validator's own words.
      setErrors(fromServer ?? [(e as Error)?.message || 'Operating hours could not be saved']);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    setErrors(null);
    try {
      const res = await restaurantsApi.putOperatingHours(restaurantId, null);
      onSaved(res.operatingHours, res.timezone);
    } catch (e) {
      setErrors([(e as Error)?.message || 'Could not record the hours as unknown']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label="Opening hours"
      eyebrow="This house's week"
      title="When is it open?"
      footer={
        <span>
          Times are local to this house's own clock. A range that crosses midnight must be
          the last of its day.
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {errors && (
          <div
            role="alert"
            style={{
              fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-1)',
              background: 'var(--paper-2)', borderRadius: 8, padding: '9px 11px', margin: '0 0 12px',
            }}
          >
            <p style={{ margin: '0 0 4px', fontWeight: 600 }}>These hours were not saved — the validator said:</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}

        {WEEKDAYS.map((day) => {
          const ranges = draft[day] ?? [];
          const closed = ranges.length === 0;
          return (
            <div key={day} style={{ padding: '10px 0', borderTop: '1px solid var(--paper-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>
                  {WEEKDAY_LABELS[day]}
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)' }}>
                  <input
                    type="checkbox"
                    checked={closed}
                    onChange={() => setDay(day, closed ? [{ ...DEFAULT_RANGE }] : [])}
                  />
                  Closed
                </label>
              </div>
              {!closed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {ranges.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[day]} range ${i + 1} opens`}
                        value={r.open}
                        onChange={(e) => {
                          const next = ranges.map((x) => ({ ...x }));
                          next[i].open = e.target.value;
                          setDay(day, next);
                        }}
                        style={fieldStyle}
                      />
                      <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)' }}>to</span>
                      <input
                        type="time"
                        aria-label={`${WEEKDAY_LABELS[day]} range ${i + 1} closes`}
                        value={r.close}
                        onChange={(e) => {
                          const next = ranges.map((x) => ({ ...x }));
                          next[i].close = e.target.value;
                          setDay(day, next);
                        }}
                        style={fieldStyle}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${WEEKDAY_LABELS[day]} range ${i + 1}`}
                        onClick={() => setDay(day, ranges.filter((_, j) => j !== i))}
                        // ink-3, deliberately: this tints the X glyph only (no text
                        // node), so it needs WCAG's 3:1 non-text minimum, not the
                        // 4.5:1 a caption needs — ink-3 already clears 3:1 on every
                        // paper ground (OD-112's own measurement).
                        style={{ background: 'none', border: 0, color: 'var(--ink-4)', cursor: 'pointer', padding: 2 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={ranges.length >= MAX_RANGES_PER_DAY}
                    onClick={() => setDay(day, [...ranges, { ...DEFAULT_RANGE }])}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
                      fontFamily: SANS, fontSize: 11,
                      // ink-3, deliberately, only in the `disabled` branch: WCAG
                      // 1.4.3 exempts inactive-control text from the 4.5:1 caption
                      // minimum, and this button IS `disabled` at that point — a
                      // real disabled-state dim, not a caption OD-112 covers.
                      color: ranges.length >= MAX_RANGES_PER_DAY ? 'var(--ink-4)' : 'var(--seal-deep)',
                      background: 'none', border: 0, cursor: ranges.length >= MAX_RANGES_PER_DAY ? 'default' : 'pointer', padding: 0,
                    }}
                  >
                    <Plus size={11} /> range
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--paper-2)' }}>
          <button
            type="button"
            onClick={() => void clear()}
            disabled={saving}
            style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-4)', background: 'none', border: 0, textDecoration: 'underline', cursor: saving ? 'default' : 'pointer', padding: 0 }}
          >
            Record the hours as unknown instead
          </button>
          <Action onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save hours'}
          </Action>
        </div>
      </div>
    </Sheet>
  );
}

export function HoursSection({ data }: { data: SettingsNextData }) {
  const { hours, canManage, restaurantId } = data;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (hours.status !== 'ok') setEditing(false);
  }, [hours.status]);

  return (
    <>
    <Register remote={hours} name="this house's operating hours">
      {(reg) => {
        const known = reg.operatingHours !== null;
        return (
          <>
            {reg.storedHoursErrors && (
              <Note role="alert">
                The saved hours for this house do not parse and are being read as unknown:{' '}
                {reg.storedHoursErrors.join('; ')}.
              </Note>
            )}
            <Row
              label="When is it open?"
              cert={hoursOpenCert(reg)}
              provenance={{
                kept: 'restaurant',
                when: reg.updatedAt,
                whenUnknown: PROVENANCE_UNKNOWN.neverWritten,
                readBy: (
                  <>
                    every service-day read across the product —{' '}
                    <code style={{ fontFamily: MONO }}>common/operating-hours/operating-hours.ts</code>{' '}
                    (<code style={{ fontFamily: MONO }}>isOpenAt</code>, <code style={{ fontFamily: MONO }}>serviceWindows</code>)
                  </>
                ),
              }}
              consequence={
                known
                  ? summarise(reg.operatingHours)
                  : "Nobody has recorded when this house opens. That is different from being closed — nothing assumes a schedule on its behalf, and every reader of it answers “unknown” rather than “closed”."
              }
              control={canManage ? <Action onClick={() => setEditing(true)}>{known ? 'Edit' : 'Set hours'}</Action> : undefined}
            />
            <Row
              label="Which clock does it keep?"
              cert={hoursTimezoneCert(reg)}
              provenance={{
                kept: 'restaurant', when: null, whenUnknown: 'restaurants.timezone carries no changed-at of its own',
                readBy: (
                  <>
                    the same hours reader —{' '}
                    <code style={{ fontFamily: MONO }}>common/operating-hours/operating-hours.ts</code>{' '}
                    (<code style={{ fontFamily: MONO }}>assertZone</code>)
                  </>
                ),
              }}
              consequence={
                reg.timezone
                  ? `${reg.timezone}. Every hour on this page is read in it.`
                  : 'Not recorded. Without a zone the hours above cannot be placed on a clock, and every reader of them answers “timezone unknown”.'
              }
              control={
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-4)' }}>
                  no editor exists
                </span>
              }
            >
              <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '5px 0 0' }}>
                Read-only here and everywhere: no route under the gateway writes
                <code style={{ fontFamily: MONO }}> restaurants.timezone</code> (grepped 2026-09-17). Changing it needs a
                decision and a route this pass did not build.
              </p>
            </Row>
          </>
        );
      }}
    </Register>
    {editing && hours.data && restaurantId && (
      <DaySheet
        restaurantId={restaurantId}
        initial={hours.data.operatingHours}
        onClose={() => setEditing(false)}
        onSaved={(next, timezone) => {
          hours.set({ ...(hours.data as NonNullable<typeof hours.data>), operatingHours: next, timezone, updatedAt: new Date().toISOString() });
          setEditing(false);
        }}
      />
    )}
    </>
  );
}
