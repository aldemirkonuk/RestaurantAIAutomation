import { describe, expect, it } from 'vitest';
import {
  buildSupportMailto,
  diagnosticsBlock,
  readEmailChannel,
  readSlackChannel,
  readSupportChannels,
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

describe('readSlackChannel', () => {
  it('unset is unconfigured', () => {
    expect(readSlackChannel(undefined)).toEqual({ state: 'unconfigured' });
  });
  it('an https URL is configured and names its host', () => {
    const r = readSlackChannel('https://example.slack.com/archives/C01');
    expect(r).toEqual({ state: 'configured', url: 'https://example.slack.com/archives/C01', host: 'example.slack.com' });
  });
  it('a plain word or an http URL is unusable, with the reason', () => {
    expect(readSlackChannel('slack')).toEqual({ state: 'unusable', raw: 'slack', why: 'not a URL' });
    expect(readSlackChannel('http://example.slack.com')).toEqual({
      state: 'unusable', raw: 'http://example.slack.com', why: 'not https',
    });
  });
});

describe('readSupportChannels — the whole env, and the string the legacy page falls back to', () => {
  it('an empty env yields two unconfigured channels', () => {
    expect(readSupportChannels({})).toEqual({ email: { state: 'unconfigured' }, slack: { state: 'unconfigured' } });
  });
  it('never produces the legacy defaults from nothing', () => {
    const s = JSON.stringify(readSupportChannels({}));
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
