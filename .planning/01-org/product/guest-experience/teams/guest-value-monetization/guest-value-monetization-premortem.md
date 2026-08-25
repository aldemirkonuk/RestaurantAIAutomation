---
type: premortem
division: product
department: guest-experience
team: guest-value-monetization
status: provisional
metrics: [nf_b.k_anonymity_pass_rate, nf_b.ops_conversion, nf_b.photo_consent_rate, nf_b.sub_k_render_attempts]
updated: 2026-08-24
links: ["[[guest-value-monetization-charter]]", "[[guest-value-monetization-directive]]", "[[guest-value-monetization-loops]]", "[[guest-experience-premortem]]", "[[guest-identity-consent-charter]]", "[[compliance-privacy-charter]]", "[[legal-charter]]", "[[analytics-bi-charter]]", "[[FUTURES]]", "[[OPEN-DECISIONS]]"]
---

# Guest Value & Monetization — Premortem

> Written at founding, before success is assumed. This team is **unstaffed**; the
> premortem is written first anyway, and for this team more than any other, because
> two of its counter-pressures **only work if they exist before the team does**.

The team-doc line this expands ([[product]] §2.4): *"The k-anonymity threshold gets
lowered 'just for the pilot restaurant' so a segment card has something to show, a
manager recognises a regular from a three-person segment, and the consent record we so
carefully versioned proves we said we wouldn't."*

It is 2027-08-24. Five mechanisms, most likely first.

---

## V1 — The k-threshold was lowered for the pilot, and the consent record became the evidence against us

**The predicted failure, and it is nearly inevitable at current scale.** The pilot
restaurant has eleven consented guests. Every segment card is empty. The product looks
broken to the one customer who agreed to try it, and the fix is one number: k=20 →
k=5, *temporarily*. A manager sees a three-person segment, recognises a regular by
their preferences, and now knows something about that person they were never given.

**The cruelty is in the second half.** We built a *versioned* consent record precisely
so we could prove what each guest was told (`20260819000000_guest_identity_minimal_slice.sql:54-64`)
— and that artifact, built to protect the guest, becomes the document that proves we
said we would not do the thing we did. Careful work turned into evidence.

**Earliest observable signal.** Not the lowering. **The threshold becoming
configurable** — an env var, a settings row, a per-restaurant override, a constant
moved into a config file "for testability". Configurability is the mechanism; the
lowering is only its first use, and the config change will look like good hygiene.
Second signal: `nf_b.sub_k_render_attempts` rising — the pressure is *measurable
before anyone proposes anything*, which is the entire reason that metric exists.

**What would have prevented it.** Four things, and the first two must exist **before
this team does**:
1. The k-threshold is a **constant in code with a CI guard**, in the shape of the four
   guest PII guards that already work in this repo. Not configuration. Not a flag.
2. **The sub-k empty state is designed early**, so *"not enough data yet"* is a normal,
   shippable, unembarrassing state. Most of the pressure to lower a threshold is the
   pressure not to look broken, and a well-designed empty state removes it at the
   source.
3. Threshold changes are reviewed by [[compliance-privacy-charter]], **never
   internally** — [[ORG_STRUCTURE]] §3's rule applied to the team it describes.
4. Lowering below the founding value is **founder-only**
   ([[guest-value-monetization-directive]]).

---

## V2 — A guest's photo appeared in an ad and they had not agreed to that

The enrichment pipeline **exists** ([[FUTURES]] §4 — photos first-class, the
`master_wine_library` pattern). The consent-to-reuse plumbing does **not**. That is the
dangerous way round: a working capability with a missing gate.

So a guest uploads a dish photo for points (`NEW-865`). It flows into catalog
enrichment because the pipeline is right there. Later, catalog imagery is used in a
restaurant's promotion, and later still in a paid placement. At no point did anyone
decide to use a guest's photo in an ad — each hop was a reasonable reuse of the hop
before it, and the consent prompt that existed (if it existed) said *"catalog
enrichment"*, which is not what happened.

**Earliest observable signal.** A guest photo reaching the enrichment pipeline
**before** `nf_b.photo_consent_rate` is instrumented. If the metric does not exist, the
answer to "did they agree?" is not *no* — it is *unknown*, which is worse in every
conversation that follows. Second signal: consent scoped as a boolean rather than as
an enumerated purpose. A boolean cannot distinguish catalog enrichment from
promotional reuse from paid placement — the identical argument the migration makes at
`:55-56` for why guest consent is a versioned record and not a flag.

**What would have prevented it.** **Purpose-scoped, revocable photo consent** modelled
directly on the existing `consent_purpose` / `consent_notice_version` pattern, built
**before** the first guest photo enters the pipeline. Plus a hard rule: a photo
without a live consent record for *the specific purpose in question* is not usable for
it — enforced at the pipeline, not at the surface. And revocation that **propagates**:
[[legal-charter]] and [[compliance-privacy-charter]] own whether a revoked photo must
be pulled from already-printed material, and that question is answered before the
first reuse, not after.

---

## V3 — Ops conversion stayed at zero and nobody called it

`nf_b.ops_conversion` is the number that judges the whole sub-layer, and it is the
easiest to leave uncounted, because counting it requires a **traceability chain** —
segment → insight → surfaced recommendation → restaurant decision — that nobody owns
end to end. Four quarters pass. Each has visible progress: more segments, better
digests, prettier cards. Conversion is never computed, so it is never zero; it is
*unmeasured*, which reads as neutral. Meanwhile the guest side has quietly become the
standalone social network [[FUTURES]] §10 forbids.

**Earliest observable signal.** The metric absent from the quarterly review, or
present as a qualitative statement — *"restaurants are finding the digest useful"* —
rather than a count. The substitution of a testimonial for a number is the tell.

**What would have prevented it.** The **traceability chain designed into the first
insight surface**, not retrofitted: every restaurant-facing recommendation carries the
segment id that produced it, and every acted-upon recommendation writes back. That is
cheap at the first surface and near-impossible at the tenth. Plus the consequence
[[guest-experience-premortem]] M1 names: two consecutive quarters at zero returns the
sub-layer's charter to [[product-vision-charter]] for a scope decision — a consequence
that only works if the number exists.

---

## V4 — Advertising was built on the procurement schema

`provider_promotions` is *right there*. There is a `/promotions` route
(`PAGE_MAP.md:120`), a service that reads the table in five places
(`apps/api-gateway/src/providers/provider-intelligence.service.ts:135-222`), and the
table is dormant, so it looks free. It is **supply-side deals from distributors** and
shares nothing with guest-facing advertising but the word. Building on it produces an
ad system whose data model thinks a placement is a vendor discount — a mistake that is
invisible for six months and structural forever.

**Earliest observable signal.** Any guest-facing advertising design referencing
`provider_promotions`, `/promotions`, or `provider-intelligence.service.ts`. One grep,
and it is worth running deliberately at design time.

**What would have prevented it.** Naming the trap explicitly in the charter — done —
and a design review whose first question is *what is the subject of this row?* A
provider promotion's subject is a **vendor**; an ad placement's subject is a **guest
context**. Different subject, different table, and no amount of column overlap changes
that.

---

## V5 — The advertising promise already in the product surfaced at the worst moment

`apps/web/src/components/settings/ServicesPermissions.tsx:41` lists *"Any advertising
or cross-site tracking"* under exclusions; `:249` says *"WineOps sets no tracking or
advertising cookies."* That binds the operator app, not a guest app, and the
distinction is real and defensible **if it was drawn deliberately**. If it was not, the
first time anyone puts the two strings side by side — a journalist, a competitor, an
operator in a renewal conversation, a regulator — the answer is improvised, and an
improvised answer to *"you said you don't do advertising"* is indistinguishable from a
retraction.

**Earliest observable signal.** Any advertising design work starting while no written
boundary statement exists. That is the whole signal, and it is binary.

**What would have prevented it.** The **boundary statement written before any ad
code**: which surfaces may carry advertising, which may never, what the operator-app
promise covers, and whether the copy is a product statement or a company position. It
is a paragraph. It costs an hour now and a reputation later, and — usefully — it is
one of the two acts available to this team **before** its entry trigger fires.

---

## The one that would end it

**V1.** V2 is a serious legal and trust failure with a clear technical fix. V3 wastes a
year and is caught by one metric. V4 is expensive rework. V5 is a bad week.

V1 discloses a *specific, recognisable person* to a manager who then cannot un-know
it, and it does so through a change that will look, at the moment it is proposed, like
the most reasonable request in the room: *the pilot customer's dashboard is empty*.
That is why its two real counter-pressures — the threshold as a code constant, and a
well-designed empty state — must exist **before this team is staffed**. Afterwards
they are a debate; beforehand they are just how the system was built.
