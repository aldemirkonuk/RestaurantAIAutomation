/**
 * The landing page at `/` (ADR 0320, rebuilt by ADR 0344): what a stranger
 * reads, where every link goes, that nothing leaves the page, that every figure
 * says it is a sample, that what is coming prints no figure, and that the two
 * motions that carry meaning (the evening feed, the approval) say the right words.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CTA, EVENING, EVENTS, JOIN, Landing, START, week } from './Landing';

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

  it('opens on the one claim', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your back of house, running itself.');
  });

  it('has one button label, and every one of them opens the sign-up form', () => {
    const { container } = mount();
    const buttons = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent?.trim() === CTA);
    // the bar, the hero, the close and the phone dock
    expect(buttons).toHaveLength(4);
    // Bare /register shows this page now (RegisterDoor), so the button names the form.
    expect(START).toBe('/register?type=new');
    buttons.forEach((a) => expect(a.getAttribute('href')).toBe(START));
  });

  it('keeps a way in for someone handed an invite code', () => {
    mount();
    expect(screen.getByRole('link', { name: 'I have an invite code' }).getAttribute('href')).toBe(JOIN);
  });

  it('sends Sign in to /login', () => {
    mount();
    const signIn = screen.getAllByRole('link', { name: 'Sign in' });
    expect(signIn.length).toBeGreaterThan(0);
    signIn.forEach((a) => expect(a.getAttribute('href')).toBe('/login'));
  });

  it('links the story, in the bar and the footer (founder, 2026-10-29)', () => {
    mount();
    const story = screen.getAllByRole('link', { name: 'The story' });
    expect(story).toHaveLength(2);
    story.forEach((a) => expect(a.getAttribute('href')).toBe('/story'));
  });

  it('links only to its own routes and anchors', () => {
    const { container } = mount();
    container.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      expect(href.startsWith('/') || href.startsWith('#'), href).toBe(true);
    });
  });

  it('loads nothing from anywhere else', () => {
    const { container } = mount();
    expect(container.querySelectorAll('script, iframe, img')).toHaveLength(0);
  });

  it('carries no em or en dash', () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
  });

  it('says beside every picture that its names and numbers are samples', () => {
    mount();
    expect(screen.getByText('Every name and number here is invented.')).toBeTruthy();
    expect(screen.getByText('Every name and number in these pictures is a sample.')).toBeTruthy();
    expect(screen.getByText('Six sample notices. Every vendor, price and count is invented.')).toBeTruthy();
    expect(screen.getByText('Try it. Nothing leaves this page.')).toBeTruthy();
    expect(screen.getByText('A sample evening. The bar, the times and the price are invented.')).toBeTruthy();
    expect(
      screen.getByText('Not built yet, and no date. A sample call: the bar, the vendor and the words are invented.'),
    ).toBeTruthy();
  });

  it('shows the same evening twice, and lets the reader flip between them', () => {
    const { container } = mount();
    const eve = container.querySelector<HTMLElement>('.ld-eve');
    const without = screen.getByRole('button', { name: 'Without Mudavym' });
    const withIt = screen.getByRole('button', { name: 'With Mudavym' });
    // The setup's observer never reports, so the evening waits on the old way.
    expect(without.getAttribute('aria-pressed')).toBe('true');
    expect(eve?.hasAttribute('data-on')).toBe(false);
    fireEvent.click(withIt);
    expect(withIt.getAttribute('aria-pressed')).toBe('true');
    expect(eve?.hasAttribute('data-on')).toBe(true);
    // Each hour reads one way at a time, and the other is hidden from a screen reader.
    const row = container.querySelector('.ld-eve-list li');
    expect(row?.querySelector('.ld-eve-now')?.getAttribute('aria-hidden')).toBe('false');
    expect(row?.querySelector('.ld-eve-was')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.ld-eve-list li')).toHaveLength(EVENING.length);
  });

  it('shows the new way of the evening at once for a reader who asked for less motion', () => {
    matchMediaWith(true);
    mount();
    expect(screen.getByRole('button', { name: 'With Mudavym' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('adds up the reader’s own week from the sliders, and says what the arithmetic assumes', () => {
    const { container } = mount();
    const sum = () => container.querySelector('.ld-calc-sum b')?.textContent;
    // The placeholders: 14 invoices at 9 minutes, 30 vendor messages at 4, 4 hours of counting.
    const start = week({ inv: 14, invMin: 9, mail: 30, mailMin: 4, count: 4, rate: 25 });
    expect(start.total).toBeCloseTo(((14 * 9 + 30 * 4) / 60 + 4) * (52 / 12), 6);
    expect(sum()).toBe(String(Math.round(start.total)));
    expect(container.querySelector('.ld-calc-sub')?.textContent).toContain(
      `$${Math.round(start.cost).toLocaleString('en-US')}`,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Hours counting stock a week' }), { target: { value: '0' } });
    const less = week({ inv: 14, invMin: 9, mail: 30, mailMin: 4, count: 0, rate: 25 });
    expect(sum()).toBe(String(Math.round(less.total)));
    expect(Number(sum())).toBeLessThan(Number(String(Math.round(start.total))));
    expect(
      screen.getByText(
        'Your numbers stay on this page. The starting values are placeholders, not averages, and a month here is 52 weeks over 12.',
      ),
    ).toBeTruthy();
    // It shows where the hours go; it promises no saving.
    expect(container.querySelector('.ld-numbers')?.textContent).not.toMatch(/save|saving|cut by|\d+ ?%/i);
  });

  it('says the vendor calls are not built, prints no figure, and end on the reader’s yes', () => {
    const { container } = mount();
    const call = container.querySelector<HTMLElement>('#calls');
    expect(call?.textContent).toContain('Not built yet');
    expect(call?.textContent).toContain('It agrees to nothing without your yes.');
    expect(call?.querySelector('.ld-call-end')?.textContent).toContain('Waiting for your yes.');
    expect(call?.textContent).not.toMatch(/\d/);
  });

  it('says what happens to the house’s data in sentences the code holds, and nothing the code disproved', () => {
    const { container } = mount();
    const data = container.querySelector<HTMLElement>('#data');
    expect(data?.querySelectorAll('.ld-data-list li')).toHaveLength(6);
    expect(data?.textContent).toContain('Every request is checked against the restaurant you signed in to.');
    expect(data?.textContent).toContain('No advertising or tracking scripts');
    // Claims the 2026-10-28 fact check found false or broader than the code (ADR 0344).
    const page = container.textContent ?? '';
    expect(page).not.toMatch(/tenth of a bottle/i);
    expect(page).not.toMatch(/every action is written down/i);
    expect(page).not.toMatch(/changes to your books wait/i);
  });

  it('answers the plain questions closed, with no figure, and says it sends nothing without a person', () => {
    const { container } = mount();
    const items = container.querySelectorAll<HTMLDetailsElement>('#faq details.ld-faq-item');
    expect(items.length).toBeGreaterThanOrEqual(6);
    items.forEach((d) => {
      expect(d.open).toBe(false);
      expect(d.querySelector('summary')?.textContent?.trim()).toMatch(/\?$/);
      expect(d.querySelector(':scope > p')?.textContent?.length).toBeGreaterThan(0);
    });
    const send = Array.from(items).find((d) => d.querySelector('summary')?.textContent === 'Will it send anything without me?');
    expect(send?.textContent).toContain('Orders and replies to vendors wait for a person to approve them.');
    expect(container.querySelector('#faq .ld-faq-list')?.textContent).not.toMatch(/\d/);
  });

  it('shows the goals and where it goes next', () => {
    mount();
    expect(screen.getByText('Catching it at the door')).toBeTruthy();
    for (const step of ['The whole bar.', 'Your POS, connected.', 'The bakery.', 'The whole kitchen.']) {
      expect(screen.getByText(step)).toBeTruthy();
    }
  });

  it('says what comes after the back office as coming, with no figure and no date', () => {
    const { container } = mount();
    const soon = container.querySelector<HTMLElement>('#next');
    expect(soon?.querySelector('h2')?.textContent).toBe('Not just running the kitchen. Predicting the food.');
    expect(soon?.textContent).toContain('Coming soon');
    expect(soon?.textContent).not.toMatch(/in research|working on next/i);
    expect(screen.getByText(/^Not built yet\. No date, and no numbers until they are measured\./)).toBeTruthy();
    expect(screen.getByRole('img', { name: /^A sample taste map/ })).toBeTruthy();
    // Taste prediction is parked (ADR 0342), so past the section's
    // own number nothing in it may print a figure.
    const words = soon?.cloneNode(true) as HTMLElement;
    words.querySelectorAll('.ld-kicker > .ld-mono').forEach((n) => n.remove());
    expect(words.textContent).not.toMatch(/\d/);
  });

  it('runs the evening: a new event arrives, and its ask turns to the answer', () => {
    // The setup's observer never reports; without one the feed counts as seen.
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.useFakeTimers();
    const { container } = mount();
    const first = () => container.querySelector('.ld-feed-list li');
    expect(first()?.textContent).toContain(EVENTS[3].text);

    // The next event (an order) arrives at the top, waiting for a person.
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(first()?.textContent).toContain(EVENTS[4].text);
    expect(first()?.textContent).toContain('Approve');
    expect(container.querySelector('.ld-feed-foot b')?.textContent).toBe('1');

    // The sample person says yes.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(first()?.textContent).toContain('Sent by you');
    expect(container.querySelector('.ld-feed-foot b')?.textContent).toBe('0');
  });

  it('holds still for a reader who asked for less motion, with the asks left open', () => {
    matchMediaWith(true);
    vi.useFakeTimers();
    const { container } = mount();
    const before = container.querySelector('.ld-feed-list')?.textContent;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.querySelector('.ld-feed-list')?.textContent).toBe(before);
    expect(container.querySelectorAll('.ld-feed-list li')).toHaveLength(5);
    expect(Number(container.querySelector('.ld-feed-foot b')?.textContent)).toBeGreaterThan(0);
    // and the delivery story is shown at its last step
    expect(container.querySelector('.ld-stage')?.classList.contains('s5')).toBe(true);
  });

  it('lets the reader approve the sample reply, and take it back, without sending anything', () => {
    // Without an observer every block is shown at mount, as a seen block would be.
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));
    expect(screen.getByRole('status').textContent).toContain('Sent by you');
    // The yes must not hide the card it was given in.
    expect(container.querySelector('.ld-approve')?.classList.contains('is-in')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Approve and send' })).toBeTruthy();
  });
});
