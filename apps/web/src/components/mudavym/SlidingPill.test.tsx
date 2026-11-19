import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('SlidingPill as a tablist', () => {
  it('carries tab semantics, per-option test ids and a string count that never dims', () => {
    stubLayout();
    function Tabs() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <SlidingPill
          role="tablist"
          ariaLabel="Which"
          value={v}
          onChange={setV}
          options={[
            { value: 'a', label: 'Menu', testId: 'scope-a', countTestId: 'scope-a-count', count: 9 },
            { value: 'b', label: 'All', testId: 'scope-b', countTestId: 'scope-b-count', count: '\u2014' },
          ]}
        />
      );
    }
    render(<Tabs />);
    expect(screen.getByRole('tablist', { name: 'Which' })).toBeTruthy();
    expect(screen.getByTestId('scope-a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('scope-a')).not.toHaveAttribute('aria-pressed');
    expect(screen.getByTestId('scope-b-count').textContent).toBe('\u2014');
    expect(screen.getByTestId('scope-b')).not.toHaveAttribute('data-empty');
    fireEvent.click(screen.getByTestId('scope-b'));
    expect(screen.getByTestId('scope-b')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('scope-a')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tablist').style.getPropertyValue('--pill-x')).toBe('80px');
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

describe('Collapse unmountWhenClosed', () => {
  it('has no content while closed, mounts it closed, opens on the next frame, and removes it after the close', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <Collapse open={false} unmountWhenClosed>
          <button>draft</button>
        </Collapse>,
      );
      expect(screen.queryByRole('button', { name: 'draft' })).toBeNull();
      expect(document.querySelector('.mdv-collapse')).toBeNull();

      rerender(
        <Collapse open unmountWhenClosed>
          <button>draft</button>
        </Collapse>,
      );
      expect(screen.getByRole('button', { name: 'draft' })).toBeTruthy();
      expect(document.querySelector('.mdv-collapse')).toHaveAttribute('data-open', 'false');
      expect(document.querySelector('.mdv-collapse__inner')).not.toHaveAttribute('inert');
      await vi.advanceTimersByTimeAsync(40);
      expect(document.querySelector('.mdv-collapse')).toHaveAttribute('data-open', 'true');

      rerender(
        <Collapse open={false} unmountWhenClosed>
          <button>draft</button>
        </Collapse>,
      );
      expect(document.querySelector('.mdv-collapse')).toHaveAttribute('data-open', 'false');
      expect(document.querySelector('.mdv-collapse__inner')).toHaveAttribute('inert');
      await vi.advanceTimersByTimeAsync(320);
      expect(document.querySelector('.mdv-collapse')).toBeNull();
      expect(document.body.textContent).not.toContain('draft');
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts open without waiting when it is rendered open', () => {
    render(
      <Collapse open unmountWhenClosed>
        <button>now</button>
      </Collapse>,
    );
    expect(document.querySelector('.mdv-collapse')).toHaveAttribute('data-open', 'true');
  });
});

describe('SlidingPill option hint', () => {
  it('carries an option title onto its button', () => {
    render(
      <SlidingPill ariaLabel="V" value="a" onChange={() => {}} options={[{ value: 'a', label: 'Month', title: 'Month (m)' }, { value: 'b', label: 'Week' }]} />,
    );
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('title', 'Month (m)');
    expect(screen.getByRole('button', { name: 'Week' })).not.toHaveAttribute('title');
  });
});

describe('Collapse appear', () => {
  it('a panel that mounts open eases open from 0fr, and stays reachable the whole way', () => {
    vi.useFakeTimers();
    try {
      render(
        <Collapse open unmountWhenClosed appear>
          <button>row</button>
        </Collapse>,
      );
      const root = document.querySelector('.mdv-collapse')!;
      const inner = document.querySelector('.mdv-collapse__inner')!;
      expect(root).toHaveAttribute('data-open', 'false');
      expect(inner).not.toHaveAttribute('inert');
      expect(screen.getByRole('button', { name: 'row' })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(40); });
      expect(root).toHaveAttribute('data-open', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('without appear, a panel that mounts open is open at once', () => {
    render(<Collapse open unmountWhenClosed><button>row</button></Collapse>);
    expect(document.querySelector('.mdv-collapse')).toHaveAttribute('data-open', 'true');
  });
});
