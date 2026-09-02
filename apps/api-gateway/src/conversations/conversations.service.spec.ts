import axios from "axios";
import { ConversationsService } from "./conversations.service";
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

function makeService(opts: { updateError?: { message: string } } = {}) {
  const updates: Row[] = [];

  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        update(row: Row) {
          updates.push({ table, row });
          return { eq: async () => ({ error: opts.updateError ?? null }) };
        },
        single: async () => {
          if (table === "procurement_conversations") {
            return {
              data: {
                id: "conv-1",
                order_id: "order-1",
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

  const service = new ConversationsService({
    supabase: client,
  } as unknown as DatabaseService);

  return { service, updates };
}

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

    const result = await service.approveConversation("conv-1", {
      approvalChannel: "web",
    });

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

    const result = await service.approveConversation("conv-1", {
      approvalChannel: "web",
    });

    expect(result.success).toBe(true);
    expect(result.messageSent).toBe(false);
  });

  it("approveConversation still records the approval before refusing", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service, updates } = makeService();

    await service.approveConversation("conv-1", { approvalChannel: "web" });

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("procurement_conversations");
    expect(updates[0].row.manager_approval_status).toBe("approved");
  });

  it("rejectConversation reports failure when the publish 404s", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();

    const result = await service.rejectConversation("conv-1", "too expensive");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be dispatched/i);
  });

  it("regenerateSummary does not report 'requested' when nothing was queued", async () => {
    mockedAxios.post.mockRejectedValue(axios404());
    const { service } = makeService();

    const result: any = await service.regenerateSummary("conv-1");

    expect(result.success).toBe(false);
    expect(result.message).toBeUndefined();
    expect(result.error).toMatch(/nothing was queued/i);
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

    await service.approveConversation("conv-1", { approvalChannel: "web" });

    const line = errors.find((e) => e.includes("Event publish FAILED"));
    expect(line).toBeDefined();
    expect(line).toContain("/api/v1/events/publish");
    expect(line).toContain("routing_key=conversation.approved");
    expect(line).toContain("status=404");
    expect(line).toContain("PERMANENT");
  });
});
