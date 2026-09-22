[ASK-JUDGE] /ask roles, guardrails and a future fine-tune: the judge's verdict

Inputs judged: `ask-sota.md` and `ask-code.md` (this folder). Code re-read on
`/Users/[founder]/Projects/wt-r5-KL` (branch `r5/KL`). I edited no repo files,
ran no git commands, read no `.env`, wrote nothing to production and sent no mail.
The one executed check was a PGlite run of the folio migration's own DDL, in
`q921/pgcheck/run.mjs`.

---

## 0. The answer in plain words (for the founder)

**Keep three things apart, and never let the model hold the first or the third:**

1. **What a person may see.** These are rules, not the model. A table says which
   kinds of data each role sees: money, sales, suppliers, people, stock. The server
   checks it before any book is read. A fine-tuned model can never "learn" a
   permission, and it can never be talked out of one.
2. **What a person meant.** This is the model's only job, and it is the only part
   you will ever improve or fine-tune. Today it is already a choice from a closed
   menu: Haiku picks one of 21 question classes and copies literal words
   (`bound-ask.service.ts:222-259`, validated by `parseReadingPick`, lines 60-84).
   Sonnet then picks up to 8 cell ids and writes no prose (`bound-ask.service.ts:268-312`).
3. **How much a person may use.** Rate and spend per role. Today the whole house
   shares one bucket, so one staff member can use up the owner's allowance (§1.4).

**Then make every question one complete row that a future trainer can use as-is.**
The row holds who asked (their role *in that house, at that moment*), what they
wrote, what the model understood, which prompt and catalogue produced that, which
model answered, what was shown, and what the person did next. "What they did next"
covers re-asking, or choosing a different reading, which is a free correction, and
any explicit feedback tied to the step that went wrong.

**Fine-tuning then comes later and needs no rewrite.** The dataset becomes a view over
those rows. The only thing trained is step 2, and the new model plugs into the same
contract (`utterance + catalogue → class + spans`) behind the same validator, chosen
by the existing routing variable (`ASK_LOOKUP_MODEL`, `bound-ask.service.ts:223`) and
admitted only if it beats the current model on the logged eval set. Permissions and
budgets never lived in the model, so nothing about them changes.

**A fact that changes "fine-tune the models we use":** Amazon Bedrock's fine-tuning
table lists one Anthropic model, **Claude 3 Haiku**
(https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-fine-tuning.html,
fetched 2026-09-21). The models /ask actually routes to are `claude-haiku-4-5` and
`claude-sonnet-5` (`model-client.service.ts:29,36`). Neither is on that list. I found
no primary Anthropic page offering fine-tuning of current models (a secondary source
says the same:
https://callsphere.ai/blog/vw8g-anthropic-claude-fine-tuning-patterns-bedrock-2026).
So the structure must not bet on fine-tuning. The same rows serve the realistic
sequence:
1. an eval set;
2. prompt and catalogue changes tested against it;
3. retrieved examples inside the prompt, from the same house only;
4. only if the base model plateaus, a trained small model for the pick step.

For that last step the choices are Claude 3 Haiku on Bedrock or an open-weight
classifier. Either one needs a client adapter in `model-client`, not a change to /ask.

---

## 1. Kill pass on the leading design

The leading design, as both input docs framed it: per-reading `allowedRoles`, plus
adding a role, a prompt version, the model and feedback columns to the folio, with
feedback written into `nf_verdict`. Here is what breaks.

### 1.1 Measured blocker: a role refusal cannot be saved at all
- `finish()` writes `reply_kind: answer.kind` (`reading-folio.store.ts:84-85`). For a
  refused ask that kind is `not_permitted` (`bound-reply.ts:52,136`).
- The table's CHECK lists nine kinds and **omits `not_permitted`**
  (`supabase/migrations/20260921111000_mudavym_bound_reading_folios.sql:19`). No other
  migration mentions it: I grepped `supabase/` and got zero hits.
- **Measured:** I ran the migration's `create table` verbatim in PGlite, with the FK
  targets stubbed, then updated one folio to each kind:
  - `no_reading_matched` → UPDATE OK;
  - `not_permitted` → `23514 ... violates check constraint "ask_reading_folios_reply_kind_check"`.
- What happens in production once `ASK_LAUNCHED` is on:
  - every staff refusal returns 503 "The answer's saved state is uncertain"
    (`reading-folio.store.ts:94`), not a refusal;
  - the folio stays `pending` forever;
  - a retry with the same request id gets that pending folio back
    (`bound-ask.service.ts:149`).
- The dataset loses **every** refusal. Both input docs said refusals are recorded; in a
  real database they are not.
- Jest missed it because the store specs mock the client.
- Fidelity limit: PGlite ran as superuser with no Supabase platform. A CHECK constraint
  behaves the same either way.

### 1.2 Gating by hand, one reading at a time, has now failed twice in three days
- `orders.late_deliveries` was a bypass until 2026-09-21 (`reading-catalogue.ts:12-17`).
- `goals.targets` is still `ALL_ROLES` (`reading-catalogue.ts:50`), despite today's
  decision that posted targets are owner/manager only.
  - Its metrics include `wine_revenue`, `purchase_spend` and `avg_check`, all
    currency, and `checks` (`analytics/goals.service.ts`, `SUPPORTED_METRICS`, lines
    ~82-110).
  - `checks` is the same fact `sales.check_activity` withholds from staff.
  - So staff see revenue targets today. `ask-code.md` §A flagged this correctly.
  - Landing it also moves the spec (`reading-catalogue.spec.ts`, 9 open → 8) and the
    CLAIMS row that asserts "exactly six" (`CLAIMS.jsonl:397`).
- **Root cause:** sensitivity belongs to a **field** (`unit_price`, `target_value`,
  `covers`), but the gate is attached to a **reading**. Each new reading re-asks the
  question by hand, and a reviewer has to spot the bypass.
- **Fix that survives:** tag each field a reading can show with a data class. Derive
  each reading's roles from its fields. Add a CI guard that fails when a shown field
  has no class.
- Caveat:
  - `target_value` is money only when the metric unit is currency, so a field tag
    must take the strictest class. That matches today's decision anyway.
  - Staff seeing non-money goals row by row is a later founder call, not a default.

### 1.3 Some bypasses no tag can close, only a founder decision
- `inventory.movements` is open to staff. It sums **all** `inventory_transactions` for
  an item over a window, sales depletion included (`reading-sources.ts:37-42`,
  `reading-runner.ts:112-120`).
- For a wine with no delivery in the window, the net movement is its consumption.
  `sales.consumption` withholds exactly that from staff.
- Same kind of leak as `late_deliveries`, but weaker: receipts and adjustments are
  mixed in.
- Whether stock movement counts as "sales" is the founder's call. Stock visibility
  always leaks sales volume over time.

### 1.4 What breaks, person by person
- **Staff:**
  - may reach /ask at all (still open, ADR 0145:483-490);
  - get `model_knowledge` with no role check: the free-text Sonnet answer, up to 1,200
    output tokens (`bound-ask.service.ts:166-167,321-335`);
  - a typed question pays one Haiku pick **before** the role gate (lines 157-160
    before 168), so `ask-sota.md`'s "zero model tokens" holds only when the page chose
    the reading;
  - calendar titles, `private_event` entries included, are open to staff and go into
    the compose call (`reading-sources.ts:88-91`, `reading-runner.ts:218-224`).
- **Owner, locked out by others:** the house shares 200 asks/hour
  (`bound-ask.controller.ts:30`) and one daily spend cap, $5 for `pilot` houses
  (ADR 0146:187-196).
  - One staff member at the per-person limit of 10/min uses the house's hourly bucket
    in 20 minutes.
  - **Estimate, not a measurement:** placeholder prices (`model-client.service.ts:25-43`)
    and a chars/4 token count on the measured 3,493-char pick prompt give about $0.017
    for a worst-case knowledge ask. The $5 cap would go after ~290 such asks, about
    1.5 h at the house limit; typical-length replies stretch that to ~5-6 h.
  - The limits live in memory, per process (ADR 0146:140-146).
  - Per-person spend is already measurable: every call writes `context.asked_by`
    (`model-routing.ts:74-85`). So a per-role budget share needs no new ledger.
- **Manager at two houses:** role is per house when the token names one
  (`jwt.strategy.ts:54-64`, ADR 0162), and folios are listed per house and person
  (`reading-folio.store.ts:67-70`). This survives.
  - Two gaps: a token that names no house falls back to the global `users.role` and
    the default `users.restaurant_id` (`jwt.strategy.ts:31,62-64`), and I could not
    see how often such tokens are issued.
  - A role looked up later by join is wrong once someone's standing changes, so the
    role must be **snapshotted on the folio** (`ask-sota.md` §1 is right).

### 1.5 What makes a future dataset unusable (each item checked in code)
1. **Refusals are lost.** The CHECK in §1.1.
2. **The pick's own answer is lost for 6 of 21 classes.**
   - `finish()` keeps `reading_id` only from a Finding, a refusal or the page
     (`reading-folio.store.ts:86`).
   - `forecast`, `landed_cost`, `sales_revenue` and `lot_expiry` all collapse into
     `not_built`; `general_knowledge` and `unrecognized` survive only as a reply kind.
   - The NF row does not have it either: `choice` is the constant
     `"reading_selection"` (`bound-ask.service.ts:245`), and NF stores no response
     text (`model-client.service.ts:467-478,512-530`).
   - Lost with it: the demand signal and the pick labels.
3. **Nothing says who chose the reading.** A page-chosen reading and a model-picked one
   end up in the same `reading_id` column. The only trace is whether an NF pick row
   exists for that folio. If the page sends catalogue text as the "utterance", those
   rows would enter a pick dataset looking like human wording.
4. **A hand-bumped `prompt_version` (`ask-code.md` G.1) would go stale.**
   - The pick prompt embeds the whole catalogue: **2,971 of its 3,493 characters are
     catalogue JSON**, measured (`bound-ask.service.ts:225,237`).
   - Editing any reading's `question` or `meaning` in `reading-catalogue.ts` changes
     the prompt without touching the file that holds the version string. That is the
     CLAUDE.md §5b lesson.
   - Use a hash computed at call time (system text + model id) plus a catalogue hash.
5. **Feedback on `nf_verdict` (`ask-code.md` G.2) has nothing to attach to.**
   - `event_id` is a NOT NULL FK with `on delete cascade`
     (`20260825180000_nf_verdict.sql:~29-30`).
   - A page-chosen reading whose Finding did not read, or any refusal, makes **no** NF
     row, so there is nothing to attach feedback to. Pruning NF rows would also delete
     the labels.
   - Labels belong to the folio, which is the interaction, in a sidecar keyed by folio.
     That is ADR 0017's pattern with a different key.
6. **A single thumbs rating poisons the training set.** "Wrong" could mean three things:
   - the model understood the wrong question (pick);
   - it highlighted the wrong cells (compose);
   - **the books themselves are wrong**. A model trained on that label learns to fix
     data it cannot fix.
   Feedback must name the step, and "books wrong" goes to data quality, never to
   training.
7. **`reading_version` has no defined meaning.** It comes from the client (DTO allows
   1-100000, `dto/bound-ask.dto.ts:16`), the runner refuses anything but 1
   (`reading-runner.ts:32`), and the policy is open (ADR 0145:175).
8. **There is no data yet.** `ASK_LAUNCHED` is unset (`bound-ask.service.ts:127`) and
   no web caller exists: a grep of `apps/web/src` found zero hits. This is inferred
   from code, not queried. Project memory records one real tenant. That argues for
   building the capture now and training much later.

### 1.6 Where money or personal data leaks
- **Raw utterances** go to the folio (`utterance`, up to 2,000 chars) and to Anthropic
  on every pick and knowledge call. They will carry staff and guest names.
- **Compose inputs** carry up to 300 house cells (`bound-ask.service.ts:288`): vendor
  names, calendar titles.
- **UX signal sink:** `/ux/signals.meta` accepts any object; "must not carry user
  content" is only a description (`ux-optimizer/dto/ux-optimizer.dto.ts`, `meta`
  field; `ux-optimizer.service.ts:118-129`). Its rows have no user, role or folio. So:
  - do not route answer feedback through it;
  - add a guard before the /ask page sends anything there.
- **Pooled training across houses:** safe for pick and compose only because their
  outputs are closed sets. A class name or a cell id from the caller's own Finding
  (`bindReadingReply`) cannot say another house's price. Knowledge answers are free
  text: **never pool-train on them or on unredacted utterances.**
- **Erasure:** folios cascade-delete with the user (migration line 6). The training
  export must be a view keyed by folio id, not a copy, so a deleted person drops out
  of every future training set.
- **Consent and cross-border transfer** of staff utterances for model improvement
  (KVKK/GDPR; Bedrock fine-tuning runs in us-west-2 per the AWS table): **not
  verified.** Legal review is needed before any training use.

### 1.7 Corrections to the two input docs
- `ask-sota.md` §1, "a role refusal … never reaches neural_footprint_event" and "zero
  model tokens": false for typed questions. The Haiku pick writes an NF row before the
  gate.
- Both docs, "the refusal is recorded in `ask_reading_folios`": false against the
  database (§1.1).
- `ask-sota.md` option (a), an NF row for refusals: rejected. ADR 0146:111-116 already
  refuses zero-cost NF rows for calls that never happened. NF records model calls; the
  folio records the conversation turn. Join them by `correlation_id`.

---

## 2. Options (recommended first)

### Option 1: rules outside the model, labels on every row, train later. **Recommended.**
Build now, in this order:
1. **Blocker:** add `not_permitted` to the `reply_kind` CHECK in a new migration past
   `main`.
2. `goals.targets` → owner/manager (today's decision), with spec and CLAIMS moved to 7.
3. **Data classes:**
   - a `FIELD_CLASS` map (money, sales, suppliers, people, stock) and a `ROLE_POLICY`
     table with, per role: visible classes, allowed answer kinds (for example
     `model_knowledge`) and a budget share;
   - each reading's roles are derived from its fields;
   - a CI guard: every field shown has a class, and the computed restricted set equals
     the CLAIMS row.
   - This replaces `ask-code.md` §F's `Record<Role, boolean>` per reading, which is
     still hand-set per reading.
4. **Capture columns on the folio**, written once:
   - `asked_as_role`, a snapshot;
   - `reading_chosen_by` (`page|model`);
   - the raw `pick_class` and `pick_args`;
   - `pick_prompt_sha`, `compose_prompt_sha`, `catalogue_sha` and `policy_sha`;
   - the pick and compose model ids.
5. **A labels sidecar keyed by folio:**
   - fields: `folio_id, basis, step (pick|compose|knowledge|books), label, labeled_by_role, at`;
   - one feedback endpoint scoped like `GET /ask/folios/:id`;
   - re-ask corrections derived from `previous_folio_id` + a page-chosen reading,
     already validated (`reading-folio.store.ts:40`).
6. **An export view:** redacted utterance, catalogue_sha, gold class, model class, role
   and house; erasure-safe. No training until an eval set exists.
- Growing in later: a new model only changes routing, plus one adapter if it runs
  outside the Anthropic client.
- Cost: one migration, about 6 call-site edits, one endpoint, one guard. No new service.

### Option 2: minimal columns now (`ask-code.md` G.1-G.3 as written)
- What it adds: role, a hand-bumped `prompt_version`, model, a 4-value feedback on the
  folio, and feedback mirrored into `nf_verdict`.
- Cheaper, but four problems carry over:
  - the version goes stale (§1.5.4);
  - feedback does not name the step (§1.5.6);
  - refusal and no-model folios cannot take feedback in `nf_verdict` (§1.5.5);
  - the gate stays hand-set per reading (§1.2).
- Acceptable only as a stopgap, and only together with the §1.1 fix.

### Option 3: separate assistants per role (catalogue, prompt and fine-tuned model per role)
- Rejected:
  - it splits a dataset that is empty today three ways;
  - permission becomes model behaviour;
  - it triples the prompt and eval surface;
  - a manager at two houses switches models between houses.
- Role still gets logged under Option 1. If pick accuracy sliced by role later shows
  a gap, role can become a *model input for meaning*, never for permission.

---

## 3. Founder calls this does not make (open, not defaulted)
- Whether staff reach /ask at all (ADR 0145:483-490, still open, no OD row).
- Whether staff get `model_knowledge` (free-text Sonnet).
- Each role's budget share and rate buckets. The guard supports only the `user` and
  `restaurant` scopes (`authed-rate-limit.guard.ts:140-149`).
- Whether stock movement counts as "sales" for staff (§1.3).
- Which data classes each role sees (the `ROLE_POLICY` matrix contents).
- Training only per house, or pooled across houses after redaction.
- Consent and notice for using utterances to improve models (legal, unverified).
- The reading-version policy (ADR 0145:175).

## 4. Not verified
- No production queries, so no traffic, tenant or role counts. "Zero rows" is inferred
  from code.
- No jest run.
- Costs in §1.4 are arithmetic on placeholder prices with a chars/4 token estimate.
- The PGlite proof has platform-fidelity limits (§1.1).
- Anthropic's own API fine-tuning terms: only a secondary source.
- Whether tokens without a named house are issued in practice.
- The `goals.targets` decision is taken from the task framing; I found no code or ADR
  record of it on `r5/KL`.

Sources: https://docs.aws.amazon.com/bedrock/latest/userguide/custom-model-fine-tuning.html ,
https://aws.amazon.com/blogs/aws/fine-tuning-for-anthropics-claude-3-haiku-model-in-amazon-bedrock-is-now-generally-available/ ,
https://callsphere.ai/blog/vw8g-anthropic-claude-fine-tuning-patterns-bedrock-2026 (secondary);
plus the URLs already cited in `ask-sota.md` §2-3.
