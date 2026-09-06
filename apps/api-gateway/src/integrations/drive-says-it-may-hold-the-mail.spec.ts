/**
 * The Drive grant's consent screen says the house's vendor mail may be written
 * to that Drive (ADR 0118 D16; the founder's answer to question 2, 2026-09-05:
 * "Amend the copy; the sealed choice is the consent" — no re-authorisation loop).
 *
 * WHY THIS IS A SPEC AND NOT A REVIEW NOTE. The gap it closes was real and
 * silent: `drive.file` already PERMITTED writing the mail, so nothing failed,
 * nothing warned, and the only thing standing between a person and a surprise
 * was a sentence in a constants file that described a narrower act than the one
 * the code performs. A consent screen that is narrower than the code is the
 * exact shape ADR 0118 was opened to end, and prose has no other guard.
 *
 * Four things, each of which would be a silent falsehood if it broke:
 *
 *   1. THE DISCLOSURE NAMES MAIL. Not "exports" in the abstract — a person
 *      reading this must learn that correspondence goes into their Drive.
 *   2. IT SAYS THE ARCHIVE IS OFF UNTIL THE HOUSE TURNS IT ON, so nobody reads
 *      the sentence as "this is already happening".
 *   3. IT KEEPS SAYING THE SCOPE IS ONE-WAY. `drive.file` cannot see a document
 *      this app did not create, and widening the copy must not blur that.
 *   4. NO SCOPE WAS WIDENED TO PAY FOR ANY OF IT. The grant still asks for
 *      exactly `drive.file`, `openid` and `email` — if a future pass adds a
 *      scope here, this fails and the founder's "no re-authorisation loop"
 *      answer stops being true.
 */

import { INTEGRATION_DEFINITIONS } from "./integrations-oauth.constants";

const drive = INTEGRATION_DEFINITIONS.google_drive;

describe("the Drive grant discloses the mail archive", () => {
  it("names MAIL, not just exports, in what it writes out", () => {
    const lands = drive.dataHandling.landsIn;
    expect(lands).toMatch(/vendor mail/i);
    expect(lands).toMatch(/message body, its headers and any attachment/i);
    expect(lands).toMatch(/Mudavym mail archive/);
    // The description a person sees first must not still say only "exports".
    expect(drive.description).toMatch(/vendor mail/i);
  });

  it("says the archive is OFF until the restaurant turns it on", () => {
    const lands = drive.dataHandling.landsIn;
    expect(lands).toMatch(/off unless a manager or owner turns it on/i);
    // And that the house can find out whose Drive it goes to.
    expect(lands).toMatch(/names whose Drive it goes to/i);
  });

  it("still says the grant cannot see anything this app did not write", () => {
    expect(drive.dataHandling.doesNotRead).toMatch(
      /cannot see a document this app did not create/i,
    );
    expect(drive.dataHandling.landsIn).toMatch(
      /Nothing from Drive is copied into Mudavym/i,
    );
    expect(drive.notRequested).toContain(
      "Reading files you did not create with WineOps",
    );
  });

  it("says the exported copies outlive the grant, which is the point of them", () => {
    const kept = drive.dataHandling.keptFor;
    expect(kept).toMatch(/outlive the grant/i);
    expect(kept).toMatch(/can never read, change or delete them/i);
  });

  it("asks for NO new scope to do it — the founder's 'no re-authorisation loop'", () => {
    expect(drive.scopes.map((s) => s.scope).sort()).toEqual([
      "email",
      "https://www.googleapis.com/auth/drive.file",
      "openid",
    ]);
    // The one scope that does the writing must say what it now writes.
    const file = drive.scopes.find(
      (s) => s.scope === "https://www.googleapis.com/auth/drive.file",
    );
    expect(file).toBeDefined();
    expect(file!.reason).toMatch(/vendor mail/i);
    expect(file!.reason).toMatch(/if this restaurant turns it on/i);
  });
});
