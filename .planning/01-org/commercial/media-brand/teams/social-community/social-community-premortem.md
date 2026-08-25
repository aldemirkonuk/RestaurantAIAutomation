---
type: premortem
division: commercial
department: media-brand
team: social-community
status: provisional
metrics: []
updated: 2026-08-24
links:
  - "[[social-community-charter]]"
  - "[[media-brand-premortem]]"
  - "[[editorial-gate-charter]]"
---

# Social & Community (M3) — Premortem

> Written at founding, before success is assumed. This team is dormant, and a dormant team
> can still fail — two of the four mechanisms below happen *while nothing is being posted*.

## It is 12 months from now and this unit has failed. What happened?

---

### 1. Posting started before the article pipeline did

The trigger was ignored because an empty feed felt embarrassing and posting felt like
progress. With no articles to distribute, the account became a low-signal stream of product
screenshots and build updates. It is now the first result a prospect finds when they search
the company name — which is the one search we are guaranteed to be ranked for — and it shows
a company talking to itself.

**Earliest observable signal.** A post exists at all before an article has cleared G3. There
is no ambiguity in this signal, which is the point of having an explicit trigger.

**What would have prevented it.** The trigger is written into
[[social-community-charter]] as the first section rather than a footnote, and the weekly
watch returns a plain yes or no. The counter-pressure is that "we should post something"
has to argue against a written entry condition rather than against a vague preference.

---

### 2. The trigger fired and nobody noticed

An article cleared G3 in month seven. Nothing happened, because the trigger was a sentence
in a charter and not a job anyone ran. By the time somebody remembered, the article was
three months old and the moment to distribute it had gone. The team was dormant not by
decision but by neglect, and the two look identical from outside.

**Earliest observable signal.** The weekly trigger watch is not on anyone's schedule, or has
not run. That is checkable today: it is one row in
[[social-community-schedule]] and [[media-brand-schedule]].

**What would have prevented it.** The watch is a scheduled job with a named owner and a
close-time, and it is explicitly exempt from the three-runs-no-action deletion rule while
the team is dormant — its whole job is to return "no" until the one time it returns "yes".
Deleting it for producing no action would delete the only thing keeping the team alive.

---

### 3. The handle was gone when we needed it

Twelve months of correct, disciplined dormancy, and when the trigger fired the name was
taken — by a squatter, or by an unrelated business, or by the abandoned account of a company
with a similar name. The cost of dormancy was paid at exactly the moment the team was
supposed to start.

**Earliest observable signal.** Availability is checkable right now, for free, and nobody
has checked. Also: the company has just renamed itself, which is precisely the window in
which a new name is unclaimed and unprotected.

**What would have prevented it.** Separating *reserving* from *launching*. A reserved handle
with no posts is not a dormant feed; it is a registration. This is a founder decision and it
is raised as one in [[social-community-agenda-full]] rather than assumed here — but the
question needed asking in month one, not month twelve.

---

### 4. The feed became an unstaffed support channel

Once live, restaurant operators replied with product problems, because that is what people
do with a company account. Nobody owned answering, replies went unanswered for days in
public, and the account's most visible content became a queue of ignored complaints. The
distribution surface had quietly become a support surface with no staffing and no SLA.

**Earliest observable signal.** The second unanswered product question. Not the first — the
first is normal; the second is a pattern with nobody assigned to it.

**What would have prevented it.** A routing rule published before the first post: product
problems go to the in-product support address, and the feed acknowledges and redirects
rather than diagnosing. That rule has a prerequisite this team does not own — the support
address is currently `support@wineops.ai` (`apps/web/src/pages/Help.tsx:18`), which is
[[brand-identity-charter|M1]]'s defect. Publishing a routing rule that points at the previous
company name would be a worse first impression than the unanswered reply.
