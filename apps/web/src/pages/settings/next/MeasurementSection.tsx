/**
 * Measurement & recipes — the only register that never leaves this machine.
 *
 * `stores/restaurantSettingsStore.ts` is zustand `persist` under
 * `restaurant-settings-storage`, i.e. localStorage. Not the restaurant, not the
 * account, not the phone. The legacy page presents these four beside genuine
 * restaurant settings with nothing saying so, which is how a house ends up with
 * two managers seeing two different default pours and no way to notice.
 *
 * There is no date to show and there never will be from here: a browser keeps
 * the value, not a history of it. That is the em dash's reason, and it is one
 * of the four that survived being checked.
 */

import { useState } from 'react';
import { useRestaurantSettingsStore } from '@/stores';
import { COMMON_POUR_SIZES, formatVolumeWithBothUnits, isValidPourSize } from '@/utils/volumeUtils';
import { Choice, Note, Row, Toggle, fieldStyle } from './SectionKit';
import { KEPT_NOTE, PROVENANCE_UNKNOWN } from './st-format';

export function MeasurementSection() {
  const {
    measurementUnit, defaultPourMl, recipesEnabled, recipeYieldUnit,
    setMeasurementUnit, setDefaultPourMl, setRecipesEnabled, setRecipeYieldUnit,
  } = useRestaurantSettingsStore();
  const preset = COMMON_POUR_SIZES.some((s) => s.ml === defaultPourMl);
  const [custom, setCustom] = useState(preset ? '' : String(defaultPourMl));

  const browser = { kept: 'browser' as const, when: null, whenUnknown: PROVENANCE_UNKNOWN.browser };

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
              style={fieldStyle}
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
                style={{ ...fieldStyle, width: 74 }}
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

export default MeasurementSection;
