import { ScanParserService, MenuReadWaitingException } from "./scan-parser.service";
import { ConfigService } from "@nestjs/config";
import {
  ModelClientService,
  ModelSpendLedgerUnreadableError,
} from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";

/**
 * The founder, 2026-09-21 (ADR 0163 Q22 re-answered, relayed in ADR 0193): the
 * menu-upload billed read FAILS CLOSED when the house's spend ledger cannot be
 * read -- the read waits and says why.
 *
 * The parser runs for real on a real multi-page PDF; the model client is the
 * collaborator, answering the way the real one does when the ledger is
 * unreadable (it throws ModelSpendLedgerUnreadableError before any request).
 */
jest.setTimeout(120_000);

async function pdfWithPages(n: number): Promise<string> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save()).toString("base64");
}

function service(call: jest.Mock) {
  return new ScanParserService(
    { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) } as unknown as ConfigService,
    { call } as unknown as ModelClientService,
    { record: jest.fn() } as unknown as NfVerdictService,
  );
}

const waiting = () =>
  new ModelSpendLedgerUnreadableError(
    "This restaurant's AI spend record could not be read, so the menu read is waiting: nothing was sent to the model and nothing was charged.",
  );

describe("the menu read waits when the spend ledger cannot be read", () => {
  it("a one-request read rejects with the reason (503), not the generic 'temporarily unavailable'", async () => {
    const call = jest.fn().mockRejectedValue(waiting());
    const p = service(call).parse(await pdfWithPages(2), "rest-1");
    await expect(p).rejects.toBeInstanceOf(MenuReadWaitingException);
    await expect(service(jest.fn().mockRejectedValue(waiting())).parse(await pdfWithPages(2), "rest-1")).rejects.toThrow(
      /the menu read is waiting: nothing was sent/,
    );
  });

  it("a split read STOPS at the first waiting chunk -- it is not recorded as a gap in the menu", async () => {
    // 30 pages is pre-split into 10-page chunks: the first chunk answers, the
    // second finds the ledger unreadable. The whole read waits; the third
    // chunk is never sent.
    const call = jest
      .fn()
      .mockResolvedValueOnce({ content: [{ text: '[{"name":"Opus One"}]' }], stop_reason: "end_turn" })
      .mockRejectedValueOnce(waiting())
      .mockResolvedValue({ content: [{ text: "[]" }], stop_reason: "end_turn" });
    await expect(service(call).parse(await pdfWithPages(30), "rest-1")).rejects.toBeInstanceOf(MenuReadWaitingException);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("the parser asks the client to fail CLOSED on every menu request", async () => {
    const call = jest.fn().mockResolvedValue({ content: [{ text: "[]" }], stop_reason: "end_turn" });
    await service(call).parse(await pdfWithPages(1), "rest-1");
    expect(call.mock.calls[0][0]).toMatchObject({ spendLedgerUnreadable: "closed" });
  });

  it("the founder, round 6c: \"never refuse a menu read\" -- the parser asks for no allowance refusal, on every request", async () => {
    // 30 pages: three chunked requests, each must carry it.
    const call = jest.fn().mockResolvedValue({ content: [{ text: "[]" }], stop_reason: "end_turn" });
    await service(call).parse(await pdfWithPages(30), "rest-1");
    expect(call.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [opts] of call.mock.calls) {
      expect(opts).toMatchObject({ allowance: "unlimited", spendLedgerUnreadable: "closed" });
      expect(opts.gateFirstAttempt).not.toBe(true);
    }
  });
});

/**
 * ADR 0340 rule 15, §F12: the heading second opinion runs under the same
 * ledger, and an unreadable ledger fails closed FOR THIS CALL ONLY: the
 * upload goes on with the rules alone. It never rejects, so it never turns
 * a menu read already paid for into a 503.
 */
describe("the heading second opinion degrades to rules only, never a 503 (§F12)", () => {
  const answer = (text: string) =>
    jest
      .fn()
      .mockResolvedValue({ content: [{ text }], stop_reason: "end_turn" });

  it("an unreadable ledger resolves null (rules only) with nothing sent, and does not reject", async () => {
    const call = jest.fn().mockRejectedValue(waiting());
    await expect(
      service(call).classifyHeadings(["Wines", "Starters"], "rest-1"),
    ).resolves.toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("asks for the menu read's ledger terms: closed on an unreadable ledger, unlimited allowance, text only", async () => {
    const call = answer('["drinks","food"]');
    await service(call).classifyHeadings(["Wines", "Starters"], "rest-1");
    const [opts] = call.mock.calls[0];
    expect(opts).toMatchObject({
      spendLedgerUnreadable: "closed",
      allowance: "unlimited",
      nf: { restaurantId: "rest-1" },
    });
    expect(opts.gateFirstAttempt).not.toBe(true);
    const content = opts.body.messages[0].content;
    expect(content.map((c: { type: string }) => c.type)).toEqual(["text"]);
    expect(content[0].text).toContain('["Wines","Starters"]');
  });

  it("any other failure is rules only too, never a throw", async () => {
    for (const call of [
      jest.fn().mockRejectedValue(new Error("socket hang up")),
      answer("not json"),
      answer('{"Wines":"drinks"}'),
      answer('["drinks"]'),
    ]) {
      await expect(
        service(call).classifyHeadings(["Wines", "Starters"], "rest-1"),
      ).resolves.toBeNull();
    }
  });

  it("returns one kind per heading, and no opinion on a word outside the four", async () => {
    const got = await service(
      answer('["drinks","food","dessert??"]'),
    ).classifyHeadings([" Wines ", "Starters", "Tatlılar", "Wines"], "rest-1");
    expect(got).toEqual(
      new Map([
        ["Wines", "drinks"],
        ["Starters", "food"],
      ]),
    );
  });

  it("makes no call for no headings", async () => {
    const call = jest.fn();
    await expect(
      service(call).classifyHeadings(["", "  "], "rest-1"),
    ).resolves.toEqual(new Map());
    expect(call).not.toHaveBeenCalled();
  });
});
