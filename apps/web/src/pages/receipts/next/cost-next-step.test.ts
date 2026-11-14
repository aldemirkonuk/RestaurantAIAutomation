/**
 * costNextStep (r28 invoices G4): what puts a paper's prices on its goods'
 * cost, said as one step. All data SYNTHETIC.
 */

import { describe, expect, it } from 'vitest';
import { costNextStep, settlesDeliveryCost, type SpineState } from './cost-next-step';

const d = (over: Partial<SpineState> = {}): SpineState => ({
  deliveryId: 'del-1',
  state: 'RECONCILING',
  agreedAt: null,
  verifiedAt: null,
  ...over,
});

describe('costNextStep', () => {
  it('says nothing while the read is in flight', () => {
    expect(costNextStep('doc-1', undefined)).toBeNull();
  });

  it('a failed read is said, and never read as "on no delivery"', () => {
    const s = costNextStep('doc-1', null)!;
    expect(s.kind).toBe('unread');
    expect(s.sentence).toMatch(/could not be read/);
    expect(s.link).toEqual({ to: '/documents/doc-1', label: 'Open the document' });
  });

  it('a paper on no delivery sends the person to the door', () => {
    const s = costNextStep('doc-1', [])!;
    expect(s.kind).toBe('no_delivery');
    expect(s.sentence).toMatch(/not on the shelf yet/);
    expect(s.link).toEqual({ to: '/documents/doc-1?view=door', label: 'Count them at the door' });
  });

  it('an open delivery needs agreeing, then verifying', () => {
    const s = costNextStep('doc-1', [d()])!;
    expect(s.kind).toBe('agree');
    expect(s.sentence).toMatch(/agreed and then verified/);
    expect(s.link?.to).toBe('/documents/doc-1');
  });

  it('a lapsed delivery that was never agreed still needs agreeing', () => {
    expect(costNextStep('doc-1', [d({ state: 'LAPSED' })])!.kind).toBe('agree');
  });

  it('an agreed delivery needs verifying', () => {
    const s = costNextStep('doc-1', [d({ state: 'AGREED', agreedAt: '2026-08-12T09:00:00Z' })])!;
    expect(s.kind).toBe('verify');
    expect(s.link).toEqual({ to: '/documents/doc-1', label: 'Verify the delivery' });
  });

  it('a verified delivery has settled its cost, with nothing to do', () => {
    const s = costNextStep('doc-1', [
      d({ state: 'VERIFIED', agreedAt: '2026-08-12T09:00:00Z', verifiedAt: '2026-08-12T10:00:00Z' }),
    ])!;
    expect(s.kind).toBe('settled');
    expect(s.link).toBeNull();
  });

  it('a rejected or cancelled delivery settles no cost, even if it was verified first', () => {
    const r = costNextStep('doc-1', [d({ state: 'REJECTED' })])!;
    expect(r.kind).toBe('closed');
    expect(r.sentence).toMatch(/rejected/);
    expect(r.link).toBeNull();
    const c = costNextStep('doc-1', [d({ state: 'CANCELLED', verifiedAt: '2026-08-12T10:00:00Z' })])!;
    expect(c.kind).toBe('closed');
    expect(c.sentence).toMatch(/cancelled/);
  });

  it('staff are told who agrees and verifies, with no link to buttons they lack (r36 R10)', () => {
    const agree = costNextStep('doc-1', [d()], false)!;
    expect(agree.kind).toBe('agree');
    expect(agree.sentence).toMatch(/An owner or a manager agrees and verifies this delivery/);
    expect(agree.link).toBeNull();
    const verify = costNextStep('doc-1', [d({ state: 'AGREED', agreedAt: '2026-08-12T09:00:00Z' })], false)!;
    expect(verify.kind).toBe('verify');
    expect(verify.sentence).toMatch(/An owner or a manager verifies it/);
    expect(verify.link).toBeNull();
  });

  it('the door is still everyone\'s: staff with no delivery are sent to count', () => {
    expect(costNextStep('doc-1', [], false)!.link?.to).toBe('/documents/doc-1?view=door');
  });

  it('owner, manager and admin settle; staff, an unknown role and no role do not', () => {
    expect(settlesDeliveryCost('owner', null)).toBe(true);
    expect(settlesDeliveryCost(' Manager ', null)).toBe(true);
    expect(settlesDeliveryCost('admin', null)).toBe(true);
    expect(settlesDeliveryCost('staff', 'owner')).toBe(false);
    expect(settlesDeliveryCost(null, 'manager')).toBe(true);
    expect(settlesDeliveryCost('waiter', null)).toBe(false);
    expect(settlesDeliveryCost(null, null)).toBe(false);
  });

  it('a paper on several deliveries says each is settled on its own', () => {
    const s = costNextStep('doc-1', [d(), d({ deliveryId: 'del-2' })])!;
    expect(s.kind).toBe('several');
    expect(s.sentence).toMatch(/on 2 deliveries/);
    expect(s.link?.to).toBe('/documents/doc-1');
  });
});
