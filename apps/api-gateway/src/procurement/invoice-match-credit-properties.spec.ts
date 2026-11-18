// r57 credit audit: for real-looking deliveries, what is claimed back from the
// vendor and what each good bottle costs always add back to what was billed,
// the credit is never more than the bill, and a worse delivery never claims
// less. Seeded, no deps. Every number is SYNTHETIC.
import { computeMatch, MatchInput } from "./invoice-match";

let seed = 20261120;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const cents = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const holds = (ok: boolean, ctx: unknown) => expect(ok ? "ok" : JSON.stringify(ctx)).toBe("ok");

interface Delivery {
  billed: number;
  price: number;
  accepted: number;
  rejected: number;
  free: number;
  charges: number;
}

/** A delivery as it really goes wrong: short, broken, with a gift of free bottles and freight. */
function delivery(): Delivery {
  const billed = int(1, 60);
  const price = cents(0.5, 120);
  const free = rnd() < 0.3 ? int(1, Math.max(1, Math.ceil(billed / 5))) : 0;
  const arrived = Math.max(0, billed + free - (rnd() < 0.5 ? 0 : int(0, Math.ceil(billed / 2))));
  const rejected = rnd() < 0.4 ? int(0, arrived) : 0;
  const accepted = arrived - rejected;
  const charges = rnd() < 0.5 ? cents(0, 80) : 0;
  return { billed, price, accepted, rejected, free, charges };
}

const input = (d: Delivery): MatchInput => ({
  orderedQty: d.billed,
  poUnitPrice: d.price,
  invoiceQty: d.billed,
  invoiceUnitPrice: d.price,
  acceptedQty: d.accepted,
  rejectedQty: d.rejected,
  freeGoodsQty: d.free,
  allocatedCharges: d.charges,
});

describe("a credit is never more than the bill, and a claimed bottle is never also a cost", () => {
  it("0 <= credit <= billed x price, and cost x accepted + credit = bill + charges (2,000 deliveries)", () => {
    let claimed = 0;
    for (let i = 0; i < 2000; i++) {
      const d = delivery();
      const r = computeMatch(input(d));
      const bill = d.billed * d.price;
      const credit = r.creditAmount ?? 0;
      const ctx = { i, d, r: { credit: r.creditAmount, cost: r.effectiveUnitCost, due: r.creditDue } };
      holds(credit >= 0 && credit <= Math.round(bill * 100) / 100 + 1e-9, ctx);
      // A priced credit is a credit due.
      if (r.creditAmount != null) {
        claimed++;
        holds(r.creditDue, ctx);
      }
      if (r.effectiveUnitCost != null) {
        holds(r.effectiveUnitCost >= 0, ctx);
        // The books and the claim add back to the bill: nothing paid twice, nothing lost.
        // (The credit is rounded to the cent; the cost carries the rest.)
        const back = r.effectiveUnitCost * d.accepted + credit;
        holds(Math.abs(back - (bill + d.charges)) <= 0.0051, { ...ctx, back, want: bill + d.charges });
      }
    }
    expect(claimed).toBeGreaterThan(400);
  });

  it("a worse delivery never claims less: one more bottle lost raises the credit or leaves it", () => {
    for (let i = 0; i < 1500; i++) {
      const d = delivery();
      if (d.accepted < 1) continue;
      const a = computeMatch(input(d));
      const b = computeMatch(input({ ...d, accepted: d.accepted - 1, rejected: d.rejected + (rnd() < 0.5 ? 1 : 0) }));
      holds((b.creditAmount ?? 0) >= (a.creditAmount ?? 0) - 1e-9, { i, d, a: a.creditAmount, b: b.creditAmount });
    }
  });

  it("a free bottle never stands in for a billed one: the credit is the billed bottles that did not arrive usable", () => {
    // 10 billed, 10 kept of which 2 are the vendor's gift: only 8 billed bottles arrived.
    const worked = computeMatch({ orderedQty: 10, poUnitPrice: 5, invoiceQty: 10, invoiceUnitPrice: 5, acceptedQty: 10, freeGoodsQty: 2 });
    expect(worked.creditAmount).toBe(10);
    for (let i = 0; i < 1500; i++) {
      const d = delivery();
      const r = computeMatch(input(d));
      const missing = Math.max(0, d.billed - Math.max(0, d.accepted - d.free));
      const want = missing > 0 ? Math.round(missing * d.price * 100) / 100 : null;
      holds(r.creditAmount === want, { i, d, got: r.creditAmount, want });
    }
  });

  it("a clean delivery claims nothing and costs the billed price plus its freight share", () => {
    for (let i = 0; i < 500; i++) {
      const billed = int(1, 60);
      const price = cents(0.5, 120);
      const charges = rnd() < 0.5 ? cents(0, 80) : 0;
      const r = computeMatch({
        orderedQty: billed,
        poUnitPrice: price,
        invoiceQty: billed,
        invoiceUnitPrice: price,
        acceptedQty: billed,
        rejectedQty: 0,
        allocatedCharges: charges,
      });
      holds(r.creditAmount == null && !r.creditDue, { i, billed, price, r: r.creditAmount });
      holds(Math.abs((r.effectiveUnitCost as number) * billed - (billed * price + charges)) < 1e-6, { i, billed, price, charges });
    }
  });
});
