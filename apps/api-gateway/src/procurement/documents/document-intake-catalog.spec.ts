/**
 * The document door and an EDI 832 price catalogue (ADR 0126, batch 56).
 *
 * WHAT THIS FILE MEASURES, AND WHY THE FIRST TEST IS ABOUT THE OLD BEHAVIOUR
 * -------------------------------------------------------------------------
 * Before this pass a catalogue reaching `POST /procurement/documents` was
 * stored as an UNREADABLE document, and the first test MEASURES exactly how
 * rather than repeating what the comments predicted. `looksLikeX12` says true
 * (there is an ISA), but the envelope reader never opens the `ST` — it warns
 * "SE encountered with no open ST" — so the file yields zero transactions and
 * zero SKIPS, not the "unsupported set" `parseX12`'s `default` branch would
 * have reported. `route()` then answered "EDI file produced no readable
 * transaction sets": docType `unknown`, confidence 0, and `currency: "USD"`
 * stamped on a document whose currency nobody had read. Run against the
 * UNCHANGED `parseX12`, so it is the old path itself and not a description of
 * it. The rest of the file pins what the door does now.
 *
 * Nothing here writes a price. Storing a catalogue prices nothing: the lines
 * are admitted separately, under the code meanings a manager of the house has
 * stated, where each refusal can be named.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DocumentIntakeService } from "./document-intake.service";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { looksLikeX12, parseInterchange, parseX12 } from "./x12";
import { DocumentsController } from "./documents.controller";
import { createHash } from "node:crypto";

const CATALOGUE = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "distributor-feed",
    "__fixtures__",
    "edi832-constructed-from-spec.edi",
  ),
  "utf8",
);

describe("what the door did with an 832 BEFORE this pass", () => {
  /**
   * Measured, not remembered. `parseX12` is UNCHANGED by this pass, so running
   * it on the same fixture is the old behaviour exactly.
   *
   * It is worse than "an unsupported set", which is what the code comments
   * would lead you to expect: the envelope reader never opens the `ST` at all
   * (`SE encountered with no open ST`), so the file yields zero transactions
   * AND zero skips. `route()` then returned `unreadable("EDI file produced no
   * readable transaction sets")` — docType `unknown`, confidence 0, and
   * `currency: "USD"` stamped on a document whose currency nobody had read.
   */
  it("yielded zero transactions and zero skips — not even an 'unsupported set'", () => {
    expect(looksLikeX12(CATALOGUE)).toBe(true);
    const envelope = parseInterchange(CATALOGUE);
    expect(envelope.transactions).toHaveLength(0);
    expect(envelope.warnings).toContain("SE encountered with no open ST.");
    const result = parseX12(CATALOGUE);
    expect(result.documents).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("DocumentIntakeService — an 832 price catalogue", () => {
  let service: DocumentIntakeService;
  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const mockStorageUpload = jest.fn();

  const chain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn().mockReturnValue({
        upload: mockStorageUpload,
        download: jest.fn(),
      }),
    },
  };

  const mockExtractor = {
    available: jest.fn().mockReturnValue(false),
    extract: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    for (const fn of [
      chain.from,
      chain.select,
      chain.insert,
      chain.eq,
      chain.order,
      chain.limit,
    ])
      fn.mockReturnThis();
    chain.storage.from.mockReturnValue({
      upload: mockStorageUpload,
      download: jest.fn(),
    });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockSingle.mockResolvedValue({ data: { id: "doc-1" }, error: null });
    mockStorageUpload.mockResolvedValue({ data: { path: "ok" }, error: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIntakeService,
        { provide: DatabaseService, useValue: { getClient: () => chain } },
        { provide: DocumentExtractorService, useValue: mockExtractor },
        CanonicalDocumentService,
      ],
    }).compile();
    service = module.get(DocumentIntakeService);
  });

  it("classifies it as a price_list and names its sender, number and date", async () => {
    const out = await service.ingest({
      restaurantId: "r-1",
      source: "upload",
      buffer: Buffer.from(CATALOGUE, "utf8"),
      filename: "q3-catalogue.832",
    });
    expect(out.parsed?.docType).toBe("price_list");
    expect(out.parsed?.docNumber).toBe("Q3-2026");
    expect(out.parsed?.vendorName).toBe("A DISTRIBUTOR THAT DOES NOT EXIST");
    expect(out.parsed?.docDate).toBe("2026-07-01");
    expect(out.parsed?.currency).toBe("USD");
  });

  it("carries NO lines, and says in words that storing it priced nothing", async () => {
    const out = await service.ingest({
      restaurantId: "r-1",
      source: "upload",
      buffer: Buffer.from(CATALOGUE, "utf8"),
      filename: "q3-catalogue.832",
    });
    expect(out.parsed?.lines).toEqual([]);
    expect(out.parsed?.total).toBeNull();
    expect(out.parsed?.warnings.join(" ")).toContain(
      "NOTHING on it has been priced",
    );
    expect(out.parsed?.warnings.join(" ")).toContain("8 catalogue lines");
    // It is not an invoice and must never be counted as one billing nothing.
    expect(out.parsed?.docType).not.toBe("invoice");
    expect(out.parsed?.docType).not.toBe("unknown");
  });

  it("never stamps USD on a catalogue that states no currency", async () => {
    const noCur = CATALOGUE.split("\n")
      .filter((l) => !l.startsWith("CUR*"))
      .join("\n");
    const out = await service.ingest({
      restaurantId: "r-1",
      source: "upload",
      buffer: Buffer.from(noCur, "utf8"),
      filename: "q3-catalogue.832",
    });
    expect(out.parsed?.currency).toBe("");
    expect(out.parsed?.warnings.join(" ")).toContain("no CUR currency segment");
  });

  it("routes a catalogue named without a recognised EDI extension", async () => {
    // `.832` is now one of the extensions the router accepts, and the sniff
    // itself decides in any case. A house's rep does not name files carefully.
    const out = await service.ingest({
      restaurantId: "r-1",
      source: "upload",
      buffer: Buffer.from(CATALOGUE, "utf8"),
      filename: "Q3 price file.edi",
      mimeType: "application/octet-stream",
    });
    expect(out.parsed?.docType).toBe("price_list");
  });

  it("still reads an 810 as an invoice — the catalogue branch takes nothing from it", async () => {
    const invoice =
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260905*1218*U*00401*000000001*0*P*>~" +
      "GS*IN*SENDER*RECEIVER*20260905*1218*1*X*004010~" +
      "ST*810*0001~BIG*20260905*INV-77~" +
      "IT1*1*12*CA*14.75**VP*ITEM-1~" +
      "TDS*17700~CTT*1~SE*7*0001~GE*1*1~IEA*1*000000001~";
    const out = await service.ingest({
      restaurantId: "r-1",
      source: "upload",
      buffer: Buffer.from(invoice, "utf8"),
      filename: "invoice.edi",
    });
    expect(out.parsed?.docType).toBe("invoice");
    expect(out.parsed?.docNumber).toBe("INV-77");
  });
});

/**
 * The door itself: `POST /procurement/documents` with a catalogue.
 *
 * The controller is constructed directly rather than through Nest's container,
 * for the reason `documents.controller.spec.ts` gives — the class carries
 * `@UseGuards(JwtAuthGuard)` and building that guard's dependency chain is
 * unrelated to what is under test here.
 */
describe("DocumentsController.upload — an 832 arrives", () => {
  const intake = {
    ingest: jest.fn().mockResolvedValue({
      documentId: "doc-9",
      duplicate: false,
      parsed: { docType: "price_list", warnings: [] },
    }),
  };
  const catalogIngest = {
    admit: jest.fn().mockResolvedValue({ admitted: 3, sentence: "three" }),
  };
  const controller = new DocumentsController(
    intake as any,
    {} as any,
    {} as any,
    {} as any,
    catalogIngest as any,
  );
  const body = (over: Record<string, unknown> = {}) =>
    ({
      contentBase64: Buffer.from(CATALOGUE, "utf8").toString("base64"),
      filename: "q3.832",
      ...over,
    }) as any;
  const user = {
    userId: "u-1",
    restaurantId: "r-1",
    fullName: "Ada Manager",
  };

  beforeEach(() => jest.clearAllMocks());

  it("stores it and admits its lines against the named sender", async () => {
    const out: any = await controller.upload(
      body({ distributorKey: "southern-glazers-il", declaredCurrency: "USD" }),
      user as any,
    );
    expect(out.documentId).toBe("doc-9");
    expect(catalogIngest.admit).toHaveBeenCalledTimes(1);
    const arg = catalogIngest.admit.mock.calls[0][0];
    expect(arg.distributorKey).toBe("southern-glazers-il");
    expect(arg.uploadedBy).toBe("u-1");
    expect(arg.uploadedByName).toBe("Ada Manager");
    expect(arg.declaredCurrency).toBe("USD");
    // The FILE's own sha256, so the provenance on each admitted row points at
    // the bytes and not at a re-encoding of them.
    expect(arg.sha256).toBe(
      createHash("sha256")
        .update(Buffer.from(CATALOGUE, "utf8"))
        .digest("hex"),
    );
    expect(out.catalog).toEqual({ admitted: 3, sentence: "three" });
  });

  it("stores it and prices NOTHING when no sender was named, and says which keys exist", async () => {
    const out: any = await controller.upload(body(), user as any);
    expect(catalogIngest.admit).not.toHaveBeenCalled();
    expect(out.documentId).toBe("doc-9");
    expect(out.catalog.admitted).toBe(0);
    expect(out.catalog.refusedWhole).toContain("no sender was named");
    expect(out.catalog.knownDistributorKeys).toContain("southern-glazers-il");
  });

  it("leaves every other document untouched — no `catalog` key on an invoice", async () => {
    const out: any = await controller.upload(
      body({
        contentBase64: Buffer.from("not edi at all", "utf8").toString("base64"),
        filename: "photo.jpg",
      }),
      user as any,
    );
    expect(out.catalog).toBeUndefined();
    expect(catalogIngest.admit).not.toHaveBeenCalled();
  });
});

/**
 * The uploader's SIGNATURE on an admitted catalogue (batch 61 Q2, 2026-09-06).
 *
 * `documents.controller.ts` read `user.fullName ?? user.email` and
 * `JwtStrategy.validate` sets no `fullName` anywhere in this gateway — it
 * returns `name` — so `uploadedByName` carried the uploader's EMAIL ADDRESS
 * while claiming to be a name, on every admitted class-C price. The identical
 * defect was measured and fixed on `distributor-feed.controller.ts` on
 * 2026-09-05 and named as still open here (ADR 0126 §7).
 *
 * These three cases are the regression fence: the session's own `name`, the
 * email as a LAST resort rather than a first answer, and a session that
 * resolves nothing at all staying `null` — never a placeholder, because a row
 * that says "unknown" and a row that says "Unknown User" are different claims.
 */
describe("DocumentsController.upload — who handed the catalogue over", () => {
  const intake = {
    ingest: jest.fn().mockResolvedValue({
      documentId: "doc-9",
      duplicate: false,
      parsed: { docType: "price_list", warnings: [] },
    }),
  };
  const catalogIngest = {
    admit: jest.fn().mockResolvedValue({ admitted: 3, sentence: "three" }),
  };
  const controller = new DocumentsController(
    intake as any,
    {} as any,
    {} as any,
    {} as any,
    catalogIngest as any,
  );
  const body = () =>
    ({
      contentBase64: Buffer.from(CATALOGUE, "utf8").toString("base64"),
      filename: "q3.832",
      distributorKey: "southern-glazers-il",
    }) as any;

  beforeEach(() => jest.clearAllMocks());

  it("names the person with the session's `name`, which is the field JwtStrategy sets", async () => {
    await controller.upload(body(), {
      userId: "u-1",
      restaurantId: "r-1",
      name: "Ada Manager",
      email: "ada@example.test",
    } as any);
    expect(catalogIngest.admit.mock.calls[0][0].uploadedByName).toBe(
      "Ada Manager",
    );
  });

  it("falls back to the email ONLY when the session resolves no name", async () => {
    await controller.upload(body(), {
      userId: "u-1",
      restaurantId: "r-1",
      email: "ada@example.test",
    } as any);
    expect(catalogIngest.admit.mock.calls[0][0].uploadedByName).toBe(
      "ada@example.test",
    );
  });

  it("leaves the name NULL when the session carries none of the three", async () => {
    await controller.upload(body(), {
      userId: "u-1",
      restaurantId: "r-1",
    } as any);
    expect(catalogIngest.admit.mock.calls[0][0].uploadedByName).toBeNull();
  });
});
