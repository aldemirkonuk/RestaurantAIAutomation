/**
 * "Send or ask" on the phone — the same reading every web panel makes of the
 * gateway's `sendOrAsk` (founder, 2026-09-21: "Staff ask, manager sends").
 *
 * *"An owner, a manager, or a person an owner has granted sends with one hold.
 * When a staff member holds, the letter becomes a REQUEST ... the staffer sees
 * who sent it."* The phone reads `sendOrAsk` beside the draft on
 * `GET /procurement/orders/:id/draft` and says what its hold will do BEFORE the
 * hold. Pure and native-import-free, so it is tested with plain ts-jest.
 */

export interface SendOrAsk {
  readable: boolean;
  maySend: boolean;
  mode: "send" | "ask" | null;
  basis: "owner" | "manager" | "grant" | null;
  grant: {
    id: string;
    grantedBy: { userId: string; name: string | null };
    expiresAt: string | null;
    limitAmount: number | null;
    limitCurrency: string | null;
  } | null;
  sentence: string | null;
}

export interface SendRequest {
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  current: boolean;
  ccEmails: string[];
}

/** What a hold does for this viewer, or null while that cannot be said. */
export function holdAct(standing: SendOrAsk | null | undefined): "send" | "ask" | null {
  if (!standing || !standing.readable) return null;
  return standing.maySend ? "send" : "ask";
}

/** The lines the draft screen shows under the letter, in order. */
export function standingLines(
  standing: SendOrAsk | null | undefined,
  request: SendRequest | null | undefined,
  opts: { loading?: boolean; failed?: boolean } = {},
): string[] {
  const lines: string[] = [];
  const act = holdAct(standing);
  if (opts.loading) {
    lines.push("Reading whether your hold sends this or asks a manager to…");
  } else if (opts.failed) {
    lines.push("Whether your hold sends or asks could not be read. Nothing can be held until it can.");
  } else if (standing && !standing.readable) {
    lines.push(standing.sentence ?? "Whether your hold sends could not be read. Nothing can be held until it can.");
  } else if (standing?.mode === "ask" && standing.sentence) {
    lines.push(standing.sentence);
  } else if (standing?.basis === "grant" && standing.grant) {
    const by = standing.grant.grantedBy.name ?? "an owner (their name could not be read)";
    const until = standing.grant.expiresAt
      ? `until ${standing.grant.expiresAt.slice(0, 10)}`
      : "until an owner revokes it";
    lines.push(`You send under a grant from ${by}, ${until}.`);
  }
  if (request) {
    const who = request.requestedByName ?? "A colleague (their name could not be read)";
    if (!request.current) {
      lines.push(`${who} asked for this to be sent, but the words have changed since, so this is no longer their version.`);
    } else if (act === "send") {
      lines.push(`${who} asked for this to be sent. This is their version, word for word; one hold sends it, and they will see that you did.`);
    } else {
      lines.push(`${who} asked for this to be sent. It is waiting for a manager. Holding again replaces it with your version.`);
    }
  }
  return lines;
}
