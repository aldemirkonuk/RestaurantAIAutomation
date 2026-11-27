/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const loadReports = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock('../../lib/mudavym/routeChunks', () => ({
  loadReports,
  ROUTE_LOADERS: { '/reports': loadReports },
}));

import { HouseRail, __resetIntent } from './HouseRail';

function rail() {
  render(
    <MemoryRouter>
      <HouseRail role="owner" flags={{ connections: true }} tucked={false} onToggle={() => {}} mod="Ctrl" />
    </MemoryRouter>,
  );
}
const setSaveData = (v: boolean | undefined) =>
  Object.defineProperty(navigator, 'connection', { value: v === undefined ? undefined : { saveData: v }, configurable: true });

beforeEach(() => {
  loadReports.mockClear();
  __resetIntent();
  setSaveData(undefined);
});
afterEach(cleanup);

describe('the rail fetches /reports on intent', () => {
  it('does not fetch on mount', () => {
    rail();
    expect(loadReports).not.toHaveBeenCalled();
  });

  it('pointerenter then focus call the loader once', () => {
    rail();
    const link = screen.getByRole('link', { name: 'Reports' });
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(loadReports).toHaveBeenCalledTimes(1);
  });

  it('a room with no loader asks for nothing', () => {
    rail();
    fireEvent.pointerEnter(screen.getByRole('link', { name: 'Settings' }));
    expect(loadReports).not.toHaveBeenCalled();
  });

  it('never when the person asked to save data', () => {
    setSaveData(true);
    rail();
    const link = screen.getByRole('link', { name: 'Reports' });
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(loadReports).not.toHaveBeenCalled();
  });
});
