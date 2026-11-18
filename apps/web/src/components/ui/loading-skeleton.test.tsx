import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Skeleton, Reveal, CardSkeleton, DashboardSkeleton } from './loading-skeleton';

const css = readFileSync(resolve(__dirname, '../mudavym/shell-transitions.css'), 'utf8');

describe('Skeleton', () => {
  it('renders a paper block carrying the compositor sheen class', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('mdv-sheen');
    expect(el.className).not.toContain('animate-pulse');
    expect(el.className).not.toContain('bg-gray');
  });

  it('accepts custom className', () => {
    const { container } = render(<Skeleton className="h-20 w-20" />);
    expect(container.querySelector('.h-20')).toBeInTheDocument();
  });

  it('shimmer={false} keeps the block and drops the sheen', () => {
    const { container } = render(<Skeleton shimmer={false} />);
    expect((container.firstElementChild as HTMLElement).className).toContain('mdv-sheen--still');
  });

  it('the composed skeletons carry no hard-coded gray or dark: variants', () => {
    const { container } = render(
      <>
        <CardSkeleton />
        <DashboardSkeleton />
      </>,
    );
    expect(container.innerHTML).not.toMatch(/gray-|dark:/);
  });
});

describe('Reveal', () => {
  it('staggers 40 ms per index, capped at eight', () => {
    const { container } = render(
      <>
        <Reveal index={2}>a</Reveal>
        <Reveal index={30}>b</Reveal>
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll<HTMLElement>('.mdv-reveal'));
    expect(a.style.getPropertyValue('--mdv-i')).toBe('2');
    expect(b.style.getPropertyValue('--mdv-i')).toBe('8');
  });
});

describe('shell-transitions.css contract', () => {
  it('runs the sheen and the reveal only when motion is allowed, and animates compositor properties only', () => {
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{\s*\.mdv-sheen::after \{\s*animation:/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference\) \{\s*\.mdv-reveal \{/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/background-position/);
  });
  it('uses the specified sheen stop and the sweep curve for the ground reveal', () => {
    expect(css).toContain('oklch(1 0 0 / 0.5) 50%');
    expect(css).toMatch(/mdv-vt-reveal 500ms var\(--shell-ease-sweep/);
  });
});
