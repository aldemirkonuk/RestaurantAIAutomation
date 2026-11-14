/**
 * The communications tour is one text for every role (r40, from the r38 note
 * on guidance/content/communications.ts:43). Mail's waiting chip says
 * "Waiting on you" only to someone who can answer a vendor, and "Waiting on
 * the house" to staff (r36 mail gap 14), so the tour step that names the chip
 * must name both, in the chip's own words, and must never say a vendor waits
 * on the reader alone.
 */
import { describe, expect, it } from 'vitest';
import { communicationsTour } from './communications';
import { waitingChipWords, waitingOn } from '../../pages/communications/next/mail-format';

const people = communicationsTour.steps.find((s) => s.element === 'section[aria-label="People"]');

describe('the Mail by person step', () => {
  it('names the chip as every role sees it, in the chip\'s own words', () => {
    expect(people).toBeDefined();
    expect(people!.description).toContain(`"${waitingChipWords(waitingOn(true))}"`);
    expect(people!.description).toContain(`"${waitingChipWords(waitingOn(false))}"`);
  });

  it('says who sees which', () => {
    expect(people!.description).toMatch(/"Waiting on the house", if you cannot answer vendors/);
  });
});
