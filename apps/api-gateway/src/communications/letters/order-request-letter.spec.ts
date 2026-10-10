/**
 * The order-request letter (W25; ADR 0313, 4a-i): the pure renderer, the
 * service door that reads an order's facts and stages its letter, and the
 * internal route's guards. One spec file for the lane, to keep the PR inside
 * its file cap.
 *
 * Renderer, proved without a database: who may see money (W12b F6), what "no
 * price on file" asks (never "confirm"), the subject, the Mudavym line (F4),
 * the courtesy line's drop rules (F2), that the queue's own guardrails pass the
 * default letter, that the render and its facts hash are deterministic and
 * move with the facts, and each class the prose predicate refuses.
 *
 * Service, proved against an in-memory table store that honours the filters
 * the service issues (eq / order / maybeSingle) — so a read that forgot its
 * restaurant scope picks up the other house's row and fails a test here.
 */

import "reflect-metadata";
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import { OrderRequestService } from "./order-request.service";
import { OrderRequestController } from "./order-request.controller";
import { ServiceKeyGuard } from "../../auth/guards/service-key.guard";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import type { DatabaseService } from "../../database/database.service";
import {
  DEFAULT_ORDER_REQUEST_TEMPLATE,
  DEFAULT_ORDER_REQUEST_TEMPLATE_TR,
  ORDER_REQUEST_TOKENS,
  houseLocale,
  OrderRequestTemplateRefused,
  courtesyLineOrNull,
  orderRequestProseRefusals,
  orderRequestProseRefusalsUncapped,
  ORDER_REQUEST_TEMPLATE_MAX_CHARS,
  renderOrderRequest,
  type OrderRequestFacts,
} from "./order-request-letter";
import { composerGuardrails } from "./composer-guardrails";

function facts(over: Partial<OrderRequestFacts> = {}): OrderRequestFacts {
  return {
    orderId: "o-1",
    orderNumber: "PO-1042",
    houseName: "Tuzlu Rüzgar",
    vendorFirstName: "Ayşe",
    lines: [
      {
        name: "Kavaklıdere Yakut",
        vendorSku: "KY-75",
        quantity: 2,
        unit: "cases",
        bottlesPerUnit: 6,
        price: { amount: 25, currency: "EUR", uom: "bottle", packSize: null },
      },
    ],
    placer: { userId: "u-1", name: "Deniz", role: "owner" },
    deliverTo: "Moda Cd., Istanbul",
    neededBy: "2026-10-20",
    paymentTerms: "Net 30",
    ...over,
  };
}

const STAFF = { userId: "u-2", name: "Ali", role: "staff" };
const NOBODY = { userId: null, name: null, role: null };
const NO_PRICE_LINE = {
  name: "Kavaklıdere Yakut",
  vendorSku: null,
  quantity: 2,
  unit: "cases",
  bottlesPerUnit: 6,
  price: null,
};
/** A price as it would be written in any currency, or a currency code. */
const MONEY_RE = /\d+\.\d{2}|\bEUR\b|currency not recorded/;

describe("who may see money (W12b F6)", () => {
  it("an owner's letter carries the line price in its own currency", () => {
    const r = renderOrderRequest(facts());
    expect(r.priceShown).toBe(true);
    expect(r.body).toContain("2 cases, 6 bottles each at 25.00 EUR per bottle");
  });

  it("a price with no currency says so rather than guessing one", () => {
    const f = facts();
    f.lines[0].price = { amount: 25, currency: null, uom: "bottle", packSize: null };
    expect(renderOrderRequest(f).body).toContain("25.00 (currency not recorded) per bottle");
  });

  it("a staff placer's letter carries no price anywhere", () => {
    const r = renderOrderRequest(facts({ placer: STAFF }));
    expect(r.priceShown).toBe(false);
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.body).toContain("2 cases, 6 bottles each");
    expect(r.body).toContain("Ali\nTuzlu Rüzgar");
  });

  it("a NULL creator fails closed: no price, and the house signs alone", () => {
    const r = renderOrderRequest(facts({ placer: NOBODY }));
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });

  it("a placer with no role here fails closed the same way", () => {
    const r = renderOrderRequest(facts({ placer: { userId: "u-3", name: "Eda", role: null } }));
    expect(`${r.subject}\n${r.body}`).not.toMatch(MONEY_RE);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });
});

describe("no price on file", () => {
  it("asks for a price and never asks the vendor to confirm (header 0, no line price)", () => {
    for (const placer of [facts().placer, STAFF, NOBODY]) {
      const r = renderOrderRequest(facts({ placer, lines: [NO_PRICE_LINE] }));
      expect(r.ask).toBe("price");
      expect(r.body).toContain("We have no price on file for this order");
      expect(`${r.subject}\n${r.body}`).not.toMatch(/confirm/i);
    }
  });

  it("a zero price is no price: no 0.00 shown, and the price ask", () => {
    const f = facts();
    f.lines[0].price = { amount: 0, currency: "EUR", uom: "bottle", packSize: null };
    const r = renderOrderRequest(f);
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/0\.00|confirm/i);
  });

  it("one unpriced line among priced ones is still no price on file", () => {
    const f = facts();
    f.lines.push({ ...NO_PRICE_LINE, name: "Second" });
    const r = renderOrderRequest(f);
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm/i);
  });

  it("with a price on file the ask is the confirm ask, whoever placed it", () => {
    expect(renderOrderRequest(facts()).ask).toBe("confirm");
    expect(renderOrderRequest(facts({ placer: STAFF })).parts.ask).toContain("Please confirm this order");
  });
});

describe("subject (renderer-owned, R7)", () => {
  it("names the item for a one-line order", () => {
    expect(renderOrderRequest(facts()).subject).toBe("Order PO-1042 — Tuzlu Rüzgar — Kavaklıdere Yakut");
  });
  it("names no item for an N-line order", () => {
    const f = facts();
    f.lines.push({ ...f.lines[0], name: "Second" });
    expect(renderOrderRequest(f).subject).toBe("Order PO-1042 — Tuzlu Rüzgar");
  });
});

describe("the Mudavym line (F4)", () => {
  it("is the last line of the default letter", () => {
    expect(renderOrderRequest(facts()).body.endsWith("—\nThis message was drafted by Mudavym on behalf of Tuzlu Rüzgar.")).toBe(true);
  });
  it("is present under a house template that never mentions it", () => {
    const r = renderOrderRequest(facts(), {
      template: "{{greeting}}\n{{order_lines}}\n{{ask}}\n{{signer}}",
    });
    expect(r.body).toContain("drafted by Mudavym on behalf of Tuzlu Rüzgar.");
  });
});

describe("optional blocks", () => {
  it("drops an empty optional block's line; the date ask stands in for a missing date", () => {
    const r = renderOrderRequest(facts({ deliverTo: null, paymentTerms: null, neededBy: null }));
    expect(r.body).not.toContain("Deliver to");
    expect(r.body).not.toContain("Payment terms");
    expect(r.body).toContain("Please tell us the delivery date you can make.");
    expect(r.body).not.toMatch(/\n{3,}/);
  });
});

describe("the courtesy line (F2)", () => {
  it("drops a sentence over 240 raw UTF-16 code units before NFKC or the link test reads it (CI BLOCK 3bdd750, N5)", () => {
    // The U+200B format characters normalise away, so only the raw count
    // (240 + 10 = 250 code units over the cap of 240) drops the second.
    expect(courtesyLineOrNull("\u200B".repeat(230) + "Thank you.")).toBe("Thank you.");
    expect(courtesyLineOrNull("\u200B".repeat(240) + "Thank you.")).toBeNull();
    // Exact boundary, raw: 240 code units are kept, 241 are dropped.
    expect(courtesyLineOrNull("Thanks" + " ".repeat(234))).toBe("Thanks");
    expect(courtesyLineOrNull("Thanks" + " ".repeat(235))).toBeNull();
    // U+FDFA is the longest NFKC expansion: two million of them, unread.
    const t0 = Date.now();
    expect(courtesyLineOrNull("\uFDFA".repeat(2_000_000))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(100);
  });

  it("drops a sentence over 240 code units after NFKC (gate note at aff7c87)", () => {
    // 100 U+FDFA are 100 raw code units, under the raw cap; NFKC makes them
    // 1,800, over the cap after normalising.
    expect("\uFDFA".repeat(100).normalize("NFKC").length).toBe(1800);
    expect(courtesyLineOrNull("\uFDFA".repeat(100))).toBeNull();
  });

  it.each([
    ["a digit", "We look forward to working with you for 3 more seasons."],
    ["a non-ASCII digit", "We look forward to working with you for ３ seasons."],
    ["a currency sign", "Thank you for the € support."],
    ["a date word", "Hope to see you on Friday."],
    ["a Turkish date word", "Yarın görüşmek üzere."],
    ["a bracket", "Best regards from [Your Name]."],
    ["a merge token", "Thanks {{name}}."],
    ["a commitment", "We accept your terms gladly."],
    ["a money word", "Thanks for the free delivery last time."],
    ["a bare domain", "Thanks, and see evil.xyz for more."],
    ["a short link with a path", "Thanks, more at bit.ly/abc as well."],
    ["a nested domain", "Thanks from shop.example.ly as ever."],
    ["an ideographic dot domain", "Thanks from evil\u3002com as ever."],
    ["a fullwidth dot domain", "Thanks from evil\uFF0Ecom as ever."],
  ])("is dropped on %s", (_label, sentence) => {
    expect(courtesyLineOrNull(sentence)).toBeNull();
    const r = renderOrderRequest(facts(), { courtesySentence: sentence });
    expect(r.courtesyDropped).toBe(true);
    expect(r.parts.courtesy_line).toBe("");
  });

  it.each([
    "Thanks. See you soon.",
    "Thank you again for the lovely selection.",
    "With warm regards from all of us, e.g. the kitchen team.",
  ])("is kept as written: %s", (s) => {
    expect(courtesyLineOrNull(s)).toBe(s);
  });

  it("is kept when it holds no figure", () => {
    const s = "We hope the harvest went well for you.";
    const r = renderOrderRequest(facts(), { courtesySentence: s });
    expect(r.courtesyDropped).toBe(false);
    expect(r.body).toContain(s);
  });
});

describe("the queue's guardrails over the default letter", () => {
  it.each([
    ["owner with a price", facts()],
    ["staff", facts({ placer: STAFF })],
    ["no price", facts({ lines: [NO_PRICE_LINE] })],
    ["no placer", facts({ placer: NOBODY })],
  ])("trip nothing (%s)", (_label, f) => {
    const r = renderOrderRequest(f, { courtesySentence: "We hope the harvest went well." });
    expect(composerGuardrails({ body: r.body, subject: r.subject, priorOutboundOnOrder: 0 })).toEqual([]);
  });
});

describe("determinism and the facts hash", () => {
  it("same facts and template give the same text and hash", () => {
    const a = renderOrderRequest(facts());
    const b = renderOrderRequest(facts());
    expect(b.body).toBe(a.body);
    expect(b.subject).toBe(a.subject);
    expect(b.factsHash).toBe(a.factsHash);
    expect(a.factsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves with quantity, price and role", () => {
    const base = renderOrderRequest(facts()).factsHash;
    const qty = facts();
    qty.lines[0].quantity = 3;
    const price = facts();
    price.lines[0].price = { amount: 26, currency: "EUR", uom: "bottle", packSize: null };
    expect(renderOrderRequest(qty).factsHash).not.toBe(base);
    expect(renderOrderRequest(price).factsHash).not.toBe(base);
    expect(renderOrderRequest(facts({ placer: { ...facts().placer, role: "staff" } })).factsHash).not.toBe(base);
  });

  it("does not move with the template (R5) or the courtesy line", () => {
    const base = renderOrderRequest(facts()).factsHash;
    const other = renderOrderRequest(facts(), {
      template: "{{greeting}}\n{{order_lines}}\n{{ask}}\n{{signer}}",
      courtesySentence: "We hope the harvest went well.",
    }).factsHash;
    expect(other).toBe(base);
  });
});

describe("the prose predicate", () => {
  const T = (prose: string) => `{{greeting}}\n${prose}\n{{order_lines}}\n{{ask}}\n{{signer}}`;
  const rules = (tpl: string) => orderRequestProseRefusals(tpl).map((r) => r.rule);

  it("passes the default template", () => {
    expect(orderRequestProseRefusals(DEFAULT_ORDER_REQUEST_TEMPLATE)).toEqual([]);
  });

  it("names no single figure among its tokens", () => {
    for (const k of Object.keys(ORDER_REQUEST_TOKENS)) {
      expect(k).not.toMatch(/price|quantity|qty|order_number|amount|total/);
      expect(k).not.toMatch(/date$/);
    }
  });

  it.each([
    ["unknown_token", "{{greeting}}\n{{price}}\n{{order_lines}}\n{{ask}}\n{{signer}}"],
    ["missing_required_token", "{{greeting}}\n{{order_lines}}\n{{signer}}"],
    ["numeral", T("Within 2 days please.")],
    ["numeral", T("Within ３ days please.")],
    ["numeral", T("Our ² favourite.")],
    ["numeral", T("Ⅻ cheers.")],
    ["currency", T("We pay in € only.")],
    ["currency", T("All in EUR as usual.")],
    ["currency", T("Hepsi lira olarak.")],
    ["link", T("See https://example.org for details.")],
    ["link", T("See example.com for details.")],
    ["link", T("Write to orders@house.example.")],
    ["link", T("See evil.xyz for details.")],
    ["link", T("See bit.ly/abc for details.")],
    ["link", T("See shop.example.ly for details.")],
    ["link", T("See evil\u3002com for details.")],
    ["link", T("See evil\uFF0Ecom for details.")],
    ["link", T("See evil\uFF61com for details.")],
    ["link", T("See пример.рф for details.")],
    ["link", T("Open javascript:alert for details.")],
    ["link", T("Open JavaScript:void for details.")],
    ["link", T("Open data:text/html for details.")],
    ["link", T("Write to mailto:orders for details.")],
    ["link", T("Ring tel:house for details.")],
    ["link", T("Fetch ftp:host or file:host or vbscript:x or sms:x.")],
    ...[
      "\u00B7", "\u0387", "\u0589", "\u06D4", "\u0700", "\u0701", "\u0702", "\u0F0B",
      "\u0F0C", "\u0F0D", "\u1362", "\u166E", "\u1803", "\u1809", "\u1C3B", "\u2022",
      "\u2024", "\u2027", "\u2219", "\u22C5", "\u2E31", "\u2E33", "\u2E3C", "\u3002",
      "\u30FB", "\uFF65", "\uA4FF", "\uA60E", "\uA6F3", "\u{10A56}", "\uFE12", "\uFE52",
      "\uFF0E", "\uFF61",
    ].map((dot) => ["link", T(`See evil${dot}com for details.`)] as [string, string]),
    ["stray_bracket", T("Thanks { team.")],
    ["stray_bracket", T("Thanks <b>team</b>.")],
    ["stray_bracket", "{{greeting}}\n{{{order_lines}}}\n{{ask}}\n{{signer}}"],
    ["money_or_terms_word", T("At the usual price.")],
    ["money_or_terms_word", T("Free delivery as always.")],
    ["money_or_terms_word", T("Her zamanki FİYAT ile.")],
    ["money_or_terms_word", T("Ödemeyi sonra konuşuruz.")],
    ["money_or_terms_word", T("Vadeli olsun.")],
    ["number_word", T("Twelve of the usual.")],
    ["number_word", T("A dozen more.")],
    ["number_word", T("İki koli daha.")],
    ["commitment_language", T("We accept your offer.")],
    ["commitment_language", T("We a\u200bccept your offer.")],
  ])("refuses %s: %s", (rule, tpl) => {
    expect(rules(tpl)).toContain(rule);
  });

  it("does not refuse everyday words that collide with numbers or dates", () => {
    expect(rules(T("Bir sorumuz var. May we ask for an early slot on Pazar? No one minds."))).toEqual([]);
  });

  it("keeps sentence dots and one-letter abbreviations, refuses two words joined by a dot", () => {
    expect(rules(T("Thanks. See you soon. Regards, e.g. as before, U.S. style."))).toEqual([]);
    expect(rules(T("Thanks again.\nSee you soon."))).toEqual([]);
    expect(rules(T("A case of St.Emilion as before."))).toContain("link");
  });

  it.each([
    ["U+034F before the dot", "evil\u034F.com"],
    ["U+034F after the dot", "evil.\u034Fcom"],
    ["U+FE0F before the dot", "evil\uFE0F.com"],
    ["U+FE0F after the dot", "evil.\uFE0Fcom"],
    ["U+FE00 before the dot", "evil\uFE00.com"],
    ["U+180B before the dot", "evil\u180B.com"],
    ["U+180D after the dot", "evil.\u180Dcom"],
    ["U+0338 before the dot", "evil\u0338.com"],
    ["U+0301 after the dot", "evil.\u0301com"],
    ["U+20DD (Me) before the dot", "evil\u20DD.com"],
    ["a mark splitting a scheme", "javascript\u034F:alert"],
    ["an underscore inside a label", "evil_site.com"],
    ["an underscore after the domain", "evil.com_"],
    ["an underscore before the domain", "_evil.com"],
    ["a [.] defanged dot", "evil[.]com"],
    ["a (.) defanged dot", "evil(.)com"],
    ["a spaced (.) defanged dot", "evil (.) com"],
    ["a [dot] defanged dot", "evil [dot] com"],
  ])("refuses a link with %s", (_label, link) => {
    expect(rules(T(`See ${link} for details.`))).toContain("link");
  });

  it.each([
    ["U+034F", "Thanks from evil\u034F.com as ever."],
    ["U+FE0F", "Thanks from evil.\uFE0Fcom as ever."],
    ["U+180B", "Thanks from evil\u180B.com as ever."],
    ["U+0338", "Thanks from evil\u0338.com as ever."],
    ["U+0301", "Thanks from evil.\u0301com as ever."],
  ])("drops a courtesy line whose domain hides behind %s", (_label, sentence) => {
    expect(courtesyLineOrNull(sentence)).toBeNull();
  });

  // Gate BLOCK at d48c23d, finding 1: a lookbehind on the "://" scheme let a
  // prefix hide it. Every row of the report, in house prose and in the
  // AI-written courtesy line.
  it.each([
    ["-", "See -https://intranet/x"],
    ["+", "See +http://a"],
    [".", "See .https://intranet"],
    ["\u2026 (NFKC: ...)", "See \u2026https://intranet/x"],
    ["\u2022 (bullet)", "See \u2022https://intranet/x"],
    ["- before a two-letter host", "Visit -https://ai/x"],
  ])("refuses a '://' link behind a %s prefix", (_label, text) => {
    expect(rules(T(`${text} for details.`))).toContain("link");
    expect(courtesyLineOrNull(`Thanks. ${text} as ever.`)).toBeNull();
  });

  // Finding 2: stripping a mark joined a letter onto a scheme word, and the
  // scheme's lookbehind then let it through. Each listed scheme behind each
  // of the five marks the report names.
  it.each(
    ["\u0301", "\u034F", "\uFE0F", "\u0338", "\u20DD"].flatMap((mark) =>
      [
        ["x", "javascript:alert"],
        ["_", "mailto:a"],
        ["x", "data:text"],
        ["x", "tel:abc"],
        ["x", "ftp:host"],
        ["x", "file:host"],
      ].map(([lead, scheme]) => [
        `U+${mark.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        `${lead}${mark}${scheme}`,
      ]),
    ),
  )("refuses a scheme behind a letter and %s: %s", (_mark, text) => {
    expect(rules(T(`Open ${text} now.`))).toContain("link");
    expect(courtesyLineOrNull(`Thanks, open ${text} now.`)).toBeNull();
  });

  // Gate BLOCK at 6bc930396, finding 2: normaliseProse stripped format
  // characters before the link test, so a format character (or a Hangul
  // filler, a letter that renders as nothing) between a letter and a scheme
  // passed. Each listed scheme behind each of the report's characters.
  it.each(
    [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad, 0x200e, 0x061c, 0xe0001, 0x3164, 0x115f].flatMap((cp) =>
      ["javascript:alert", "data:text", "file:secret", "ftp:x", "sms:x", "vbscript:a"].map((scheme) => [
        `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
        `x${String.fromCodePoint(cp)}${scheme}`,
      ]),
    ),
  )("refuses a scheme behind a letter and %s: %s", (_cp, text) => {
    expect(rules(T(`Open ${text} now.`))).toContain("link");
    expect(courtesyLineOrNull(`Thanks, open ${text} now.`)).toBeNull();
  });

  // Finding 3: JS \s does not match U+0085 (NEL), so the folds name it.
  it.each([
    ["NEL before the dot", "evil\u0085.com"],
    ["NEL inside brackets before the dot", "evil[\u0085.]com"],
    ["NEL inside brackets after the dot", "evil[.\u0085]com"],
  ])("refuses a link with %s", (_label, link) => {
    expect(rules(T(`See ${link} for details.`))).toContain("link");
    expect(courtesyLineOrNull(`Thanks from ${link} as ever.`)).toBeNull();
  });

  // Finding 1, named in ADR 0313:37: a scheme word split by a mark, format
  // or control character, backslash, tab or line break that no view shows
  // whole with nothing joined before it. No mail client reads a split scheme
  // as one.
  it.each([
    "x\u034Fjava\u034Fscript:alert",
    "x\u034Fda\u034Fta:text",
    "x\\java\\script:alert",
    "xjava\u034Fscript:alert",
    "x\u200Bjava\u200Bscript:alert",
    "x\u200Bjava\u0301script:alert",
    "x\u001Cjava\u001Cscript:alert",
    "x\tjava\tscript:alert",
  ])("does not catch a split scheme joined to a letter (named gap): %s", (text) => {
    expect(rules(T(`Open ${text} now.`))).not.toContain("link");
  });

  // Session gate plan at 3208a92: control characters are stripped in copies
  // 1 and 2, like format characters.
  it.each([
    ["U+001C", "\u001C"],
    ["U+001E", "\u001E"],
    ["U+001F", "\u001F"],
    ["U+0000", "\u0000"],
    ["U+007F", "\u007F"],
    ["U+009F", "\u009F"],
  ])("refuses a link with the control character %s before the dot", (_label, c) => {
    expect(rules(T(`See evil${c}.com for details.`))).toContain("link");
    expect(courtesyLineOrNull(`Thanks from evil${c}.com as ever.`)).toBeNull();
  });

  it("refuses a scheme with a control character before it, as copy 3 reads it", () => {
    expect(rules(T("Open x\u001Cjavascript:alert now."))).toContain("link");
  });

  // Gate notes at aff7c87: shapes that only one strip catches.
  it("refuses a mark and a control character before the dot (only copy 1 strips both)", () => {
    expect(rules(T("See evil\u034F\u001C.com for details."))).toContain("link");
    expect(courtesyLineOrNull("Thanks from evil\u034F\u001C.com as ever.")).toBeNull();
  });

  // The scheme view: a browser's URL parser drops tab and newline from an
  // href, so a scheme split by one, with nothing joined before it, is refused.
  it.each([
    ["a tab", "java\tscript:alert"],
    ["a line feed", "java\nscript:alert"],
    ["a carriage return", "java\rscript:alert"],
    ["U+2028", "jav\u2028ascript:alert"],
    ["U+2029", "jav\u2029ascript:alert"],
    ["a control character", "java\u001Cscript:alert"],
    // Only the scheme view strips the control character before joining the tab.
    ["a control character and a tab", "java\u001C\tscript:alert"],
    ["a tab inside https", "ht\ttps://x"],
    // Only the scheme view strips the format character between the tabs.
    ["a tab, a format character and a tab", "java\t\u200B\tscript:alert"],
    // Gate notes at aff7c87: a tab or line break around the slashes.
    ["a tab between the colon and //", "https:\t//x"],
    ["a tab between the slashes", "http:/\t/x"],
    ["a line feed between the slashes", "http:/\n/evil"],
    ["a carriage return between the slashes", "https:/\r/x"],
    ["a tab after the colon and a line feed between the slashes", "http:\t/\n/x"],
    // Gate F1 at ddec65da2: a tab or line break before the colon.
    ["a tab before the colon", "https\t://intranet"],
    ["a line feed before the colon", "http\n://localhost/x"],
    ["a carriage return before the colon", "HTTPS\r://x"],
    ["U+2028 before the colon", "http\u2028://x"],
    ["a line feed before a named scheme's colon", "javascript\n:alert"],
    ["a line feed before a mailto colon", "mailto\n:a"],
    ["a tab on both sides of the colon", "http\t:\t//x"],
    ["a tab after a scheme ending in +", "web+\t://x"],
  ])("refuses a scheme split by %s", (_label, link) => {
    expect(rules(T(`Open ${link} now.`))).toContain("link");
    expect(courtesyLineOrNull(`Open ${link} now.`)).toBeNull();
  });

  // Named in ADR 0313:37: a tab or line break right after a scheme's colon,
  // with no "/" after it, is left, because a line ending in "Data:" is prose.
  // These stay kept.
  it.each([
    ["a line break after the colon", "javascript:\nalert"],
    ["a line ending in a scheme word and a colon", "Delivery data:\nPlease send it."],
    ["a line after a colon starting with one slash", "Sizes:\n/ small / large"],
  ])("does not refuse %s (named gap / prose)", (_label, text) => {
    expect(rules(T(text))).not.toContain("link");
  });

  it("refuses a line ending in a colon and a line starting with // (fail closed)", () => {
    expect(rules(T("Note:\n// see below"))).toContain("link");
  });

  // Fail closed, named in ADR 0313:37: a scheme's shape, a colon and two
  // slashes with only runs of tab, line feed, carriage return, U+2028 or
  // U+2029 between them read as "x://"; such a run between a named scheme
  // word and its colon reads as "data:x".
  it.each([
    ["a slash, a tab and a slash on the next line", "Ek:\n/\t/"],
    ["one slash per line", "Seçenekler:\n/\n/ boş"],
    ["tabs around the slashes", "Date:\t/\t/"],
    ["a blank line and //", "Dear team:\n\n// ok"],
    ["a line break before the colon and //", "Note\n:// see"],
    ["a line break before a named scheme's colon", "Data\n:x"],
  ])("refuses %s (fail closed)", (_label, text) => {
    expect(rules(T(text))).toContain("link");
  });

  // A space in the gap keeps the line: only tab, line feed, carriage return,
  // U+2028 and U+2029 are joined.
  it.each([
    ["a line starting with a colon and a space", "Note\n: see below"],
    ["French, a colon on its own line", "Remarque\n: merci"],
    ["Turkish, a colon on its own line", "Teslimat\n: sabah"],
    ["a named scheme word and a colon on the next line", "Data\n: as before"],
    ["a space before the colon", "Remarque :\n// merci"],
    ["slashes after a space", "Sizes:\n/ small\n/ large"],
  ])("keeps %s", (_label, text) => {
    expect(rules(T(text))).not.toContain("link");
  });

  // Named in ADR 0313:37: a URL parser reads a backslash as "/" for http,
  // https, ws and wss; the test looks for "//". Caught when stripping the
  // backslash leaves "://", when the host is a domain, and for a named scheme.
  it.each([
    ["two backslashes", "http:\\\\x"],
    ["a slash and a backslash", "http:/\\x"],
    ["a backslash and a slash", "https:\\/intranet"],
    ["a tab, a backslash and //", "http:\t\\//x"],
  ])("does not catch %s in place of // (named gap)", (_label, link) => {
    expect(rules(T(`Open ${link} now.`))).not.toContain("link");
  });
  it.each([
    ["a backslash before //", "http:\\//x"],
    ["a domain host", "http:\\\\evil.xyz"],
    ["a named scheme", "ftp:\\\\x"],
  ])("refuses a backslash shape with %s", (_label, link) => {
    expect(rules(T(`Open ${link} now.`))).toContain("link");
  });

  // Adversary note 1 at aff7c87, named in ADR 0313:37: the link test reads
  // the prose with each token replaced by a space, but the render joins the
  // block onto the prose. Must be closed before houses edit templates
  // (PR-4a-ii).
  it("does not catch a link made with a fact block (named gap)", () => {
    expect(rules(T("See {{signer}}.com for details."))).not.toContain("link");
  });

  it("keeps two lines that only the scheme view joins", () => {
    expect(rules(T("Thank you.\nBest regards"))).toEqual([]);
    // Joined, "e.g" + newline + "the" reads "e.gthe", a bare domain; the
    // scheme view is tested for schemes only, so it is kept.
    expect(rules(T("See e.g\nthe list below."))).toEqual([]);
  });

  it("refuses a split scheme that one copy shows whole: a mark before, a format character inside", () => {
    expect(rules(T("Open x\u0301java\u200Bscript:alert now."))).toContain("link");
  });

  // Finding 3: the defang families the report found, now folded to a dot.
  it.each([
    ["a backslash-escaped dot", "evil\\.com"],
    ["a line break before the dot", "evil\n.com"],
    ["spaces and a line break before the dot", "evil \n .com"],
    ["CJK lenticular brackets", "evil\u3010.\u3011com"],
    ["CJK tortoise-shell brackets", "evil\u3014.\u3015com"],
    ["CJK corner brackets", "evil\u300C.\u300Dcom"],
    ["guillemets", "evil\u00AB.\u00BBcom"],
    ["a bracketed dot then a bracketed label", "evil(.)(com)"],
    ["&period;", "evil&period;com"],
    ["nested brackets", "evil[[.]]com"],
    ["spaced nested brackets", "evil [[ . ]] com"],
    ["a nested bracketed dot word", "evil [( dot )] com"],
    ["deeply nested mixed brackets", `evil${"[(".repeat(500)}.${")]".repeat(500)}com`],
    ["an unmatched opening bracket", "evil[.com"],
    ["an unmatched closing bracket", "evil.]com"],
    ["angle brackets", "evil<.>com"],
  ])("refuses a link with %s", (_label, link) => {
    expect(rules(T(`See ${link} for details.`))).toContain("link");
  });

  it.each([
    ["a backslash-escaped dot", "evil\\.com"],
    ["a line break before the dot", "evil\n.com"],
    ["CJK lenticular brackets", "evil\u3010.\u3011com"],
    ["guillemets", "evil\u00AB.\u00BBcom"],
    ["a bracketed dot then a bracketed label", "evil(.)(com)"],
    ["&period;", "evil&period;com"],
  ])("drops a courtesy line whose domain is defanged with %s", (_label, link) => {
    expect(courtesyLineOrNull(`Thanks from ${link} as ever.`)).toBeNull();
  });

  // Finding 4, named in ADR 0313:37: the fold swallows the spaces around a
  // bracketed dot or "dot", and "_" is a label character, so this prose is
  // refused although it holds no link. Fail closed; the house rewords it.
  it.each([
    "Thank you (dot) for the order.",
    "Merci (dot) beaucoup.",
    "Hello [.] Goodbye.",
    "A note (.) below.",
    "The Mod_name.Next case.",
    // Added by this fold: a dot then a bracket then a word, a dot then a
    // closing bracket then a word.
    "As in the U.S.(as before).",
    "(Thanks.)Next time.",
  ])("refuses, as a named false refusal: %s", (text) => {
    expect(rules(T(text))).toContain("link");
  });

  it("keeps accented and Turkish prose next to a sentence dot", () => {
    expect(rules(T("Merci beaucoup. Teşekkürler. İyi çalışmalar. Café (as before)."))).toEqual([]);
  });

  it("scans a 100 KB adversarial input in linear time (gate note at 2e6ee4c48)", () => {
    const N = 100_000;
    const inputs = [
      "a".repeat(N),
      "a-".repeat(N / 2),
      "a+".repeat(N / 2),
      "a.".repeat(N / 2),
      "a_".repeat(N / 2),
      " ".repeat(N) + "x",
      "\n".repeat(N) + "x",
      "\u0085".repeat(N) + "x",
      "(\u0085".repeat(N / 2),
      "\u200B".repeat(N) + "x",
      " \n".repeat(N / 2) + "x",
      "(".repeat(N),
      "( ".repeat(N / 2),
      "\u3010".repeat(N),
      ".)".repeat(N / 2),
      ". ".repeat(N / 2),
      "\\".repeat(N),
      "a-".repeat(N / 2) + "://",
    ];
    // Quadratic was 1.4-6 s at 100 KB; linear is a few ms. The bound is loose.
    // A slow input is named in the failure, so a mutation shows which one.
    // The uncapped scan: 100 KB is past the length cap, which is pinned below.
    const slow: string[] = [];
    for (const input of inputs) {
      const t0 = Date.now();
      orderRequestProseRefusalsUncapped(T(input));
      const ms = Date.now() - t0;
      if (ms >= 750) slow.push(`${JSON.stringify(input.slice(0, 4))}… (${input.length} chars): ${ms} ms`);
    }
    expect(slow).toEqual([]);
  });

  it("refuses a template over the raw length cap before NFKC reads it (CI BLOCK 3bdd750, N5)", () => {
    // U+FDFA is the longest NFKC expansion (one code point to 18). A million
    // of them, uncapped, is seconds of scanning; capped, it is refused on its
    // length.
    const huge = T("\uFDFA".repeat(1_000_000));
    const t0 = Date.now();
    const refused = orderRequestProseRefusals(huge);
    const ms = Date.now() - t0;
    expect(refused.map((r) => r.rule)).toEqual(["too_long"]);
    expect(refused[0].says).toContain(String(ORDER_REQUEST_TEMPLATE_MAX_CHARS));
    expect(ms).toBeLessThan(100);
    // At the cap, the worst NFKC input is still scanned, and in bounded time.
    const atCap = T("\uFDFA".repeat(ORDER_REQUEST_TEMPLATE_MAX_CHARS - T("").length));
    expect(atCap.length).toBe(ORDER_REQUEST_TEMPLATE_MAX_CHARS);
    const t1 = Date.now();
    expect(rules(atCap)).not.toContain("too_long");
    expect(Date.now() - t1).toBeLessThan(750);
    expect(rules(atCap + "x")).toEqual(["too_long"]);
  });

  it("puts the template cap exactly at 16,384 code units (gate note at aff7c87)", () => {
    const pad = (n: number) => T("a".repeat(n - T("").length));
    expect(pad(16_384).length).toBe(16_384);
    expect(rules(pad(16_384))).toEqual([]);
    expect(rules(pad(16_385))).toEqual(["too_long"]);
  });

  it("leaves the shipped defaults far under the length cap", () => {
    expect(DEFAULT_ORDER_REQUEST_TEMPLATE.length).toBeLessThan(600);
    expect(DEFAULT_ORDER_REQUEST_TEMPLATE_TR.length).toBeLessThan(600);
  });

  it("does not catch the stated gaps (ADR 0313:37)", () => {
    expect(rules(T("See evil dot com for details."))).toEqual([]);
    expect(rules(T("See evil . com for details."))).toEqual([]);
    // Broken across lines after the dot (the courtesy line collapses
    // whitespace first, so it reads "evil. com" there and passes too).
    expect(rules(T("See evil.\ncom for details."))).toEqual([]);
    // A dot-like character outside DOT_LIKE_RE (U+2E30 ring point is not in it).
    expect(rules(T("See evil\u2E30com for details."))).toEqual([]);
    // A scheme outside LINK_SCHEMES, without "//".
    expect(rules(T("Open foo:bar for details."))).toEqual([]);
    // Spelled out with AT and DOT.
    expect(rules(T("Write to name AT evil DOT com for details."))).toEqual([]);
    // A dot written as another word in brackets: not a link; "[d0t]" holds a
    // digit, so the numeral rule refuses it, and nothing else does.
    expect(rules(T("See evil[d0t]com for details."))).toEqual(["numeral"]);
    expect(rules(T("See evil[period]com for details."))).toEqual([]);
    // "dot" in a bracket on one side only, and a space outside an unmatched
    // bracket.
    expect(rules(T("See evil [dot com for details."))).toEqual([]);
    expect(rules(T("See evil [.com for details."))).toEqual([]);
    // A bracket outside OPEN_BRACKETS / CLOSE_BRACKETS (U+2E28 / U+2E29).
    expect(rules(T("See evil\u2E28.\u2E29com for details."))).toEqual([]);
    // A "://" whose nearest ASCII letter is more than 31 characters back.
    expect(rules(T(`See a${"-".repeat(40)}://x for details.`))).toEqual([]);
    expect(rules(T(`See a${"-".repeat(30)}://x for details.`))).toContain("link");
  });

  it("keeps a known scheme word followed by a space, and a word that only ends in one", () => {
    expect(rules(T("Data: as before. Note: thanks. Metadata:kept."))).toEqual([]);
  });

  it("a refused template never renders", () => {
    expect(() => renderOrderRequest(facts(), { template: T("At the usual price.") })).toThrow(
      OrderRequestTemplateRefused,
    );
  });
});

// ── The service door and the route ──────────────────────────────────────────

// ── Turkish (F3, answered 2026-10-08: "Approve + Turkish now") ─────────────

const TR_LINES = [
  {
    name: "Kavaklıdere Yakut 2021",
    vendorSku: "KY-75",
    quantity: 3,
    unit: "case",
    bottlesPerUnit: 6,
    price: { amount: 25, currency: "EUR", uom: "bottle", packSize: null },
  },
  {
    name: "Sevilen Majestik Rosé",
    vendorSku: null,
    quantity: 12,
    unit: "bottle",
    bottlesPerUnit: null,
    price: { amount: 1250.5, currency: "TRY", uom: "case", packSize: 12 },
  },
];
const tr = (over: Partial<OrderRequestFacts> = {}) =>
  facts({ locale: "tr", lines: TR_LINES.map((l) => ({ ...l, price: l.price && { ...l.price } })), ...over });

describe("the Turkish letter (words locked under F3, ADR 0313)", () => {
  it("an owner's letter: Turkish blocks, decimal comma, price per unit", () => {
    const r = renderOrderRequest(tr());
    expect(r.locale).toBe("tr");
    expect(r.subject).toBe("Sipariş PO-1042 — Tuzlu Rüzgar");
    expect(r.body).toContain("Merhaba Ayşe,");
    expect(r.body).toContain("Sipariş talebimiz aşağıdadır:");
    expect(r.body).toContain(
      "- Kavaklıdere Yakut 2021 (sizdeki kod: KY-75): 3 koli, her biri 6 şişe; şişe başına 25,00 EUR",
    );
    expect(r.body).toContain("- Sevilen Majestik Rosé: 12 şişe; koli (12 adet) başına 1.250,50 TRY");
    expect(r.body).toContain("Teslimat adresi: Moda Cd., Istanbul");
    expect(r.body).toContain("İstenen teslim tarihi: 20.10.2026");
    expect(r.body).toContain("Bize bildirdiğiniz ödeme koşulları: Net 30");
    expect(r.body).toContain(
      "Lütfen bu siparişi ve teslim tarihini, PO-1042 sipariş numarasını belirterek yanıtınızla onaylayınız.",
    );
    expect(r.body).toContain("Teşekkür ederiz.\nSaygılarımızla,\nDeniz\nTuzlu Rüzgar");
    expect(r.body.endsWith("—\nBu mesaj Mudavym tarafından Tuzlu Rüzgar adına hazırlanmıştır.")).toBe(true);
    expect(r.body).not.toMatch(/Hello|Order |Thank you|drafted by/);
  });

  it("a staff placer's Turkish letter carries no money", () => {
    const r = renderOrderRequest(tr({ placer: STAFF }));
    expect(r.priceShown).toBe(false);
    expect(r.body).toContain("3 koli, her biri 6 şişe\n");
    expect(r.body).not.toMatch(/\d+,\d{2}|EUR|TRY|başına|birim fiyat/);
    expect(r.ask).toBe("confirm");
  });

  it("no price on file asks for a price, never to confirm", () => {
    const r = renderOrderRequest(tr({ lines: [{ ...NO_PRICE_LINE, unit: "case" }, { ...NO_PRICE_LINE, name: "İkinci" }] }));
    expect(r.ask).toBe("price");
    expect(r.body).toContain(
      "Bu sipariş için kayıtlı bir fiyatımız bulunmuyor. Lütfen her kalem için fiyatınızı, PO-1042 sipariş numarasını belirterek yanıtınızla bildiriniz.",
    );
    expect(r.body).not.toContain("onaylayınız");
  });

  it("a one-line order names its item in the subject; no date asks for one", () => {
    const r = renderOrderRequest(tr({ lines: [TR_LINES[0]], neededBy: null, vendorFirstName: null }));
    expect(r.subject).toBe("Sipariş PO-1042 — Tuzlu Rüzgar — Kavaklıdere Yakut 2021");
    expect(r.body).toContain("Merhaba,");
    expect(r.body).toContain("Lütfen yapabileceğiniz teslim tarihini bize bildiriniz.");
  });

  it("an unknown unit passes through as stored; a missing one says so", () => {
    const one = { ...TR_LINES[0], unit: "magnum", bottlesPerUnit: null };
    expect(renderOrderRequest(tr({ lines: [one] })).body).toContain(": 3 magnum;");
    expect(renderOrderRequest(tr({ lines: [{ ...one, unit: null }] })).body).toContain(": 3 (birim kayıtlı değil);");
    expect(renderOrderRequest(facts({ lines: [{ ...one, unit: "magnum" }] })).body).toContain(": 3 magnum at");
  });

  it("English writes the stored unit code in English words (one and many)", () => {
    const one = { ...TR_LINES[0], quantity: 1, bottlesPerUnit: null };
    expect(renderOrderRequest(facts({ lines: [{ ...one, unit: "case" }] })).body).toContain(": 1 case at");
    expect(renderOrderRequest(facts({ lines: [{ ...one, quantity: 3, unit: "case" }] })).body).toContain(": 3 cases at");
    expect(renderOrderRequest(facts({ lines: [{ ...one, unit: "split_case" }] })).body).toContain(": 1 split case at");
  });

  it("the Turkish default passes the prose predicate", () => {
    expect(orderRequestProseRefusals(DEFAULT_ORDER_REQUEST_TEMPLATE_TR)).toEqual([]);
  });

  it("the predicate and the courtesy rules are the same in Turkish", () => {
    const r = renderOrderRequest(tr(), { courtesySentence: "Yarın görüşmek dileğiyle." });
    expect(r.courtesyDropped).toBe(true);
    expect(() =>
      renderOrderRequest(tr(), { template: DEFAULT_ORDER_REQUEST_TEMPLATE_TR + "\nFiyatlar sabit kalsın." }),
    ).toThrow(OrderRequestTemplateRefused);
  });

  it.each([
    ["owner with a price", tr()],
    ["staff", tr({ placer: STAFF })],
    ["no price", tr({ lines: [NO_PRICE_LINE] })],
    ["one line, no placer", tr({ lines: [TR_LINES[0]], placer: NOBODY })],
  ])("the queue's guardrails trip nothing (%s)", (_label, f) => {
    const r = renderOrderRequest(f, { courtesySentence: "Hasadın iyi geçtiğini umuyoruz." });
    expect(r.courtesyDropped).toBe(false);
    expect(composerGuardrails({ body: r.body, subject: r.subject, priorOutboundOnOrder: 0 })).toEqual([]);
  });

  it("the facts hash moves with the locale", () => {
    expect(renderOrderRequest(facts({ locale: "tr" })).factsHash).not.toBe(renderOrderRequest(facts()).factsHash);
    expect(renderOrderRequest(facts({ locale: "en" })).factsHash).toBe(renderOrderRequest(facts()).factsHash);
  });
});

describe("houseLocale: the letter's language from restaurants.country", () => {
  it.each([
    ["TR", "tr"],
    [" tr ", "tr"],
    ["Turkey", "tr"],
    ["TURKEY", "tr"],
    ["Türkiye", "tr"],
    ["TÜRKİYE", "tr"],
    ["TURKIYE", "tr"],
    ["turkiye", "tr"],
    ["Norway", "en"],
    ["Turkmenistan", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ])("%p is %p", (country, want) => {
    expect(houseLocale(country as string | null | undefined)).toBe(want);
  });
});

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const VENDOR = "cccccccc-0000-4000-8000-cccccccccccc";
const ORDER = "dddddddd-0000-4000-8000-dddddddddddd";
const OWNER = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const STAFF_ID = "ffffffff-0000-4000-8000-ffffffffffff";

type Row = Record<string, unknown>;

function store(tables: Record<string, Row[]>, opts: { failing?: string[]; rpc?: any } = {}) {
  const rpcCalls: { fn: string; args: any }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    const run = () => {
      if (opts.failing?.includes(table)) {
        return { data: null, error: { message: `${table} is down` } };
      }
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const o of [...orders].reverse()) {
        rows = [...rows].sort((a, b) =>
          (a[o.col] as any) < (b[o.col] as any) ? (o.asc ? -1 : 1) : (a[o.col] as any) > (b[o.col] as any) ? (o.asc ? 1 : -1) : 0,
        );
      }
      return { data: rows, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orders.push({ col, asc: o?.ascending !== false });
        return q;
      },
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        if (r.data!.length > 1) return { data: null, error: { message: "more than one row" } };
        return { data: r.data![0] ?? null, error: null };
      },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };
  const supabase = {
    from,
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return opts.rpc ?? { data: { id: "conv-1", staged: true }, error: null };
    },
  };
  return { db: { supabase } as unknown as DatabaseService, rpcCalls };
}

function world(
  over: { createdBy?: string | null; linePrice?: number | null; staffRole?: string; country?: string | null } = {},
) {
  return {
    procurement_orders: [
      {
        id: ORDER,
        order_number: "PO-7",
        restaurant_id: HOUSE,
        provider_id: VENDOR,
        created_by: over.createdBy === undefined ? OWNER : over.createdBy,
        expected_delivery_date: null,
        // A no-price order stores 0 here (procurement.service.ts:1076); never read.
        final_price: 0,
      },
    ],
    procurement_order_items: [
      {
        order_id: ORDER,
        restaurant_id: HOUSE,
        wine_name: "Yakut",
        vendor_sku: "KY-75",
        quantity: 3,
        unit_type: "cases",
        bottles_per_unit: 6,
        final_unit_price: over.linePrice === undefined ? 25 : over.linePrice,
        negotiated_unit_price: null,
        quoted_unit_price: null,
        price_uom: "bottle",
        price_pack_size: null,
        currency: "EUR",
        line_no: 1,
        created_at: "2026-10-08T10:00:00Z",
      },
      // Another house's line on the same order id must never be read.
      { order_id: ORDER, restaurant_id: OTHER, wine_name: "Leak", quantity: 9, unit_type: "cases", line_no: 0 },
    ],
    restaurants: [
      {
        id: HOUSE,
        name: "Tuzlu Rüzgar",
        address: { street: "Moda Cd." },
        city: "Istanbul",
        country: over.country === undefined ? null : over.country,
      },
      { id: OTHER, name: "Other House" },
    ],
    providers: [
      { id: VENDOR, restaurant_id: HOUSE, contact_first_name: "Ayşe" },
      { id: VENDOR, restaurant_id: OTHER, contact_first_name: "Wrong" },
    ],
    restaurant_vendor_terms: [
      { restaurant_id: HOUSE, provider_id: VENDOR, payment_terms: "Net 30" },
      { restaurant_id: OTHER, provider_id: VENDOR, payment_terms: "Cash" },
    ],
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      { user_id: STAFF_ID, restaurant_id: HOUSE, role: over.staffRole ?? "staff", is_active: true },
      { user_id: STAFF_ID, restaurant_id: OTHER, role: "owner", is_active: true },
    ],
    users: [
      { user_id: OWNER, name: "Deniz", role: null, restaurant_id: null },
      { user_id: STAFF_ID, name: "Ali", role: null, restaurant_id: null },
    ],
  };
}

describe("OrderRequestService — facts under the order row's house", () => {
  it("renders from this house's rows only, with the owner's price", async () => {
    const { db } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.restaurantId).toBe(HOUSE);
    expect(r.body).toContain("Hello Ayşe,");
    expect(r.body).toContain("3 cases, 6 bottles each at 25.00 EUR per bottle");
    expect(r.body).toContain("Payment terms you gave us: Net 30");
    expect(r.body).toContain("Deliver to: Moda Cd., Istanbul");
    expect(r.body).not.toMatch(/Leak|Wrong|Cash|Other House/);
    expect(r.template).toEqual({ key: "order_request", source: "default" });
  });

  it("a Turkish house's letter is Turkish; a NULL country is English", async () => {
    const trHouse = await new OrderRequestService(store(world({ country: "Türkiye" })).db).render({
      orderId: ORDER,
      stage: false,
    });
    expect(trHouse.locale).toBe("tr");
    expect(trHouse.subject).toBe("Sipariş PO-7 — Tuzlu Rüzgar — Yakut");
    expect(trHouse.body).toContain("3 koli, her biri 6 şişe; şişe başına 25,00 EUR");
    expect(trHouse.body).toContain("Sipariş talebimiz aşağıdadır:");
    const en = await new OrderRequestService(store(world({ country: null })).db).render({ orderId: ORDER, stage: false });
    expect(en.locale).toBe("en");
    expect(en.factsHash).not.toBe(trHouse.factsHash);
  });

  it("an order of another house is a 404, the same as no order", async () => {
    const { db } = store(world());
    const svc = new OrderRequestService(db);
    await expect(svc.render({ orderId: ORDER, restaurantId: OTHER, stage: false })).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.render({ orderId: "99999999-0000-4000-8000-999999999999", stage: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a staff placer's letter shows no price (role read in THIS house)", async () => {
    const { db } = store(world({ createdBy: STAFF_ID }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.body).not.toMatch(/25\.00|EUR/);
    expect(r.parts.signer).toBe("Ali\nTuzlu Rüzgar");
  });

  it("an unreadable access register shows no price, even with a legacy owner role", async () => {
    // lookupRestaurantRole falls back to users.role and still reports the
    // failed read: the letter must take the failure, not the legacy role.
    const w = world();
    w.users = w.users.map((u: any) => (u.user_id === OWNER ? { ...u, role: "owner", restaurant_id: HOUSE } : u));
    const { db } = store(w, { failing: ["user_restaurant_access"] });
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.body).not.toMatch(/25\.00|EUR/);
  });

  it("a NULL creator shows no price and the house signs alone", async () => {
    const { db } = store(world({ createdBy: null }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.priceShown).toBe(false);
    expect(r.parts.signer).toBe("Tuzlu Rüzgar");
  });

  it("header final_price 0 with no line price asks for a price, never confirm", async () => {
    const { db } = store(world({ linePrice: null }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm|0\.00/i);
  });

  it("a line price of 0 is no price on file", async () => {
    const { db } = store(world({ linePrice: 0 }));
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(r.ask).toBe("price");
    expect(r.body).not.toMatch(/confirm|0\.00/i);
  });

  it("a failed terms read is a failure, not 'no terms'", async () => {
    const { db } = store(world(), { failing: ["restaurant_vendor_terms"] });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: false })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("OrderRequestService — staging through stage_order_letter", () => {
  it("does not touch the door without stage", async () => {
    const { db, rpcCalls } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: false });
    expect(rpcCalls).toEqual([]);
    expect(r.staged).toBeNull();
  });

  it("stages an ORDER_REQUEST with p_kind and the provenance headers", async () => {
    const { db, rpcCalls } = store(world());
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: true });
    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe("stage_order_letter");
    expect(args.p_kind).toBe("ORDER_REQUEST");
    expect(args.p_row).toMatchObject({
      order_id: ORDER,
      restaurant_id: HOUSE,
      provider_id: VENDOR,
      direction: "outbound",
      status: "PENDING_APPROVAL",
      outbound_email_type: "ORDER_REQUEST",
      disclaimer_appended: true,
      message_text: r.body,
      email_headers: {
        subject: r.subject,
        template_key: "order_request",
        renderer_version: r.rendererVersion,
        facts_hash: r.factsHash,
      },
    });
    expect(r.staged).toBe(true);
    expect(r.conversationId).toBe("conv-1");
  });

  it("relays staged:false with the live letter's id", async () => {
    const { db } = store(world(), { rpc: { data: { id: "conv-old", staged: false }, error: null } });
    const r = await new OrderRequestService(db).render({ orderId: ORDER, stage: true });
    expect(r.staged).toBe(false);
    expect(r.conversationId).toBe("conv-old");
  });

  it("PGRST202 (door not deployed) is a 503 that stages nothing", async () => {
    const { db } = store(world(), { rpc: { data: null, error: { code: "PGRST202", message: "not found" } } });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: true })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("any other door error is a 500, never reported as staged", async () => {
    const { db } = store(world(), { rpc: { data: null, error: { code: "23514", message: "check" } } });
    await expect(new OrderRequestService(db).render({ orderId: ORDER, stage: true })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("OrderRequestController — a service door, not a person's", () => {
  const handler = OrderRequestController.prototype.orderRequest;

  it("sits at internal/letters, behind ServiceKeyGuard and nothing else", () => {
    expect(Reflect.getMetadata(PATH_METADATA, OrderRequestController)).toBe("internal/letters");
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([ServiceKeyGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    // No class guard: a class JwtAuthGuard would refuse the service outright.
    expect(Reflect.getMetadata(GUARDS_METADATA, OrderRequestController)).toBeUndefined();
  });

  // Gate note N1 at 3bdd75025: the metadata test above proves the guard is
  // attached, not that it denies. This drives the route over HTTP with the
  // real ServiceKeyGuard: only the configured key reaches the service.
  describe("over HTTP, with the real ServiceKeyGuard", () => {
    let app: INestApplication;
    let url: string;
    const render = jest.fn().mockResolvedValue({ subject: "s", body: "b", staged: false });
    const savedKey = process.env.ADMIN_API_KEY;
    const KEY = "k-test-0123456789abcdef";

    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [OrderRequestController],
        providers: [
          ServiceKeyGuard,
          { provide: OrderRequestService, useValue: { render } },
          // Read the env live, so each test can set or unset the key.
          { provide: ConfigService, useValue: { get: (k: string, d?: string) => process.env[k] ?? d } },
        ],
      }).compile();
      app = mod.createNestApplication({ logger: false });
      await app.listen(0, "127.0.0.1");
      url = `${await app.getUrl()}/internal/letters/order-request`.replace("[::1]", "127.0.0.1");
    });
    afterAll(async () => {
      await app.close();
      if (savedKey === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = savedKey;
    });
    beforeEach(() => {
      render.mockClear();
      process.env.ADMIN_API_KEY = KEY;
    });

    const post = (headers: Record<string, string> = {}) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ order_id: ORDER }),
      });

    it("a missing X-Admin-Key is 401 and never reaches the service", async () => {
      expect((await post()).status).toBe(401);
      expect(render).not.toHaveBeenCalled();
    });

    it("a wrong key is 401, of the same length or not", async () => {
      expect((await post({ "x-admin-key": "k-test-0123456789abcdeX" })).status).toBe(401);
      expect((await post({ "x-admin-key": "nope" })).status).toBe(401);
      expect((await post({ "x-admin-key": "" })).status).toBe(401);
      expect(render).not.toHaveBeenCalled();
    });

    it("an unset or blank ADMIN_API_KEY is 401 for every caller, even one sending an empty key", async () => {
      for (const unset of [undefined, "", "   "]) {
        if (unset === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = unset;
        expect((await post()).status).toBe(401);
        expect((await post({ "x-admin-key": "" })).status).toBe(401);
        expect((await post({ "x-admin-key": KEY })).status).toBe(401);
      }
      expect(render).not.toHaveBeenCalled();
    });

    it("only the configured key passes, and then the service renders", async () => {
      const res = await post({ "x-admin-key": KEY });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, staged: false });
      expect(render).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses an unknown field and a non-uuid order", async () => {
    const svc = { render: jest.fn() } as unknown as OrderRequestService;
    const c = new OrderRequestController(svc);
    await expect(c.orderRequest({ order_id: ORDER, restaurantId: HOUSE })).rejects.toThrow(/Unknown field/);
    await expect(c.orderRequest({ order_id: "x" })).rejects.toThrow(/uuid/);
    expect((svc.render as jest.Mock).mock.calls).toHaveLength(0);
  });
});
