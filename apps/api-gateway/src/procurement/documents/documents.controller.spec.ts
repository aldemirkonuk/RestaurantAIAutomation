import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

describe("DocumentsController.detail — signed image URL (decision E48)", () => {
  let controller: DocumentsController;

  const mockMaybeSingle = jest.fn();
  const mockOrder = jest.fn();
  const mockCreateSignedUrl = jest.fn();

  const mockChain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: mockOrder,
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn().mockReturnValue({ createSignedUrl: mockCreateSignedUrl }),
    },
  };

  const mockDb = { getClient: jest.fn(() => mockChain) };
  const mockIntake = {};

  const user = { userId: "u1", restaurantId: "rest-1" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockChain.from.mockReturnThis();
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.storage.from.mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    });
    mockOrder.mockResolvedValue({ data: [] });

    // Constructed directly rather than through Nest's DI container — the
    // class carries @UseGuards(JwtAuthGuard), and instantiating that guard's
    // own dependency chain (TokenBlacklistService, etc.) is unrelated to what
    // this test verifies.
    /**
     * ONE STUB PER CONSTRUCTOR DEPENDENCY, and the count is load-bearing.
     * `tsc -p tsconfig.spec.json` is what catches a missing one — `tsconfig.json`
     * excludes specs, so a branch that only typechecks the app compiles clean
     * while this file is one argument short. That is exactly how this file went
     * red on CI after the controller gained the correction door.
     */
    controller = new DocumentsController(
      mockIntake as any,
      mockDb as any,
      {} as any, // CanonicalDocumentService — unused by the routes under test
      {} as any, // DeliverySpineService
      {} as any, // DocumentCorrectionService (ADR 0104 D5)
    );
  });

  it("throws 404 when the document does not exist", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(controller.detail("missing", user)).rejects.toThrow(
      HttpException,
    );
  });

  it("signs the storage_path and attaches imageUrl when present", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-1", storage_path: "rest-1/documents/abc/invoice.pdf" },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/invoice.pdf" },
      error: null,
    });

    const result = await controller.detail("doc-1", user);

    expect(mockChain.storage.from).toHaveBeenCalledWith("vendor-attachments");
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      "rest-1/documents/abc/invoice.pdf",
      3600,
    );
    expect((result.document as any).imageUrl).toBe(
      "https://signed.example/invoice.pdf",
    );
  });

  it("returns imageUrl null without throwing when storage_path is absent (e.g. EDI)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-2", storage_path: null },
      error: null,
    });

    const result = await controller.detail("doc-2", user);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect((result.document as any).imageUrl).toBeNull();
  });

  it("returns imageUrl null (never throws) when signing fails", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-3", storage_path: "rest-1/documents/xyz/receipt.jpg" },
      error: null,
    });
    mockCreateSignedUrl.mockRejectedValueOnce(new Error("bucket unavailable"));

    const result = await controller.detail("doc-3", user);

    expect((result.document as any).imageUrl).toBeNull();
  });
});
