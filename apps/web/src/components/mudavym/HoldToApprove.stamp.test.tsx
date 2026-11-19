/**
 * The sealed stamp lands as a stamp: from 1.15 times its size and turned 4
 * degrees, down to rest (design critic N-20). Under reduced motion nothing is
 * scheduled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HoldToApprove } from './HoldToApprove';

const press = () => fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
const original = Element.prototype.animate;
afterEach(() => {
  Element.prototype.animate = original;
  vi.unstubAllGlobals();
});

describe('HoldToApprove seal stamp', () => {
  it('animates the seal from 1.15 and -4deg to rest', async () => {
    const calls: Keyframe[][] = [];
    Element.prototype.animate = vi.fn(function (kf: Keyframe[]) {
      calls.push(kf);
      return {} as Animation;
    }) as unknown as typeof Element.prototype.animate;
    render(<HoldToApprove onApprove={vi.fn()} label="Approve" />);
    press();
    press();
    await waitFor(() => expect(calls.some((kf) => String(kf[0].transform).includes('rotate(-4deg)'))).toBe(true));
    const stampKf = calls.find((kf) => String(kf[0].transform).includes('rotate(-4deg)'))!;
    expect(stampKf[0].transform).toBe('scale(1.15) rotate(-4deg)');
    expect(stampKf[1].transform).toBe('scale(1) rotate(0deg)');
  });

  it('schedules nothing under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const spy = vi.fn(() => ({}) as Animation);
    Element.prototype.animate = spy as unknown as typeof Element.prototype.animate;
    render(<HoldToApprove onApprove={vi.fn()} label="Approve" approvedLabel="Approved" />);
    press();
    press();
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();
  });
});
