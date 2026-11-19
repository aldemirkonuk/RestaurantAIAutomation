/**
 * c3 need 17: at 375 the hero's lede and its caption read as one block. The
 * caption sits 16 px under the lede and is set at 12 px.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'story.css'), 'utf8');
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('story hero spacing (c3 need 17)', () => {
  it('the caption sits 16 px under the lede', () => {
    expect(rule('.st-hero .st-hero-note')).toMatch(/margin-top:\s*16px/);
  });
  it('the lede and caption margins out-weigh the landing reset (.mdv-landing :where(p), one class)', () => {
    expect(rule('.st-hero .st-hero-sub')).toMatch(/margin-top:\s*24px/);
    expect(css).not.toMatch(/^\.st-hero-(note|sub) \{/m);
  });
  it('the caption is 12 px', () => {
    expect(rule('.st-hero .st-hero-note')).toMatch(/font:\s*500 12px\//);
  });
  it('no phone rule pulls the caption back up under the lede', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 860px)'), css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(phone).not.toMatch(/st-hero-(note|sub)[^}]*margin/);
  });
});
