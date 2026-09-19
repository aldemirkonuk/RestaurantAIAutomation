import { describe, expect, it } from 'vitest';
import {
  buildSupportMailto,
  diagnosticsBlock,
  readEmailChannel,
  readSupportChannel,
  supportSubject,
} from './hp-support';

describe('readEmailChannel — no fallback, ever', () => {
  it('an unset variable is UNCONFIGURED, never a wineops address', () => {
    expect(readEmailChannel(undefined)).toEqual({ state: 'unconfigured' });
    expect(readEmailChannel('')).toEqual({ state: 'unconfigured' });
    expect(readEmailChannel('   ')).toEqual({ state: 'unconfigured' });
  });
  it('a real address is configured, trimmed', () => {
    expect(readEmailChannel('  help@example.com ')).toEqual({ state: 'configured', address: 'help@example.com' });
  });
  it('a value that is not one mail address is UNUSABLE and keeps what it read', () => {
    expect(readEmailChannel('help at example')).toEqual({
      state: 'unusable', raw: 'help at example', why: 'not a single mail address',
    });
    expect(readEmailChannel('a@b.com, c@d.com').state).toBe('unusable');
    expect(readEmailChannel('Support <a@b.com>').state).toBe('unusable');
  });
});

describe('readSupportChannel — the whole env, and the string the legacy page fell back to', () => {
  it('an empty env yields one unconfigured channel', () => {
    expect(readSupportChannel({})).toEqual({ state: 'unconfigured' });
  });
  it('never produces the legacy wineops default from nothing', () => {
    const s = JSON.stringify(readSupportChannel({}));
    expect(s).not.toMatch(/wineops/i);
  });
});

describe('diagnosticsBlock — absences are written as absences', () => {
  const at = new Date('2026-09-11T14:31:05.000Z');
  it('with nothing known, every line says "not recorded" and the gateway says "not checked"', () => {
    const b = diagnosticsBlock({ at });
    expect(b).toContain('House: not recorded');
    expect(b).toContain('Gateway: not checked');
    expect(b).toContain('Written: 2026-09-11T14:31:05.000Z');
    expect(b).not.toMatch(/undefined|null/);
  });
  it('a ready gateway states the build and the latency; an unreachable one states the error and no build', () => {
    const ready = diagnosticsBlock({ at, gateway: { state: 'ready', commit: '1190cec4', latencyMs: 84.4 } });
    expect(ready).toContain('Gateway: ready, answered in 84 ms');
    expect(ready).toContain('Gateway build: 1190cec4');
    const down = diagnosticsBlock({ at, gateway: { state: 'unreachable', detail: 'Network Error' } });
    expect(down).toContain('Gateway: unreachable — Network Error');
    expect(down).toContain('Gateway build: not recorded');
  });
  it('carries the house and where the person came from', () => {
    const b = diagnosticsBlock({ at, houseName: 'Sim Meyhouse', houseId: 'a229f22b', role: 'owner', cameFrom: '/orders' });
    expect(b).toContain('House: Sim Meyhouse');
    expect(b).toContain('House id: a229f22b');
    expect(b).toContain('Came from: /orders');
  });
});

describe('buildSupportMailto', () => {
  it('targets the address, names the house in the subject and carries the block in the body', () => {
    const m = buildSupportMailto('help@example.com', { houseName: 'Sim Meyhouse', at: new Date('2026-09-11T00:00:00Z') });
    expect(m.startsWith('mailto:help@example.com?subject=')).toBe(true);
    expect(decodeURIComponent(m)).toContain('subject=Mudavym support — Sim Meyhouse');
    expect(decodeURIComponent(m)).toContain('House: Sim Meyhouse');
  });
  it('without a house name the subject says so rather than inventing one', () => {
    expect(decodeURIComponent(buildSupportMailto('help@example.com', {}))).toContain('subject=Mudavym support — a house');
  });
});

describe('supportSubject — the same line the mailto and the write-to-support panel both show', () => {
  it('names the house', () => {
    expect(supportSubject('Sim Meyhouse')).toBe('Mudavym support — Sim Meyhouse');
  });
  it('says "a house" for a missing or blank name, never an empty subject', () => {
    expect(supportSubject(undefined)).toBe('Mudavym support — a house');
    expect(supportSubject(null)).toBe('Mudavym support — a house');
    expect(supportSubject('   ')).toBe('Mudavym support — a house');
  });
  it('is the exact prefix buildSupportMailto encodes into the mailto — one subject, not two', () => {
    const subject = supportSubject('Sim Meyhouse');
    const m = buildSupportMailto('help@example.com', { houseName: 'Sim Meyhouse' });
    expect(decodeURIComponent(m)).toContain(`subject=${subject}`);
  });
});
