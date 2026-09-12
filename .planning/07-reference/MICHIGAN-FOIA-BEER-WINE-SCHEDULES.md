---
type: reference
title: Michigan FOIA — the filed beer and wine price schedules
status: draft, not sent
updated: 2026-09-05
links: ["[[0126-a-price-behind-a-licence-is-not-a-posting]]", "[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]"]
---

# Michigan FOIA — the filed beer and wine price schedules

**Nothing here has been sent, and no agent may send it.** This is a text for the founder to
review, address and file himself. The register records the request's status as `not_yet_filed`
(`price-index.registry.ts`, `michigan-lcc-filed-beer-wine-schedules`) and it stays there until a
person actually files it and moves it in a commit.

**Retire-to-write.** This supersedes the closing claim of `price-sources.md` §"Michigan and
Illinois, measured 2026-09-05" — *"only a FOIA request reaches them"* — and ADR 0117's founder
question 19, which called the schedules "public records" a standing quarterly request would turn
into a posted list. Both are corrected below, and neither is deleted: the correction is dated in
place so the earlier reading stays legible.

---

## 1. Read this before filing it: the answer can never be current

`MCL 436.1609a`, read verbatim on 2026-09-05 (`codes.findlaw.com`, HTTP 200; `legislature.mi.gov`
answers 403 to this environment and `michigan.gov` answers 403 on every path including its own
`robots.txt`):

> "A net cash price filed under subsection (1) and a price change filed under subsection (2) are
> exempt from disclosure under section 13 of the freedom of information act, 1976 PA 442,
> MCL 15.243, until 1 year after the net cash price or price change is filed."

The same exemption is stated for the wine filings under subsections (10) and (11).

So the Commission may lawfully refuse — and, reading the statute, must refuse — any schedule filed
less than a year ago. What a request can reach is the schedules filed **twelve months ago or
earlier**. Filing quarterly gets a rolling twelve-month-lagged series, not a current price list.

Three consequences worth deciding before the first request goes out:

1. **It is a history, not a posted price.** Beside a 2026 invoice it is context, never a
   comparison. The register's own class rule already forbids comparing a class-B posting to
   anything but same-state class A, and a year-old schedule fails the freshness half of that on its
   face.
2. **The register's bound had to be widened to admit it at all**, to 480 days
   (365 embargo + up to 91 days of quarter + ~21 calendar days for a 5-business-day answer and its
   single 10-business-day extension). That number is the arithmetic of an embargo and is documented
   as such, so nobody later reads it as a freshness allowance and copies it to another source.
3. **Wine and beer have different cadences.** `R 436.1726(1)` requires wine schedules filed
   "before January 1, April 1, July 1, and October 1 of each year". `R 436.1625` sets **no**
   recurring date for beer — it requires a schedule and requires a reduction to be filed before its
   effective date and held "at least 180 days". So a quarterly request is wine's natural rhythm and
   is only an approximation for beer. Both rules read verbatim on `law.cornell.edu`, HTTP 200,
   2026-09-05.

## 2. What could not be verified, and must be checked before sending

**The recipient.** LARA's current FOIA coordinator, postal address and FOIA email could not be
read: every `michigan.gov` path — including `/lara/foia-request`, `/lara/about/foia` and
`robots.txt` itself — answers **HTTP 403** from an Akamai edge to both fetchers available here,
and so does `mi.gov`. A web-search snippet returned "P.O. Box 30004, Lansing, MI 48909"; that is a
snippet, not a page anyone read, and it is written below in square brackets for that reason.
**Open michigan.gov in a browser and confirm the coordinator and address before sending.**

**The fee.** `MCL 15.234` permits six heads of charge — search and examination labour at no more
than "the hourly wage of its lowest-paid employee capable of searching for, locating, and examining
the public records", redaction labour, non-paper media at "the actual and most reasonably economical
cost", paper copies capped at 10 cents a sheet, duplication labour, and actual mailing cost — and
allows a deposit of at most half once the estimate passes $50.00. No estimate for these particular
records is known. The request below asks for a written estimate before any work is done.

**The response window.** `MCL 15.235(2)`: five business days, extendable once by not more than ten
business days, and "a public body shall not issue more than 1 notice of extension for a particular
request". A request sent by email is not received "until 1 business day after the electronic
transmission is made".

## 3. The request

> To: [FOIA Coordinator, Michigan Department of Licensing and Regulatory Affairs — **confirm the
> current name, email and postal address on michigan.gov before sending**; a search snippet gives
> P.O. Box 30004, Lansing, MI 48909, and that was not verifiable from here]
>
> Subject: FOIA request — filed net cash price schedules for beer and wine, Liquor Control
> Commission
>
> Dear FOIA Coordinator,
>
> Under the Michigan Freedom of Information Act, 1976 PA 442, MCL 15.231 et seq., I request copies
> of the following records held by the Liquor Control Commission:
>
> 1. Every schedule of net cash prices to retail licensees for **wine, mixed wine drink and mixed
>    spirit drink** filed with the Commission under Mich. Admin. Code R. 436.1726(1) and
>    MCL 436.1609a, for the filing quarters beginning on or after [DATE — the quarter that fell due
>    at least one year and one day before the date of this letter], **excluding** any filing made
>    within the last 365 days.
>
> 2. Every schedule of net cash prices to the retail licensee for **case and keg beer** filed with
>    the Commission under Mich. Admin. Code R. 436.1625 and MCL 436.1609a over the same period, and
>    every price reduction filed under those provisions over the same period, **excluding** any
>    filing made within the last 365 days.
>
> 3. Any index, log or register the Commission maintains of the filings described in items 1 and 2
>    — for example a list of filing manufacturers and wholesalers by market area and filing date.
>
> I have deliberately excluded filings made within the last 365 days, since MCL 436.1609a exempts a
> filed net cash price and a filed price change from disclosure under MCL 15.243 until one year
> after filing. Nothing in this request seeks a record within that period, and I would ask that the
> request not be denied in whole on that ground.
>
> **Format.** Under MCL 15.234(3) I stipulate that the records be provided electronically rather
> than as paper copies. Where the Commission holds a record in a spreadsheet, delimited text or
> database format, I request it **in that native format** rather than as a scan or a PDF export of
> it. Where only a scanned or paper original exists, an electronic image is acceptable.
>
> **Fees.** Before any labour is performed, please provide a written itemised estimate under
> MCL 15.234(4), including the classification and hourly wage used for any labour charge. I do not
> authorise any charge in advance of that estimate. If a deposit is required I will pay it on
> receipt of the estimate.
>
> **Narrowing.** If the request as written would attract a substantial fee, I would welcome a call
> or an email to narrow it — for instance to a single filing quarter, to a named set of wholesalers,
> or to wine only — rather than a denial or a large estimate.
>
> **Partial denial.** If any part of a responsive record is exempt, please provide the remainder
> and, as MCL 15.235(5) requires, a written explanation of the exemption claimed and its statutory
> basis for each withheld portion.
>
> I understand a response is due within five business days of receipt, extendable once by not more
> than ten business days under MCL 15.235(2).
>
> [Name]
> [Postal address — required, since a paper response is possible]
> [Email address]
> [Telephone]
> [Date]

## 4. What happens to the answer when it arrives

**It cannot be uploaded through the existing route today, and that is stated rather than
discovered later.** `POST /price-index/upload` calls `michiganRowsFromWorkbook` and `parseMichigan`
for every source key it accepts, so it can read the MLCC's own `.xlsx` price book and nothing else.
The Commission's format for these schedules is unknown — nobody has seen one — so no parser was
written and the source deliberately carries no `parse`. Writing one against a guessed layout is the
fault ADR 0117 named when it refused to write a Michigan parser before a real edition existed.

The order of work when an answer lands:

1. Record the answer's bytes and their sha256, the request date, the response date and the
   Commission's own covering letter, the way `__fixtures__/MICHIGAN-PROVENANCE.md` records the
   price book.
2. Read the format. If it is tabular and machine-readable, write the parser against the real
   sample; if it is a scan, say so and stop — a hand-typed price list has no issuer and would fail
   ADR 0117's own provenance test.
3. Only then extend the upload route, which today hard-codes one source's reader for every source
   key it accepts. That is a latent defect the moment a second uploadable source exists, and it is
   named here rather than left for whoever hits it.
4. Move `standingRequest.status` in the same commit that lands the answer, so the register's claim
   about the request and the request's actual state are changed by one hand at one time.
