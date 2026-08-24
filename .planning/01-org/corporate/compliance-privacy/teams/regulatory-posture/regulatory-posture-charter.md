---
type: charter
division: corporate
department: compliance-privacy
team: regulatory-posture
status: new
metrics: [compliance.obligation_coverage, compliance.subprocessor_classification, compliance.notice_accuracy, compliance.unevidenced_clause_count, compliance.questionnaire_answerable_rate]
updated: 2026-08-24
links: ["[[regulatory-posture-premortem]]", "[[regulatory-posture-directive]]", "[[regulatory-posture-loops]]", "[[regulatory-posture-schedule]]", "[[regulatory-posture-agenda-full]]", "[[regulatory-posture-agenda-board]]", "[[compliance-privacy-charter]]", "[[privacy-engineering-charter]]", "[[regulated-operations-charter]]", "[[legal-charter]]", "[[commercial-workforce-agreements-charter]]", "[[instruments-equity-charter]]", "[[security-charter]]", "[[standards-verification-charter]]", "[[design-partner-operations-charter]]", "[[corporate]]"]
---

# Regulatory Posture — Charter

> **`status: new`, and the zero is verified rather than assumed.** A repo-wide grep
> for `gdpr|ccpa|data subject|right to erasure` across `apps/`, `services/`,
> `supabase/` and `scripts/` returns **zero hits**. There is no policy, no DPA, no
> BAA, no processing record, and no subprocessor register anywhere in this
> repository. Obligation coverage genuinely starts at 0%.

## Mandate

Regulatory Posture owns **the mapping from a named legal duty to a named control** —
GDPR/CCPA and state-privacy obligation mapping, the *content* of the DPA and BAA
(Legal owns them as instruments), the subprocessor register, and keeping the privacy
notice tied to what the code actually does.

Its deliverable is an **obligation register**: each duty → a control with a
`file:line`, or an honest gap with an owner and a date. That register is what makes
[[privacy-engineering-charter]]'s guards auditable, and it is written, not coded.

## Why distinct from [[privacy-engineering-charter]]

A control with no obligation behind it is guesswork; an obligation with no control is
a lie. Both statements are true, and the two artifacts are produced by different
work: one team writes SQL, Python and bash; this team writes registers and mappings.

The department's founding evidence is that **the asymmetry has already happened**:
four PII guards and a genuinely well-argued consent schema exist, and zero words of
privacy law exist. One combined team would have kept doing whichever half it was
better at — which is precisely the gap that produced this split.

There is a second, sharper reason. This team's core act is **saying no to a
signature**, and that is a fundamentally different disposition from building a
control. A team that both builds the control and certifies it has no independent
check on its own optimism.

## Boundaries

Owned outright:

- **The obligation register** — every named duty (lawful basis, purpose limitation,
  data minimisation, subject access, erasure, portability, breach notification,
  records of processing, subprocessor disclosure, international transfer) mapped to a
  control with a citation or a gap with an owner.
- **DPA and BAA *content*** — what the Annex of technical and organisational
  measures may claim. [[commercial-workforce-agreements-charter]] drafts the
  instrument; we say what it is allowed to say (CORP-F2, [[corporate]] §7).
- **The subprocessor register** — which third parties receive personal data, under
  what instrument, in what jurisdiction.
- **Privacy-notice accuracy** — the claims in `apps/web/src/pages/Privacy.tsx` are
  statements about code behaviour, and keeping them true is a compliance function.
- **Security-questionnaire and DDQ responses** — the answer of record, drawn from
  the register rather than composed per request.
- **Line-by-line sign-off on any data-protection exhibit before signature**, with the
  right to say *"we cannot evidence clause 4.3; strike it or accept the gap in
  writing."*
- **Records of processing** — purposes, categories, recipients, retention.
- **Regulatory horizon-scanning** for privacy law only. Alcohol and excise belong to
  [[regulated-operations-charter]] and are gated.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Building the control** — migrations, guards, tests, the erasure path | [[privacy-engineering-charter]] | We say which duty a control discharges and refuse to claim one that does not exist. We do not write it. |
| **Drafting the instrument** — the DPA, BAA, MSA as executable documents | [[commercial-workforce-agreements-charter]] (Legal) | Legal drafts; we supply and constrain the Annex. **CORP-F2 open**: confirm the split or collapse it. |
| **Equity and corporate instruments** | [[instruments-equity-charter]] | Different counterparty, different reversibility. |
| **Access control, authn, authz, RLS, secrets** | [[security-charter]] | Security's controls appear *in* our register as cited evidence; we do not own or grade them. |
| **Alcohol licensing, excise, operational deadlines** | [[regulated-operations-charter]] ⏸ gated | GDPR and excise tax share a word and nothing else. Folding them together would make this mandate incoherent — that is why the third team exists. |
| **Doc staleness detection as a system** | [[standards-verification-charter]] (Knowledge & Doc) | They own the general staleness machinery; we own the specific claim that `Privacy.tsx` is true. We should consume their tooling, not build a parallel one. |
| **Deciding whether to accept a commercial risk** | Founder | We make the gap explicit before signature. Whether to sign anyway is a business call, and one this team must not silently make by staying quiet. |

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `compliance.obligation_coverage` | **Primary.** % of named obligations mapped to a control with a citation | **0%** |
| `compliance.subprocessor_classification` | % of runtime hosts classified as receiving personal data or not | **0 / 50** |
| `compliance.notice_accuracy` | Claims in `Privacy.tsx` verified against current code | unverified; brand stale in ≥3 places |
| `compliance.unevidenced_clause_count` | Clauses in signed instruments with no evidenced control. **Target 0, and it is the only metric here whose target is a hard zero.** | 0 signed instruments — a true zero over an empty set |
| `compliance.questionnaire_answerable_rate` | % of a standard security questionnaire answerable from the register without new work | **0%** |

**One caution on the primary metric.** `obligation_coverage` is trivially gameable:
map every duty to a control that "handles it" and the number reaches 100% while
meaning nothing. It is only honest under a rule this team must hold against its own
incentive: **a mapping counts only if the control is evidenced by a `file:line`, a
passing test, or a named owner with a date.** A duty mapped to "handled by our
architecture" counts as **0**, and a duty mapped to an honest gap counts as 0 too —
but the second one is useful and the first is a lie.

## Evidence today

**NEW**, with two unusual head starts and one already-broken claim.

### The zero, verified rather than transcribed

`grep -riE "gdpr|ccpa|data subject|right to erasure"` across `apps/`, `services/`,
`supabase/`, `scripts/` returns **zero hits**. The only repo-wide match outside
planning prose is `datasets/planning-exports/stage1_producer_research_raw.json`, where **"CCPAE"** is
the *Consell Català de la Producció Agrària Ecològica* — the Catalan
organic-agriculture council. A substring collision, not a statute. Worth recording
because it is exactly the kind of false positive that would otherwise let a future
grep report "one hit" and be believed.

### Head start 1 — the privacy notice is already written to the correct standard

`apps/web/src/pages/Privacy.tsx:5-12` carries its own header comment:

> *"Written to match what the code actually does rather than boilerplate: the app
> sets no cookies, keeps session tokens in localStorage, ships interaction telemetry
> disabled, and defaults partner sharing to off. If any of those change, this page
> has to change with them."*

**That sentence is this team's charter, pre-written by someone else**, and it states
the standard more precisely than a policy document would. The page is routed at
`apps/web/src/App.tsx:158` (lazy-loaded at `:107`) and is reachable pre-login, which
is the correct posture for a notice.

**And the claim is already stale.** The page says "WineOps" at `:23`, `:31` and
`:43` — the pre-Mudavym brand. The notice-accuracy loop has therefore already failed
once before being built, which is the most useful possible baseline: it proves the
loop is necessary rather than theoretical.

### Head start 2 — a subprocessor register exists, generated for another purpose

[`EXTERNAL_CONNECTIONS.md`](../../../../foundation/EXTERNAL_CONNECTIONS.md)
enumerates **50 distinct runtime hosts, 8 SDKs and 80 environment variables**, with
per-service reference counts. It was produced as an architecture artifact. Classifying
which of those hosts receive personal data converts it into a required compliance
artifact at a fraction of the cost of writing one.

Some of the classification work is pre-flagged in the document itself: `wineops.ai`
(10 refs) is marked *"Legacy brand domain — pre-Mudavym"*, `ngrok` (3) is marked
*"Dev tunnel — should not appear in prod paths"*, and 16 refs are
placeholder/fixture values. Those three groups are register entries with a question
attached, not unknowns.

**Non-obvious entries this team must not miss:** Anthropic and Gemini appear as
*hosts* but not as SDK imports — they are called over raw HTTP/axios, which the
document flags as a retry/timeout/cost concern and which is *also* a subprocessor
concern, because an LLM host receiving a message body receives whatever PII the body
holds. `constraint_engine.py:113-117` and
`provider_communication_agent.py:725-733` are the controls that bear on it, and they
are the first two `file:line` citations this register will contain.

### What can be cited on day one

Three real controls exist and are citable immediately — a register that starts at
three honest entries is worth more than one that starts at thirty asserted ones:

| Duty | Control | Citation | Evidenced? |
|---|---|---|---|
| Lawful basis recorded per subject | Versioned consent record | `20260819000000_guest_identity_minimal_slice.sql:58-64` | ✅ schema; ⚠️ **never exercised — 0 call sites** |
| Data minimisation on identifiers | Plaintext never stored; HMAC only | `:131-145`, `guest_link_identifier():375` | ✅ schema + CI guard |
| Purpose limitation | `consent_purpose` recorded per consent | `:58` | ✅ schema; unexercised |
| Erasure | Tombstone design | `:79-82` | ⚠️ **design only — no function, no receipt table, no test** |
| Confidentiality of special-category content | PII guards | `constraint_engine.py:113`, `provider_communication_agent.py:725`, `research_tasks.py:744-751`, `20260805000000_baseline_from_production.sql:1080` | ⚠️ **3 conflicting definitions** |
| Records of processing | — | — | ❌ gap |
| Subprocessor disclosure | — | `EXTERNAL_CONNECTIONS.md` is raw material | ❌ gap |
| Subject access | — | — | ❌ gap |
| Breach notification | — | — | ❌ gap |
| International transfer | — | — | ❌ gap |

**Five duties with partial evidence, five with none.** That table is the register's
v0 and it took one session to produce, which is itself the argument for why 0% is not
an excuse.
