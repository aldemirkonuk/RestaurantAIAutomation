/**
 * F-198 / F-200 — the week grid.
 *
 *  - F-200: on a phone, a finger swiping across an entry used to move it (the
 *    block picked up on pointerdown and saved on pointerup). A finger now has
 *    to hold still on the block first; a mouse drag is unchanged.
 *  - F-198: a timed entry that runs into the next day is on the hour ruler on
 *    its first day only, and a ribbon on the days it carries on into.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import TimeGrid, { HOLD_MS } from './TimeGrid';
import type { CalEvent, CalendarData } from './useCalendarNextData';

function event(over: Partial<CalEvent> & { id: string; title: string; date: string }): CalEvent {
  return {
    seriesId: over.id,
    isOccurrence: false,
    description: null,
    type: 'meeting',
    endDate: null,
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    status: 'pending',
    providerId: null,
    orderId: null,
    source: 'manual',
    color: null,
    isRecurring: false,
    reminderEnabled: false,
    reminderDaysBefore: null,
    reminderSent: false,
    ...over,
  };
}

function mkData(events: CalEvent[], byDay: Map<string, CalEvent[]>) {
  return {
    events,
    byDay,
    isRuledOff: () => false,
    update: { mutate: vi.fn(), isPending: false, error: null },
  } as unknown as CalendarData & { update: { mutate: ReturnType<typeof vi.fn> } };
}

/** Thursday 2026-09-17, day view. */
const cursor = new Date(2026, 8, 17, 12);

function drawOne(e: CalEvent) {
  const data = mkData([e], new Map([[e.date, [e]]]));
  render(<TimeGrid data={data} cursor={cursor} days={1} onOpenEvent={() => {}} onCreateAt={() => {}} />);
  const block = screen.getByText(e.title).closest('.cn-block') as HTMLElement;
  return { data, block };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TimeGrid — a finger swipe never moves an entry (F-200)', () => {
  const crate = () => event({ id: 'e1', title: 'Wine crate', date: '2026-09-17' });

  it('a touch that swipes straight away scrolls, and saves nothing', () => {
    vi.useFakeTimers();
    const { data, block } = drawOne(crate());
    fireEvent.pointerDown(block, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 160 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 50);
    });
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 160 });
    expect(data.update.mutate).not.toHaveBeenCalled();
  });

  it('a touch that lifts before the hold saves nothing, even after a small drift', () => {
    vi.useFakeTimers();
    const { data, block } = drawOne(crate());
    fireEvent.pointerDown(block, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 50);
    });
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 160 });
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 160 });
    expect(data.update.mutate).not.toHaveBeenCalled();
  });

  it('a finger held still picks the entry up, and then it moves', () => {
    vi.useFakeTimers();
    const { data, block } = drawOne(crate());
    fireEvent.pointerDown(block, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 10);
    });
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 144 });
    fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 144 });
    expect(data.update.mutate).toHaveBeenCalledTimes(1);
    expect(data.update.mutate.mock.calls[0][0].patch).toMatchObject({ eventTime: '10:00', eventTimeEnd: '11:00' });
  });

  it('a cancelled touch gesture saves nothing', () => {
    vi.useFakeTimers();
    const { data, block } = drawOne(crate());
    fireEvent.pointerDown(block, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 10);
    });
    fireEvent.pointerMove(window, { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 144 });
    fireEvent.pointerCancel(window, { pointerType: 'touch', pointerId: 1 });
    expect(data.update.mutate).not.toHaveBeenCalled();
  });

  it('a mouse drag still moves the entry at once', () => {
    const { data, block } = drawOne(crate());
    fireEvent.pointerDown(block, { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 144 });
    fireEvent.pointerUp(window, { pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 144 });
    expect(data.update.mutate).toHaveBeenCalledTimes(1);
    expect(data.update.mutate.mock.calls[0][0].patch).toMatchObject({ eventTime: '10:00' });
  });
});

describe('TimeGrid — an entry that runs past midnight (F-198)', () => {
  it('sits on the hour ruler on its first day and as a ribbon on the next', () => {
    const late = event({
      id: 'e2',
      title: 'Overnight stocktake',
      date: '2026-09-16',
      endDate: '2026-09-17',
      startTime: '22:00',
      endTime: '23:00',
    });
    const data = mkData([late], new Map([
      ['2026-09-16', [late]],
      ['2026-09-17', [late]],
    ]));
    render(<TimeGrid data={data} cursor={cursor} days={1} onOpenEvent={() => {}} onCreateAt={() => {}} />);
    const ribbon = screen.getByText('Overnight stocktake').closest('button')!;
    expect(ribbon).toHaveClass('cn-ribbon');
    expect(ribbon.getAttribute('title')).toMatch(/carries on from Wed, Sep 16/);
    expect(document.querySelector('.cn-block')).toBeNull();
  });
});
