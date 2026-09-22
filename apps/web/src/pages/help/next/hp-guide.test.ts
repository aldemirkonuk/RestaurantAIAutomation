import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_ENTRIES, findGuide } from './hp-guide';

const APP_TSX = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');

describe('guide entries — the collection ADR 0160 §111 owes', () => {
  it('every slug is unique and URL-safe', () => {
    const slugs = GUIDE_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });
  it('every `goes.to` names a route App.tsx mounts', () => {
    for (const e of GUIDE_ENTRIES) {
      if (!e.goes) continue;
      const path = e.goes.to.split('?')[0].split('#')[0];
      expect(APP_TSX, `${e.slug} -> ${path}`).toContain(`path="${path}"`);
    }
  });
  it('covers the four articles the founder named, in ADR 0160 §111’s own words', () => {
    expect(findGuide('using-the-assistant')).not.toBeNull();
    expect(findGuide('moving-between-tasks')).not.toBeNull();
    expect(findGuide('configuring-tasks-and-goals')).not.toBeNull();
    expect(findGuide('general-overview')).not.toBeNull();
  });
  it('reads as documentation, not marketing: no old brand, no emoji, every entry has real steps', () => {
    for (const e of GUIDE_ENTRIES) {
      const text = `${e.title} ${e.dek} ${e.steps.map((s) => s.text).join(' ')}`;
      expect(text).not.toMatch(/wineops/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(e.steps.length).toBeGreaterThan(0);
      for (const s of e.steps) expect(s.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('findGuide', () => {
  it('accepts a bare slug or a hash, and returns null for anything else', () => {
    expect(findGuide('#general-overview')?.slug).toBe('general-overview');
    expect(findGuide('general-overview')?.slug).toBe('general-overview');
    expect(findGuide('#nope')).toBeNull();
    expect(findGuide(null)).toBeNull();
    expect(findGuide('')).toBeNull();
  });
});
