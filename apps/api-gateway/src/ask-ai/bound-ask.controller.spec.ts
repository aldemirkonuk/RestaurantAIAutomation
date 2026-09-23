import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { BoundAskController } from "./bound-ask.controller";
import { ReadingFolioStore } from "../ask-readings/reading-folio.store";

// ADR 0145, 2026-09-21 amendment: POST /ask/folios/:id/feedback is scoped
// exactly like GET /ask/folios/:id. The store is real; only its database is a
// double, so the scoping proven here is the store's own `get`.
describe("BoundAskController: feedback is scoped like the folio read", () => {
  const HOUSE = "22222222-2222-4222-8222-222222222222";
  const OTHER_HOUSE = "99999999-9999-4999-8999-999999999999";
  const USER = "11111111-1111-4111-8111-111111111111";
  const FOLIO = "33333333-3333-4333-8333-333333333333";
  const folioRow = {
    id: FOLIO, restaurant_id: HOUSE, user_id: USER, status: "complete", reading_chosen_by: "model", pick_class: "orders.open",
    reply_kind: "model_knowledge", finding: null,
    answer: { kind: "model_knowledge", source: "model_knowledge", sourceLabel: "Not from the house's books", text: "ok" },
  };

  function controllerWith() {
    const inserted: any[] = [];
    const reads: Array<Record<string, unknown>> = [];
    const client = {
      from(table: string) {
        if (table === "ask_folio_labels") {
          return { insert: (v: any) => ({ select: () => ({ single: async () => { inserted.push(v); return { data: { id: "l1", ...v }, error: null }; } }) }) };
        }
        const where: Record<string, unknown> = {};
        const q: any = {
          select: () => q,
          eq: (k: string, v: unknown) => { where[k] = v; return q; },
          maybeSingle: async () => {
            reads.push({ ...where });
            const match = where.id === folioRow.id && where.restaurant_id === folioRow.restaurant_id && where.user_id === folioRow.user_id;
            return { data: match ? folioRow : null, error: null };
          },
        };
        return q;
      },
    };
    const store = new ReadingFolioStore({ getClient: () => client } as any);
    return { controller: new BoundAskController({} as any, store), inserted, reads };
  }

  it("is a POST at folios/:id/feedback", () => {
    const handler = BoundAskController.prototype.feedback;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("folios/:id/feedback");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it("reads the folio with the token's house and person, and labels as the token's role", async () => {
    const { controller, inserted, reads } = controllerWith();
    const req = { user: { userId: USER, restaurantId: HOUSE, role: "Manager" } };
    await controller.feedback(req, FOLIO, { step: "pick", label: "incorrect", goldClass: "vendors.active" });
    expect(reads[0]).toEqual({ id: FOLIO, restaurant_id: HOUSE, user_id: USER });
    expect(inserted[0]).toMatchObject({ folio_id: FOLIO, restaurant_id: HOUSE, labeled_by: USER, labeled_by_role: "manager", basis: "person" });
  });

  it("a token for another house cannot label this folio", async () => {
    const { controller, inserted } = controllerWith();
    const req = { user: { userId: USER, restaurantId: OTHER_HOUSE, role: "owner" } };
    await expect(controller.feedback(req, FOLIO, { step: "knowledge", label: "correct" })).rejects.toMatchObject({ status: 404 });
    expect(inserted).toHaveLength(0);
  });
});
