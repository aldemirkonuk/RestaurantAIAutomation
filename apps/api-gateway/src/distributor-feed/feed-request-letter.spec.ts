/**
 * The letter, and the one property that keeps two copies of it honest.
 *
 * The text ships from `feed-request-letter.ts` and is ALSO printed in
 * `.planning/07-reference/DISTRIBUTOR-INVOICE-FEED-LETTER.md`, because a
 * document a house signs has to be readable by a person who is not running the
 * gateway. Two copies drift. This test is the thing that stops them: it reads
 * the reference file off disk and fails if the served body is not inside it,
 * verbatim.
 *
 * A MISSING FILE FAILS THIS TEST, and that is deliberate. `readFileSync` throws
 * rather than returning "", so a deleted or renamed reference document is a red
 * suite and not a silently passing one — the difference between a failed read
 * and an empty one, on the guard itself.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FEED_REQUEST_LETTER } from "./feed-request-letter";

const REFERENCE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".planning",
  "07-reference",
  "DISTRIBUTOR-INVOICE-FEED-LETTER.md",
);

describe("FEED_REQUEST_LETTER", () => {
  it("asks for an EDI 810 invoice feed, which is what the founder decided", () => {
    expect(FEED_REQUEST_LETTER.body).toContain("An EDI 810 invoice");
    expect(FEED_REQUEST_LETTER.subject).toContain("electronic invoice feed");
  });

  it("names Mudavym as the software and the house as the signatory", () => {
    expect(FEED_REQUEST_LETTER.body).toContain("We authorise Mudavym");
    expect(FEED_REQUEST_LETTER.signedBy).toContain("The house signs this");
    expect(FEED_REQUEST_LETTER.firstAsk).toContain("Southern Glazer's");
  });

  it("says in the letter itself that nothing has been built, which is the sentence that makes it credible", () => {
    // Collapsed, because the body is hard-wrapped for a printed page and the
    // sentence spans two lines. The claim is about the words, not the wrap.
    const flowed = FEED_REQUEST_LETTER.body.replace(/\s+/g, " ");
    expect(flowed).toContain(
      "Nothing has been built and no software of ours has ever accessed your systems.",
    );
  });

  it("leaves the licence, the account and the consultant as brackets a person fills in", () => {
    for (const bracket of FEED_REQUEST_LETTER.brackets) {
      expect(FEED_REQUEST_LETTER.body).toContain(bracket);
    }
  });

  it("is the same text as the reference document, character for character", () => {
    const doc = readFileSync(REFERENCE, "utf8");
    expect(doc).toContain(FEED_REQUEST_LETTER.body.trim());
  });

  it("records that this product never sends it", () => {
    expect(FEED_REQUEST_LETTER.neverSent).toContain("no route that sends");
  });
});
