import { draftSubjectLine } from "./procurement.service";

// Lane-E repair (2026-09-19): an independent verifier found approveDraft's
// send-time subject and getActiveConversations' preview subject were two
// separate inline expressions, described by a comment as "identical" while
// actually differing (getActiveConversations had no `storedSubject`
// fallback, and defaulted `wineName` at a different point in the chain).
// Both call sites were switched to this one function; these assertions are
// the guard that the claim in its doc comment is now true, not just written.

it("prefers the vendor's own header subject over anything computed", () => {
  expect(
    draftSubjectLine({ subject: "Re: your quote" }, "Order Request: X", "X"),
  ).toBe("Re: your quote");
});

it("falls back to a stored subject when there is no header subject", () => {
  expect(draftSubjectLine({}, "A previously chosen subject", "Chateau X")).toBe(
    "A previously chosen subject",
  );
});

it("composes 'Order Request: <wine>' when neither a header nor a stored subject exists", () => {
  expect(draftSubjectLine({}, null, "Chateau Margaux 2018")).toBe(
    "Order Request: Chateau Margaux 2018",
  );
});

it("falls back to 'Wine Order' when the wine name itself is unknown", () => {
  expect(draftSubjectLine({}, undefined, null)).toBe(
    "Order Request: Wine Order",
  );
  expect(draftSubjectLine({}, undefined, undefined)).toBe(
    "Order Request: Wine Order",
  );
});

it("ignores an empty-object email_headers the way both call sites pass it", () => {
  // approveDraft passes `((conv as any).email_headers ?? {})`; getActiveConversations
  // passes `(row.email_headers ?? {})` — both collapse a missing column to `{}`.
  expect(draftSubjectLine({}, undefined, "Chateau X")).toBe(
    "Order Request: Chateau X",
  );
});

it("produces the same subject for approveDraft's call shape and getActiveConversations' call shape given the same row", () => {
  // approveDraft: wineName is pre-defaulted to "Wine Order" before the call;
  // getActiveConversations: wineName is left null and the function defaults it.
  // Both must land on the same final string for a conversation with no
  // header subject, no stored subject and no joined wine name — the exact
  // shape that was silently divergent before this repair.
  const emailHeaders = {};
  const approveDraftShape = draftSubjectLine(
    emailHeaders,
    undefined,
    "Wine Order",
  );
  const getActiveConversationsShape = draftSubjectLine(
    emailHeaders,
    undefined,
    null,
  );
  expect(approveDraftShape).toBe(getActiveConversationsShape);
  expect(approveDraftShape).toBe("Order Request: Wine Order");
});
