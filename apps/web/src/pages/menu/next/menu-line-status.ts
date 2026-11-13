import type { MenuLine } from '../../../services/api/menus';

/**
 * A menu line's status, in the house's words.
 *
 * Onboarding walk 2026-11-12 (r12 finding 10): the owner chose a line's
 * section on the first proof, and /menu then printed that line's status raw,
 * "flagged", with nothing anywhere to say what it meant. 'flagged' is written
 * by the gateway for three things only -- a manager corrected a field, a
 * manager added the line by hand while checking the menu, or a typed line went
 * past the free plan's limit -- and it gates nothing. The chip now says which.
 * A line a person set by hand is sealed like a line as read: a person checked it.
 */
export interface LineStatusWords {
  words: string;
  sealed: boolean;
  /** One sentence for the chip's title and, where the words alone do not carry it, a note. */
  why: string | null;
  /** Show `why` under the chip, not only on hover. */
  noteShown: boolean;
}

const FIELD_WORDS: Record<string, string> = {
  name: 'its name',
  producer: 'its producer',
  category: 'its section',
  vintage: 'its vintage',
  region: 'its region',
  grape_variety: 'its grape',
  by_glass_price: 'its glass price',
  bottle_price: 'its bottle price',
};

export function lineStatusWords(line: Pick<MenuLine, 'status' | 'source' | 'flag_reason' | 'flag_field'>): LineStatusWords {
  if (line.status === 'approved') {
    const words = line.source === 'manual' ? 'as typed' : line.source === 'csv' ? 'as imported' : 'as read';
    return { words, sealed: true, why: null, noteShown: false };
  }
  if (line.status === 'in_review') {
    return { words: 'waiting for a second look', sealed: false, why: 'The menu reader was not sure of this line.', noteShown: false };
  }
  if (line.status === 'flagged') {
    switch (line.flag_reason) {
      case 'corrected': {
        const what = (line.flag_field && FIELD_WORDS[line.flag_field]) || 'a detail';
        return {
          words: `set by hand: ${what}`,
          sealed: true,
          why: `A manager set ${what} after the menu was read. Nothing more is needed.`,
          noteShown: false,
        };
      }
      case 'added_by_hand':
        return { words: 'added by hand', sealed: true, why: 'A manager added this line while checking the menu.', noteShown: false };
      case 'past_free_limit':
        return {
          words: "past the free plan's typed lines",
          sealed: false,
          why: "Typed after the free plan's first 25 lines.",
          noteShown: true,
        };
      default:
        return { words: 'marked for a second look', sealed: false, why: null, noteShown: false };
    }
  }
  return { words: String(line.status).replace(/_/g, ' '), sealed: false, why: null, noteShown: false };
}
