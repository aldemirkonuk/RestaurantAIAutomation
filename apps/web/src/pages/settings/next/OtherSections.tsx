/**
 * The six remaining registers: services, email, measurement, map, POS, calendar.
 *
 * Each one carries at least one thing the legacy section does not say out loud:
 *
 *  - **Services**: the four consent switches persist and nothing reads them
 *    (`servicePermissions` is written by this page and by the mobile guidance
 *    provider, and no code branches on it — grepped 2026-09-02 across web,
 *    mobile and gateway). The analytics one governs `lib/uxSignals.ts`, which
 *    is dark unless `VITE_UX_OPTIMIZER === "true"` and has no callers. Consent
 *    ahead of capability teaches people a switch means something, so it is
 *    shown as a record, not as a control. Connected apps beside it are real.
 *  - **Email**: the test send goes to the gateway's configured manager
 *    recipients, not to the name in the field.
 *  - **Measurement**: kept in this browser's localStorage. Not on the
 *    restaurant, not on your account, and not on your phone. The legacy page
 *    presents it as a restaurant setting.
 *  - **POS**: the provider choice is a bookmark for which connector's
 *    instructions you are reading — nothing in the ingest path reads it. The
 *    connection state beside it is real, and a failed status read says so
 *    instead of rendering "no checks".
 *  - **Calendar**: no external client has ever been confirmed to subscribe to
 *    this feed, and the feed is served as a download attachment. The
 *    instructions are labelled untested rather than promised.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRestaurantSettingsStore } from '@/stores';
import { COMMON_POUR_SIZES, formatVolumeWithBothUnits, isValidPourSize } from '@/utils/volumeUtils';
import { Action, Choice, ConfirmAction, Dead, Disclosure, Micro, Note, Register, Row, Toggle } from './SectionKit';
import { EM, KEPT_NOTE, MONO, SANS, fmtWhen } from './st-format';
import { senderUpdatedAt, type SettingsNextData } from './useSettingsNextData';

/* ── Services & permissions ──────────────────────────────────────────────── */

const CONSENT_EVIDENCE =
  'Written to user preferences by this page; grepped across apps/web, apps/mobile and apps/api-gateway on 2026-09-02 — no code branches on it.';

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
                    when: conn?.connectedAt ?? null,
                    whenUnknown: connected ? 'the connection records no date' : 'not connected',
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

/* ── Email sign-off ──────────────────────────────────────────────────────── */

export function EmailSection({ data }: { data: SettingsNextData }) {
  const { sender, saveSender, sendTestEmail, writer } = data;
  const [draft, setDraft] = useState<string | null>(null);
  const stored = sender.data?.body ?? '';
  const value = draft ?? stored;
  const dirty = value.trim() !== stored;

  useEffect(() => { setDraft(null); }, [sender.data?.id]);

  return (
    <Register remote={sender} name="the sign-off on file">
      {(row) => (
        <>
          <Row
            label="Sign-off name"
            provenance={{
              kept: 'restaurant',
              when: senderUpdatedAt(row),
              whenUnknown: row ? 'this row carries no changed-at date' : 'nothing is on file yet',
            }}
            consequence={
              <>
                Every outbound vendor email ends “Best regards, {value.trim() || <span>{EM} nobody</span>}”. The gateway
                substitutes it at send time in place of the old “[Manager Name]” placeholder — so an empty field is not a
                neutral default, it is a letter signed by nobody.
              </>
            }
          >
            <form
              onSubmit={(e) => { e.preventDefault(); void saveSender(value); }}
              style={{ display: 'flex', gap: 8, marginTop: 10, maxWidth: 420 }}
            >
              <label htmlFor="st-sender" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Sign-off name
              </label>
              <input
                id="st-sender"
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="The name vendors should see"
                className="st-focus"
                style={{ flex: 1, fontFamily: SANS, fontSize: 13, padding: '7px 10px', borderRadius: 8,
                  border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
              />
              <Action type="submit" disabled={!dirty || writer.busy === 'sender'}>
                {writer.busy === 'sender' ? 'Saving…' : 'Save'}
              </Action>
            </form>
          </Row>

          <Row
            label="Test the email pipeline"
            provenance={{ kept: 'restaurant', when: null, whenUnknown: 'a test send is not recorded on this page' }}
            consequence="Sends one message through the real pipeline to the gateway's configured manager recipients — not to the sign-off name above, and not to you unless you are one of them."
            control={
              <Action onClick={() => void sendTestEmail()} disabled={writer.busy === 'test-email'}>
                {writer.busy === 'test-email' ? 'Sending…' : 'Send a test'}
              </Action>
            }
          />

          {writer.failed && (
            <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>
              That did not go through — {writer.failed.message}. Nothing was changed or sent.
            </p>
          )}
        </>
      )}
    </Register>
  );
}

/* ── Measurement & recipes — the browser-kept register ───────────────────── */

export function MeasurementSection() {
  const {
    measurementUnit, defaultPourMl, recipesEnabled, recipeYieldUnit,
    setMeasurementUnit, setDefaultPourMl, setRecipesEnabled, setRecipeYieldUnit,
  } = useRestaurantSettingsStore();
  const preset = COMMON_POUR_SIZES.some((s) => s.ml === defaultPourMl);
  const [custom, setCustom] = useState(preset ? '' : String(defaultPourMl));

  const browser = { kept: 'browser' as const, when: null, whenUnknown: 'this browser keeps no history of the change' };

  return (
    <>
      <Note>
        <strong>{KEPT_NOTE.browser}</strong> These four are the only settings on this page that never leave the machine
        you are sitting at — the legacy page shows them beside restaurant settings, which is why this one says it first.
      </Note>

      <Row
        label="Display unit"
        provenance={browser}
        consequence="How every volume in the product is written out for you. It changes nothing about what is stored."
        control={
          <Choice label="Display unit" value={measurementUnit}
            options={[{ value: 'ml' as const, label: 'Metric (ml/L)' }, { value: 'oz' as const, label: 'US (oz)' }]}
            onChange={setMeasurementUnit} />
        }
      />
      <Row
        label="Default glass pour"
        provenance={browser}
        consequence={<>Used wherever a pour is assumed rather than measured. Currently {formatVolumeWithBothUnits(defaultPourMl)}. Any wine may override it.</>}
        control={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <select
              aria-label="Default glass pour"
              value={preset ? String(defaultPourMl) : 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') { setCustom(String(defaultPourMl)); return; }
                const ml = parseInt(e.target.value, 10);
                if (isValidPourSize(ml)) setDefaultPourMl(ml);
              }}
              className="st-focus"
              style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
            >
              {COMMON_POUR_SIZES.map((s) => <option key={s.ml} value={String(s.ml)}>{s.label}</option>)}
              <option value="custom">Custom</option>
            </select>
            {!preset && (
              <input
                type="number" min={30} max={500} aria-label="Custom pour in millilitres" value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={() => { const ml = parseInt(custom, 10); if (isValidPourSize(ml)) setDefaultPourMl(ml); }}
                className="st-focus"
                style={{ width: 74, fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8,
                  border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
              />
            )}
          </span>
        }
      />
      <Row
        label="Recipes"
        provenance={browser}
        consequence="Shows recipe yields and pour deductions in the product on this machine."
        control={<Toggle label="Enable recipes" checked={recipesEnabled} onChange={setRecipesEnabled} />}
      />
      {recipesEnabled && (
        <Row
          label="Recipe yield unit"
          provenance={browser}
          consequence={`Recipe yields may be written in a different unit from the display unit, which is ${measurementUnit} today.`}
          control={
            <Choice label="Recipe yield unit" value={recipeYieldUnit}
              options={[{ value: 'ml' as const, label: 'Metric (ml)' }, { value: 'oz' as const, label: 'US (oz)' }]}
              onChange={setRecipeYieldUnit} />
          }
        />
      )}
    </>
  );
}

/* ── Map ─────────────────────────────────────────────────────────────────── */

const SCOPES = [
  { value: 'continent' as const, label: 'Continent' },
  { value: 'country' as const, label: 'Country' },
  { value: 'state' as const, label: 'State' },
  { value: 'city' as const, label: 'City' },
];

export function MapSection({ data }: { data: SettingsNextData }) {
  const { prefs, savePrefs, writer } = data;
  return (
    <Register remote={prefs} name="your account preferences">
      {(reg) => (
        <>
          <Row
            label="Default view"
            provenance={{ kept: 'account', when: reg.updatedAt, whenUnknown: 'this record has never been written' }}
            consequence="How wide Find distributors frames your restaurant when it opens. Zooming on the map never changes this — it is the frame you come back to."
            control={
              <Choice
                label="Default map view"
                value={(reg.preferences.mapDefaultScope ?? 'continent') as (typeof SCOPES)[number]['value']}
                options={SCOPES}
                onChange={(v) => void savePrefs('map', { mapDefaultScope: v })}
              />
            }
          />
          {writer.failed && (
            <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', margin: '10px 0 0' }}>
              Not saved — {writer.failed.message}. The frame above is still the server’s.
            </p>
          )}
        </>
      )}
    </Register>
  );
}

/* ── POS ─────────────────────────────────────────────────────────────────── */

export function PosSection({ data }: { data: SettingsNextData }) {
  const { pos, prefs, savePrefs, writer } = data;
  // The connector choice lives in the account preferences, a SEPARATE read from
  // the POS register. Until it answers, "which connector" is unknown — not
  // "none chosen", which would be a claim about a record we have not read.
  const prefsReady = prefs.status === 'ok';
  const chosen = prefsReady
    ? (prefs.data?.preferences.posConfig as { activeProvider?: string; updatedAt?: string } | undefined)
    : undefined;

  return (
    <Register remote={pos} name="the point-of-sale register">
      {(reg) => {
        const status = reg.status;
        const sources = status?.sources ?? null;
        const active = chosen?.activeProvider ?? null;
        const chooserUnknown = prefsReady ? 'no connector has been chosen' : 'your account preferences have not answered yet';
        const provider = reg.providers.providers.find((p) => p.key === active) ?? null;

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
                provenance={{ kept: 'restaurant', when: sources?.[0]?.latest ?? null, whenUnknown: 'no check has arrived, so nothing carries a date' }}
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
              provenance={{ kept: 'account', when: chosen?.updatedAt ?? null, whenUnknown: chooserUnknown }}
              consequence={
                <>
                  This records which connector’s documentation you are looking at. It does <strong>not</strong> connect
                  anything and nothing in the ingest path reads it — a till starts sending when its own handshake
                  completes, not when this is set. {reg.providers.summary.total} connectors are described. The date
                  beside it is stamped by the browser that made the change, not by the server: it is kept inside the
                  `posConfig` value itself, because the record’s own date would belong to every other preference too.
                </>
              }
              control={
                <select
                  aria-label="POS connector"
                  value={active ?? ''}
                  disabled={writer.busy === 'pos' || !prefsReady}
                  onChange={(e) => void savePrefs('pos', { posConfig: { activeProvider: e.target.value, updatedAt: new Date().toISOString() } })}
                  className="st-focus"
                  style={{ fontFamily: SANS, fontSize: 12, padding: '5px 8px', borderRadius: 8, maxWidth: 200,
                    border: '1px solid var(--paper-2)', background: 'var(--paper-0)', color: 'var(--ink-1)' }}
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
          </>
        );
      }}
    </Register>
  );
}

/* ── Calendar subscription ───────────────────────────────────────────────── */

export function CalendarSection({ data }: { data: SettingsNextData }) {
  const { ical, regenerateIcal, writer } = data;
  const [copied, setCopied] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  return (
    <Register remote={ical} name="your subscription token">
      {(reg) => {
        const url = `${window.location.origin}/api/v1/calendar/feed/${reg.token}.ics`;
        return (
          <>
            <Note>
              This address serves your calendar as an <code style={{ fontFamily: MONO, fontSize: 11 }}>.ics</code> feed and
              needs no login — the token in it <em>is</em> the credential. Treat it as one.
            </Note>

            <Row
              label="Feed address"
              provenance={{ kept: 'restaurant', when: null, whenUnknown: 'the token is not dated' }}
              consequence="Anyone holding this address can read this restaurant's calendar."
              control={
                <Action
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      setCopied('Copied to your clipboard.');
                    } catch {
                      setCopied('This browser refused the clipboard — select the address and copy it by hand.');
                    }
                  }}
                >
                  Copy
                </Action>
              }
            >
              <p style={{ fontFamily: MONO, fontSize: 11, wordBreak: 'break-all', color: 'var(--ink-2)',
                background: 'var(--paper-1)', border: '1px solid var(--paper-2)', borderRadius: 8, padding: '7px 9px', margin: '9px 0 0' }}>
                {url}
              </p>
              {copied && <p role="status" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>{copied}</p>}
            </Row>

            <Row
              label="Start again with a new token"
              provenance={{ kept: 'restaurant', when: null, whenUnknown: 'the regeneration is not recorded' }}
              consequence="Every calendar already subscribed to the old address stops receiving anything, silently and without warning them. There is no undo, and the old address cannot be brought back."
              control={
                <ConfirmAction
                  label="Regenerate"
                  confirmLabel="Yes, break the old address"
                  busy={writer.busy === 'ical'}
                  consequence="Every existing subscription stops. There is no undo."
                  onConfirm={() => void regenerateIcal()}
                />
              }
            />

            {writer.failed && (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', marginTop: 12 }}>
                The token was not regenerated — {writer.failed.message}. The address above still works.
              </p>
            )}

            <div style={{ margin: '18px 0 0' }}><Micro>Untested</Micro></div>
            <Note>
              No external calendar client has ever been observed subscribing to this feed. The gateway serves it as
              <code style={{ fontFamily: MONO, fontSize: 11 }}> Content-Disposition: attachment</code>, which most clients
              read as “download this file once” rather than “subscribe to this address”. So the steps below are what
              <em> should</em> work, not what has been seen to.
            </Note>
            <Disclosure summary="The steps, as far as they are known" open={howOpen} onToggle={() => setHowOpen((o) => !o)}>
              <ul style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.7, color: 'var(--ink-2)', margin: 0, paddingLeft: 18 }}>
                <li><strong>Outlook</strong> — Add calendar → Subscribe from web → paste the address.</li>
                <li><strong>Apple Calendar</strong> — File → New Calendar Subscription → paste the address.</li>
                <li><strong>Google Calendar</strong> — Other calendars (+) → From URL → paste the address.</li>
              </ul>
            </Disclosure>
          </>
        );
      }}
    </Register>
  );
}
