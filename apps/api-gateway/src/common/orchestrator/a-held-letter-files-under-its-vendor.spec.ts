/**
 * r35 mail, gap 9: a held letter can reach its vendor.
 *
 * A letter the receiving server could not confirm came from its From
 * (`held_reason = sender_unconfirmed`) was held in "Who is writing" with
 * "Put away" as its only act. An owner or a manager can now say it is the
 * vendor's: `ProspectsService.fileHeldLetter` writes it as that vendor's
 * inbound letter, with its files, and marks the held row `filed`. The list
 * names that vendor beforehand (`a-held-letter-names-its-vendor.spec.ts`).
 *
 * The store (`communications/testing/held-letter-store`) keeps rows the way
 * PostgREST does, so a test reads what the tables hold afterwards.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  HELD,
  HOUSE,
  OTHER,
  USER,
  VENDOR,
  heldRow,
  store,
  svc,
  vendorRow,
  world,
} from "../../communications/testing/held-letter-store";

describe("fileHeldLetter: a held letter is filed under the vendor a person vouches for", () => {
  it("writes it as the vendor's inbound letter and marks the held row filed", async () => {
    const t = world();
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r).toEqual({
      filed: true,
      conversationId: expect.any(String),
      threadKey: "gm:gm-thread-1",
      providerId: VENDOR,
      providerName: "Quiet Dairy",
      alreadyStored: false,
    });
    expect(t.procurement_conversations).toHaveLength(1);
    const c = t.procurement_conversations[0];
    expect(c).toMatchObject({
      restaurant_id: HOUSE,
      provider_id: VENDOR,
      order_id: null,
      direction: "inbound",
      channel: "email",
      message_text: "Subject: Invoice 2211\n\nPlease find the invoice for last week attached.",
      received_at: "2026-11-12T09:30:00.000Z",
      gmail_message_id: "gm-msg-1",
      gmail_thread_id: "gm-thread-1",
      ai_generated: false,
    });
    expect(c.email_headers).toMatchObject({
      from: "orders@dairy.example",
      subject: "Invoice 2211",
      filed_from_held: {
        prospect_id: HELD,
        held_reason: "sender_unconfirmed",
        by_user_id: USER,
        words_cut: false,
      },
    });
    expect(t.email_prospects[0]).toMatchObject({ status: "filed", promoted_provider_id: VENDOR });
  });

  it("files the letter's files with it, under the vendor and no order", async () => {
    const t = world();
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.conversation_attachments).toEqual([
      expect.objectContaining({
        conversation_id: r.conversationId,
        restaurant_id: HOUSE,
        provider_id: VENDOR,
        order_id: null,
        filename: "invoice-2211.pdf",
        mime_type: "application/pdf",
        size_bytes: 1234,
        storage_path: "prospects/dairy.example/abc-invoice-2211.pdf",
        sha256: "abc",
      }),
    ]);
  });

  it("writes no files row for a letter that carried none", async () => {
    const t = world({ held: [heldRow({ attachments: [] })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.conversation_attachments).toEqual([]);
    expect(t.procurement_conversations).toHaveLength(1);
  });

  it("files the snippet as the letter's words when the held row kept no body (walk r37 w3)", async () => {
    const t = world({ held: [heldRow({ body_preview: null })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.procurement_conversations[0].message_text).toBe(
      "Subject: Invoice 2211\n\nPlease find the invoice",
    );
  });

  it("files an empty kept body as the snippet too, and no words when it has neither", async () => {
    const t = world({ held: [heldRow({ body_preview: "" })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.procurement_conversations[0].message_text).toBe(
      "Subject: Invoice 2211\n\nPlease find the invoice",
    );
    const u = world({ held: [heldRow({ body_preview: null, snippet: null })] });
    await svc(store(u)).fileHeldLetter(HOUSE, HELD, USER);
    expect(u.procurement_conversations[0].message_text).toBe("Subject: Invoice 2211\n\n");
  });

  it("says the kept words were cut when the held row kept 4,000 characters", async () => {
    const t = world({ held: [heldRow({ body_preview: "x".repeat(4000) })] });
    await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(t.procurement_conversations[0].email_headers.filed_from_held.words_cut).toBe(true);
  });

  it("files under the vendor whose contact row lists the address (the bridge's own rule)", async () => {
    const t = world({
      providers: [vendorRow({ contact_email: "sales@dairy.example" })],
      contacts: [{ provider_id: VENDOR, email: "orders@dairy.example" }],
    });
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r.providerId).toBe(VENDOR);
  });

  it("answers the vendor's stored letter when the same letter is already theirs", async () => {
    const t = world({
      conversations: [
        { id: "already", restaurant_id: HOUSE, provider_id: VENDOR, gmail_message_id: "gm-msg-1", thread_key: "gm:gm-thread-1" },
      ],
    });
    const r = await svc(store(t)).fileHeldLetter(HOUSE, HELD, USER);
    expect(r).toMatchObject({ conversationId: "already", alreadyStored: true });
    expect(t.procurement_conversations).toHaveLength(1);
    expect(t.conversation_attachments).toEqual([]);
    expect(t.email_prospects[0].status).toBe("filed");
  });
});

describe("fileHeldLetter: what it refuses, and that a refusal leaves the letter held", () => {
  const refused = async (t: ReturnType<typeof world>, err: any, words: RegExp, db = store(t)) => {
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(err);
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(words);
    expect(t.procurement_conversations.filter((c) => c.id !== "already")).toEqual([]);
    expect(t.conversation_attachments).toEqual([]);
  };

  it("400 for an id that is not one", async () => {
    const t = world();
    await expect(svc(store(t)).fileHeldLetter(HOUSE, "nope", USER)).rejects.toThrow(BadRequestException);
  });

  it("404 for another house's held letter", async () => {
    const t = world({ held: [heldRow({ restaurant_id: OTHER })] });
    await refused(t, NotFoundException, /not in this house's mail/);
  });

  it("409 for a letter whose sender could not be read", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable", sender_email: null })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a letter whose sender could not be read, even when an address was kept", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable" })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a stranger's letter that was not held", async () => {
    const t = world({ held: [heldRow({ held_reason: null })] });
    await refused(t, ConflictException, /could not be confirmed can be filed/);
  });

  it("409 for a letter already filed", async () => {
    const t = world({ held: [heldRow({ status: "filed" })] });
    await refused(t, ConflictException, /already filed/);
  });

  it("409 for a letter that was put away", async () => {
    const t = world({ held: [heldRow({ status: "dismissed" })] });
    await refused(t, ConflictException, /put away/);
    expect(t.email_prospects[0].status).toBe("dismissed");
  });

  it("409 when no vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ contact_email: "sales@dairy.example" })] });
    await refused(t, ConflictException, /No single vendor in your book lists orders@dairy\.example/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new" });
    expect(t.email_prospects[0].promoted_provider_id).toBeUndefined();
  });

  it("409 when only a removed vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ deleted_at: "2026-11-01T00:00:00Z" })] });
    await refused(t, ConflictException, /No single vendor/);
  });

  it("409 when two vendors list the address", async () => {
    const t = world({ providers: [vendorRow(), vendorRow({ id: "other-vendor", name: "Other" })] });
    await refused(t, ConflictException, /No single vendor/);
  });

  it("503 when the held letter cannot be read", async () => {
    const t = world();
    await expect(
      svc(store(t, ["email_prospects:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(t.email_prospects[0].status).toBe("new");
  });

  it("503 when the vendor book cannot be read, and the letter stays held", async () => {
    const t = world();
    await expect(
      svc(store(t, ["providers:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/vendor book could not be read/);
    expect(t.email_prospects[0].status).toBe("new");
    expect(t.procurement_conversations).toEqual([]);
  });

  it("409 when the row was put away between the read and the claim; nothing is written", async () => {
    const t = world();
    const db = store(t, [], {
      "email_prospects:update": () => {
        if (t.email_prospects[0].status === "new") t.email_prospects[0].status = "dismissed";
      },
    });
    await expect(svc(db).fileHeldLetter(HOUSE, HELD, USER)).rejects.toThrow(/a moment ago/);
    expect(t.procurement_conversations).toEqual([]);
    expect(t.email_prospects[0].status).toBe("dismissed");
  });

  it("503 when the claim cannot be written", async () => {
    const t = world();
    await expect(
      svc(store(t, ["email_prospects:update"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/could not be marked/);
    expect(t.procurement_conversations).toEqual([]);
  });

  it("503 when the vendor's mail cannot be read for a second copy; the row is held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["procurement_conversations:select"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/vendor's mail could not be read/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
    expect(t.procurement_conversations).toEqual([]);
  });

  it("503 when the letter cannot be stored; the row is held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["procurement_conversations:insert"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/it is still held/);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
  });

  it("503 when its files cannot be filed; the letter is taken back out and the row held again", async () => {
    const t = world();
    await expect(
      svc(store(t, ["conversation_attachments:insert"])).fileHeldLetter(HOUSE, HELD, USER),
    ).rejects.toThrow(/files could not be filed just now; it is still held/);
    expect(t.procurement_conversations).toEqual([]);
    expect(t.email_prospects[0]).toMatchObject({ status: "new", promoted_provider_id: null });
  });

  it("says so when the half-filed letter cannot be taken back out", async () => {
    const t = world();
    await expect(
      svc(store(t, ["conversation_attachments:insert", "procurement_conversations:delete"])).fileHeldLetter(
        HOUSE,
        HELD,
        USER,
      ),
    ).rejects.toThrow(/could not be undone/);
  });
});
