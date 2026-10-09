/**
 * The landing page at `/` (ADR 0320): what a stranger reads, where every link
 * goes, that nothing leaves the page, and that the two motions that carry
 * meaning (the sheet's reading, the door count travelling) say the right words.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Landing } from './Landing';

function mount() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

function matchMediaWith(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('Landing', () => {
  beforeEach(() => matchMediaWith(false));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on the one claim and its one-line summary', () => {
    mount();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('Restaurants get overbilled by their distributors and never catch it.');
    expect(h1.textContent).toContain('We catch it from a photo of the invoice.');
  });

  it('sends every "Bring one invoice" to /register and every "Sign in" to /login, and nowhere outside', () => {
    const { container } = mount();
    const anchors = Array.from(container.querySelectorAll('a'));
    const bring = anchors.filter((a) => a.textContent?.includes('Bring one invoice'));
    expect(bring.length).toBe(3);
    for (const a of bring) expect(a.getAttribute('href')).toBe('/register');
    const signIn = anchors.filter((a) => a.textContent?.trim() === 'Sign in');
    expect(signIn.length).toBe(2);
    for (const a of signIn) expect(a.getAttribute('href')).toBe('/login');
    for (const a of anchors) expect(a.getAttribute('href') ?? '').not.toMatch(/^(https?:|mailto:|\/\/)/);
    expect(container.querySelector('script, iframe, img')).toBeNull();
  });

  it('carries no em or en dash and labels its figures as samples', () => {
    const { container } = mount();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(new RegExp('[' + String.fromCharCode(8211, 8212) + ']'));
    expect(text).toContain('Sample invoice. Every price on it is invented.');
    expect(text).toContain('Every number on this page is a sample.');
    expect(text).toContain('Free for the first houses.');
  });

  it('reads the sample sheet line by line, stamps the two lines that disagree, and opens the why on a tap', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    mount();
    expect(screen.getByText('Reading 11 lines')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Price' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1100 + 160 + 11 * 150 + 900 + 50);
    });
    expect(screen.getByText('11 lines read. 2 do not agree.')).toBeInTheDocument();
    expect(screen.getByText('$149.40')).toBeInTheDocument();
    const price = screen.getByRole('button', { name: 'Price' });
    const count = screen.getByRole('button', { name: 'Count' });
    expect(price).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('ld-why-price')).toHaveAttribute('hidden');
    fireEvent.click(price);
    expect(price).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('ld-why-price')).not.toHaveAttribute('hidden');
    expect(document.getElementById('ld-why-price')?.textContent).toContain('Agreed price $19.80. Billed $22.50.');
    fireEvent.click(count);
    expect(document.getElementById('ld-why-count')?.textContent).toContain('Six came through the door. Twelve billed.');
    fireEvent.click(price);
    expect(price).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the finished sheet at once when the person prefers reduced motion', () => {
    matchMediaWith(true);
    mount();
    expect(screen.getByText('11 lines read. 2 do not agree.')).toBeInTheDocument();
    expect(screen.getByText('$149.40')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Price' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Count' })).toBeInTheDocument();
  });

  it('carries the door count into the claim, the draft and the cellar line, clamped to the billed twelve', () => {
    const { container } = mount();
    const more = screen.getByRole('button', { name: 'One more' });
    const fewer = screen.getByRole('button', { name: 'One fewer' });
    const text = () => container.textContent ?? '';
    expect(text()).toContain('6 of 12 came through the door on Oct 2. Please credit $117.00 against this invoice.');
    expect(text()).toContain('Waiting for a person to send');
    fireEvent.click(more);
    fireEvent.click(more);
    expect(text()).toContain('8 of 12 came through the door on Oct 2. Please credit $78.00 against this invoice.');
    expect(container.querySelector('.ld-claim')?.textContent).toBe('Short 4 bottles, $78.00 to request.');
    expect(container.querySelector('.ld-ledger .ld-up')?.textContent).toBe('+12+8');
    for (let i = 0; i < 5; i += 1) fireEvent.click(more);
    expect(screen.getByRole('status')).toHaveTextContent('12');
    expect(container.querySelector('.ld-claim')?.textContent).toBe('All 12 came through the door. Nothing to request.');
    expect(text()).toContain('all 12 came through the door on Oct 2. Nothing to request.');
    expect(text()).toContain('No letter needed');
    expect(container.querySelector('.ld-ledger .ld-up')?.textContent).toBe('+12');
    for (let i = 0; i < 13; i += 1) fireEvent.click(fewer);
    expect(screen.getByRole('status')).toHaveTextContent('0');
    expect(container.querySelector('.ld-claim')?.textContent).toBe('Short 12 bottles, $234.00 to request.');
  });
});
