/**
 * The letter a house sends its distributor asking for an invoice feed.
 *
 * THE FOUNDER, 2026-09-05 (ADR 0126, batch 56): *"The house signs; SGWS first,
 * asking for 810."* A real house's owner signs it on their own letterhead, with
 * Mudavym named as the software that would receive the file. Southern Glazer's
 * first, because it is the one of the three Illinois distributors with a
 * documented EDI programme (850/856/810/997 on two independent trading-partner
 * pages, read 2026-09-05). The ask is an **EDI 810 invoice feed**, not an 832
 * price catalogue: no distributor measured ships an 832 to a venue, and the
 * industry's own answer — Restaurant365's vendor table, MarginEdge's own
 * sentence — is that an order guide is built from invoices.
 *
 * THIS PRODUCT NEVER SENDS IT, AND CANNOT.
 * ----------------------------------------
 * There is no route that mails this, no address field, and no scheduler. It is
 * served as a document to download, print on the house's letterhead, fill in
 * and sign. The reason is not squeamishness: the letter says "nothing has been
 * built and no software of ours has ever accessed your systems", which is true
 * of this tree and is the sentence that makes the request credible. A letter a
 * vendor's software sent on a house's behalf is a different letter.
 *
 * WHY THE BRACKETS ARE NOT FIELDS THIS PRODUCT FILLS IN
 * ----------------------------------------------------
 * The licence number, the account number and the consultant's name are the
 * three things this product does not hold and must not guess: an Illinois
 * retail licence number is not in any table here, and a wrong one on a letter
 * to a distributor's compliance desk is worse than a blank. They are brackets a
 * person completes, and the panel says so.
 */

/** The single source of the letter's text. `.planning/07-reference/
 *  DISTRIBUTOR-INVOICE-FEED-LETTER.md` carries this body verbatim, and
 *  `feed-request-letter.spec.ts` fails if the two ever drift. */
export const FEED_REQUEST_LETTER = Object.freeze({
  id: "distributor-invoice-feed-request" as const,
  filename: "distributor-invoice-feed-request.txt",
  subject: "Request to enable an electronic invoice feed for our account",
  /** Who signs, in one sentence, because it is the thing most likely to go wrong. */
  signedBy:
    "The house signs this, on the house's own letterhead. Mudavym is named in it as the software that would receive the file; Mudavym is not a party to it and does not send it.",
  firstAsk:
    "Southern Glazer's Wine & Spirits of Illinois — the one of the three Illinois distributors with a documented EDI programme (850, 856, 810 and 997 on two independent trading-partner pages, read 2026-09-05).",
  neverSent:
    "This product has no route that sends this letter, no address field and no schedule. It is a document to print, complete and sign. The letter's own sentence — that no software of ours has ever accessed your systems — is true today and stops being true the moment anybody builds a mirror, so it goes before any build and not after.",
  /** Every bracket a person must complete before this is worth sending. */
  brackets: Object.freeze([
    "[Sales Consultant name]",
    "[distributor]",
    "[account number]",
    "[state] retail licence [licence number]",
    "[name], [title], [restaurant]",
    "[contact telephone and email]",
    "[SFTP or email address]",
  ]),
  body: `Re: Request to enable an electronic invoice feed for our account

Dear [Sales Consultant name],

We are a licensed [state] retailer and a customer of [distributor] at account
[account number], retail licence [licence number]. We are writing to ask that
our account be enabled for an electronic invoice feed, and to ask you to route
this to whoever handles customer EDI and integrations.

What we are asking for. An EDI 810 invoice, transmitted for our account each
time you invoice us, carrying for each line: your item number, the product
description, the pack and the container size, the unit of measure, the quantity,
the unit price we were charged, any allowance or charge applied to the line, and
the invoice date. If an order guide or price file for our account is easier for
you to enable than the 810, that would serve us as well. We do not need -- and
are not asking for -- any other account information: not our balance, not our
credit terms, not anything about any other customer of yours.

What it is for. We are trying to cost our menu and our purchase orders against
the prices we actually pay. Today we key that off paper invoices after the fact,
which means we find out about a price change once we have already bought at it.

Why we are writing rather than automating. Your terms of use are clear that we
may not read your portal by automated means, and we are not going to. We would
rather ask you for a file than take one. Nothing has been built and no software
of ours has ever accessed your systems.

This is not unusual outside our category. Our back-office software receives
exactly this kind of file from broadline foodservice distributors as a matter of
routine. We are asking for the same thing for beverage.

How we would like to receive it. We authorise Mudavym, the software we use to
run our purchasing and inventory, to receive this file on our behalf and to
speak to your team about the technical setup. Send it to [SFTP or email address].
We are content to sign whatever confidentiality or data-use undertaking your
legal team requires, and to keep the file to our own operations.

If an invoice feed is not something you offer, we would still like to know:
(a) whether any electronic file of our own invoices can be enabled for our
account, and to whom we should address that; (b) whether you have an integration
programme our back-office software could apply to join; and (c) whether there is
any regulatory reason a per-customer data file is difficult for you, so that we
stop asking for the wrong thing.

Thank you. A "no" with a reason is genuinely useful to us and we will not press
it.

[name], [title], [restaurant]
[state] retail licence [licence number]
[contact telephone and email]
`,
});

export type FeedRequestLetter = typeof FEED_REQUEST_LETTER;
