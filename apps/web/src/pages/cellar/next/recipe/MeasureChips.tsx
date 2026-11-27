/**
 * The "Measures: As written · ml · US oz" chips (r110 drinks-g2) on the recipe
 * card's print bar and beside "Print the spec book". The choice is kept in this
 * browser per house (a convenience, never state): a browser that will not store
 * it opens on As written. As written is the default everywhere; no country
 * picks a measure for a house.
 *
 * Both rows read one store, so a choice made on the card is the book's too.
 * The text swaps; there is no motion. Chips are 44 px at 719 px and under or
 * on a coarse pointer (cellar-next.css).
 */
import { useSyncExternalStore } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';
import { MEASURES, type Measure } from './measureDialect';

const key = (houseId: string | null | undefined) => `mudavym.measure.v1:${houseId ?? '-'}`;
const listeners = new Set<() => void>();

function readMeasure(houseId: string | null | undefined): Measure {
  try {
    const v = window.localStorage.getItem(key(houseId));
    return v === 'ml' || v === 'oz' ? v : 'as_written';
  } catch {
    return 'as_written';
  }
}

function keepMeasure(houseId: string | null | undefined, m: Measure): void {
  try {
    if (m === 'as_written') window.localStorage.removeItem(key(houseId));
    else window.localStorage.setItem(key(houseId), m);
  } catch {
    /* not stored: the chips open on As written next time */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The house's chosen measure, and the way to change it. */
export function useMeasure(): [Measure, (m: Measure) => void] {
  const { activeRestaurantId } = useAuth();
  const m = useSyncExternalStore(subscribe, () => readMeasure(activeRestaurantId), () => 'as_written' as Measure);
  return [m, (next) => keepMeasure(activeRestaurantId, next)];
}

export default function MeasureChips({ value, onChange, testId }: { value: Measure; onChange: (m: Measure) => void; testId: string }) {
  return (
    <span className="cl-measures" role="group" aria-label="Measures" data-testid={testId}>
      <span className="cl-note" style={{ margin: 0 }} aria-hidden="true">
        Measures
      </span>
      {MEASURES.map((o) => (
        <button
          key={o.id}
          type="button"
          className="cl-chip cl-measure-chip cl-focus"
          aria-pressed={value === o.id}
          data-seal={value === o.id ? 'true' : 'false'}
          data-testid={`${testId}-${o.id}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
