import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { DatabaseService } from "../database/database.service";

/**
 * Cross-tenant read on `GET conversations/by-order/:orderId` (and its twin
 * `by-provider/:providerId`).
 *
 * Both handlers took no `@CurrentUser()` and called `listConversations()` with no
 * `restaurantId`. The service only applied the tenant filter when one was passed
 * (`if (options.restaurantId)`), so the omission was silent: any authenticated caller
 * who knew a `procurement_orders.id` or `providers.id` read that restaurant's full
 * vendor thread — messages, provider, content — whatever tenant owned it. Every sibling
 * route in this controller (`GET /`, `threads`, `thread/:id`, `stats/overview`) already
 * passes `user.restaurantId`.
 *
 * The fake below is a real filter, not a stub that returns canned rows: it holds two
 * restaurants' rows and honours `.eq()`, so a call that forgets the tenant filter
 * genuinely returns the other restaurant's data.
 */

type Row = Record<string, any>;

const RESTAURANT_A = "11111111-1111-1111-1111-111111111111";
const RESTAURANT_B = "22222222-2222-2222-2222-222222222222";
const ORDER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROVIDER_A = "pppppppp-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const ROWS: Row[] = [
  {
    id: "conv-a-1",
    restaurant_id: RESTAURANT_A,
    order_id: ORDER_A,
    provider_id: PROVIDER_A,
    message_text: "A's negotiated price is 41.00",
    created_at: "2026-09-01T10:00:00Z",
  },
  {
    id: "conv-a-2",
    restaurant_id: RESTAURANT_A,
    order_id: ORDER_A,
    provider_id: PROVIDER_A,
    message_text: "A's reply",
    created_at: "2026-09-01T11:00:00Z",
  },
  {
    id: "conv-b-1",
    restaurant_id: RESTAURANT_B,
    order_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    provider_id: "pppppppp-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message_text: "B's own thread",
    created_at: "2026-09-01T12:00:00Z",
  },
];

function makeController() {
  const client: any = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return q;
        },
        order: () => q,
        range: () => q,
        then(resolve: (v: any) => unknown) {
          const data =
            table === "procurement_conversations"
              ? ROWS.filter((r) => filters.every(([c, v]) => r[c] === v))
              : [];
          return Promise.resolve({
            data,
            error: null,
            count: data.length,
          }).then(resolve);
        },
      };
      return q;
    },
  };

  const service = new ConversationsService({
    supabase: client,
  } as unknown as DatabaseService);
  return { controller: new ConversationsController(service), service };
}

const asA = { userId: "user-a", restaurantId: RESTAURANT_A };
const asB = { userId: "user-b", restaurantId: RESTAURANT_B };

describe("GET conversations/by-order/:orderId is tenant-scoped", () => {
  it("returns nothing when another restaurant asks for this order's thread", async () => {
    const { controller } = makeController();

    const result: any = await controller.getByOrder(asB, ORDER_A);

    expect(result.conversations).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("still returns the thread to the restaurant that owns the order", async () => {
    const { controller } = makeController();

    const result: any = await controller.getByOrder(asA, ORDER_A);

    expect(result.conversations.map((c: Row) => c.id)).toEqual([
      "conv-a-1",
      "conv-a-2",
    ]);
  });
});

describe("GET conversations/by-provider/:providerId is tenant-scoped", () => {
  it("returns nothing when another restaurant asks for this provider's threads", async () => {
    const { controller } = makeController();

    const result: any = await controller.getByProvider(asB, PROVIDER_A);

    expect(result.conversations).toEqual([]);
  });

  it("still returns the provider's threads to the owning restaurant", async () => {
    const { controller } = makeController();

    const result: any = await controller.getByProvider(asA, PROVIDER_A);

    expect(result.conversations).toHaveLength(2);
  });
});

describe("listConversations fails closed without a tenant", () => {
  // The previous `if (options.restaurantId)` made forgetting the tenant look like
  // "no filter requested". A missing tenant must be an error, as it already is in
  // listConversationThreads.
  it("refuses to run with no restaurantId instead of listing every tenant", async () => {
    const { service } = makeController();

    await expect(
      service.listConversations({
        orderId: ORDER_A,
        page: 1,
        limit: 100,
        sortBy: "created_at",
        sortOrder: "asc",
      }),
    ).rejects.toThrow(/restaurantId is required/i);
  });
});
