/**
 * Services & permissions — two different things under one heading.
 *
 * The four consents persist and nothing branches on them. Re-grepped
 * 2026-09-03 across ALL FOUR runtimes (`apps/api-gateway/src`, `apps/web/src`,
 * `apps/mobile/src`, `services/agent-orchestrator`), because the first pass's
 * three-runtime grep is exactly what produced a false "nothing reads this" on
 * quiet hours:
 *
 *   servicePermissions.email            written here + apps/mobile/src/guidance/
 *   servicePermissions.web              GuidanceProvider.tsx:314; re-exposed on
 *   servicePermissions.privacy_sharing  the guidance context at :334 and read by
 *   servicePermissions.privacy_analytics no consumer (TipStrip, TourSheet and
 *                                       WineAgentFab use other fields only).
 *                                       Zero hits in the gateway; zero in the
 *                                       orchestrator.                     DEAD
 *
 * So the claim that survives is the load-bearing one: **no code branches on
 * them anywhere**, and a control whose effect does not exist is what ADR 0020
 * forbids. They are rendered as records with the file that was checked.
 *
 * The connected apps beneath them are the opposite: real OAuth connections with
 * real dates, and the disconnect really disconnects.
 */

import { useNavigate, Link } from 'react-router-dom';
import { Action, ConfirmAction, Dead, Micro, Note, Register, Row } from './SectionKit';
import { PROVENANCE_UNKNOWN, SANS, fmtWhen } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

const CONSENT_EVIDENCE =
  'Only writers: this page and apps/mobile/src/guidance/GuidanceProvider.tsx:314. That provider re-exposes the value at :334 and nothing consumes it. No hit in apps/api-gateway/src or services/agent-orchestrator. Grepped 2026-09-03.';

export function ServicesSection({ data }: { data: SettingsNextData }) {
  const { prefs, integrations, disconnectIntegration, writer } = data;
  const navigate = useNavigate();

  return (
    <>
      <Note>
        Two different things live here. The consents below are recorded on your account and nothing in the product reads
        them yet — they are shown as records, without switches, rather than as promises. The apps beneath them are real
        connections with real dates.
      </Note>

      <div style={{ margin: '10px 0 0' }}><Micro>Recorded, not enforced</Micro></div>
      <Register remote={prefs} name="your account preferences">
        {(reg) => {
          const sp = (reg.preferences.servicePermissions ?? {}) as Record<string, boolean | undefined>;
          const val = (k: string, fallback: boolean) => (sp[k] === undefined ? fallback : sp[k] === true);
          return (
            <>
              <Dead
                label="Email access"
                stored={val('email', true) ? 'stored: allowed' : 'stored: off'}
                consequence="Operational email — invites and digests — is governed by the notification preferences and by the gateway's own sender configuration, not by this record."
                evidence={CONSENT_EVIDENCE}
              />
              <Dead
                label="Web & connected apps"
                stored={val('web', true) ? 'stored: allowed' : 'stored: restricted'}
                consequence="Calendar feeds and vendor links are governed by the feed token and by each app's own connection, not by this record."
                evidence={CONSENT_EVIDENCE}
              />
              <Dead
                label="Product analytics"
                stored={val('privacy_analytics', true) ? 'stored: on' : 'stored: off'}
                consequence="The reporter this would govern is unreachable twice over: every one of its entry points returns early unless VITE_UX_OPTIMIZER is “true”, and the only hook that imports it is itself imported by no file. Nothing about how you move through the app is being collected — and this consent does not gate it either way."
                evidence="apps/web/src/lib/uxSignals.ts:15,64,87,125 (env gate); its only importer is hooks/useUxOverrides.ts:19, which has zero call sites; neither file reads privacy_analytics."
              />
              <Dead
                label="Data sharing with partners"
                stored={val('privacy_sharing', false) ? 'stored: allowed' : 'stored: not sharing'}
                consequence="Sharing happens only through a partner you connect, on that partner's own path. This record gates nothing."
                evidence={CONSENT_EVIDENCE}
              />
              {reg.updatedAt && (
                <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '8px 0 0' }}>
                  Your preference record was last written {fmtWhen(reg.updatedAt)}. The gateway dates the record, not the
                  individual settings — so this date belongs to all of them together.
                </p>
              )}
            </>
          );
        }}
      </Register>

      <div style={{ margin: '20px 0 0' }}><Micro tone="seal">Connected apps</Micro></div>
      <Register remote={integrations} name="your connected apps">
        {(reg) => (
          <>
            {reg.catalog.length === 0 && <Note role="status">No app is offered for connection.</Note>}
            {reg.catalog.map((item) => {
              const conn = reg.connections.find((c) => c.integrationId === item.id);
              const connected = conn?.connected === true;
              return (
                <Row
                  key={item.id}
                  label={item.label}
                  provenance={{
                    kept: 'account',
                    verb: 'connected',
                    when: conn?.connectedAt ?? null,
                    whenUnknown: connected
                      ? 'the connection records no date'
                      : PROVENANCE_UNKNOWN.notConnected,
                  }}
                  consequence={
                    <>
                      {item.description}
                      {connected && conn?.account && <> Connected as {conn.account}.</>}
                      {!item.available && item.unavailableReason && <> Unavailable: {item.unavailableReason}</>}
                    </>
                  }
                  control={
                    connected ? (
                      <ConfirmAction
                        label="Disconnect"
                        confirmLabel="Yes, disconnect"
                        busy={writer.busy === `integration:${item.id}`}
                        consequence="The app loses access until you connect it again."
                        onConfirm={() => void disconnectIntegration(item.id)}
                      />
                    ) : (
                      <Action
                        disabled={!item.available}
                        onClick={() =>
                          navigate(`/authorize/${item.id}?returnPath=${encodeURIComponent('/settings?tab=services')}`)
                        }
                      >
                        Connect
                      </Action>
                    )
                  }
                />
              );
            })}
          </>
        )}
      </Register>

      <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '14px 0 0' }}>
        What is collected and why is written out in full on the <Link to="/privacy" style={{ color: 'var(--seal-deep)' }}>privacy page</Link>.
      </p>
    </>
  );
}

export default ServicesSection;
