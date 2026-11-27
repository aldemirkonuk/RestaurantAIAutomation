import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MENU_READER_OFF, ScanParserService } from "./scan-parser.service";
import { ModelClientService } from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";

/**
 * A gateway with no menu reader key refuses the read in the house's words.
 * The sentence is stored as the read's failure and shown on /menu, so the
 * operator's fix ("set ANTHROPIC_API_KEY") stays in the log (menu walk
 * 2026-11-11, M1).
 */
describe("a gateway with no menu reader", () => {
  it("refuses with a sentence the house can act on, and sends nothing to a model", async () => {
    const call = jest.fn();
    const parser = new ScanParserService(
      { get: () => undefined } as unknown as ConfigService,
      { call } as unknown as ModelClientService,
      { record: jest.fn() } as unknown as NfVerdictService,
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const err = await parser.parse(png).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toBe(MENU_READER_OFF);
    expect((err as Error).message).not.toMatch(/ANTHROPIC|API key/i);
    expect(call).not.toHaveBeenCalled();
  });
});
