import { WineSubmissionsService } from "./wine-submissions.service";

/**
 * F-857. When a menu import loses the race to create a shared library row,
 * `resolveOrCreateLibraryWine` re-reads the winner's row. That read used to
 * drop its error, so a failed read fell through to "insert was skipped but no
 * row carries signature …" — telling the owner the wine was missing when the
 * truth was that the wine list could not be read.
 */

const RESTAURANT_ID = "22222222-2222-2222-2222-222222222222";

function makeService(readBack: { data: any; error: any }) {
  const chain = (): any => {
    let upserting = false;
    const api: any = {
      select: () => api,
      eq: () => api,
      upsert: () => {
        upserting = true;
        return api;
      },
      // The upsert was skipped (a concurrent import won), so it returns no
      // row; the read that follows gets `readBack`.
      maybeSingle: async () =>
        upserting ? { data: null, error: null } : readBack,
    };
    return api;
  };
  const supabase = {
    from: () => chain(),
    rpc: async () => ({ data: [], error: null }),
  };
  return new WineSubmissionsService({ supabase, getClient: () => supabase } as any);
}

const LINE = { name: "Akakies", producer: "Kir-Yianni", country: "Greece" };

describe("a failed shared-library read-back says so", () => {
  it("names the failed read, not a missing wine", async () => {
    const service = makeService({
      data: null,
      error: { message: "connection reset" },
    });

    const attempt = service.resolveOrCreateLibraryWine(LINE, RESTAURANT_ID);

    await expect(attempt).rejects.toThrow(
      /"Akakies" was not added: the wine list could not be read just now/,
    );
    await expect(
      service.resolveOrCreateLibraryWine(LINE, RESTAURANT_ID),
    ).rejects.not.toThrow(/no row carries signature/);
  });

  it("still links to the winner's row when the read works", async () => {
    const service = makeService({
      data: { id: "mw-winner", library_tier: 2 },
      error: null,
    });

    const result = await service.resolveOrCreateLibraryWine(LINE, RESTAURANT_ID);

    expect(result.masterWineId).toBe("mw-winner");
    expect(result.matched).toBe(true);
  });
});
