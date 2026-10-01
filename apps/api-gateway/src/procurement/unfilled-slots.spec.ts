/**
 * ORD-W7 — a letter with a template blank the house never filled cannot leave
 * the building (founder, 2026-10-01: "Approve + gateway").
 *
 * The only house draft in production on 2026-10-01 still read
 * "Dear [Provider First Name]" and was signed "[Your Name]", and nothing on the
 * card or the gateway stopped it being sealed and sent. The card now refuses
 * the hold (DraftRail.tsx); these assert the gateway refuses at every door the
 * card's two holds reach: the seal mint, the staff request, and the send.
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

function serviceWith(row: Record<string, unknown>) {
  const seal = { issue: jest.fn(), redeem: jest.fn() };
  const service = new ProcurementService(dbReturning(row), {} as any, {} as any);
  (service as any).sealChallenges = seal;
  jest.spyOn(service as any, "requireSendAuthority").mockResolvedValue({ basis: "role" });
  jest.spyOn(service as any, "newerReplyStillAnalyzing").mockResolvedValue(false);
  return { service, seal };
}

const pendingRow = {
  id: "conv-1",
  content: BLANKED,
  created_at: "2026-10-01T10:00:00Z",
  email_headers: {},
  providers: { name: "Vendor", contact_email: VENDOR, restaurant_id: REST },
  procurement_orders: { inventory: { wine_name: "Barolo" } },
};

describe("the gateway refuses a letter with an unfilled blank", () => {
  it("issues no seal over it", async () => {
    const { service, seal } = serviceWith(pendingRow);
    await expect(
      service.issueDraftSendSeal(REST, ORDER, "u1", { body: BLANKED, to: VENDOR }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.issueDraftSendSeal(REST, ORDER, "u1", { body: BLANKED, to: VENDOR }),
    ).rejects.toThrow(/\[Provider First Name\], \[Your Name\]\. No seal was issued/);
    expect(seal.issue).not.toHaveBeenCalled();
  });

  it("records no staff request for it", async () => {
    // Refused before the authority service is even consulted, so this is the
    // 400 for the blank — not the 500 for a missing authority service.
    const service = new ProcurementService(dbReturning(pendingRow), {} as any, {} as any);
    await expect(
      service.requestDraftSend(REST, ORDER, "u1", { content: BLANKED }),
    ).rejects.toThrow(/did not fill: \[Provider First Name\], \[Your Name\]\. Nothing was asked\./);
  });

  it("does not send it, and leaves the seal unspent", async () => {
    const { service, seal } = serviceWith(pendingRow);
    await expect(
      service.approveDraft(REST, ORDER, {} as any, { userId: "u1", challenge: "c", grantId: null }),
    ).rejects.toThrow(/did not fill: .*Nothing was sent\./);
    expect(seal.redeem).not.toHaveBeenCalled();
  });

  it("checks the edited words, not only the stored ones", async () => {
    const { service, seal } = serviceWith({ ...pendingRow, content: "Dear Hasan, six cases. Ayşe" });
    await expect(
      service.approveDraft(REST, ORDER, { modifiedContent: "Dear [Provider First Name]" } as any, {
        userId: "u1",
        challenge: "c",
        grantId: null,
      }),
    ).rejects.toThrow(/\[Provider First Name\]/);
    expect(seal.redeem).not.toHaveBeenCalled();
  });
});
