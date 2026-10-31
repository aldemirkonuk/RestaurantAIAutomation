import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTable, neutraliseFormula } from './tableExport';

describe('CSV formula injection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefixes an apostrophe to a cell a spreadsheet would run, and leaves plain numbers alone', () => {
    expect(neutraliseFormula('=HYPERLINK("http://x","y")')).toBe(`'=HYPERLINK("http://x","y")`);
    expect(neutraliseFormula('+1+1')).toBe("'+1+1");
    expect(neutraliseFormula('-2+3')).toBe("'-2+3");
    expect(neutraliseFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutraliseFormula('\tcmd')).toBe("'\tcmd");
    expect(neutraliseFormula('\rcmd')).toBe("'\rcmd");
    expect(neutraliseFormula('-12.50')).toBe('-12.50');
    expect(neutraliseFormula('-3')).toBe('-3');
    expect(neutraliseFormula('Musar 2015')).toBe('Musar 2015');
    expect(neutraliseFormula('')).toBe('');
  });

  it('writes the guarded cells into the CSV file, numbers untouched', async () => {
    let blob: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blob = b;
        return 'blob:x';
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await exportTable({
      format: 'csv',
      filename: 't',
      rows: [{ name: '=cmd|"/c calc"!A1', qty: -4, price: '-9.99' }],
      columns: [
        { header: 'Name', value: (r) => r.name },
        { header: 'Qty', value: (r) => r.qty },
        { header: 'Price', value: (r) => r.price },
      ],
    });
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    expect(text.split('\n')[1]).toBe(`"'=cmd|""/c calc""!A1","-4","-9.99"`);
  });
});
