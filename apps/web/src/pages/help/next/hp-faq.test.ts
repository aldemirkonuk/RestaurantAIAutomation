import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAQ_ENTRIES, findFaq } from './hp-faq';

const APP_TSX = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');

describe('FAQ entries — re-checkable claims', () => {
  it('every slug is unique and URL-safe', () => {
    const slugs = FAQ_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });
  it('every `goes.to` names a route App.tsx mounts', () => {
    for (const e of FAQ_ENTRIES) {
      if (!e.goes) continue;
      const path = e.goes.to.split('?')[0].split('#')[0];
      expect(APP_TSX, `${e.slug} -> ${path}`).toContain(`path="${path}"`);
    }
  });
  it('no answer names the old brand, an agent, or carries an emoji', () => {
    for (const e of FAQ_ENTRIES) {
      const text = `${e.question} ${e.answer} ${e.goes?.label ?? ''}`;
      expect(text).not.toMatch(/wineops/i);
      expect(text).not.toMatch(/wine agent/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
  it('has at least the four questions the shipping page answered', () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(4);
    expect(findFaq('invite-team')).not.toBeNull();
    expect(findFaq('password-or-login')).not.toBeNull();
    expect(findFaq('who-edits-settings')).not.toBeNull();
    expect(findFaq('reach-the-team')).not.toBeNull();
  });
});

describe('findFaq', () => {
  it('accepts a bare slug or a hash, and returns null for anything else', () => {
    expect(findFaq('#page-tours')?.slug).toBe('page-tours');
    expect(findFaq('page-tours')?.slug).toBe('page-tours');
    expect(findFaq('#nope')).toBeNull();
    expect(findFaq(null)).toBeNull();
    expect(findFaq('')).toBeNull();
  });
});
