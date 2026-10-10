/**
 * The register's evidence line counts rows in the house's own marks — a lira
 * house reads "1.250 in the cellar", not "1,250" beside "₺1.250,00" (F-1085).
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RegisterEvidenceLine from './RegisterEvidenceLine';
import { setHouseLocale } from '../../../lib/houseCurrency';

afterEach(() => setHouseLocale('en-US'));

describe('RegisterEvidenceLine', () => {
  it('groups thousands with the house mark, and an unknown stays the dash', () => {
    setHouseLocale('tr-TR');
    render(
      <RegisterEvidenceLine
        evidence={{ inventoryRows: 1250, menuRows: 12, catalogueRows: null, nameOnly: false }}
        confidence="certain"
      />,
    );
    const line = screen.getByText(/in the cellar/).textContent ?? '';
    expect(line).toContain('1.250 in the cellar');
    expect(line).toContain('— in the shared catalogue');
  });
});
