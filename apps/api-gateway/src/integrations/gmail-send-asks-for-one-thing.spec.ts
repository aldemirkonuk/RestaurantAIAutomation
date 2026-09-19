/**
 * The sending grant asks for ONE power, and the page that shows it says so
 * (founder, 2026-09-04: "add the gmail send integration now"; ADR 0118).
 *
 * These are not style assertions. `scopeStringFor` is what actually goes into
 * the Google consent URL (integrations-oauth.service.ts:250), and the
 * `scopes`/`notRequested` arrays are what the person reads before agreeing to
 * it. A scope in the first that is not disclosed in the second is a consent
 * screen that lies, and this file is the thing standing between a widened
 * request and a person who never saw it widen.
 */

import {
  INTEGRATION_DEFINITIONS,
  INTEGRATION_IDS,
  isIntegrationId,
  scopeStringFor,
} from "./integrations-oauth.constants";
import { GMAIL_SEND_SCOPE } from "../communications/letters/house-sender.service";

const SEND = "https://www.googleapis.com/auth/gmail.send";

describe("the gmail_send integration", () => {
  const definition = INTEGRATION_DEFINITIONS.gmail_send;

  it("exists, is Google's, and is a first-class integration id", () => {
    expect(definition).toBeDefined();
    expect(definition.provider).toBe("google");
    expect(INTEGRATION_IDS).toContain("gmail_send");
    expect(isIntegrationId("gmail_send")).toBe(true);
  });

  it("requests the send scope and NOTHING else", () => {
    expect(definition.scopes.map((s) => s.scope)).toEqual([SEND]);
    // The literal string handed to Google. One scope, no separators.
    expect(scopeStringFor(definition)).toBe(SEND);
    expect(scopeStringFor(definition)).not.toContain(" ");
  });

  it("asks for no read scope of any kind", () => {
    for (const s of definition.scopes) {
      expect(s.scope).not.toMatch(
        /gmail\.(readonly|modify|metadata|compose|settings|insert|labels)|mail\.google\.com/,
      );
    }
  });

  it("is the same scope the sender resolver counts a grant by", () => {
    // If these two ever drift, either every consenting house silently loses its
    // sender or a house gains one it never consented to.
    expect(GMAIL_SEND_SCOPE).toBe(definition.scopes[0].scope);
  });

  it("says on the consent screen what it can do and what it cannot", () => {
    const disclosure = `${definition.description} ${definition.scopes
      .map((s) => `${s.label} ${s.reason}`)
      .join(" ")}`.toLowerCase();
    expect(disclosure).toContain("send");
    // The cannot, stated in the same breath as the can.
    expect(disclosure).toMatch(/no ability to open, read, search or list/);

    const never = definition.notRequested.join(" ").toLowerCase();
    expect(never).toContain("reading, searching or listing any message");
    expect(never).toContain("deleting or changing anything");
    // Including the trap that a send-only grant is still not an autonomous one.
    expect(never).toContain("on its own");
  });

  it("does not widen the Drive grant behind anyone's back", () => {
    const drive = INTEGRATION_DEFINITIONS.google_drive;
    expect(drive.scopes.map((s) => s.scope)).not.toContain(SEND);
    // The sentence that was true before today and must stay true after it.
    expect(drive.notRequested).toContain("Your Gmail messages");
  });

  it("is a separate row, not a second scope on an existing one", () => {
    // `UNIQUE (user_id, integration_id)` (20260826170000:144) means a distinct
    // id is a distinct grant: a distinct consent screen and a distinct
    // disconnect, and connecting one never touches the other.
    const ids = Object.values(INTEGRATION_DEFINITIONS).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["google_drive", "gmail_send"]));
  });

  it("discloses every scope it requests — none may be silent", () => {
    for (const d of Object.values(INTEGRATION_DEFINITIONS)) {
      for (const s of d.scopes) {
        expect(s.label.trim().length).toBeGreaterThan(0);
        expect(s.reason.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
