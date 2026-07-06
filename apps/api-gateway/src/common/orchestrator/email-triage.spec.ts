import {
  deriveTransportSignals,
  extractEmailAddress,
  looksPromotional,
  transportImpliesNoReply,
} from './email-triage';

describe('email-triage', () => {
  describe('extractEmailAddress', () => {
    it('pulls the address out of an angled From header', () => {
      expect(extractEmailAddress('Jean Dupont <jean@vin-vendor.fr>')).toBe('jean@vin-vendor.fr');
    });
    it('handles a bare address and lowercases it', () => {
      expect(extractEmailAddress('Sales@Vendor.COM')).toBe('sales@vendor.com');
    });
    it('returns empty string for missing input', () => {
      expect(extractEmailAddress(undefined)).toBe('');
      expect(extractEmailAddress('')).toBe('');
    });
  });

  describe('deriveTransportSignals — marketing blast', () => {
    const signals = deriveTransportSignals({
      from: 'Château Margaux <news@margaux-selections.com>',
      precedence: 'bulk',
      'list-unsubscribe': '<https://margaux-selections.com/u/123>',
      'x-mailer': 'Mailchimp Mailer 3.0',
      'authentication-results': 'mx.google.com; spf=pass smtp.mailfrom=margaux-selections.com; dkim=pass header.i=@margaux-selections.com; dmarc=pass header.from=margaux-selections.com',
    });

    it('flags it as automated via bulk + list + esp + no-reply', () => {
      expect(signals.bulk).toBe(true);
      expect(signals.listMail).toBe(true);
      expect(signals.esp).toBe('mailchimp');
      expect(signals.noReplyFrom).toBe(true);
      expect(signals.isAutomated).toBe(true);
    });

    it('still records that DKIM/DMARC passed (verified but automated)', () => {
      expect(signals.dkimPass).toBe(true);
      expect(signals.dmarcPass).toBe(true);
      expect(signals.senderVerified).toBe(true);
    });

    it('transport alone says do not reply', () => {
      expect(transportImpliesNoReply(signals)).toBe(true);
    });
  });

  describe('deriveTransportSignals — genuine negotiation reply', () => {
    const signals = deriveTransportSignals({
      from: 'Jean Dupont <jean@vin-vendor.fr>',
      subject: 'Re: your order',
      'authentication-results': 'mx.google.com; spf=pass smtp.mailfrom=vin-vendor.fr; dkim=pass header.i=@vin-vendor.fr; dmarc=pass',
    });

    it('is not automated and is sender-verified', () => {
      expect(signals.isAutomated).toBe(false);
      expect(signals.senderVerified).toBe(true);
      expect(signals.bulk).toBe(false);
      expect(signals.listMail).toBe(false);
      expect(signals.noReplyFrom).toBe(false);
    });

    it('transport does not block a reply', () => {
      expect(transportImpliesNoReply(signals)).toBe(false);
    });
  });

  describe('deriveTransportSignals — out-of-office autoreply', () => {
    const signals = deriveTransportSignals({
      from: 'jean@vin-vendor.fr',
      'auto-submitted': 'auto-replied',
      subject: 'Automatic reply: Out of office',
    });
    it('detects auto-submitted and marks automated', () => {
      expect(signals.autoSubmitted).toBe(true);
      expect(signals.isAutomated).toBe(true);
      expect(transportImpliesNoReply(signals)).toBe(true);
    });
    it('treats Auto-Submitted: no as not automated', () => {
      const s = deriveTransportSignals({ from: 'jean@vin-vendor.fr', 'auto-submitted': 'no' });
      expect(s.autoSubmitted).toBe(false);
    });
  });

  describe('deriveTransportSignals — failing / spoofed auth', () => {
    const signals = deriveTransportSignals({
      from: 'Sales <sales@realvendor.com>',
      'authentication-results': 'mx.google.com; spf=fail smtp.mailfrom=attacker.example; dkim=fail; dmarc=fail',
    });
    it('is NOT sender-verified when DKIM and DMARC fail', () => {
      expect(signals.dkimPass).toBe(false);
      expect(signals.dmarcPass).toBe(false);
      expect(signals.spfPass).toBe(false);
      expect(signals.senderVerified).toBe(false);
    });
  });

  describe('deriveTransportSignals — SPF pass alone is not "verified"', () => {
    const signals = deriveTransportSignals({
      from: 'sales@vendor.com',
      'authentication-results': 'mx.google.com; spf=pass smtp.mailfrom=vendor.com',
    });
    it('records spf pass but leaves dkim/dmarc unknown and senderVerified false', () => {
      expect(signals.spfPass).toBe(true);
      expect(signals.dkimPass).toBeNull();
      expect(signals.dmarcPass).toBeNull();
      expect(signals.senderVerified).toBe(false);
    });
  });

  describe('deriveTransportSignals — empty / missing headers', () => {
    it('never throws and returns safe defaults', () => {
      const s = deriveTransportSignals(undefined);
      expect(s.isAutomated).toBe(false);
      expect(s.senderVerified).toBe(false);
      expect(s.spfPass).toBeNull();
      expect(s.esp).toBeNull();
    });
    it('detects a no-reply Return-Path even without a From', () => {
      const s = deriveTransportSignals({ 'return-path': '<bounces@vendor.com>' });
      expect(s.noReplyFrom).toBe(true);
    });
  });

  describe('looksPromotional', () => {
    it('is true when several promo keywords appear', () => {
      expect(looksPromotional('Exclusive sale', '20% off this week only, unsubscribe below')).toBe(true);
    });
    it('is false for an ordinary reply', () => {
      expect(looksPromotional('Re: your order', 'We can do $128 per bottle on 24 or more, ships Tuesday.')).toBe(false);
    });
    it('is false for empty input', () => {
      expect(looksPromotional('', '')).toBe(false);
    });
  });
});
