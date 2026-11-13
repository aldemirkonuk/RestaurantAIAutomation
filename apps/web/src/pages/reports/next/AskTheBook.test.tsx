/**
 * Ask the book finds a sentence by the words a Turkish house writes, and by
 * the category word the page shows (r28 /reports audit, gap 12).
 *
 * The search split on `[^a-z0-9]`, so "Öküzgözü" folded to no token and the
 * palette answered with every sentence it had; "Kalecik Karası" matched on
 * "kalecik" alone; and the category was searched by its stored key ("staff")
 * while the page shows "Team".
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskTheBook, foldText, rank, tokensOf } from './AskTheBook';
import type { ReadingRow } from './useReportsNextData';

const row = (ruleKey: string, sentence: string, category = 'sales', score = 1, entityLabel: string | null = null): ReadingRow => ({
  ruleKey,
  sentence,
  category,
  score,
  entityLabel,
});

const ROWS: ReadingRow[] = [
  row('a', 'Öküzgözü 2021 sold 14 bottles this week, its best week since June.', 'sales', 3),
  row('b', 'Kalecik Karası is two days from running out.', 'inventory', 2),
  row('c', 'Rakı singles are up a fifth on last month.', 'sales', 1),
  row('d', 'One server carries most of the wine sold on Fridays.', 'staff', 1),
];
const keys = (q: string) => rank(ROWS, q).map((r) => r.ruleKey);

describe('Ask the book reads every letter', () => {
  it('[REVERT-FAILS] folds marks, case and the dotless ı', () => {
    expect(foldText('Öküzgözü')).toBe('okuzgozu');
    expect(foldText('ÖKÜZGÖZÜ')).toBe('okuzgozu');
    expect(foldText('Karası')).toBe('karasi');
    expect(foldText('İzmir')).toBe('izmir');
    expect(tokensOf('Öküzgözü')).toEqual(['okuzgozu']);
  });

  it('[REVERT-FAILS] keeps a letter that has no plain form inside its word', () => {
    // ß, ø and ł do not fold to a-z; an a-z split would cut each word in two.
    expect(tokensOf('Weißbier')).toEqual(['weißbier']);
    expect(tokensOf('Smørrebrød Żubrówka')).toEqual(['smørrebrød', 'zubrowka']);
  });

  it('[REVERT-FAILS] a Turkish search finds its sentence, and only it', () => {
    expect(keys('Öküzgözü')).toEqual(['a']);
  });

  it('[REVERT-FAILS] finds the same sentence typed without its marks, or in capitals', () => {
    expect(keys('okuzgozu')).toEqual(['a']);
    expect(keys('ÖKÜZGÖZÜ')).toEqual(['a']);
  });

  it('[REVERT-FAILS] a dotted or dotless word matches the way it is written either way', () => {
    expect(keys('karasi')).toEqual(['b']);
    expect(keys('RAKI')).toEqual(['c']);
  });

  it('[REVERT-FAILS] finds a sentence by the category word the page shows', () => {
    expect(keys('team')).toEqual(['d']);
    // The stored key still works.
    expect(keys('staff')).toEqual(['d']);
  });

  it("a search of scaffolding alone still browses everything, in the register's order", () => {
    expect(keys('why did')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('[REVERT-FAILS] says the category in the words the page uses', () => {
    render(
      <AskTheBook
        open
        onClose={() => {}}
        reading={{ data: ROWS, loading: false, failure: null, refetch: () => {} } as never}
      />,
    );
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.queryByText('staff')).toBeNull();
  });
});
