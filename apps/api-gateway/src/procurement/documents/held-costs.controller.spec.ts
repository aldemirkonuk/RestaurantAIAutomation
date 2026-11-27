/**
 * THE HELD-COSTS ROUTE, AT ITS DOOR (r108 invoices-r108-7b, on #2158).
 *
 * The service spec proves the read; this proves who reaches it. Owner and
 * manager are answered, staff are refused in words before anything is read,
 * a session with no token never reaches the handler (401), and another house's
 * document id is a 404 because the house comes from the token, never the
 * request. The real DeliveryStockService runs over a fake database that holds
 * the document for house A only. These cases fail with the role check removed,
 * with the house taken from anywhere but the token, or with the class guard
 * dropped.
 */
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { DeliveryStockService } from "../canonical/delivery-stock.service";
import { DocumentsController } from "./documents.controller";

const HOUSE_A = "11111111-1111-1111-1111-111111111111";
const HOUSE_B = "22222222-2222-2222-2222-222222222222";
const DOC_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/** One canned answer per table, filtered on restaurant_id for the paper. */
function fakeDb(reads: string[]) {
  return {
    getClient: () => ({
      from: (table: string) => {
        const filters: Record<string, unknown> = {};
        const b: any = {};
        for (const m of ["select", "order", "limit", "in", "not", "is"]) b[m] = () => b;
        b.eq = (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        };
        const answer = () => {
          reads.push(table);
          if (table === "procurement_documents")
            return {
              data: filters.restaurant_id === HOUSE_A && filters.id === DOC_A ? { id: DOC_A } : null,
              error: null,
            };
          if (table === "restaurants")
            return { data: { tax_basis: "prices_include_tax", reclaims_input_tax: true }, error: null };
          return { data: [], error: null };
        };
        b.maybeSingle = () => Promise.resolve(answer());
        b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    }),
  };
}

function controllerWith(reads: string[]): DocumentsController {
  const db = fakeDb(reads);
  const stock = new DeliveryStockService(db as any);
  const deps: unknown[] = Array.from({ length: 12 }, () => ({}));
  deps[1] = db; // db
  deps[8] = stock; // deliveryStock
  return new (DocumentsController as any)(...deps) as DocumentsController;
}

const as = (role: string | undefined, restaurantId = HOUSE_A) =>
  ({ userId: "u1", restaurantId, role }) as any;

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

describe("GET procurement/documents/:id/held-costs, at the door", () => {
  it.each(["owner", "manager"])("%s of the house is answered (200)", async (role) => {
    const reads: string[] = [];
    const out = await controllerWith(reads).heldCosts(DOC_A, as(role));
    expect(out).toEqual({ taxBasisKnown: true, held: [] });
    expect(reads[0]).toBe("procurement_documents");
  });

  it("staff are refused in words (403) and nothing is read", async () => {
    const reads: string[] = [];
    const c = controllerWith(reads);
    await expect(statusOf(c.heldCosts(DOC_A, as("staff")))).resolves.toBe(403);
    await expect(c.heldCosts(DOC_A, as("staff"))).rejects.toThrow(/owner's or a manager's/);
    expect(reads).toEqual([]);
  });

  it("a session with no role at the house is refused (403)", async () => {
    const reads: string[] = [];
    await expect(statusOf(controllerWith(reads).heldCosts(DOC_A, as(undefined)))).resolves.toBe(403);
    expect(reads).toEqual([]);
  });

  it("another house's manager asking for this house's paper gets a 404, not the paper", async () => {
    const reads: string[] = [];
    const c = controllerWith(reads);
    await expect(statusOf(c.heldCosts(DOC_A, as("manager", HOUSE_B)))).resolves.toBe(404);
    await expect(c.heldCosts(DOC_A, as("manager", HOUSE_B))).rejects.toThrow("Document not found");
    // The paper read stopped there: no house, delivery or lot was read.
    expect(reads).toEqual(["procurement_documents", "procurement_documents"]);
  });

  it("a malformed id is refused before any read", async () => {
    const reads: string[] = [];
    await expect(statusOf(controllerWith(reads).heldCosts("not-a-uuid", as("owner")))).resolves.toBe(400);
    expect(reads).toEqual([]);
  });

  it("no token never reaches the handler: the class guard is JwtAuthGuard and the route is not public (401)", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DocumentsController) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    const handler = (DocumentsController.prototype as any).heldCosts;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DocumentsController)).toBeUndefined();
    // Passport's verdict on a request that carried no user is a 401.
    const guard = new JwtAuthGuard(new Reflector(), { isBlacklisted: async () => false } as any);
    expect(() => (guard as any).handleRequest(null, false, undefined)).toThrow(UnauthorizedException);
  });
});
