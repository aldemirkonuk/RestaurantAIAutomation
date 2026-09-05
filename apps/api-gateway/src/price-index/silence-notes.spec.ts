/**
 * The per-jurisdiction silence sentences.
 *
 * The point of these tests is the DIFFERENCE between two silences: a state
 * researched to a conclusion, and a state nobody has looked at. Collapsing them
 * into one sentence is what the old wording did, and it is what made Illinois
 * read as a pending search rather than a settled fact.
 */

import { SILENCE_NOTES, noSourceSentence, silenceNote } from "./silence-notes";

describe("silence notes", () => {
  it("carries a settled note for Illinois with its primary evidence", () => {
    const note = silenceNote("US-IL");
    expect(note?.settled).toBe(true);
    expect(note?.measuredOn).toBe("2026-09-05");
    // Every claim in the sentence is backed by a URL in the same record.
    expect(note?.evidence.length).toBeGreaterThanOrEqual(4);
    expect(note?.evidence.join(" ")).toContain("023500050K6-19.htm");
    expect(note?.evidence.join(" ")).toContain("titlepart=01100100");
  });

  it("names the CAUSE for Illinois, not just the absence", () => {
    const s = noSourceSentence("US-IL");
    expect(s).toMatch(/235 ILCS 5\/6-19/);
    expect(s).toMatch(/repealed/i);
    expect(s).toMatch(/11 Ill\. Adm\. Code 100/);
    expect(s).toMatch(/your own invoices/i);
  });

  it("does NOT tell an Illinois house to wait for a source to be found", () => {
    // The sentence this replaced: "A house here has no index line until one is
    // found." Illinois' price-filing section was repealed in 1998; nothing is
    // coming, and saying otherwise reports a settled fact as pending.
    expect(noSourceSentence("US-IL")).not.toMatch(/until one is found/i);
  });

  it("says plainly that an unresearched jurisdiction is unresearched", () => {
    const s = noSourceSentence("US-ND");
    expect(silenceNote("US-ND")).toBeNull();
    expect(s).toMatch(/has been researched/i);
    expect(s).toMatch(/nobody has looked/i);
    expect(s).toContain("US-ND");
  });

  it("keeps a Michigan note that names the block AND the way round it", () => {
    const note = silenceNote("US-MI");
    expect(note?.settled).toBe(true);
    expect(note?.sentence).toMatch(/licensee price/i);
    expect(note?.sentence).toMatch(/upload/i);
    // The beer and wine half: filed with the Commission, never published — and
    // since 2026-09-05 (ADR 0126) the sentence carries the fact that changes
    // what a request is worth. It used to end "so they cannot be read at all",
    // which was true of a fetcher and wrong about a FOIA request; it now names
    // MCL 436.1609a's one-year embargo, so a house is told both that the record
    // is reachable and that it can never be fresh.
    expect(note?.sentence).toMatch(/file them with the Commission rather than publish them/i);
    expect(note?.sentence).toMatch(/436\.1609a/);
    expect(note?.sentence).toMatch(/one year after it was filed/i);
    expect(note?.sentence).toMatch(/never reach one less than twelve months old/i);
    // And the upload half must no longer promise that "these lines will fill"
    // without saying with WHAT: the book that can be uploaded holds spirits.
    expect(note?.sentence).toMatch(/with spirits, which is what that book holds/i);
    expect(note?.evidence.join(" ")).toMatch(/R\. 436\.1625/);
    expect(note?.evidence.join(" ")).toMatch(/R\. 436\.1726/);
    expect(note?.evidence.join(" ")).toMatch(/MCL 436\.1609a/);
    expect(note?.evidence.join(" ")).toMatch(/Disallow: \//);
  });

  it("keeps an Illinois note that points at the invoices, not at a locked door", () => {
    const note = silenceNote("US-IL");
    expect(note?.settled).toBe(true);
    expect(note?.sentence).toMatch(/6-19/);
    expect(note?.sentence).toMatch(/1 January 1998/);
    // Amended 2026-09-05 (ADR 0126). The sentence used to say the per-account
    // price was "a connection this house declares", which pointed at a door
    // nobody had tried. Measured: there is no feed to declare, and two of the
    // three distributors forbid the reading in their own words.
    expect(note?.sentence).not.toMatch(/a connection this house declares/i);
    expect(note?.sentence).toMatch(/forbids every automated reader/i);
    expect(note?.sentence).toMatch(/they are the licensee price list/i);
    expect(note?.evidence.join(" ")).toMatch(/now\.breakthrubev\.com\/robots\.txt/);
    expect(note?.evidence.join(" ")).toMatch(/southernglazers\.com\/terms-of-use/);
  });

  it("every note states the day its evidence was measured", () => {
    for (const note of Object.values(SILENCE_NOTES)) {
      expect(note.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.evidence.length).toBeGreaterThan(0);
      expect(note.jurisdiction).toMatch(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);
    }
  });
});
