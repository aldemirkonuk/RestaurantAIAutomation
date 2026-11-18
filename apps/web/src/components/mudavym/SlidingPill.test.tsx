import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SlidingPill } from './SlidingPill';
import { Collapse } from './Collapse';

const OPTS = [
  { value: 'a', label: 'Book', count: 3 },
  { value: 'b', label: 'Scorecard', count: 0 },
] as const;

function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.value === 'b' ? 80 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.value === 'b' ? 100 : 60;
    },
  });
}

function Host({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState<'a' | 'b'>('a');
  return (
    <SlidingPill
      testId="pill"
      ariaLabel="View"
      value={v}
      options={OPTS}
      onChange={(n) => {
        onChange(n);
        setV(n);
      }}
    />
  );
}

describe('SlidingPill', () => {
  it('keeps the toggle pattern: a named group of aria-pressed buttons', () => {
    render(<Host />);
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Book/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Scorecard/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('pill')).toBeTruthy();
  });

  it('places one pill under the active option and moves it on change', () => {
    stubLayout();
    render(<Host />);
    const root = screen.getByTestId('pill');
    expect(root.style.getPropertyValue('--pill-x')).toBe('0px');
    expect(root.style.getPropertyValue('--pill-w')).toBe('60px');
    fireEvent.click(screen.getByRole('button', { name: /Scorecard/ }));
    expect(root.style.getPropertyValue('--pill-x')).toBe('80px');
    expect(root.style.getPropertyValue('--pill-w')).toBe('100px');
    expect(root.querySelectorAll('.mdv-pill__thumb')).toHaveLength(1);
  });

  it('calls onChange and dims a zero-count option', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    expect(screen.getByRole('button', { name: /Scorecard/ })).toHaveAttribute('data-empty', 'true');
    expect(screen.getByRole('button', { name: /Book/ })).not.toHaveAttribute('data-empty');
    fireEvent.click(screen.getByRole('button', { name: /Scorecard/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('re-keys a count that changed so it ticks', () => {
    const { rerender } = render(
      <SlidingPill ariaLabel="V" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A', count: 1 }]} />,
    );
    const before = document.querySelector('.mdv-pill__count');
    rerender(<SlidingPill ariaLabel="V" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A', count: 2 }]} />);
    const after = document.querySelector('.mdv-pill__count');
    expect(after).not.toBe(before);
    expect(after?.textContent).toBe('2');
  });
});

describe('Collapse', () => {
  it('open: carries data-open and is reachable', () => {
    render(<Collapse open><button>inside</button></Collapse>);
    const inner = screen.getByRole('button', { name: 'inside' }).parentElement!;
    expect(inner.parentElement).toHaveAttribute('data-open', 'true');
    expect(inner).not.toHaveAttribute('inert');
    expect(inner).not.toHaveAttribute('aria-hidden');
  });
  it('closed: inert and hidden from assistive technology', () => {
    render(<Collapse open={false}><button>inside</button></Collapse>);
    const inner = document.querySelector('.mdv-collapse__inner')!;
    expect(inner.parentElement).toHaveAttribute('data-open', 'false');
    expect(inner).toHaveAttribute('inert');
    expect(inner).toHaveAttribute('aria-hidden', 'true');
  });
});
