/**
 * Time zone — the clock this house keeps (ADR 0207, round 3).
 *
 * THE FOUNDER, 2026-09-21, asked where a house's time zone is set: "Add it to
 * Settings". The vendor scorecard reads every on-time verdict against midnight
 * at the end of the expected day ON THIS CLOCK ("House's local midnight",
 * question 6). Until this register the column had no writer a person could
 * reach, and the real tenant's zone was empty, so its deliveries near midnight
 * were listed and not counted.
 *
 * THE RULES, the currency register's:
 *   1. Stated before it is recorded — the sentence says what Record writes.
 *   2. Offered, never applied — the country's zones come first in the list;
 *      nothing is written by opening this page.
 *   3. Three states — a failed read, an unanswered question, and an answer
 *      with who stated it.
 *
 * The role check is the gateway's (`PUT /settings/time-zone`, owner or
 * manager); the control is disabled for anyone else and says so.
 */

import { useEffect, useMemo, useState } from 'react';
import { countryCodeFor } from '@/lib/countries';
import { Action, Note, Register, Row, SaveFailure, fieldStyle } from './SectionKit';
import { EM, MONO, SANS } from './st-format';
import type { HouseTimeZoneRegister, SettingsNextData } from './useSettingsNextData';

const NO_DATE = 'no change to it has been recorded here — it was set before this register existed, or never set';

/** Every zone this browser knows, plus UTC. Derived, never typed. */
export function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const list = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...list, 'UTC'])].sort();
}

/** The zones a country keeps, when this browser can say; otherwise none. */
export function zonesOfCountry(country: string | null): string[] {
  const code = countryCodeFor(country);
  if (!code) return [];
  try {
    const l = new Intl.Locale('und', { region: code }) as Intl.Locale & {
      getTimeZones?: () => string[];
      timeZones?: string[];
    };
    const z = typeof l.getTimeZones === 'function' ? l.getTimeZones() : l.timeZones;
    return Array.isArray(z) ? z : [];
  } catch {
    return [];
  }
}

export function TimeZoneSection({ data }: { data: SettingsNextData }) {
  const { houseTimeZone, canManage, saveTimeZone, writer } = data;
  return (
    <Register remote={houseTimeZone} name="the time zone">
      {(reg) => <Body reg={reg} canManage={canManage} save={saveTimeZone} writer={writer} />}
    </Register>
  );
}

function Body({
  reg, canManage, save, writer,
}: {
  reg: HouseTimeZoneRegister;
  canManage: boolean;
  save: (zone: string) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const zones = useMemo(allZones, []);
  const theirs = useMemo(() => zonesOfCountry(reg.country).filter((z) => zones.includes(z)), [reg.country, zones]);
  const [choice, setChoice] = useState<string>(reg.zone ?? '');
  useEffect(() => {
    setChoice(reg.zone ?? '');
  }, [reg.zone]);

  const busy = writer.busy === 'time-zone';
  const dirty = choice !== '' && choice !== reg.zone;

  if (!reg.readable) {
    return (
      <div role="alert">
        <Note>
          The time zone could not be read — {reg.reason ?? 'no reason was given'}. Nothing below is claimed for it, and
          this is not the same as a house that has not been asked.
        </Note>
      </div>
    );
  }

  const statement = !dirty
    ? reg.zone
      ? `${reg.zone} is already recorded. Choose another to change it.`
      : 'Nothing is recorded yet. Choose the zone this house keeps, then Record it.'
    : `Record will write ${choice}${reg.zone ? `, replacing ${reg.zone}` : ''}.`;

  const rest = zones.filter((z) => !theirs.includes(z));

  return (
    <>
      <Note>
        A delivery is on time when it lands before midnight at the end of its expected day, on this clock. Without a
        zone, only a verdict that holds everywhere on earth is counted — a delivery within a day of midnight is listed
        and not counted.
      </Note>

      <Row
        label="Time zone"
        consequence={
          reg.zone ? (
            <>
              Midnight falls on <strong>{reg.zone}</strong> for every on-time verdict of this house.
            </>
          ) : (
            <>
              {EM} <strong>not recorded</strong>
              {reg.unreadZone ? ` (the record holds “${reg.unreadZone}”, which is not a zone this browser knows)` : ''}.
              Deliveries near midnight are listed, not counted, until one is stated.
            </>
          )
        }
        provenance={{ kept: 'restaurant', when: reg.statedAt, whenUnknown: NO_DATE, verb: 'stated' }}
        control={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label htmlFor="st-time-zone" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              Time zone
            </label>
            <select
              id="st-time-zone"
              value={choice}
              disabled={!canManage || busy}
              onChange={(e) => setChoice(e.target.value)}
              className="st-ink st-focus"
              style={{ ...fieldStyle, opacity: canManage ? 1 : 0.45, minWidth: 220 }}
            >
              <option value="">Not recorded — choose one</option>
              {theirs.length > 0 && (
                <optgroup label={`${reg.country ?? 'This country'}’s zones`}>
                  {theirs.map((z) => (
                    <option key={`c-${z}`} value={z}>
                      {z}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Every zone">
                {rest.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
            </select>
            <Action disabled={!canManage || busy || !dirty} onClick={() => void save(choice)}>
              {busy ? 'Recording…' : 'Record'}
            </Action>
          </span>
        }
      >
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
          {statement}
        </p>
        {reg.statedBy?.name && (
          <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '3px 0 0' }}>
            stated by · {reg.statedBy.name}
          </p>
        )}
        {!canManage && (
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '5px 0 0' }}>
            Only managers and owners can state the time zone this restaurant keeps. The gateway refuses it
            independently of this page.
          </p>
        )}
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The time zone was recorded, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
          </p>
        )}
      </Row>

      <SaveFailure
        failed={writer.failed?.key === 'time-zone' ? writer.failed : null}
        what="Nothing was recorded; the zone on the row is unchanged."
      />
    </>
  );
}

export default TimeZoneSection;
