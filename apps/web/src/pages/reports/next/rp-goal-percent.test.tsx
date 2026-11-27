/**
 * r31 walk w3, F1: typing "50" as a wine attach rate's target stored 50
 * against a 0-1 share, and the goal then read "5000.0%". A percent target is
 * typed in per cent and sent as a share; an edit shows the share back in per
 * cent; and more than 100 per cent is refused before it is sent.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GoalForm, targetShown, targetToSend } from './rp-registers-goals';
import { ratioPct } from './rp-format';

const metrics = [
  { key: 'wine_revenue', label: 'Wine revenue', unit: 'currency' },
  { key: 'wine_attach_rate', label: 'Wine attach rate', unit: 'percent' },
];
const scenarios = { book: undefined, loading: false, failure: 'No book here.' };
const request = { send: () => {}, busy: false, note: null, error: null, reset: () => {} };

function form(initial: Record<string, unknown> | null, onSubmit = vi.fn()) {
  render(
    <GoalForm
      metrics={metrics}
      scenarios={scenarios}
      scenarioRequest={request}
      initial={initial as never}
      submitLabel="Set the goal"
      busy={false}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  return onSubmit;
}

describe('a percent goal is typed in per cent and kept as a share (r31 w3 F1)', () => {
  it('50 is sent as 0.5, and 0.5 reads 50.0%', () => {
    expect(targetToSend(50, 'percent')).toBe(0.5);
    expect(ratioPct(targetToSend(50, 'percent'))).toBe('50.0%');
    expect(targetToSend(12.5, 'percent')).toBe(0.125);
    expect(targetToSend(9000, 'currency')).toBe(9000);
    expect(targetToSend(null, 'percent')).toBeNull();
  });

  it('a stored share is shown back in per cent, with no float tail', () => {
    expect(targetShown(0.5, 'percent')).toBe('50');
    expect(targetShown(0.07, 'percent')).toBe('7');
    expect(targetShown(9000, 'currency')).toBe('9000');
    expect(targetShown(null, 'percent')).toBe('');
  });

  it('a new wine attach goal: the box says %, and "50" is sent as 0.5', () => {
    const onSubmit = form(null);
    fireEvent.change(screen.getByPlaceholderText('Lift wine revenue before the holidays'), { target: { value: 'More wine' } });
    fireEvent.change(screen.getByDisplayValue('Wine revenue'), { target: { value: 'wine_attach_rate' } });
    expect(screen.getByText('Target (%)')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('50'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Set the goal'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ metricKey: 'wine_attach_rate', targetValue: 0.5 }));
  });

  it('editing a kept 0.5 shows 50, and 60 is sent as 0.6', () => {
    const onSubmit = form({ id: 'g1', name: 'More wine', metricKey: 'wine_attach_rate', unit: 'percent', target: 0.5 });
    const box = screen.getByDisplayValue('50');
    fireEvent.change(box, { target: { value: '60' } });
    fireEvent.click(screen.getByText('Set the goal'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetValue: 0.6 }));
  });

  it('more than 100% is refused before it is sent, in words', () => {
    const onSubmit = form({ id: 'g1', name: 'More wine', metricKey: 'wine_attach_rate', unit: 'percent', target: 0.5 });
    fireEvent.change(screen.getByDisplayValue('50'), { target: { value: '150' } });
    expect(screen.getByText(/A share is at most 100%/)).toBeTruthy();
    fireEvent.click(screen.getByText('Set the goal'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a money goal is sent as typed', () => {
    const onSubmit = form({ id: 'g2', name: 'Wine money', metricKey: 'wine_revenue', unit: 'currency', target: 60000 });
    expect(screen.getByText('Target')).toBeTruthy();
    fireEvent.click(screen.getByText('Set the goal'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ targetValue: 60000 }));
  });
});
