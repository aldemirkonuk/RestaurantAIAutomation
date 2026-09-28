/**
 * How a coverage rule is said on screen — shared by the "Unfilled" panel and
 * the coverage-rules sheet so the two never word the same rule differently.
 */

import type { CoverageRule } from './useTeamNextData';

export const DOW_JS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Coverage rules speak "am"/"pm" — said as service language on screen. */
export function periodLabel(period: string): string {
  if (period === 'am') return 'day';
  if (period === 'pm') return 'evening';
  return period;
}

/** "Floor · Saturday evening · 3 people" — one rule, as a person says it. */
export function ruleWords(r: Pick<CoverageRule, 'role' | 'day_of_week' | 'shift_period' | 'min_staff'>): string {
  const day = r.day_of_week == null ? 'every day' : DOW_JS[r.day_of_week] ?? `day ${r.day_of_week}`;
  const people = `${r.min_staff} ${r.min_staff === 1 ? 'person' : 'people'}`;
  return `${r.role} · ${day} ${periodLabel(r.shift_period)} · ${people}`;
}

