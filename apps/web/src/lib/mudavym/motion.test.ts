import { describe, expect, it } from 'vitest';
import {
  ink,
  motionTokens,
  pour,
  press,
  settle,
  springLinear,
  springs,
  stamp,
  tally,
  tuck,
  turn,
} from './motion';

describe('springLinear (damped-spring → CSS linear() sampler)', () => {
  it('starts at exactly 0 and ends at exactly 1', () => {
    for (const s of [springs.tuck, springs.stamp, springs.tally]) {
      expect(s.samples).toHaveLength(60);
      expect(s.samples[0]).toBe(0);
      expect(s.samples[s.samples.length - 1]).toBe(1);
      expect(s.easing).toMatch(/^linear\(0,.*,1\)$/);
    }
  });

  it('rises monotonically through the approach (first quarter of the curve)', () => {
    for (const s of [springs.tuck, springs.stamp, springs.tally]) {
      for (let i = 1; i < 15; i++) {
        expect(s.samples[i]).toBeGreaterThanOrEqual(s.samples[i - 1]);
      }
    }
  });

  it('stamp overshoots within 1 point of the 059 measured figure (~11.1%)', () => {
    const overshoot = Math.max(...springs.stamp.samples) - 1;
    expect(overshoot).toBeGreaterThanOrEqual(0.101);
    expect(overshoot).toBeLessThanOrEqual(0.121);
  });

  it('tuck overshoots ~1% (weight, not bounce) and tally not at all', () => {
    const tuckOvershoot = Math.max(...springs.tuck.samples) - 1;
    expect(tuckOvershoot).toBeGreaterThan(0.003);
    expect(tuckOvershoot).toBeLessThanOrEqual(0.02);
    // Overdamped: figures arrive, they never bounce past.
    expect(Math.max(...springs.tally.samples)).toBeLessThanOrEqual(1);
  });

  it('settle times reproduce the 059 durations within 10%', () => {
    expect(Math.abs(springs.tuck.ms - 300)).toBeLessThanOrEqual(30);
    expect(Math.abs(springs.stamp.ms - 360)).toBeLessThanOrEqual(36);
    expect(Math.abs(springs.tally.ms - 840)).toBeLessThanOrEqual(84);
  });

  it('enforces the 140ms floor for very stiff springs', () => {
    expect(springLinear(5000, 200).ms).toBeGreaterThanOrEqual(140);
  });
});

describe('motion tokens carry the 059 names and numbers verbatim', () => {
  it('durations', () => {
    expect(settle.ms).toBe(320);
    expect(ink.ms).toBe(160);
    expect(tuck.ms).toBe(300);
    expect(turn.ms).toBe(420);
    expect(pour.ms).toBe(620);
    expect(stamp.ms).toBe(360);
    expect(tally.ms).toBe(840);
  });

  it('easings', () => {
    expect(settle.easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(ink.easing).toBe(settle.easing);
    expect(turn.easing).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
    expect(pour.easing).toBe('linear'); // timed against the operator's thumb
    expect(tuck.easing).toMatch(/^linear\(/);
    expect(stamp.easing).toMatch(/^linear\(/);
    expect(tally.easing).toMatch(/^linear\(/);
  });

  it('exports all seven names, with press as the 059 alias of pour', () => {
    expect(Object.keys(motionTokens).sort()).toEqual(
      ['ink', 'pour', 'settle', 'stamp', 'tally', 'tuck', 'turn'].sort(),
    );
    expect(press).toBe(pour);
  });
});
