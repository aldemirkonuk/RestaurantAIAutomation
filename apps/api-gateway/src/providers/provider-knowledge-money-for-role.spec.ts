import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";

/**
 * F-1078: staff read a vendor's prices and money terms off
 * `GET /providers/:id/knowledge` and `/knowledge/contradictions`. Staff see
 * no house money (ADR 0145, the F-957..F-959 call), so a non-holder gets
 * every kind of fact except prices, money terms and offers; owners and
 * managers get all of it.
 */

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROV = "11111111-1111-4111-8111-111111111111";

const GROUPED = {
  pricing: [
    {
      id: "f-price",
      label: "Price for Barolo",
      attributes: { old_price: 40, new_price: 46 },
    },
  ],
  financial: [
    {
      id: "f-terms",
      label: "Financial: payment_terms",
      attributes: { new_value: "45 days" },
    },
  ],
  promotion: [{ id: "f-offer", label: "Spring offer", attributes: {} }],
  logistics: [
    {
      id: "f-days",
      label: "Delivers Tuesday",
      attributes: { new_value: "Tue" },
    },
  ],
  people: [{ id: "f-who", label: "Contact: Ayla", attributes: {} }],
};

const CHANGES = [
  {
    id: "f-price",
    category: "pricing",
    attributes: { new_price: 46 },
    previous_value: { new_price: 40 },
  },
  {
    id: "f-days",
    category: "logistics",
    attributes: { new_value: "Tue" },
    previous_value: { new_value: "Mon" },
  },
];

function controller() {
  const service = {
    getKnowledge: jest.fn(async () => structuredClone(GROUPED)),
    getContradictions: jest.fn(async () => structuredClone(CHANGES)),
  } as unknown as ProviderIntelligenceService;
  return new ProviderIntelligenceController(service, {} as never, {} as never);
}

const as = (role: string | null) => ({
  userId: "u-1",
  restaurantId: HOUSE,
  role,
});

describe("a vendor's learned money stays with those who hold the house's money (F-1078)", () => {
  it.each(["staff", null, "something-unknown"])(
    "role %p gets no prices, money terms or offers in the facts",
    async (role) => {
      const out = (await controller().getKnowledge(
        PROV,
        undefined,
        as(role),
      )) as Record<string, unknown>;
      expect(Object.keys(out).sort()).toEqual(["logistics", "people"]);
      expect(JSON.stringify(out)).not.toMatch(/price|45 days/);
    },
  );

  it("staff asking for the pricing kind by name get nothing back", async () => {
    const c = controller();
    const out = await c.getKnowledge(PROV, "pricing", as("staff"));
    expect(out).not.toHaveProperty("pricing");
  });

  it.each(["owner", "manager"])("%s gets every kind", async (role) => {
    const out = (await controller().getKnowledge(
      PROV,
      undefined,
      as(role),
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ["financial", "logistics", "people", "pricing", "promotion"].sort(),
    );
  });

  it("staff get the delivery change but not the price change", async () => {
    const out = (await controller().getContradictions(PROV, as("staff"))) as {
      id: string;
    }[];
    expect(out.map((r) => r.id)).toEqual(["f-days"]);
  });

  it("an owner gets both changes", async () => {
    const out = (await controller().getContradictions(PROV, as("owner"))) as {
      id: string;
    }[];
    expect(out.map((r) => r.id)).toEqual(["f-price", "f-days"]);
  });
});
