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
 *
 * F-501 (2026-10-09): only `measurementUnit` has readers (the inventory page,
 * its row expansion and the add-wine dialog). `defaultPourMl`, `recipesEnabled`
 * and `recipeYieldUnit` are written here and read by nothing in apps/web, so
 * they render as `Dead` — the stored value, no control. The pour that does
 * change advice is the house's confirmed pour size under "What margin does it
 * need?", kept on the restaurant; the row says where to go instead.
 */

import { useRestaurantSettingsStore } from '@/stores';
import { formatVolumeWithBothUnits } from '@/utils/volumeUtils';
import { Choice, Dead, Note, Row } from './SectionKit';
import { KEPT_NOTE, PROVENANCE_UNKNOWN } from './st-format';

export function MeasurementSection() {
  const { measurementUnit, defaultPourMl, recipesEnabled, recipeYieldUnit, setMeasurementUnit } =
    useRestaurantSettingsStore();

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
      <Dead
        label="Default glass pour"
        stored={`stored: ${formatVolumeWithBothUnits(defaultPourMl)}`}
        consequence={
          <>
            Nothing uses this pour. The pour that prices your glasses is the one this restaurant confirms under{' '}
            <a href="#st-section-target-margin" style={{ color: 'var(--seal-deep)' }}>What margin does it need?</a>
          </>
        }
        evidence="Kept in this browser and read by no page."
      />
      <Dead
        label="Recipes"
        stored={recipesEnabled ? 'stored: on' : 'stored: off'}
        consequence="Nothing shows recipe yields or pour deductions based on this, so a switch here would change nothing."
        evidence="Kept in this browser and read by no page."
      />
      <Dead
        label="Recipe yield unit"
        stored={`stored: ${recipeYieldUnit}`}
        consequence="Nothing writes recipe yields in this unit; volumes follow the display unit above."
        evidence="Kept in this browser and read by no page."
      />
    </>
  );
}

export default MeasurementSection;
