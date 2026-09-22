/**
 * ADR 0134 §5(a) and §8, locked 2026-09-21: the framer-motion half of the
 * reduced-motion guard. Each half of the scope is pinned by the case only it
 * can pass, and each case has its full-motion control, so a scope that stopped
 * every animation — or none — fails one of them:
 *
 *   - a child that names its OWN transition: only `reducedMotion: 'always'`
 *     reaches its movement (framer's own precedence puts a named transition
 *     above any config);
 *   - a child that names none: only `transition: NO_MOTION` reaches its
 *     non-transform values.
 *
 * The probes are plain framer-motion elements; the scope itself is real.
 */
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { motion } from 'framer-motion';
import { NO_MOTION, ReducedMotionScope } from './ReducedMotionScope';

/** Let framer-motion's frame loop run `n` animation frames. */
async function frames(n: number) {
  for (let i = 0; i < n; i += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
}

function Probes({ reduced, on }: { reduced: boolean; on: boolean }) {
  return (
    <ReducedMotionScope reduced={reduced}>
      {/* names its own transition, and moves */}
      <motion.div
        data-testid="named"
        initial={false}
        animate={{ x: on ? 100 : 0 }}
        transition={{ duration: 1 }}
      />
      {/* names none, and fades */}
      <motion.div data-testid="unnamed" initial={false} animate={{ opacity: on ? 0.5 : 1 }} />
    </ReducedMotionScope>
  );
}

/** The translateX a framer transform string carries, 0 for `none` or unset. */
const xOf = (transform: string) => Number(/translateX\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? 0);

async function afterTwoFrames(reduced: boolean) {
  const { rerender } = render(<Probes reduced={reduced} on={false} />);
  rerender(<Probes reduced={reduced} on />);
  await frames(2);
  return {
    named: screen.getByTestId('named').style.transform,
    unnamed: screen.getByTestId('unnamed').style.opacity,
  };
}

describe('ReducedMotionScope', () => {
  it('hands a full-motion reader nothing: both probes take their frames', async () => {
    const { named, unnamed } = await afterTwoFrames(false);
    // Part-way: the 1s slide has not reached 100px, the fade has not reached 0.5.
    expect(xOf(named)).toBeLessThan(100);
    expect(Number(unnamed)).toBeGreaterThan(0.5);
  });

  it('under reduced motion, movement lands with no frames even where a transition is named', async () => {
    const { named } = await afterTwoFrames(true);
    expect(named).toMatch(/^translateX\(100px\)/);
  });

  it('under reduced motion, a value on a child that names no transition lands with no frames', async () => {
    const { unnamed } = await afterTwoFrames(true);
    expect(unnamed).toBe('0.5');
  });

  it("NO_MOTION is framer-motion's own instant transition", () => {
    expect(NO_MOTION).toEqual({ type: false });
  });
});
