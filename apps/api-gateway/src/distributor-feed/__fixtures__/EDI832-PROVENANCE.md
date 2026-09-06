# Provenance of the two EDI 832 fixtures

Two files, and they are **not the same kind of thing**. One is real published bytes; the other is
constructed. Saying which is which is the whole point of this file — ADR 0117's rule is that a
sighting names its source, and a fixture that cannot name its own source teaches the parser to
accept anything.

**Neither file is a beverage-alcohol distributor's transmission.** No such transmission was
obtained, and none was found to exist: see `.planning/07-reference/price-sources.md` §"Illinois
distributor feeds, measured 2026-09-05" and ADR 0126. Nothing here proves a distributor sends an
832; it proves only that if one ever does, the parser reads its shape and refuses what it cannot
defend.

---

## 1. `edi832-msss-guide-sample-2022-06-02.edi` — real published bytes

* **703 bytes**, sha256 `7d046e065b753a5ce5522416bbcb14aa96b7fc52a027decfda31402417b08293`.
* **Source:** the "Sample 832" printed on page 22 of *EDI Guideline X12/V4010/832 — 832
  Price/Sales Catalog, Version 2.6*, published by SPS Commerce for MSSS, dated 2022-06-02.
  `https://community.spscommerce.com/wp-content/uploads/2022/12/MSSS-832-June-2-2022-Version-2_6.pdf`
* **Fetched 2026-09-05**, HTTP 200, 437,803 bytes, sha256
  `06bee0d58039911e98467a7e08453eb1259a067872ec166fec7bb79f2cdf9692`; the transaction was extracted
  with `pdftotext -layout` and transcribed **character for character**, one segment per line, with
  no value altered and no segment added or removed.
* **What it proves:** the refusals. Every one of its three `LIN` loops carries a `CTP` price and
  **no `PO4` at all**, and the document carries **no `CUR`**. So a correct parser admits none of
  them: three `no_size` refusals — because ADR 0117 forbids assuming 750 ml — and, before that, a
  whole-document refusal for stating no currency. A real published catalogue that a naive parser
  would have turned into three unpriced-per-unit rows is exactly the fixture worth keeping.
* Its `CTP02` codes are `CON` (Contract Price) and `CAT` (Catalog Price) — MSSS's own two, from a
  code list the guide says has **164 codes of which it uses 2**. That is the fact
  `unmapped_price_basis` exists for.

## 2. `edi832-constructed-from-spec.edi` — constructed, and labelled so

* **1,271 bytes**, sha256 `51c5782cda1ef47bcc0cfd89441b7b75f88ff4780a1bd5016d4550a70ae1bc4d`.
* **Not fetched from anywhere.** It was written by hand from the element definitions in the two
  implementation guides below, to exercise the paths the published sample cannot reach — an
  admitted row, a litre size, a duplicate item code, an unmapped price code, a missing date, a
  non-volume unit and a zero price. The distributor name inside it is literally
  `A DISTRIBUTOR THAT DOES NOT EXIST`, and every product description is a sentence rather than a
  brand, so no line of it can ever be mistaken for a real quotation.
* **No price in it may ever be shown to a house.** It exists to test a parser and nothing else.

### The element positions it was built against, both fetched 2026-09-05

| Guide | URL | Bytes | sha256 |
|---|---|---|---|
| CDW, *832 Price/Sales Catalog, X12/V4010/832*, 2016-05-18 | `https://webobjects.cdw.com/webobjects/media/pdf/e-procurement/downloads/832_I_4010.pdf` | 55,216 | `6d44bb1488754e543b53030e6ae42433b09318a2b88255f2848d1806c145680c` |
| SPS Commerce for MSSS, *EDI Guideline X12/V4010/832*, v2.6, 2022-06-02 | `https://community.spscommerce.com/wp-content/uploads/2022/12/MSSS-832-June-2-2022-Version-2_6.pdf` | 437,803 | `06bee0d58039911e98467a7e08453eb1259a067872ec166fec7bb79f2cdf9692` |

Read from those two, verbatim, and nowhere else:

* `BCT01` Catalog Purpose Code · `BCT02` Catalog Number · `BCT03` Catalog Version Number ·
  `BCT10` Transaction Set Purpose Code.
* `CUR01` Entity Identifier Code · `CUR02` Currency Code (ID 3/3).
* `LIN01` Assigned Identification, then `LIN02/03`, `LIN04/05`, `LIN06/07` as
  qualifier-and-id pairs (`VP` vendor's part number, `MG` manufacturer's part number, `UP` U.P.C.).
* `DTM01` Date/Time Qualifier — `007` Effective, `128` Replacement Effective, `001` Cancel After —
  and `DTM02` Date, `CCYYMMDD`.
* `PID01` Item Description Type, `PID05` Description.
* `PO401` Pack ("the number of inner containers, or number of eaches if there are no inner
  containers, per outer container"), `PO402` Size ("size of supplier units in pack"), `PO403`
  Unit or Basis for Measurement Code.
* `CTP02` Price Identifier Code, `CTP03` Unit Price, `CTP04` Quantity, `CTP05-01` composite unit of
  measure.
* `CTT` transaction totals, `SE` trailer.

**What neither guide publishes, and what is therefore refused rather than guessed:** the meaning of
a `CTP02` code. CDW's list is CDW's own (`C01` is literally "CDW Price"); MSSS's is MSSS's own. The
X12 355 unit-of-measure list has, on SPS's own count, **794 codes**. A parser that picked "the
first CTP" or "the lowest price" would be inventing a trade level, which is the one thing ADR 0117
names as never allowed. So `parse-edi832.ts` takes the price-basis mapping as an argument, refuses
every `CTP02` outside it, and maps only three unambiguous metric volume codes (`ML`, `CL`, `LT`).
