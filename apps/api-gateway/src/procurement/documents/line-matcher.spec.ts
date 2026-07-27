import {
  AUTO_MATCH_THRESHOLD,
  MatchableLine,
  matchLines,
  normalizeDescription,
  trigramSimilarity,
} from "./line-matcher";

const line = (o: Partial<MatchableLine> & { id: string }): MatchableLine => ({
  qtyBottles: 12,
  ...o,
});

describe("normalizeDescription", () => {
  it("pulls the vintage out of the text instead of matching on it", () => {
    // Leaving "2022" in the string makes a 2022 and a 2023 of the SAME wine look
    // less alike than two unrelated 2022s — backwards for substitution detection.
    const a = normalizeDescription("Sancerre Les Baronnes 2022 750ml");
    const b = normalizeDescription("Sancerre Les Baronnes 2023 750ml");

    expect(a.vintage).toBe(2022);
    expect(b.vintage).toBe(2023);
    expect(a.normalized).toBe(b.normalized);
  });

  it("reads bottle format in both ml and litres", () => {
    expect(normalizeDescription("Barolo 750ml").formatMl).toBe(750);
    expect(normalizeDescription("Chianti 1.5L magnum").formatMl).toBe(1500);
  });

  it("does not mistake a SKU digit run for a vintage", () => {
    expect(normalizeDescription("SGW-11872 Barolo").vintage).toBeNull();
  });

  it("survives the punctuation differences between two systems", () => {
    const ours = normalizeDescription("Cavallotto Bricco Boschis");
    const theirs = normalizeDescription("CAVALLOTTO, BRICCO-BOSCHIS");
    expect(ours.normalized).toBe(theirs.normalized);
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for identical strings and 0 for empty", () => {
    expect(trigramSimilarity("barolo", "barolo")).toBe(1);
    expect(trigramSimilarity("", "barolo")).toBe(0);
  });

  it("scores near-identical text high and unrelated text low", () => {
    expect(
      trigramSimilarity("cavallotto barolo", "cavalotto barolo"),
    ).toBeGreaterThan(0.8);
    expect(
      trigramSimilarity("cavallotto barolo", "sancerre baronnes"),
    ).toBeLessThan(0.3);
  });
});

describe("matchLines", () => {
  it("auto-applies an exact vendor SKU match", () => {
    const r = matchLines(
      [line({ id: "d1", vendorSku: "SGW-11872", description: "Barolo" })],
      [line({ id: "o1", vendorSku: "SGW-11872", description: "Barolo" })],
    );

    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].method).toBe("vendor_sku");
    expect(r.applied[0].confidence).toBeGreaterThanOrEqual(
      AUTO_MATCH_THRESHOLD,
    );
    expect(r.suggested).toHaveLength(0);
  });

  it("never auto-applies on description alone", () => {
    // Two wines from one producer differ by a word and twenty pounds a bottle:
    // "Bricco Boschis" vs "Bricco Boschis Vigna San Giuseppe".
    const r = matchLines(
      [line({ id: "d1", description: "Cavallotto Bricco Boschis" })],
      [line({ id: "o1", description: "Cavallotto Bricco Boschis" })],
    );

    expect(r.applied).toHaveLength(0);
    expect(r.suggested).toHaveLength(1);
    expect(r.suggested[0].method).toBe("description");
  });

  it("treats a vintage swap as a match needing confirmation, not a miss", () => {
    // The beverage case. As a non-match it looks like a phantom short-ship plus
    // a mystery extra line; as an identical match it books a different wine into
    // the same cost lot.
    const r = matchLines(
      [
        line({
          id: "d1",
          vendorSku: "SGW-20411",
          description: "Sancerre Les Baronnes 2023",
        }),
      ],
      [
        line({
          id: "o1",
          vendorSku: "SGW-20411",
          description: "Sancerre Les Baronnes 2022",
        }),
      ],
    );

    expect(r.applied).toHaveLength(0);
    expect(r.suggested).toHaveLength(1);
    expect(r.suggested[0].substitution).toBe(true);
    expect(r.suggested[0].reason).toMatch(/ordered 2022, delivered 2023/);
  });

  it("flags a format swap the same way", () => {
    const r = matchLines(
      [line({ id: "d1", vendorSku: "X1", description: "Chianti 1.5L" })],
      [line({ id: "o1", vendorSku: "X1", description: "Chianti 750ml" })],
    );

    expect(r.suggested[0].substitution).toBe(true);
    expect(r.suggested[0].reason).toMatch(/750ml.*1500ml|1500ml/);
  });

  it("pairs one-to-one and never reuses a line", () => {
    const r = matchLines(
      [
        line({ id: "d1", vendorSku: "A", description: "Barolo" }),
        line({ id: "d2", vendorSku: "A", description: "Barolo" }),
      ],
      [line({ id: "o1", vendorSku: "A", description: "Barolo" })],
    );

    const usedOrders = [...r.applied, ...r.suggested].map((m) => m.orderLineId);
    expect(new Set(usedOrders).size).toBe(usedOrders.length);
    expect(r.unmatchedDocumentLineIds).toHaveLength(1);
  });

  it("reports invoice lines nobody ordered rather than forcing a pairing", () => {
    // Real distributor invoices carry lines that were never on the PO.
    const r = matchLines(
      [
        line({ id: "d1", vendorSku: "A", description: "Barolo" }),
        line({ id: "d2", vendorSku: "ZZZ", description: "Prosecco" }),
      ],
      [line({ id: "o1", vendorSku: "A", description: "Barolo" })],
    );

    expect(r.applied.map((m) => m.documentLineId)).toEqual(["d1"]);
    expect(r.unmatchedDocumentLineIds).toEqual(["d2"]);
  });

  it("reports ordered lines that never arrived", () => {
    const r = matchLines(
      [line({ id: "d1", vendorSku: "A", description: "Barolo" })],
      [
        line({ id: "o1", vendorSku: "A", description: "Barolo" }),
        line({ id: "o2", vendorSku: "B", description: "Sancerre" }),
      ],
    );

    expect(r.unmatchedOrderLineIds).toEqual(["o2"]);
  });

  it("only suggests on quantity and price, never applies", () => {
    // Two different wines at the same quantity and price on one delivery is
    // ordinary, so this signal cannot stand alone.
    const r = matchLines(
      [
        line({
          id: "d1",
          description: "Mystery Item",
          qtyBottles: 12,
          unitPrice: 22,
        }),
      ],
      [
        line({
          id: "o1",
          description: "Totally Different",
          qtyBottles: 12,
          unitPrice: 22,
        }),
      ],
    );

    expect(r.applied).toHaveLength(0);
    expect(r.suggested[0].method).toBe("qty_price");
    expect(r.suggested[0].confidence).toBeLessThan(AUTO_MATCH_THRESHOLD);
  });

  it("leaves genuinely unrelated lines unmatched instead of guessing", () => {
    const r = matchLines(
      [
        line({
          id: "d1",
          description: "Barolo Riserva",
          qtyBottles: 6,
          unitPrice: 450,
        }),
      ],
      [
        line({
          id: "o1",
          description: "Prosecco Brut",
          qtyBottles: 24,
          unitPrice: 14,
        }),
      ],
    );

    expect(r.applied).toHaveLength(0);
    expect(r.suggested).toHaveLength(0);
    expect(r.unmatchedDocumentLineIds).toEqual(["d1"]);
    expect(r.unmatchedOrderLineIds).toEqual(["o1"]);
  });

  it("is deterministic when two candidates score the same", () => {
    // A receiver arguing with a distributor has to be able to say why two lines
    // were paired, and the answer cannot change between runs.
    const docs = [
      line({ id: "d1", vendorSku: "A" }),
      line({ id: "d2", vendorSku: "A" }),
    ];
    const orders = [
      line({ id: "o1", vendorSku: "A" }),
      line({ id: "o2", vendorSku: "A" }),
    ];

    const first = matchLines(docs, orders);
    const second = matchLines([...docs].reverse(), [...orders].reverse());

    expect(
      first.applied.map((m) => `${m.documentLineId}->${m.orderLineId}`).sort(),
    ).toEqual(
      second.applied.map((m) => `${m.documentLineId}->${m.orderLineId}`).sort(),
    );
  });

  it("handles empty input without throwing", () => {
    expect(matchLines([], []).applied).toHaveLength(0);
    expect(
      matchLines([line({ id: "d1" })], []).unmatchedDocumentLineIds,
    ).toEqual(["d1"]);
  });
});
