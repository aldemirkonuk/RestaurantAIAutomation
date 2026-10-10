/**
 * Address and map point — where the house stands (F-174).
 *
 * The calendar's weather reads the house's map point and nothing else. Only
 * sign-up wrote it, so a house that typed its address by hand, or moved, read
 * "No location is set for this house" on the calendar with no way to set one:
 * the calendar sent the owner to Settings, and Settings had no address.
 *
 * What this register holds, and what it does not:
 *   1. **The point comes from a place a person picked.** The address search
 *      (`ui/PlacesAutocomplete`, the one sign-up uses) returns the street and
 *      the point together; Save sends both. Typed text alone is never saved
 *      and never turned into a point here.
 *   2. **Owner or manager.** `PUT /settings/location` checks the role in the
 *      house; the search is hidden for anyone else and the page says why, but
 *      the route is the rule.
 *   3. **A failed read says so** and is never shown as "no address".
 *   4. **Not the city, country or time zone.** Those stay with Locations and
 *      Time zone; picking a street here does not move them.
 */

import { useState } from 'react';
import { PlacesAutocomplete, type PlaceResult } from '../../../components/ui/PlacesAutocomplete';
import { Action, Note, Register, Row, SaveFailure } from './SectionKit';
import { MONO, SANS } from './st-format';
import type { HouseLocationRegister, SettingsNextData } from './useSettingsNextData';

const NO_DATE = 'this register keeps no date; a change is listed under “What changed here”';

interface Picked {
  street: string;
  latitude: number;
  longitude: number;
}

export function LocationSection({ data }: { data: SettingsNextData }) {
  const { houseLocation, canManage, saveLocation, writer } = data;
  return (
    <Register remote={houseLocation} name="the address">
      {(reg) => <LocationBody reg={reg} canManage={canManage} save={saveLocation} writer={writer} />}
    </Register>
  );
}

function LocationBody({
  reg, canManage, save, writer,
}: {
  reg: HouseLocationRegister;
  canManage: boolean;
  save: (street: string, latitude: number, longitude: number) => Promise<boolean>;
  writer: SettingsNextData['writer'];
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [noPoint, setNoPoint] = useState(false);
  const busy = writer.busy === 'location';

  if (!reg.readable) {
    return (
      <div role="alert">
        <Note>
          The address could not be read — {reg.reason ?? 'no reason was given'}. Nothing below is claimed for it, and
          this is not the same as a house with no address.
        </Note>
      </div>
    );
  }

  const hasPoint = reg.latitude !== null && reg.longitude !== null;

  const onPlace = (place: PlaceResult) => {
    const street = (place.streetAddress || place.placeName).trim();
    if (place.latitude === null || place.longitude === null || street === '') {
      setPicked(null);
      setNoPoint(true);
      return;
    }
    setNoPoint(false);
    setPicked({ street, latitude: place.latitude, longitude: place.longitude });
  };

  const onSave = async () => {
    if (!picked) return;
    const ok = await save(picked.street, picked.latitude, picked.longitude);
    if (ok) {
      setPicked(null);
      setQuery('');
    }
  };

  return (
    <>
      <Note>
        The calendar reads the weather for this point, so it needs a place picked from the search list, not typed. The
        city, country and time zone are kept under Locations and Time zone, and do not change here.
      </Note>

      <Row
        label="Street address"
        consequence={reg.street ?? <>None is recorded.</>}
        provenance={{ kept: 'restaurant', when: null, whenUnknown: NO_DATE }}
      />

      <Row
        label="Map point"
        consequence={
          hasPoint ? (
            <>
              <span style={{ fontFamily: MONO }}>
                {reg.latitude!.toFixed(4)}, {reg.longitude!.toFixed(4)}
              </span>
              . The calendar reads the weather for this point.
            </>
          ) : (
            <>
              <strong>None is recorded</strong>, so the calendar cannot show the weather. Pick the address below to set
              it.
            </>
          )
        }
        provenance={{ kept: 'restaurant', when: null, whenUnknown: NO_DATE }}
      >
        {reg.audited === false && (
          <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '5px 0 0' }}>
            The address was saved, but the change was not written to the trail — {reg.auditReason ?? 'no reason was given'}.
            &ldquo;What changed here&rdquo; will not show it.
          </p>
        )}
      </Row>

      {canManage ? (
        <div style={{ margin: '12px 0 0', maxWidth: 520 }}>
          <label htmlFor="st-location-search" style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-2)', display: 'block', margin: '0 0 6px' }}>
            {hasPoint ? 'Move the house: search for the new address' : 'Search for the house’s address'}
          </label>
          <PlacesAutocomplete
            id="st-location-search"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPicked(null);
              setNoPoint(false);
            }}
            onPlaceSelect={onPlace}
            locationBias={hasPoint ? { latitude: reg.latitude!, longitude: reg.longitude! } : null}
            placeholder="Start typing the street address…"
            disabled={busy}
          />
          {noPoint && (
            <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-1)', margin: '6px 0 0' }}>
              That result came back without a map point, so it cannot be saved. Pick another result for the same address.
            </p>
          )}
          {picked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '8px 0 0' }}>
              <p style={{ fontFamily: SANS, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', margin: 0 }}>
                {picked.street}
              </p>
              <Action onClick={() => void onSave()} disabled={busy}>
                {busy ? 'Saving…' : 'Save this address'}
              </Action>
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '8px 0 0' }}>
          Only an owner or a manager can change this.
        </p>
      )}

      <SaveFailure
        failed={writer.failed?.key === 'location' ? writer.failed : null}
        what="Nothing was changed; the address above is what is saved."
      />
    </>
  );
}

export default LocationSection;
