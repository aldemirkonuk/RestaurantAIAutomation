/**
 * The KPI row on a phone is one scroll-snap strip of 112 x 72 tiles, not a
 * 2-column grid that leaves an orphan tile and a hole (design need N-11).
 * From 640 px up the grid is unchanged.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import KpiRow from './KpiRow';

const css = readFileSync(resolve(__dirname, 'dashboard-next.css'), 'utf8').replace(/\s+/g, ' ');
const phone = /@media \(max-width: 639px\) \{ \.dn-kpis \{(.*?)\} \.dn-kpis > \* \{(.*?)\}/.exec(css);

describe('KPI strip on a phone', () => {
  it('is a snap strip of tiles at least 112 x 72', () => {
    expect(phone).not.toBeNull();
    expect(phone![1]).toContain('display: flex');
    expect(phone![1]).toContain('overflow-x: auto');
    expect(phone![1]).toContain('scroll-snap-type: x mandatory');
    expect(phone![2]).toContain('min-width: 112px');
    expect(phone![2]).toContain('min-height: 72px');
    expect(phone![2]).toContain('scroll-snap-align: start');
  });

  it('marks the row the css names and keeps the desktop grid classes', () => {
    const { container } = render(
      <MemoryRouter>
        <KpiRow stats={undefined} pendingCount={undefined} lowStockCount={undefined} />
      </MemoryRouter>,
    );
    const row = container.querySelector('[data-tour="dashboard-kpis"]') as HTMLElement;
    expect(row.className).toContain('dn-kpis');
    expect(row.className).toContain('sm:grid-cols-3');
    expect(row.className).toContain('lg:grid-cols-5');
  });
});
