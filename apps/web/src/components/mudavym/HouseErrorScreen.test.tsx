import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HouseErrorScreen } from './HouseErrorScreen';

describe('HouseErrorScreen', () => {
  it('names the category in words and shows the error message', () => {
    render(
      <HouseErrorScreen
        error={new Error('could not reach the gateway')}
        errorCategory="network"
        retry={vi.fn()}
        reset={vi.fn()}
      />,
    );
    expect(screen.getByText('This page could not reach the house.')).toBeTruthy();
    expect(screen.getByText('could not reach the gateway')).toBeTruthy();
    expect(screen.getByText('network')).toBeTruthy();
  });

  it('says the shell keeps working — a page crash is not the whole app', () => {
    render(
      <HouseErrorScreen error={null} errorCategory="unknown" retry={vi.fn()} reset={vi.fn()} />,
    );
    expect(screen.getByText(/the rest of the shell still works/i)).toBeTruthy();
  });

  it('Try again calls retry, Back to Dashboard calls reset', () => {
    const retry = vi.fn();
    const reset = vi.fn();
    render(<HouseErrorScreen error={null} errorCategory="server" retry={retry} reset={reset} />);
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(retry).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Back to Dashboard' }).click();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('every category has its own words — none reuses "unknown"\'s copy', () => {
    const categories = ['network', 'auth', 'server', 'unknown'] as const;
    const headlines = categories.map((c) => {
      const { unmount, getByRole } = render(
        <HouseErrorScreen error={null} errorCategory={c} retry={vi.fn()} reset={vi.fn()} />,
      );
      const headline = getByRole('heading').textContent;
      unmount();
      return headline;
    });
    expect(new Set(headlines).size).toBe(categories.length);
  });
});
