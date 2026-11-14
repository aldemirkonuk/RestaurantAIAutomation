/**
 * r36 menu audit N3: every failed reader call was "Menu scan service
 * temporarily unavailable", so a phone photo past the model's 5 MB was told to
 * try again later, and failed again. A refusal about the file is now said.
 */
import { ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { ModelClientError } from "../../common/model-client/model-client.service";
import { ScanParserService, fileRefusal } from "./scan-parser.service";

const TOO_BIG = "messages.0.content.0.image.source.base64: image exceeds 5 MB maximum: 7340032 bytes > 5242880 bytes";

describe("fileRefusal: a refusal about the file is said, with what to do", () => {
  it("a photo past the model's size is too large, in the reader's words", () => {
    const why = fileRefusal(new ModelClientError("Anthropic 400", 400, TOO_BIG), false);
    expect(why).toBe(
      `This photo is too large for the menu reader (the reader said: ${TOO_BIG}). Take it again a little further back, or save it as a JPEG under 5 MB, and read it again. Nothing was read.`,
    );
  });

  it("a 413 is too large even with no message, and a PDF is told to divide", () => {
    expect(fileRefusal(new ModelClientError("Anthropic 413", 413, null), true)).toBe(
      "This PDF is too large for the menu reader. Divide the menu into smaller files and read each one. Nothing was read.",
    );
  });

  it("a file the reader cannot open says so, and names the forms it takes", () => {
    expect(fileRefusal(new ModelClientError("Anthropic 400", 400, "Could not process image"), false)).toBe(
      "The menu reader could not open this photo (the reader said: Could not process image). Send it as a JPEG, PNG or PDF. Nothing was read.",
    );
    expect(fileRefusal(new ModelClientError("Anthropic 400", 400, "The PDF specified was not valid."), true)).toMatch(
      /^The menu reader could not open this PDF/,
    );
  });

  it("anything that is not about the file is left to 'temporarily unavailable'", () => {
    expect(fileRefusal(new ModelClientError("Anthropic 400", 400, "max_tokens: field required"), false)).toBeNull();
    expect(fileRefusal(new ModelClientError("Anthropic 400", 400, null), false)).toBeNull();
    expect(fileRefusal(new ModelClientError("Anthropic 401", 401, "invalid x-api-key"), false)).toBeNull();
    expect(fileRefusal(new ModelClientError("Anthropic 429", 429, "image rate limit"), false)).toBeNull();
    expect(fileRefusal(new ModelClientError("Anthropic 529", 529, "Overloaded"), false)).toBeNull();
    expect(fileRefusal(new ModelClientError("timeout", null, null), false)).toBeNull();
    expect(fileRefusal(new Error(TOO_BIG), false)).toBeNull();
  });
});

describe("the reader answers a refused file with a 422, and an outage with a 503", () => {
  function readerFailing(error: unknown) {
    const call = jest.fn().mockRejectedValue(error);
    return new ScanParserService({ get: () => "fixture-key" } as any, { call } as any, { record: jest.fn() } as any) as any;
  }

  it("a photo too large is a 422 that says so", async () => {
    const s = readerFailing(new ModelClientError("Anthropic 400", 400, TOO_BIG));
    const read = s.parseOne("img", "image/jpeg", false, "house");
    await expect(read).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(s.parseOne("img", "image/jpeg", false, "house")).rejects.toThrow(/^This photo is too large for the menu reader/);
  });

  it("an overloaded reader is still temporarily unavailable", async () => {
    const s = readerFailing(new ModelClientError("Anthropic 529", 529, "Overloaded"));
    const read = s.parseOne("img", "image/jpeg", false, "house");
    await expect(read).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(s.parseOne("img", "image/jpeg", false, "house")).rejects.toThrow("Menu scan service temporarily unavailable");
  });
});
