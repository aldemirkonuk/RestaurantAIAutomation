/**
 * Point of sale — what the till has actually sent, and a bookmark beside it.
 *
 * Two rows that look alike and are not. "Checks received" is a figure of record
 * read from `/pos-hub/status/:rid`; a failed read of it says so instead of
 * rendering "no checks", because those two states look identical and mean
 * opposite things. "Connector" is a documentation bookmark — nothing in the
 * ingest path reads `posConfig.activeProvider`, and a till starts sending when
 * its own handshake completes.
 *
 * THE DATE THIS ROW NO LONGER STAMPS (audit NIT 8)
 * -----------------------------------------------
 * The first pass wrote `updatedAt: new Date().toISOString()` into the
 * `posConfig` blob on every change and printed it back as the row's provenance.
 * It was labelled honestly as a client stamp, but a date produced by the
 * browser's own clock and then read back as a record is a record of nothing —
 * a machine two hours out, or a second tab, and the page is quoting itself.
 * The stamp is gone. The row now carries the preference record's own
 * server-side date and says out loud that it belongs to every account-kept
 * setting together, which is a smaller claim and a true one. A `posConfig.updatedAt`
 * left in an existing row by the first pass is simply never read.
 */

import { Micro, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, MONO, SANS } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

export function PosSection({ data }: { data: SettingsNextData }) {
  const { pos, prefs, savePrefs, writer } = data;
  // The connector choice lives in the account preferences, a SEPARATE read from
  // the POS register. Until it answers, "which connector" is unknown — not
  // "none chosen", which would be a claim about a record we have not read.
  const prefsReady = prefs.status === 'ok';
  const chosen = prefsReady
    ? (prefs.data?.preferences.posConfig as { activeProvider?: string } | undefined)
    : undefined;

  return (
    <Register remote={pos} name="the point-of-sale register">
      {(reg) => {
        const status = reg.status;
        const sources = status?.sources ?? null;
        const active = chosen?.activeProvider ?? null;
        const provider = reg.providers.providers.find((p) => p.key === active) ?? null;
        const chooserUnknown = prefsReady
          ? 'nothing has been chosen, so nothing has been written'
          : 'your account preferences have not answered yet';

        return (
          <>
            <div style={{ margin: '4px 0 0' }}><Micro tone="seal">What the till has sent</Micro></div>
            {reg.statusError ? (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 0' }}>
                The check register could not be read — {reg.statusError}. That is not the same as a till that has sent
                nothing, and nothing below is claimed for it.
              </p>
            ) : status?.unavailable ? (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-2)', margin: '6px 0 0' }}>
                The gateway reached for the check register and could not read it. Whether a till is connected is unknown —
                it is not “no checks”.
              </p>
            ) : (
              <Row
                label="Checks received"
                provenance={{
                  kept: 'restaurant',
                  verb: 'last check',
                  when: sources?.[0]?.latest ?? null,
                  whenUnknown: 'no check has arrived, so nothing carries a date',
                }}
                consequence={
                  sources && sources.length > 0 ? (
                    <>
                      {sources.map((s) => `${s.providerName ?? s.source}: ${s.checks ?? EM}`).join(' · ')}
                    </>
                  ) : (
                    <>No till has sent a check. The register answered, and it is empty — no connection has been made yet.</>
                  )
                }
                control={
                  <span style={{ fontFamily: MONO, fontSize: 16, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-1)' }}>
                    {status?.totalChecks ?? EM}
                  </span>
                }
              />
            )}

            <div style={{ margin: '20px 0 0' }}><Micro>Which connector you are reading about</Micro></div>
            <Row
              label="Connector"
              provenance={{
                kept: 'account',
                when: prefsReady ? (prefs.data?.updatedAt ?? null) : null,
                whenUnknown: chooserUnknown,
              }}
              consequence={
                <>
                  This records which connector’s documentation you are looking at. It does <strong>not</strong> connect
                  anything and nothing in the ingest path reads it — a till starts sending when its own handshake
                  completes, not when this is set. {reg.providers.summary.total} connectors are described. The date
                  beside it is your preference record’s, shared with every other setting kept on your account; nothing
                  dates this choice on its own.
                </>
              }
              control={
                <select
                  aria-label="POS connector"
                  value={active ?? ''}
                  disabled={writer.busy === 'pos' || !prefsReady}
                  onChange={(e) => void savePrefs('pos', { posConfig: { activeProvider: e.target.value } })}
                  className="st-focus"
                  style={{ ...fieldStyle, maxWidth: 200 }}
                >
                  <option value="">{EM} none chosen</option>
                  {reg.providers.providers.map((p) => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              }
            />
            {provider && (
              <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ink-3)', margin: '8px 0 0' }}>
                {provider.name} — adapter {provider.status}, {provider.authModel.replace('_', ' ')} authentication.
                {provider.docsUrl && (
                  <> <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="st-focus" style={{ color: 'var(--seal-deep)' }}>Provider documentation</a>.</>
                )}
              </p>
            )}
            <SaveFailure failed={writer.failed} what="The connector above is still the server’s." />
          </>
        );
      }}
    </Register>
  );
}

export default PosSection;
