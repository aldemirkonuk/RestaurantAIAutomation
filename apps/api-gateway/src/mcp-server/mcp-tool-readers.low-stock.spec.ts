/**
 * The low-stock tool reads v_low_stock_items, whose rule is stock_live <
 * threshold_min, strictly (ADR 0129). Its words must say the same: an item
 * sitting exactly at par is not short, so "at or under par" told an agent
 * something the list never meant.
 */
import { McpToolReadersService } from "./mcp-tool-readers.service";
import { ALL_TOOLS } from "./tool-catalog";

function readers(items: unknown[]) {
  const inventory = { getLowStockItems: jest.fn().mockResolvedValue(items) };
  const none = {} as never;
  return new McpToolReadersService(inventory as never, none, none, none, none, none, none);
}

describe("inventory low-stock tool wording", () => {
  it("says an empty list means nothing is below par, not 'at or under'", async () => {
    const out = await readers([]).inventoryLowStock("r-1");
    const note = (out.value as { note: string | null }).note ?? "";
    expect(note).toMatch(/^Nothing is below par\./);
    expect(note).not.toMatch(/at or under/i);
  });

  it("gives no note when something is below par", async () => {
    const out = await readers([{ id: "i-1" }]).inventoryLowStock("r-1");
    expect((out.value as { note: string | null }).note).toBeNull();
  });

  it("describes the tool with the view's strict rule", () => {
    const text = JSON.stringify(ALL_TOOLS);
    expect(text).not.toMatch(/at or under par/i);
    expect(text).toMatch(/strictly under the minimum/);
  });
});
