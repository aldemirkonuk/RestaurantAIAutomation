/**
 * Map — one setting, and nothing reads it any more (F-500, 2026-10-09).
 *
 * `mapDefaultScope` was read by `pages/distributors/command/DistributorMapPage.tsx`,
 * which was deleted in da04b6f85 (#494); `/distributors` now redirects to
 * /vendors, and no surface in apps/web or apps/mobile reads the field. So the
 * row is rendered as `Dead` — the stored value as text, no control — rather
 * than as a choice that frames a map nobody can open (ADR 0020). Wiring it
 * back needs a vendor map to frame first; nothing obvious exists to wire it to.
 */

import { Dead, Register } from './SectionKit';
import type { SettingsNextData } from './useSettingsNextData';

const SCOPE_LABEL: Record<string, string> = {
  continent: 'Continent',
  country: 'Country',
  state: 'State',
  city: 'City',
};

export function MapSection({ data }: { data: SettingsNextData }) {
  const { prefs } = data;
  return (
    <Register remote={prefs} name="your account preferences">
      {(reg) => {
        const stored = reg.preferences.mapDefaultScope;
        return (
          <Dead
            label="Default view"
            stored={stored ? `stored: ${SCOPE_LABEL[stored] ?? stored}` : 'never set'}
            consequence="This chose how wide the vendor map opened. That map has been retired, so changing this would change nothing you can see."
            evidence="The vendor map that read it was removed when Distributors became Vendors; nothing else in the product reads this preference."
          />
        );
      }}
    </Register>
  );
}

export default MapSection;
