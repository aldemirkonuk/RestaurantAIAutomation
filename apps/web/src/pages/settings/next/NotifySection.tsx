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
 *   push        → `push_enabled` is written three times and read never.
 *                 Push DELIVERY code does exist in the orchestrator
 *                 (`push_service.send_push_notification`), but the channel
 *                 chooser picks by urgency and `<type>_channels`, its device
 *                 table `push_subscriptions` is absent from production
 *                 (notification_agent.py:31-37) and the gateway has no push
 *                 path at all
 *                 (communications/push-is-not-resolved-here.spec.ts)   PREF DEAD
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
 * The second piece of substance is the OR semantics. These preferences are
 * yours, but the senders take them across every member of the restaurant: the
 * alert goes out if ANY member wants it, and the earliest digest time wins.
 * Turning yours off does not silence the restaurant, and the page says so.
 */

import { Choice, Dead, Micro, Note, Register, Row, SaveFailure, Toggle, fieldStyle } from './SectionKit';
import { PROVENANCE_UNKNOWN, SANS, fmtWhen } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

const MODE_OPTIONS = [
  { value: 'both' as const, label: 'Email and in-app' },
  { value: 'in_app' as const, label: 'In-app only' },
  { value: 'off' as const, label: 'Off' },
];

export default function NotifySection({ data }: { data: SettingsNextData }) {
  const { notif, saveNotif, writer } = data;

  return (
    <Register remote={notif} name="your notification preferences">
      {(p) => {
        const kept = { kept: 'account' as const, when: p.updatedAt ?? null, whenUnknown: PROVENANCE_UNKNOWN.neverWritten };
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
              These are yours, but the senders read every member’s together: an alert goes out if <em>anyone</em> here
              wants it, and the earliest digest time wins. Turning yours off quiets your inbox, not the restaurant.
              {p.updatedAt && <> Last written {fmtWhen(p.updatedAt)}.</>}
            </Note>

            <SaveFailure failed={writer.failed} what="The values below are still the server’s." />

            <div style={{ margin: '14px 0 0' }}><Micro tone="seal">Doors</Micro></div>

            <Row
              label="Email"
              provenance={kept}
              consequence="Team broadcasts and scheduled digests reach you by email. Read by the broadcast recipient list."
              control={
                <Toggle label="Email notifications" checked={p.email} busy={writer.busy === 'email'}
                  onChange={(v) => void saveNotif('email', { email: v })} />
              }
            />
            <Row
              label="SMS"
              provenance={kept}
              consequence="Team broadcasts may also go to your phone number, where one is on file."
              control={
                <Toggle label="SMS notifications" checked={p.sms} busy={writer.busy === 'sms'}
                  onChange={(v) => void saveNotif('sms', { sms: v })} />
              }
            />
            <Dead
              label="Push"
              stored={p.push ? 'stored: on' : 'stored: off'}
              consequence="Nothing in the product sends a push notification to your phone, and this preference would not be what decided it if something did. Push-sending code exists in the alerting agent, but it chooses its channels by urgency and never consults this switch; the device register it would send to is absent from production; and the gateway has no push path at all."
              evidence="`push_enabled` has three writers and no reader: notifications.service.ts:189,1142,1193 write it; the channel chooser reads urgency and `<type>_channels` instead (notification_agent.py:1435-1470). The one other hit, core/database.py:1967, copies a `restaurants.push_enabled` onto a manager object nothing then reads. Device table missing per notification_agent.py:31-37; gateway path per apps/api-gateway/src/communications/push-is-not-resolved-here.spec.ts. Grepped 2026-09-03 across all four runtimes."
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Low stock</Micro></div>
            <Row
              label="Low-stock alerts"
              provenance={kept}
              consequence="The alerting engine runs for this restaurant when any member has this on."
              control={
                <Toggle label="Low-stock alerts" checked={low.enabled} busy={writer.busy === 'low.enabled'}
                  onChange={(v) => void saveNotif('low.enabled', { lowStock: { ...low, enabled: v } })} />
              }
            />
            <Row
              label="Tell me the first time an item drops"
              provenance={kept}
              consequence="The first crossing of the threshold arrives immediately; later ones wait for the digest."
              control={
                <Toggle label="Instant first alert" checked={low.instantFirstAlert} busy={writer.busy === 'low.first'}
                  onChange={(v) => void saveNotif('low.first', { lowStock: { ...low, instantFirstAlert: v } })} />
              }
            />
            <Row
              label="Critical items never wait"
              provenance={kept}
              consequence="An item at or below zero is sent the moment it is seen, digest or not."
              control={
                <Toggle label="Critical immediate" checked={low.criticalImmediate} busy={writer.busy === 'low.critical'}
                  onChange={(v) => void saveNotif('low.critical', { lowStock: { ...low, criticalImmediate: v } })} />
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
                    onChange={(v) => void saveNotif('low.freq', { lowStock: { ...low, digestFrequency: v } })}
                  />
                  <input
                    type="time"
                    aria-label="Digest time"
                    value={low.digestTime}
                    disabled={low.digestFrequency !== 'daily'}
                    onChange={(e) => void saveNotif('low.time', { lowStock: { ...low, digestTime: e.target.value } })}
                    className="st-focus"
                    style={fieldStyle}
                  />
                </span>
              }
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Scheduled mail</Micro></div>
            <Row
              label="Order reminders"
              provenance={kept}
              consequence="Recurring orders coming due within two days. “In-app only” keeps the notification and drops the email."
              control={
                <Choice label="Order reminders" value={p.ordersMode ?? 'both'} options={MODE_OPTIONS}
                  onChange={(v) => void saveNotif('ordersMode', { ordersMode: v })} />
              }
            />
            <Row
              label="Weekly report"
              provenance={kept}
              consequence="The Monday summary of the week's spend and movement."
              control={
                <Choice label="Weekly report" value={p.reportsMode ?? 'both'} options={MODE_OPTIONS}
                  onChange={(v) => void saveNotif('reportsMode', { reportsMode: v })} />
              }
            />

            <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Quiet hours</Micro></div>
            <Row
              label="Hold non-critical alerts overnight"
              provenance={kept}
              consequence={
                <>
                  Honoured by the alerting agent: inside this window it drops every channel for
                  anything below <strong>critical</strong>, so the alert is suppressed rather than
                  delayed. Critical still goes out. The gateway’s own scheduled mail — the weekly
                  report and order reminders — does <strong>not</strong> consult this window and
                  sends on its own clock.
                </>
              }
              control={
                <Toggle
                  label="Quiet hours"
                  checked={quiet.enabled}
                  busy={writer.busy === 'quiet.enabled'}
                  onChange={(v) => void saveNotif('quiet.enabled', { quietHours: { ...quiet, enabled: v } })}
                />
              }
            />
            {quiet.enabled && (
              <Row
                label="The window"
                provenance={kept}
                consequence="From the first time to the second, read on the alerting agent's clock. A window that ends before it starts is read as running overnight."
                control={
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="time"
                      aria-label="Quiet hours start"
                      value={quiet.startTime}
                      onChange={(e) => void saveNotif('quiet.start', { quietHours: { ...quiet, startTime: e.target.value } })}
                      className="st-focus"
                      style={fieldStyle}
                    />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>to</span>
                    <input
                      type="time"
                      aria-label="Quiet hours end"
                      value={quiet.endTime}
                      onChange={(e) => void saveNotif('quiet.end', { quietHours: { ...quiet, endTime: e.target.value } })}
                      className="st-focus"
                      style={fieldStyle}
                    />
                  </span>
                }
              />
            )}

            <div style={{ margin: '20px 0 0' }}><Micro>Recorded, not enforced</Micro></div>
            <Note>
              These are stored on your account and nothing in any of the four runtimes reads them. They are shown
              rather than hidden, because the value is real even where the effect is not — and because a switch here
              would be a promise the product does not keep.
            </Note>
            {(['inventory', 'orders', 'calendar', 'system', 'ai'] as const).map((c) => (
              <Dead
                key={c}
                label={`${c.charAt(0).toUpperCase()}${c.slice(1)} category`}
                stored={cats[c] ? 'stored: on' : 'stored: off'}
                consequence="Category filtering is written to your preferences, but no sender branches on it — every category still reaches you exactly as the doors above decide."
                evidence="Written at apps/api-gateway/src/notifications/notifications.service.ts:1144-1145 and read back only to render this row. No sender in any of the four runtimes branches on it: the scheduled mail reads orders_mode / reports_mode (scheduled-tasks.service.ts:1528), the low-stock engine reads its own five columns (low-stock-alerts.service.ts:505), and the alerting agent reads urgency and quiet hours. Grepped 2026-09-03."
              />
            ))}

          </>
        );
      }}
    </Register>
  );
}
