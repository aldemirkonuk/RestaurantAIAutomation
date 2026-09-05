import { OneTapActionType } from "./dto/one-tap-action.dto";
import {
  ONE_TAP_DISPOSITIONS,
  deliverySealArgs,
  dispositionOf,
  normaliseSealCount,
} from "./one-tap-workflow";

/**
 * The census, tested without Nest or a database — which is the point of it
 * being a plain module. What is asserted here is not "the map has entries": it
 * is that no action type can quietly become a silent success.
 */
describe("one-tap workflow census", () => {
  it("names every action type the DTO declares", () => {
    // A tenth type added without a decision about what its "done" does would
    // fail the compile; this catches the same drift at runtime for a value that
    // arrives as a string from the database.
    for (const type of Object.values(OneTapActionType)) {
      expect(ONE_TAP_DISPOSITIONS[type]).toBeDefined();
    }
  });

  it("makes confirming a delivery the one real workflow", () => {
    expect(ONE_TAP_DISPOSITIONS[OneTapActionType.DELIVERY_CONFIRM]).toEqual({
      kind: "workflow",
      act: "deliver",
    });
    const workflows = Object.entries(ONE_TAP_DISPOSITIONS).filter(
      ([, d]) => d.kind === "workflow",
    );
    expect(workflows.map(([t]) => t)).toEqual(["delivery_confirm"]);
  });

  it("keeps a written action a record, not a workflow and not a stub", () => {
    expect(ONE_TAP_DISPOSITIONS[OneTapActionType.CUSTOM]).toEqual({
      kind: "record",
    });
  });

  it("refuses the reorder in words that name the reason, not the absence", () => {
    const low = ONE_TAP_DISPOSITIONS[OneTapActionType.LOW_STOCK];
    expect(low.kind).toBe("unbuilt");
    // The reason matters: it is not "unimplemented", it is that placing the
    // order would open a priced negotiation with a vendor.
    if (low.kind === "unbuilt") {
      expect(low.sentence).toMatch(/negotiation with the vendor/);
      expect(low.sentence).toMatch(/Nothing was changed/);
    }
  });

  it("treats an unrecognised act as unbuilt, never as a record", () => {
    const d = dispositionOf("something_nobody_declared");
    expect(d.kind).toBe("unbuilt");
    if (d.kind === "unbuilt") {
      expect(d.sentence).toMatch(/does not recognise/);
    }
  });

  it("gives every unbuilt act a sentence that says nothing happened", () => {
    for (const d of Object.values(ONE_TAP_DISPOSITIONS)) {
      if (d.kind === "unbuilt") {
        expect(d.sentence).toMatch(/Nothing was (changed|sent)/);
      }
    }
  });

  describe("what a delivery seal is a seal over", () => {
    const base = {
      actionId: "act-1",
      orderId: "ord-1",
      quantity: 12,
      bottlesTotal: 72,
      status: "PENDING",
    };

    it("hashes the same whether the counts arrive as numbers or strings", () => {
      expect(deliverySealArgs(base)).toEqual(
        deliverySealArgs({
          ...base,
          quantity: "12",
          bottlesTotal: "72",
        }),
      );
    });

    it("changes when the stock about to move changes", () => {
      expect(deliverySealArgs({ ...base, quantity: 24 })).not.toEqual(
        deliverySealArgs(base),
      );
      expect(deliverySealArgs({ ...base, bottlesTotal: 144 })).not.toEqual(
        deliverySealArgs(base),
      );
    });

    it("changes when the order has already moved on", () => {
      expect(deliverySealArgs({ ...base, status: "DELIVERED" })).not.toEqual(
        deliverySealArgs(base),
      );
    });

    it("binds the card, so two cards on one order are two permissions", () => {
      expect(deliverySealArgs({ ...base, actionId: "act-2" })).not.toEqual(
        deliverySealArgs(base),
      );
    });

    it("says unknown rather than zero for a count it could not read", () => {
      // Substituting 0 would hash "no bottles" as a fact and let a seal minted
      // over an unreadable order be spent over a real one.
      expect(normaliseSealCount(null)).toBe("unknown");
      expect(normaliseSealCount(undefined)).toBe("unknown");
      expect(normaliseSealCount("not a number")).toBe("unknown");
      expect(normaliseSealCount(0)).toBe("0");
    });
  });
});
