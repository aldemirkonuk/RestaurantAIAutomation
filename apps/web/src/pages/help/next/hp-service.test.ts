import { describe, expect, it } from 'vitest';
import {
  databaseWord,
  readinessFromResponse,
  readinessUnreachable,
  serviceNextStep,
  serviceSentence,
} from './hp-service';

const at = new Date('2026-09-11T14:31:05.000Z');

describe('readinessFromResponse', () => {
  it('200 + status ready is READY, with every field read as sent', () => {
    const s = readinessFromResponse(200, {
      status: 'ready', commit: '1190cec4abc', bootedAt: '2026-09-11T12:00:00Z', checkedAt: '2026-09-11T14:31:00Z',
      checks: { injector: 'resolved', supabaseClient: 'present', database: 'reachable' },
    }, 84, at);
    expect(s.kind).toBe('answered');
    if (s.kind !== 'answered') return;
    expect(s.ready).toBe(true);
    expect(s.commit).toBe('1190cec4abc');
    expect(s.database).toBe('reachable');
    expect(s.latencyMs).toBe(84);
    expect(serviceSentence(s)).toBe('The service is up and can reach its database.');
    expect(databaseWord(s)).toBe('reachable');
  });
  it('503 not_ready keeps the gateway reason and the failed check', () => {
    const s = readinessFromResponse(503, {
      status: 'not_ready', commit: 'unknown', bootedAt: '2026-09-11T12:00:00Z',
      checks: { injector: 'resolved', supabaseClient: 'present', database: 'unreachable' }, reason: 'database_unreachable',
    }, 1200, at);
    if (s.kind !== 'answered') throw new Error('expected answered');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe('database_unreachable');
    expect(databaseWord(s)).toBe('unreachable');
    expect(serviceSentence(s)).toBe('The gateway is up but says it is not ready to serve.');
    expect(serviceNextStep(s)).toMatch(/write to support/);
  });
  it('a 200 with an unreadable body is NOT called ready', () => {
    const s = readinessFromResponse(200, '<html>proxy page</html>', 30, at);
    if (s.kind !== 'answered') throw new Error('expected answered');
    expect(s.ready).toBe(false);
    expect(s.commit).toBeNull();
    expect(s.database).toBeNull();
    expect(databaseWord(s)).toBe('not reported');
    expect(serviceSentence(s)).toBe('The gateway answered 200 but did not say it was ready.');
  });
  it('an empty-string commit is an absence, not a build', () => {
    const s = readinessFromResponse(200, { status: 'ready', commit: '   ' }, 10, at);
    if (s.kind !== 'answered') throw new Error('expected answered');
    expect(s.commit).toBeNull();
  });
});

describe('readinessUnreachable', () => {
  it('keeps the client error verbatim and says what to do', () => {
    const s = readinessUnreachable('Network Error', 30000, at);
    expect(s).toEqual({ kind: 'unreachable', error: 'Network Error', latencyMs: 30000, readAt: at });
    expect(serviceSentence(s)).toBe('The gateway did not answer.');
    expect(serviceNextStep(s)).toMatch(/check again/i);
    expect(databaseWord(s)).toBe('not probed');
  });
  it('a blank error is still a stated absence', () => {
    const s = readinessUnreachable('  ', 1, at);
    if (s.kind !== 'unreachable') throw new Error('expected unreachable');
    expect(s.error).toBe('no error message');
  });
});

describe('checking', () => {
  it('is a stated state, not an empty one', () => {
    expect(serviceSentence({ kind: 'checking' })).toMatch(/Asking the gateway/);
  });
});
