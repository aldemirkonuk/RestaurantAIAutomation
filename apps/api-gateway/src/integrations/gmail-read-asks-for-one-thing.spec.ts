/**
 * The receiving grant asks for ONE power, and the page that shows it says so
 * (founder, 2026-09-04: the send grant stays send-only "on condition the house
 * can also receive on its own mailbox and have the whole comms there", and the
 * shape is "a second grant, read-only, house-declared and person-consented";
 * ADR 0118, receive half).
 *
 * The sibling of `gmail-send-asks-for-one-thing.spec.ts`, and it exists for the
 * same reason: `scopeStringFor` is what actually goes into the Google consent
 * URL (integrations-oauth.service.ts:250), and the `scopes` / `notRequested` /
 * `dataHandling` blocks are what the person reads before agreeing to it.
 *
 * ONE THING THIS FILE ASSERTS THAT ITS SIBLING CANNOT.
 * A send scope's disclosure is complete when it says "send and nothing else",
 * because the scope is genuinely as narrow as the act. A READ scope's is not:
 * `gmail.readonly` permits reading the whole mailbox, and the thing that keeps
 * this grant to the vendors in the book is CODE, not the scope. So the consent
 * screen has to say what the code does, and this file checks that it says it —
 * a disclosure that stops at the scope would be technically true and would
 * leave a person believing they had agreed to less than they had.
 */

import {
  INTEGRATION_DEFINITIONS,
  INTEGRATION_IDS,
  isIntegrationId,
  scopeStringFor,
} from "./integrations-oauth.constants";
import { GMAIL_READ_SCOPE } from "../communications/inbox/house-inbox.service";

const READ = "https://www.googleapis.com/auth/gmail.readonly";
const SEND = "https://www.googleapis.com/auth/gmail.send";

describe("the gmail_read integration", () => {
  const definition = INTEGRATION_DEFINITIONS.gmail_read;

  it("exists, is Google's, and is a first-class integration id", () => {
    expect(definition).toBeDefined();
    expect(definition.provider).toBe("google");
    expect(INTEGRATION_IDS).toContain("gmail_read");
    expect(isIntegrationId("gmail_read")).toBe(true);
  });

  it("requests the readonly scope and NOTHING else", () => {
    expect(definition.scopes.map((s) => s.scope)).toEqual([READ]);
    // The literal string handed to Google. One scope, no separators.
    expect(scopeStringFor(definition)).toBe(READ);
    expect(scopeStringFor(definition)).not.toContain(" ");
  });

  it("asks for no scope that could send, label, archive or delete", () => {
    for (const s of definition.scopes) {
      expect(s.scope).not.toMatch(
        /gmail\.(send|modify|compose|insert|labels|settings)|mail\.google\.com/,
      );
    }
  });

  it("is the same scope the reader counts a grant by", () => {
    // If these two ever drift, either every consenting house silently stops
    // being read or one is read on a grant it never gave.
    expect(GMAIL_READ_SCOPE).toBe(definition.scopes[0].scope);
  });

  it("does not widen the sending grant, and is not widened by it", () => {
    const send = INTEGRATION_DEFINITIONS.gmail_send;
    expect(send.scopes.map((s) => s.scope)).toEqual([SEND]);
    expect(send.scopes.map((s) => s.scope)).not.toContain(READ);
    expect(definition.scopes.map((s) => s.scope)).not.toContain(SEND);
    // Two grants, each asking for one thing (the founder's words).
    expect(send.id).not.toBe(definition.id);
  });

  it("does not widen the Drive grant behind anyone's back", () => {
    const drive = INTEGRATION_DEFINITIONS.google_drive;
    expect(drive.scopes.map((s) => s.scope)).not.toContain(READ);
    // The sentence that was true before today and must stay true after it.
    expect(drive.notRequested).toContain("Your Gmail messages");
  });

  it("is a separate row, not a second scope on an existing one", () => {
    const ids = Object.values(INTEGRATION_DEFINITIONS).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["google_drive", "gmail_send", "gmail_read"]),
    );
  });

  it("says on the consent screen that the code is narrower than the scope", () => {
    const disclosure = `${definition.description} ${definition.scopes
      .map((s) => `${s.label} ${s.reason}`)
      .join(" ")}`.toLowerCase();
    // The scope permits the whole mailbox; the honest disclosure says the app
    // asks for less, and says what decides "less".
    expect(disclosure).toContain("from: filter");
    expect(disclosure).toContain("book");
    expect(disclosure).toMatch(/never send|can never send/);
  });

  it("names, under what it does not ask for, everyone else's mail and the past", () => {
    const never = definition.notRequested.join(" ").toLowerCase();
    expect(never).toContain("not a vendor in this house's book");
    // The retro-read is the surprise a scope list cannot warn about.
    expect(never).toContain("before this house switched the reader on");
    expect(never).toContain("sending mail as you");
    expect(never).toMatch(/no labelling|no archiving|no deleting/);
  });

  it("answers all four data-handling questions for the read grant", () => {
    const h = definition.dataHandling;
    expect(h.reads.toLowerCase()).toContain("book");
    expect(h.doesNotRead.toLowerCase()).toContain("discarded");
    expect(h.landsIn).toContain("procurement_conversations");
    expect(h.visibleTo.toLowerCase()).toContain(
      "everyone who works in this restaurant",
    );
    expect(h.visibleTo.toLowerCase()).toContain("nobody outside this restaurant");
  });

  it("makes every integration answer those four questions, not just this one", () => {
    // Required rather than optional on purpose. An optional field is present on
    // the grant whose author thought about it and absent on the rest, and a
    // reader cannot tell "this stores nothing" from "nobody wrote it down".
    for (const d of Object.values(INTEGRATION_DEFINITIONS)) {
      for (const [key, value] of Object.entries(d.dataHandling)) {
        expect(
          `${d.id}.${key}:${value.trim().length > 0}`,
        ).toBe(`${d.id}.${key}:true`);
        // Not a placeholder. A one-word answer to "where does it land" is the
        // same absence wearing a value.
        expect(value.trim().length).toBeGreaterThan(40);
      }
    }
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
