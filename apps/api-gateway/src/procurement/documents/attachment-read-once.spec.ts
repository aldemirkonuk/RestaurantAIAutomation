import {
  DocumentIntakeService,
  INGEST_ATTEMPTS,
  NOT_A_DOCUMENT_BEFORE_EINVOICE,
  NOT_A_DOCUMENT_REASON,
} from "./document-intake.service";
import { zipOf } from "./efatura/test-zip.fixture";

/**
 * Proposal-receipt row 1.2 — an emailed attachment is read once, and every
 * one says what became of it. All ids are SYNTHETIC.
 */

type Row = Record<string, unknown>;

function attachment(id: string, extra: Row = {}): Row {
  return {
    id,
    restaurant_id: "house-1",
    provider_id: null,
    order_id: null,
    filename: `${id}.pdf`,
    mime_type: "application/pdf",
    storage_path: `house-1/${id}.pdf`,
    sha256: null,
    bytes_deleted_at: null,
    ingest_attempts: 0,
    ...extra,
  };
}

function harness(opts: {
  pending: Row[];
  shaSeen?: Row | null;
  downloadError?: string;
  updateError?: string;
  /** Another run decided the row first: the guarded write matches nothing. */
  raced?: boolean;
  /** Rows the narrower rule called not_a_document (the PR 1043 requeue pass). */
  turnedAway?: Row[];
  /** The bytes every download returns. */
  bytes?: Buffer;
}) {
  const updates: Array<{ id: unknown; patch: Row; guards: Array<[string, unknown]> }> = [];
  const selects: Array<{ table: string; eqs: Array<[string, unknown]> }> = [];
  const download = jest.fn(async () =>
    opts.downloadError
      ? { data: null, error: { message: opts.downloadError } }
      : {
          data: {
            arrayBuffer: async () =>
              opts.bytes
                ? opts.bytes.buffer.slice(
                    opts.bytes.byteOffset,
                    opts.bytes.byteOffset + opts.bytes.byteLength,
                  )
                : new ArrayBuffer(4),
          },
          error: null,
        },
  );
  const client = {
    storage: { from: () => ({ download }) },
    from(table: string) {
      const call = { table, eqs: [] as Array<[string, unknown]> };
      let patch: Row | null = null;
      const chain: any = {
        select: () => {
          if (patch) {
            const id = call.eqs.find(([k]) => k === "id")?.[1];
            updates.push({ id, patch, guards: call.eqs.filter(([k]) => k !== "id") });
            return Promise.resolve({
              data: opts.updateError || opts.raced ? [] : [{ id }],
              error: opts.updateError ? { message: opts.updateError } : null,
            });
          }
          selects.push(call);
          return chain;
        },
        update: (p: Row) => {
          patch = p;
          return chain;
        },
        eq: (k: string, v: unknown) => {
          call.eqs.push([k, v]);
          return chain;
        },
        order: () => chain,
        or: () => chain,
        limit: async () =>
          call.eqs.some(([k, v]) => k === "ingest_state" && v === "not_a_document")
            ? { data: opts.turnedAway ?? [], error: null }
            : { data: opts.pending, error: null },
        maybeSingle: async () => ({ data: opts.shaSeen ?? null, error: null }),
      };
      return chain;
    },
  };
  const service = new DocumentIntakeService(
    { getClient: () => client } as never,
    { available: () => false } as never,
    {} as never,
    {} as never,
  );
  return { service, updates, selects, download };
}

describe("row 1.2 — the sweep reads pending attachments only", () => {
  it("asks for pending rows, never every recent row", async () => {
    const h = harness({ pending: [] });
    await h.service.sweepUningestedAttachments();
    expect(h.selects[0].table).toBe("conversation_attachments");
    expect(h.selects[0].eqs).toContainEqual(["ingest_state", "pending"]);
  });

  it("a paper whose number is on file is recorded as a duplicate, so it is not read again", async () => {
    const h = harness({ pending: [attachment("a1")] });
    const ingest = jest
      .spyOn(h.service, "ingest")
      .mockResolvedValue({
        documentId: "earlier-doc",
        duplicate: true,
        parsed: null,
        duplicateOf: {
          documentId: "earlier-doc",
          docNumber: "SYN-1",
          reason: "SYNTHETIC: no. SYN-1 is already on file",
        },
      } as never);
    await h.service.sweepUningestedAttachments();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(h.updates).toEqual([
      {
        id: "a1",
        guards: [
          ["ingest_state", "pending"],
          ["ingest_attempts", 0],
        ],
        patch: expect.objectContaining({
          ingest_state: "duplicate",
          ingested_document_id: "earlier-doc",
          ingest_attempts: 1,
          last_ingest_reason: "SYNTHETIC: no. SYN-1 is already on file",
        }),
      },
    ]);
  });

  it("a file removed under retention is failed with its date and never downloaded", async () => {
    const h = harness({
      pending: [attachment("a1", { bytes_deleted_at: "2027-01-02T00:00:00Z" })],
    });
    await h.service.sweepUningestedAttachments();
    expect(h.download).not.toHaveBeenCalled();
    expect(h.updates[0].patch).toMatchObject({ ingest_state: "failed" });
    expect(String(h.updates[0].patch.last_ingest_reason)).toMatch(/2027-01-02/);
  });

  it("a logo is not a document, said without a download", async () => {
    const h = harness({
      pending: [attachment("a1", { filename: "logo.png", mime_type: "image/png" })],
    });
    await h.service.sweepUningestedAttachments();
    expect(h.download).not.toHaveBeenCalled();
    expect(h.updates[0].patch).toMatchObject({ ingest_state: "not_a_document" });
  });

  it("the same bytes already filed from this attachment read as ingested, without a download", async () => {
    const h = harness({
      pending: [attachment("a1", { sha256: "abc" })],
      shaSeen: { id: "doc-1", source_ref: "conversation_attachment:a1" },
    });
    await h.service.sweepUningestedAttachments();
    expect(h.download).not.toHaveBeenCalled();
    expect(h.updates[0].patch).toMatchObject({
      ingest_state: "ingested",
      ingested_document_id: "doc-1",
    });
  });

  it("a failed download is tried again later, then failed with the count", async () => {
    const first = harness({ pending: [attachment("a1")], downloadError: "SYNTHETIC 503" });
    await first.service.sweepUningestedAttachments();
    expect(first.updates[0].patch).toMatchObject({
      ingest_state: "pending",
      ingest_attempts: 1,
    });
    expect(String(first.updates[0].patch.last_ingest_reason)).toMatch(/SYNTHETIC 503/);

    const last = harness({
      pending: [attachment("a1", { ingest_attempts: INGEST_ATTEMPTS - 1 })],
      downloadError: "SYNTHETIC 503",
    });
    await last.service.sweepUningestedAttachments();
    expect(last.updates[0].patch).toMatchObject({
      ingest_state: "failed",
      ingest_attempts: INGEST_ATTEMPTS,
    });
    expect(String(last.updates[0].patch.last_ingest_reason)).toMatch(
      /not tried again/,
    );
  });

  it("every download counts against the run's budget, whatever it became", async () => {
    const h = harness({
      pending: [attachment("a1"), attachment("a2"), attachment("a3")],
    });
    jest
      .spyOn(h.service, "ingest")
      .mockResolvedValue({ documentId: "d", duplicate: true, parsed: null } as never);
    await h.service.sweepUningestedAttachments(2);
    expect(h.download).toHaveBeenCalledTimes(2);
  });

  it("a row another run decided first is not written over, and the run carries on", async () => {
    const h = harness({
      pending: [attachment("a1"), attachment("a2", { ingest_attempts: 1 })],
      raced: true,
    });
    jest
      .spyOn(h.service, "ingest")
      .mockResolvedValue({ documentId: "d", duplicate: true, parsed: null } as never);
    await h.service.sweepUningestedAttachments();
    // Both rows were tried: a lost race is not a write failure.
    expect(h.download).toHaveBeenCalledTimes(2);
    // Each write lands only on the row as this run read it.
    expect(h.updates.map((u) => u.guards)).toEqual([
      [
        ["ingest_state", "pending"],
        ["ingest_attempts", 0],
      ],
      [
        ["ingest_state", "pending"],
        ["ingest_attempts", 1],
      ],
    ]);
  });

  it("an outcome that cannot be written stops the run", async () => {
    const h = harness({
      pending: [attachment("a1"), attachment("a2")],
      updateError: "SYNTHETIC write refused",
    });
    jest
      .spyOn(h.service, "ingest")
      .mockResolvedValue({ documentId: "d", duplicate: false, parsed: null } as never);
    await h.service.sweepUningestedAttachments();
    expect(h.download).toHaveBeenCalledTimes(1);
  });
});

describe("the e-invoice file at the sweep (PR 1043 review)", () => {
  const ETTN = "0f0e0d0c-0000-4000-8000-synthetic001";
  const UBL = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="c"><cbc:ID>SYN1</cbc:ID><cbc:UUID>${ETTN}</cbc:UUID></Invoice>`;

  it("a zip named after its bare ETTN is read, not turned away by its name", async () => {
    const h = harness({
      pending: [attachment("a1", { filename: `${ETTN}.zip`, mime_type: "application/zip" })],
      bytes: zipOf([{ name: `${ETTN}.xml`, data: UBL }]),
    });
    const ingest = jest
      .spyOn(h.service, "ingest")
      .mockResolvedValue({ documentId: "doc-1", duplicate: false, parsed: null } as never);
    await h.service.sweepUningestedAttachments();
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(h.updates[0].patch).toMatchObject({ ingest_state: "ingested", ingested_document_id: "doc-1" });
  });

  it("a zip with no e-invoice in it is not a paper, said with what it held, and nothing is filed", async () => {
    const h = harness({
      pending: [attachment("a1", { filename: "2026-11-05.zip", mime_type: "application/zip" })],
      bytes: zipOf([{ name: "photo.jpg", data: "SYNTHETIC" }]),
    });
    const ingest = jest.spyOn(h.service, "ingest");
    await h.service.sweepUningestedAttachments();
    expect(ingest).not.toHaveBeenCalled();
    expect(h.updates[0].patch).toMatchObject({ ingest_state: "not_a_document" });
    expect(String(h.updates[0].patch.last_ingest_reason)).toMatch(/holds no e-invoice XML.*photo\.jpg/);
  });

  it("a file that is no paper at all carries the new rule's words", async () => {
    const h = harness({
      pending: [attachment("a1", { filename: "prices.csv", mime_type: "text/csv" })],
    });
    await h.service.sweepUningestedAttachments();
    expect(h.updates[0].patch).toMatchObject({
      ingest_state: "not_a_document",
      last_ingest_reason: NOT_A_DOCUMENT_REASON,
    });
  });

  it("XML and zip files the narrower rule turned away are put back to be read, once", async () => {
    const h = harness({
      pending: [],
      turnedAway: [
        { id: "x1", filename: `${ETTN}.xml`, mime_type: "application/xml" },
        { id: "z1", filename: "2026-11-05.zip", mime_type: "application/zip" },
        { id: "l1", filename: "logo.xml", mime_type: "application/xml" },
      ],
    });
    await h.service.sweepUningestedAttachments();
    const byId = Object.fromEntries(h.updates.map((u) => [u.id, u]));
    for (const id of ["x1", "z1"])
      expect(byId[id].patch).toEqual({
        ingest_state: "pending",
        ingest_attempts: 0,
        last_ingest_reason: null,
        ingested_document_id: null,
        ingest_decided_at: null,
      });
    // Still not a paper under the wider rule: reworded, so it is never picked again.
    expect(byId.l1.patch).toEqual({ last_ingest_reason: NOT_A_DOCUMENT_REASON });
    // Each write lands only on a row still holding the old rule's words.
    for (const u of h.updates)
      expect(u.guards).toEqual([
        ["ingest_state", "not_a_document"],
        ["last_ingest_reason", NOT_A_DOCUMENT_BEFORE_EINVOICE],
      ]);
    // And the look-again read asked for exactly those rows.
    const again = h.selects.find((c) =>
      c.eqs.some(([k, v]) => k === "ingest_state" && v === "not_a_document"),
    );
    expect(again?.eqs).toContainEqual(["last_ingest_reason", NOT_A_DOCUMENT_BEFORE_EINVOICE]);
  });
});

describe("GET /procurement/documents/arrivals — what became of each emailed file", () => {
  // Imported here so the sweep half above does not load the controller.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DocumentsController } = require("./documents.controller");

  function controllerWith(rows: Row[], error: unknown = null) {
    const eqs: Array<[string, unknown]> = [];
    let limitAsked = 0;
    const chain: any = {
      from: () => chain,
      select: () => chain,
      eq: (k: string, v: unknown) => {
        eqs.push([k, v]);
        return chain;
      },
      order: () => chain,
      limit: async (n: number) => {
        limitAsked = n;
        return { data: rows.slice(0, n), error };
      },
    };
    const unused = {} as never;
    const c = new DocumentsController(
      unused,
      { getClient: () => chain } as never,
      unused, unused, unused, unused, unused, unused, unused, unused, unused,
    );
    return { c, eqs, limit: () => limitAsked };
  }

  const row = (id: string, state: string): Row => ({
    id,
    filename: `${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 10,
    created_at: "2027-07-05T10:00:00Z",
    ingest_state: state,
    ingested_document_id: state === "duplicate" ? "doc-0" : null,
    last_ingest_reason: state === "duplicate" ? "SYNTHETIC on file" : null,
    ingest_attempts: 1,
  });

  it("reads one house's files with each outcome, and says when there are more", async () => {
    const h = controllerWith([row("a1", "duplicate"), row("a2", "pending")]);
    const out = await h.c.arrivals({ restaurantId: "house-1" } as never, "1");
    expect(h.eqs).toContainEqual(["restaurant_id", "house-1"]);
    expect(h.limit()).toBe(2);
    expect(out.more).toBe(true);
    expect(out.items).toEqual([
      expect.objectContaining({
        id: "a1",
        state: "duplicate",
        documentId: "doc-0",
        reason: "SYNTHETIC on file",
      }),
    ]);
  });

  it("a failed read is a 503 in words, never an empty list", async () => {
    const h = controllerWith([], { message: "SYNTHETIC down" });
    await expect(
      h.c.arrivals({ restaurantId: "house-1" } as never),
    ).rejects.toThrow(/could not be read: SYNTHETIC down/);
  });
});
