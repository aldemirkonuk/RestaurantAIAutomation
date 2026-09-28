/**
 * How long a mirrored vendor reply is kept — the RULE TABLE.
 *
 * ADR 0118 "Retention" (decided 2026-09-05). The founder's four answers:
 *
 *   1. THE SPLIT.        A mirrored reply is two objects. The RAW MAIL (body,
 *                        headers, attachments) has a stated window and goes on
 *                        revocation. The FACTS extracted from it keep the
 *                        order's paper trail under the house's bookkeeping
 *                        retention.
 *   2. WINDOW BASIS.     The longest open dispute the house has recorded, plus
 *                        a stated margin; measured from the house's own
 *                        conversations; re-derived quarterly; the consent
 *                        screen prints the current figure and its basis.
 *   3. JURISDICTION.     Per house, from its country, with the default stated.
 *                        Each row names its floor and its source. A house with
 *                        no country recorded gets the strictest rule and a
 *                        sentence saying why.
 *   4. REVOCATION.       Stop reads and delete the raw mail; the facts stay;
 *                        the consent screen says so BEFORE the grant.
 *
 * WHY THIS FILE IS A TABLE AND NOT A CONSTANT
 * -------------------------------------------
 * Every regime that governs this asks the same question in different words —
 * retention must be tied to a stated purpose, never to a round number chosen
 * for convenience (GDPR Art. 5(1)(e); UK GDPR Art. 5(1)(e); KVKK Art. 4(2)(ç);
 * CCPA Cal. Civ. Code s.1798.100(c)). A bare `const RETENTION_DAYS = 90` would
 * fail that test on its face and would be this repo's own named cardinal fault
 * — a plausible default standing in for a decision (ADR 0020). So every number
 * below carries the statute it came from and the date that statute was read,
 * and the ONLY free constant in the whole module is the margin, which carries
 * its derivation in the comment above it.
 *
 * WHAT THE FLOORS BIND, AND WHAT THEY DO NOT
 * ------------------------------------------
 * The floors below are BOOKKEEPING floors and they bind the FACTS — the
 * order's own record of what was quoted, agreed and delivered. They are NOT
 * the raw-mail window: that comes from the house's own disputes
 * (`deriveWindow`), not from a statute, because no statute compels a
 * *processor* to hold a *copy* of a person's mailbox. The two numbers are
 * deliberately different objects and are never mixed.
 *
 * The one place they touch is Türkiye, and it is named rather than smoothed
 * over: TTK Art. 82(1)(b)-(c) reaches "commercial letters received" and
 * "copies of the commercial letters sent", and Art. 82(2) defines a commercial
 * letter as ALL correspondence relating to a commercial matter — a vendor's
 * reply about an order is squarely inside it. See `bindsCorrespondence` and
 * the note on the TR row.
 */

/** ISO 3166-1 alpha-2, plus `US-CA` for a California house and `UNKNOWN`. */
export type JurisdictionCode = "TR" | "GB" | "US" | "US-CA" | "UNKNOWN";

export interface StatuteCitation {
  /** The instrument, named the way a lawyer would cite it. */
  statute: string;
  /** What it says, in the words that matter here. */
  says: string;
  /** The URL this text was read from. */
  url: string;
  /** ISO date the URL was fetched. Not "when this file was written". */
  fetchedOn: string;
}

export interface JurisdictionRule {
  code: JurisdictionCode;
  /** Shown to a person, not a code. */
  label: string;
  /**
   * How long the house must be able to produce the order's own record. The
   * LONGEST of the citations below, because a house must satisfy all of them,
   * not the friendliest one.
   */
  factsFloorYears: number;
  /**
   * TRUE where the statute's own words reach the CORRESPONDENCE and not only
   * the books. Only Türkiye does today, and it is the reason the TR note
   * exists. Nothing branches on this yet — it is printed, so a reader of the
   * consent screen sees the tension rather than being reassured past it.
   */
  bindsCorrespondence: boolean;
  citations: StatuteCitation[];
  /** Why this floor is this number, in one sentence a manager can read. */
  why: string;
  /** The extra sentence a house gets when this rule was chosen by DEFAULT. */
  defaultedBecause?: string;
}

/**
 * THE MARGIN. The only free number in this module, and it is not free.
 *
 * The window figure is re-derived QUARTERLY (founder, 2026-09-05). So between
 * two derivations there is a gap, and a dispute that opens the day after a
 * derivation is invisible to the figure until the next one runs. The longest
 * such gap is a calendar quarter measured across its longest span — 1 July to
 * 1 October is 92 days.
 *
 * If the margin were shorter than that gap, raw mail could be deleted on a
 * figure that a dispute opened since has ALREADY made too short, and nothing
 * would report it: the sweep would run, the count would say what it deleted,
 * and the number it obeyed would have been stale by up to three months. The
 * margin is therefore exactly one re-derivation interval — the number the
 * cadence forces, not a round one somebody liked.
 *
 * It follows that changing the cadence changes this number — so it is DERIVED
 * from the cadence, not declared beside it. (The first cut declared two equal
 * literals and a test that they matched; the audit of 2026-09-05 pointed out
 * that such a test only catches a later hand edit, not a structural tie.)
 * `raw-mail-retention.spec.ts` still asserts the equality, now as documentation.
 */

/** The longest gap between two quarterly derivations, in days. See above. */
export const LONGEST_QUARTER_DAYS = 92;

export const RETENTION_MARGIN_DAYS: number = LONGEST_QUARTER_DAYS;

/**
 * The rule table. Four jurisdictions are researched; everything else is
 * UNKNOWN, which is not a silent fallback — see `resolveJurisdiction`.
 */
export const JURISDICTION_RULES: Record<JurisdictionCode, JurisdictionRule> = {
  TR: {
    code: "TR",
    label: "Türkiye",
    factsFloorYears: 10,
    bindsCorrespondence: true,
    citations: [
      {
        statute: "Türk Ticaret Kanunu No. 6102, Art. 82",
        says:
          "Every trader must keep, in classified form, its commercial books, inventories and financial statements (para. 1(a)), the commercial letters it RECEIVED (para. 1(b)), copies of the commercial letters it SENT (para. 1(c)) and the documents underlying its entries (para. 1(d)). Para. 2 defines a commercial letter as all correspondence relating to a commercial matter. Para. 5: those documents are kept for TEN years. Para. 6: the period starts at the end of the calendar year in which the correspondence took place.",
        url: "https://mgm.adalet.gov.tr/Resimler/SayfaDokuman/181020191508056102sk.pdf",
        fetchedOn: "2026-09-05",
      },
      {
        statute: "Vergi Usul Kanunu No. 213, Art. 253",
        says:
          "Those obliged to keep books under this Law must keep the books they keep and the documents named in the third part for FIVE years, starting from the calendar year following the year they relate to.",
        url: "https://hukukmusavirligi.diyanet.gov.tr/Documents/213%20Say%C4%B1l%C4%B1%20Vergi%20Usul%20Kanunu.pdf",
        fetchedOn: "2026-09-05",
      },
    ],
    why:
      "Ten years, because a Turkish house must satisfy both statutes and the Commercial Code's ten is longer than the Tax Procedure Law's five. Türkiye is also the one jurisdiction here whose words reach the correspondence itself and not only the books: a vendor's reply about an order is a commercial letter received.",
  },
  GB: {
    code: "GB",
    label: "United Kingdom",
    factsFloorYears: 6,
    bindsCorrespondence: false,
    citations: [
      {
        statute: "Companies Act 2006, s.388(4)",
        says:
          "Accounting records must be preserved 'in the case of a private company, for three years from the date on which they are made; in the case of a public company, for six years from the date on which they are made.'",
        url: "https://www.legislation.gov.uk/ukpga/2006/46/section/388",
        fetchedOn: "2026-09-05",
      },
      {
        statute: "HMRC and Companies House guidance for a limited company",
        says:
          "'You must keep records for 6 years from the end of the last company financial year they relate to', or longer where a transaction covers more than one accounting period, an asset outlasts six years, a return was filed late, or HMRC has opened a compliance check. The accounting records named include the supporting documents for goods bought and sold and who they were bought from and sold to.",
        url: "https://www.gov.uk/running-a-limited-company/company-and-accounting-records",
        fetchedOn: "2026-09-05",
      },
    ],
    why:
      "Six years, because HMRC's six binds every company while s.388(4)'s three applies only to a private company's accounting records, and a house must satisfy both.",
  },
  US: {
    code: "US",
    label: "United States",
    factsFloorYears: 7,
    bindsCorrespondence: false,
    citations: [
      {
        statute: "IRS, Period of Limitations for records",
        says:
          "Three years as the ordinary rule; SIX years 'if you do not report income that you should report, and it is more than 25% of the gross income shown on your return'; SEVEN years 'if you file a claim for a loss from worthless securities or bad debt deduction'; employment tax records 'at least 4 years after the date that the tax becomes due or is paid, whichever is later'. Records are kept indefinitely where no return was filed or a fraudulent return was filed.",
        url: "https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records",
        fetchedOn: "2026-09-05",
      },
    ],
    why:
      "Seven years, the longest FIXED period the IRS states. The indefinite cases are not a schedule a compliant house plans around — they are the consequence of not filing or filing fraudulently — so they are named above and not used as the floor.",
  },
  "US-CA": {
    code: "US-CA",
    label: "United States (California)",
    factsFloorYears: 7,
    bindsCorrespondence: false,
    citations: [
      {
        statute: "IRS, Period of Limitations for records",
        says:
          "Three years ordinarily, six where more than 25% of gross income is unreported, seven for a worthless-securities or bad-debt claim, four for employment tax records.",
        url: "https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records",
        fetchedOn: "2026-09-05",
      },
      {
        statute: "CDTFA Publication 116, Retaining Records",
        says:
          "'You should keep required records for at least four years unless we give you specific, written authorization to destroy them sooner.' Records covering an audit period are kept 'until the audit is complete, even if that means keeping them longer than four years', and where there is a disagreement about tax owed they are kept 'while that matter is pending'.",
        url: "https://www.cdtfa.ca.gov/formspubs/pub116/retaining-records.htm",
        fetchedOn: "2026-09-05",
      },
      {
        statute: "CCPA/CPRA, Cal. Civ. Code s.1798.100(a)(3) and (c)",
        says:
          "A business must disclose 'the length of time the business intends to retain each category of personal information, including sensitive personal information, or if that is not possible, the criteria used to determine that period', and its 'collection, use, retention, and sharing of a consumer's personal information shall be reasonably necessary and proportionate to achieve the purposes for which the personal information was collected.'",
        url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=1798.100.&lawCode=CIV",
        fetchedOn: "2026-09-05",
      },
    ],
    why:
      "Seven years: the federal floor still binds a California house, and California's own four-year sales-and-use-tax rule is shorter. California is also why the consent screen prints a figure at all rather than a promise — s.1798.100(a)(3) asks for the length of time or the criteria, and this build gives both.",
  },
  UNKNOWN: {
    code: "UNKNOWN",
    label: "Not recorded",
    factsFloorYears: 10,
    bindsCorrespondence: true,
    citations: [
      {
        statute: "Türk Ticaret Kanunu No. 6102, Art. 82",
        says:
          "Ten years for commercial books, the commercial letters received, copies of those sent, and the documents underlying the entries; the period starts at the end of the calendar year of the entry or the correspondence.",
        url: "https://mgm.adalet.gov.tr/Resimler/SayfaDokuman/181020191508056102sk.pdf",
        fetchedOn: "2026-09-05",
      },
    ],
    why:
      "Ten years, which is the strictest rule in this table, because it is the only answer that cannot be wrong in the direction that costs the house evidence it was legally obliged to hold.",
    defaultedBecause:
      "This restaurant has no country recorded, so its jurisdiction is not known. The strictest rule in the table is applied rather than a guess: a floor that is too long costs storage, and a floor that is too short costs a record the house may be required by law to produce. Recording the restaurant's country replaces this default with its own rule.",
  },
};

/**
 * The storage-limitation regimes. These are CEILINGS, not floors, and they are
 * the reason the raw mail has a window at all. They are listed separately
 * because mixing a ceiling into a floor table is how a retention rule ends up
 * defending the wrong direction.
 */
export const STORAGE_LIMITATION_SOURCES: StatuteCitation[] = [
  {
    statute: "EU GDPR Art. 5(1)(e) and Art. 28(3)(g)",
    says:
      "Personal data is kept 'no longer than is necessary for the purposes for which the personal data are processed'; and a processor, 'at the choice of the controller, deletes or returns all the personal data to the controller after the end of the provision of services... and deletes existing copies unless Union or Member State law requires storage of the personal data.' The controller here is the house; Mudavym runs the mirror as processor.",
    url: "https://gdpr-info.eu/art-5-gdpr/",
    fetchedOn: "2026-09-05",
  },
  {
    statute: "Türkiye KVKK, Law No. 6698, Art. 4(2)(ç)",
    says:
      "Personal data must be 'stored for the period laid down by relevant legislation or the period required for the purpose for which the personal data are processed.'",
    url: "https://www.kvkk.gov.tr/Icerik/6649/Personal-Data-Protection-Law",
    fetchedOn: "2026-09-05",
  },
  {
    statute: "Google Workspace API User Data Developer Policy (Limited Use)",
    says:
      "Transfers and uses beyond providing or improving the consented feature are barred, and using the data 'to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model for the appropriate use case' is prohibited outright. Nothing on that page requires deletion on revocation — the deletion rule below is this house's choice, not Google's mandate.",
    url: "https://developers.google.com/workspace/workspace-api-user-data-developer-policy",
    fetchedOn: "2026-09-05",
  },
];

/**
 * Turn what `restaurants` actually stores into a rule.
 *
 * `restaurants.country` is `varchar(100)` and holds whatever the source that
 * wrote it used — a Places-style name ("United States"), a code ("US"), or
 * nothing at all (20260811000000_fix_territory_gate_normalization.sql:7 says
 * exactly this about the same column). So this normalises the way that
 * migration's `normalize_country_code` does — two letters pass through
 * uppercased, a known name maps to its code — but ONLY for the jurisdictions
 * this table actually researched. A country this table has not researched is
 * UNKNOWN, not a nearest guess: the table's authority is the statutes in it,
 * and a code with no row is a house whose law nobody here has read.
 */
export function resolveJurisdiction(
  country: string | null | undefined,
  stateProvince?: string | null,
): JurisdictionCode {
  const raw = (country ?? "").trim();
  if (!raw) return "UNKNOWN";

  const upper = raw.toUpperCase();
  const named: Record<string, JurisdictionCode> = {
    TR: "TR",
    TURKEY: "TR",
    TURKIYE: "TR",
    "TÜRKIYE": "TR",
    "TÜRKİYE": "TR",
    GB: "GB",
    UK: "GB",
    "UNITED KINGDOM": "GB",
    "GREAT BRITAIN": "GB",
    US: "US",
    USA: "US",
    "UNITED STATES": "US",
    "UNITED STATES OF AMERICA": "US",
  };

  const code = named[upper];
  if (!code) return "UNKNOWN";
  if (code !== "US") return code;

  const state = (stateProvince ?? "").trim().toUpperCase();
  if (state === "CA" || state === "CALIFORNIA") return "US-CA";
  return "US";
}

export function ruleFor(code: JurisdictionCode): JurisdictionRule {
  return JURISDICTION_RULES[code];
}

/**
 * The strictest rule, named once so the default and the tests cannot drift.
 * "Strictest" is resolved per OBJECT: for the FACTS it means the LONGEST floor
 * (the house keeps evidence it may be obliged to produce); it says nothing
 * about the raw-mail window, which is derived from disputes and never from a
 * statute.
 */
export const STRICTEST_JURISDICTION: JurisdictionCode = "UNKNOWN";

/**
 * The words the consent screen prints for the split. Kept here rather than in
 * the page for the same reason the scope list is (ADR 0118, and the note on
 * `AuthorizeIntegration.tsx`): a consent screen that composes its own copy can
 * drift from what the server actually does, and a privacy sentence that has
 * drifted is worse than none.
 */
export const RETENTION_DISCLOSURE_COPY = {
  split:
    "A vendor's reply that reaches this house through your mailbox is kept as two separate things. The mail itself - the body you would read, its headers and any attachment - is a copy of your mailbox and is deleted when its window runs out. What the order needs from it - a quoted price, a confirmed date, a written commitment, and the exact sentence it was stated in - is written onto this restaurant's own order record and stays there under the bookkeeping rule below.",
  revocation:
    "If you disconnect this grant, two things happen straight away and neither of them waits for a window: nothing more is read from your mailbox, and every piece of raw mail already mirrored under this grant is deleted - body, headers and attachment bytes. The order's own facts are not touched, because they are this restaurant's record and not a copy of your mailbox. The owner of the grant is told what was deleted, with a count.",
  windowIntro:
    "The mail's own window is not a round number. It is the longest dispute this restaurant has actually recorded, plus a margin equal to one re-derivation interval, and it is worked out again every quarter from this restaurant's own conversations.",
} as const;
