import { getErrorStatus, isUnconfirmedWrite } from "../services/api/client";

/**
 * What /get-started and /register say when opening a house does not land
 * (F-006, scope item 6). The sentence is chosen from the answer's status
 * alone, never from the gateway's own text, which can carry a constraint or
 * index name, or hint at another house.
 */

/** Shown on the menu step when the house opened but `/auth/me` did not load. */
export const HOUSE_OPEN_DETAILS_LATER =
  "The house is open. Your account details did not load just now; they will catch up the next time the page loads.";

const TOO_MANY_TRIES =
  "Too many tries in a short time. Wait a minute, then try again.";

const WORDS: Record<
  "arrival" | "register",
  {
    refused: string;
    unconfirmed?: string;
    alreadyOpen?: string;
    fallback: string;
  }
> = {
  // /get-started is signed in, and its 409 is about the person's own account,
  // never a place: a press after one whose answer was lost meets it. Where
  // that press then takes them (scope item 4) is F-006 OPEN-2, unanswered.
  arrival: {
    refused:
      "We could not open the house with these details. Check the name, the address and the phone number. If you picked the address from the list, try typing it in yourself.",
    unconfirmed:
      "We could not confirm the house opened. Try again in a moment: if it did open, we will tell you, and no second house is opened.",
    alreadyOpen:
      "This account already has a house, so no second one was opened.",
    fallback: "We could not create the house.",
  },
  register: {
    refused:
      "We could not register the house with these details. If this email already has an account, sign in instead; otherwise check the details and try again.",
    unconfirmed:
      "We could not confirm the registration went through. If a verification email arrives, it did: sign in instead of registering again. If none arrives within a few minutes, register again.",
    fallback: "Registration failed",
  },
};

export function houseNotOpened(
  cause: unknown,
  where: "arrival" | "register",
): string {
  const words = WORDS[where];
  // A 5xx, or a request sent that got no answer: the house may exist.
  if (words.unconfirmed && isUnconfirmedWrite(cause)) return words.unconfirmed;
  const status = getErrorStatus(cause);
  if (status === 400) return words.refused;
  if (status === 409 && words.alreadyOpen) return words.alreadyOpen;
  if (status === 429) return TOO_MANY_TRIES;
  return words.fallback;
}
