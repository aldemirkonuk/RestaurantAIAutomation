import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { LineMappingService } from "./line-mapping.service";

/**
 * The remembered-shelf sentence must NAME the person (slice 4 live re-drive,
 * defect 1). `linked_by` is a known `public.users` id, so "someone here" is the
 * product declining to read a fact it holds.
 *
 * Three states, and they are not interchangeable:
 *   1. the id resolves    → the person's name.
 *   2. no row / no name   → "a person whose name is not on record" — we LOOKED.
 *   3. the users read FAILED → no proposal at all, with the reason in words.
 *      Rendering (2) here would assert we looked when we did not, which is
 *      absence-reported-as-health inside the fix for it.
 */

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

describe("LineMappingService — the sentence names the person", () => {
  let service: LineMappingService;
  let answers: Record<string, Answer>;

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const answerFor = (): Answer =>
      answers[table] ?? { data: null, error: null };
    for (const verb of [
      "select",
      "eq",
      "in",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "insert",
      "update",
      "delete",
    ]) {
      chain[verb] = jest.fn(() => {
        if (verb === "single" || verb === "maybeSingle") {
          const a = answerFor();
          const data = Array.isArray(a.data) ? (a.data[0] ?? null) : a.data;
          return Promise.resolve({
            data: a.error ? null : (data ?? null),
            error: a.error,
          });
        }
        return self();
      });
    }
    (chain as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
    ): unknown => {
      const a = answerFor();
      return Promise.resolve({
        data: a.error ? null : (a.data ?? null),
        error: a.error,
      }).then(resolve);
    };
    return chain;
  };

  const client = { from: jest.fn((table: string) => makeChain(table)) };

  const LINE = {
    vendorSku: "SYN-OKZ-750",
    description: "SYNTHETIC Öküzgözü 2021",
    vintage: 2021,
    formatMl: 750,
  };

  const mappingRow = {
    action: "linked",
    inventory_id: "item-A",
    linked_by: "user-1",
    linked_at: "2026-09-11T10:00:00.000Z",
    key_kind: "vendor_sku",
    key_value: "SYN-OKZ-750|2021",
    key_display: "SYN-OKZ-750",
  };

  const ask = () =>
    service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineMappingService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(LineMappingService);
  });

  it("names the person who last confirmed the pairing, with no caller-supplied hook", async () => {
    answers.document_line_mappings = { data: [mappingRow], error: null };
    answers.users = {
      data: [{ user_id: "user-1", name: "Ayşe" }],
      error: null,
    };

    const got = await ask();
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const p = got.value.get("vendor_sku:SYN-OKZ-750|2021");
    expect(p?.sentence).toBe(
      "Remembered from 1 earlier document from this vendor, last confirmed by Ayşe on 2026-09-11.",
    );
    expect(p?.sentence).not.toContain("someone here");
  });

  it("says a person whose name is not on record when the id resolves to no name — never 'someone'", async () => {
    answers.document_line_mappings = { data: [mappingRow], error: null };
    answers.users = { data: [], error: null };

    const got = await ask();
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const p = got.value.get("vendor_sku:SYN-OKZ-750|2021");
    expect(p?.sentence).toBe(
      "Remembered from 1 earlier document from this vendor, last confirmed by a person whose name is not on record on 2026-09-11.",
    );
  });

  it("withholds the proposal when the NAMES read fails — it does not claim the name is not on record", async () => {
    answers.document_line_mappings = { data: [mappingRow], error: null };
    answers.users = { data: null, error: { message: "connection reset" } };

    const got = await ask();
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error).toContain("connection reset");
    expect(got.error).not.toContain("not on record");
  });

  it("still proposes when the act names nobody at all — the row itself has no author", async () => {
    answers.document_line_mappings = {
      data: [{ ...mappingRow, linked_by: null }],
      error: null,
    };

    const got = await ask();
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const p = got.value.get("vendor_sku:SYN-OKZ-750|2021");
    expect(p?.sentence).toContain("a person whose name is not on record");
    // No users read is issued when there is no id to resolve.
    expect(client.from).not.toHaveBeenCalledWith("users");
  });
});
