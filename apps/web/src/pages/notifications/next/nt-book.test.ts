/**
 * The day rail, the quick search, and the fold correction.
 *
 * The fold case is the one that matters most: it is written from the measured
 * production shape (a below-par burst whose highest-count member is hours
 * older than its newest), and it fails if the page goes back to trusting the
 * winner's own stamp.
 */

import { describe, expect, it } from 'vitest';
import type { Notification } from '@/services/api/notifications';
import { collapseStackedNotifications } from '@/lib/notificationStack';
import { TYPE_CHOICES, dayCells, dayKeyOf, daySpan, foldFreshness, matchesQuery } from './nt-book';
import { KIND_ORDER, kindOf } from './nt-format';

function n(over: Partial<Notification>): Notification {
  return {
    id: 'x',
    userId: 'u',
    restaurantId: 'r',
    type: 'inventory_low_stock',
    title: 'a line',
    message: 'a message',
    status: 'unread',
    priority: 'high',
    metadata: {},
    timestamp: '2026-09-03T10:00:00.000Z',
    createdAt: '2026-09-03T10:00:00.000Z',
    ...over,
  } as Notification;
}

describe('foldFreshness', () => {
  it('finds the newest member of a fold whose winner is older — the measured case', () => {
    // Production, restaurant 550e8400…, 2026-09-03: the stacker keeps the
    // highest-count burst ("50 wines dropped below par", 11:24) and folds the
    // newest one ("20 wines dropped below par", 16:44) into it, so the line
    // stood for news five hours fresher than the age it printed.
    // Since main's #313 (2026-09-05) the stacker folds two low-stock alerts
    // only when they name the SAME wines (metadata.wines); the measured pair
    // named different wines and no longer folds, so this fixture names one
    // set on both — the freshness fault it pins is about the fold, not the
    // wines.
    const winner = n({
      id: 'big',
      title: '50 wines dropped below par',
      timestamp: '2026-09-03T11:24:13.000Z',
      createdAt: '2026-09-03T11:24:13.000Z',
      metadata: { wines: [{ wineId: 'w1' }, { wineId: 'w2' }] },
    });
    const fresher = n({
      id: 'new',
      title: '20 wines dropped below par',
      timestamp: '2026-09-03T16:44:09.000Z',
      createdAt: '2026-09-03T16:44:09.000Z',
      metadata: { wines: [{ wineId: 'w1' }, { wineId: 'w2' }] },
    });
    const raw = [winner, fresher];
    const stack = collapseStackedNotifications(raw);
    // Sanity: the stacker really does keep the older, bigger one.
    expect(stack.items).toHaveLength(1);
    expect(stack.items[0].id).toBe('big');

    const out = foldFreshness(raw, stack.items, stack.foldedById);
    expect(out.big.winnerIsStale).toBe(true);
    expect(out.big.newestAt).toBe(new Date('2026-09-03T16:44:09.000Z').getTime());
  });

  it('says nothing about a line that folded nothing', () => {
    const only = n({ id: 'solo', type: 'report', title: 'Weekly report ready' });
    const stack = collapseStackedNotifications([only]);
    expect(foldFreshness([only], stack.items, stack.foldedById)).toEqual({});
  });

  it('does not call a winner stale when it is already the newest of its fold', () => {
    const newest = n({
      id: 'a',
      title: '50 wines dropped below par',
      timestamp: '2026-09-03T16:00:00.000Z',
      createdAt: '2026-09-03T16:00:00.000Z',
      metadata: { wines: [{ wineId: 'w1' }, { wineId: 'w2' }] },
    });
    const older = n({
      id: 'b',
      title: '2 wines dropped below par',
      timestamp: '2026-09-03T09:00:00.000Z',
      createdAt: '2026-09-03T09:00:00.000Z',
      metadata: { wines: [{ wineId: 'w1' }, { wineId: 'w2' }] },
    });
    const raw = [newest, older];
    const stack = collapseStackedNotifications(raw);
    const out = foldFreshness(raw, stack.items, stack.foldedById);
    expect(out[stack.items[0].id].winnerIsStale).toBe(false);
  });
});

describe('daySpan / dayKeyOf', () => {
  it('spans the reader’s own local day, not UTC’s', () => {
    const span = daySpan('2026-09-03');
    expect(span).not.toBeNull();
    const from = new Date(span!.dateFrom);
    const to = new Date(span!.dateTo);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(dayKeyOf(span!.dateFrom)).toBe('2026-09-03');
    expect(dayKeyOf(span!.dateTo)).toBe('2026-09-03');
  });

  it('refuses a key it cannot parse rather than inventing a window', () => {
    expect(daySpan('yesterday')).toBeNull();
    expect(dayKeyOf(null)).toBeNull();
    expect(dayKeyOf('not a date')).toBeNull();
  });
});

describe('dayCells — the month, and the one negative claim this page may make', () => {
  const at = (d: number, h = 9) => new Date(2026, 8, d, h, 0, 0).toISOString();
  const base = { month: '2026-09', today: '2026-09-03', dayFiltered: false };
  const rows = [
    n({ id: '1', timestamp: at(3), createdAt: at(3) }),
    n({ id: '2', timestamp: at(3), createdAt: at(3), status: 'read' }),
    n({ id: '3', timestamp: at(1), createdAt: at(1) }),
  ];

  it('draws the whole month and counts only the rows on screen', () => {
    const cells = dayCells({ ...base, rows });
    expect(cells).toHaveLength(30);
    const third = cells.find((c) => c.key === '2026-09-03')!;
    expect(third.onScreen).toBe(2);
    expect(third.open).toBe(1);
    expect(cells.find((c) => c.key === '2026-09-01')!.onScreen).toBe(1);
  });

  it('HATCHES a day the loaded pages cover and the register wrote nothing on', () => {
    // The register is read newest-first and contiguously, so a gap between two
    // loaded rows cannot be hiding a line. The 2nd is such a gap.
    const cells = dayCells({ ...base, rows });
    expect(cells.find((c) => c.key === '2026-09-02')!.records).toBe('none');
    expect(cells.find((c) => c.key === '2026-09-03')!.records).toBe('yes');
  });

  it('claims nothing about a day older than the oldest row loaded', () => {
    // The page boundary can fall inside a day, so even the oldest day is only
    // safe because it HAS a row; everything before it was never read.
    const cells = dayCells({ ...base, rows });
    expect(cells.find((c) => c.key === '2026-08-31' || c.key === '2026-09-01')!.records).toBe(
      'yes',
    );
    const august = dayCells({ ...base, month: '2026-08', rows });
    expect(august.every((c) => c.records === 'unknown')).toBe(true);
  });

  it('claims nothing about any day when nothing has been loaded', () => {
    expect(dayCells({ ...base, rows: [] }).every((c) => c.records === 'unknown')).toBe(true);
  });

  it('claims nothing about the other days while a DAY filter is on', () => {
    const cells = dayCells({ ...base, rows, dayFiltered: true });
    expect(cells.find((c) => c.key === '2026-09-02')!.records).toBe('unknown');
    expect(cells.find((c) => c.key === '2026-09-03')!.records).toBe('yes');
  });

  it('never hatches a day that has not happened', () => {
    const cells = dayCells({ ...base, rows });
    expect(cells.filter((c) => c.key > '2026-09-03').every((c) => c.records === 'unknown')).toBe(
      true,
    );
  });
});

describe('matchesQuery', () => {
  it('searches the text that is DRAWN, so the emoji never has to be typed', () => {
    const row = n({ title: '\u{1F6A8} 50 wines dropped below par' });
    expect(matchesQuery(row, 'below par')).toBe(true);
    expect(matchesQuery(row, '50 wines')).toBe(true);
    expect(matchesQuery(row, 'chablis')).toBe(false);
  });

  it('matches on the register name and on the stored type', () => {
    const row = n({ type: 'report', title: 'Weekly report ready' });
    expect(matchesQuery(row, 'Reports')).toBe(true);
    expect(matchesQuery(row, 'report')).toBe(true);
  });

  it('requires every word, and an empty query keeps everything', () => {
    const row = n({ title: 'Terra Nostra invoice 88214 is past its terms' });
    expect(matchesQuery(row, 'terra 88214')).toBe(true);
    expect(matchesQuery(row, 'terra chablis')).toBe(false);
    expect(matchesQuery(row, '   ')).toBe(true);
  });
});

describe('TYPE_CHOICES', () => {
  it('cannot disagree with the register a line lands in', () => {
    // The pill draws the register's mark and the line draws it again from the
    // row's own `type`. If these two ever diverge the page shows one register
    // filtering and a different register arriving — so the invariant is pinned
    // rather than trusted.
    for (const c of TYPE_CHOICES) {
      expect(kindOf(c.type), `${c.type} pill says ${c.kind}`).toBe(c.kind);
      expect(KIND_ORDER as readonly string[]).toContain(c.kind);
    }
  });

  it('does not offer a filter for a type nothing writes', () => {
    // `ai_suggestion` is a member of `NotificationType`
    // (notifications/dto/notifications.dto.ts:29) and no producer in the
    // gateway or the orchestrator writes it. Offering it would be a control
    // that can only ever return an empty book.
    expect(TYPE_CHOICES.map((c) => c.type)).not.toContain('ai_suggestion');
    // …but a row of that type would still be drawn under a named register.
    expect(kindOf('ai_suggestion')).toBe('Advice');
  });

  it('offers no priority filter, because priority is a constant', () => {
    // 631 of 663 rows on the live register are `critical` (page note §9.12).
    const asJson = JSON.stringify(TYPE_CHOICES);
    for (const p of ['critical', 'high', 'medium', 'low']) {
      expect(asJson).not.toContain(`"${p}"`);
    }
  });
});
