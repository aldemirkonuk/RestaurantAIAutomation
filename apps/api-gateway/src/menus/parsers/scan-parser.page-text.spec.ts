import { ScanParserService } from "./scan-parser.service";
import { ConfigService } from "@nestjs/config";
import { ModelClientService } from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";

/**
 * r110 menu-r110-2 (DD-r108-66): a web page's visible text is read as ONE
 * plain-text document block, never sent as base64 and never as an image,
 * with the same prompt as a photo or PDF. A cut-off reply keeps what it read
 * and says so.
 */
function service(call: jest.Mock, key: string | null = "test-key") {
  return new ScanParserService(
    { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? key ?? undefined : undefined) } as unknown as ConfigService,
    { call } as unknown as ModelClientService,
    { record: jest.fn() } as unknown as NfVerdictService,
  );
}
const reply = (stop = "end_turn") => ({ content: [{ text: '[{"name":"Opus One","bottle_price":62}]' }], stop_reason: stop });

describe("ScanParser.parseTextWithWarnings -- a page's text", () => {
  it("sends the text as a plain-text document block, with the extraction prompt", async () => {
    const call = jest.fn().mockResolvedValue(reply());
    const r = await service(call).parseTextWithWarnings("Reds\nOpus One 2019 62", "rest-1");
    expect(r.items).toHaveLength(1);
    expect(r.warnings).toEqual([]);
    const req = call.mock.calls[0][0];
    const [block, prompt] = req.body.messages[0].content;
    expect(block).toEqual({ type: "document", source: { type: "text", media_type: "text/plain", data: "Reds\nOpus One 2019 62" } });
    expect(prompt.type).toBe("text");
    expect(req.nf.stimulus).toBe("menu_page_text");
  });

  it("a cut-off reply keeps what it read and says truncated", async () => {
    const call = jest.fn().mockResolvedValue(reply("max_tokens"));
    const r = await service(call).parseTextWithWarnings("Opus One 62");
    expect(r.warnings).toEqual([{ kind: "truncated", pages: null }]);
  });

  it("with the reader off, nothing is sent", async () => {
    const call = jest.fn();
    await expect(service(call, null).parseTextWithWarnings("Opus One 62")).rejects.toMatchObject({ status: 503 });
    expect(call).not.toHaveBeenCalled();
  });
});
