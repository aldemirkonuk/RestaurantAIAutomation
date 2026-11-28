import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Test } from "@nestjs/testing";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { GetTransactionsQueryDto } from "./dto/inventory-ledger.dto";

/**
 * The inventory drawer shows three purchases. It asks for three, with the
 * columns the response maps, instead of 50 full rows. The web sends `limit=3`
 * as a query string, which arrives as text, so the DTO must turn it into a
 * number before @IsInt sees it.
 */
const RID = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";

describe("GET /inventory-ledger/transactions limit", () => {
  const parse = (q: Record<string, string>) =>
    plainToInstance(GetTransactionsQueryDto, q);

  it("accepts limit=3 from a query string and reads it as the number 3", async () => {
    const dto = parse({ inventoryId: ITEM, transactionType: "purchase", limit: "3" });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.limit).toBe(3);
  });

  it("still refuses a limit past 500 and a non-number", async () => {
    expect((await validate(parse({ limit: "501" }))).length).toBe(1);
    expect((await validate(parse({ limit: "abc" }))).length).toBe(1);
  });

  it("reads three rows and names its columns, not select *", async () => {
    const calls: { select?: unknown[]; range?: number[] } = {};
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "gte", "lte", "order"]) q[m] = jest.fn(() => q);
    q.select = jest.fn((...a: unknown[]) => { calls.select = a; return q; });
    q.range = jest.fn((...a: number[]) => {
      calls.range = a;
      return Promise.resolve({ data: [], error: null, count: 9 });
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        InventoryLedgerService,
        { provide: DatabaseService, useValue: { supabase: { from: () => q } } },
        { provide: EventsService, useValue: {} },
      ],
    }).compile();
    const out = await moduleRef
      .get(InventoryLedgerService)
      .listTransactions(RID, parse({ inventoryId: ITEM, transactionType: "purchase", limit: "3" }) as never);
    expect(calls.range).toEqual([0, 2]);
    expect(calls.select?.[0]).not.toBe("*");
    expect(String(calls.select?.[0])).toContain("unit_cost");
    expect(calls.select?.[1]).toEqual({ count: "exact" });
    expect(out.total).toBe(9);
  });
});
