import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAQ_ENTRIES, findFaq } from './hp-faq';

const APP_TSX = readFileSync(resolve(__dirname, '../../../App.tsx'), 'utf8');
const HELP_TSX = readFileSync(resolve(__dirname, 'HelpNext.tsx'), 'utf8');
const TIP_TSX = readFileSync(resolve(__dirname, '../../../guidance/components/PageTipStrip.tsx'), 'utf8');
const PROVIDER_TSX = readFileSync(resolve(__dirname, '../../../guidance/GuidanceProvider.tsx'), 'utf8');

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
      expect(path.length, `${e.slug} -> an empty path is not a route`).toBeGreaterThan(0);
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
  it('says how to replace someone who is leaving: add, choose them on Remove, then remove; the rest goes to the open pool (founder item 93; ADR 0215 item 27)', () => {
    const e = findFaq('replace-team-member');
    expect(e).not.toBeNull();
    const a = e!.answer;
    // The order is the procedure: add, pick them in the remove dialog, remove.
    expect(a.indexOf('Add the new person')).toBeGreaterThanOrEqual(0);
    expect(a.indexOf('Add the new person')).toBeLessThan(a.indexOf('Their upcoming shifts go to'));
    expect(a.indexOf('Their upcoming shifts go to')).toBeLessThan(a.indexOf('Remove the leaving person last'));
    // The founder's checks: overlap refused unless the owner allows it; the rest warn.
    expect(a).toMatch(/overlaps.*cannot go to them unless the owner allows double booking/);
    expect(a).toMatch(/time off, a different role and a week over 45 hours are shown as warnings/);
    expect(a).toMatch(/goes back to the open pool/);
    expect(a).toMatch(/past shifts stay in the owner’s former-staff history/);
  });
  it('sends people for tours and tips to what the house shell draws, by the words it draws', () => {
    const a = findFaq('page-tours')!.answer;
    // The legacy sidebar's "Learn & Help" is not in the house shell.
    expect(a).not.toMatch(/Learn & Help|sidebar/i);
    for (const label of ['Turn tips back on', 'Ways back in']) {
      expect(a, label).toContain(label);
      expect(HELP_TSX, `HelpNext.tsx draws "${label}"`).toContain(label);
    }
    for (const label of ['Show me', "Don't show tips again"]) {
      expect(a, label).toContain(label);
      expect(TIP_TSX, `PageTipStrip.tsx draws "${label}"`).toContain(label);
    }
  });
  it('says tips come back in the tab that turned them back on, not in every browser or tab', () => {
    // The gateway deep-merges the save, so another browser keeps a page's
    // "Not now" snooze (tech-debt fragment 2026-10-02-feat-tips-margin-note-and-tour-card),
    // and the two-turned-away limit is counted per tab, in sessionStorage.
    const a = findFaq('page-tours')!.answer;
    expect(a).toMatch(/Every page’s tip then comes back in this tab/);
    expect(a).toMatch(/In another browser, a tip you put off with "Not now" can stay hidden for up to four hours/);
    expect(a).toMatch(/two tips or tours in one tab, that tab shows no more tips until it is closed/);
    expect(a).not.toMatch(/: every page’s tip returns|In this browser every page’s tip returns/);
  });
  it('states the numbers the provider uses: four hours for "Not now", two turned away per tab', () => {
    const a = findFaq('page-tours')!.answer;
    expect(a).toContain('"Not now" puts that tip off for four hours');
    expect(PROVIDER_TSX).toContain('const until = new Date(Date.now() + 4 * 60 * 60 * 1000)');
    expect(PROVIDER_TSX).toContain('if (sessionRef.current.skips >= 2) return null');
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
