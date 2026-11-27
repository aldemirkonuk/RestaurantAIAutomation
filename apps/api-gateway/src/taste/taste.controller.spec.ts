import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TasteController } from './taste.controller';

const RID = '11111111-1111-4111-8111-111111111111';
const SUBJ = '33333333-3333-4333-8333-333333333333';

describe('TasteController', () => {
  const read = jest.fn().mockResolvedValue({ ok: true });
  const appendHouse = jest.fn().mockResolvedValue({ ok: true });
  const rollupSubject = jest.fn().mockResolvedValue({ ok: true });
  const preview = jest.fn().mockResolvedValue({ ok: true });
  const c = new TasteController({ read, appendHouse, rollupSubject, preview } as any);
  const me = { userId: 'u1', restaurantId: RID, name: 'Ada', email: 'a@x.test' };

  beforeEach(() => jest.clearAllMocks());

  it('refuses a caller naming another house, and never reaches the service', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    await expect(c.read(other, 'good', SUBJ, me)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.appendHouse(other, 'good', SUBJ, { method: 'line' } as any, me)).rejects.toBeInstanceOf(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
    expect(appendHouse).not.toHaveBeenCalled();
  });

  it('refuses a subject kind it does not know; passes a known one (control)', async () => {
    await expect(c.read(RID, 'supply', SUBJ, me)).rejects.toBeInstanceOf(BadRequestException);
    await c.read(RID, 'dish', SUBJ, me);
    expect(read).toHaveBeenCalledWith(RID, 'dish', SUBJ);
  });

  it('hands the session user, not the body, to the service as the author', async () => {
    await c.appendHouse(RID, 'cocktail', SUBJ, { method: 'line', note: 'x' } as any, me);
    expect(appendHouse.mock.calls[0][4]).toEqual({ userId: 'u1', name: 'Ada', email: 'a@x.test' });
  });

  // Finding 3 (r87): working out a recipe layer writes the house's taste of a
  // drink or dish, so it is for the people who run the house. Reading and the
  // unsaved preview stay open to every member.
  describe('the roll-up writes a recipe layer: owner or manager only', () => {
    const as = (role: string | null | undefined) => ({ ...me, role });

    it.each(['owner', 'manager'])('%s: the roll-up runs', async (role) => {
      await c.rollup(RID, 'cocktail', SUBJ, as(role) as any);
      expect(rollupSubject).toHaveBeenCalledWith(RID, 'cocktail', SUBJ);
    });

    it.each(['staff', null, undefined, 'admin', 'nonsense'])(
      '%s: refused with a sentence and the service is never asked', async (role) => {
        const err: any = await c.rollup(RID, 'dish', SUBJ, as(role) as any).catch((e) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect(err.message).toBe("Working out a taste from a recipe is for the house's owners and managers.");
        expect(rollupSubject).not.toHaveBeenCalled();
      });

    it('an owner of another house is refused as not their house', async () => {
      const other = '22222222-2222-4222-8222-222222222222';
      const err: any = await c.rollup(other, 'dish', SUBJ, as('owner') as any).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe('That is not your house.');
      expect(rollupSubject).not.toHaveBeenCalled();
    });

    it('the preview stays open to staff, and reading too (control)', async () => {
      await c.preview(RID, { lines: [] } as any, as('staff') as any);
      expect(preview).toHaveBeenCalled();
      await c.read(RID, 'dish', SUBJ, as('staff') as any);
      expect(read).toHaveBeenCalledWith(RID, 'dish', SUBJ);
    });
  });
});
