import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TasteController } from './taste.controller';

const RID = '11111111-1111-4111-8111-111111111111';
const SUBJ = '33333333-3333-4333-8333-333333333333';

describe('TasteController', () => {
  const read = jest.fn().mockResolvedValue({ ok: true });
  const appendHouse = jest.fn().mockResolvedValue({ ok: true });
  const c = new TasteController({ read, appendHouse } as any);
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
});
