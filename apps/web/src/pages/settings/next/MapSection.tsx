/**
 * Map — one setting, and it is real.
 *
 * `mapDefaultScope` is read by `pages/distributors/command/DistributorMapPage.tsx:36`
 * and decides how wide Find distributors frames the restaurant when it opens.
 * The date is the preference record's own, kept by
 * `user_preferences_updated_at BEFORE UPDATE` (baseline_from_production.sql:12342),
 * and it belongs to the whole record rather than to this one field — which the
 * row says, because a record-wide date presented as a field's date is a small
 * lie that compounds.
 */

import { Choice, Register, Row, SaveFailure } from './SectionKit';
import { PROVENANCE_UNKNOWN, SANS } from './st-format';
import type { SettingsNextData } from './useSettingsNextData';

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
            provenance={{ kept: 'account', when: reg.updatedAt, whenUnknown: PROVENANCE_UNKNOWN.neverWritten }}
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
          <SaveFailure failed={writer.failed} what="The frame above is still the server’s." />
          <p style={{ fontFamily: SANS, fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)', margin: '12px 0 0' }}>
            That date belongs to your whole preference record, not to this one field — the gateway dates the row
            (<code>user_preferences.updated_at</code>), and every setting kept on your account shares it.
          </p>
        </>
      )}
    </Register>
  );
}

export default MapSection;
