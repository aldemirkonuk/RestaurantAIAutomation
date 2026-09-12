/**
 * One fixed vendor payload, shared by the byte-identical test and the
 * treatment tests for `/v/:slug`. It is TEST DATA for a jsdom runner, never
 * rendered by the app: the page reads `GET /api/v1/vendor-portal/:slug`.
 *
 * The five rows are chosen to exercise every honesty branch the page has:
 * a plain 750, a six-pack, a row with no bottle size, an unpriced magnum
 * that is out of stock, and a half bottle with a unit label.
 */
export interface FixtureListing {
  id: string
  productName: string
  producer: string | null
  vintage: number | null
  region: string | null
  country: string | null
  grapeVarieties: string | null
  price: number | null
  currency: string
  packSize: number
  volumeMl: number | null
  unitLabel: string | null
  inStock: boolean | null
  minOrderQuantity: number | null
  leadTimeDays: number | null
  notes: string | null
}

export interface FixturePage {
  slug: string
  displayName: string
  tagline: string | null
  about: string | null
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  websiteUrl: string | null
  updatedAt: string
  listings: FixtureListing[]
}

export const VENDOR_PAGE_FIXTURE: FixturePage = {
  slug: 'test-vendor',
  displayName: 'Test Vendor',
  tagline: 'A fixture, not a vendor',
  about: 'This payload exists so the tests can render every branch of the page.',
  logoUrl: null,
  contactEmail: 'orders@test-vendor.invalid',
  contactPhone: '+1 555 0100',
  websiteUrl: 'https://test-vendor.invalid',
  updatedAt: '2026-09-01T10:00:00.000Z',
  listings: [
    {
      id: 'l1',
      productName: 'Fixture Red',
      producer: 'Fixture Estate',
      vintage: 2019,
      region: 'Fixture Valley',
      country: 'Testland',
      grapeVarieties: 'Fixture Noir',
      price: 24,
      currency: 'USD',
      packSize: 1,
      volumeMl: 750,
      unitLabel: null,
      inStock: true,
      minOrderQuantity: null,
      leadTimeDays: null,
      notes: null,
    },
    {
      id: 'l2',
      productName: 'Fixture White',
      producer: 'Fixture Estate',
      vintage: 2021,
      region: null,
      country: 'Testland',
      grapeVarieties: 'Fixture Blanc',
      price: 120,
      currency: 'USD',
      packSize: 6,
      volumeMl: 750,
      unitLabel: null,
      inStock: true,
      minOrderQuantity: 1,
      leadTimeDays: 3,
      notes: null,
    },
    {
      id: 'l3',
      productName: 'Fixture Sparkling',
      producer: null,
      vintage: null,
      region: null,
      country: null,
      grapeVarieties: null,
      price: 30,
      currency: 'USD',
      packSize: 1,
      volumeMl: null,
      unitLabel: null,
      inStock: null,
      minOrderQuantity: null,
      leadTimeDays: null,
      notes: null,
    },
    {
      id: 'l4',
      productName: 'Fixture Magnum',
      producer: 'Fixture Estate',
      vintage: 2015,
      region: 'Fixture Valley',
      country: 'Testland',
      grapeVarieties: null,
      price: null,
      currency: 'USD',
      packSize: 1,
      volumeMl: 1500,
      unitLabel: null,
      inStock: false,
      minOrderQuantity: null,
      leadTimeDays: null,
      notes: null,
    },
    {
      id: 'l5',
      productName: 'Fixture Half',
      producer: 'Fixture Estate',
      vintage: 2020,
      region: 'Fixture Valley',
      country: 'Testland',
      grapeVarieties: 'Fixture Noir',
      price: 14,
      currency: 'USD',
      packSize: 1,
      volumeMl: 375,
      unitLabel: 'half bottle',
      inStock: true,
      minOrderQuantity: null,
      leadTimeDays: null,
      notes: null,
    },
  ],
}
