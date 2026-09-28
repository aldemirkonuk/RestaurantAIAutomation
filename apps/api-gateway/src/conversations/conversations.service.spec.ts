import axios from "axios";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ConversationsService,
  HOUSE_LETTER_STATUSES,
} from "./conversations.service";
import { DatabaseService } from "../database/database.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Defect B — `/api/v1/events/publish` does not exist.
 *
 * The orchestrator registers `/api/v1/{admin,analytics,collect,onboarding,pos,
 * preview,procurement,quality,research,scan,studio}`, `/api/templates` and the
 * unprefixed health routes (`services/agent-orchestrator/main.py:151-186`).
 * There is no `/api/v1/events` router, so all three publish call sites in
 * conversations.service.ts have always 404'd.
 *
 * The damage was not the 404, it was the reporting:
 * `approveConversation()` swallowed the failure and returned
 * `{ success: true, messageSent: true }` — a vendor message announced as sent
 * that nothing ever sent. That is exactly what locked ADR 0020 forbids.
 *
 * Against the pre-fix tree, every test in the first describe below fails.
 */

type Row = Record<string, any>;

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

function makeService(
  opts: {
    updateError?: { message: string };
    status?: string | null;
    outboundEmailType?: string | null;
  } = {},
) {
  const updates: Row[] = [];

  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        // `getConversation`'s ADR 0167 exclusion (see conversations.service.ts)
        // adds `.or()` calls when the caller's role is not passed through;
        // this fixture's rows carry no `status` at all, so they are never a
        // HOUSE_DRAFT/HOUSE_CANCELLED credit letter and the filter is a no-op
        // here regardless.
        or: () => q,
        update(row: Row) {
          updates.push({ table, row });
          // update().eq("id").eq("restaurant_id").select("id") — the row comes back
          // so the service can tell "updated" from "matched nothing".
          const chain: any = {
            eq: () => chain,
            select: async () =>
              opts.updateError
                ? { data: null, error: opts.updateError }
                : { data: [{ id: CONV }], error: null },
          };
          return chain;
        },
        maybeSingle: async () => {
          if (table === "procurement_conversations") {
            return {
              data: {
                id: CONV,
                order_id: "order-1",
                status: opts.status ?? null,
                outbound_email_type: opts.outboundEmailType ?? null,
                paused_at: new Date(Date.now() - 60_000).toISOString(),
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  };

  // The approve gates (ADR 0175 D9/D10, 2026-09-21) are stand-ins that pass:
  // this file is about what happens AFTER an approval is allowed — the
  // dispatch and its honesty — not about who may approve.
  const service = new ConversationsService(
    { supabase: client } as unknown as DatabaseService,
    { redeem: async () => ({ sealId: "seal-1" }) } as any,
    {
      assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
      witnessGrantUse: async () => undefined,
    } as any,
  );

  return { service, updates };
}

/** The approve route's actor since the seal (ADR 0175 D9, 2026-09-21). */
const ACTOR = { userId: "manager-1", challenge: "good" };

function axios404() {
  const err: any = new Error("Request failed with status code 404");
  err.response = { status: 404, data: { detail: "Not Found" } };
  return err;
}

describe("Defect B — a failed publish can never be reported as a send", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("approveConversation does NOT return messageSent:true when the publish 404s", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();

    const result = await service.approveConversation(CONV, HOUSE, {
      approvalChannel: "web",
    }, ACTOR);

    expect(result.messageSent).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be dispatched/i);
    expect(result.error).toMatch(/no message has been sent/i);
  });

  it("approveConversation does not claim a send even when the publish SUCCEEDS", async () => {
    // Publishing an event is a dispatch, not a send. Nothing in the gateway
    // sends the vendor message, so it may never assert one went out.
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} } as any);
    const { service } = makeService();

    const result = await service.approveConversation(CONV, HOUSE, {
      approvalChannel: "web",
    }, ACTOR);

    expect(result.success).toBe(true);
    expect(result.messageSent).toBe(false);
  });

  it("approveConversation still records the approval before refusing", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service, updates } = makeService();

    await service.approveConversation(CONV, HOUSE, { approvalChannel: "web" }, ACTOR);

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("procurement_conversations");
    expect(updates[0].row.manager_approval_status).toBe("approved");
  });

  it("rejectConversation reports failure when the publish 404s", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();

    const result = await service.rejectConversation(
      CONV,
      HOUSE,
      "too expensive",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be dispatched/i);
  });

  it("regenerateSummary does not report 'requested' when nothing was queued", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();

    const result: any = await service.regenerateSummary(CONV, HOUSE);

    expect(result.success).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.error).toMatch(/nothing was queued/i);
  });
});

describe("PR #476 Train 5 BLOCK — approveConversation refuses every house letter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The real route (`conversations.controller.ts`, `@Roles("owner","manager")`)
  // always passes the caller's role; so does every case here. [#436 merging
  // main ef8ecdf30, 2026-09-27: on #436 the route has no @Roles (WHO is the
  // service's gate, ADR 0175 D10) and the role follows the actor.]
  const approve = (service: any) =>
    service.approveConversation(
      CONV,
      HOUSE,
      { approvalChannel: "web" },
      ACTOR,
      "owner",
    );

  const expectRefused = (result: any, updates: Row[], error: RegExp) => {
    expect(result.success).toBe(false);
    expect(result.messageSent).toBe(false);
    expect(result.error).toMatch(error);
    // Never published, never even recorded as approved.
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  };

  it("refuses a HOUSE_DRAFT letter", async () => {
    const { service, updates } = makeService({
      status: "HOUSE_DRAFT",
      outboundEmailType: "HOUSE_LETTER",
    });
    expectRefused(await approve(service), updates, /draft/i);
  });

  it("refuses a HOUSE_CANCELLED letter", async () => {
    const { service, updates } = makeService({
      status: "HOUSE_CANCELLED",
      outboundEmailType: "HOUSE_LETTER",
    });
    expectRefused(await approve(service), updates, /discarded/i);
  });

  it("refuses a HOUSE_QUEUED letter — approving it would send it twice", async () => {
    const { service, updates } = makeService({
      status: "HOUSE_QUEUED",
      outboundEmailType: "HOUSE_LETTER",
    });
    expectRefused(await approve(service), updates, /twice/i);
  });

  it("refuses a HOUSE_FAILED letter", async () => {
    const { service, updates } = makeService({
      status: "HOUSE_FAILED",
      outboundEmailType: "HOUSE_LETTER",
    });
    expectRefused(await approve(service), updates, /Communications/);
  });

  it("refuses a SENT house letter by its type", async () => {
    const { service, updates } = makeService({
      status: "SENT",
      outboundEmailType: "HOUSE_LETTER",
    });
    expectRefused(await approve(service), updates, /Communications/);
  });

  it("refuses a HOUSE_QUEUED row even when its type column is empty", async () => {
    const { service, updates } = makeService({ status: "HOUSE_QUEUED" });
    expectRefused(await approve(service), updates, /twice/i);
  });

  it("still approves and dispatches a conversation with no status (the ordinary case)", async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} } as any);
    const { service, updates } = makeService({ status: null });

    const result = await approve(service);

    expect(result.success).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalled();
    expect(updates).toHaveLength(1);
  });

  it("still approves an AI-path draft (PENDING_APPROVAL, PRICE_INQUIRY)", async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} } as any);
    const { service, updates } = makeService({
      status: "PENDING_APPROVAL",
      outboundEmailType: "PRICE_INQUIRY",
    });

    const result = await approve(service);

    expect(result.success).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("names every LETTER_STATUS word except the shared SENT", () => {
    const src = readFileSync(
      join(__dirname, "../communications/letters/house-letters.service.ts"),
      "utf8",
    );
    const block = src.slice(
      src.indexOf("export const LETTER_STATUS"),
      src.indexOf("} as const", src.indexOf("export const LETTER_STATUS")),
    );
    const words = [...block.matchAll(/:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(words).toContain("SENT");
    expect([...HOUSE_LETTER_STATUSES].sort()).toEqual(
      words.filter((w) => w !== "SENT").sort(),
    );
  });
});

describe("Defect B — the failure is logged loudly, not as a warning", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs at error level with the outbound call and the 404", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();
    const errors: string[] = [];
    (service as any).logger = {
      log: () => undefined,
      warn: () => {
        throw new Error("a permanent 404 must not be logged at warn level");
      },
      error: (m: string) => errors.push(m),
    };

    await service.approveConversation(CONV, HOUSE, { approvalChannel: "web" }, ACTOR);

    const line = errors.find((e) => e.includes("Event publish FAILED"));
    expect(line).toBeDefined();
    expect(line).toContain("/api/v1/events/publish");
    expect(line).toContain("routing_key=conversation.approved");
    expect(line).toContain("status=404");
    expect(line).toContain("PERMANENT");
  });
});
