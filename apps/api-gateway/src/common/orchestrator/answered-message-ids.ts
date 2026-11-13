/**
 * The Message-IDs a letter answers, nearest first, bare (no angle brackets):
 * In-Reply-To, then References from the newest. The same rule as the SQL
 * `mail_answered_message_ids` (migration 20270913100000), so the bridge and
 * the thread key read a letter's answers alike.
 *
 * Tokens are the `<...>` ones; a field with none is split on blanks (some
 * senders write a bare id). A token that could not be a stored Message-ID
 * (blank, quotes, commas, parentheses, angle brackets, over 498 characters)
 * is skipped. At most `limit` ids, no repeats.
 */
export function answeredMessageIds(
  inReplyTo: string | null | undefined,
  references: string | null | undefined,
  limit = 20,
): string[] {
  const tokens = (field: string | null | undefined): string[] => {
    const v = typeof field === "string" ? field : "";
    const bracketed = [...v.matchAll(/<([^<>]+)>/g)].map((m) => m[1]);
    const raw = bracketed.length ? bracketed : v.trim().split(/\s+/);
    return raw
      .map((t) => t.trim())
      .filter((t) => t !== "" && t.length <= 498 && !/[\s<>",()]/.test(t));
  };
  const out: string[] = [];
  for (const id of [...tokens(inReplyTo), ...tokens(references).reverse()]) {
    if (!out.includes(id)) out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/** The stored shapes of a bare id: `<id>` (canonical, #1032) and `id`. */
export function storedMessageIdShapes(ids: string[]): string[] {
  return ids.flatMap((id) => [`<${id}>`, id]);
}

/** A stored Message-ID, bare. */
export function bareMessageId(stored: unknown): string {
  return typeof stored === "string"
    ? stored.trim().replace(/^<+|>+$/g, "").trim()
    : "";
}
