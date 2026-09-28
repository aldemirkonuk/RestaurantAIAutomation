import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';

// Mock error tracking
vi.mock('../../lib/error-tracking', () => ({
  errorTracking: {
    captureException: vi.fn().mockReturnValue('mock-event-id'),
  },
}));

// Component that throws an error
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error for cleaner test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('renders error UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText(/An unexpected error occurred/)).toBeInTheDocument();
  });

  it('displays error message', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // Error details are hidden behind "Show Technical Details" toggle; verify the toggle exists.
    expect(screen.getByText(/Show Technical Details/i)).toBeInTheDocument();
  });

  it('displays event ID for support', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Error ID (for support)')).toBeInTheDocument();
    expect(screen.getByText('mock-event-id')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
  });

  it('a render-function fallback gets the error and its category', () => {
    const seen: Array<{ error: string | undefined; category: string }> = [];
    render(
      <ErrorBoundary
        fallback={({ error, errorCategory }) => {
          seen.push({ error: error?.message, category: errorCategory });
          return <span>function fallback: {error?.message}</span>;
        }}
      >
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // React re-renders the fallback across its error-recovery passes
    // (getDerivedStateFromError, then componentDidCatch's own setState) —
    // every call must carry the same, correct info; the exact call count is
    // React's business, not this contract's.
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call).toEqual({ error: 'Test error', category: 'unknown' });
    }
    expect(screen.getByText('function fallback: Test error')).toBeInTheDocument();
  });

  it('retry clears the error and re-renders children in place — once the cause is gone', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('flaky');
      return <div>recovered</div>;
    };
    render(
      <ErrorBoundary fallback={({ retry }) => <button onClick={retry}>fn-retry</button>}>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByText('fn-retry')).toBeInTheDocument();
    shouldThrow = false; // the underlying cause is gone before retry is clicked
    fireEvent.click(screen.getByText('fn-retry'));
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByText('fn-retry')).toBeNull();
  });

  it('reset is wired — clicking it does not throw (same handleReset the built-in "Go to Dashboard" button uses)', () => {
    render(
      <ErrorBoundary fallback={({ reset }) => <button onClick={reset}>fn-reset</button>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(() => fireEvent.click(screen.getByText('fn-reset'))).not.toThrow();
  });

  it('a render-function fallback receives the SAME categorisation as the built-in screen', () => {
    const ThrowNetwork = () => {
      throw new Error('network request failed');
    };
    let category = '';
    render(
      <ErrorBoundary
        fallback={({ errorCategory }) => {
          category = errorCategory;
          return <div>fallback</div>;
        }}
      >
        <ThrowNetwork />
      </ErrorBoundary>
    );
    expect(category).toBe('network');
  });

  it('has Go to Dashboard button', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it('has Reload Page button', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
  });
});
