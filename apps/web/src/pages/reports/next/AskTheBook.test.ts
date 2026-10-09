import { describe, expect, it } from 'vitest';
import { rank, tokensOf } from './AskTheBook';
import type { ReadingRow } from './rp-registers-trade';

function row(sentence: string, entityLabel: string | null = null): ReadingRow {
  return { ruleKey: sentence, sentence, category: 'sales', score: 1, entityLabel };
}

describe('Ask the book — Turkish words', () => {
  it('keeps the Turkish letters of a question instead of dropping them', () => {
    expect(tokensOf('Öküzgözü')).toEqual(['okuzgozu']);
    expect(tokensOf('şarap')).toEqual(['sarap']);
    expect(tokensOf('Boğazkere satışı')).toEqual(['bogazkere', 'satisi']);
  });

  it('finds the row a Turkish word names, and only that row', () => {
    const rows = [row('Öküzgözü sold out twice this week', 'Öküzgözü 2022'), row('Rakı is slow on Mondays')];
    expect(rank(rows, 'Öküzgözü').map((r) => r.sentence)).toEqual(['Öküzgözü sold out twice this week']);
    expect(rank(rows, 'raki').map((r) => r.sentence)).toEqual(['Rakı is slow on Mondays']);
    expect(rank(rows, 'İzmir')).toEqual([]);
  });
});
