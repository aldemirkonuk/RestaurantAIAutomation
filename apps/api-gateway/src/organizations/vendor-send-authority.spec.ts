/**
 * Who may send to a vendor with one hold — the rule, clause by clause.
 *
 * ADR 0112 F12 (founder, 2026-09-05): *"one man approval if the authority is
 * valid — owner/manager or authorized personnel (owner can give access),
 * otherwise double approval is needed."* ADR 0175 D10 applies it to every
 * vendor send, and the 2026-09-21 answer makes the "otherwise" a REQUEST.
 *
 * Every clause of `decideVendorSend` has a case here that fails when that
 * clause is removed (the mutations are recorded in the ADR 0175 amendment and
 * the lane's build report). The decision is pure, so nothing here is mocked.
 */

import {
  VENDOR_SEND_SCOPE,
  askSentence,
  decideVendorSend,
  sendRefusal,
  type AuthorityGrantRow,
} from "./vendor-send-authority";

const OWNER = "owner-1";
const NOW = new Date("2026-09-21T12:00:00.000Z");

function grant(over: Partial<AuthorityGrantRow> = {}): AuthorityGrantRow {
  return {
    id: "g-1",
    grantor_user_id: OWNER,
    grantee_user_id: "staff-1",
    scope: VENDOR_SEND_SCOPE,
    limit_amount: null,
    limit_currency: null,
    expires_at: null,
    created_at: "2026-09-20T09:00:00.000Z",
    revoked_at: null,
    ...over,
  };
}

const owners = new Set([OWNER]);
const decide = (input: Partial<Parameters<typeof decideVendorSend>[0]>) =>
  decideVendorSend({ role: "staff", grants: [], ownerIds: owners, now: NOW, ...input });

describe("an owner or a manager sends with one hold", () => {
  it("an owner sends, and needs no grant", () => {
    expect(decide({ role: "owner" })).toEqual({ mode: "send", basis: "owner", grant: null });
  });
  it("a manager sends, and needs no grant", () => {
    expect(decide({ role: "manager" })).toEqual({ mode: "send", basis: "manager", grant: null });
  });
  it("reads the role case-blind, as the rest of the gateway stores it", () => {
    expect(decide({ role: " Manager " }).mode).toBe("send");
  });
  it("the legacy `admin` string is NOT an owner or a manager here (same rank table as the order gate)", () => {
    expect(decide({ role: "admin" })).toMatchObject({ mode: "ask", reason: "not_owner_or_manager" });
  });
});

describe("anybody else asks — unless an owner named them", () => {
  it("staff with no grant ask", () => {
    expect(decide({})).toEqual({ mode: "ask", basis: null, grant: null, reason: "not_owner_or_manager" });
  });
  it("a person with no role at all asks, and the reason says so", () => {
    expect(decide({ role: null })).toMatchObject({ mode: "ask", reason: "no_role" });
  });
  it("a live grant does not outlive the grantee's membership: no role here, no send", () => {
    // Issue refuses a non-member (authority-grants.service.ts). A grantee who
    // later leaves the house keeps an unrevoked row, and a token naming the
    // house stays signed until it expires — the gate must refuse them too.
    expect(decide({ role: null, grants: [grant()] })).toMatchObject({ mode: "ask", reason: "no_role" });
    expect(decide({ role: "  ", grants: [grant()] })).toMatchObject({ mode: "ask", reason: "no_role" });
  });
  it("staff holding a live grant from a current owner send, and the grant is named", () => {
    const out = decide({ grants: [grant()] });
    expect(out).toEqual({
      mode: "send",
      basis: "grant",
      grant: { id: "g-1", grantorUserId: OWNER, expiresAt: null, limitAmount: null, limitCurrency: null },
    });
  });
  it("a revoked grant does not count", () => {
    expect(decide({ grants: [grant({ revoked_at: "2026-09-21T08:00:00.000Z" })] })).toMatchObject({
      mode: "ask",
      reason: "grant_revoked",
    });
  });
  it("an expired grant does not count — checked at the act, not at issue", () => {
    expect(decide({ grants: [grant({ expires_at: "2026-09-21T11:59:59.000Z" })] })).toMatchObject({
      mode: "ask",
      reason: "grant_expired",
    });
  });
  it("a grant expiring exactly now has expired", () => {
    expect(decide({ grants: [grant({ expires_at: NOW.toISOString() })] }).mode).toBe("ask");
  });
  it("a grant not yet expired counts", () => {
    expect(decide({ grants: [grant({ expires_at: "2026-09-22T00:00:00.000Z" })] }).mode).toBe("send");
  });
  it("a grant whose grantor is no longer an owner does not count", () => {
    expect(decide({ grants: [grant()], ownerIds: new Set() })).toMatchObject({
      mode: "ask",
      reason: "grant_orphaned",
    });
  });
  it("a grant whose grantor was deleted does not count", () => {
    expect(decide({ grants: [grant({ grantor_user_id: null })] })).toMatchObject({
      mode: "ask",
      reason: "grant_orphaned",
    });
  });
  it("a grant for another scope is not a vendor-send grant", () => {
    expect(decide({ grants: [grant({ scope: "something_else" })] })).toMatchObject({
      mode: "ask",
      reason: "not_owner_or_manager",
    });
  });
  it("names the newest grant's failure, the one the person will recognise", () => {
    const older = grant({ id: "old", created_at: "2026-09-01T00:00:00.000Z", revoked_at: "2026-09-02T00:00:00.000Z" });
    const newer = grant({ id: "new", created_at: "2026-09-10T00:00:00.000Z", expires_at: "2026-09-15T00:00:00.000Z" });
    expect(decide({ grants: [older, newer] })).toMatchObject({ reason: "grant_expired" });
  });
  it("one live grant among dead ones is enough", () => {
    const dead = grant({ id: "dead", revoked_at: "2026-09-02T00:00:00.000Z", created_at: "2026-09-21T00:00:00.000Z" });
    const live = grant({ id: "live", created_at: "2026-09-01T00:00:00.000Z" });
    expect(decide({ grants: [dead, live] })).toMatchObject({ mode: "send", grant: { id: "live" } });
  });
});

describe("an act that carries money needs a limit that covers it", () => {
  const amount = { value: 1200, currency: "TRY" };
  it("a grant with no money limit covers letters, not money", () => {
    expect(decide({ grants: [grant()], amount })).toMatchObject({ mode: "ask", reason: "grant_has_no_limit" });
    expect(decide({ grants: [grant()] }).mode).toBe("send");
  });
  it("a limit in the same currency that covers the amount sends", () => {
    const out = decide({ grants: [grant({ limit_amount: "1500.00", limit_currency: "TRY" })], amount });
    expect(out).toMatchObject({ mode: "send", grant: { limitAmount: 1500, limitCurrency: "TRY" } });
  });
  it("the amount exactly at the limit is covered", () => {
    expect(decide({ grants: [grant({ limit_amount: 1200, limit_currency: "TRY" })], amount }).mode).toBe("send");
  });
  it("over the limit asks", () => {
    expect(decide({ grants: [grant({ limit_amount: 1000, limit_currency: "TRY" })], amount })).toMatchObject({
      mode: "ask",
      reason: "grant_over_limit",
    });
  });
  it("a limit in another currency does not cover the amount", () => {
    expect(decide({ grants: [grant({ limit_amount: 5000, limit_currency: "EUR" })], amount })).toMatchObject({
      mode: "ask",
      reason: "grant_other_currency",
    });
  });
  it("an amount that could not be read is not covered by any limit", () => {
    expect(
      decide({ grants: [grant({ limit_amount: 5000, limit_currency: "TRY" })], amount: { value: null, currency: "TRY" } }),
    ).toMatchObject({ mode: "ask", reason: "amount_unknown" });
    expect(
      decide({ grants: [grant({ limit_amount: 5000, limit_currency: "TRY" })], amount: { value: 10, currency: null } }),
    ).toMatchObject({ mode: "ask", reason: "amount_unknown" });
  });
  it("owners and managers are not limited by any grant arithmetic", () => {
    expect(decide({ role: "manager", amount: { value: null, currency: null } }).mode).toBe("send");
  });
});

describe("the sentences say what happens to the work before why", () => {
  it("the readout for a staff member says the hold asks and the version is kept", () => {
    const s = askSentence("not_owner_or_manager", "send it");
    expect(s).toMatch(/^Your hold will ask a manager to send it; your version is kept exactly as you wrote it\./);
    expect(s).toMatch(/Only an owner, a manager, or someone an owner has named/);
  });
  it("a refused send says nothing was sent and points at the request, when there is one", () => {
    const s = sendRefusal("grant_expired", "send this letter", { canAsk: true });
    expect(s).toMatch(/^Nothing was sent\./);
    expect(s).toMatch(/has expired/);
    expect(s).toMatch(/Hold again to ask a manager instead/);
  });
  it("a refused act with no request path says who can do it instead", () => {
    const s = sendRefusal("not_owner_or_manager", "confirm this deal", { canAsk: false });
    expect(s).toMatch(/Ask an owner or a manager to do it\./);
    expect(s).not.toMatch(/Hold again/);
  });
});
