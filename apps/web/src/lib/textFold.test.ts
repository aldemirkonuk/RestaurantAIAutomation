import { describe, expect, it } from 'vitest';
import { foldText } from './textFold';

describe('foldText', () => {
  it('folds the Turkish dotless and dotted i to a plain i', () => {
    expect(foldText('Rakı')).toBe('raki');
    expect(foldText('İzmir')).toBe('izmir');
    expect(foldText('Kavaklıdere')).toBe('kavaklidere');
    expect(foldText('KAVAKLIDERE')).toBe('kavaklidere');
  });

  it('strips the other accents, so a Turkish name meets its ASCII spelling', () => {
    expect(foldText('Çay')).toBe('cay');
    expect(foldText('Öküzgözü')).toBe('okuzgozu');
    expect(foldText('Boğazkere Şarap')).toBe('bogazkere sarap');
  });

  it('returns an empty string for nothing', () => {
    expect(foldText(null)).toBe('');
    expect(foldText(undefined)).toBe('');
  });
});
