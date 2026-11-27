import {
  deriveTransportSignals,
  extractEmailAddress,
  looksPromotional,
  transportImpliesNoReply,
  replySkipReason,
  senderAuthOf,
} from "./email-triage";

describe("email-triage", () => {
  describe("extractEmailAddress", () => {
    it("pulls the address out of an angled From header", () => {
      expect(extractEmailAddress("Jean Dupont <jean@vin-vendor.fr>")).toBe(
        "jean@vin-vendor.fr",
      );
    });
    it("handles a bare address and lowercases it", () => {
      expect(extractEmailAddress("Sales@Vendor.COM")).toBe("sales@vendor.com");
    });
    it("returns empty string for missing input", () => {
      expect(extractEmailAddress(undefined)).toBe("");
      expect(extractEmailAddress("")).toBe("");
    });
  });

  describe("deriveTransportSignals — marketing blast", () => {
    const signals = deriveTransportSignals({
      from: "Château Margaux <news@margaux-selections.com>",
      precedence: "bulk",
      "list-unsubscribe": "<https://margaux-selections.com/u/123>",
      "x-mailer": "Mailchimp Mailer 3.0",
      "authentication-results":
        "mx.google.com; spf=pass smtp.mailfrom=margaux-selections.com; dkim=pass header.i=@margaux-selections.com; dmarc=pass header.from=margaux-selections.com",
    });

    it("flags it as automated via bulk + list + esp + no-reply", () => {
      expect(signals.bulk).toBe(true);
      expect(signals.listMail).toBe(true);
      expect(signals.esp).toBe("mailchimp");
      expect(signals.noReplyFrom).toBe(true);
      expect(signals.isAutomated).toBe(true);
    });

    it("still records that DKIM/DMARC passed (verified but automated)", () => {
      expect(signals.dkimPass).toBe(true);
      expect(signals.dmarcPass).toBe(true);
      expect(signals.senderVerified).toBe(true);
    });

    it("transport alone says do not reply", () => {
      expect(transportImpliesNoReply(signals)).toBe(true);
    });
  });

  describe("deriveTransportSignals — genuine negotiation reply", () => {
    const signals = deriveTransportSignals({
      from: "Jean Dupont <jean@vin-vendor.fr>",
      subject: "Re: your order",
      "authentication-results":
        "mx.google.com; spf=pass smtp.mailfrom=vin-vendor.fr; dkim=pass header.i=@vin-vendor.fr; dmarc=pass",
    });

    it("is not automated and is sender-verified", () => {
      expect(signals.isAutomated).toBe(false);
      expect(signals.senderVerified).toBe(true);
      expect(signals.bulk).toBe(false);
      expect(signals.listMail).toBe(false);
      expect(signals.noReplyFrom).toBe(false);
    });

    it("transport does not block a reply", () => {
      expect(transportImpliesNoReply(signals)).toBe(false);
    });
  });

  describe("deriveTransportSignals — out-of-office autoreply", () => {
    const signals = deriveTransportSignals({
      from: "jean@vin-vendor.fr",
      "auto-submitted": "auto-replied",
      subject: "Automatic reply: Out of office",
    });
    it("detects auto-submitted and marks automated", () => {
      expect(signals.autoSubmitted).toBe(true);
      expect(signals.isAutomated).toBe(true);
      expect(transportImpliesNoReply(signals)).toBe(true);
    });
    it("treats Auto-Submitted: no as not automated", () => {
      const s = deriveTransportSignals({
        from: "jean@vin-vendor.fr",
        "auto-submitted": "no",
      });
      expect(s.autoSubmitted).toBe(false);
    });
  });

  describe("deriveTransportSignals — failing / spoofed auth", () => {
    const signals = deriveTransportSignals({
      from: "Sales <sales@realvendor.com>",
      "authentication-results":
        "mx.google.com; spf=fail smtp.mailfrom=attacker.example; dkim=fail; dmarc=fail",
    });
    it("is NOT sender-verified when DKIM and DMARC fail", () => {
      expect(signals.dkimPass).toBe(false);
      expect(signals.dmarcPass).toBe(false);
      expect(signals.spfPass).toBe(false);
      expect(signals.senderVerified).toBe(false);
    });
  });

  describe('deriveTransportSignals — SPF pass alone is not "verified"', () => {
    const signals = deriveTransportSignals({
      from: "sales@vendor.com",
      "authentication-results":
        "mx.google.com; spf=pass smtp.mailfrom=vendor.com",
    });
    it("records spf pass but leaves dkim/dmarc unknown and senderVerified false", () => {
      expect(signals.spfPass).toBe(true);
      expect(signals.dkimPass).toBeNull();
      expect(signals.dmarcPass).toBeNull();
      expect(signals.senderVerified).toBe(false);
    });
  });

  describe("deriveTransportSignals — empty / missing headers", () => {
    it("never throws and returns safe defaults", () => {
      const s = deriveTransportSignals(undefined);
      expect(s.isAutomated).toBe(false);
      expect(s.senderVerified).toBe(false);
      expect(s.spfPass).toBeNull();
      expect(s.esp).toBeNull();
    });
    it("detects a no-reply Return-Path even without a From", () => {
      const s = deriveTransportSignals({
        "return-path": "<bounces@vendor.com>",
      });
      expect(s.noReplyFrom).toBe(true);
    });
  });

  describe("looksPromotional", () => {
    it("is true when several promo keywords appear", () => {
      expect(
        looksPromotional(
          "Exclusive sale",
          "20% off this week only, unsubscribe below",
        ),
      ).toBe(true);
    });
    it("is false for an ordinary reply", () => {
      expect(
        looksPromotional(
          "Re: your order",
          "We can do $128 per bottle on 24 or more, ships Tuesday.",
        ),
      ).toBe(false);
    });
    it("is false for empty input", () => {
      expect(looksPromotional("", "")).toBe(false);
    });
  });

  describe("replySkipReason (the reply gate)", () => {
    const cleanTransport = deriveTransportSignals({
      from: "jean@vin-vendor.fr",
      "authentication-results": "mx; dkim=pass; dmarc=pass",
    });

    it("allows a genuine negotiation reply (returns null)", () => {
      expect(
        replySkipReason({
          emailClass: "negotiation_reply",
          injectionSuspected: false,
          transport: cleanTransport,
        }),
      ).toBeNull();
    });

    it('allows the ambiguous "other" class rather than dropping it', () => {
      expect(
        replySkipReason({
          emailClass: "other",
          injectionSuspected: false,
          transport: cleanTransport,
        }),
      ).toBeNull();
    });

    it("skips promotions, catalogues, confirmations, automated and bounces", () => {
      for (const c of [
        "promotion",
        "catalogue_offer",
        "order_confirmation",
        "automated_transactional",
        "bounce_autoreply",
      ] as const) {
        expect(
          replySkipReason({
            emailClass: c,
            injectionSuspected: false,
            transport: cleanTransport,
          }),
        ).toContain(c);
      }
    });

    it("skips on suspected injection regardless of class", () => {
      expect(
        replySkipReason({
          emailClass: "negotiation_reply",
          injectionSuspected: true,
          transport: cleanTransport,
        }),
      ).toMatch(/injection/i);
    });

    it("skips when transport marks the mail bulk/automated, even if class looks like a reply", () => {
      const bulk = deriveTransportSignals({
        from: "news@vendor.com",
        precedence: "bulk",
        "list-unsubscribe": "<x>",
      });
      expect(
        replySkipReason({
          emailClass: "negotiation_reply",
          injectionSuspected: false,
          transport: bulk,
        }),
      ).toMatch(/bulk/i);
    });
  });
});

describe("senderAuthOf — the sender check kept on a letter (r108 mail-gap g8)", () => {
  it("names the signing domain when DKIM passed, from header.d or else header.i", () => {
    expect(
      senderAuthOf({
        "Authentication-Results":
          "mx.google.com; dkim=pass header.i=@V.Example header.s=s1; spf=pass smtp.mailfrom=v.example; dmarc=pass (p=NONE) header.from=v.example",
      }),
    ).toEqual({ spf: true, dkim: true, dmarc: true, signedBy: "v.example" });
    expect(
      senderAuthOf({ "authentication-results": "mx.google.com; dkim=pass header.d=mail.v.example. header.i=@other.example" })?.signedBy,
    ).toBe("mail.v.example");
  });

  it("says a failed check failed and names no signer", () => {
    expect(
      senderAuthOf({ "authentication-results": "mx.google.com; dkim=fail header.d=v.example; spf=softfail; dmarc=fail" }),
    ).toEqual({ spf: false, dkim: false, dmarc: false, signedBy: null });
  });

  it("leaves a check that never came as unknown, never as a failure", () => {
    expect(senderAuthOf({})).toBeNull();
    expect(senderAuthOf(null)).toBeNull();
    expect(senderAuthOf({ "authentication-results": "mx.google.com; arc=none" })).toBeNull();
    expect(senderAuthOf({ "authentication-results": "mx.google.com; dkim=pass" })?.signedBy).toBeNull();
  });

  it("believes only Gmail's own verdict, never one another server or the sender wrote", () => {
    expect(senderAuthOf({ "authentication-results": "evil.example; dkim=pass header.d=v.example; dmarc=pass" })).toBeNull();
    // A sender-written ARC header is never read, even when Gmail's verdict has no DKIM clause.
    expect(
      senderAuthOf({
        "authentication-results": "mx.google.com; spf=pass smtp.mailfrom=evil.example",
        "arc-authentication-results": "i=1; mx.google.com; dkim=pass header.d=v.example; dmarc=pass",
      }),
    ).toEqual({ spf: true, dkim: null, dmarc: null, signedBy: null });
  });
});
