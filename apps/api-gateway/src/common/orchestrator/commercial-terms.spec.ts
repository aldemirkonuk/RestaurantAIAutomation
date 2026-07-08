import {
  parseCommercialTerms,
  validateCommercialTerms,
  hasCommercialTerms,
  emptyCommercialTerms,
} from './commercial-terms';

describe('commercial-terms', () => {
  // The example from the plan: $135/bottle, $1,620/case (12), MOQ 6, 5% over 24, USD, tax excluded.
  const exampleRaw = {
    currency: '$',
    unit_price: '$135',
    case_price: '$1,620',
    bottles_per_case: 12,
    min_order_qty: 6,
    min_order_unit: 'bottle',
    discount_tiers: [{ threshold_qty: 24, unit: 'bottle', discount_pct: 5 }],
    tax_status: 'excluded',
  };

  describe('parseCommercialTerms', () => {
    it('coerces currency symbols and money strings to numbers', () => {
      const t = parseCommercialTerms(exampleRaw);
      expect(t.currency).toBe('USD');
      expect(t.unit_price).toBe(135);
      expect(t.case_price).toBe(1620);
      expect(t.bottles_per_case).toBe(12);
      expect(t.min_order_qty).toBe(6);
      expect(t.tax_status).toBe('excluded');
      expect(t.discount_tiers).toHaveLength(1);
      expect(t.discount_tiers[0]).toMatchObject({ threshold_qty: 24, discount_pct: 5 });
    });

    it('maps € / EUR to EUR and detects included tax', () => {
      const t = parseCommercialTerms({ currency: 'EUR', unit_price: '€110', tax_status: 'VAT included' });
      expect(t.currency).toBe('EUR');
      expect(t.unit_price).toBe(110);
      expect(t.tax_status).toBe('included');
    });

    it('returns safe empty terms for garbage/empty input', () => {
      expect(parseCommercialTerms(null)).toEqual(emptyCommercialTerms());
      expect(parseCommercialTerms('nope')).toEqual(emptyCommercialTerms());
      const t = parseCommercialTerms({});
      expect(t.tax_status).toBe('unknown');
      expect(t.discount_tiers).toEqual([]);
    });
  });

  describe('hasCommercialTerms', () => {
    it('is true when something was extracted, false for empty', () => {
      expect(hasCommercialTerms(parseCommercialTerms(exampleRaw))).toBe(true);
      expect(hasCommercialTerms(emptyCommercialTerms())).toBe(false);
    });
  });

  describe('validateCommercialTerms', () => {
    it('accepts a consistent case/unit price (1620 / 12 = 135)', () => {
      const v = validateCommercialTerms(parseCommercialTerms(exampleRaw), 6);
      expect(v.price_inconsistent).toBe(false);
    });

    it('flags an inconsistent case price (1500 / 12 = 125 vs unit 135)', () => {
      const v = validateCommercialTerms(
        parseCommercialTerms({ unit_price: 135, case_price: 1500, bottles_per_case: 12 }),
        6,
      );
      expect(v.price_inconsistent).toBe(true);
    });

    it('flags MOQ not met when the minimum exceeds what we asked for', () => {
      expect(validateCommercialTerms(parseCommercialTerms(exampleRaw), 4).moq_not_met).toBe(true);
      expect(validateCommercialTerms(parseCommercialTerms(exampleRaw), 6).moq_not_met).toBe(false);
      expect(validateCommercialTerms(parseCommercialTerms(exampleRaw), 0).moq_not_met).toBe(false); // unknown qty
    });

    it('flags unknown tax basis', () => {
      expect(validateCommercialTerms(parseCommercialTerms({ unit_price: 135 }), 6).tax_status_unknown).toBe(true);
      expect(validateCommercialTerms(parseCommercialTerms(exampleRaw), 6).tax_status_unknown).toBe(false);
    });

    it('flags ambiguous currency when the model marks it', () => {
      const v = validateCommercialTerms(parseCommercialTerms({ currency: 'USD', currency_ambiguous: true }), 6);
      expect(v.currency_ambiguous).toBe(true);
    });
  });
});
