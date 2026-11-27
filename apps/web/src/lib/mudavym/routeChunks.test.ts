import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadReports, ROUTE_LOADERS } from './routeChunks';

describe('route chunks', () => {
  it('the map and the router share the one memoised factory', () => {
    expect(ROUTE_LOADERS['/reports']).toBe(loadReports);
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toMatch(/ReportsNext = lazyWithRefresh\(loadReports\)/);
  });
  it('one import promise for every caller', () => {
    expect(loadReports()).toBe(loadReports());
  });
});
