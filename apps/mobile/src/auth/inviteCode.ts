/**
 * Invite codes, as the server actually mints them.
 *
 * `AuthService#generateInvite` builds an 8-character code from
 * `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 24 letters and 8 digits, with `I`, `O`,
 * `0` and `1` removed so nothing in a code can be misread off a phone screen
 * or a scrap of paper. `JoinViaInviteDto` then pins the length with
 * `@Length(8, 8)`.
 *
 * Both facts are mirrored here and both are locked to the server source by
 * `__tests__/authContract.test.ts`, so a change to the charset or the length
 * fails the mobile build instead of producing a screen that rejects codes the
 * server would have accepted.
 *
 * The reason this matters on a phone specifically: the invite arrives by mail
 * or by chat, and on mobile it is *typed*, not clicked. The web page can lean
 * on the URL. Here the keyboard is the only entry path, so the normalisation
 * below is the feature.
 */

/** Mirrors `CHARSET` in `apps/api-gateway/src/auth/auth.service.ts`. */
export const INVITE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Mirrors `@Length(8, 8)` on `JoinViaInviteDto.code`. */
export const INVITE_CODE_LENGTH = 8;

const CHARSET_SET: ReadonlySet<string> = new Set(INVITE_CHARSET.split(""));

/**
 * Characters the mint deliberately avoids, mapped to what the user almost
 * certainly meant. `0` and `1` are not in the charset, so a typed `0` can only
 * have been an `O`... except `O` is not in the charset either. Both members of
 * each confusable pair are excluded, which means neither can ever be right —
 * so we do not guess, we say which character is the problem.
 */
export const EXCLUDED_CONFUSABLES = ["I", "O", "0", "1"] as const;

/**
 * Turn what someone typed into what the server will compare against.
 *
 * Uppercases, and drops spaces and the separators people add when reading a
 * code aloud (`ABCD-1234`, `ABCD 1234`). Everything else is preserved so
 * `inviteCodeError` can name it.
 */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[\s\-_.]/g, "").toUpperCase();
}

/**
 * `null` when the normalised code could be sent, otherwise the sentence to put
 * under the field.
 *
 * Deliberately *not* enumeration-shy: this validates shape only, and shape is
 * public knowledge. Whether a well-formed code exists is the server's answer.
 */
export function inviteCodeError(raw: string): string | null {
  const code = normalizeInviteCode(raw);

  if (code.length === 0) return "Enter the 8-character code from your invite.";

  const bad = [...code].filter((c) => !CHARSET_SET.has(c));
  if (bad.length > 0) {
    const confusable = bad.find((c) =>
      (EXCLUDED_CONFUSABLES as readonly string[]).includes(c),
    );
    if (confusable) {
      return `Invite codes never contain ${EXCLUDED_CONFUSABLES.join(", ")} — check the ${confusable}.`;
    }
    return `"${bad[0]}" isn't part of an invite code.`;
  }

  if (code.length !== INVITE_CODE_LENGTH) {
    return `Invite codes are ${INVITE_CODE_LENGTH} characters — that one is ${code.length}.`;
  }

  return null;
}

/** True when the code is worth spending a network call on. */
export function isCompleteInviteCode(raw: string): boolean {
  return inviteCodeError(raw) === null;
}

/**
 * The reason strings `GET /auth/invite/:code` returns when `valid` is false,
 * turned into copy. The gateway answers `not_found`, `used`, `expired` or
 * `issuer` — the sender was demoted or removed and can no longer give an
 * invite for that role (`auth.service.ts#getInvitePreview`).
 */
export function describeInviteRejection(reason: string | undefined): string {
  switch (reason) {
    case "used":
      return "This invite has already been used. Ask for a fresh one.";
    case "expired":
      return "This invite has expired. Ask for a fresh one.";
    case "not_found":
      return "We don't recognise that code. Check it and try again.";
    case "issuer":
      return "The person who sent this invite can no longer invite someone in this role. Ask the restaurant owner for a new one.";
    default:
      return "This invite can't be used. Ask for a fresh one.";
  }
}

/**
 * Joining lands in the house the invite names (ADR 0164, R1; F-1455). The
 * accept route mints nothing, so the session stays where it was until the
 * phone switches it, as the web does after the same accept. True when the
 * session is in that house (or the reply named none); false when the switch
 * was refused, and the person then chooses the house themselves.
 */
export async function openInvitedHouse(
  restaurantId: string | null | undefined,
  deps: {
    currentHouse: string | null | undefined;
    chooseHouse: (houseId: string) => Promise<boolean>;
  },
): Promise<boolean> {
  if (!restaurantId || restaurantId === deps.currentHouse) return true;
  return deps.chooseHouse(restaurantId).catch(() => false);
}

/** Said when the invited house could not be opened after the accept. */
export const INVITED_HOUSE_NOT_OPENED =
  "You joined, but that restaurant couldn't be opened just now. Choose it from your restaurants.";
