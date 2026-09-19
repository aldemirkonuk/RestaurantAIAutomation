/**
 * Features — the register that changes what the system does on its own.
 *
 * Three groups, and the difference between them is the whole point:
 *
 *  1. **Autonomy.** The two flags real code branches on. `enable_ai_autonomous_send`
 *     is the one switch on this page whose ON means an AI-written email reaches
 *     a vendor with nobody having read it — so it is NOT a toggle. Granting it
 *     takes the house hold-to-approve ceremony, completing into the seal;
 *     revoking it is one plain button, because withdrawing autonomy must always
 *     be the cheap direction.
 *  2. **Mudavym redesign.** One flag per rebuilt page, opt-in per restaurant,
 *     OFF by default — rendered as its own clearly-labelled group so nobody
 *     mistakes a design preview for a product capability.
 *  3. **No switch.** Capabilities that exist with no per-restaurant gate. Listed
 *     WITHOUT controls (`components/settings/inactiveFeatures.ts`), which is the
 *     OD-86 settlement: 21 of the old 22 switches wrote to columns that never
 *     existed and were read by nothing.
 *
 * WHO MAY FLIP ONE (2026-09-05)
 * ----------------------------
 * `PUT /settings/feature-flags` runs `assertCanManageRestaurant`, the same
 * helper the approval thresholds use, so a member who is neither owner nor
 * manager is refused by the route. Every control below is therefore rendered
 * DISABLED with the reason for anybody else — never a live control that fails
 * after the click (ADR 0083) — and the values stay visible, because a switch
 * you cannot see is one you cannot plan around.
 *
 * Everything with a control here is a key the gateway's registry declares
 * ACTIVE and returned from `GET /settings/feature-flags`. The page renders the
 * SERVER's key set, not a list of its own — so a flag added to
 * `apps/api-gateway/src/settings/feature-flag-registry.ts` appears here without
 * this file being edited, and one removed disappears.
 */

import { useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { INACTIVE_FEATURES } from '@/components/settings/inactiveFeatures';
import { ALWAYS_ON_PAGES, type MudavymPage } from '@/lib/mudavym/useMudavymDesign';
import { Action, Micro, Note, Register, Row, Toggle } from './SectionKit';
import { EM, MONO, SANS, isRedesignFlag, titleFromFlagKey } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

/**
 * `mudavym_design_<page>` for a page in `ALWAYS_ON_PAGES` is read by nothing
 * any more (`useMudavymDesign.ts`'s `ALWAYS_ON_PAGES` short-circuits before
 * the fetch) — that page renders the new design for every house regardless
 * of this column. Rendering it here as a live `Toggle` would be exactly the
 * shape ADR 0020 forbids: a control that looks like it governs something but
 * does not. `isAlwaysOnRedesignFlag` is how `redesign.map` below tells the
 * two apart.
 */
function isAlwaysOnRedesignFlag(key: string): boolean {
  return ALWAYS_ON_PAGES.has(key.replace(/^mudavym_design_/, '') as MudavymPage);
}

const AUTONOMY = 'enable_ai_autonomous_send';
const NEGOTIATION = 'enable_ai_negotiation';
const HOUSE_INBOX = 'enable_house_inbox_read';

/** The sentence the route's refusal carries, said before the click. */
const NOT_YOURS = 'Only an owner or a manager of this restaurant may change this.';

/** The settings row carries `created_at` and no update column — so no date. */
const NO_DATE = 'the settings row has no changed-at column';

export default function FeaturesSection({ data }: { data: SettingsNextData }) {
  const { flags, saveFlag, writer, canManage } = data;
  const [attempt, setAttempt] = useState(0);

  return (
    <Register remote={flags} name="the feature register">
      {(values) => {
        const keys = Object.keys(values);
        const redesign = keys.filter(isRedesignFlag).sort();
        const other = keys.filter(
          (k) => !isRedesignFlag(k) && k !== AUTONOMY && k !== NEGOTIATION && k !== HOUSE_INBOX,
        );
        const hasHouseInbox = Object.prototype.hasOwnProperty.call(values, HOUSE_INBOX);
        const autonomyOn = values[AUTONOMY] === true;
        const failure = writer.failed;

        return (
          <>
            <Note>
              Only flags the gateway declares active render as controls. That list lives in one file —{' '}
              <code style={{ fontFamily: MONO, fontSize: 11 }}>apps/api-gateway/src/settings/feature-flag-registry.ts</code>{' '}
              — and this page renders whatever it returns, so it cannot drift out of step with it.
            </Note>

            {!canManage && (
              <p role="status" style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.55, color: 'var(--ink-4)', margin: '0 0 10px' }}>
                {NOT_YOURS} The switches below show what is set and cannot be moved from
                here; the route refuses the write too, so none of them is a control that
                would fail after you pressed it.
              </p>
            )}

            {failure && (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-1)', background: 'var(--paper-2)', borderRadius: 8, padding: '8px 11px', margin: '0 0 10px' }}>
                <strong>{titleFromFlagKey(failure.key)}</strong> was not saved — {failure.message}. Nothing changed; the
                values below are the server’s.
              </p>
            )}

            {/* ── 1. Autonomy ─────────────────────────────────────────── */}
            <div style={{ margin: '14px 0 4px' }}><Micro tone="seal">Autonomy</Micro></div>

            <Row
              label="Send AI replies without my approval"
              tone={autonomyOn ? 'grave' : undefined}
              provenance={{
                kept: 'restaurant', when: null, whenUnknown: NO_DATE,
                // Was cited in the consequence prose as :1011 (a line inside this
                // function's docblock, not the read) — corrected 2026-09-19 against
                // the actual `.select("enable_ai_autonomous_send")` call, which
                // matches the registry's own `readBy` for this key.
                readBy: <code style={{ fontFamily: MONO, fontSize: 11 }}>common/orchestrator/inbound-responder.service.ts:1027</code>,
              }}
              consequence={
                <>
                  ON means an AI-written reply leaves for your vendor with nobody having read it. You get two minutes to
                  cancel each one; a guardrail still holds a reply back for commitment language, a price above target, a
                  quantity or budget change, an unverified sender, or unclear terms.
                </>
              }
              control={
                autonomyOn ? (
                  <Action
                    tone="grave"
                    disabled={!canManage || writer.busy === AUTONOMY}
                    onClick={() => void saveFlag(AUTONOMY, false)}
                  >
                    {writer.busy === AUTONOMY ? 'Stopping…' : 'Stop sending on its own'}
                  </Action>
                ) : null
              }
            >
              {!autonomyOn && (
                <div style={{ maxWidth: 340, marginTop: 10 }}>
                  <HoldToApprove
                    key={attempt}
                    disabled={!canManage}
                    label="Hold to allow AI to send"
                    approvedLabel="Autonomous sending granted"
                    onApprove={() => {
                      setAttempt((n) => n + 1);
                      void saveFlag(AUTONOMY, true);
                    }}
                  />
                </div>
              )}
              {autonomyOn && (
                <p style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--seal-deep)', margin: '6px 0 0' }}>
                  On now. Every reply the AI writes may leave without you.
                </p>
              )}
            </Row>

            <Row
              label="Let AI handle vendor email at all"
              provenance={{
                kept: 'restaurant', when: null, whenUnknown: NO_DATE,
                // Was cited in the consequence prose as :987 (inside this
                // function's docblock, not the read) — corrected 2026-09-19 against
                // the actual `.select("enable_ai_negotiation")` call, which matches
                // the registry's own `readBy` for this key.
                readBy: <code style={{ fontFamily: MONO, fontSize: 11 }}>common/orchestrator/inbound-responder.service.ts:1003</code>,
              }}
              consequence={
                <>
                  AI reads vendor replies, works out what they mean, and drafts your answer. Off stops it reading and
                  answering vendor email entirely — including the switch above.
                </>
              }
              control={
                <Toggle
                  label="Let AI handle vendor email"
                  checked={values[NEGOTIATION] === true}
                  disabled={!canManage}
                  busy={writer.busy === NEGOTIATION}
                  onChange={(next) => void saveFlag(NEGOTIATION, next)}
                />
              }
            />

            {hasHouseInbox && (
              <Row
                label="Read this house's mailbox"
                tone={values[HOUSE_INBOX] === true ? 'grave' : undefined}
                provenance={{
                  kept: 'restaurant', when: null, whenUnknown: NO_DATE,
                  readBy: <code style={{ fontFamily: MONO, fontSize: 11 }}>communications/inbox/house-inbox.service.ts:339</code>,
                }}
                consequence={
                  <>
                    ON means a scheduled job reads the mail in the account somebody here
                    connected, and files vendor replies against your orders. A person&apos;s
                    consent is necessary and not sufficient: they agreed for themselves, and
                    this switch is the house agreeing. Off is the default and every uncertain
                    answer — no row, a failed read — is treated as off.
                  </>
                }
                control={
                  <Toggle
                    label="Read this house's mailbox"
                    checked={values[HOUSE_INBOX] === true}
                    disabled={!canManage}
                    busy={writer.busy === HOUSE_INBOX}
                    onChange={(next) => void saveFlag(HOUSE_INBOX, next)}
                  />
                }
              />
            )}

            {/* ── 2. The redesign flags ───────────────────────────────── */}
            {redesign.length > 0 && (
              <>
                <div style={{ margin: '20px 0 4px' }}><Micro tone="seal">Mudavym redesign · {redesign.length} pages</Micro></div>
                <Note>
                  One switch per rebuilt page, opt-in for this restaurant and off by default. While a switch is off the
                  page you already know renders unchanged. A per-browser override —{' '}
                  <code style={{ fontFamily: MONO, fontSize: 11 }}>localStorage["mudavym.design.&lt;page&gt;"]</code> — beats
                  the switch on this machine only, which is how a design is reviewed without turning it on for the floor.
                </Note>
                {redesign.map((key) => {
                  const alwaysOn = isAlwaysOnRedesignFlag(key);
                  return (
                    <Row
                      key={key}
                      label={titleFromFlagKey(key)}
                      provenance={{
                        kept: 'restaurant', when: null, whenUnknown: NO_DATE,
                        // Matches the registry's own `readBy` for every
                        // `mudavym_design_*` key: useMudavymDesign.ts:105:
                        // `.checkFeatureFlag(restaurantId, flagKeyFor(page))`.
                        // For a page in ALWAYS_ON_PAGES the hook returns before
                        // that call ever runs (see its module doc above) — the
                        // column is real but nothing reads it any more.
                        readBy: alwaysOn
                          ? "nothing — useMudavymDesign.ts's ALWAYS_ON_PAGES short-circuits before the fetch"
                          : <code style={{ fontFamily: MONO, fontSize: 11 }}>lib/mudavym/useMudavymDesign.ts:105</code>,
                      }}
                      consequence={
                        alwaysOn ? (
                          <>
                            Live for every restaurant already — this page resolves the Mudavym design in code, not
                            from this switch (ADR 0149 row 36; the sketch review that cleared it is ADR 0160). The
                            stored value below no longer changes anything; it is kept only because the column has not
                            been retired yet.
                          </>
                        ) : (
                          <>
                            Renders the Mudavym design of this page for everyone at this restaurant.{' '}
                            <code style={{ fontFamily: MONO, fontSize: 11 }}>{key}</code>
                          </>
                        )
                      }
                      control={
                        alwaysOn ? (
                          <span
                            style={{
                              fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
                              color: 'var(--ink-4)', border: '1px dashed var(--paper-2)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
                            }}
                          >
                            live for everyone
                          </span>
                        ) : (
                          <Toggle
                            label={`${titleFromFlagKey(key)} — Mudavym design`}
                            checked={values[key] === true}
                            disabled={!canManage}
                            busy={writer.busy === key}
                            onChange={(next) => void saveFlag(key, next)}
                          />
                        )
                      }
                    />
                  );
                })}
              </>
            )}

            {/* ── Any other active flag the registry grows ────────────── */}
            {other.length > 0 && (
              <>
                <div style={{ margin: '20px 0 4px' }}><Micro>Other active flags</Micro></div>
                {other.map((key) => (
                  <Row
                    key={key}
                    label={titleFromFlagKey(key)}
                    provenance={{ kept: 'restaurant', when: null, whenUnknown: NO_DATE }}
                    consequence={
                      <>
                        Declared active by the registry. This page holds no description of what it changes —{' '}
                        {EM} see its <code style={{ fontFamily: MONO, fontSize: 11 }}>readBy</code> entry in the registry.
                      </>
                    }
                    control={
                      <Toggle
                        label={titleFromFlagKey(key)}
                        checked={values[key] === true}
                        disabled={!canManage}
                        busy={writer.busy === key}
                        onChange={(next) => void saveFlag(key, next)}
                      />
                    }
                  />
                ))}
              </>
            )}

            {/* ── 3. No switch ────────────────────────────────────────── */}
            <div style={{ margin: '20px 0 4px' }}><Micro>No switch · {INACTIVE_FEATURES.length} capabilities</Micro></div>
            <Note>
              These exist and are on for everyone who can reach them. There is no per-restaurant gate behind any of them,
              so there is nothing here a switch could do — and one that looked as if it could is exactly what this page
              used to get wrong.
            </Note>
            {INACTIVE_FEATURES.map((f) => (
              <Row
                key={f.label}
                label={f.label}
                consequence={f.description}
                control={
                  <span
                    style={{
                      fontFamily: MONO, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase',
                      color: 'var(--ink-4)', border: '1px dashed var(--paper-2)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
                    }}
                  >
                    no switch
                  </span>
                }
              />
            ))}
          </>
        );
      }}
    </Register>
  );
}
