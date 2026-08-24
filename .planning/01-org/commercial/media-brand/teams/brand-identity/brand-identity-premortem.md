---
type: premortem
division: commercial
department: media-brand
team: brand-identity
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[brand-identity-charter]]"
  - "[[media-brand-premortem]]"
  - "[[brand-identity-loops]]"
  - "[[editorial-gate-charter]]"
---

# Brand Identity (M1) — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this unit has failed. What happened?

Five mechanisms, most likely first.

---

### 1. The visible references got renamed and the invisible ones did not

The sign-in page, the sidebar, and the browser tab said Mudavym within a week, because those
are the surfaces anyone looks at while doing the work. The `From:` header did not. The
crawler User-Agent did not. The OpenAPI production server did not. The iCal `PRODID` did not,
because nobody has ever opened a calendar feed to check its `PRODID`.

Twelve months on, the first vendor to receive a procurement email, the first site owner to
read their access log after we crawled them, and the first API partner to open the docs each
met a company with two names — and each of those is a person we were trying to look credible
to.

**Earliest observable signal.** The reported reference count drops sharply in week one and
then plateaus above zero. More specifically: any tier-1 row in
[[brand-identity-charter]] that is still open after the web surfaces close. The web surfaces
are the easy half and they will close first; the plateau is the whole finding.

**What would have prevented it.** The burndown is reported per **tier and per surface class**
(rendered UI, transmitted mail, transmitted document header, third-party log, published API
metadata), never as one number. A class with zero progress is visible in a per-class report
and invisible in a total.

---

### 2. The scan was host-based again, so the count was wrong for the third time

Two scans have now reported this problem and both undercounted it. The host scan found 10
([EXTERNAL_CONNECTIONS.md:15](../../../../../foundation/EXTERNAL_CONNECTIONS.md)). The
domain scan found 33. Neither could see `apps/web/index.html:7`,
`apps/web/public/manifest.json:2`, or `apps/mobile/app.json:3`, because those carry the
*name* and no domain — and the name surface is **351 lines across 193 files**, roughly ten
times the domain surface.

The failure is not carelessness. It is that a domain is a tractable regex and a product name
is not, so every scan reaches for the domain. `scripts/render_system_atlas.py:109` already
encodes exactly one pattern, `wineops\.ai`, and it is the reason the repo's own tooling
reports the smaller number.

**Earliest observable signal.** Any report of this metric that is a single number. Or a
status update that quotes 10 or 33 as "the" count.

**What would have prevented it.** The metric is defined as two numbers in
[[brand-identity-charter]] and the scan skill emits both or fails. A single-number report is
treated as a failed run, not a good result.

---

### 3. The rename landed, the CI guard did not, and it came back through generated output

The strings were fixed, the audit went green, and nobody wired the check because the check
is the boring half. Three months later a regenerated `apps/api-gateway/openapi.json` shipped
`WineOps Team` and `https://api.wineops.ai` again — because that file is rebuilt from
`apps/api-gateway/src/main.ts:127,130`, and a source fix that missed one call site
regenerates cleanly into a stale artifact. Or a new email template was written by copying an
old one.

**Earliest observable signal.** A green audit followed by any regenerated artifact —
`openapi.json`, `dist/`, a new template file — containing the legacy name. Or, earlier and
more reliably: the rename PR merges without touching `.github/workflows/ci.yml`.

**What would have prevented it.** The guard ships in the same pull request as the cleanup,
not after it, and it runs over generated output as well as source. This is the shape
Security's first assignment already uses
([README §2.3](../../../../../foundation/README.md)): classify, fix, then add a check so the
*class* of defect cannot recur.

---

### 4. The rename broke install identity because a display string and an identifier were edited together

Someone opened `apps/mobile/app.json`, saw `"name": "WineOps"` on line 3 and
`"slug": "wineops-ai"` on line 4, and changed both in one commit. A display name is a string.
An Expo slug is part of the app's identity: it participates in the project identifier and the
push credential chain. Changing it is not a rename, it is a new app — installed copies do not
follow, push tokens registered against the old identity stop resolving, and the design
partner's phone silently stops receiving low-stock alerts.

The same hazard sits in `@wineops/*` workspace scopes (every import), `docker-compose.yml`
service and network names (every local dev environment), and `.railway/railway.ts` /
`vercel.json` (every deploy target).

**Earliest observable signal.** A diff in which a `name` field and a `slug`, scope, service
name, or host identifier change in the same commit. This is a code-review catch, and it is
catchable in seconds if anyone is looking for it.

**What would have prevented it.** The tier-3 boundary in [[brand-identity-charter]] is not
advisory. Identifiers route to Engineering as fork **CM-F5** and travel in their own change,
with their own rollback plan. M1's scan reports them as a separate, explicitly non-actionable
count so that seeing them does not become permission to fix them.

---

### 5. The voice guide never got written, because the rename was more legible work

The rename has a number, a burndown, and a satisfying green check. The voice guide has none
of those. So it slipped, quarter after quarter, and G3 — the one mandatory human step in
Growth's pipeline — spent a year enforcing an opinion. Its rejections read "feels off-brand",
writers could not act on them, and the gate lost its authority precisely because it had
nothing external to point at.

**Earliest observable signal.** G3's first review cites a subjective judgement with no clause
behind it. Or, earlier: the department agenda's rename items all have dates and the voice
guide item does not.

**What would have prevented it.** The voice guide is a dated deliverable with its own
close-time in [[brand-identity-loops]], the rename is explicitly time-boxed, and the guide's
scope is written down on day one — the banned-construction list governs **published outward
content**, not internal planning documents. Without that scope note the guide bans em dashes
in a corpus built out of them, is visibly ignored, and loses credibility before its first
real use.
