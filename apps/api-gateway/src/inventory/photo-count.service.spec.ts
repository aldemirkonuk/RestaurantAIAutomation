import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  NO_COUNT_NOTE,
  PHOTO_READER_OFF,
  PhotoCountService,
  UNREADABLE_PHOTO,
  sniffPhotoMediaType,
} from "./photo-count.service";
import { ModelClientService } from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";

/** Inventory walk #7, lane I2 (G10, G22). The model client is a jest mock. */

/** The first bytes of a file, padded so the base64 is long enough to sniff. */
function b64(...head: number[]): string {
  const bytes = [...head];
  while (bytes.length < 24) bytes.push(0);
  return Buffer.from(bytes).toString("base64");
}

const JPEG = b64(0xff, 0xd8, 0xff, 0xe0);
const PNG = b64(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const GIF = b64(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP = b64(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
// An iPhone photo: `ftypheic`.
const HEIC = b64(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);
// The same container under the `mif1` brand.
const HEIF = b64(0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj").toString("base64");

function service(key: string | null = "test-key", reply = '{"suggestedQty": 6}') {
  const call = jest.fn().mockResolvedValue({ content: [{ text: reply }] });
  const svc = new PhotoCountService(
    { get: () => key ?? undefined } as unknown as ConfigService,
    { call } as unknown as ModelClientService,
    { record: jest.fn() } as unknown as NfVerdictService,
  );
  return { svc, call };
}

const sent = (call: jest.Mock) => call.mock.calls[0][0].body.messages[0].content;

describe("PhotoCountService reads the file it got (G10)", () => {
  it.each([
    ["JPEG", "image/jpeg", JPEG],
    ["PNG", "image/png", PNG],
    ["GIF", "image/gif", GIF],
    ["WEBP", "image/webp", WEBP],
  ])("sends a %s as %s", async (_name, type, data) => {
    const { svc, call } = service();
    await svc.estimate(data, "House lager");
    expect(call).toHaveBeenCalledTimes(1);
    expect(sent(call)[0].source.media_type).toBe(type);
  });

  it.each([
    ["a HEIC", HEIC],
    ["a HEIF", HEIF],
    ["a PDF", PDF],
    ["an unknown file", b64(0x01, 0x02, 0x03, 0x04)],
    ["an empty body", ""],
  ])(
    "refuses %s in plain words and never calls the model",
    async (_name, data) => {
      const { svc, call } = service();
      const attempt = svc.estimate(data, "House lager");
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(UNREADABLE_PHOTO);
      expect(call).not.toHaveBeenCalled();
    },
  );

  it("refuses an unreadable file before the API key is looked at", async () => {
    const { svc } = service(null);
    const no = svc.estimate(HEIC, "Lager");
    await expect(no).rejects.toBeInstanceOf(BadRequestException);
  });

  it("says the item, not wine, to the model", async () => {
    const { svc, call } = service();
    await svc.estimate(PNG, "Pilsner 33cl can");
    const text: string = sent(call)[1].text;
    expect(text).toContain('Item being counted: "Pilsner 33cl can"');
    expect(text.toLowerCase()).not.toContain("wine");
  });
});

describe("sniffPhotoMediaType", () => {
  it("does not take a RIFF that is not WEBP (a WAV, say) for a photo", () => {
    const wav = b64(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45);
    expect(sniffPhotoMediaType(wav)).toBeNull();
  });
});

describe("the note says no confidence word, in the house's language (QA round 10b)", () => {
  const note = (reply: string, lang?: "en" | "tr") =>
    service("k", reply).svc.estimate(PNG, "Lager", "r1", undefined, lang).then((e) => e.note);

  it.each([
    ["a note-less reply with no count", '{"suggestedQty": null}'],
    ["an unreadable reply", "not json"],
  ])("%s says the plain fallback", async (_name, reply) => {
    expect(await note(reply)).toBe(NO_COUNT_NOTE.en);
    expect(await note(reply, "tr")).toBe(NO_COUNT_NOTE.tr);
    expect(Object.values(NO_COUNT_NOTE).join(" ")).not.toMatch(/confiden|emin|güven/i);
  });

  it("a count with no note says nothing more", async () => {
    expect(await note('{"suggestedQty": 2}')).toBe("");
  });

  it("asks the model for a plain note in the house's language", async () => {
    const { svc, call } = service();
    await svc.estimate(PNG, "Lager", "r1", undefined, "tr");
    expect(sent(call)[1].text).toContain("no word about confidence or certainty");
    expect(sent(call)[1].text).toContain("Write the note in Turkish.");
  });
});

describe("a gateway with no photo reader says so in the house's words", () => {
  it("refuses a readable photo without naming the key, and calls no model", async () => {
    const { svc, call } = service(null);
    const err = await svc.estimate(JPEG, "House lager").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toBe(PHOTO_READER_OFF);
    expect((err as Error).message).not.toMatch(/ANTHROPIC|API key|configured/i);
    expect(call).not.toHaveBeenCalled();
  });
});
