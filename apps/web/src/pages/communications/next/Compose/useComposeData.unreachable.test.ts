import { describe, expect, it } from 'vitest';
import { errText } from './useComposeData';

describe('errText: a gateway that cannot be reached', () => {
  it('is a sentence in words, never the transport\'s "Network Error"', () => {
    const e = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    expect(errText(e)).toBe('Mudavym could not be reached just now.');
  });

  it('still relays the gateway\'s own sentence and an ordinary error\'s message', () => {
    expect(errText({ response: { data: { message: 'No such letter' } } })).toBe('No such letter.');
    expect(errText(new Error('Forbidden'))).toBe('Forbidden.');
  });
});
