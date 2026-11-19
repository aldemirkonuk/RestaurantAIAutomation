/**
 * On a phone the five stations are a snap strip of 148 x 64 tiles, 8 px apart, not five
 * 75 px slivers (design need N-11), the station you pressed is brought into
 * view, and the page's one act is a full-width 52 px button.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { StageSpine } from './StageSpine';

const css = readFileSync(resolve(__dirname, 'orders-phone.css'), 'utf8').replace(/\s+/g, ' ');
const phoneBlock = /@media \(max-width: 639px\) \{(.*)\}\s*$/.exec(css)?.[1] ?? '';

const counts = { pending: 3, approved: 1, ordered: 2, delivered: 5, cancelled: 0 } as never;

describe('the stage strip on a phone', () => {
  it('is one horizontal snap strip with 148 x 64 tiles, 8 px apart', () => {
    expect(phoneBlock).toMatch(/\.ord-spine \{[^}]*overflow-x: auto/);
    expect(phoneBlock).toMatch(/\.ord-spine \{[^}]*scroll-snap-type: x mandatory/);
    expect(phoneBlock).toMatch(/\.ord-spine \{[^}]*gap: 8px/);
    expect(phoneBlock).toMatch(/\.ord-spine \{[^}]*max-width: 100%/);
    expect(phoneBlock).toMatch(/\.ord-spine__tile \{[^}]*flex: 0 0 148px/);
    expect(phoneBlock).toMatch(/\.ord-spine__tile \{[^}]*min-height: 64px/);
    expect(phoneBlock).toMatch(/\.ord-spine__tile \{[^}]*scroll-snap-align: start/);
  });

  it('the second act is a text link, still a 44 px target', () => {
    expect(phoneBlock).toMatch(/\.ord-write--alt \{[^}]*min-height: 44px/);
    expect(phoneBlock).toMatch(/\.ord-write--alt \{[^}]*background: transparent/);
  });

  it('the primary act is a full 52 px, one line, on a phone', () => {
    expect(phoneBlock).toMatch(/\.ord-write \{[^}]*width: 100%/);
    expect(phoneBlock).toMatch(/\.ord-write \{[^}]*min-height: 52px/);
    expect(phoneBlock).toMatch(/\.ord-write \{[^}]*white-space: nowrap/);
  });

  it('carries the classes the css names', () => {
    render(<StageSpine counts={counts} recurringCount={2} active={null} onSelect={() => {}} />);
    const strip = screen.getByRole('tablist', { name: 'Order stages' });
    expect(strip.className).toContain('ord-spine');
    expect(screen.getAllByRole('tab')).toHaveLength(5);
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toContain('ord-spine__tile');
  });

  it('brings the pressed station into view, nearest edge only', () => {
    const scroll = vi.fn();
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(
      <StageSpine counts={counts} recurringCount={2} active={null} onSelect={() => {}} />,
    );
    expect(scroll).not.toHaveBeenCalled();
    rerender(<StageSpine counts={counts} recurringCount={2} active="delivered" onSelect={() => {}} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.calls[0][0]).toMatchObject({ inline: 'nearest', block: 'nearest' });
    Element.prototype.scrollIntoView = had;
  });
});
