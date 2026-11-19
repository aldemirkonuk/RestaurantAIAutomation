/**
 * c3 need 16: the Table / Cellar map pill is a 44 px hit area around a 32 px
 * thumb. The pill keeps its footprint in the toolbar (negative block margin).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'inventory-next.css'), 'utf8');
const tsx = readFileSync(resolve(__dirname, 'InventoryNext.tsx'), 'utf8');
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('inventory view pill (c3 need 16)', () => {
  it('the View pill wears the iv-view-pill class', () => {
    expect(tsx).toMatch(/ariaLabel="View"[\s\S]{0,80}className="iv-view-pill"/);
  });
  it('each option is 44 px tall, the thumb is 32, the footprint stays 32', () => {
    expect(rule('.iv-view-pill .mdv-pill__opt')).toMatch(/min-height:\s*44px/);
    const thumb = rule('.iv-view-pill .mdv-pill__thumb');
    expect(thumb).toMatch(/top:\s*6px/);
    expect(thumb).toMatch(/bottom:\s*6px/);
    const pill = rule('.mdv-pill.iv-view-pill');
    expect(pill).toMatch(/margin-block:\s*-6px/);
    // Names .mdv-pill too: the shared rule loads later and ties on one class.
    expect(pill).toMatch(/padding:\s*0;/);
  });
});
