/**
 * The catalogue's own logic — readiness classification, the search match,
 * and the head sentence's honest em dashes. The one test that matters most is
 * the "unknown" case: a payload that omits `implemented` must never collapse
 * into "blocked", because that would claim a certainty the server did not
 * send (the legacy page's trap 7).
 */

import { describe, expect, it } from 'vitest';
import {
  countsByDimension,
  headSentence,
  isTypeEnabled,
  liveInsightsForType,
  matchesQuery,
  missingRequirements,
  normalizeLiveInsight,
  offTypeKeys,
  readinessOf,
  typeRuleKey,
  type CatalogCandidate,
  type CatalogComparator,
  type CatalogDimension,
  type CatalogMeasure,
} from './rec-catalog';

function candidate(over: Partial<CatalogCandidate> = {}): CatalogCandidate {
  return {
    key: 'overall.revenue.vs_same_weekday',
    dimension: 'overall',
    measure: 'revenue',
    comparator: 'vs_same_weekday',
    category: 'sales',
    template: 'weekday_compare',
    requires: ['consumption'],
    implemented: true,
    ...over,
  };
}

describe('readinessOf', () => {
  it('is computable only when implemented AND every requirement is present', () => {
    expect(readinessOf(candidate({ requires: ['consumption'] }), ['consumption'])).toBe(
      'computable',
    );
  });

  it('is blocked when implemented but a requirement is missing', () => {
    expect(readinessOf(candidate({ requires: ['consumption', 'checks'] }), ['consumption'])).toBe(
      'blocked',
    );
  });

  it('is not_built when the server says no generator stands behind it', () => {
    expect(readinessOf(candidate({ implemented: false }), ['consumption'])).toBe('not_built');
  });

  it('is unknown — never blocked — when availability itself is unknown', () => {
    expect(readinessOf(candidate({ implemented: true }), null)).toBe('unknown');
  });

  it('is unknown when the server omitted `implemented` entirely', () => {
    // Deliberately malformed — the real-world payload this guards against.
    const malformed = { ...candidate() } as Partial<CatalogCandidate>;
    delete malformed.implemented;
    expect(readinessOf(malformed as CatalogCandidate, ['consumption'])).toBe('unknown');
  });
});

describe('missingRequirements', () => {
  it('names every requirement when availability is unknown, not none', () => {
    expect(missingRequirements(candidate({ requires: ['consumption', 'goals'] }), null)).toEqual([
      'consumption',
      'goals',
    ]);
  });

  it('names only what is actually absent', () => {
    expect(
      missingRequirements(candidate({ requires: ['consumption', 'goals'] }), ['consumption']),
    ).toEqual(['goals']);
  });
});

describe('countsByDimension', () => {
  it('tallies each candidate under its own dimension', () => {
    const counts = countsByDimension([
      candidate({ dimension: 'overall' }),
      candidate({ dimension: 'overall' }),
      candidate({ dimension: 'wine' }),
    ]);
    expect(counts.get('overall')).toBe(2);
    expect(counts.get('wine')).toBe(1);
  });
});

describe('matchesQuery', () => {
  const dims = new Map<string, CatalogDimension>([
    ['overall', { key: 'overall', label: 'Overall', entityScoped: false, requires: [] }],
  ]);
  const measures = new Map<string, CatalogMeasure>([
    ['revenue', { key: 'revenue', label: 'Revenue', unit: 'currency', requires: [] }],
  ]);
  const comparators = new Map<string, CatalogComparator>([
    ['vs_same_weekday', { key: 'vs_same_weekday', label: 'vs same weekday', template: 't' }],
  ]);

  it('matches on the candidate key', () => {
    expect(
      matchesQuery(candidate(), dims, measures, comparators, 'vs_same_weekday'),
    ).toBe(true);
  });

  it('matches on a joined label, not only the raw key', () => {
    expect(matchesQuery(candidate(), dims, measures, comparators, 'revenue')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesQuery(candidate(), dims, measures, comparators, '   ')).toBe(true);
  });

  it('is case-insensitive and refuses what is not there', () => {
    expect(matchesQuery(candidate(), dims, measures, comparators, 'OVERALL')).toBe(true);
    expect(matchesQuery(candidate(), dims, measures, comparators, 'basket affinity')).toBe(false);
  });
});

describe('headSentence', () => {
  it('prints an em dash for every null figure, never a zero', () => {
    const s = headSentence(
      { catalogued: 573, implemented: 24, computable: null, blockedOnData: null, notBuilt: 549 },
      '—',
    );
    expect(s).toContain('573 catalogued');
    expect(s).toContain('— with data present');
    expect(s).toContain('— built but missing data');
    expect(s).not.toMatch(/\b0 with data present\b/);
  });

  it('prints the real numbers once availability is known', () => {
    const s = headSentence(
      { catalogued: 573, implemented: 24, computable: 6, blockedOnData: 18, notBuilt: 549 },
      '—',
    );
    expect(s).toContain('6 with data present');
    expect(s).toContain('18 built but missing data');
  });
});

// ADR 0191 — on/off + live items.

describe('typeRuleKey', () => {
  it('is the bare insight:<candidateKey> string the gateway also computes', () => {
    expect(typeRuleKey('overall.revenue.vs_same_weekday')).toBe(
      'insight:overall.revenue.vs_same_weekday',
    );
  });
});

describe('offTypeKeys / isTypeEnabled', () => {
  it('collects only dismissed, bare-key (rule-scope) rows', () => {
    const off = offTypeKeys([
      { ruleKey: 'insight:overall.revenue.vs_same_weekday', status: 'dismissed' },
      // An individual instance dismissed from the feed — narrower scope, must
      // NOT read as the whole type being off.
      { ruleKey: 'insight:wine.revenue.trend#caymus#d:2026-09-02', status: 'dismissed' },
      { ruleKey: 'insight:wine.revenue.trend', status: 'active' },
    ]);
    expect(off.has('insight:overall.revenue.vs_same_weekday')).toBe(true);
    expect(off.has('insight:wine.revenue.trend')).toBe(false);
    // The instance key is NOT in the set, and nothing else is.
    expect(off.has('insight:wine.revenue.trend#caymus#d:2026-09-02')).toBe(false);
    expect(off.size).toBe(1);
  });

  it('isTypeEnabled is null (unknown) until the dispositions read lands', () => {
    expect(isTypeEnabled('overall.revenue.vs_same_weekday', null)).toBeNull();
  });

  it('isTypeEnabled is false only for a type in the off set', () => {
    const off = offTypeKeys([
      { ruleKey: 'insight:overall.revenue.vs_same_weekday', status: 'dismissed' },
    ]);
    expect(isTypeEnabled('overall.revenue.vs_same_weekday', off)).toBe(false);
    expect(isTypeEnabled('wine.revenue.trend', off)).toBe(true);
  });
});

describe('normalizeLiveInsight', () => {
  it('keeps a well-formed live row', () => {
    const row = normalizeLiveInsight({
      candidateKey: 'overall.revenue.vs_same_weekday',
      category: 'sales',
      sentence: 'Tuesday sales were 12% below average Tuesdays.',
      score: 1.4,
      entityKey: null,
      entityLabel: null,
      suppression: { key: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-02' },
    });
    expect(row).toEqual({
      candidateKey: 'overall.revenue.vs_same_weekday',
      category: 'sales',
      sentence: 'Tuesday sales were 12% below average Tuesdays.',
      score: 1.4,
      entityKey: null,
      entityLabel: null,
      suppressionKey: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-02',
    });
  });

  it('drops a stored row with no computed suppression key rather than fake one', () => {
    // `persist()` never writes `suppression` — see insight-generator.service.ts.
    expect(
      normalizeLiveInsight({
        candidateKey: 'overall.revenue.vs_same_weekday',
        category: 'sales',
        sentence: 'Tuesday sales were 12% below average Tuesdays.',
      }),
    ).toBeNull();
  });

  it('drops a row missing a sentence or a candidate key', () => {
    expect(normalizeLiveInsight({ candidateKey: 'x', suppression: { key: 'k' } })).toBeNull();
    expect(normalizeLiveInsight({ sentence: 'x', suppression: { key: 'k' } })).toBeNull();
    expect(normalizeLiveInsight(null)).toBeNull();
  });
});

describe('liveInsightsForType', () => {
  it('filters to one type and ranks by score, highest first', () => {
    const rows = [
      {
        candidateKey: 'a',
        sentence: 'A',
        score: 1,
        suppression: { key: 'insight:a#x#d:2026-09-01' },
      },
      {
        candidateKey: 'b',
        sentence: 'B',
        score: 9,
        suppression: { key: 'insight:b#x#d:2026-09-01' },
      },
      {
        candidateKey: 'a',
        sentence: 'A2',
        score: 5,
        suppression: { key: 'insight:a#y#d:2026-09-01' },
      },
    ];
    const items = liveInsightsForType(rows, 'a');
    expect(items.map((i) => i.sentence)).toEqual(['A2', 'A']);
  });
});
