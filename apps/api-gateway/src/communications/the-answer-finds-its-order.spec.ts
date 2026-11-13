/**
 * r28 mail audit, gap 2: a vendor's answer that comes to the house's Mudavym
 * address is filed on the order it answers, not on a guessed one.
 *
 * Order letters set Reply-To to that address. A letter that arrives there
 * carries no Gmail thread, so the bridge's thread match (step 2) never ran
 * for it and its fallback (2b) took the vendor's newest open order: with two
 * open orders, a price answer to order A was filed on order B. Step 2a now
 * reads the In-Reply-To and References of the answer against the
 * Message-IDs the house stored on its own letters.
 */
import {
  answeredMessageIds,
  bareMessageId,
  storedMessageIdShapes,
} from "../common/orchestrator/answered-message-ids";
import { bridge, inbound, Row } from "./testing/mail-store";

const VENDOR = "sales@bigdist.com";
const PROVIDER = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: VENDOR,
  deleted_at: null,
};
// The fallback's pick comes first in the table: the in-memory store ignores
// order(), so the first open order is the one 2b takes.
const ORDER_B = {
  id: "order-B",
  provider_id: "prov-A",
  restaurant_id: "house-A",
  status: "SENT",
};
const ORDER_A = { ...ORDER_B, id: "order-A" };
const LETTER_A: Row = {
  id: "letter-A",
  restaurant_id: "house-A",
  provider_id: "prov-A",
  order_id: "order-A",
  direction: "outbound",
  message_id: "<ord-a@mail.gmail.com>",
  email_headers: { subject: "Order PO-1" },
  thread_id: "t-A",
};
const house = (conversations: Row[]): Record<string, Row[]> => ({
  restaurants: [{ id: "house-A" }],
  providers: [PROVIDER],
  procurement_orders: [ORDER_B, ORDER_A],
  procurement_conversations: conversations,
});

async function answer(
  conversations: Row[],
  headers: Record<string, string>,
  failing: string[] = [],
) {
  const { svc, inserts } = bridge(house(conversations), failing);
  const attached: unknown[] = [];
  svc.persistAttachments = async (...a: unknown[]) => void attached.push(a[1]);
  await svc.handleInboundEmail(
    inbound({
      restaurant_id: "house-A",
      from: `BigDist <${VENDOR}>`,
      subject: "Re: Order PO-1",
      body: "Price is 12.40 now",
      message_id_header: "<vendor-1@bigdist.com>",
      ...headers,
    }),
  );
  const row = inserts.find(
    (i) => i.table === "procurement_conversations",
  )?.row;
  return { row, attached };
}

describe("an answer through the Mudavym address finds the order it answers", () => {
  it("In-Reply-To names order A's letter: filed on A, not the newest open order B", async () => {
    const { row, attached } = await answer([LETTER_A], {
      in_reply_to: "<ord-a@mail.gmail.com>",
      references: "<ord-a@mail.gmail.com>",
    });
    expect(row.order_id).toBe("order-A");
    expect(row.thread_id).toBe("t-A");
    expect(row.confidence_score).toBe(1.0);
    expect(row.email_headers.order_match).toBeUndefined();
    // The house sent that letter first, so the paper may take its order.
    expect(attached).toEqual(["order-A"]);
  });

  it("a letter stored without angle brackets is found too", async () => {
    const { row } = await answer(
      [{ ...LETTER_A, message_id: "ord-a@mail.gmail.com" }],
      { in_reply_to: "<ord-a@mail.gmail.com>" },
    );
    expect(row.order_id).toBe("order-A");
  });

  it("References alone, past an id the house never stored", async () => {
    const { row } = await answer([LETTER_A], {
      in_reply_to: "<someone-else@elsewhere.example>",
      references: "<ord-a@mail.gmail.com> <someone-else@elsewhere.example>",
    });
    expect(row.order_id).toBe("order-A");
  });

  it("the nearest answered letter with an order wins", async () => {
    const letterB: Row = {
      ...LETTER_A,
      id: "letter-B",
      order_id: "order-B",
      message_id: "<ord-b@mail.gmail.com>",
    };
    const { row } = await answer([LETTER_A, letterB], {
      in_reply_to: "<ord-b@mail.gmail.com>",
      references: "<ord-a@mail.gmail.com> <ord-b@mail.gmail.com>",
    });
    expect(row.order_id).toBe("order-B");
    const older = await answer([LETTER_A, letterB], {
      in_reply_to: "<ord-a@mail.gmail.com>",
      references: "<ord-b@mail.gmail.com> <ord-a@mail.gmail.com>",
    });
    expect(older.row.order_id).toBe("order-A");
  });

  it("an answered letter with no order is passed over for an older one that has one", async () => {
    const note: Row = {
      ...LETTER_A,
      id: "note",
      order_id: null,
      message_id: "<note@mail.gmail.com>",
    };
    const { row } = await answer([LETTER_A, note], {
      in_reply_to: "<note@mail.gmail.com>",
      references: "<ord-a@mail.gmail.com> <note@mail.gmail.com>",
    });
    expect(row.order_id).toBe("order-A");
  });

  it("a letter of another house with that Message-ID is not read: the old fallback runs", async () => {
    const { row } = await answer(
      [{ ...LETTER_A, restaurant_id: "house-B" }],
      { in_reply_to: "<ord-a@mail.gmail.com>" },
    );
    expect(row.order_id).toBe("order-B");
  });

  it("an answer to one of the house's replies takes its order, but the paper does not", async () => {
    const reply: Row = {
      ...LETTER_A,
      id: "reply",
      message_id: "<reply@mail.gmail.com>",
      email_headers: { in_reply_to: "<earlier@bigdist.com>" },
    };
    const { row, attached } = await answer([reply], {
      in_reply_to: "<reply@mail.gmail.com>",
    });
    expect(row.order_id).toBe("order-A");
    expect(attached).toEqual([null]);
  });

  it("nothing answered is stored: the old fallback still runs", async () => {
    const { row, attached } = await answer([], {
      in_reply_to: "<unknown@mail.gmail.com>",
    });
    expect(row.order_id).toBe("order-B");
    expect(attached).toEqual([null]);
  });

  it("a failed read is not 'nothing answered': no guess, and the row says so", async () => {
    const { row } = await answer(
      [LETTER_A],
      { in_reply_to: "<ord-a@mail.gmail.com>" },
      ["procurement_conversations"],
    );
    expect(row.order_id).toBeNull();
    expect(row.email_headers.order_match).toBe("answer_read_failed");
  });
});

describe("answeredMessageIds", () => {
  it("In-Reply-To first, then References newest first, no repeats", () => {
    expect(answeredMessageIds("<b@x>", "<a@x> <b@x> <c@x>")).toEqual([
      "b@x",
      "c@x",
      "a@x",
    ]);
  });

  it("a bare field is split on blanks", () => {
    expect(answeredMessageIds("b@x", "a@x  c@x")).toEqual(["b@x", "c@x", "a@x"]);
  });

  it("skips what cannot be a stored id, and stops at the limit", () => {
    expect(answeredMessageIds('<"a b"@x> <ok@x>', "<a,b@x> <(c)@x>")).toEqual([
      "ok@x",
    ]);
    expect(answeredMessageIds("", "<1@x> <2@x> <3@x>", 2)).toEqual(["3@x", "2@x"]);
    expect(answeredMessageIds(undefined, null)).toEqual([]);
  });

  it("shapes and bare form", () => {
    expect(storedMessageIdShapes(["a@x"])).toEqual(["<a@x>", "a@x"]);
    expect(bareMessageId(" <a@x> ")).toBe("a@x");
    expect(bareMessageId(null)).toBe("");
  });
});
