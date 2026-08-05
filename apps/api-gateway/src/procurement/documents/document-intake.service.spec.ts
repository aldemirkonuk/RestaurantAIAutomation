import { Test, TestingModule } from "@nestjs/testing";
import { DocumentIntakeService } from "./document-intake.service";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";

describe("DocumentIntakeService — original bytes persistence (decision E47)", () => {
  let service: DocumentIntakeService;

  const mockSingle = jest.fn();
  const mockMaybeSingle = jest.fn();
  const mockStorageUpload = jest.fn();

  const mockSupabaseChain: any = {
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

  const mockDatabaseService = {
    getClient: jest.fn(() => mockSupabaseChain),
  };

  const mockExtractor = {
    available: jest.fn().mockReturnValue(false),
    extract: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSupabaseChain.from.mockReturnThis();
    mockSupabaseChain.select.mockReturnThis();
    mockSupabaseChain.insert.mockReturnThis();
    mockSupabaseChain.eq.mockReturnThis();
    mockSupabaseChain.order.mockReturnThis();
    mockSupabaseChain.limit.mockReturnThis();
    mockSupabaseChain.storage.from.mockReturnValue({
      upload: mockStorageUpload,
      download: jest.fn(),
    });

    // Not a duplicate by default.
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // Insert of procurement_documents succeeds by default.
    mockSingle.mockResolvedValue({ data: { id: "doc-1" }, error: null });
    mockStorageUpload.mockResolvedValue({ data: { path: "ok" }, error: null });
    mockExtractor.available.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIntakeService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: DocumentExtractorService, useValue: mockExtractor },
      ],
    }).compile();

    service = module.get<DocumentIntakeService>(DocumentIntakeService);
  });

  it("uploads the raw bytes to vendor-attachments at {restaurantId}/documents/{sha256}/{filename} for the upload channel", async () => {
    const buffer = Buffer.from("fake pdf bytes");

    await service.ingest({
      restaurantId: "rest-1",
      source: "upload",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    expect(mockSupabaseChain.storage.from).toHaveBeenCalledWith(
      "vendor-attachments",
    );
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const [path, uploadedBytes, opts] = mockStorageUpload.mock.calls[0];
    expect(path).toMatch(/^rest-1\/documents\/[a-f0-9]{64}\/invoice\.pdf$/);
    expect(Buffer.isBuffer(uploadedBytes)).toBe(true);
    expect(opts).toMatchObject({ contentType: "application/pdf", upsert: true });

    // storage_path on the insert must be the uploaded path, not null.
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBe(path);
  });

  it("uploads the raw bytes for the photo channel too", async () => {
    const buffer = Buffer.from("fake photo bytes");

    await service.ingest({
      restaurantId: "rest-2",
      source: "photo",
      buffer,
      filename: "receipt.jpg",
      mimeType: "image/jpeg",
    });

    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).not.toBeNull();
  });

  it("does not re-upload when storagePath is already resolved (email channel)", async () => {
    const buffer = Buffer.from("already stored bytes");

    await service.ingest({
      restaurantId: "rest-3",
      source: "email",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      storagePath: "rest-3/conv-1/already-stored.pdf",
    });

    expect(mockStorageUpload).not.toHaveBeenCalled();
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBe("rest-3/conv-1/already-stored.pdf");
  });

  it("skips storage entirely for text-only EDI intake, which keeps its content in raw_payload", async () => {
    await service.ingest({
      restaurantId: "rest-4",
      source: "edi",
      text: "ISA*00*          *00*          *ZZ*SENDER*ZZ*RECEIVER*260101*1200*U*00401*000000001*0*P*>~",
      filename: "810.edi",
    });

    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("does not fail ingest when the storage upload errors — it is best-effort", async () => {
    mockStorageUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "bucket unavailable" },
    });
    const buffer = Buffer.from("bytes that fail to upload");

    const result = await service.ingest({
      restaurantId: "rest-5",
      source: "upload",
      buffer,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
    });

    expect(result.error).toBeUndefined();
    const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
    expect(insertCall.storage_path).toBeNull();
  });
});
