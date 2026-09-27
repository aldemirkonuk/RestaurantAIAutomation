/**
 * Whose failure a cancellation was (ADR 0207 round 4). Pure; nothing mocked.
 */

import { deadlineOf } from "./delivery-deadline";
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import {
  CANCEL_REASON_CODES,
  CANCEL_REASON_REFUSAL_WORDS,
  isCancelReasonCode,
  verdictFor,
} from "./cancel-reason";

const d = deadlineOf("2026-09-10", "Europe/Istanbul")!; // 2026-09-10T21:00:00Z
const PAST = Date.parse("2026-09-11T00:00:00Z");
const BEFORE = Date.parse("2026-09-10T10:00:00Z");

describe("isCancelReasonCode", () => {
  it("accepts exactly the three named codes", () => {
    for (const c of CANCEL_REASON_CODES) expect(isCancelReasonCode(c)).toBe(true);
  });
  it.each(["", "NEVER_ARRIVED", "never-arrived", "vendor_was_rude", null, undefined, 1])(
    "refuses %p",
    (v) => {
      expect(isCancelReasonCode(v)).toBe(false);
    },
  );
});

describe("verdictFor — never_arrived", () => {
  it("allows from CONFIRMED once past its deadline", () => {
    expect(
      verdictFor("never_arrived", ProcurementOrderStatus.CONFIRMED, d, PAST),
    ).toEqual({ ok: true });
  });
  it("allows from IN_TRANSIT once past its deadline", () => {
    expect(
      verdictFor("never_arrived", ProcurementOrderStatus.IN_TRANSIT, d, PAST),
    ).toEqual({ ok: true });
  });
  it("refuses before the deadline has passed — a house cannot punish a vendor early", () => {
    expect(
      verdictFor("never_arrived", ProcurementOrderStatus.CONFIRMED, d, BEFORE),
    ).toEqual({ ok: false, reason: "never_arrived_not_past_due" });
  });
  it("refuses with no deadline at all — nothing to prove it is past due", () => {
    expect(
      verdictFor("never_arrived", ProcurementOrderStatus.CONFIRMED, null, PAST),
    ).toEqual({ ok: false, reason: "never_arrived_not_past_due" });
  });
  it.each([
    ProcurementOrderStatus.PENDING,
    ProcurementOrderStatus.APPROVAL_NEEDED,
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.APPROVED,
  ])("refuses from %s — never placed with the vendor, or not yet sent", (from) => {
    expect(verdictFor("never_arrived", from, d, PAST)).toEqual({
      ok: false,
      reason: "never_arrived_wrong_state",
    });
  });
});

describe("verdictFor — vendor_cannot_supply", () => {
  it.each([
    ProcurementOrderStatus.NEGOTIATING,
    ProcurementOrderStatus.APPROVED,
    ProcurementOrderStatus.CONFIRMED,
    ProcurementOrderStatus.IN_TRANSIT,
  ])("allows from %s, no deadline needed", (from) => {
    expect(verdictFor("vendor_cannot_supply", from, null, BEFORE)).toEqual({
      ok: true,
    });
  });
  it("refuses from PENDING — the vendor was never asked", () => {
    expect(
      verdictFor(
        "vendor_cannot_supply",
        ProcurementOrderStatus.PENDING,
        null,
        BEFORE,
      ),
    ).toEqual({ ok: false, reason: "vendor_cannot_supply_wrong_state" });
  });
});

describe("verdictFor — house_decision", () => {
  it("allows from any state, with or without a deadline", () => {
    for (const from of Object.values(ProcurementOrderStatus)) {
      expect(verdictFor("house_decision", from, null, BEFORE)).toEqual({
        ok: true,
      });
      expect(verdictFor("house_decision", from, d, BEFORE)).toEqual({
        ok: true,
      });
    }
  });
});

describe("verdictFor — unknown or missing code", () => {
  it.each(["", "vendor_was_rude", "NEVER_ARRIVED"])("refuses %p", (code) => {
    expect(
      verdictFor(code, ProcurementOrderStatus.CONFIRMED, d, PAST),
    ).toEqual({ ok: false, reason: "unknown_code" });
  });
});

describe("CANCEL_REASON_REFUSAL_WORDS", () => {
  it("has a sentence for every refusal reason verdictFor can return", () => {
    const reasons = [
      "unknown_code",
      "never_arrived_wrong_state",
      "never_arrived_not_past_due",
      "vendor_cannot_supply_wrong_state",
    ] as const;
    for (const r of reasons) {
      expect(typeof CANCEL_REASON_REFUSAL_WORDS[r]).toBe("string");
      expect(CANCEL_REASON_REFUSAL_WORDS[r].length).toBeGreaterThan(10);
    }
  });
});
