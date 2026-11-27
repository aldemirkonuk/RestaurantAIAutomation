import { createHmac } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { DatabaseService } from "../../database/database.service";
import { RawMailRetentionService } from "./raw-mail-retention.service";

/**
 * #2159's revoke-by-provenance against a REAL Postgres through a REAL PostgREST
 * (DD-r108-5, r109 mail-fix). The sibling spec's in-memory table applies
 * `email_headers->>answers` itself, so it cannot show what PostgREST does with
 * that path in `.in()` and `.is()`. Here the service runs unchanged on the
 * production supabase-js client; only the URL is local.
 *
 * Runs only when MAIL_REAL_PGREST_URL and MAIL_REAL_PGREST_JWT_SECRET are set,
 * and is SKIPPED in CI (no database there). To run it:
 *   1. pgtest.sh lane <this worktree> r109rev   (builds r109rev_fix from the migrations)
 *   2. GRANT USAGE ON SCHEMA public, ALL ON ALL TABLES/SEQUENCES TO service_role
 *      (what Supabase grants by default; the bare build does not)
 *   3. docker run postgrest:v14.10 against r109rev_fix with PGRST_JWT_SECRET
 *   4. MAIL_REAL_PGREST_URL=http://127.0.0.1:<port> MAIL_REAL_PGREST_JWT_SECRET=... jest <this file>
 * Synthetic rows only; every row is removed with its house (ON DELETE CASCADE).
 *
 * The reply rows are written in the shapes their writers write today:
 * house-letters.service.ts (since 0f9e98874) stamps `answers` (the answered
 * row's id) AND `in_reply_to` (its Message-ID, bracketed); the relay and the
 * inbound responder stamp `in_reply_to` only. #2159 changed the reader, not the
 * writers, so a row written before it has one of these shapes and is reached.
 */

const URL = process.env.MAIL_REAL_PGREST_URL;
const SECRET = process.env.MAIL_REAL_PGREST_JWT_SECRET;
const run = URL && SECRET ? describe : describe.skip;

const b64 = (v: object | Buffer) =>
  (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");
function serviceKey(secret: string): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "service_role", iat: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}

const id = (n: number) => `b1090000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HA = id(1);
const HB = id(2);
const USER = id(3);
const USER_B = id(9);
const PA = id(4);
const PB = id(5);
const GW = id(6); // house A's wide reading: the grant revoked
const GV = id(7); // house A's vendor-only reading
const GB = id(8); // house B's wide reading
const MSG = "<g1@example.test>"; // the SAME Message-ID in both houses

const C = {
  guestIn: id(101),
  teamIn: id(102),
  vendorIn: id(103),
  vendorOld: id(104),
  guestReply: id(111),
  teamReplyByHeader: id(112),
  guestQueued: id(113),
  vendorSentCopy: id(114),
  mislabelled: id(115),
  unlinked: id(116),
  guestInB: id(201),
  replyB: id(202),
  forgedB: id(203),
};
const NAME = Object.fromEntries(Object.entries(C).map(([k, v]) => [v, k]));

run("revoke by provenance on a real Postgres (#2159, DD-r108-5)", () => {
  const supabase = createClient(URL ?? "http://unset", serviceKey(SECRET ?? "unset"), {
    auth: { persistSession: false, autoRefreshToken: false },
    // PostgREST alone serves at the root; the hosted gateway serves it at /rest/v1.
    global: { fetch: (u: any, init?: any) => fetch(String(u).replace("/rest/v1", ""), init) },
  });
  const db = { supabase, client: supabase } as unknown as DatabaseService;
  const must = async (p: PromiseLike<{ error: { message: string } | null }>, what: string) => {
    const { error } = await p;
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  const letter = (over: Record<string, unknown>) => ({
    channel: "email",
    message_text: "synthetic",
    email_headers: {},
    ...over,
  });

  async function seed(withVendorOnly: boolean) {
    await must(supabase.from("restaurants").delete().in("id", [HA, HB]), "clear houses");
    await must(supabase.from("users").delete().in("user_id", [USER, USER_B]), "clear users");
    await must(supabase.from("restaurants").insert([{ id: HA, name: "r109 House A", slug: "r109-house-a" }, { id: HB, name: "r109 House B", slug: "r109-house-b" }]), "houses");
    await must(
      supabase.from("users").insert([
        { user_id: USER, email: "r109-owner-a@example.test", name: "Owner A" },
        { user_id: USER_B, email: "r109-owner-b@example.test", name: "Owner B" },
      ]),
      "users",
    );
    await must(
      supabase.from("providers").insert([
        { id: PA, restaurant_id: HA, name: "Vendor A", primary_contact: {} },
        { id: PB, restaurant_id: HB, name: "Vendor B", primary_contact: {} },
      ]),
      "vendors",
    );
    const grant = (gid: string, house: string, integration: string) => ({
      id: gid, restaurant_id: house, user_id: house === HA ? USER : USER_B, provider: "google", integration_id: integration,
    });
    await must(
      supabase.from("integration_oauth_connections").insert([
        grant(GW, HA, "gmail_read_all"),
        grant(GB, HB, "gmail_read_all"),
        ...(withVendorOnly ? [grant(GV, HA, "gmail_read")] : []),
      ]),
      "grants",
    );
    const inbound = (cid: string, house: string, kind: string, grantId: string | null, messageId: string, provider?: string) =>
      letter({ id: cid, restaurant_id: house, kind, direction: "inbound", mirrored_by_grant_id: grantId, message_id: messageId, ...(provider ? { provider_id: provider } : {}) });
    const out = (cid: string, house: string, kind: string, headers: Record<string, string>, status = "SENT", provider?: string) =>
      letter({ id: cid, restaurant_id: house, kind, direction: "outbound", status, email_headers: headers, ...(provider ? { provider_id: provider } : {}) });
    await must(
      supabase.from("procurement_conversations").insert([
        inbound(C.guestIn, HA, "guest", GW, MSG),
        inbound(C.teamIn, HA, "team", GW, "<t1@example.test>"),
        inbound(C.vendorIn, HA, "vendor", GW, "<v1@example.test>", PA),
        inbound(C.vendorOld, HA, "vendor", null, "<v0@example.test>", PA),
        inbound(C.guestInB, HB, "guest", GB, MSG),
      ]),
      "letters read",
    );
    await must(
      supabase.from("procurement_conversations").insert([
        // house-letters.service.ts shape: answers + in_reply_to.
        out(C.guestReply, HA, "guest", { answers: C.guestIn, in_reply_to: MSG, references: MSG }),
        // relay / inbound-responder shape: in_reply_to only.
        out(C.teamReplyByHeader, HA, "team", { in_reply_to: "<t1@example.test>" }),
        out(C.guestQueued, HA, "guest", { answers: C.guestIn }, "HOUSE_QUEUED"),
        // the house's sent copy of a reply to a vendor letter the wide grant read
        out(C.vendorSentCopy, HA, "vendor", { answers: C.vendorIn, in_reply_to: "<v1@example.test>" }, "SENT", PA),
        // a vendor thread a mislabel filed as guest, answering a letter no grant read
        out(C.mislabelled, HA, "guest", { answers: C.vendorOld }),
        out(C.unlinked, HA, "guest", {}),
        // house B: the same Message-ID, and a row naming house A's letter id
        out(C.replyB, HB, "guest", { in_reply_to: MSG }),
        out(C.forgedB, HB, "guest", { answers: C.guestIn }),
      ]),
      "replies",
    );
  }

  async function state(): Promise<Record<string, { raw: boolean }>> {
    const { data, error } = await supabase
      .from("procurement_conversations")
      .select("id, raw_deleted_at")
      .in("restaurant_id", [HA, HB]);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map((r: any) => [NAME[r.id], { raw: r.raw_deleted_at === null }]));
  }
  const revoke = () =>
    new RawMailRetentionService(db).sweepForRevokedGrant({
      connectionId: GW,
      restaurantId: HA,
      ownerUserId: null,
      integrationId: "gmail_read_all",
    });

  afterAll(async () => {
    await supabase.from("restaurants").delete().in("id", [HA, HB]);
    await supabase.from("users").delete().in("user_id", [USER, USER_B]);
  });

  it("deletes the replies to the letters the grant read, by id and by Message-ID, whatever their status", async () => {
    await seed(false);
    const r = await revoke();
    const s = await state();
    for (const gone of ["guestIn", "teamIn", "guestReply", "teamReplyByHeader", "guestQueued"]) {
      expect([gone, s[gone]]).toEqual([gone, undefined]);
    }
    expect(r.error ?? "").not.toMatch(/could NOT be read/);
  });

  it("never deletes a vendor-filed row: the sent copy and the vendor letter stay as tombstones", async () => {
    await seed(false);
    await revoke();
    const s = await state();
    expect(s.vendorIn).toEqual({ raw: false });
    expect(s.vendorSentCopy).toEqual({ raw: false });
    expect(s.vendorOld).toEqual({ raw: true });
  });

  it("with the vendor-only reading still live, the vendor sent copy keeps its raw mail", async () => {
    await seed(true);
    await revoke();
    const s = await state();
    expect(s.vendorSentCopy).toEqual({ raw: true });
    expect(s.vendorIn).toEqual({ raw: true });
    expect(s.guestReply).toBeUndefined();
  });

  it("keeps a mislabelled vendor thread and an unlinked reply, and says the unlinked one was kept", async () => {
    await seed(false);
    const r = await revoke();
    const s = await state();
    expect(s.mislabelled).toEqual({ raw: true });
    expect(s.unlinked).toEqual({ raw: true });
    expect(r.says).toMatch(/1 sent reply to a team member or a guest name no letter they answer, so it was kept/);
  });

  it("leaves another house untouched, though it shares the Message-ID and names house A's letter id", async () => {
    await seed(false);
    await revoke();
    const s = await state();
    expect([s.guestInB, s.replyB, s.forgedB]).toEqual([{ raw: true }, { raw: true }, { raw: true }]);
  });
});
