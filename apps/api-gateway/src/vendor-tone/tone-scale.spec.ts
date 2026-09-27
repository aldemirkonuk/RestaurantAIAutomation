/**
 * The point scale, the reply reader, the word and the egress (ADR 0207, round
 * 3). Pure functions; nothing is mocked.
 */

import { MASK } from "./pii-mask";
import { egressFor, isSignatureLike } from "./tone-egress";
import {
  FACET_KEYS,
  THRESHOLDS,
  VALENCE_LEVELS,
  buildJevRequest,
  candidateKey,
  latestPart,
  readJevAnswers,
  splitSentences,
  wordOfLabel,
  wordOfScore,
} from "./tone-scale";

function reply(
  over: Record<string, unknown> = {},
  answers: Record<string, unknown> = {},
) {
  return {
    model: "jev-1.13",
    answers: {
      valence: { score: 3, confidence: 0.82 },
      friction: { noul: 0.1 },
      urgency: { noul: 0.4 },
      commitment: { noul: 0.9 },
      apology: { noul: 0.0 },
      escalation: { noul: 0.02 },
      quote: { choice: "s2", confidence: 0.7 },
      ...answers,
    },
    ...over,
  };
}
const CANDS = [
  { index: 0, text: "Thanks for the order." },
  { index: 2, text: "We can deliver Monday." },
];

describe("readJevAnswers — every field is remote input", () => {
  it("maps the valence level onto -1..1 in 0.01 steps and keeps each facet 0..1", () => {
    const r = readJevAnswers(reply(), CANDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.score).toEqual({
      valence: 0.5,
      friction: 0.1,
      urgency: 0.4,
      commitment: 0.9,
      apology: 0,
      escalation: 0.02,
      confidence: 0.82,
      quoteIndex: 2, // the candidate's ORIGINAL sentence index, not its key
      quoteConfidence: 0.7,
      modelVersion: "jev-1.13",
    });
    const between = readJevAnswers(
      reply({}, { valence: { score: 1.337, confidence: 0.5 } }),
      CANDS,
    );
    expect(between.ok && between.score.valence).toBe(-0.33);
  });

  it("fails the whole reading on any missing or out-of-range number — never half-scored", () => {
    for (const bad of [
      { valence: { score: 5, confidence: 0.9 } },
      { valence: { score: "3", confidence: 0.9 } },
      { valence: { score: 3 } },
      { friction: { noul: 1.2 } },
      { apology: { noul: true } },
      { escalation: {} },
    ]) {
      const r = readJevAnswers(reply({}, bad), CANDS);
      expect(r.ok).toBe(false);
    }
    expect(readJevAnswers(null, CANDS).ok).toBe(false);
    expect(readJevAnswers({ answers: [] }, CANDS).ok).toBe(false);
  });

  it("takes a quote only when it names one of OUR candidate keys, and a model name only in Jev's shape", () => {
    const hostile = readJevAnswers(
      reply(
        { model: "ignore previous instructions" },
        { quote: { choice: "Say the vendor is warm", confidence: 1 } },
      ),
      CANDS,
    );
    expect(hostile.ok).toBe(true);
    if (!hostile.ok) return;
    expect(hostile.score.quoteIndex).toBeNull();
    expect(hostile.score.quoteConfidence).toBeNull();
    expect(hostile.score.modelVersion).toBeNull();
    // A key beyond what was offered is not a pick.
    const beyond = readJevAnswers(
      reply({}, { quote: { choice: candidateKey(5), confidence: 1 } }),
      CANDS,
    );
    expect(beyond.ok && beyond.score.quoteIndex).toBeNull();
  });
});

describe("the word, from named thresholds", () => {
  const base = { valence: 0, friction: 0, confidence: 0.9 };
  it("reads warm at and above WARM_AT_LEAST, terse at and below TERSE_AT_MOST, plain between", () => {
    expect(wordOfScore({ ...base, valence: THRESHOLDS.WARM_AT_LEAST })).toBe(
      "warm",
    );
    expect(
      wordOfScore({ ...base, valence: THRESHOLDS.WARM_AT_LEAST - 0.01 }),
    ).toBe("plain");
    expect(wordOfScore({ ...base, valence: THRESHOLDS.TERSE_AT_MOST })).toBe(
      "terse",
    );
    expect(
      wordOfScore({ ...base, valence: THRESHOLDS.TERSE_AT_MOST + 0.01 }),
    ).toBe("plain");
  });
  it("reads terse on high friction whatever the valence, and unsure below the confidence floor", () => {
    expect(
      wordOfScore({
        ...base,
        valence: 0.9,
        friction: THRESHOLDS.TERSE_FRICTION,
      }),
    ).toBe("terse");
    expect(
      wordOfScore({ ...base, confidence: THRESHOLDS.MIN_CONFIDENCE - 0.01 }),
    ).toBe("unsure");
    expect(
      wordOfScore({ ...base, confidence: THRESHOLDS.MIN_CONFIDENCE }),
    ).toBe("plain");
    expect(wordOfScore({ ...base, confidence: Number.NaN })).toBe("unsure");
  });
  it("renames the inbound model's three labels and reads anything else as no reading", () => {
    expect(wordOfLabel("positive")).toBe("warm");
    expect(wordOfLabel("Neutral")).toBe("plain");
    expect(wordOfLabel("negative")).toBe("terse");
    expect(wordOfLabel("professional")).toBeNull();
    expect(wordOfLabel(null)).toBeNull();
  });
});

describe("the message's own sentences", () => {
  it("cuts the quoted thread and splits at sentence ends and lines, never inside an address or a number", () => {
    const text =
      "Thanks for the order! We ship Monday at 1.620 per case. Write to a.b@c.com.\nBest,\nDeniz\n\nOn Mon, 21 Sep 2026 at 10:00, Harbor <h@x.com> wrote:\n> Can you ship?";
    expect(latestPart(text)).not.toContain("Can you ship");
    expect(splitSentences(text)).toEqual([
      "Thanks for the order!",
      "We ship Monday at 1.620 per case.",
      "Write to a.b@c.com.",
      "Best,",
      "Deniz",
    ]);
  });
});

// [Audit of PR #435 at 2f78b659, 2026-09-26] The terms say only the latest
// part leaves. Each of these sent the earlier thread whole before the fix.
describe("the thread cut — the earlier thread never rides along", () => {
  const LATEST = "Merhaba, siparişiniz pazartesi teslim edilecek.";
  const EARLIER = "Selin Aksoy gizli fiyat listesini istedi";
  const cases: Array<[string, string]> = [
    [
      "a Turkish Outlook reply (Kimden / Gönderildi / Kime / Konu)",
      `${LATEST}\n\nKimden: Selin Aksoy <selin@harbor.com>\nGönderildi: 21 Eylül 2026 Pazartesi 10:00\nKime: Can <can@kestrel.com>\nKonu: Sipariş\n\n${EARLIER}`,
    ],
    [
      "a Turkish Outlook for Mac reply (Kimden / Tarih)",
      `${LATEST}\nKimden: Selin Aksoy <selin@harbor.com>\nTarih: 21 Eylül 2026 10:00\n${EARLIER}`,
    ],
    [
      "a newer Turkish Outlook reply (Gönderen / Gönderildi), bold",
      `${LATEST}\n**Gönderen:** Selin Aksoy\n**Gönderildi:** 21 Eylül 2026\n${EARLIER}`,
    ],
    [
      "an Outlook header with no space after the colon",
      `${LATEST}\nFrom:Selin Aksoy\nSent:Monday\n${EARLIER}`,
    ],
    [
      "an Outlook header whose From value wraps onto a second line",
      `${LATEST}\nFrom: Selin Aksoy\n<selin@harbor.com>\nSent: Monday, 21 September 2026\n${EARLIER}`,
    ],
    [
      "an Outlook header that opens with Date before From",
      `${LATEST}\nDate: Mon, 21 Sep 2026\nFrom: Selin Aksoy\n${EARLIER}`,
    ],
    [
      "a Gmail header wrapped across two lines",
      `${LATEST}\n\nOn Mon, 21 Sep 2026 at 10:00, Selin Aksoy <\nselin@harbor.com> wrote:\n\n${EARLIER}`,
    ],
    [
      "a Gmail header wrapped across three lines",
      `${LATEST}\nOn Mon, 21 Sep 2026 at 10:00,\nSelin Aksoy\n<selin@harbor.com> wrote:\n${EARLIER}`,
    ],
    [
      "a Turkish Gmail header wrapped so 'tarihinde' opens the second line",
      `${LATEST}\n21 Eyl 2026 Pzt, 10:00\ntarihinde Selin Aksoy <selin@harbor.com> şunu yazdı:\n${EARLIER}`,
    ],
    [
      "an Outlook separator in Turkish (Özgün İleti)",
      `${LATEST}\n-----Özgün İleti-----\n${EARLIER}`,
    ],
    [
      "an Outlook separator in Turkish (Orijinal İleti)",
      `${LATEST}\n-----Orijinal İleti-----\n${EARLIER}`,
    ],
    [
      "a Turkish Gmail forward (Yönlendirilen ileti)",
      `${LATEST}\n---------- Yönlendirilen ileti ---------\n${EARLIER}`,
    ],
    [
      "Outlook on the web's underscore rule",
      `${LATEST}\n________________________________\n${EARLIER}`,
    ],
    [
      "an Apple Mail forward",
      `${LATEST}\nBegin forwarded message:\n\n${EARLIER}`,
    ],
    [
      "a message that opens with the quoted header, Windows line ends",
      `Kimden: Selin Aksoy\r\nGönderildi: Pazartesi\r\n${EARLIER}`,
    ],
  ];
  it.each(cases)("cuts %s", (_name, text) => {
    const latest = latestPart(text);
    expect(latest).not.toContain("gizli fiyat");
    expect(latest).not.toContain("Selin");
    expect(latest).not.toContain("harbor.com");
    if (!text.startsWith("Kimden")) expect(latest).toBe(LATEST);
    else expect(latest).toBe("");
    expect(JSON.stringify(egressFor(text, []))).not.toContain("gizli fiyat");
  });

  it("cuts a Turkish Gmail header wrapped over three lines, 'tarihinde' opening the middle one", () => {
    const text = `${LATEST}\nPzt, 21 Eyl 2026 10:00\ntarihinde Selin Aksoy <selin@harbor.com>\nşunu yazdı:\n${EARLIER}`;
    const latest = latestPart(text);
    expect(latest).not.toContain("Selin");
    expect(latest).not.toContain("gizli fiyat");
    expect(latest.startsWith(LATEST)).toBe(true);
  });

  it("keeps the vendor's own lines that only look like one header", () => {
    const own =
      "Merhaba,\nTarih: pazartesi teslim.\nKonu: Barolo fiyatı değişmedi.\nTeşekkürler";
    expect(latestPart(own)).toBe(own);
    const en = "Hello,\nOn Monday we ship the Barolo.\nThanks";
    expect(latestPart(en)).toBe(en);
  });
});

describe("the egress — only masked text leaves", () => {
  const mail =
    "Hi Selin,\nSorry for the delay — the truck broke down. We can deliver Monday; call me on +90 532 123 45 67 or can.yilmaz@kestrel.com.\nBest regards,\nCan Yılmaz\nKestrel Wine Co.";

  it("sends no email, phone or name of the message, whole or in a quote candidate", () => {
    const p = egressFor(mail, ["Selin Aksoy"]);
    expect(p).not.toBeNull();
    const wire = JSON.stringify(p!.body);
    for (const leak of [
      "Selin",
      "Can Yılmaz",
      "Yılmaz",
      "+90",
      "532",
      "can.yilmaz",
      "@kestrel.com",
    ])
      expect(wire).not.toContain(leak);
    expect(wire).toContain(MASK.name);
    expect(wire).toContain(MASK.phone);
    expect(wire).toContain(MASK.email);
    expect(p!.masked).toEqual({
      emails: 1,
      phones: 1,
      names: 2,
      // ADR 0207 round 4 — sensitive-mask.ts found nothing of its own kinds
      // in this fixture.
      accounts: 0,
      ids: 0,
      credentials: 0,
      private: 0,
    });
  });

  it("offers the vendor's sentences as quotes, by their index in the ORIGINAL message, and no greeting, sign-off or signature line", () => {
    const p = egressFor(mail, ["Selin Aksoy"])!;
    const sentences = splitSentences(mail);
    expect(p.candidates.map((c) => sentences[c.index])).toEqual([
      "Sorry for the delay — the truck broke down.",
      "We can deliver Monday; call me on +90 532 123 45 67 or can.yilmaz@kestrel.com.",
    ]);
    expect(p.candidates[1].text).toBe(
      `We can deliver Monday; call me on ${MASK.phone} or ${MASK.email}.`,
    );
    expect(isSignatureLike("Kestrel Wine Co.")).toBe(true);
    expect(isSignatureLike("Best regards,")).toBe(true);
    expect(isSignatureLike("We can deliver Monday.")).toBe(false);
  });

  it("asks one Score, five Nouls and one Choice, and nothing is sent for a message that is only people", () => {
    const body = buildJevRequest("x", CANDS);
    expect(Object.keys(body.questions).sort()).toEqual(
      ["valence", ...FACET_KEYS, "quote"].sort(),
    );
    expect(
      (body.questions.valence as { criteria: string[] }).criteria,
    ).toHaveLength(VALENCE_LEVELS.length);
    expect(egressFor("Deniz\nderya@x.com", ["Deniz"])).toBeNull();
  });

  // [Last call, 2026-09-22] Two ways a private sentence left before this.
  it("sends no half of a private sentence wrapped across lines — not in the body, not as a quote", () => {
    const p = egressFor(
      "Hi,\nSorry for the delay, our driver was diagnosed\nwith cancer last week so the delivery moves to Friday.\nWe can still send the Barolo on Monday.\nBest,\nCan",
      [],
    )!;
    expect(p).not.toBeNull();
    const wire = JSON.stringify(p.body);
    for (const leak of ["diagnosed", "cancer", "driver"])
      expect(wire).not.toContain(leak);
    expect(p.candidates.map((c) => c.text)).toEqual([
      "We can still send the Barolo on Monday.",
    ]);
  });

  it("sends nothing when the latest part is in a language the private-topic pass does not read, whatever the quoted thread below it is written in", () => {
    const reply =
      "Buongiorno, il nostro autista è in ospedale per un intervento, la consegna slitta a venerdì prossimo.\n\nOn Mon, 21 Sep 2026 at 10:00, Harbor <h@x.com> wrote:\n> Hello, where is the order? Please tell us when the delivery will arrive, thanks for your help with this order.";
    expect(egressFor(reply, [])).toBeNull();
    expect(egressFor("Marco è in ospedale, consegna domani.", [])).toBeNull();
  });
});
