/**
 * The consent screen states how long the mail is kept, before the grant.
 *
 * ADR 0118's own finding was that "the consent screen currently answers [the
 * retention question] with silence". These tests are what stops the silence
 * growing back, and each one is a sentence that would otherwise be a plausible
 * default nobody could see was missing:
 *
 *   1. THE FIGURE COMES FROM THE SERVER, with its derivation in words. A page
 *      that composed either would be right on the day it was written.
 *   2. THE SPLIT IS STATED — the mail has a window, the order's facts have a
 *      statutory floor, and the two are named as different objects.
 *   3. THE JURISDICTION NAMES ITS STATUTE AND THE DATE IT WAS READ, as a link.
 *   4. AN UNRECORDED COUNTRY SHOWS THE SENTENCE SAYING WHY THE STRICTEST RULE
 *      APPLIES, rather than a floor that looks chosen.
 *   5. REVOCATION IS STATED BEFORE THE GRANT, not discovered after it.
 *   6. A GRANT THAT MIRRORS NO MAIL SHOWS NO RETENTION SECTION — the sending
 *      grant reads nothing, and a retention promise about it would describe an
 *      act that never happens.
 *   7. A FAILED READ REFUSES THE GRANT. If the page cannot say how long the
 *      mail is kept, the Continue button is disabled: a button that still works
 *      when the answer could not be loaded is the same silence with a step in
 *      front of it.
 *   8. THE HOUSE'S OWN COPY IS OFFERED, AND THE PAID TIER SAYS IT IS NOT ON
 *      (ADR 0118 D16). Both ways of keeping the mail past the window are
 *      printed, the Mudavym archive carries its OD-23 refusal beside the offer,
 *      and a house nobody asked reads as a default rather than as a decision.
 *   9. A TURKISH HOUSE WITH NO ARCHIVE IS TOLD THE TEN-YEAR DUTY IS ITS OWN.
 *      A silent compliance claim would be worse than the silence in 1-7.
 *  10. AN ARCHIVE THAT COULD NOT BE READ STILL RENDERS ITS SECTION, with the
 *      reason. A section that vanishes on a failed read is this ADR's own fault
 *      one section further down.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AuthorizeIntegration from './AuthorizeIntegration'
import { integrationsApi } from '../services/api/integrations'

vi.mock('../services/api/integrations', () => ({
  integrationsApi: {
    getCatalog: vi.fn(),
    authorize: vi.fn(),
    getRetentionDisclosure: vi.fn(),
  },
}))

const READ_ENTRY = {
  id: 'gmail_read',
  provider: 'google',
  label: 'Gmail — reading vendor replies only',
  providerLabel: 'Google',
  description: "Lets a vendor's reply land in the house's own conversation book.",
  scopes: [
    {
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      label: 'Read mail in your mailbox',
      reason: 'Every request carries a from: filter built from the vendor book.',
    },
  ],
  notRequested: ["Mail from anyone who is not a vendor in this house's book"],
  dataHandling: {
    reads: 'Mail from the vendor addresses in this restaurant’s book.',
    doesNotRead: 'Every other message in your mailbox; it is discarded on arrival.',
    landsIn: "This restaurant's conversation book — procurement_conversations.",
    visibleTo: 'Everyone who works in this restaurant. Nobody outside it.',
    keptFor:
      'The mail itself has a window; what the order needs from it stays under the bookkeeping rule.',
  },
  mirrorsMail: true,
  available: true,
  unavailableReason: null,
}

const SEND_ENTRY = {
  ...READ_ENTRY,
  id: 'gmail_send',
  label: 'Gmail — sending only',
  mirrorsMail: false,
}

const TR_DISCLOSURE = {
  restaurantId: 'r1',
  figureDays: 282,
  figureFrom: 'stored_derivation' as const,
  storedAt: '2026-07-01T03:00:00.000Z',
  wouldBeDays: null,
  basis:
    'The longest dispute this restaurant has recorded ran 190 days, measured from the first message on that order.',
  jurisdiction: {
    code: 'TR',
    label: 'Türkiye',
    factsFloorYears: 10,
    bindsCorrespondence: true,
    why: 'Ten years, because a Turkish house must satisfy both statutes.',
    defaultedBecause: null,
    citations: [
      {
        statute: 'Türk Ticaret Kanunu No. 6102, Art. 82',
        says: 'Ten years for the commercial letters received.',
        url: 'https://mgm.adalet.gov.tr/example.pdf',
        fetchedOn: '2026-09-05',
      },
    ],
  },
  storageLimitation: [],
  split:
    "A vendor's reply is kept as two separate things: the mail itself, and what the order needs from it.",
  revocation:
    'If you disconnect this grant, every piece of raw mail already mirrored under it is deleted.',
  windowIntro: "It is the longest dispute this restaurant has actually recorded, plus a margin.",
  archive: {
    mode: 'none' as const,
    chosen: false,
    armed: false,
    says: 'Nobody has chosen for this restaurant yet, so the third answer applies: the mail is deleted when the window runs out and nothing is exported. That is a default, not a decision.',
    intro:
      "You can also keep the mail itself, past the window, in storage this restaurant controls.",
    options: {
      ownCloud:
        "Export it to this restaurant's own cloud. Every mirrored reply is written as one file into a folder in the Google Drive this restaurant has already connected.",
      mudavym:
        'Or Mudavym keeps it past the window in an archive of its own, and bills for the storage. This is not switched on: see below.',
      none: 'Or neither, which is what happens if nothing is chosen.',
    },
    paidTierRefusal:
      "Mudavym's own archive is a paid tier and its price is not decided: OD-23 is open, and no ADR fixes a figure. Arming it without a price would be a free tier nobody agreed to give away.",
    jurisdictionNote:
      'This restaurant\u2019s rule is T\u00fcrkiye\u2019s, and TTK 6102 Art. 82 requires a trader to keep the commercial letters it received for ten years. Keeping it is this restaurant\u2019s own responsibility, and nothing here does it for you.',
    layout: 'Mudavym mail archive/<restaurant>/<vendor>/<YYYY-MM>/<id>.json',
    unavailableBecause: null,
  },
  appliesTo: ['gmail_read'],
}

const UNKNOWN_DISCLOSURE = {
  ...TR_DISCLOSURE,
  figureFrom: 'measured_now' as const,
  storedAt: null,
  jurisdiction: {
    ...TR_DISCLOSURE.jurisdiction,
    code: 'UNKNOWN',
    label: 'Not recorded',
    defaultedBecause:
      'This restaurant has no country recorded, so its jurisdiction is not known. The strictest rule in the table is applied rather than a guess.',
  },
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/authorize/${id}`]}>
      <Routes>
        <Route path="/authorize/:integrationId" element={<AuthorizeIntegration />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the consent screen states how long the mail is kept', () => {
  beforeEach(() => {
    vi.mocked(integrationsApi.getCatalog).mockResolvedValue([
      SEND_ENTRY,
      READ_ENTRY,
    ] as never)
    vi.mocked(integrationsApi.getRetentionDisclosure).mockResolvedValue(
      TR_DISCLOSURE as never,
    )
  })

  it('prints the figure the SERVER derived, and the derivation in words', async () => {
    renderAt('gmail_read')
    expect(await screen.findByTestId('retention-disclosure')).toBeTruthy()
    expect(screen.getByText(/The mail itself: 282 days/)).toBeTruthy()
    expect(screen.getByText(/ran 190 days/)).toBeTruthy()
    expect(screen.getByText(/Worked out on 2026-07-01/)).toBeTruthy()
  })

  it('states the split: the mail has a window, the order’s facts have a floor', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    expect(screen.getByText(/kept as two separate things/)).toBeTruthy()
    expect(screen.getByText(/The order's facts: 10 years — Türkiye/)).toBeTruthy()
  })

  it('names the statute and the date it was read, as a link', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    const link = screen.getByRole('link', {
      name: /Türk Ticaret Kanunu No. 6102, Art. 82/,
    })
    expect(link.getAttribute('href')).toBe('https://mgm.adalet.gov.tr/example.pdf')
    expect(screen.getByText(/read 2026-09-05/)).toBeTruthy()
  })

  it('says WHY the strictest rule applies when no country is recorded', async () => {
    vi.mocked(integrationsApi.getRetentionDisclosure).mockResolvedValue(
      UNKNOWN_DISCLOSURE as never,
    )
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    expect(screen.getByText(/no country recorded/)).toBeTruthy()
    expect(screen.getByText(/rather than a guess/)).toBeTruthy()
    // A live measure is labelled as one, not shown as a stored derivation.
    expect(screen.getByText(/\(measured now\)/)).toBeTruthy()
  })

  it('states the revocation rule BEFORE the grant', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    // Exact: the revocation sentence itself opens with the same three words,
    // and a loose regex here matches both and fails on the ambiguity.
    expect(screen.getByText('If you disconnect')).toBeTruthy()
    expect(
      screen.getByText(/every piece of raw mail already mirrored under it is deleted/),
    ).toBeTruthy()
  })

  it('shows no retention section for a grant that mirrors no mail', async () => {
    renderAt('gmail_send')
    expect(await screen.findByText(/Connect Gmail — sending only to Mudavym/)).toBeTruthy()
    expect(screen.queryByTestId('retention-disclosure')).toBeNull()
    const button = screen.getByRole('button', { name: /Continue to Google/ })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('refuses the grant when the figure could not be read', async () => {
    vi.mocked(integrationsApi.getRetentionDisclosure).mockRejectedValue(
      new Error('the retention window could not be read'),
    )
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    await waitFor(() => {
      expect(
        screen.getByText(/retention figure could not be read/),
      ).toBeTruthy()
    })
    const button = screen.getByRole('button', { name: /Continue to Google/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers both ways of keeping the mail, with the paid tier NOT on', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('archive-disclosure')
    expect(screen.getByText(/Keeping your own copy/)).toBeTruthy()
    // The export offer.
    expect(
      screen.getByText(/Export it to this restaurant's own cloud/),
    ).toBeTruthy()
    // The paid offer AND its refusal, together, so nobody chooses a tier
    // believing it is running.
    expect(screen.getByText(/bills for the storage/)).toBeTruthy()
    expect(screen.getByText(/OD-23 is open/)).toBeTruthy()
    expect(
      screen.getByText(/free tier nobody agreed to give away/),
    ).toBeTruthy()
  })

  it('says nobody was ASKED rather than printing a chosen "none"', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('archive-disclosure')
    expect(screen.getByText(/a default, not a decision/)).toBeTruthy()
  })

  it('tells a Türkiye house with no archive that the ten-year duty is its own', async () => {
    renderAt('gmail_read')
    await screen.findByTestId('archive-disclosure')
    expect(screen.getByText(/TTK 6102 Art. 82/)).toBeTruthy()
    expect(
      screen.getByText(/this restaurant\u2019s own responsibility/),
    ).toBeTruthy()
  })

  it('still renders the archive section when the setting could not be read', async () => {
    vi.mocked(integrationsApi.getRetentionDisclosure).mockResolvedValue({
      ...TR_DISCLOSURE,
      archive: {
        ...TR_DISCLOSURE.archive,
        says: 'Whether this restaurant keeps its own copy of the mail could not be read.',
        unavailableBecause: 'connection reset',
      },
    } as never)
    renderAt('gmail_read')
    await screen.findByTestId('archive-disclosure')
    expect(screen.getByText(/could not be read/)).toBeTruthy()
    expect(screen.getByText(/connection reset/)).toBeTruthy()
  })

  it('shows no archive section on a gateway that does not send one', async () => {
    const { archive: _dropped, ...withoutArchive } = TR_DISCLOSURE
    vi.mocked(integrationsApi.getRetentionDisclosure).mockResolvedValue(
      withoutArchive as never,
    )
    renderAt('gmail_read')
    await screen.findByTestId('retention-disclosure')
    expect(screen.queryByTestId('archive-disclosure')).toBeNull()
  })
})
