/**
 * F-685 (S195): a vendor list and an opening stock come in from a spreadsheet,
 * read the house's way, and every row is sorted before anything is sent.
 */
import { describe, expect, it } from 'vitest';
import { parseCsvRows, planOpeningStock, planVendorImport, readCsvFile } from './csvImport';

describe('parseCsvRows', () => {
  it('reads a Turkish Excel file: ";" separated, quoted cells, a BOM and CRLF', () => {
    const text = '﻿Şarap;Adet;Raf\r\n"Kavaklıdere; Öküzgözü";12;Mahzen A\r\n\r\nYakut;3;\r\n';
    expect(parseCsvRows(text)).toEqual([
      ['Şarap', 'Adet', 'Raf'],
      ['Kavaklıdere; Öküzgözü', '12', 'Mahzen A'],
      ['Yakut', '3', ''],
    ]);
  });

  it('decodes a Windows-1254 file in a Turkish house instead of garbling it', async () => {
    // "Şarap" in Windows-1254: Ş = 0xDE.
    const bytes = new Uint8Array([0xde, 0x61, 0x72, 0x61, 0x70]);
    await expect(readCsvFile(new Blob([bytes]), 'tr-TR')).resolves.toBe('Şarap');
  });
});

describe('planVendorImport', () => {
  const existing = [{ name: 'Kavaklıdere Şarapları', email: 'siparis@kavaklidere.example' }];

  it('sorts rows into new vendors, vendors already in the book, and lines that cannot be used', () => {
    const plan = planVendorImport(
      parseCsvRows(
        [
          'Tedarikçi;E-posta;Telefon;Yetkili',
          'Doluca;info@doluca.example;0212 555 0101;Ayşe Yılmaz',
          'KAVAKLIDERE ŞARAPLARI;;;',
          'Another name;SIPARIS@kavaklidere.example;;',
          ';nobody@example.com;;',
          'Sevilen;not-an-email;;',
          'Doluca;;;',
        ].join('\n'),
      ),
      existing,
    );
    expect(plan.fileProblem).toBeNull();
    expect(plan.fresh).toEqual([
      {
        line: 2,
        name: 'Doluca',
        email: 'info@doluca.example',
        phone: '0212 555 0101',
        physicalAddress: '',
        contactFirstName: 'Ayşe',
        contactLastName: 'Yılmaz',
      },
    ]);
    expect(plan.duplicate.map((d) => [d.line, d.reason])).toEqual([
      [3, 'Already in your vendors; it is left as it is.'],
      [4, 'Already in your vendors; it is left as it is.'],
      [7, 'Listed twice in this file; the first one is used.'],
    ]);
    expect(plan.refused.map((r) => [r.line, r.reason])).toEqual([
      [5, 'No vendor name on this line.'],
      [6, '"not-an-email" is not an email address.'],
    ]);
  });

  it('says in plain words when the file has no name column', () => {
    const plan = planVendorImport(parseCsvRows('email,phone\na@b.co,1'), []);
    expect(plan.fileProblem).toMatch(/No column is called "Name"/);
    expect(plan.fresh).toHaveLength(0);
  });
});

describe('planOpeningStock', () => {
  const carried = [{ inventoryId: 'inv-1', name: 'Yakut', vintage: 2020, producer: 'Kavaklıdere' }];
  const shelves = [{ id: 'shelf-a', name: 'Mahzen A' }];

  it('receives new wines, counts carried ones to the file number, and refuses what it cannot read', () => {
    const plan = planOpeningStock(
      parseCsvRows(
        [
          'Wine;Vintage;Qty;Shelf;Cost',
          'Öküzgözü Reserve;2019;12;mahzen a;1.250,50',
          'Yakut;2020;7;;300',
          'Doluca DLC;NV;2;;',
          'Sevilen;2018;two;;',
          'Sevilen;2018;3;Garage;',
          'Sevilen;18;3;;',
          'Sevilen;2018;4;;-5',
          ';2018;1;;',
        ].join('\n'),
      ),
      carried,
      shelves,
      'tr-TR',
    );
    expect(plan.receive).toEqual([
      { line: 2, name: 'Öküzgözü Reserve', vintage: 2019, qty: 12, shelfId: 'shelf-a', shelfName: 'Mahzen A', cost: 1250.5 },
      { line: 4, name: 'Doluca DLC', vintage: null, qty: 2, shelfId: null, shelfName: null, cost: null },
    ]);
    expect(plan.count).toEqual([
      { line: 3, name: 'Yakut', inventoryId: 'inv-1', qty: 7, shelfId: null, shelfName: null, costIgnored: true },
    ]);
    expect(plan.refused.map((r) => r.line)).toEqual([5, 6, 7, 8, 9]);
    expect(plan.refused[1].reason).toMatch(/No shelf called "Garage" in this restaurant/);
  });

  it('reads a US cost with a dot decimal in a US house', () => {
    const plan = planOpeningStock(parseCsvRows('wine,quantity,cost\nOpus One,6,1250.50'), [], [], 'en-US');
    expect(plan.receive[0]).toMatchObject({ qty: 6, cost: 1250.5 });
  });

  it('says in plain words when the quantity column is missing', () => {
    const plan = planOpeningStock(parseCsvRows('wine,shelf\nOpus One,A'), [], []);
    expect(plan.fileProblem).toMatch(/needs a "Wine" column and a "Quantity" column/);
  });
});
