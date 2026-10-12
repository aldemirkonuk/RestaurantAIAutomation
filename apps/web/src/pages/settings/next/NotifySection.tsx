/**
 * Notifications — which alerts leave the building, and through which door.
 *
 * The redesign's substance here is a distinction the legacy section does not
 * draw: some of these preferences are read by a sender and some are only
 * stored. Re-grepped 2026-09-03 across ALL FOUR runtimes —
 * `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` AND
 * `services/agent-orchestrator`. The first pass grepped three and lost a
 * working control on the strength of it (audit BLOCKER 1):
 *
 *   email       → apps/api-gateway/src/team/broadcast-preferences.ts:69,104     READ
 *   sms         → apps/api-gateway/src/team/broadcast-preferences.ts:70,104     READ
 *   low stock   → apps/api-gateway/src/notifications/low-stock-alerts.service.ts:505,515
 *                                                                              READ
 *   orders /
 *   reports     → apps/api-gateway/src/communications/scheduled-tasks.service.ts:1528
 *                                                                              READ
 *   quiet hours → services/agent-orchestrator/agents/notification_agent.py:1487-1494,
 *                 called from `_select_channels` at :1448, on the row loaded by
 *                 `_get_notification_preferences` (:1580-1591) with `select("*")`
 *                 on the SAME `notification_preferences` row this page writes.
 *                 `_select_channels` has exactly THREE call sites — :545
 *                 (low stock), :727 (negotiation complete), :788 (delivery
 *                 confirmation).                                             READ
 *
 *                 NOT gated by it: `send_order_approval_request` (:611) reads
 *                 the same preferences row (:637) and then takes
 *                 `order_approval_channels` straight off it (:638) without
 *                 going through `_select_channels`. An order-approval push or
 *                 SMS goes out inside the quiet window. The rendered copy never
 *                 claimed otherwise; this comment did, by counting :637 as a
 *                 fourth handler (second-pass audit DEFECT 1).
 *   push        → `push_enabled` is read by the gateway's one push rule
 *                 (notifications/push-hold.ts `pushHolds`, F-528/F-539/F-835),
 *                 which both the bell funnel and `sendToUser` call: every bell
 *                 line that is not low priority goes to the phones on file,
 *                 except for a person with this off or inside their quiet
 *                 window on the house clock. The orchestrator's own push code
 *                 still ignores it (notification_agent.py:1435-1470)       LIVE
 *   categories  → written at notifications.service.ts:1144-1145; no reader in
 *                 any of the four trees                                       DEAD
 *
 * A SECOND QUIET-HOURS STORE EXISTS, and this page does not write it:
 * `manager_preferences.quiet_hours_start/end` (baseline_from_production.sql:3696-3697),
 * read by `core/database.py:1410-1428` — which has no callers. Two stores for
 * one idea, one of them live and one of them dead, is worth knowing before
 * anyone "fixes" quiet hours by wiring the wrong one (page note §13.17).
 *
 * The DEAD ones render WITHOUT controls, showing the value that is stored and
 * the file that was checked. A switch whose only effect is to record itself is
 * the exact shape ADR 0020 forbids, and the founder's brief for this page says
 * it plainly: no fake toggles. The converse is equally binding, and is what the
 * audit caught: a control must NOT be taken away on a claim that has not been
 * grepped everywhere the product runs.
 *
 * The second piece of substance is who a low-stock line reaches. Since F-1338
 * (2026-10-11) each person's own row decides their bell and phone; the house
 * still runs the engine when ANY member wants it, and the earliest digest time
 * wins. Turning yours off quiets you, not the restaurant, and the page says so.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Choice, Dead, Micro, Note, Register, Row, SaveFailure, Toggle, fieldStyle } from './SectionKit';
import { PROVENANCE_UNKNOWN, SANS, errText, fmtWhen, httpStatus } from './st-format';
import type { Remote, SettingsNextData, Writer } from './useSettingsNextData';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/queries/useNotificationQueries';
import type {
  NotificationPreferences,
  NotificationPreferencesPatch,
} from '@/services/api/notifications';

/** "00:00" … "23:00" — the only times the low-stock digest can actually go out. */
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

/** A stored "12:30" is sent at 12:00, so that is what the control shows. */
function onTheHour(t: string): string {
  const h = Number.parseInt(t.slice(0, 2), 10);
  return Number.isInteger(h) && h >= 0 && h < 24 ? HOURS[h] : HOURS[12];
}

/**
 * A time that saves once, when the owner leaves the field — not on every
 * segment typed, which sent 07:00, 07:03 and 07:30 for one edit.
 */
function TimeField({ label, value, onSave }: { label: string; value: string; onSave: (t: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="time"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (/^\d{2}:\d{2}$/.test(draft) && draft !== value) onSave(draft);
      }}
      className="st-focus"
      style={fieldStyle}
    />
  );
}

const MODE_OPTIONS = [
  { value: 'both' as const, label: 'Email and in-app' },
  { value: 'in_app' as const, label: 'In-app only' },
  { value: 'off' as const, label: 'Off' },
];

/**
 * Takes only what it reads, so /profile can draw the same register from the
 * shared notification hooks (F-623) without the whole Settings data hook.
 */
export default function NotifySection({
  data,
}: {
  data: Pick<SettingsNextData, 'notif' | 'saveNotif' | 'writer'>;
}) {
  const { notif, saveNotif, writer } = data;

  return (
    <Register remote={notif} name="your notification preferences">
      {(p) => {
        const kept = { kept: 'person' as const, when: p.updatedAt ?? null, whenUnknown: PROVENANCE_UNKNOWN.neverWritten };
        const low = p.lowStock ?? {
          enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily' as const, digestTime: '12:00',
        };
        const cats = p.categories ?? { inventory: true, orders: true, calendar: true, system: true, ai: true };
        // The gateway's own fallbacks when the row has never been written
        // (notifications.service.ts:1055-1058) — shown so the control reflects
        // what the alerting agent would actually use, not a second invention.
        const quiet = p.quietHours ?? { enabled: false, startTime: '22:00', endTime: '08:00' };

        return (
          <>
            <Note>
              These are yours. A low-stock alert reaches your bell and phone only when your own switches want it,
              so turning yours off quiets you, not the restaurant. The digest goes out once a day, at the earliest
              time anyone here picked.
              {p.updatedAt && <> Last written {fmtWhen(p.updatedAt)}.</>}
            </Note>

            <SaveFailure failed={writer.failed} what="The values below are still the server’s." />

            <div style={{ margin: '14px 0 0' }}><Micro tone="seal">Doors</Micro></div>

            <Row
              label="Email door"
              cert="manual"
              // read by: team/broadcast-preferences.ts › channelAllowed (F-504)
              provenance={{ ...kept, readBy: 'team broadcasts and the scheduled digests' }}
              consequence="Team broadcasts and scheduled digests reach you by email."
              control={
                <Toggle label="Email notifications" checked={p.email} busy={writer.busy === 'email'}
                  onChange={(v) => void saveNotif('email', { email: v })} />
              }
            />
            <Row
              label="SMS door"
              cert="manual"
              // read by: team/broadcast-preferences.ts › channelAllowed (F-504)
              provenance={{ ...kept, readBy: 'team broadcasts' }}
              consequence="Team broadcasts may also go to your phone number, where one is on file."
              control={
                <Toggle label="SMS notifications" checked={p.sms} busy={writer.busy === 'sms'}
                  onChange={(v) => void saveNotif('sms', { sms: v })} />
              }
            />
            <Row
              label="Phone push"
              cert="manual"
              // read by: notifications/push-hold.ts › pushHolds, which the funnel and sendToUser both call (F-528, F-835)
              provenance={{ ...kept, readBy: 'the bell, before it pushes your phone' }}
              consequence="When something lands on your bell that is not low priority, your phone gets a push too. Off means the bell still shows it, but your phone stays silent. This switch is for this restaurant only. The phone app has its own Push switch; while that one is off, the phone stays silent whatever this says."
              control={
                <Toggle label="Push notifications" checked={p.push} busy={writer.busy === 'push'}
                  onChange={(v) => void saveNotif('push', { push: v })} />
              }
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Low stock</Micro></div>
            <Row
              label="Low-stock alerts"
              cert="manual"
              // read by: notifications/low-stock-alerts.service.ts › getEffectiveLowStockPrefs (F-504)
              provenance={{ ...kept, readBy: 'the low-stock alerts' }}
              consequence="Off means no low-stock alert reaches your bell or phone. Others here still get theirs."
              control={
                <Toggle label="Low-stock alerts" checked={low.enabled} busy={writer.busy === 'low.enabled'}
                  onChange={(v) => void saveNotif('low.enabled', { lowStock: { enabled: v } })} />
              }
            />
            <Row
              label="Tell me the first time an item drops"
              provenance={kept}
              consequence="The first crossing of the threshold arrives immediately; later ones wait for the digest."
              control={
                <Toggle label="Instant first alert" checked={low.instantFirstAlert} busy={writer.busy === 'low.first'}
                  onChange={(v) => void saveNotif('low.first', { lowStock: { instantFirstAlert: v } })} />
              }
            />
            <Row
              label="Critical items never wait"
              provenance={kept}
              consequence="An item at or below zero is sent the moment it is seen, digest or not."
              control={
                <Toggle label="Critical immediate" checked={low.criticalImmediate} busy={writer.busy === 'low.critical'}
                  onChange={(v) => void saveNotif('low.critical', { lowStock: { criticalImmediate: v } })} />
              }
            />
            <Row
              label="Digest"
              provenance={kept}
              consequence="Everything that is not urgent is gathered and sent once. Off means only the instant alerts above ever arrive."
              control={
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <Choice
                    label="Digest frequency"
                    value={low.digestFrequency}
                    options={[{ value: 'daily' as const, label: 'Daily' }, { value: 'off' as const, label: 'Off' }]}
                    onChange={(v) => void saveNotif('low.freq', { lowStock: { digestFrequency: v } })}
                  />
                  {/* The digest goes out on the hour (low-stock-alerts.service.ts:607-611
                      matches the hour only), so only an hour is offered. */}
                  <select
                    aria-label="Digest time"
                    value={onTheHour(low.digestTime)}
                    disabled={low.digestFrequency !== 'daily'}
                    onChange={(e) => void saveNotif('low.time', { lowStock: { digestTime: e.target.value } })}
                    className="st-focus"
                    style={fieldStyle}
                  >
                    {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </span>
              }
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Scheduled mail</Micro></div>
            <Row
              label="Order reminders"
              // read by: communications/scheduled-tasks.service.ts › getEffectiveCategoryMode (F-504)
              provenance={{ ...kept, readBy: 'the order-reminder mail' }}
              consequence="Recurring orders coming due within two days. “In-app only” keeps the notification and drops the email."
              control={
                <Choice label="Order reminders" value={p.ordersMode ?? 'both'} options={MODE_OPTIONS}
                  onChange={(v) => void saveNotif('ordersMode', { ordersMode: v })} />
              }
            />
            <Row
              label="Weekly report"
              // read by: communications/scheduled-tasks.service.ts › getEffectiveCategoryMode (F-504)
              provenance={{ ...kept, readBy: 'the Monday report mail' }}
              consequence="The Monday summary of the week's spend and movement."
              control={
                <Choice label="Weekly report" value={p.reportsMode ?? 'both'} options={MODE_OPTIONS}
                  onChange={(v) => void saveNotif('reportsMode', { reportsMode: v })} />
              }
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Quiet hours</Micro></div>
            <Row
              label="Quiet hours"
              cert="manual"
              provenance={{
                ...kept,
                // read by: notification_agent.py › _is_quiet_hours (F-504)
                readBy: 'the alerts Mudavym sends you',
              }}
              consequence={
                <>
                  Inside this window your phone is not pushed, by the restaurant’s clock. The
                  line still lands on your bell, so you see it when you next look. The alerting
                  agent also drops every channel for anything below <strong>critical</strong>.
                  Scheduled mail — the weekly report and order reminders — is <strong>not</strong> held
                  for this window and goes out on its own clock. A message to the team, a note from
                  your manager, a shift offer or a call for cover still reaches your phone in this
                  window, because work does not always fit the day. Each one sent in your quiet hours is recorded. Turn Push off to
                  stop them.
                </>
              }
              control={
                <Toggle
                  label="Quiet hours"
                  checked={quiet.enabled}
                  busy={writer.busy === 'quiet.enabled'}
                  onChange={(v) => void saveNotif('quiet.enabled', { quietHours: v ? { enabled: true, startTime: quiet.startTime, endTime: quiet.endTime } : { enabled: false } })}
                />
              }
            />
            {quiet.enabled && (
              <Row
                label="The window"
                provenance={kept}
                consequence="From the first time to the second, on this restaurant's clock (Settings › Time zone). Until a time zone is set, the window is read on your country's clock when it has just one, otherwise in UTC. A window that ends before it starts is read as running overnight."
                control={
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <TimeField
                      label="Quiet hours start"
                      value={quiet.startTime}
                      onSave={(t) => void saveNotif('quiet.start', { quietHours: { startTime: t } })}
                    />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4)' }}>to</span>
                    <TimeField
                      label="Quiet hours end"
                      value={quiet.endTime}
                      onSave={(t) => void saveNotif('quiet.end', { quietHours: { endTime: t } })}
                    />
                  </span>
                }
              />
            )}

            <div style={{ margin: '20px 0 0' }}><Micro>Recorded, not enforced</Micro></div>
            <Note>
              These are kept for you in this house and nothing in the product reads them. They are shown
              rather than hidden, because the value is real even where the effect is not — and because a switch here
              would be a promise the product does not keep.
            </Note>
            {(['inventory', 'orders', 'calendar', 'system', 'ai'] as const).map((c) => (
              <Dead
                key={c}
                label={`${c.charAt(0).toUpperCase()}${c.slice(1)} category`}
                stored={cats[c] ? 'stored: on' : 'stored: off'}
                consequence="Category filtering is written to your preferences, but no sender branches on it — every category still reaches you exactly as the doors above decide."
                // Checked 2026-09-03: written at apps/api-gateway/src/notifications/
                // notifications.service.ts:1144-1145 and read back only to render this
                // row. No sender branches on it: the scheduled mail reads orders_mode /
                // reports_mode (scheduled-tasks.service.ts › getEffectiveCategoryMode), the low-stock engine
                // reads its own five columns (low-stock-alerts.service.ts › readLowStockPrefs), and the
                // alerting agent reads urgency and quiet hours.
                evidence="Your choice is kept, and shown here, so it is not lost."
              />
            ))}

          </>
        );
      }}
    </Register>
  );
}

/**
 * The same register, for /profile (F-623, 2026-10-09).
 *
 * `PATCH /notifications/preferences` takes any member's own row for their
 * house, but the only screen that called it was Settings, which sends staff
 * to "Ask a manager". /profile is open to every role, so it draws this. It is
 * fed by the shared react-query hooks rather than the Settings data hook, and
 * renders the section above unchanged, so the two pages cannot drift apart.
 */
export function OwnNotifySection({ userId, restaurantId }: { userId: string; restaurantId: string | null }) {
  const query = useNotificationPreferences(userId, restaurantId);
  const update = useUpdateNotificationPreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  // A failure belongs to the house the write started in (F-627's rule).
  const houseRef = useRef(restaurantId);
  houseRef.current = restaurantId;

  const notif: Remote<NotificationPreferences> = {
    status: !userId
      ? 'idle'
      : query.isPending
        ? 'loading'
        : query.isError
          ? httpStatus(query.error) === 403
            ? 'denied'
            : 'error'
          : 'ok',
    data: query.data ?? null,
    error: query.isError ? errText(query.error) : null,
    reload: () => void query.refetch(),
    // The mutation writes the confirmed answer into its own house's cache.
    set: () => undefined,
  };

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    const startedIn = houseRef.current;
    setBusy(key);
    setFailed(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (houseRef.current === startedIn) setFailed({ key, message: errText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }, []);
  const writer: Writer = { busy, failed, run, clear: () => setFailed(null) };

  const saveNotif = (key: string, partial: NotificationPreferencesPatch) =>
    run(key, async () => {
      await update.mutateAsync({ userId, restaurantId, preferences: partial });
    });

  return <NotifySection data={{ notif, saveNotif, writer }} />;
}
