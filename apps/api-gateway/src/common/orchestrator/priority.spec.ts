import { computePriority } from './priority';

describe('priority (D4)', () => {
  it('interrupts only when relevant AND (valuable OR urgent) AND trusted', () => {
    expect(computePriority({ relevance: 0.9, savings: 0.7, urgency: 0.3, trust: 0.7 }).bucket).toBe('interrupt');
    expect(computePriority({ relevance: 0.9, savings: 0.1, urgency: 0.9, trust: 0.7 }).bucket).toBe('interrupt'); // urgent path
  });

  it('does NOT interrupt when untrusted, even if relevant + valuable', () => {
    expect(computePriority({ relevance: 0.9, savings: 0.8, urgency: 0.2, trust: 0.2 }).bucket).not.toBe('interrupt');
  });

  it('does NOT interrupt when irrelevant, even with a big discount', () => {
    expect(computePriority({ relevance: 0.1, savings: 0.9, urgency: 0.2, trust: 0.9 }).bucket).not.toBe('interrupt');
  });

  it('surfaces relevant-but-not-valuable promos', () => {
    expect(computePriority({ relevance: 0.7, savings: 0.2, urgency: 0.2, trust: 0.6 }).bucket).toBe('surface');
  });

  it('digests low-signal promos', () => {
    expect(computePriority({ relevance: 0.1, savings: 0.2, urgency: 0.1, trust: 0.5 }).bucket).toBe('digest');
  });

  it('defaults trust to neutral (0.5) and clamps out-of-range inputs', () => {
    const r = computePriority({ relevance: 2, savings: -1 });
    expect(r.signals.relevance).toBe(1);
    expect(r.signals.savings).toBe(0);
    expect(r.signals.trust).toBe(0.5);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
