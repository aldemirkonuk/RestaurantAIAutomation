---
type: reference
title: The distributor invoice-feed request letter — for the house to sign
status: draft, never sent by this product
updated: 2026-09-05
links: ["[[0126-a-price-behind-a-licence-is-not-a-posting]]", "[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]"]
---

# The distributor invoice-feed request letter

**The house signs this. Mudavym does not send it, and no route on this product can.**
The founder's call of 2026-09-05 (ADR 0126, batch 56), verbatim: *"The house signs; SGWS
first, asking for 810."* A real house's owner signs it on their own letterhead, with
Mudavym named in the letter as the software that would receive the file. The rejected
alternative was Mudavym signing on the house's written authority.

**Retire-to-write.** This supersedes the draft in `p4-scratch/p4be/p4be-law.md`
§"The draft letter", which asked for an **832 price catalogue** with the 810 as a
fallback question. That ordering is inverted here, and the reason is measured: no
distributor in the register ships an 832 to a venue, Southern Glazer's documented EDI
set on two independent trading-partner pages is 850/856/810/997 with no 832 among them,
Restaurant365 ticks Multi-Invoice and leaves Order Guides blank for all three
wine-and-spirits distributors it lists, and MarginEdge says in one sentence that it
builds order guides from invoices. Asking first for the thing nobody sends wastes the
one letter a house will write. The scratch draft is input, not a record; this file is
the record.

## Who it goes to, and in what order

**Southern Glazer's Wine & Spirits of Illinois first.** It is the one of the three
Illinois distributors in `distributor-feed.registry.ts` with a documented EDI programme.
Breakthru Beverage Illinois and Republic National Distributing publish no EDI or
integration route a customer can ask to join; a letter to either is a colder ask and
should follow, not lead.

**Addressed to the Sales Consultant.** None of the three publishes a customer-EDI or
data-services contact. Breakthru's own Account Services page directs customers to their
Sales Consultant, so that is the addressee, with a sentence asking them to route it
onward.

## The fields the house completes, and why this product does not

Seven brackets. The licence number, the account number and the consultant's name are the
three this product does not hold in any table and must not guess — a wrong retail licence
number on a letter to a distributor's compliance desk is worse than a blank. The panel on
`/connections` says the same thing beside the download.

- `[Sales Consultant name]`
- `[distributor]`
- `[account number]`
- `[state]` retail licence `[licence number]`
- `[name]`, `[title]`, `[restaurant]`
- `[contact telephone and email]`
- `[SFTP or email address]`

## One sentence in it is load-bearing

> Nothing has been built and no software of ours has ever accessed your systems.

That is true of this tree today — there is no mirror, no credential column, no fetcher —
and it stops being true the moment anybody builds one. So the letter goes **before** any
build, never after, and a house that has already run a scraper should strike the sentence
rather than send it untrue.

## The letter

The text below is served verbatim by `GET /distributor-feed/letter` from
`apps/api-gateway/src/distributor-feed/feed-request-letter.ts`, which is the single copy
that ships. `feed-request-letter.spec.ts` reads this file and fails if the two ever
disagree, so a change made in one place and not the other cannot survive a test run.

```
Re: Request to enable an electronic invoice feed for our account

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
```

## What happens when the answer arrives

- **An EDI 810 feed.** It goes through the door this house's invoices already go
  through: `POST /procurement/documents` routes any X12 810 into `parse810` and stores
  it as an invoice. Nothing new is needed — the path has existed and has never been
  asked for, which is the finding that produced this letter.
- **An 832 price catalogue, or a per-account price file.** Also the same door, stored as
  a `price_list`. Its lines are priced only under the price codes a manager of the house
  has stated the meaning of (ADR 0126 §7); every other line comes back refused with the
  code that refused it, so a catalogue that admits nothing says which code to state
  rather than reporting a bare zero.
- **A refusal with a reason.** The letter asks for one on purpose. Question (c) — whether
  a regulatory rule makes a per-customer file hard — is the one piece of information no
  public source could answer, and a "no, because…" is worth more than silence.

## What this file is not

It is not a filed request, not a sent letter, and not evidence that any distributor has
been asked for anything. As of 2026-09-05 nobody has sent it. If that changes, the change
is a commit, so who sent it and when is in git — the same rule the Michigan FOIA draft
records for the same reason.
