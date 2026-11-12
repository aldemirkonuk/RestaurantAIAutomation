/**
 * `/story` (founder, 2026-10-28): the platform told as one sample night. What
 * it says, where every link goes, that nothing leaves the page, that every
 * name and number says it is a sample, and that the one thing a reader can do
 * here (approve the two asks) moves the receipt at close and nothing else.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CTA, START } from '../landing/doors';
import { CHAPTERS, HELD, LINES, PIN_AIR, STAGE_SHARE, Story } from './Story';

const storyCss = readFileSync(join(__dirname, 'story.css'), 'utf8');
const landingCss = readFileSync(join(__dirname, '../landing/landing.css'), 'utf8');

/** The declarations of the first rule written exactly `sel {`. */
function rule(css: string, sel: string) {
  const at = css.indexOf(sel + ' {');
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at + sel.length + 2, css.indexOf('}', at));
}

/** A browser that scrubs: it answers yes to the one feature query Story asks. */
const scrubs = { supports: (p: string, v: string) => p === 'animation-timeline' && v === 'view()' };

function mount() {
  return render(
    <MemoryRouter>
      <Story />
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

/** Heights as a browser gives them: a 600 px probe, each chapter's picture
 *  whatever `grid` says, and everything else far too tall to fit, so a test
 *  passes only when Story measures the probe against the pictures. */
function heights(grid: (el: HTMLElement) => number) {
  return vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('st-probe')) return 600;
    if (this.classList.contains('st-grid')) return grid(this);
    return 99999;
  });
}

/** A ResizeObserver that remembers what it watches and lets a test resize. */
class FakeResize {
  static last: FakeResize | null = null;
  seen: Element[] = [];
  gone = false;
  constructor(readonly cb: () => void) {
    FakeResize.last = this;
  }
  observe(el: Element) {
    this.seen.push(el);
  }
  disconnect() {
    this.gone = true;
  }
}

type Watch = { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; seen: Element[]; dropped: Element[]; gone: boolean };
let watches: Watch[] = [];

/** An IntersectionObserver that remembers what it watches and lets a test scroll. */
class FakeIntersect {
  w: Watch;
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.w = { cb, opts, seen: [], dropped: [], gone: false };
    watches.push(this.w);
  }
  observe(el: Element) {
    this.w.seen.push(el);
  }
  unobserve(el: Element) {
    this.w.dropped.push(el);
  }
  disconnect() {
    this.w.gone = true;
  }
}

/** The receipt line that follows a <dt> with these words. */
function receipt(container: HTMLElement, term: string) {
  const dt = Array.from(container.querySelectorAll('.st-receipt dt')).find((d) => d.textContent === term);
  return dt?.nextElementSibling as HTMLElement | null;
}

/** jsdom scrolls nothing into view; this one remembers what it was asked to. */
const realInto = Element.prototype.scrollIntoView;
let into: Element[] = [];
const intoView = vi.fn(function (this: Element) {
  into.push(this);
});

describe('Story', () => {
  beforeEach(() => {
    matchMediaWith(false);
    FakeResize.last = null;
    watches = [];
    into = [];
    intoView.mockClear();
    Element.prototype.scrollIntoView = intoView;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = realInto;
  });

  it('opens on the two businesses', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Every restaurant runs two businesses at once.');
  });

  it('runs its chapters in the order of the night, each named once', () => {
    const { container } = mount();
    const ids = Array.from(container.querySelectorAll('section.st-ch')).map((s) => s.id);
    expect(ids).toEqual(CHAPTERS.map((c) => c.id));
    // every chapter is reachable from the rail
    CHAPTERS.forEach((c) => expect(container.querySelector(`.st-rail a[href="#${c.id}"]`)).toBeTruthy());
  });

  it('has the landing’s one button, and both of them open the sign-up form', () => {
    const { container } = mount();
    const buttons = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent?.trim() === CTA);
    // the bar and the end
    expect(buttons).toHaveLength(2);
    buttons.forEach((a) => expect(a.getAttribute('href')).toBe(START));
  });

  it('sends Sign in to /login and the platform back to /', () => {
    mount();
    screen.getAllByRole('link', { name: 'Sign in' }).forEach((a) => expect(a.getAttribute('href')).toBe('/login'));
    expect(screen.getByRole('link', { name: 'See the whole platform' }).getAttribute('href')).toBe('/');
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

  it('carries no em or en dash, in its words or in what it says to a screen reader', () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
    const said = Array.from(container.querySelectorAll('[aria-label], [title], [alt]')).flatMap((el) =>
      ['aria-label', 'title', 'alt'].map((a) => el.getAttribute(a) ?? ''),
    );
    expect(said.length).toBeGreaterThan(0);
    said.forEach((s) => expect(s).not.toMatch(/[\u2013\u2014]/));
  });

  it('names the call for a screen reader, reads it in turn, and hides every drawing that says nothing', () => {
    const { container } = mount();
    const call = screen.getByRole('figure', { name: 'A sample call to a vendor' });
    expect(Array.from(call.querySelectorAll('.st-call-lines li > span')).map((s) => s.textContent)).toEqual([
      'Mudavym',
      'Northfield',
      'Mudavym',
      'Northfield',
    ]);
    // the lines and the ending are heard (a role query skips what is hidden)
    expect(within(call).getAllByRole('listitem')).toHaveLength(4);
    const heard = (el: Element | null) => !!el && !el.closest('[aria-hidden="true"]');
    expect(heard(call.querySelector('.st-call-end'))).toBe(true);
    // a count is heard once, as its total, never as its ticking strip
    const reels = container.querySelectorAll('.st-reel');
    expect(reels.length).toBeGreaterThan(0);
    reels.forEach((r) => {
      expect(heard(r)).toBe(false);
      expect(r.nextElementSibling?.classList.contains('st-sr')).toBe(true);
    });
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    // a drawing is hidden, or it is an image with a name (the checked marks)
    svgs.forEach((svg) =>
      expect(
        svg.closest('[aria-hidden="true"]') || (svg.getAttribute('role') === 'img' && svg.getAttribute('aria-label')),
        svg.getAttribute('class') ?? 'svg',
      ).toBeTruthy(),
    );
  });

  it('says up front, and beside every picture with a name or a number, that they are samples', () => {
    mount();
    expect(
      screen.getByText('A sample house on a sample night. Every name, time and number in this story is invented.'),
    ).toBeTruthy();
    expect(screen.getByText('Sample scraps. The vendor, the wines and the counts are invented.')).toBeTruthy();
    expect(screen.getByText('A sample invoice. The vendor, the wines and the prices are invented.')).toBeTruthy();
    expect(screen.getByText('A sample price check. The agreed price is invented.')).toBeTruthy();
    expect(screen.getByText('Sample counts.')).toBeTruthy();
    expect(screen.getByText('A sample bottle, five sample glasses.')).toBeTruthy();
    expect(screen.getByText('Try it. Nothing leaves this page.')).toBeTruthy();
    expect(screen.getByText('A sample night')).toBeTruthy();
    expect(
      screen.getByText('Not built yet, and no date. A sample call: the bar, the vendor and the words are invented.'),
    ).toBeTruthy();
  });

  it('adds the sample up: 48 bottles, $840.00, and $32.40 held on line 3', () => {
    const { container } = mount();
    expect(LINES.length * 12).toBe(48);
    expect(container.querySelector('.st-paper footer')?.textContent).toBe('48 bottles$840.00');
    expect(HELD.toFixed(2)).toBe('32.40');
    expect(container.querySelector('.st-held b')?.textContent).toBe('$32.40 held');
    // only the line billed above the agreed price is held
    const bad = container.querySelectorAll('#st-check .st-line.is-bad');
    expect(bad).toHaveLength(1);
    expect(bad[0].textContent).toContain('Sancerre 2023');
  });

  it('lets the reader approve both asks, and take them back, and the receipt follows', () => {
    const { container } = mount();
    const status = container.querySelector('[role="status"]');
    expect(receipt(container, 'Order, 9 bottles')?.textContent).toBe('Waiting for your yes');
    expect(receipt(container, 'Reply on line 3')?.textContent).toBe('Waiting for your yes');

    fireEvent.click(screen.getByRole('button', { name: 'Approve the order' }));
    expect(receipt(container, 'Order, 9 bottles')?.textContent).toBe('Sent by you');
    expect(receipt(container, 'Order, 9 bottles')?.classList.contains('is-wait')).toBe(false);
    expect(receipt(container, 'Reply on line 3')?.textContent).toBe('Waiting for your yes');
    expect(status?.textContent).toBe('The order: sent by you. Nothing left this page.');

    fireEvent.click(screen.getByRole('button', { name: 'Approve the reply' }));
    expect(receipt(container, 'Reply on line 3')?.textContent).toBe('Sent by you');

    fireEvent.click(screen.getByRole('button', { name: 'Undo the order' }));
    expect(receipt(container, 'Order, 9 bottles')?.textContent).toBe('Waiting for your yes');
    expect(screen.getByRole('button', { name: 'Approve the order' })).toBeTruthy();
    expect(status?.textContent).toBe('The order: back to waiting for your yes.');
  });

  it('shows every chapter finished at once for a reader who asked for less motion', () => {
    matchMediaWith(true);
    const { container } = mount();
    const parts = container.querySelectorAll('[data-reveal], [data-stage]');
    expect(parts.length).toBeGreaterThan(CHAPTERS.length * 2);
    parts.forEach((el) => expect(el.classList.contains('is-in')).toBe(true));
  });

  it('shows every chapter finished in a browser that cannot watch the screen', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = mount();
    const parts = container.querySelectorAll('[data-reveal], [data-stage]');
    expect(parts.length).toBeGreaterThan(CHAPTERS.length * 2);
    parts.forEach((el) => expect(el.classList.contains('is-in')).toBe(true));
  });

  it('lets go of every screen watcher when the page goes', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersect);
    const { unmount } = mount();
    // the words, the stages and the rail
    expect(watches).toHaveLength(3);
    unmount();
    watches.forEach((w) => expect(w.gone, String(w.opts?.rootMargin)).toBe(true));
  });

  it('gives every moving part a stage that starts no later than it, and nests no stage in another', () => {
    const { container } = mount();
    const moving = container.querySelectorAll<HTMLElement>('[data-k]');
    expect(moving.length).toBeGreaterThan(40);
    moving.forEach((el) => {
      const stage = el.closest<HTMLElement>('[data-stage]');
      expect(stage, el.className).toBeTruthy();
      const s0 = Number(stage?.style.getPropertyValue('--s0') || 0);
      expect(Number(el.style.getPropertyValue('--a0')) >= s0, el.className).toBe(true);
    });
    container
      .querySelectorAll('[data-stage]')
      .forEach((el) => expect(el.parentElement?.closest('[data-stage]'), el.className).toBeNull());
    // the day after plays the call first, then the food when it is on screen
    const soon = container.querySelector<HTMLElement>('#st-next .st-soon');
    expect(soon?.hasAttribute('data-stage')).toBe(true);
    expect(soon?.style.getPropertyValue('--s0')).toBe('68');
    expect(container.querySelector('#st-next .st-call')?.hasAttribute('data-stage')).toBe(true);
  });

  it('plays an unpinned picture once most of it is on screen, not when its chapter arrives', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersect);
    const height = heights(() => 576);
    try {
      const { container } = mount();
      const onStage = watches.find((w) => Array.isArray(w.opts?.threshold));
      expect(onStage?.seen).toEqual(Array.from(container.querySelectorAll('[data-stage]')));
      // told often enough that a picture taller than the screen still reports its share
      const steps = onStage?.opts?.threshold as number[];
      expect([steps[0], steps[steps.length - 1]]).toEqual([0, 1]);
      steps.slice(1).forEach((x, i) => expect(x - steps[i]).toBeLessThanOrEqual(1 / 40 + 1e-9));
      const entry = (target: Element, on: number, tall: number) =>
        [{ target, isIntersecting: true, intersectionRect: { height: on }, boundingClientRect: { height: tall } }] as unknown as IntersectionObserverEntry[];
      const show = (target: Element, on: number, tall: number) => onStage?.cb(entry(target, on, tall), {} as IntersectionObserver);
      const pic = container.querySelector('#st-check [data-stage]') as Element;
      // its chapter arriving, told to every observer the page has, starts nothing
      const chapter = container.querySelector('#st-check') as Element;
      act(() => watches.forEach((w) => w.cb(entry(chapter, 900, 900), {} as IntersectionObserver)));
      expect(pic.classList.contains('is-in')).toBe(false);
      show(pic, STAGE_SHARE * 500 - 1, 500);
      expect(pic.classList.contains('is-in')).toBe(false);
      show(pic, STAGE_SHARE * 500, 500);
      expect(pic.classList.contains('is-in')).toBe(true);
      // and once started it is not watched again
      expect(onStage?.dropped).toContain(pic);
      // a picture taller than the screen needs most of the screen, not most of itself
      const call = container.querySelector('#st-next .st-call') as Element;
      show(call, STAGE_SHARE * 600 - 1, 2000);
      expect(call.classList.contains('is-in')).toBe(false);
      show(call, STAGE_SHARE * 600, 2000);
      expect(call.classList.contains('is-in')).toBe(true);
    } finally {
      height.mockRestore();
    }
  });

  it('starts a played picture from its stage in the stylesheet, and draws the pin as tall as it measured', () => {
    // played: held until its stage is on screen, then run, timed from the stage
    const played = rule(storyCss, '.st-ch:not(.is-fit) [data-k]');
    expect(played).toContain('animation-play-state: paused;');
    expect(played).toContain('animation-delay: calc((var(--a0, 0) - var(--s0, 0)) * 30ms);');
    // a part inside a stage, and a stage that is itself a part
    expect(storyCss).toMatch(
      /\.st-ch:not\(\.is-fit\) \[data-stage\]\.is-in \[data-k\],\s*\.st-ch:not\(\.is-fit\) \[data-stage\]\.is-in\[data-k\] \{ animation-play-state: running; \}/,
    );
    expect(storyCss).not.toMatch(/\.st-ch\.is-in/);
    // scrubbed: the chapter names its timeline, and the pin sticks under the bar at the probe's height
    expect(rule(storyCss, '.st-ch.is-fit')).toContain('view-timeline: --st-ch block;');
    expect(rule(storyCss, '.st-ch.is-fit [data-k]')).toContain('animation-timeline: --st-ch;');
    expect(rule(storyCss, '.st-ch.is-fit .st-pin')).toMatch(/^ position: sticky; top: var\(--st-top\); height: calc\(100svh - var\(--st-top\)\);/);
    expect(rule(storyCss, '.st-probe')).toMatch(/^ position: fixed; top: var\(--st-top\);[^}]*height: calc\(100svh - var\(--st-top\)\);/);
    // the bar, which itself sits under a notch
    expect(rule(storyCss, '.mdv-story')).toContain('--st-top: calc(env(safe-area-inset-top, 0px) + var(--ld-bar-h));');
  });

  it('works out the hairlines, shadow and button ink again wherever the ground goes dark', () => {
    // the block that restates the dark ground, found by its paper colour
    const dark = landingCss.split('}').find((b) => b.includes('--paper-0: #131615')) ?? '';
    expect(dark).toContain('.mdv-landing .mudavym[data-ground="charcoal"]');
    [
      '--ld-hair: color-mix(in srgb, var(--ink-1) 12%, transparent);',
      '--ld-hair-2: color-mix(in srgb, var(--ink-1) 22%, transparent);',
      '--ld-shadow: 0 24px 60px -30px rgba(0, 0, 0, 0.75)',
      // the button's words stay dark on the light seal (7.3:1 measured)
      '--ld-on-seal: var(--paper-0);',
    ].forEach((t) => expect(dark, t).toContain(t));
    // and the night chapters are the ones on it
    const { container } = mount();
    const night = Array.from(container.querySelectorAll('.st-ch.mudavym[data-ground="charcoal"]')).map((c) => c.id);
    expect(night).toEqual(['st-old', 'st-pour', 'st-ask', 'st-close', 'st-next']);
  });

  it('lands a chapter jump at once for a reader who asked for less motion', () => {
    // the app's html glides every scroll; the story and the landing turn that off
    expect(landingCss).toMatch(/prefers-reduced-motion: reduce\) \{\s*html:has\(\.mdv-landing\) \{ scroll-behavior: auto; \}/);
    const { container } = mount();
    expect(container.querySelector('.mdv-story')?.classList.contains('mdv-landing')).toBe(true);
  });

  it('gives every moving part a when, inside its chapter', () => {
    const { container } = mount();
    const moving = container.querySelectorAll<HTMLElement>('[data-k]');
    expect(moving.length).toBeGreaterThan(40);
    moving.forEach((el) => {
      expect(el.closest('.st-ch'), el.className).toBeTruthy();
      const a0 = Number(el.style.getPropertyValue('--a0'));
      const a1 = Number(el.style.getPropertyValue('--a1'));
      expect(a0 >= 0 && a1 <= 100 && a0 < a1, `${el.className} ${a0}-${a1}`).toBe(true);
    });
  });

  it('pins only the chapters whose picture fits the shortest screen, and the rest stay unpinned', () => {
    vi.stubGlobal('CSS', scrubs);
    vi.stubGlobal('ResizeObserver', FakeResize);
    // a 600 px pin; one chapter's picture needs a pixel more than that leaves
    const height = heights((el) => (el.closest('#st-next') ? 600 - PIN_AIR + 1 : 600 - PIN_AIR));
    try {
      const { container } = mount();
      CHAPTERS.forEach((c) =>
        expect(container.querySelector(`#${c.id}`)?.classList.contains('is-fit'), c.id).toBe(c.id !== 'st-next'),
      );
    } finally {
      height.mockRestore();
    }
  });

  it('pins nothing where the browser cannot scrub or cannot measure, even when every picture fits', () => {
    const height = heights(() => 600 - PIN_AIR);
    try {
      // the control: with both, every chapter pins, so the two below fail only on the gate
      vi.stubGlobal('CSS', scrubs);
      vi.stubGlobal('ResizeObserver', FakeResize);
      const both = mount();
      expect(both.container.querySelectorAll('.st-ch.is-fit')).toHaveLength(CHAPTERS.length);
      both.unmount();

      vi.stubGlobal('CSS', { supports: () => false });
      const noScrub = mount();
      expect(noScrub.container.querySelectorAll('.st-ch.is-fit')).toHaveLength(0);
      noScrub.unmount();

      vi.stubGlobal('CSS', scrubs);
      vi.stubGlobal('ResizeObserver', undefined);
      const noMeasure = mount();
      expect(noMeasure.container.querySelectorAll('.st-ch.is-fit')).toHaveLength(0);
    } finally {
      height.mockRestore();
    }
  });

  it('measures again when the screen or a picture changes size, and stops when the page goes', () => {
    vi.stubGlobal('CSS', scrubs);
    vi.stubGlobal('ResizeObserver', FakeResize);
    let read = 600 - PIN_AIR;
    const height = heights((el) => (el.closest('#st-read') ? read : 600 - PIN_AIR));
    try {
      const { container, unmount } = mount();
      const sized = FakeResize.last as FakeResize;
      // each chapter's picture, and the blocks between the chapters whole
      const blocks = Array.from(container.querySelectorAll('main > *'));
      expect(sized.seen).toEqual([container.querySelector('.st-probe'), ...blocks.map((b) => b.querySelector('.st-grid') ?? b)]);
      expect(sized.seen.filter((el) => el.classList.contains('st-grid'))).toHaveLength(CHAPTERS.length);
      const pinned = () => container.querySelector('#st-read')?.classList.contains('is-fit');
      expect(pinned()).toBe(true);
      read += 1;
      sized.cb();
      expect(pinned()).toBe(false);
      read -= 1;
      sized.cb();
      expect(pinned()).toBe(true);
      unmount();
      expect(sized.gone).toBe(true);
    } finally {
      height.mockRestore();
    }
  });

  it('starts a chapter’s parts again when it flips between pinned and played, and only then', () => {
    vi.stubGlobal('CSS', scrubs);
    vi.stubGlobal('ResizeObserver', FakeResize);
    let read = 600 - PIN_AIR;
    const height = heights((el) => (el.closest('#st-read') ? read : 600 - PIN_AIR));
    // which chapters were stopped, and how #st-read stood, each time Story made
    // the browser work out its styles
    const flushes: string[] = [];
    const real = Element.prototype.getBoundingClientRect;
    const flush = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('mdv-story')) {
        const stopped = Array.from(this.querySelectorAll('.st-ch.is-flip')).map((c) => c.id);
        flushes.push(`${stopped.join(' ') || 'none'}, fit ${this.querySelector('#st-read')?.classList.contains('is-fit')}`);
      }
      return real.call(this);
    });
    try {
      const { container } = mount();
      const stopped = () => container.querySelectorAll('.is-flip').length;
      expect(stopped()).toBe(0);
      const sized = FakeResize.last as FakeResize;
      flushes.length = 0;
      read += 1;
      sized.cb();
      // one pass with only its parts stopped and the chapter already unpinned, then they start again
      expect(flushes).toEqual(['st-read, fit false']);
      expect(stopped()).toBe(0);
      read -= 1;
      sized.cb();
      expect(flushes).toEqual(['st-read, fit false', 'st-read, fit true']);
      expect(stopped()).toBe(0);
      // a resize that changes nothing starts nothing again
      sized.cb();
      expect(flushes).toHaveLength(2);
    } finally {
      flush.mockRestore();
      height.mockRestore();
    }
    expect(storyCss).toMatch(/\.mdv-story \.st-ch\.is-flip \[data-k\],\s*\.mdv-story \.st-ch\.is-done \[data-k\] \{ animation-name: none; \}/);
  });

  it('shows a picture finished to a keyboard reader who tabs into it, and leaves it to the scroll for a pointer', () => {
    const { container } = mount();
    const approve = screen.getByRole('button', { name: 'Approve the order' });
    const ask = container.querySelector('#st-ask') as Element;
    const real = Element.prototype.matches;
    let keys = false;
    const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, s: string) {
      return s === ':focus-visible' ? keys : real.call(this, s);
    });
    try {
      act(() => approve.focus());
      expect(document.activeElement).toBe(approve);
      expect(ask.classList.contains('is-done')).toBe(false);
      expect(into).toEqual([]);
      act(() => approve.blur());
      keys = true;
      act(() => approve.focus());
      expect(ask.classList.contains('is-done')).toBe(true);
      // only the chapter tabbed into
      expect(Array.from(container.querySelectorAll('.st-ch.is-done')).map((c) => c.id)).toEqual(['st-ask']);
      // and the button, finished, is brought clear of the bar, no further
      expect(into).toEqual([approve]);
      expect(intoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      matches.mockRestore();
    }
    // clear of the bar: each focusable thing stops below it, set on the
    // elements so no view timeline's range moves
    expect(storyCss).toMatch(/\.mdv-story main :is\(a, button\) \{ scroll-margin-top: calc\(var\(--st-top\) \+ 8px\); \}/);
    expect(storyCss).not.toMatch(/scroll-padding[\w-]*\s*:/);
  });

  it('shows a picture finished in a browser that cannot tell keys from a pointer', () => {
    const { container } = mount();
    const approve = screen.getByRole('button', { name: 'Approve the order' });
    const real = Element.prototype.matches;
    const matches = vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, s: string) {
      if (s === ':focus-visible') throw new SyntaxError(`'${s}' is not a valid selector`);
      return real.call(this, s);
    });
    try {
      act(() => approve.focus());
      expect(container.querySelector('#st-ask')?.classList.contains('is-done')).toBe(true);
      expect(into).toEqual([approve]);
    } finally {
      matches.mockRestore();
    }
  });

  it('keeps the reader’s focus on the card they answered', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Approve the order' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo the order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo the order' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve the order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve the reply' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo the reply' }));
  });

  it('counts nothing under the bar as on screen', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersect);
    // a bar taller than the usual 64 px (a notch's safe area above it)
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('st-probe') ? 91 : 0;
    });
    try {
      mount();
      expect(watches.find((w) => Array.isArray(w.opts?.threshold))?.opts?.rootMargin).toBe('-91px 0px 0px 0px');
      expect(watches.some((w) => w.opts?.rootMargin === '-91px 0px -10% 0px')).toBe(true);
    } finally {
      top.mockRestore();
    }
    // the probe starts where the bar ends, so where it starts is the bar
    expect(storyCss).toMatch(/\.st-probe \{ position: fixed; top: var\(--st-top\);/);
  });

  it('marks the chapter at the middle of the screen on the rail, the dusk band as its own, and none above the first or past the last', () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersect);
    const { container } = mount();
    const rail = watches.find((w) => w.opts?.rootMargin === '-50% 0px -50% 0px');
    expect(rail?.seen).toEqual(Array.from(container.querySelectorAll('main > *')));
    const at = (...xs: [string, boolean][]) =>
      act(() =>
        rail?.cb(
          xs.map(([sel, on]) => ({ target: container.querySelector(sel), isIntersecting: on })) as unknown as IntersectionObserverEntry[],
          {} as IntersectionObserver,
        ),
      );
    const marked = () => Array.from(container.querySelectorAll('.st-rail a[aria-current]')).map((a) => a.getAttribute('href'));
    at(['.st-hero', true]);
    expect(marked()).toEqual([]);
    at(['.st-hero', false], ['#st-old', true]);
    expect(marked()).toEqual(['#st-old']);
    // one leaves as the next arrives, told in either order
    at(['#st-old', false], ['#st-turn', true]);
    expect(marked()).toEqual(['#st-turn']);
    at(['#st-door', true], ['#st-turn', false]);
    expect(marked()).toEqual(['#st-door']);
    // the band between dusk and the pour is still dusk
    at(['#st-door', false], ['#st-dusk', true]);
    at(['#st-dusk', false], ['.st-fall', true]);
    expect(marked()).toEqual(['#st-dusk']);
    at(['.st-fall', false], ['#st-pour', true]);
    expect(marked()).toEqual(['#st-pour']);
    // past the last, and back above the first
    at(['#st-pour', false], ['.st-end', true]);
    expect(marked()).toEqual([]);
    at(['.st-end', false], ['#st-old', true]);
    at(['#st-old', false]);
    expect(marked()).toEqual([]);
    // the rail's words are the page's second ink, readable over the night chapters
    expect(storyCss).toMatch(/\.st-rail a \{[^}]*color: var\(--ink-2\)/);
  });

  it('keeps the reader in the same place of the same chapter when the screen changes size', () => {
    vi.stubGlobal('CSS', scrubs);
    vi.stubGlobal('ResizeObserver', FakeResize);
    vi.stubGlobal('IntersectionObserver', FakeIntersect);
    // a page laid out as the stylesheet lays it: a pinned chapter as long as
    // the screen is tall, and the browser keeping scrollY through a rotation
    let vh = 900;
    let w = 1440;
    let y = 0;
    let blocks: Element[] = [];
    const tall = (b: Element) =>
      b.classList.contains('st-ch') ? 2.4 * vh : b.classList.contains('st-fall') ? 0.34 * vh : b.classList.contains('st-hero') ? vh : 700;
    const from = (b: Element) => 64 + blocks.slice(0, blocks.indexOf(b)).reduce((s, x) => s + tall(x), 0);
    const page = () => from(blocks[blocks.length - 1]) + tall(blocks[blocks.length - 1]) + 300;
    const realBox = Element.prototype.getBoundingClientRect;
    const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (!blocks.includes(this)) return realBox.call(this);
      return { top: from(this) - y, height: tall(this) } as DOMRect;
    });
    const long = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
      return this === document.documentElement ? page() : 0;
    });
    const was = { inner: Object.getOwnPropertyDescriptor(window, 'innerHeight'), y: Object.getOwnPropertyDescriptor(window, 'scrollY') };
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => vh });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
    const to = vi.fn((o: ScrollToOptions) => {
      y = o.top ?? y;
    });
    vi.stubGlobal('scrollTo', to);
    // the probe is the screen under the bar; every picture fits the tall screen
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('st-probe')) return vh - 64;
      return this.classList.contains('st-grid') ? 600 - PIN_AIR : 99999;
    });
    const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('mdv-story') ? w : 0;
    });
    const on = vi.spyOn(window, 'addEventListener');
    const off = vi.spyOn(window, 'removeEventListener');
    // the reader, or the browser, scrolls
    const scrolled = () => window.dispatchEvent(new Event('scroll'));
    try {
      const { container, unmount } = mount();
      const root = container.querySelector('.mdv-story') as Element;
      blocks = Array.from(container.querySelectorAll('main > *'));
      const sized = FakeResize.last as FakeResize;
      const el = (sel: string) => container.querySelector(sel) as Element;
      // how far into this block the middle of the screen is
      const share = (sel: string) => (y + vh / 2 - from(el(sel))) / tall(el(sel));
      // the browser's own anchoring stands down while Story keeps the place
      expect(root.classList.contains('is-placed')).toBe(true);
      expect(storyCss).toMatch(/\.mdv-story\.is-placed \{ overflow-anchor: none; \}/);

      // the reader scrolls a quarter into the order; a picture that changes
      // size there leaves them where they are
      y = from(el('#st-ask')) + 0.25 * tall(el('#st-ask')) - vh / 2;
      scrolled();
      sized.cb();
      expect(to).not.toHaveBeenCalled();
      // the window gets shorter: the same quarter after
      vh = 600;
      sized.cb();
      expect(to).toHaveBeenLastCalledWith({ top: expect.any(Number), behavior: 'instant' });
      expect(share('#st-ask')).toBeCloseTo(0.25, 2);
      // and back
      vh = 900;
      sized.cb();
      expect(share('#st-ask')).toBeCloseTo(0.25, 2);

      // Nine tenths into the last chapter the window gets shorter. So does the
      // page, and the browser pulls the reader up to its new end before Story
      // can run: a scroll on the new screen, which says nothing of where they
      // were. They are put back nine tenths in, and kept there going back.
      y = from(el('#st-next')) + 0.9 * tall(el('#st-next')) - vh / 2;
      scrolled();
      vh = 600;
      y = page() - vh;
      scrolled();
      sized.cb();
      expect(share('#st-next')).toBeCloseTo(0.9, 2);
      vh = 900;
      sized.cb();
      expect(share('#st-next')).toBeCloseTo(0.9, 2);
      // a phone turning moves the reader by its own anchor first, on the new width
      w = 844;
      y -= 400;
      scrolled();
      sized.cb();
      expect(share('#st-next')).toBeCloseTo(0.9, 2);

      // a reader at the top stays at the top
      to.mockClear();
      y = 0;
      scrolled();
      vh = 600;
      sized.cb();
      expect(to).not.toHaveBeenCalled();
      expect(y).toBe(0);

      // it only listens, and stops when the page goes
      const listen = on.mock.calls.find(([type]) => type === 'scroll');
      expect(listen?.[2]).toEqual({ passive: true });
      unmount();
      expect(off).toHaveBeenCalledWith('scroll', listen?.[1]);
    } finally {
      height.mockRestore();
      width.mockRestore();
      on.mockRestore();
      off.mockRestore();
      box.mockRestore();
      long.mockRestore();
      if (was.inner) Object.defineProperty(window, 'innerHeight', was.inner);
      if (was.y) Object.defineProperty(window, 'scrollY', was.y);
    }
  });

  it('ends further out, says it is not built yet, and the call waits for your yes', () => {
    const { container } = mount();
    const next = container.querySelector<HTMLElement>('#st-next');
    expect(next?.querySelector('.st-time')?.textContent).toBe('Tomorrow Not built yet');
    // its title promises no date either
    expect(next?.querySelector('h2')?.textContent).toBe('It will pick up the phone, too.');
    expect(next?.textContent).toContain('Every offer comes back to you. It agrees to nothing without your yes.');
    // the call follows up the reply the reader approved, about the line the
    // night held, and brings back an offer, not a deal
    expect(next?.textContent).toContain('Here it follows up the reply on line 3, once that reply has your yes.');
    expect(next?.querySelector('.st-call')?.textContent).toContain('following up our email on invoice 20931');
    expect(next?.querySelector('.st-call')?.textContent).toContain(`credit the $${HELD.toFixed(2)}`);
    expect(next?.querySelector('.st-call-end')?.textContent?.trim()).toBe('Offer brought back. Waiting for your yes.');
    // the food prints no figure and no date
    expect(next?.querySelector('.st-soon')?.textContent).not.toMatch(/\d/);
  });

  it('promises nothing the landing does not: no auto-send, no tenths, no audit trail', () => {
    const { container } = mount();
    const text = container.textContent ?? '';
    expect(text).toContain('Orders and replies to vendors wait for a person to approve them.');
    // the landing's own words for the one exception (Landing's How it works)
    expect(text).toContain('Automatic replies stay off until you turn them on.');
    expect(text).not.toMatch(/tenth/i);
    expect(text).not.toMatch(/every action is written down/i);
    expect(text).not.toMatch(/automatically|on its own|by itself|auto-?send/i);
    // close leaves what needs a yes waiting for it
    expect(container.querySelector('#st-close')?.textContent).toContain(
      'Anything that needs your yes is still waiting for it.',
    );
  });
});
