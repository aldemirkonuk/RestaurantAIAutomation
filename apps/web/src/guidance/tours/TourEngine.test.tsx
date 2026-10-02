/**
 * The tour as sketch 125 Tips A draws it (locked 2026-10-01): a ring on the
 * real thing and a small card beside it — no dark veil, "Step N of M" above
 * the title, and Try it / Back / Next / Stop in words.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Cfg = Record<string, any>;
let cfg: Cfg | null = null;
const destroy = vi.fn();
// Most cases read the config the engine hands driver.js; one runs driver.js
// 1.8.0 itself, to see where it puts focus.
let realDriver: { destroy: () => void } | null = null;
let useRealDriver = false;
vi.mock('driver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('driver.js')>();
  return {
    driver: (c: Cfg) => {
      cfg = c;
      if (useRealDriver) {
        realDriver = actual.driver(c as any);
        return realDriver;
      }
      return { drive: vi.fn(), destroy, getActiveIndex: () => 0, isActive: () => true };
    },
  };
});
vi.mock('driver.js/dist/driver.css', () => ({}));
vi.mock('./registry', () => ({
  TOUR_REGISTRY: {
    orders: {
      pageId: 'orders',
      steps: [
        { element: '#start-order', title: 'Start an order', description: 'Pick a vendor.' },
        { element: '#missing', title: 'Not on this page', description: 'Skipped.' },
        { element: '#approve', title: 'Approve it', description: 'Only when drawn.' },
      ],
    },
  },
}));

import { stepsOnPage, useTourEngine } from './TourEngine';

function popoverDom() {
  const wrapper = document.createElement('div');
  const title = document.createElement('header');
  const progress = document.createElement('span');
  const footer = document.createElement('footer');
  const footerButtons = document.createElement('span');
  const closeButton = document.createElement('button');
  const previousButton = document.createElement('button');
  const nextButton = document.createElement('button');
  closeButton.textContent = '×';
  previousButton.textContent = 'Back';
  nextButton.textContent = 'Next';
  wrapper.append(closeButton, title, footer);
  footer.append(progress, footerButtons);
  footerButtons.append(previousButton, nextButton);
  document.body.appendChild(wrapper);
  return { wrapper, title, progress, footer, footerButtons, closeButton, previousButton, nextButton } as any;
}

async function start() {
  const onCompleted = vi.fn();
  const onSkipped = vi.fn();
  const { result } = renderHook(() => useTourEngine({ onCompleted, onSkipped }));
  await act(async () => {
    await result.current.startTour('orders');
  });
  return { onCompleted, onSkipped };
}

beforeEach(() => {
  cfg = null;
  destroy.mockReset();
  useRealDriver = false;
  realDriver = null;
  document.body.innerHTML = '<button id="start-order">New order</button>';
});

describe('the tour card', () => {
  it('draws no veil and wears the house card', async () => {
    await start();
    expect(cfg).not.toBeNull();
    expect(cfg!.overlayOpacity).toBe(0);
    expect(cfg!.popoverClass).toBe('mudavym mdv-tourcard');
    expect(cfg!.progressText).toBe('Step {{current}} of {{total}}');
  });

  it('keeps only steps whose real element is on the page, titled without a "1/4" prefix', async () => {
    await start();
    expect(cfg!.steps).toHaveLength(1);
    expect(cfg!.steps[0].popover.title).toBe('Start an order');
  });

  it('puts the step count above the title and says Stop and Try it in words', async () => {
    await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    expect(p.progress.nextSibling).toBe(p.title);
    expect(p.closeButton.textContent).toBe('Stop');
    expect(p.closeButton.parentElement).toBe(p.footerButtons);
    expect(p.footerButtons.firstElementChild?.textContent).toBe('Try it');
  });

  it('"Try it" ends the tour and puts the person on the real control', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const scroll = vi.fn();
    (HTMLElement.prototype as any).scrollIntoView = scroll;
    const { onCompleted } = await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    (p.footerButtons.firstElementChild as HTMLButtonElement).click();
    expect(destroy).toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledWith('orders');
    expect(document.activeElement?.id).toBe('start-order');
    expect(scroll).toHaveBeenCalled();
    raf.mockRestore();
  });

  it('"Try it" on a ringed group puts focus on the group, never on the page', async () => {
    document.body.innerHTML = '<div id="start-order"><span>Figures</span></div>';
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    (HTMLElement.prototype as any).scrollIntoView = vi.fn();
    await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    (p.footerButtons.firstElementChild as HTMLButtonElement).click();
    expect(document.activeElement?.id).toBe('start-order');
    expect(document.activeElement).not.toBe(document.body);
    raf.mockRestore();
  });

  it('the focus stop "Try it" gives a group is taken away when focus leaves it', async () => {
    document.body.innerHTML =
      '<div id="start-order"><span>Figures</span></div><button id="elsewhere">Elsewhere</button>';
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    (HTMLElement.prototype as any).scrollIntoView = vi.fn();
    await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    (p.footerButtons.firstElementChild as HTMLButtonElement).click();
    const group = document.getElementById('start-order')!;
    expect(document.activeElement).toBe(group);
    expect(group.getAttribute('tabindex')).toBe('-1');
    (document.getElementById('elsewhere') as HTMLButtonElement).focus();
    expect(group.hasAttribute('tabindex')).toBe(false);
    raf.mockRestore();
  });

  it('leaves a control that already takes focus as it was', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    (HTMLElement.prototype as any).scrollIntoView = vi.fn();
    await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    (p.footerButtons.firstElementChild as HTMLButtonElement).click();
    expect(document.activeElement?.id).toBe('start-order');
    expect(document.getElementById('start-order')!.hasAttribute('tabindex')).toBe(false);
    raf.mockRestore();
  });

  it('hands focus from "Try it" to Next once driver.js has focused the first button', async () => {
    await start();
    const p = popoverDom();
    cfg!.onPopoverRender(p, { driver: { getActiveIndex: () => 0, destroy } });
    // What driver.js 1.8.0 does right after this hook: focus the first button.
    (p.footerButtons.firstElementChild as HTMLButtonElement).focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(p.nextButton);
  });

  it('with driver.js itself, the card opens on Next, and Next walks to the last step', async () => {
    document.body.innerHTML = '<button id="start-order">New order</button><div id="approve">Approve</div>';
    useRealDriver = true;
    // jsdom lays nothing out, and driver.js only focuses what has a box.
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);
    const motion = vi
      .spyOn(window, 'matchMedia')
      .mockReturnValue({ matches: true } as unknown as MediaQueryList);
    try {
      await start();
      await Promise.resolve();
      const card = document.querySelector('.driver-popover')!;
      expect(card.textContent).toContain('Step 1 of 2');
      expect(document.activeElement?.textContent).toBe('Next');
      (document.activeElement as HTMLButtonElement).click();
      await Promise.resolve();
      expect(document.querySelector('.driver-popover')!.textContent).toContain('Step 2 of 2');
      expect(document.activeElement?.textContent).toBe('Done');
    } finally {
      realDriver?.destroy();
      rects.mockRestore();
      motion.mockRestore();
    }
  });
});

describe('stepsOnPage', () => {
  it('is the steps whose element is on the page now, in tour order', () => {
    expect(stepsOnPage('orders').map((s) => s.element)).toEqual(['#start-order']);
    document.body.insertAdjacentHTML('beforeend', '<div id="approve"></div>');
    expect(stepsOnPage('orders').map((s) => s.element)).toEqual(['#start-order', '#approve']);
  });

  it('is empty for a page with no tour', () => {
    expect(stepsOnPage('calendar')).toEqual([]);
  });
});
