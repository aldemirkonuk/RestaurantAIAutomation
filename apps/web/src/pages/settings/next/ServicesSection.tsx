/**
 * Services & permissions — two different things under one heading.
 *
 * UNTIL 2026-09-17 this rendered four consent switches (email access, web &
 * connected apps, product analytics, data sharing) as honest "Dead" records —
 * stored, read by nothing, re-grepped across all four runtimes. That grep is
 * exactly why the panel is gone rather than merely relabelled: ADR 0149 row 14
 * / sketch 109A name it as "the analytics consent panel (opened only from
 * legacy /settings, no reader)" and the founder's instruction is not "keep
 * showing it honestly" but "delete it and say plainly that no analytics
 * consent is collected yet." A dead record that still occupies four rows is
 * still the shape ADR 0020 warns about — this page choosing to LOOK like it
 * governs something, even while every word on it says otherwise. Deleting the
 * legacy `components/settings/ServicesPermissions.tsx` panel this rebuild
 * never mounted was already true; this is that same call applied to the
 * rebuild's own honest-but-present echo of it.
 *
 * [2026-09-25, ADR 0222: the founder's round-6r pick "Bring back, real
 * switches (Recommended)" (ADR 0134 fork 14) supersedes row 14's deletion for
 * switches the product READS. The panel is back as `ConsentPanel.tsx`, opened
 * from the Questions and training section; the four dead consents above stay
 * deleted, because nothing reads them.]
 *
 * The connected apps beneath are the opposite: real OAuth connections with
 * real dates, and the disconnect really disconnects.
 */

import { useNavigate, Link } from 'react-router-dom';
import { Action, ConfirmAction, Micro, Note, Register, Row } from './SectionKit';
import { PROVENANCE_UNKNOWN, SANS } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

export function ServicesSection({ data }: { data: SettingsNextData }) {
  const { integrations, disconnectIntegration, writer } = data;
  const navigate = useNavigate();

  return (
    <>
      <Note>
        No analytics consent is collected yet. The panel that once asked for one — four switches for email access, web
        access, product analytics and partner sharing — is deleted (2026-09-17, ADR 0149 row 14): nothing in the
        product reads a consent, so nothing was asked and nothing was recorded, and a switch here would have been a
        promise the panel could not keep. When something does read a consent, it becomes a real question on this page
        first, not a record with an already-decided answer. The one consent Mudavym does read — whether this
        house’s questions may help improve it — is on the consent panel, under Questions and training.
      </Note>

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

      <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-4)', margin: '14px 0 0' }}>
        What is collected and why is written out in full on the <Link to="/privacy" style={{ color: 'var(--seal-deep)' }}>privacy page</Link>.
      </p>
    </>
  );
}

export default ServicesSection;
