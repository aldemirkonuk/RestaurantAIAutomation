/**
 * What a house must provide to send a text in its OWN name — per channel, per
 * path, per market (ADR 0121, the parts the founder decided on 2026-09-05).
 *
 * WHY THIS IS A CONSTANT AND NOT PAGE PROSE
 * -----------------------------------------
 * ADR 0114 closed G20 by refusing a fourth OAuth catalogue: `/connections`,
 * `/settings` and `/profile` all read `GET /integrations/oauth/catalog`, served
 * from one shared constant, because three hand-written subsets of the same list
 * is how a product ends up telling three different stories about what it can
 * do. The same rule applies here one product over. A manager reading
 * "you will need your tax id" on `/connections` and a founder reading a
 * different requirement in an ADR is the same fault.
 *
 * EVERY FIGURE CARRIES ITS SOURCE AND THE DATE IT WAS FETCHED, and figures that
 * could NOT be fetched from a primary source say so in the same sentence rather
 * than being rounded into the table (`.planning/07-reference/messaging-senders.md`
 * §7 and §9 are the standing list of those). A fee with no citation outlives
 * its citation, which is why `fee` and `timeline` here are SENTENCES and not
 * numbers — the same reason `house_text_senders.fee_stated` is `TEXT`.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * There is no `price` field and no total. Mudavym has not decided who pays for
 * a sender (OD-23, and ADR 0121's founder question 3), so a number that looked
 * like a quote would be answering a question the founder has not answered.
 */

/** The two channels a house can send a text through. */
export type TextChannel = "whatsapp" | "sms";

/**
 * The two ways a house gets a sender, in the founder's own framing
 * (2026-09-05): *"the house must either brings their own name and we have to
 * make sure the connection is secure or with mudavym help buys per house and
 * bills with info"*.
 */
export type SenderPath = "bring_your_own" | "mudavym_registers";

export interface MarketRequirement {
  /** ISO 3166-1 alpha-2. */
  market: string;
  marketLabel: string;
  /** Can a reply come back on this channel in this market? */
  twoWay: boolean;
  /** What the house has to hand over, item by item. */
  provides: string[];
  /** What it costs, in words, with the source. Never a bare number. */
  fee: string;
  /** How long it takes, in words, with the source. */
  timeline: string;
  /** What will refuse the sender, stated before the house applies. */
  refusals: string[];
}

export interface TextSenderDefinition {
  id: "whatsapp_business" | "sms_sender";
  channel: TextChannel;
  label: string;
  providerLabel: string;
  /** One sentence a manager reads before deciding. */
  description: string;
  /**
   * How the house's credential reaches this platform WITHOUT the house ever
   * typing a password here. Named per path, because the two are different
   * mechanisms with different revocation stories.
   */
  connection: Record<SenderPath, string>;
  /** How the house takes it back. */
  revocation: string;
  /** What the platform can do to the house, stated plainly. */
  custody: string;
  markets: MarketRequirement[];
}

/**
 * The WhatsApp Business Platform (Cloud API) sender.
 *
 * The pricing shape is the finding, and it is why this is the first channel:
 * Mudavym's traffic is reply-shaped (a vendor writes, the house answers), and
 * every non-template message inside an open 24-hour customer service window is
 * free — Meta's own pricing page, "All non-template messages are free", fetched
 * 2026-09-05. The charge lands only where the house STARTS a conversation,
 * through a template Meta approved.
 */
const WHATSAPP: TextSenderDefinition = {
  id: "whatsapp_business",
  channel: "whatsapp",
  label: "WhatsApp Business",
  providerLabel: "Meta (Cloud API)",
  description:
    "The house's own WhatsApp Business number. A vendor or a crew member sees the house's name, replies in the app they already use, and the reply comes back into this house's book.",
  connection: {
    bring_your_own:
      "Meta's Embedded Signup. The house signs in to its own Meta account in Meta's window, picks or creates its business portfolio and its WhatsApp Business Account, verifies the number by OTP and sets the display name. Meta hands back the WABA id, the business phone number id and an exchangeable token code — never the house's password, which this product never sees and has no field for. The token is exchanged server-side and stored in the same encrypted record the OAuth grants use.",
    mudavym_registers:
      "The same Embedded Signup, operated by Mudavym as a Tech Provider, against the HOUSE's own business portfolio. Mudavym's app needs advanced access for whatsapp_business_management and whatsapp_business_messaging before it may onboard anybody (Meta: \"You will not be able to onboard business customers until your app has been approved for advanced access\", fetched 2026-09-05). The house still signs in as itself; what Mudavym supplies is the number, the paperwork and the operating.",
  },
  revocation:
    "The house removes Mudavym's app from its WhatsApp Business Account in Meta's own Business settings, or a manager revokes the sender here. Either one stops the next send: nothing outbound is attempted without a state of 'connected'.",
  custody:
    "Meta holds the transport and may \"review, approve, pause and reject any Message Template at any time\". It does not hold the record: every inbound and outbound is written into this house's conversation book before it is rendered anywhere, so a paused number costs the house its next message and never its history.",
  markets: [
    {
      market: "TR",
      marketLabel: "Türkiye",
      twoWay: true,
      provides: [
        "A phone number NOT already active on the WhatsApp or WhatsApp Business app — a number already on WhatsApp cannot be registered until the existing account is deleted. Most restaurants' own mobiles fail this.",
        "A Meta business portfolio, and Meta Business Verification before production messaging.",
        "A display name Meta's review accepts.",
        "An opt-in from each person the house messages — Meta's policy requires it independently of any law.",
      ],
      fee: "Non-template replies inside an open 24-hour window are free (Meta pricing, fetched 2026-09-05). Only a house-STARTED conversation is charged, and only through an approved template. Türkiye per-message template rates were NOT fetched from Meta's own rate card this pass — Meta serves it as a CSV/rate-card download behind an interactive tool, and the figures in circulation (marketing about $0.0109, utility about $0.0014 from 2026-04-01) come from third-party summaries. Treat them as unverified.",
      timeline:
        "Sender registration itself completes in minutes once the number verifies. Meta Business Verification \"can take several weeks\" (Twilio's WhatsApp onboarding guidance, 2026-09-05), and a newly created business portfolio is capped at 250 messages in 24 hours until it verifies (Meta messaging limits, fetched 2026-09-05).",
      refusals: [
        "A number already on WhatsApp.",
        "A display name Meta declines — messaging is then limited to 250 messages per 24 hours.",
        "Messaging a person who has not opted in.",
      ],
    },
    {
      market: "US",
      marketLabel: "United States",
      twoWay: true,
      provides: [
        "A phone number not already active on WhatsApp.",
        "A Meta business portfolio and Meta Business Verification.",
        "A display name Meta's review accepts.",
        "An opt-in from each recipient.",
      ],
      fee: "Same shape as Türkiye: free-form inside an open 24-hour window is free; templates are charged per delivery at Meta's per-country rate. The US rate card was not transcribed this pass, for the same reason.",
      timeline:
        "Minutes for the sender; several weeks for Meta Business Verification; 250 messages per 24 hours until then.",
      refusals: [
        "A number already on WhatsApp.",
        "A declined display name.",
        "Messaging a person who has not opted in.",
      ],
    },
  ],
};

/**
 * The SMS sender.
 *
 * TWO COMPLETELY DIFFERENT PRODUCTS UNDER ONE NAME. A US SMS sender is a 10DLC
 * brand plus a campaign registered with The Campaign Registry against the
 * house's own EIN. A Türkiye SMS sender is an alphanumeric Sender ID registered
 * on paper with the Turkish operators, one-way, and it cannot receive a reply
 * at all. Rendering them as one row would be claiming a capability in one
 * market that only exists in the other.
 */
const SMS: TextSenderDefinition = {
  id: "sms_sender",
  channel: "sms",
  label: "SMS sender",
  providerLabel: "The Campaign Registry (US) / the Turkish operators (TR)",
  description:
    "A registered SMS sender in the house's own name — a US 10DLC number under the house's own brand, or a Turkish alphanumeric Sender ID carrying the house's name.",
  connection: {
    bring_your_own:
      "The house's existing provider account is connected as its own subaccount, with an API key scoped to that subaccount. Mudavym never holds the house's parent credentials and never its password; the key is stored in the same encrypted record the OAuth grants use, and the house can rotate or delete it at its provider without asking anybody here.",
    mudavym_registers:
      "Mudavym operates the registration in a subaccount of its own platform account, one per house — but the identity registered is the HOUSE's, never Mudavym's. That is not a preference: a regulatory bundle \"must represent the actual end-user\" and \"Twilio audits this\", and an ISV registering a Sender ID \"must provide your customers' business and representative information, including a government ID for verification\" (Twilio, fetched 2026-09-05).",
  },
  revocation:
    "A manager revokes the sender here, which stops the next send immediately. Releasing the number or the campaign at the provider is a separate act with no undo — a released number goes back to the pool and cannot be reclaimed.",
  custody:
    "The carrier relationship is the house's own brand, which is the one thing SMS has that WhatsApp does not: a support path and a regulator behind it. What it costs is a fixed registration fee that recurs per house, and it is the dominant cost of the channel — not the messages.",
  markets: [
    {
      market: "US",
      marketLabel: "United States",
      twoWay: true,
      provides: [
        "The legal business name EXACTLY as it appears on EIN records — a marketing name is the most common rejection.",
        "The EIN or business tax id, the business type, and the registered address.",
        "A live, publicly reachable website. A staging URL, a localhost URL or a 404 is rejected.",
        "A named contact: first name, last name, corporate email, phone.",
        "A campaign use case and at least two sample messages that match it, each carrying an opt-out line.",
        "The opt-in flow written out in 40 to 2049 characters, naming the method, the message frequency, the \"message and data rates may apply\" disclosure, and a PUBLICLY reachable link or screenshot of the opt-in itself. Reviewers click the links.",
        "A privacy policy stating mobile information is NOT shared with third parties for marketing, and terms carrying HELP and STOP instructions in bold.",
      ],
      fee: "One-time: $44 brand registration (Standard), $4 (Low-Volume Standard or Sole Proprietor), plus a $15 one-time campaign vetting fee. Recurring: $1.50-$10 per campaign per month ($2 Sole Proprietor), plus the number's own monthly rental. Twilio's A2P 10DLC product page, fetched 2026-09-05. The recurring part is PER HOUSE and does not amortise.",
      timeline:
        "13-20 business days end to end: the brand is typically approved within minutes to 3-5 business days, and the campaign takes 10-15 business days (Twilio ISV onboarding guidance, fetched 2026-09-05). Nothing sends before the campaign is approved — unregistered traffic is blocked with error 30034.",
      refusals: [
        "A brand name that does not match EIN records exactly.",
        "An opt-in description a reviewer cannot follow, or a link behind a login.",
        "Consent made a condition of buying or of creating an account — \"the registration will be rejected\".",
        "One Mudavym brand with a campaign per house: The Campaign Registry caps a brand at 100 campaigns (Twilio error 30930), T-Mobile levies $1,000 for snowshoeing or unauthorized number replacement, and after a warning $10,000 per unique content violation lands on the brand — which would be Mudavym's, for a sentence a manager typed.",
        "A shared number: Twilio's US SMS guidelines list \"shared phone numbers\" among the restricted use cases, and a STOP reply to a shared number opts the person out of every restaurant on the deployment for five years (47 CFR 64.1200(d)(6)).",
      ],
    },
    {
      market: "TR",
      marketLabel: "Türkiye",
      twoWay: false,
      provides: [
        "A company or brand registration certificate.",
        "A Letter of Authorization from the house to the provider, on the HOUSE's own letterhead, signed by an authorized signatory and stamped.",
        "An authorization letter and an NOC letter, on the same terms.",
        "If the Sender ID does not match the company name, a formal document — a trademark registration or an official website — showing the link between the two.",
        "Prior consent for each recipient recorded in İYS, the national registry under Law 6563, alongside KVKK obligations. NOTE: İYS's own pages are client-rendered and could not be fetched on 2026-09-04 or 2026-09-05; this row rests on a summary and is the weakest citation here.",
      ],
      fee: "Roughly $0.0275-$0.0305 per message at published aggregator rates (Bird, Twilio; fetched 2026-09-04), plus whatever the operator charges for the Sender ID. The registration itself is paperwork rather than a listed fee, and Twilio publishes no price for it.",
      timeline:
        "About two weeks to provision (Twilio Türkiye guidelines, fetched 2026-09-05). From 2026-11-18 messages with unregistered Sender IDs to Turkish networks are BLOCKED, so this is a deadline and not a preference.",
      refusals: [
        "A reply. Two-way SMS is not supported in Türkiye — \"Two-way SMS supported: No\". An SMS here can carry a notice; it cannot carry a conversation, and this product must never draw a thread over a channel that cannot receive one.",
        "Promotional traffic, which has been prohibited since 2021-02-15.",
        "A URL in the message body, for any company without a local Turkish entity, effective 2026-04-01.",
        "A Sender ID that resembles a domain name.",
        "P2P, gambling, political and religious content.",
      ],
    },
  ],
};

export const TEXT_SENDER_DEFINITIONS: Record<
  TextSenderDefinition["id"],
  TextSenderDefinition
> = {
  whatsapp_business: WHATSAPP,
  sms_sender: SMS,
};

export const TEXT_SENDER_IDS = Object.keys(
  TEXT_SENDER_DEFINITIONS,
) as Array<TextSenderDefinition["id"]>;

export function definitionForChannel(
  channel: TextChannel,
): TextSenderDefinition {
  return channel === "whatsapp" ? WHATSAPP : SMS;
}

/**
 * The requirement row for a channel in a market, or `null` when this build has
 * not surveyed that market.
 *
 * `null` IS A REAL ANSWER AND IS NOT AN EMPTY REQUIREMENT LIST. A house in a
 * market nobody researched must be told that nobody researched it, never shown
 * an empty checklist that reads as "nothing needed".
 */
export function requirementFor(
  channel: TextChannel,
  market: string,
): MarketRequirement | null {
  return (
    definitionForChannel(channel).markets.find((m) => m.market === market) ??
    null
  );
}

/** The markets this build can actually answer for, per channel. */
export function surveyedMarkets(channel: TextChannel): string[] {
  return definitionForChannel(channel).markets.map((m) => m.market);
}
