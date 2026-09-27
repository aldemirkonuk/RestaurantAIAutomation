/**
 * Every sentence of the "How their mail reads" section, in one place (ADR 0207,
 * question 7: English words; the house's formats are the web's to print).
 *
 * The sentences count MESSAGES and READINGS and nothing else. No figure, no
 * percent, no direction word ("improving", "declining") appears here, and the
 * comparison is two windows' counts set side by side.
 */

type Counts = { read: number; warm: number; plain: number; terse: number };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const MAIL_COPY = {
  standing: {
    answered: (
      days: number,
      messages: number,
      read: number,
      jev: "on" | "off" | "on_unavailable",
    ): string =>
      `${days} d · ${plural(messages, "message", "messages")} · a model read ${read} · no person has checked one · in no figure above${
        jev === "on"
          ? " · read by Jev, with names removed before it left"
          : jev === "on_unavailable"
            ? " · Jev reading is on for this house, but this server cannot reach Jev, so the inbound model's reading is shown"
            : ""
      }`,
    couldNotRead: (days: number): string =>
      `${days} d · the vendor mail did not answer · nothing below is claimed`,
  },
  notAssessed: {
    automated: "not assessed — automated mail",
    noReading: "not assessed — no reading was kept for this one",
    language:
      "not read by Jev — written in a language its private-topic pass does not cover",
    jevFailed: (reason: string | null): string =>
      `not assessed — Jev could not read it${reason ? ` (${reason})` : ""}`,
    unsure: (floor: number): string =>
      `not assessed — the reading was unsure (below ${floor} confidence)`,
  },
  quoteMissing: "the read kept no line for this one",
  note: {
    noMail: (days: number): string =>
      `No mail from this vendor in ${days} d, so there is nothing to read. An empty inbox is not a quiet vendor.`,
    notAssessed:
      "The messages are here and none of them carries a reading. Unread is not plain.",
    tooFew: (read: number, min: number): string =>
      `${plural(read, "reading", "readings")} — too few to say anything about this vendor's mail; each word is one message's. ${min} read in this window and in the one before it are needed before the two are set side by side.`,
    answered:
      "Each word is one message's reading, not a verdict on the vendor. The window before this one has too few readings to set beside it.",
    couldNotRead: (reason: string): string =>
      `The vendor mail could not be read (${reason}). This is missing, not quiet.`,
  },
  /** C's sentence — only when both windows reach the minimum. */
  comparison: (min: number, cur: Counts, pri: Counts): string =>
    `Both windows have ${min} or more read, so they are set side by side: ${cur.terse} of ${cur.read} terse against ${pri.terse} of ${pri.read}, ${cur.warm} of ${cur.read} warm against ${pri.warm} of ${pri.read}, and ${cur.plain} of ${cur.read} plain against ${pri.plain} of ${pri.read}. Each is a count of messages, not a trend.`,
  error: {
    notManager:
      "How a vendor's mail reads is for owners and managers of this house.",
    houseRecord: (reason: string): string =>
      `This house's own record could not be read (${reason}), so its mail was not read either.`,
    noHouseRecord: "This house has no record here.",
    vendorBook: (reason: string): string =>
      `The vendor book could not be read (${reason}).`,
    noSuchVendor: (id: string): string => `No vendor ${id} in this house.`,
  },
} as const;
