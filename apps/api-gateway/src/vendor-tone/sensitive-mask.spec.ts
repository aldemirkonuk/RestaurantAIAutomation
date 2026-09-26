/**
 * "Sensitive topics redacted" (ADR 0207 round 4). Pure; nothing mocked.
 *
 * NOTE ON SCOPE (CLAUDE.md §0.5): the ADR's design calls for a gold set of
 * >=40 must-redact and >=30 must-keep sentences. This file covers every
 * category named in `sensitive-mask.ts`'s `TOPIC_TERMS` groups and the named
 * must-keep guards from the adversarial pass, but is smaller than that floor
 * — the full gold set is a named gap in the round's build report, not a
 * silent shortfall.
 */

import {
  SENSITIVE_MASK,
  ibanValid,
  luhnValid,
  languageCovered,
  maskSensitive,
  maskSensitiveShapes,
  maskSensitiveTopics,
  tcknValid,
} from "./sensitive-mask";

describe("shapes — checksums", () => {
  it("validates a real IBAN (Deutsche Bank test IBAN) and rejects a one-digit-off one", () => {
    expect(ibanValid("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(ibanValid("DE89 3704 0044 0532 0130 01")).toBe(false);
  });
  it("validates a Turkish IBAN shape", () => {
    expect(ibanValid("TR33 0006 1005 1978 6457 8413 26")).toBe(true);
  });
  it("validates a Luhn card number and rejects an order number of the same length", () => {
    expect(luhnValid("4111 1111 1111 1111")).toBe(true);
    // A Luhn-invalid 16-digit run — an order number, not a card.
    expect(luhnValid("4111 1111 1111 1112")).toBe(false);
  });
  it("validates a real TCKN and rejects a made-up 11-digit run (an order number)", () => {
    expect(tcknValid("10000000146")).toBe(true); // a known-valid test TCKN
    expect(tcknValid("12345678901")).toBe(false);
  });
});

describe("maskSensitiveShapes", () => {
  it("masks a valid IBAN and a valid card as [account], keeps an invalid one", () => {
    const r = maskSensitiveShapes(
      "Pay to DE89 3704 0044 0532 0130 00 or card 4111 1111 1111 1111. Order 4111 1111 1111 1112 shipped.",
    );
    expect(r.text).toContain(
      `Pay to ${SENSITIVE_MASK.account} or card ${SENSITIVE_MASK.account}.`,
    );
    expect(r.text).toContain("Order 4111 1111 1111 1112 shipped.");
    expect(r.counts.accounts).toBe(2);
  });
  it("masks a valid TCKN as [id], keeps an invalid 11-digit run", () => {
    const r = maskSensitiveShapes(
      "TCKN 10000000146 on file. Order number 20260921001 confirmed.",
    );
    expect(r.text).toContain(`TCKN ${SENSITIVE_MASK.id} on file.`);
    expect(r.text).toContain("Order number 20260921001 confirmed.");
    expect(r.counts.ids).toBe(1);
  });
  it("masks a US SSN shape as [id]", () => {
    const r = maskSensitiveShapes("SSN 123-45-6789 for the 1099.");
    expect(r.text).toBe(`SSN ${SENSITIVE_MASK.id} for the 1099.`);
    expect(r.counts.ids).toBe(1);
  });
  it("masks the value of a labelled credential line, keeping the label", () => {
    const r = maskSensitiveShapes("Password: hunter2fortress\nNext line unrelated.");
    expect(r.text).toBe(
      `Password: ${SENSITIVE_MASK.credential}\nNext line unrelated.`,
    );
    expect(r.counts.credentials).toBe(1);
  });
  it("masks a Turkish credential label", () => {
    const r = maskSensitiveShapes("Şifre: abc123");
    expect(r.text).toBe(`Şifre: ${SENSITIVE_MASK.credential}`);
  });
});

describe("maskSensitiveTopics — must redact", () => {
  const mustRedact: [string, string][] = [
    ["health", "Ahmet is in the hospital after surgery."],
    ["health-tr", "Mehmet hastanede, ameliyat oldu."],
    ["bereavement", "We are dealing with a funeral in the family this week."],
    ["bereavement-tr", "Ailede bir vefat oldu, başsağlığı diliyoruz."],
    ["divorce", "She is going through a divorce right now."],
    ["union", "He is a trade union member and was on strike yesterday."],
    ["union-tr", "Sendika üyesi olduğu için grevde."],
    ["political", "He mentioned his political party affiliation in passing."],
    ["religion", "The delay is because of his religious belief obligations."],
    ["criminal", "Their driver was arrested last month, a criminal record now."],
    ["immigration", "Her immigration status is under review at the consulate."],
    ["genetic", "The lab ran a genetic test on the sample by mistake."],
  ];
  it.each(mustRedact)("%s: replaces the whole sentence with [private]", (_label, sentence) => {
    const r = maskSensitiveTopics(sentence);
    expect(r.text.trim()).toBe(SENSITIVE_MASK.private);
    expect(r.counts.private).toBe(1);
  });

  it("redacts only the offending sentence, leaving the rest of the line intact", () => {
    const r = maskSensitiveTopics(
      "The wine ships Tuesday. Ahmet is in the hospital. See you then.",
    );
    expect(r.text).toBe(
      `The wine ships Tuesday. ${SENSITIVE_MASK.private} See you then.`,
    );
    expect(r.counts.private).toBe(1);
  });

  it("matches Turkish suffixed forms of a stem", () => {
    const r = maskSensitiveTopics("Hastalıktan dolayı bugün gelemeyecek.");
    expect(r.text.trim()).toBe(SENSITIVE_MASK.private);
  });
});

describe("maskSensitiveTopics — must keep (the adversarial pass's named guards)", () => {
  const mustKeep: [string, string][] = [
    ["winery name", "Dr. Loosen Riesling arrived in good condition."],
    ["EU not union", "European Union tariffs raised the landed cost."],
    ["catering party", "We need six cases for the party on Saturday."],
    ["certification", "The batch is helal sertifikalı and ready to ship."],
    ["courtesy apology", "Rahatsız ettiğim için özür dilerim, teslimat gecikti."],
    ["business dispute", "We will pursue legal action if this invoice is not paid."],
    ["insolvency", "The distributor filed for konkordato last week."],
    ["report noun alone", "Please find the inspection report attached."],
    ["wine grape", "The Pinot Noir shipment is delayed by customs."],
    ["public holiday", "There is no delivery during Kurban Bayramı."],
  ];
  it.each(mustKeep)("%s: passes through unchanged", (_label, sentence) => {
    const r = maskSensitiveTopics(sentence);
    expect(r.text).toBe(sentence);
    expect(r.counts.private).toBe(0);
  });
});

describe("maskSensitive — both passes, in order", () => {
  it("masks a shape and a private sentence in the same message", () => {
    const r = maskSensitive(
      "IBAN TR33 0006 1005 1978 6457 8413 26 on file. Ahmet is in the hospital.",
    );
    expect(r.text).toBe(
      `IBAN ${SENSITIVE_MASK.account} on file. ${SENSITIVE_MASK.private}`,
    );
    expect(r.counts).toEqual({ private: 1, accounts: 1, ids: 0, credentials: 0 });
  });
});

describe("languageCovered — fail closed on an uncovered language", () => {
  it("reads English", () => {
    expect(
      languageCovered(
        "Thank you for the order, we will confirm delivery for Tuesday.",
      ),
    ).toBe(true);
  });
  it("reads Turkish", () => {
    expect(
      languageCovered(
        "Siparişiniz için teşekkür ederiz, teslimat salı günü onaylanacak.",
      ),
    ).toBe(true);
  });
  it("does not claim coverage of Italian wine mail", () => {
    expect(
      languageCovered(
        "Grazie per il vostro ordine, la consegna sarà confermata per martedì prossimo con corriere espresso.",
      ),
    ).toBe(false);
  });
  // [Last call, 2026-09-22: this case asserted the opposite — "treats a short
  // message as too little to call unreadable" — which sent a short Italian
  // health sentence unread by the topics pass. Choice 30 is fail closed.]
  it("fails closed on a short message with no English or Turkish word in it", () => {
    expect(languageCovered("Grazie mille!")).toBe(false);
    expect(languageCovered("Marco è in ospedale, consegna domani.")).toBe(false);
  });
  it("still reads a short English or Turkish reply", () => {
    expect(languageCovered("Noted, thanks.")).toBe(true);
    expect(languageCovered("Shipped today.")).toBe(true);
    expect(languageCovered("Tamam, teşekkürler.")).toBe(true);
    expect(languageCovered("Hayır, yarın.")).toBe(true);
  });
  it("sends nothing it cannot read: a text of digits alone has no sentence to hide a topic in", () => {
    expect(languageCovered("12 x 6")).toBe(true);
  });
});

describe("a private sentence wrapped across lines goes whole (last call, 2026-09-22)", () => {
  it("masks both halves of a wrapped health sentence, and the phrase broken by the wrap", () => {
    const r = maskSensitiveTopics(
      "Sorry for the delay, our driver was diagnosed\nwith cancer last week so the delivery moves to Friday.\nBest,\nKestrel",
    );
    expect(r.text).toBe(`${SENSITIVE_MASK.private}\nBest,\nKestrel`);
    expect(r.text).not.toContain("diagnosed");
    expect(r.counts.private).toBe(1);
  });
  it("masks the first half of a wrapped bereavement sentence too", () => {
    const r = maskSensitiveTopics(
      "The delivery is late because our owner's mother passed away and he is at the\nfuneral today. We will deliver on Friday.",
    );
    expect(r.text).toBe(`${SENSITIVE_MASK.private} We will deliver on Friday.`);
  });
  it("keeps a blank line between paragraphs, and the paragraph that is not private", () => {
    const r = maskSensitiveTopics(
      "Hi,\n\nAhmet is in the hospital.\n\nThe wine ships Tuesday.",
    );
    expect(r.text).toBe(`Hi,\n\n${SENSITIVE_MASK.private}\n\nThe wine ships Tuesday.`);
  });
});

describe("the plainest words for being ill, a death, a pregnancy or a password (last call, 2026-09-22)", () => {
  const mustRedact: [string, string][] = [
    ["tr sick", "Şoförümüz hasta olduğu için teslimat cumaya kaldı."],
    ["en off sick", "Our rep is off sick this week so the order ships Monday."],
    ["doctor", "He has a doctor's appointment, so no delivery today."],
    ["passed away", "His father passed away last week."],
    ["tr condolence, spaced", "Babanız için baş sağlığı dileriz."],
    ["tr condolence, ascii", "Babaniz icin bas sagligi dileriz."],
    ["pregnancy", "Our account manager is on maternity leave after a difficult pregnancy."],
    ["tr pregnancy", "Muhasebecimiz hamile, doğum iznine çıktı."],
    ["password in a sentence", "The portal password is Hunter22 for your account."],
    ["tr password", "Portal şifreniz Kestrel2026 olarak ayarlandı."],
  ];
  it.each(mustRedact)("%s: replaces the whole sentence with [private]", (_label, sentence) => {
    const r = maskSensitiveTopics(sentence);
    expect(r.text.trim()).toBe(SENSITIVE_MASK.private);
  });
  const mustKeep: [string, string][] = [
    ["sick of delays is a complaint, not health", "We are sick of these delays and want a credit."],
    ["Dr. is still a winery", "Dr. Loosen Riesling arrived in good condition."],
  ];
  it.each(mustKeep)("%s: passes through unchanged", (_label, sentence) => {
    expect(maskSensitiveTopics(sentence).text).toBe(sentence);
  });
});

describe("mutation guards — each category emptied is a silent hole", () => {
  it("a listed must-redact stem still matches after ASCII-folding (ı -> i, no diacritics)", () => {
    // "hastalıktan" is a simple suffix on the listed stem "hastalık" (no
    // Turkish consonant mutation involved, unlike "hastalığından" — k->ğ
    // softening changes the stem itself and is out of this pass's scope).
    const folded = maskSensitiveTopics("Hastaliktan dolayi gelemeyecek.");
    expect(folded.text.trim()).toBe(SENSITIVE_MASK.private);
  });
});
