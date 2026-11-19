import { describe, expect, it } from 'vitest';
import { AxiosError } from 'axios';
import { failureWords, isUnreachable, UNREACHABLE_WORDS } from './unreachable';
import { getErrorMessage } from '../services/api/client';

const dropped = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

describe('an unreachable gateway, in words', () => {
  it('names a request that never got an answer, never the transport\'s "Network Error"', () => {
    expect(isUnreachable(dropped())).toBe(true);
    expect(failureWords(dropped(), 'no reason given')).toBe('Mudavym could not be reached just now.');
    expect(UNREACHABLE_WORDS).not.toMatch(/Network Error/);
  });

  it('is not claimed for an answered call, however axios worded it', () => {
    const answered = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', response: { status: 502 } });
    expect(isUnreachable(answered)).toBe(false);
    expect(failureWords(answered, 'x')).toBe('Network Error');
  });

  it('keeps an ordinary error\'s message and a non-error\'s fallback', () => {
    expect(failureWords(new Error('Forbidden'), 'x')).toBe('Forbidden');
    expect(failureWords('nope', 'no reason given')).toBe('no reason given');
    expect(isUnreachable(null)).toBe(false);
    expect(isUnreachable(undefined)).toBe(false);
  });

  it('getErrorMessage (the shared reason for ~170 callers) says it in words for a real axios network failure', () => {
    const e = new AxiosError('Network Error', 'ERR_NETWORK');
    expect(getErrorMessage(e)).toBe('Mudavym could not be reached just now.');
    expect(getErrorMessage(dropped())).toBe('Mudavym could not be reached just now.');
  });

  it('getErrorMessage still prefers the gateway\'s own sentence', () => {
    const e = new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 500, statusText: '', headers: {}, config: {} as never, data: { message: 'The menu is locked.' },
    });
    expect(getErrorMessage(e)).toBe('The menu is locked.');
  });
});
