> Annex to [ADR 0103](0103-a-delivery-is-agreed-before-it-is-verified.md) and [ADR 0104](0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md) — a Sonnet scale pass run 2026-09-03 before any build, at the founder's request that the irsaliye process be bulletproofed. Findings are folded into the ADRs' amendment sections; this file is the evidence, not the decision. Paths inside refer to the session scratchpad and are historical.

# Scale, cost, robustness stress test — ADR 0103 + ADR 0104

Read-only. Nothing built or changed. All arithmetic below is mine unless cited `[research]` or
`[main]`. Every number is a Fermi estimate — bands, not forecasts — and every assumption is named.

## 0. Grounding — what's actually on `main` today

`procurement_documents` (`supabase/migrations/20260805000000_baseline_from_production.sql:4426-4466`)
is flat scalars: one `extracted jsonb` blob, one `extraction_confidence numeric`, no per-field
provenance, no revisions. Attachments persist through `rabbitmq-bridge.service.ts:846-919`
(`persistAttachments`, best-effort, upsert-on-sha256-prefixed-path, no size cap on write) and
`:2329-2334` (`loadPersistedAttachmentsForVision`, capped at **3 files / 5 MB** on *read-back*).
Signed URLs mint at **3600 s TTL** (`procurement.service.ts:3017-3018`) — 12–60× longer than the
60–300 s the template research recommends (`research-invoice-template §3.5`). There is no
`retain_until`, `legal_hold`, or `jurisdiction` column anywhere (confirmed in
`research-retention-byos §6`, in-repo section). Every number below is the delta from this flat,
uninstrumented baseline to what D1–D14 propose.

## 1. Tenant profiles — the arithmetic

| | Meyhane (TR) | CA 3-location | 30-location chain | Platform·500 | Platform·5000 |
|---|---|---|---|---|---|
| Docs/month | 40×3=**120** | **250** | 2,500 (10× CA, same intensity/loc — *guess*) | 128,750 (blend, see below) | 1,287,500 |
| Docs/year | 1,440 | 3,000 | 30,000 | 1,545,000 | 15,450,000 |
| Retention floor | **10 y** (TTK 82, corrected — `research-retention §1.1`) | **7 y** (IRS bad-debt ⊃ TTB/CDTFA/ABC — `research-retention §1.2`) | 7 y | blended ~8.5 y | ~8.5 y |

**Platform blend (guess, stated explicitly):** 70% single-location independents (~1,200 docs/yr,
TR- or US-leaning), 25% small multi-location groups (~3,000 docs/yr), 5% chains (~30,000 docs/yr)
→ weighted **3,090 docs/tenant/yr**. This mix is invented for this exercise — it is not in either
ADR or either research doc. Platform·500 = 500 × 3,090; Platform·5000 = 10× that.

### 1a. Per-field envelope rows/year (ADR 0104 D1)

Field count per document is **not given** in either research doc — I built it from the EN 16931
skeleton (`research-invoice-template §2.2`): ~30 header BTs + per line BG-25/26/27/28/29/30/31/32
≈ 20–35 fields depending on how many allowance/charge/attribute groups are populated. **Central
estimate: 300 fields/document** (30 header + 12 lines × 22.5), sensitivity band 200–450. This is
layer-1 (`EXTRACTED`) only — `RESOLVED` and `ADJUDICATED` (D1) add more if they're stored the same
way, which the ADR doesn't rule out.

If the per-field envelope is materialized as **one row per field per revision** (a `document_field_
revisions` table, as `research-invoice-template §5.2` proposes for *corrections* and D1/D5 imply
for the initial extraction too):

| | rows/year (initial extraction only, revision=0) |
|---|---|
| Meyhane | 1,440 × 300 = **432,000** |
| CA 3-loc | 3,000 × 300 = **900,000** |
| 30-loc chain | 30,000 × 300 = **9,000,000** — one chain tenant alone |
| Platform·500 | 1,545,000 × 300 = **463,500,000** |
| Platform·5000 | 15,450,000 × 300 = **4,635,000,000** |

Corrections add more (§1i below) but don't change the order of magnitude — the initial-extraction
write is already the dominant cost, because D1 makes *every field* an envelope object regardless of
whether anyone ever corrects it. This is finding #1 in §2.

### 1b. Storage — originals + derivatives, D8 tiers

Sizes are guesses, stated: door photos ~2.5 MB (research's own blended assumption,
`research-invoice-template §3.2`), TR XML documents ~20–100 KB, digital PDF/portal exports
~150–300 KB.

| | avg size/doc (guess) | added/yr | steady state @ retention floor | Glacier IR $/yr | Supabase marginal $/yr |
|---|---|---|---|---|---|
| Meyhane (2 XML + 1 photo per delivery) | ~0.87 MB | 1.26 GB | 12.6 GB @10y | **$0.61** | $3.22 |
| CA 3-loc (digital) | ~0.2 MB | 0.6 GB | 4.2 GB @7y | $0.20 | $1.07 |
| 30-loc chain (digital) | ~0.2 MB | 6 GB | 42 GB @7y | $2.02 | $10.71 |
| Platform·500 | blended 0.336 MB/doc | 519 GB | ~4.4 TB @8.5y | **$211** | $1,125 |
| Platform·5000 | " | 5.19 TB | ~44 TB @8.5y | **$2,112** | $11,246 |

Even at 5,000 tenants, the *whole originals archive* costs less than a mid-tier SaaS seat per
month. This matches `research-retention §2.3`'s independent conclusion (storage ≈6% of extraction
cost at their volumes) — see §3, "scales fine, don't touch."

### 1c. Extraction cost/document and /month (named model assumptions)

**Assumptions, stated:** Azure Document Intelligence `prebuilt-invoice`, $10/1,000 pages
(`research-invoice-template §3.1`), 1.3 pages/doc average (research's figure). Per D14, Turkish
`e-İrsaliye`/`e-Fatura` XML **never** goes through OCR — $0 marginal extraction cost, source =
`embedded_xml`. Door/paper photos route through the same OCR pass as a 1-page document (a
vision-LLM cross-check, if added, is **excluded** from this estimate — add ~$0.01–0.03/image if
built).

| | docs needing extraction/mo | $/mo | $/yr |
|---|---|---|---|
| Meyhane (⅔ of docs are XML, $0) | 40 photos | **$0.40** | $4.80 |
| CA 3-loc (all digital, all extracted) | 250 × 1.3pg | **$3.25** | $39 |
| 30-loc chain | 2,500 × 1.3pg | **$32.50** | $390 |
| Platform·500 (blend pulls extraction-need to ~80% of docs, TR's XML exemption dilutes it) | 103,000 × 1.3pg | **$1,339** | $16,068 |
| Platform·5000 | 1,030,000 × 1.3pg | **$13,390** | $160,680 |

Extraction dominates storage by **2–3 orders of magnitude** at every tenant size, confirming both
research docs' independent conclusion. At 5,000 tenants it is a real budget line ($160K/yr) worth
a volume contract, but it scales *linearly* with document count — not a design flaw, a cost center
to monitor.

### 1d. Server-side render load at the 09:00 receiving peak (D10)

D10: *"the template renders server-side from the same component that renders on screen, so
screen, print… and the hybrid PDF are one code path."* This is a **narrower or wider commitment
than the research recommended**, depending on how it's read — see finding #4.

**Concurrency model (guess):** assume 50% of a tenant's daily document volume clusters into a
2-hour local morning window (matches how the meyhane and the CA group both describe receiving).
Meyhane alone: 1,440/yr ÷ 365 ≈ 4 docs/day → ~2 in the window → negligible. Platform·500:
1,545,000/yr ÷ 365 ≈ 4,233 docs/day. TR and US-Pacific tenants don't share a local morning (natural
peak-smoothing), but *within* a timezone cluster, 50% of the daily volume lands in 2 hours:
**~1,058 renders/hour ≈ 0.29/sec sustained**, bursting at the top of the hour. Platform·5000:
**~2.9/sec sustained**, same shape, ×10.

A warm Playwright/headless-Chromium instance renders in ~3 ms (`research-invoice-template §4.1`),
but that excludes asset loading, auth, and queueing under real concurrency — realistic per-render
latency is 200 ms–1 s, and **each concurrent job is its own Chromium process** (150–300 MB RAM). At
0.3–3 renders/sec sustained with bursts, this needs an autoscaled render-worker pool (5–50
concurrent instances), not a single serverless function — Chromium cold start alone is 1–3 s.

**The number that matters is not the sustained rate — it's whether D10 means every screen-open
routes through this pool, or only the export click does.** The research (§4.1) explicitly says
client-render always, defer server rendering. If D10's "same component" is read as *literally*
routing every view through the render farm, multiply the above by however many times a document
is opened per day (research's own §3.5 egress assumption: 10 opens/doc/yr, i.e. most opens are
NOT at ingest) — this reading turns a rare export action into the dominant load path. See finding
#4 and the load test in §5.

### 1e. Intake-gate false-positive tolerance (D6)

Neither ADR nor either research doc states a threshold — this whole section is a guess grounded in
the workflow, not a citation. At the door, a driver is waiting; tolerance for a **blocking**
"retake?" prompt is low. At 120 docs/month (meyhane), 5% blocking-FP is ~6 nuisance flags/mo
(weekly) — tolerable; 10% is ~12/mo (2–3/week) — my estimate is staff route around the gate
somewhere in this band, because the flag lands where trust is most expensive to lose (truck
idling). Recommendation: **<2% FP on the blocking gate** (blank/near-blank only), route everything
else into the non-blocking `needs_review` path D6 already defines but doesn't threshold. At
platform scale even 2% of 1.5M docs/yr is ~85 false flags/day platform-wide — a support-load
number, not a per-tenant one.

### 1f. Clock/escalation scheduler (ADR 0103 D9)

**Timer count:** not per-delivery `setTimeout`s — D9's language ("ages against its own clock",
"misses a tick") implies a poll model, but the mechanism isn't locked. Each open delivery tracks up
to 4 clocks (D4: response, invoice issuance, objection, payment) with 2 checkpoints each (50%, 80%)
plus expiry → up to ~9 checkpoint events per delivery lifecycle, though only the *nearest* clock
drives the notification per D9's "shortest clock" language.

**Concurrently open (guess, ~1 delivery per 3 documents):** meyhane 40/mo × 7d/30d ≈ **9–10**;
platform·500: 515,000/yr × 7/365 ≈ **9,877**; platform·5000: **~98,770**. All trivial for Postgres —
a `WHERE next_escalation_at <= now()` range scan on an indexed column handles any of these sizes.

**What happens when the scheduler misses a tick during a deploy — the real question.** If
`next_escalation_at` is an absolute Postgres timestamp and the poller is a stateless, idempotent job
(`FOR UPDATE SKIP LOCKED`) running every 15–60 min, a missed tick is a no-op: the next run catches
every overdue row, and the coarsest checkpoint tolerates hours of downtime unnoticed. If instead
it's in-process timers or a non-persistent queue, a deploy silently drops every in-flight escalation
— the `absence-reported-as-health` fault, applied to a legal clock. **Unresolved in both ADRs, a
genuine gap, not a scale problem** — finding #3.

### 1g. Duplicate detection by commercial event (ADR 0104 D7) — the index question

`research-invoice-template §5.4`'s four-key ladder: `blob_hash` (unique index, O(1)); `(vendor_id,
invoice_number)` (composite btree, O(log n)); `(vendor_id, date±3d, total±0.5%)` (range scan, O(log
n + k)); line-set Jaccard similarity (**O(n) per check unless bounded to a small candidate set
first**). D7's `deliveries`/commercial-event entity is what *should* bound that candidate set —
check duplicates only within the 2–6 documents attached to one event, not the vendor's whole
history. **What makes it wrong:** none of the four keys as written include `restaurant_id`/
location. At 30-location-chain scale, a shared regional produce distributor delivering to 3–5
locations the same morning with similar totals will collide on `(vendor_id, date±3d, total±0.5%)`
across *sibling locations that are not duplicates* — invisible at single-location testing, real at
chain scale. See finding #2.

### 1h. Append-only revision log growth

Mechanically the same table as §1a (D1's envelope *is* the revision log — D5 makes corrections new
revisions of the same rows). Growth = initial extraction (§1a) + corrections. **Cold-start
correction rate (guess):** ~30% of fields touched per document for a vendor's first ~5–10 documents,
decaying to <2% once mapping memory (§1i) stabilizes — meyhane: ~14,400 extra correction-rows/yr,
small next to the 432,000 initial rows. The growth curve is **linear per tenant**, which is fine;
the problem is the *constant* (300 rows/document regardless of correction activity) — finding #1.

### 1i. Mapping memory per vendor — cold start, drift, measurement

**Cold start:** a brand-new vendor has zero `(vendor_id, vendor_item_code)` rows — 100% of line
items are `source: extracted` on document 1; for ~20–40 recurring SKUs, coverage (guess) plateaus
above 90% by document 3–4 for a stable local vendor.

**Drift — specific to this product, not generic:** ADR 0103 D6 makes a **vintage change a
substitution, never a tolerance**. For a wine-heavy meyhane buying the same ~15 wines, every
vintage rollover is a *new item identity* by the ADR's own rule — my guess is 20–30% of wine SKUs
roll a vintage annually, so the mapping for wine-heavy vendors never fully cold-starts; it carries
a built-in ~annual half-life on a meaningful fraction of lines. A direct, citable consequence of D6
that the mapping-memory design (0104 §5.3) doesn't mention.

**Measurement (research's own plan, `§6.2` slice 4):** correction rate per vendor, before/after, on
the same documents — `% fields with source='learned_from_vendor'` at document N, target ≤5
documents to 90% mapped for a stable vendor. A cheap groupby over the revisions table; no scale
risk in the measurement itself.

---

## 2. Five design choices that do NOT scale as written

1. **ADR 0104 D1 — the per-field envelope as one-row-per-field-per-revision.** §1a: 9M rows/yr for a single 30-location tenant, 463M–4.6B rows/yr platform-wide, written *regardless of whether anyone ever corrects anything*, because D1 makes every field an envelope object at extraction time, not just correction time — plus an N+1-shaped read (fetching ~300 latest-revision rows to render one document). **Change:** store layer-1 extraction as JSONB on the document row (the envelope shape survives, just not as separate rows); reserve the normalized append-only `document_field_revisions` table for actual *corrections* (D5's real concern), the rare case, not the default. **Measure in slice 1:** D12 slice 1 already runs the invariant suite over the `vendor-attachments` corpus — count rows/document during that run and set a hard budget (<20/doc for revision=0, not 300).

2. **ADR 0104 D7 — the duplicate-detection keys omit location.** §1g: at chain scale, the soft-flag key `(vendor_id, date±3d, total±0.5%)` will collide across sibling locations sharing a vendor — a false-duplicate merge invisible at single-location testing. **Change:** every key tier must include `restaurant_id` as a hard partition; Jaccard must run only against the small candidate set the `deliveries` entity bounds, never a vendor's full history. **Measure in slice 1:** log candidate-set size per duplicate check; alert if any check compares against >50 documents; add a synthetic multi-location same-day-same-vendor fixture (none exists in a single-location corpus).

3. **ADR 0103 D9 — the escalation scheduler's persistence mechanism is unstated.** §1f: the ADR names the requirement ("what happens when the scheduler misses a tick") but doesn't lock whether deadlines are durable Postgres timestamps polled by a stateless job, or in-process/queue timers that silently drop on deploy. Row count is trivial at every scale modeled (≤~100K concurrently open at 5,000 tenants) — a correctness gap, not a volume gap, but it fails exactly the way `absence-reported-as-health` predicts: a lost escalation reads as "nothing was due." **Change:** lock the mechanism now — absolute `next_escalation_at` in Postgres, idempotent poll job with `FOR UPDATE SKIP LOCKED`. **Measure in slice 1:** kill the poller mid-run against seeded due escalations; assert 100% fire on the next tick, none double-fire.

4. **ADR 0104 D10 — "the template renders server-side from the same component that renders on screen" is ambiguous between two very different costs.** §1d: the research this ADR is built on (`research-invoice-template §4.1`) explicitly recommends client-render always, deferring server/headless rendering until export is a real requirement. D10 either means isomorphic reuse of one component for export only (cheap, fine) or literally routing every screen-open through a server render (2–3 orders of magnitude more expensive, 1–3s Chromium cold starts, at the exact receiving-hour peak when speed matters most). **Change:** the ADR should say explicitly which reading is intended before slice 2 locks in a component architecture. **Measure:** the load test in §5, cheapest before building either version.

5. **ADR 0104 D6 — intake-gate thresholds are named but not set, and neither ADR states the false-positive budget the door workflow can absorb.** §1e: my estimate is staff start routing around a blocking retake-prompt somewhere around 5–10% FP at meyhane volumes (weekly-to-twice-weekly nuisance) — no evidence base in either research doc, a pure guess to be treated as one until measured. **Change:** split the gate — <2% FP budget on anything blocking (blank/near-blank only), everything else to the already-defined non-blocking `needs_review` path. **Measure in slice 1:** hand-label a sample of the `vendor-attachments` corpus to compute real FP/FN rates before setting a production threshold — do not ship a guessed number to real drivers.

## 3. Three that scale fine — do not touch

1. **ADR 0104 D8 — tiering by object kind, content-addressed originals, Glacier IR + Object Lock.** §1b: storage cost stays 2–3 orders of magnitude below extraction cost even at 5,000 tenants (~$2,100/yr vs ~$160,700/yr). Both research docs independently reach the same crossover (~100× today's volume before tiering complexity pays for itself). Already right-sized; resist "optimizing" it further.
2. **ADR 0104 D14 — signed XML as primary source for Turkish tenants.** §1c: zeroes OCR/vision cost for ~⅔ of a Turkish tenant's volume, O(1) per document regardless of platform size, deterministic (no confidence bands, no model drift). The cheapest, most robust extraction path in the whole design — a template for any future jurisdiction with an equivalent e-document mandate, which D4's clock-as-data model already generalizes to.
3. **ADR 0104 D7 — the `deliveries`/commercial-event entity as the anchor, independent of its key composition.** Bounding duplicate checks and document attachment to a small per-event set (not the full corpus) is exactly right and is what makes O(1)-ish detection possible at all — only the key fields around it (finding #2) need fixing, not the entity itself.

## 4. The cheapest load test that would falsify the worst assumption

**Worst assumption: D10's server-rendering scope (finding #4).** It's the one place the ADR
explicitly diverges from its own research without flagging the divergence, and misreading it is
the most expensive mistake on this list — it silently converts a proven-cheap pattern into a novel,
expensive one at the exact moment (receiving-hour peak) the product needs to feel instant.

**The test:** no render farm, no infra. Take the D12-slice-1 test corpus (the real documents
already in `vendor-attachments`) — even 50–100 documents is enough — build the roughest possible
prototype of the canonical template, and render it through **one warm Playwright/headless-Chromium
instance**, sequentially, timing p50/p95 latency and per-instance memory, and watching for the
classic Puppeteer memory-leak-over-N-renders failure mode. Multiply p95 latency by the §1d
concurrency estimate (≈0.3/sec at 500 tenants, ≈3/sec at 5,000) to get the number of concurrent
Chromium instances a real receiving-hour peak needs. This is a few hours of scripting, needs no new
service, and answers the only question that matters before slice 2 commits to an architecture:
whether client-render-always (the research's recommendation) is sufficient, or whether D10 truly
requires a render-worker pool from day one.

## 5. Where these numbers are guesses — explicit list

- The 70/25/5% platform tenant mix and the 3,090 docs/tenant/yr blended average (§1) — invented for
  this exercise, not sourced from either ADR or research doc.
- 300 fields/document central estimate (§1a) — built from the EN 16931 field groups, not measured
  against a real document; band 200–450.
- All avg document sizes (§1b) — reuse the research's own "unsourced, mine" 1.6 MB blended figure
  and my own splits for TR-XML (20–100 KB) and digital PDF (150–300 KB); none are measured.
- 50% of daily volume clustering into a 2-hour receiving window (§1d) — a plausibility guess, not
  observed data; the platform never having built receiving-hour telemetry means this can't yet be
  checked against reality.
- The 5–10% FP tolerance-before-routing-around threshold (§1e) — no evidence base in either
  research doc; explicitly flagged as the weakest number in this report.
- Vintage-rollover rate (20–30% of wine SKUs/year) and cold-start plateau (document 3–4, §1i) —
  plausible for a wine-heavy meyhane, unmeasured.
- 10× multiplier from CA-3-location to 30-location chain (§1) assumes uniform per-location
  intensity; real chains likely centralize purchasing (fewer, larger consolidated invoices), which
  would make §1a/§1b/§1c chain numbers overestimates — the safer direction to be wrong in.
