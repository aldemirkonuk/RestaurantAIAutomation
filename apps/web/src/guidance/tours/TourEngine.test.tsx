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
vi.mock('driver.js', () => ({
  driver: (c: Cfg) => {
    cfg = c;
    return { drive: vi.fn(), destroy, getActiveIndex: () => 0, isActive: () => true };
  },
}));
vi.mock('driver.js/dist/driver.css', () => ({}));
vi.mock('./registry', () => ({
  TOUR_REGISTRY: {
    orders: {
      pageId: 'orders',
      steps: [
        { element: '#start-order', title: 'Start an order', description: 'Pick a vendor.' },
        { element: '#missing', title: 'Not on this page', description: 'Skipped.' },
      ],
    },
  },
}));

import { useTourEngine } from './TourEngine';

function popoverDom() {
  const wrapper = document.createElement('div');
  const title = document.createElement('header');
  const progress = document.createElement('span');
  const footer = document.createElement('footer');
  const footerButtons = document.createElement('span');
  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  wrapper.append(closeButton, title, footer);
  footer.append(progress, footerButtons);
  return { wrapper, title, progress, footer, footerButtons, closeButton } as any;
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
});
