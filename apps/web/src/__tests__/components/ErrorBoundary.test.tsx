import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ErrorBoundary, categorizeError } from '../../components/ErrorBoundary';

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
      throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
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

  // F-734: a link to the same page (only the query differs) must clear the error.
  it('a new resetKey clears the error and renders the children again', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) throw new Error('flaky');
      return <div>recovered</div>;
    };
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={<div>crashed</div>}>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('crashed')).toBeInTheDocument();
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKey="a" fallback={<div>crashed</div>}>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('crashed')).toBeInTheDocument(); // same key: stays
    rerender(
      <ErrorBoundary resetKey="b" fallback={<div>crashed</div>}>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('recovered')).toBeInTheDocument();
  });

  // F-737: Try again must not re-render the same cached rows that just threw.
  it('retry empties the crashed page\'s cached queries, so it refetches instead of re-throwing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['rows'], { wrong: 'shape' }); // what the page crashed on
    const Page = () => {
      const { data } = useQuery({
        queryKey: ['rows'],
        queryFn: async () => ({ rows: ['ok'] }),
      });
      if (!data) return <div>loading</div>;
      return <div>{(data as { rows: string[] }).rows.map((r) => r.toUpperCase()).join()}</div>;
    };
    render(
      <QueryClientProvider client={client}>
        <ErrorBoundary fallback={({ retry }) => <button onClick={retry}>try again</button>}>
          <Page />
        </ErrorBoundary>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText('try again'));
    expect(await screen.findByText('OK')).toBeInTheDocument();
  });

  it('retry leaves the queries a mounted part of the screen still watches', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['shell'], 'still here');
    const Shell = () => {
      const { data } = useQuery({ queryKey: ['shell'], queryFn: () => new Promise<string>(() => {}) });
      return <div>{data}</div>;
    };
    render(
      <QueryClientProvider client={client}>
        <Shell />
        <ErrorBoundary fallback={({ retry }) => <button onClick={retry}>try again</button>}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText('try again'));
    expect(client.getQueryData(['shell'])).toBe('still here');
  });

  // F-1081: offline, a reload lands on the browser's "No internet" page.
  it('a chunk error offline keeps the in-app screen instead of reloading', () => {
    sessionStorage.clear();
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const Chunk = () => {
      throw new TypeError('Failed to fetch dynamically imported module: /assets/DoorNext-abc.js');
    };
    try {
      render(
        <ErrorBoundary fallback={({ errorCategory }) => <div>wall: {errorCategory}</div>}>
          <Chunk />
        </ErrorBoundary>
      );
      expect(reload).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('chunk_reload')).toBeNull();
      expect(screen.getByText('wall: network')).toBeInTheDocument();
    } finally {
      onLine.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

// F-736: the category comes from typed fields, never from words in the message.
describe('categorizeError', () => {
  it('reads an HTTP status, wherever the client put it', () => {
    expect(categorizeError(Object.assign(new Error('x'), { status: 401 }))).toBe('auth');
    expect(categorizeError(Object.assign(new Error('x'), { statusCode: 403 }))).toBe('auth');
    expect(categorizeError(Object.assign(new Error('x'), { response: { status: 503 } }))).toBe('server');
    expect(categorizeError(Object.assign(new Error('x'), { status: 404 }))).toBe('unknown');
  });

  it('reads a network error by its name or code', () => {
    expect(categorizeError(Object.assign(new Error('x'), { name: 'NetworkError' }))).toBe('network');
    expect(categorizeError(Object.assign(new Error('x'), { code: 'ECONNABORTED' }))).toBe('network');
  });

  it('a page bug whose message happens to say "connection" or "author" is not a lost network or session', () => {
    expect(categorizeError(new TypeError("Cannot read properties of undefined (reading 'connection')"))).toBe('unknown');
    expect(categorizeError(new TypeError("Cannot read properties of null (reading 'author')"))).toBe('unknown');
    expect(categorizeError(new Error('server returned 500'))).toBe('unknown');
    expect(categorizeError(null)).toBe('unknown');
  });
});
