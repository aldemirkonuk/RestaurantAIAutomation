/**
 * Notifications — which alerts leave the building, and through which door.
 *
 * The redesign's substance here is a distinction the legacy section does not
 * draw: some of these preferences are read by a sender and some are only
 * stored. Re-grepped 2026-09-02 across ALL FOUR runtimes —
 * `apps/api-gateway/src`, `apps/web/src`, `apps/mobile/src` AND
 * `services/agent-orchestrator` (the first pass omitted the orchestrator, and
 * that omission produced a false "nothing reads this" on quiet hours; audit
 * BLOCKER 1):
 *
 *   email       → apps/api-gateway/src/team/broadcast-preferences.ts:69,104     READ
 *   sms         → apps/api-gateway/src/team/broadcast-preferences.ts:70,104     READ
 *   low stock   → apps/api-gateway/src/notifications/low-stock-alerts.service.ts:485-520
 *                                                                              READ
 *   orders /
 *   reports     → apps/api-gateway/src/communications/scheduled-tasks.service.ts:1523-1552
 *                                                                              READ
 *   quiet hours → services/agent-orchestrator/agents/notification_agent.py:1448,1487-1494
 *                 (loaded by `_get_notification_preferences`, :1580-1591, which
 *                 does `select("*")` on the SAME `notification_preferences` row
 *                 this page writes) and core/database.py:1410-1423             READ
 *   push        → `push_enabled` is read by nothing in any of the four trees.
 *                 Push DELIVERY code does exist in the orchestrator
 *                 (`push_service.send_push_notification`), but this preference
 *                 does not gate it, its device table `push_subscriptions` is
 *                 absent from production (notification_agent.py:31-37) and the
 *                 gateway has no push path at all
 *                 (communications/push-is-not-resolved-here.spec.ts)   PREF DEAD
 *   categories  → written at notifications.service.ts:1144; no reader in any of
 *                 the four trees                                              DEAD
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

import { Dead, Micro, Note, Register, Row, Toggle, Choice } from './SectionKit';
import { SANS, fmtWhen } from './st-format';
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
        const kept = { kept: 'account' as const, when: p.updatedAt ?? null, whenUnknown: 'this record has never been written' };
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

            {writer.failed && (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '0 0 10px' }}>
                That preference was not saved — {writer.failed.message}. The values below are still the server’s.
              </p>
            )}

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
              consequence="This preference gates nothing. Push-sending code does exist — in the agent orchestrator — but it does not consult this switch, its device register is absent from production, and the gateway has no push path at all. So no phone is receiving anything today, and turning this off would not be what stopped it."
              evidence="No reader for `push_enabled` in apps/api-gateway/src, apps/web/src, apps/mobile/src or services/agent-orchestrator; device table missing per services/agent-orchestrator/agents/notification_agent.py:31-37; gateway path per apps/api-gateway/src/communications/push-is-not-resolved-here.spec.ts."
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
                    style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                      border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
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
                      style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                        border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
                    />
                    <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3)' }}>to</span>
                    <input
                      type="time"
                      aria-label="Quiet hours end"
                      value={quiet.endTime}
                      onChange={(e) => void saveNotif('quiet.end', { quietHours: { ...quiet, endTime: e.target.value } })}
                      className="st-focus"
                      style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                        border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
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
                evidence="Written at apps/api-gateway/src/notifications/notifications.service.ts:1144; no reader in apps/api-gateway/src, apps/web/src, apps/mobile/src or services/agent-orchestrator."
              />
            ))}

          </>
        );
      }}
    </Register>
  );
}
