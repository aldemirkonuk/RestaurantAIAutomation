/**
 * `gmail_read_all` is its own grant, with its own words (founder delegation
 * 2026-11-19, forks a and b).
 *
 *   1. It is a THIRD id: a different consent text, a different row, a different
 *      disconnect from `gmail_read`, asking Google for the same scope.
 *   2. Its words say what it reads, in plain terms, and say who sees team and
 *      guest mail.
 *   3. The vendor-only words an existing grant was accepted under are unchanged.
 *   4. It mirrors mail, so disconnecting it deletes what it filed.
 *   5. The generic routes (`:integrationId/authorize`, `/disclosure`,
 *      `/seal-challenge`, DELETE `:integrationId`) accept it: that is the
 *      accept and revoke endpoint.
 */

import {
  INTEGRATION_DEFINITIONS,
  INTEGRATION_IDS,
  MIRRORING_INTEGRATION_IDS,
  isIntegrationId,
} from "./integrations-oauth.constants";

describe("gmail_read_all", () => {
  const all = INTEGRATION_DEFINITIONS.gmail_read_all;
  const narrow = INTEGRATION_DEFINITIONS.gmail_read;

  it("is a distinct id the generic routes accept", () => {
    expect(isIntegrationId("gmail_read_all")).toBe(true);
    expect(INTEGRATION_IDS).toContain("gmail_read_all");
    expect(all.id).not.toBe(narrow.id);
  });

  it("asks Google for the same read scope but makes a different promise", () => {
    expect(all.scopes.map((s) => s.scope)).toEqual(narrow.scopes.map((s) => s.scope));
    expect(all.scopes[0].label).toBe(
      "Reads every conversation in this mailbox: vendors, team and guests",
    );
    expect(all.scopes[0].label).not.toBe(narrow.scopes[0].label);
    expect(all.dataHandling.visibleTo).toMatch(/owner and managers only/i);
    expect(all.dataHandling.keptFor).toMatch(/deleted whole/i);
  });

  it("leaves the vendor-only words an existing grant was accepted under untouched", () => {
    expect(narrow.scopes[0].label).toBe(
      "Read mail in your mailbox — used only for the vendors in this house's book",
    );
    expect(narrow.label).toBe("Gmail — reading vendor replies only");
  });

  it("mirrors mail, so disconnecting it deletes what it filed", () => {
    expect(MIRRORING_INTEGRATION_IDS).toContain("gmail_read_all");
  });

  it("fills all four data-handling questions", () => {
    for (const k of ["reads", "doesNotRead", "landsIn", "visibleTo", "keptFor"] as const) {
      expect(all.dataHandling[k].trim().length).toBeGreaterThan(40);
    }
  });
});
