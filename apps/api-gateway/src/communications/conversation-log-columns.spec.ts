import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CommunicationsService } from "./communications.service";

/**
 * ADR 0065 — a conversation log must name columns that exist.
 *
 * `storeOutboundConversation` wrote `sender_email`, `recipient_email`,
 * `subject` and `message_body` to `procurement_conversations`. The table has
 * none of them; the body column is `message_text` and it is NOT NULL. Every
 * call answered 42703/PGRST204, the service logged a warning, the caller
 * pushed `success: !convoError` into a steps array nobody read, and the
 * endpoint returned "scenario_executed" regardless. Production held 27 rows on
 * 2026-09-02 and not one of them came from this method.
 *
 * The oracle here is `supabase/migrations/`, not a list typed into this file.
 * A test that asserts the payload against column names I wrote down is a test
 * that agrees with me; parsing the schema means the assertion can actually
 * disagree.
 */

const TABLE = "procurement_conversations";
const MIGRATIONS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

/**
 * Columns `supabase/migrations/` declares for one table, replayed in version
 * order: CREATE TABLE body, then ADD COLUMN / DROP COLUMN / RENAME COLUMN.
 */
function declaredColumns(table: string): Set<string> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const cols = new Set<string>();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");

    const create = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?"?${table}"?\\s*\\(`,
      "i",
    ).exec(sql);
    if (create) {
      // Walk to the matching close paren so we read this body and no other.
      let depth = 0;
      let end = -1;
      for (let i = create.index + create[0].length - 1; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) throw new Error(`unterminated CREATE TABLE ${table}`);
      const body = sql.slice(create.index + create[0].length, end);
      let paren = 0;
      let current = "";
      for (const ch of body) {
        if (ch === "(") paren++;
        else if (ch === ")") paren--;
        if (ch === "," && paren === 0) {
          addColumn(cols, current);
          current = "";
        } else {
          current += ch;
        }
      }
      addColumn(cols, current);
    }

    const alterRe = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:public\\.)?"?${table}"?([\\s\\S]*?);`,
      "gi",
    );
    for (const alter of sql.matchAll(alterRe)) {
      const clause = alter[1];
      for (const m of clause.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.add(m[1].toLowerCase());
      }
      for (const m of clause.matchAll(
        /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.delete(m[1].toLowerCase());
      }
      for (const m of clause.matchAll(
        /RENAME\s+COLUMN\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+TO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      )) {
        cols.delete(m[1].toLowerCase());
        cols.add(m[2].toLowerCase());
      }
    }
  }
  return cols;
}

function addColumn(into: Set<string>, fragment: string): void {
  const line = fragment.trim();
  if (!line) return;
  if (
    /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i.test(
      line,
    )
  )
    return;
  const name = /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?/.exec(line);
  if (name) into.add(name[1].toLowerCase());
}

/** Captures whatever gets handed to `.insert()`, and answers however told to. */
function makeService(
  outcome: { data?: any; error?: any } = { data: { id: "c-1" } },
) {
  const inserts: Array<{ table: string; payload: any }> = [];
  const supabase = {
    from: (table: string) => ({
      insert: (payload: any) => {
        inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({
              data: outcome.error ? null : (outcome.data ?? null),
              error: outcome.error ?? null,
            }),
          }),
        };
      },
    }),
  };
  const service = new CommunicationsService(
    {} as any,
    {} as any,
    { supabase } as any,
    undefined,
  );
  return { service, inserts };
}

const VALID = {
  restaurantId: "11111111-1111-1111-1111-111111111111",
  providerId: "22222222-2222-2222-2222-222222222222",
  orderId: null,
  direction: "outbound",
  channel: "email",
  senderEmail: "manager@example.com",
  recipientEmail: "vendor@example.com",
  subject: "Wine Order Inquiry: Opus One 2019 x12 - ORD-2026-TEST1",
  body: "<p>Please confirm availability.</p>",
  detected_intent: "order_inquiry",
  detected_sentiment: "professional",
  status: "sent",
};

describe("storeOutboundConversation writes columns that exist", () => {
  const declared = declaredColumns(TABLE);

  it("the migrations actually declare this table (the oracle is not empty)", () => {
    // Without this, a rotted parse would make every assertion below vacuous:
    // an empty declared set turns "no phantom column" into "no columns at all".
    expect(declared.size).toBeGreaterThanOrEqual(20);
    expect(declared.has("message_text")).toBe(true);
    expect(declared.has("email_headers")).toBe(true);
  });

  it("names no column the schema does not have", async () => {
    const { service, inserts } = makeService();
    const result = await service.storeOutboundConversation({ ...VALID });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(TABLE);

    const phantom = Object.keys(inserts[0].payload).filter(
      (k) => !declared.has(k.toLowerCase()),
    );
    expect(phantom).toEqual([]);
    expect(result.stored).toBe(true);
    expect(result.data).toEqual({ id: "c-1" });
  });

  it("names none of the four phantom columns by name", async () => {
    const { service, inserts } = makeService();
    await service.storeOutboundConversation({ ...VALID });
    const keys = Object.keys(inserts[0].payload);
    for (const gone of [
      "sender_email",
      "recipient_email",
      "subject",
      "message_body",
    ]) {
      expect(keys).not.toContain(gone);
    }
  });

  it("puts the body in message_text, which is NOT NULL", async () => {
    const { service, inserts } = makeService();
    await service.storeOutboundConversation({ ...VALID });
    expect(inserts[0].payload.message_text).toBe(VALID.body);
  });

  it("folds sender, recipient and subject into email_headers using the inbound path's shape", async () => {
    // The shape is set by rabbitmq-bridge.service.ts handleInboundEmail:
    // lowercase RFC-822 header names. Production agrees — of 27 rows, the 13
    // with headers use exactly {subject, in_reply_to, references, message_id,
    // from, gmail_thread_id}. `to` is the RFC name for the recipient.
    const { service, inserts } = makeService();
    await service.storeOutboundConversation({ ...VALID });
    expect(inserts[0].payload.email_headers).toEqual({
      from: VALID.senderEmail,
      to: VALID.recipientEmail,
      subject: VALID.subject,
    });
  });

  it("does not null a NOT NULL provider_id when the provider is unknown", async () => {
    // The old payload wrote `params.providerId || null`. provider_id is NOT
    // NULL, so an unresolved provider was a 23502 waiting behind the 42703.
    const { service, inserts } = makeService();
    const result = await service.storeOutboundConversation({
      ...VALID,
      providerId: undefined,
    });
    expect(inserts).toHaveLength(0);
    expect(result.stored).toBe(false);
    expect(result.error?.message).toContain("providerId");
  });
});

describe("a body-less conversation is refused, not faked and not 23502'd", () => {
  it.each([
    ["body", ""],
    ["restaurantId", ""],
    ["direction", ""],
    ["channel", ""],
  ])("refuses when %s is empty and says so", async (field, value) => {
    const { service, inserts } = makeService();
    const result = await service.storeOutboundConversation({
      ...VALID,
      [field]: value,
    } as any);

    // No insert is attempted at all: the DB never sees a row it would have to
    // reject, so there is no 23502 and no half-written state.
    expect(inserts).toHaveLength(0);
    expect(result.stored).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("MISSING");
    expect(result.error?.message).toContain(field);
  });

  it("stores no placeholder body (ADR 0020 / ADR 0051)", async () => {
    const { service, inserts } = makeService();
    await service.storeOutboundConversation({ ...VALID, body: "   " });
    expect(inserts).toHaveLength(0);
  });

  it("logs the refusal at error level, not warn", async () => {
    const { service } = makeService();
    const error = jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn((service as any).logger, "warn")
      .mockImplementation(() => undefined);

    await service.storeOutboundConversation({ ...VALID, body: "" });

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });
});

describe("a failed write never reads as success", () => {
  it("reports stored:false and logs at error level when the insert fails", async () => {
    const { service } = makeService({
      error: { message: 'column "x" does not exist', code: "42703" },
    });
    const error = jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);

    const result = await service.storeOutboundConversation({ ...VALID });

    expect(result.stored).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("42703");
    // The log has to carry enough to identify the failure without a repro: the
    // table, the PostgREST code, and the keys that were attempted.
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain(TABLE);
    expect(logged).toContain("42703");
    expect(logged).toContain("message_text");
    error.mockRestore();
  });

  it("reports stored:false when the client throws", async () => {
    const { service } = makeService();
    (service as any).databaseService.supabase.from = () => {
      throw new Error("connection reset");
    };
    const error = jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);

    const result = await service.storeOutboundConversation({ ...VALID });

    expect(result.stored).toBe(false);
    expect(result.error?.message).toContain("connection reset");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
