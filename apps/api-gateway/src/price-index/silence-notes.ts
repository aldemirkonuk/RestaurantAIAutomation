/**
 * What this register knows about a jurisdiction, in words, when it holds no row
 * for it.
 *
 * THE FAULT THIS FIXES
 * --------------------
 * `PriceIndexService.silenceFor` had one sentence for every state with no
 * source: *"No posted list or public index is known for US-IL. A house here has
 * no index line until one is found."* For a state nobody has researched, that
 * is true. For Illinois it is false in the way that matters: **there is nothing
 * to find.** Illinois has no wholesale price-posting regime — the Liquor
 * Control Act's price-filing section was repealed with effect from 1 January
 * 1998 and neither the Act nor the Commission's rules replaced it. "Until one
 * is found" reports a settled legal fact as a pending search, which is the same
 * shape of error as reporting an absence as health: it invites a house to wait
 * for something that is never coming.
 *
 * So a jurisdiction is either **settled** — researched to a conclusion, with the
 * evidence named — or **unresearched**, and the box says which. Both are
 * honest; they are different sentences, and the difference is the whole point.
 *
 * A note here is never a price and never a substitute for one. It explains a
 * silence; it does not fill it.
 */

export interface SilenceNote {
  /** ISO-3166-2 key, as `normalizeJurisdiction` produces it. */
  jurisdiction: string;
  /**
   * True when the question has been researched to a conclusion. False, or
   * absent from this map, means nobody has looked and the box must say so.
   */
  settled: boolean;
  /** The sentence the panel prints. It names the cause, not just the absence. */
  sentence: string;
  /** The primary sources it rests on, for the ADR and for a reviewer. */
  evidence: string[];
  /** The day that evidence was fetched. */
  measuredOn: string;
}

export const SILENCE_NOTES: Record<string, SilenceNote> = {
  "US-IL": {
    jurisdiction: "US-IL",
    settled: true,
    sentence:
      "Illinois publishes no wholesale price list, and that is settled rather than pending: the Liquor Control Act's price-filing section (235 ILCS 5/6-19) was repealed with effect from 1 January 1998 and nothing replaced it, and the Commission's own rules (11 Ill. Adm. Code 100) contain no price schedule of any kind. Every Illinois distributor prices per account, which is a connection this house declares rather than an index anyone can read. Your own invoices are the only price register available here.",
    evidence: [
      "https://www.ilga.gov/documents/legislation/ilcs/documents/023500050K6-19.htm — 'Sec. 6-19. (Repealed). (Source: P.A. 82-783. Repealed by P.A. 90-432, eff. 1-1-98.)'",
      "https://ilga.gov/agencies/JCAR/EntirePart?titlepart=01100100 — 11 Ill. Adm. Code 100 read in full (216,637 bytes, 53 distinct section headings): not one section imposes a price schedule, and all 16 occurrences of 'price' are trade-practice rules.",
      "https://ilcc.illinois.gov/divisions/legal/ilcc-statutes-and-rules.html — the Commission's own Statutes and Rules page links only to the Act and two administrative codes. It publishes no price file and no price lookup.",
      "https://law.onecle.com/illinois/235ilcs5/indexVI.html — Article VI's only 'schedule of the prices' is 235 ILCS 5/6-28, a retailer's own drink list at its own premises, not a wholesale posting.",
    ],
    measuredOn: "2026-09-05",
  },
  "US-MI": {
    jurisdiction: "US-MI",
    settled: true,
    sentence:
      "Michigan does publish the price your licence pays — the Liquor Control Commission's spirits price book carries a licensee price for every item, with the bottle size and the case pack beside it — but it is published as an Excel and PDF download on a host that refuses every automated reader, so nothing here can fetch it. A manager can download this quarter's book from the Commission and upload it, and these lines will fill. Michigan's beer and wine schedules are filed with the Commission rather than published, so they cannot be read at all.",
    evidence: [
      "https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info — HTTP 403, server: AkamaiGHost, on the page, on a direct PDF and on robots.txt itself (2026-09-05). CNAME chain: www.michigan.gov -> edgekey.michigan.gov -> e4514.ksd.akamaiedge.net (Akamai Kona Site Defender).",
      "https://data.michigan.gov/robots.txt — HTTP 200, and 'User-agent: *' carries 'Disallow: /'. The state's own open-data portal forbids reading it.",
      "https://www.legislature.mi.gov/robots.txt — HTTP 403 from its own WAF; documents on that host answer 403 too.",
      "Mich. Admin. Code R. 436.1625 (beer) and R. 436.1726 (wine): a manufacturer or wholesaler 'shall file with the commission in Lansing' a schedule of net cash prices. Filed, not published.",
    ],
    measuredOn: "2026-09-05",
  },
};

export function silenceNote(
  jurisdiction: string | null | undefined,
): SilenceNote | null {
  if (!jurisdiction) return null;
  return SILENCE_NOTES[jurisdiction] ?? null;
}

/**
 * The sentence for a jurisdiction this register holds no source for.
 *
 * A settled jurisdiction gets its researched sentence. An unresearched one gets
 * a sentence saying it is unresearched — not "until one is found", which
 * quietly promises a search nobody has scheduled.
 */
export function noSourceSentence(jurisdiction: string): string {
  const note = silenceNote(jurisdiction);
  if (note?.settled) return note.sentence;
  return `No price source has been researched for ${jurisdiction}. This register is silent because nobody has looked, not because it is known that nothing is published.`;
}
