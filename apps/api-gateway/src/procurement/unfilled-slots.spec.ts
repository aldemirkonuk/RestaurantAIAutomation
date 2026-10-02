/**
 * ORD-W7 — a letter with a template blank the house never filled cannot leave
 * the building (founder, 2026-10-01: "Approve + gateway"), reworked the same
 * day: the send fills the greeting and the signature itself, so only a blank
 * the send cannot fill is refused ("Only unfillable"), and the automatic send
 * sweep and a hand-written reply check too ("Add sweep + manual").
 *
 * The only house draft in production on 2026-10-01 still read
 * "Dear [Provider First Name]" and was signed "[Your Name]", and nothing on the
 * card or the gateway stopped it being sealed and sent. The card now refuses
 * the hold (DraftRail.tsx); these assert the gateway refuses at every door a
 * house letter leaves by: the seal mint, the staff request, the send, the
 * sweep and the hand-written reply.
 */
import { BadRequestException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { unfilledSlotsRefusal, unfilledTemplateSlots } from "./unfilled-slots";

const REST = "rest-1";
const ORDER = "order-1";
const VENDOR = "orders@vendor.example";
const BLANKED = "Dear [Provider First Name],\n\nSix cases, please.\n\n[Your Name]";

describe("unfilledTemplateSlots", () => {
  it("finds each distinct capitalised bracketed blank, once", () => {
    expect(unfilledTemplateSlots(`${BLANKED}\n[Your Name]`)).toEqual([
      "[Provider First Name]",
      "[Your Name]",
    ]);
  });

  it("leaves lower-case and numeric brackets alone", () => {
    expect(unfilledTemplateSlots("As agreed [sic], see note [1].")).toEqual([]);
  });

  it("reads nothing from nothing", () => {
    expect(unfilledTemplateSlots(null)).toEqual([]);
    expect(unfilledTemplateSlots("")).toEqual([]);
  });

  it("names the blanks and what did not happen", () => {
    expect(unfilledSlotsRefusal(["[Your Name]"], "Nothing was sent.")).toBe(
      "This letter still has a blank the house did not fill: [Your Name]. Nothing was sent.",
    );
  });
});

/** A one-row `procurement_conversations` read: every filter returns the chain. */
function dbReturning(row: Record<string, unknown>) {
  const chain: any = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.single = async () => ({ data: row, error: null });
  chain.maybeSingle = async () => ({ data: row, error: null });
  const client = { from: () => chain };
  return { supabase: client, getClient: () => client } as any;
}

/** The house signs as "Meyhouse" unless a test says it has no sender name. */
function serviceWith(row: Record<string, unknown>, sender = "Meyhouse") {
  const seal = { issue: jest.fn().mockResolvedValue({ challenge: "t", expiresAt: "x", action: "a" }), redeem: jest.fn() };
  const service = new ProcurementService(dbReturning(row), {} as any, {} as any);
  (service as any).sealChallenges = seal;
  (service as any).vendorSendAuthority = {
    standing: jest.fn().mockResolvedValue({ mode: "ask", role: "staff" }),
  };
  jest.spyOn(service as any, "requireSendAuthority").mockResolvedValue({ basis: "role" });
  jest.spyOn(service as any, "newerReplyStillAnalyzing").mockResolvedValue(false);
  jest.spyOn(service as any, "resolveSenderName").mockResolvedValue(sender);
  return { service, seal };
}

/** Greeting and signature the send fills; "[Delivery Date]" it cannot. */
const UNFILLABLE = "Dear [Provider First Name],\n\nSix cases by [Delivery Date], please.\n\n[Your Name]";

const pendingRow = {
  id: "conv-1",
  content: BLANKED,
  created_at: "2026-10-01T10:00:00Z",
  email_headers: {},
  providers: { name: "Vendor", contact_first_name: "Hasan", contact_email: VENDOR, restaurant_id: REST },
  procurement_orders: { inventory: { wine_name: "Barolo" } },
};

describe("what the send fills, and what it cannot", () => {
  const blanksAtSend = (body: string, fill: { firstName?: string; senderName?: string }) =>
    (ProcurementService.prototype as any).blanksAtSend.call(
      {
        buildEmailHtml: (ProcurementService.prototype as any).buildEmailHtml,
        personalizeGreeting: (ProcurementService.prototype as any).personalizeGreeting,
      },
      body,
      fill,
    );

  it("fills the greeting with the vendor's first name and the signature with the sender name", () => {
    expect(blanksAtSend(BLANKED, { firstName: "Hasan", senderName: "Meyhouse" })).toEqual({
      unfillable: [],
      fills: [
        { slot: "[Provider First Name]", value: "Hasan" },
        { slot: "[Your Name]", value: "Meyhouse" },
      ],
    });
  });

  it("refuses a blank no send fills", () => {
    expect(blanksAtSend(UNFILLABLE, { firstName: "Hasan", senderName: "Meyhouse" }).unfillable).toEqual([
      "[Delivery Date]",
    ]);
  });

  it("refuses the greeting blank when the vendor's first name is not known", () => {
    expect(blanksAtSend(BLANKED, { senderName: "Meyhouse" }).unfillable).toEqual(["[Provider First Name]"]);
  });

  it("refuses a signature blank when the house has no sender name — it would go out empty", () => {
    expect(blanksAtSend(BLANKED, { firstName: "Hasan", senderName: "  " }).unfillable).toEqual(["[Your Name]"]);
  });

  it("reads a blank with an apostrophe through the HTML escaping", () => {
    expect(blanksAtSend("Hi Hasan,\n\nSee [Vendor's Terms].", { firstName: "Hasan", senderName: "M" }).unfillable).toEqual([
      "[Vendor's Terms]",
    ]);
  });
});

describe("the gateway refuses a letter with a blank the send cannot fill", () => {
  it("issues no seal over it", async () => {
    const { service, seal } = serviceWith(pendingRow);
    await expect(
      service.issueDraftSendSeal(REST, ORDER, "u1", { body: UNFILLABLE, to: VENDOR }),
    ).rejects.toThrow(/did not fill: \[Delivery Date\]\. No seal was issued/);
    expect(seal.issue).not.toHaveBeenCalled();
  });

  it("issues the seal over a letter whose only blanks the send fills", async () => {
    const { service, seal } = serviceWith(pendingRow);
    await service.issueDraftSendSeal(REST, ORDER, "u1", { body: BLANKED, to: VENDOR });
    expect(seal.issue).toHaveBeenCalled();
  });

  it("records no staff request for it", async () => {
    const { service } = serviceWith(pendingRow);
    await expect(
      service.requestDraftSend(REST, ORDER, "u1", { content: UNFILLABLE }),
    ).rejects.toThrow(/did not fill: \[Delivery Date\]\. Nothing was asked\./);
  });

  it("does not send it, and leaves the seal unspent", async () => {
    const { service, seal } = serviceWith({ ...pendingRow, content: UNFILLABLE });
    await expect(
      service.approveDraft(REST, ORDER, {} as any, { userId: "u1", challenge: "c", grantId: null }),
    ).rejects.toThrow(/did not fill: \[Delivery Date\]\. Nothing was sent\./);
    expect(seal.redeem).not.toHaveBeenCalled();
  });

  it("checks the edited words, not only the stored ones", async () => {
    const { service, seal } = serviceWith({ ...pendingRow, content: "Dear Hasan, six cases. Ayşe" });
    await expect(
      service.approveDraft(REST, ORDER, { modifiedContent: "Six cases by [Delivery Date]." } as any, {
        userId: "u1",
        challenge: "c",
        grantId: null,
      }),
    ).rejects.toThrow(/\[Delivery Date\]/);
    expect(seal.redeem).not.toHaveBeenCalled();
  });

  it("refuses a hand-written reply with any blank — its send fills none", async () => {
    const { service, seal } = serviceWith(pendingRow);
    await expect(
      service.issueManualReplySeal(REST, ORDER, "u1", { content: "Thanks.\n\n[Your Name]" }),
    ).rejects.toThrow(/did not fill: \[Your Name\]\. No seal was issued/);
    await expect(
      service.manualReply(REST, ORDER, "u1", "Thanks.\n\n[Your Name]", undefined, "c"),
    ).rejects.toThrow(/did not fill: \[Your Name\]\. Nothing was sent\./);
    expect(seal.issue).not.toHaveBeenCalled();
    expect(seal.redeem).not.toHaveBeenCalled();
  });

  it("tells the card what the send fills on the draft it reads", async () => {
    const { service } = serviceWith(pendingRow);
    jest.spyOn(service as any, "sendRequestViews").mockResolvedValue([null]);
    const draft = await service.getPendingDraft(REST, ORDER);
    // The first name is read for the check, not handed to the page.
    expect(draft?.providers).toEqual({ name: "Vendor", contact_email: VENDOR, restaurant_id: REST });
    expect(draft?.at_send).toEqual({
      unfillable: [],
      fills: [
        { slot: "[Provider First Name]", value: "Hasan" },
        { slot: "[Your Name]", value: "Meyhouse" },
      ],
    });
  });
});
