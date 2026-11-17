import { describe, it, expect } from 'vitest';

/**
 * The old /reports grid (arrange modal, chart config, dashboard grid, edit
 * panel, widget selector) was replaced by the house sheet under
 * `pages/reports/next`, and nothing imports it. It is taken out in three
 * steps so each diff stays readable; this test keeps what has been taken out
 * from coming back, where it would be dead code a reader takes for the live
 * page. Only `./preview` (the letter template builder's overlay) is live here.
 */
const GONE = ['EditLayoutPanel', 'WidgetSelector', 'ChartArrangementModal', 'DashboardGrid'];

describe('components/reports', () => {
  it('no longer holds the old grid components that were removed', () => {
    const files = Object.keys(import.meta.glob('./*.tsx')).map((f) => f.replace(/^\.\/|\.tsx$/g, ''));
    expect(files.filter((f) => GONE.includes(f))).toEqual([]);
  });

  it('keeps the preview overlay the template builder uses', () => {
    expect(Object.keys(import.meta.glob('./preview/index.ts'))).toEqual(['./preview/index.ts']);
  });
});
