import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScheduledTasksService } from "./scheduled-tasks.service";

/**
 * ADR 0081 — the Vendor Communication Summary reads columns that exist, and a
 * failed read does not pass for a quiet week.
 *
 * `getRecentConversationSummaries` selected `message_body, subject` from
 * `procurement_conversations`. The table has neither: the body is
 * `message_text` (`text NOT NULL`) and the subject lives inside
 * `email_headers` (`jsonb`). Verified against production 2026-09-02, and they
 * are the SAME TWO NAMES ADR 0065 removed from the write side hours earlier —
 * `check_order_capture_contract.py` Contract E parses `.insert|update|upsert`
 * payloads and nothing in the tree parses a select list, so the read side had
 * no guard to catch it.
 *
 * PostgREST answered 42703 every Monday. The next line read that as "no vendor
 * conversations" and returned `[]`, the template drops the section on `[]`, so
 * the Vendor Communication Summary has never appeared in a manager's weekly
 * email — over 27 real conversation rows. Class O in
 * [[absence-reported-as-health]]: nothing corrupted, a section simply never
 * there, and nothing said so.
 */

const SOURCE = readFileSync(join(__dirname, "scheduled-tasks.service.ts"), "utf8");

/** Comments quote the removed names; a source check must not read its own prose. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join("\n");

/**
 * Every column `procurement_conversations` actually has.
 *
 * Transcribed from `20260805000000_baseline_from_production.sql`, confirmed
 * against production's `information_schema` on 2026-09-02 (36 columns).
 * `message_body` and `subject` are absent from both.
 */
const CONVERSATION_COLUMNS = new Set([
  "id",
  "order_id",
  "restaurant_id",
  "provider_id",
  "direction",
  "channel",
  "message_text",
  "ai_generated",
  "llm_model",
  "detected_intent",
  "detected_sentiment",
  "important_dates_detected",
  "sent_at",
  "received_at",
  "delivery_status",
  "created_at",
  "thread_id",
  "message_id",
  "parent_message_id",
  "email_headers",
  "confidence_score",
  "conversation_summary",
  "summary_updated_at",
  "content",
  "gmail_thread_id",
  "gmail_message_id",
  "conversation_context",
  "outbound_email_type",
  "round_count",
  "constraint_flags",
  "disclaimer_appended",
  "rolling_summary",
  "status",
  "scheduled_send_at",
  "thread_key",
  "order_number_snapshot",
]);

type Opts = {
  conversations?: any[];
  /** PostgREST error object, e.g. the 42703 this defect produced. */
  conversationsError?: { message: string; code?: string };
  providers?: any[];
};

/** Records the select list, and refuses columns the table does not have —
 *  which is what PostgREST does, and what a bag-of-rows stub cannot do. */
function makeService(opts: Opts) {
  const selects: Record<string, string> = {};
  const client = {
    from: (table: string) => {
      const builder: any = {};
      for (const m of ["eq", "gte", "lte", "order", "limit", "in"]) {
        builder[m] = () => builder;
      }
      builder.select = (sel: string) => {
        selects[table] = sel;
        return builder;
      };
      builder.then = (resolve: any, reject: any) => {
        if (table === "procurement_conversations") {
          const named = (selects[table] ?? "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          const missing = named.filter((c) => !CONVERSATION_COLUMNS.has(c));
          if (missing.length > 0) {
            // Exactly what production answers.
            return Promise.resolve({
              data: null,
              error: {
                code: "42703",
                message: `column procurement_conversations.${missing[0]} does not exist`,
              },
            }).then(resolve, reject);
          }
          if (opts.conversationsError) {
            return Promise.resolve({
              data: null,
              error: opts.conversationsError,
            }).then(resolve, reject);
          }
          return Promise.resolve({
            data: opts.conversations ?? [],
            error: null,
          }).then(resolve, reject);
        }
        if (table === "providers") {
          return Promise.resolve({
            data: opts.providers ?? [],
            error: null,
          }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      };
      return builder;
    },
  };

  const service = new ScheduledTasksService(
    { get: () => undefined } as any,
    {} as any,
    { getClient: () => client, supabase: client } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, selects };
}

const summaries = (s: ScheduledTasksService) =>
  (s as any).getRecentConversationSummaries("rest-1") as Promise<any[]>;

describe("weekly report — the Vendor Communication Summary can read its table", () => {
  it("names no column procurement_conversations does not have", async () => {
    const { service, selects } = makeService({ conversations: [] });
    await summaries(service);

    const named = selects["procurement_conversations"]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    expect(named.length).toBeGreaterThan(0); // the select must exist to be judged
    expect(named.filter((c) => !CONVERSATION_COLUMNS.has(c))).toEqual([]);
    expect(named).toContain("message_text");
    expect(named).toContain("email_headers");
  });

  it("has removed both phantom names from the source", () => {
    expect(CODE).not.toMatch(/\bmessage_body\b/);
    // `subject` still appears — as `email_headers.subject`, which is a jsonb
    // key, not a column. What must not appear is a bare `subject` in a select.
    expect(CODE).not.toMatch(/select\([^)]*\bsubject\b[^)]*\)/);
  });

  it("produces a summary for each provider, subject read from email_headers", async () => {
    const { service } = makeService({
      conversations: [
        {
          id: "c1",
          provider_id: "p1",
          direction: "inbound",
          detected_intent: "price_quote",
          delivery_status: "delivered",
          message_text: "We can do $42 a bottle.",
          email_headers: { subject: "Re: Malbec pricing", from: "v@x.com" },
          created_at: "2026-09-01T10:00:00Z",
        },
        {
          id: "c2",
          provider_id: "p1",
          direction: "outbound",
          detected_intent: "price_inquiry",
          delivery_status: "sent",
          message_text: "What is your best price?",
          email_headers: {},
          created_at: "2026-08-31T10:00:00Z",
        },
      ],
      providers: [{ id: "p1", name: "Premium Wine" }],
    });

    const out = await summaries(service);

    expect(out).toHaveLength(1);
    expect(out[0].provider).toBe("Premium Wine");
    expect(out[0].messageCount).toBe(2);
    expect(out[0].summary).toContain("Re: Malbec pricing");
    expect(out[0].summary).toContain("price_quote");
  });

  it("falls back to a message_text preview when a row has no subject", async () => {
    // Measured: 14 of production's 27 rows carry no `email_headers.subject`,
    // so this is the common case, not the edge. Empty quotes would be worse
    // than a preview.
    const { service } = makeService({
      conversations: [
        {
          id: "c1",
          provider_id: "p1",
          detected_intent: "general",
          delivery_status: "sent",
          message_text:
            "Following up on the order we discussed last week regarding the Malbec allocation",
          email_headers: {},
          created_at: "2026-09-01T10:00:00Z",
        },
      ],
      providers: [{ id: "p1", name: "Premium Wine" }],
    });

    const out = await summaries(service);
    expect(out[0].summary).toContain("Following up on the order");
    expect(out[0].summary).toContain("…");
    expect(out[0].summary).not.toContain('""');
  });

  it("says a failed read is a failed read, not an empty week", async () => {
    // The line that hid this for as long as it hid: `if (error || !rows ||
    // rows.length === 0) return []` served two facts with one branch, and only
    // one of them is a fact about the restaurant.
    const { service } = makeService({
      conversationsError: { code: "42703", message: "column ... does not exist" },
    });
    const errors: string[] = [];
    jest
      .spyOn((service as any).logger, "error")
      .mockImplementation((m: any) => void errors.push(String(m)));
    jest.spyOn((service as any).logger, "log").mockImplementation(() => {});

    const out = await summaries(service);

    expect(out).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("UNREADABLE");
    expect(errors[0]).toContain("42703");
    expect(errors[0]).toMatch(/does NOT\s+mean there were no conversations/);
  });

  it("does not log an error when the week is genuinely quiet", async () => {
    const { service } = makeService({ conversations: [] });
    const errors: string[] = [];
    jest
      .spyOn((service as any).logger, "error")
      .mockImplementation((m: any) => void errors.push(String(m)));
    jest.spyOn((service as any).logger, "log").mockImplementation(() => {});

    expect(await summaries(service)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("still returns the rest of the weekly report when this section fails", async () => {
    // A failure here must not cost the manager the whole email.
    const { service } = makeService({
      conversationsError: { code: "42703", message: "boom" },
    });
    jest.spyOn((service as any).logger, "error").mockImplementation(() => {});
    jest.spyOn((service as any).logger, "log").mockImplementation(() => {});
    jest.spyOn((service as any).logger, "warn").mockImplementation(() => {});

    const db = (service as any).databaseService;
    db.getRestaurantInventory = async () => [
      { stock_live: 4, last_purchase_price: 10 },
    ];
    db.getLowStockItems = async () => [];

    const report = await (service as any).getWeeklyReportData("rest-1");
    expect(report.totalBottles).toBe(4);
    expect(report.conversationSummaries).toEqual([]);
  });
});
