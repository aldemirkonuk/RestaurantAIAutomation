# ft-judge: what approach Mudavym should take when it fine-tunes a claim checker

Judged 2026-09-21. Read-only on the repo. I read `ft-methods.md`, `ft-data.md` and
`ft-release.md` in full, both experiment files (`jev-exp.md`, `jev-judge.md`), and
ADR 0163 by grep and line range. The ADR is in the `wt-r5-adr0163` worktree, with
round 8 uncommitted there. Citations `0163:N` refer to that file as it stands now.
I recomputed every sample-size figure. I also ran one small measurement of my own:
language detection on menu lines (§2.1). Nothing else is new data.

## 1. Verdict in plain words

**Do not fine-tune yet. The `kdh` mistake is fixed by a word list, not by training.**

1. Put a short Turkish/Italian format-word table into the deterministic rule check,
   P7(a). For example: kdh/kadeh = glass, şişe/sise = bottle, yarım şişe = half
   bottle, bardak = glass, karafe = carafe.
2. Store every reviewer's verdict as a labelled row.
3. Let Turkish lines skip the person only when the whole gate passes a measured
   test (§4.4).
4. Train a model of your own only if a named kind of mistake is still sending too
   much to review after that, and the word list cannot cover it. When that day
   comes, train a small open model that Mudavym hosts itself:
   - trained only on rows people have checked, with prices masked;
   - added as one more co-signer, never accepting alone.

All three research files lean the same way: gold set first, cheap fixes before
training, and a small open model later. That approach survives the adversarial
pass below, **but only with six amendments** (§2.6). Without them it has four
problems:
- a routing hole that the founder's own rule does not close;
- a training source (distilling Opus) that breaks the independence P7(b) exists for,
  and that runs into an open terms question;
- a gate sample that cannot fill from the data Mudavym will have;
- a retention decision that training would make silently.

## 2. Adversarial pass: trying to kill the leading approach

The leading approach, as all three files converge on it, has five parts:
1. Build the human gold set first.
2. Apply normalisation, glossary, retrieval and span-grounding before any model.
3. Only if a measured ceiling remains, fine-tune a small open multilingual model with
   LoRA, self-hosted, as a P7 co-signer.
4. Optionally enlarge its training data by distilling Opus.
5. Release non-English lines per slice, after a shadow run, behind a
   Clopper-Pearson bound.

### 2.1 The failure it hides

- **Normalising before routing breaks the founder's rule.** ft-methods §4d and §6
  say to expand abbreviations "before any model call". The founder's rule routes on
  the language of the cited span (`0163:1146-1159`), as `languageOf(citedSpan)`
  (`0163:2497`). If the span is normalised first, the Turkish line stops looking
  Turkish. Measured with `langdetect` 1.0.9 (seed 0) on this machine:
  - `glass 240 / bottle 1.100 TL` → `en` 0.99999, so it skips review;
  - the raw `kdh 240 / şişe 1.100 TL` → `tr` 0.99999.

  **Routing must read the raw span, never the normalised one.**
- **A whole-line language test misroutes the exact `kdh` shape.** Measured with
  the same detector:
  - `Cloudy Bay, Sauvignon Blanc, Marlborough, New Zealand, 2023 ... kdh 350 / sise 1.650 TL`
    → `en` 0.99999. The wine's name outweighs the Turkish format word that carries
    the error.
  - On Menu D, 3 of 11 lines come out `en`: St-Jos., Ch. Pav. Bl., and Ch. Pichon.
  - Two of Jev's five misses sit on those lines: Saint-Julien (0.51 / 0.36) and
    Pavillon Rouge (0.70). Under a naive `== 'en'` test, only Opus or an abstention
    band would stand between them and publication.
  - The ASCII-folded `kdh 240 / sise 1.100 TL` comes out `sq` (Albanian) 0.86. That
    is still "not English", so it routes correctly only if the test is written as
    `!= en`, never as `in (tr, it)`.
  - **Fix:** a line counts as not English if the detector is not confident it is
    English, **or** if any token matches the non-English format-word table. The
    table then does two jobs: it routes, and it checks. This measurement covers one
    detector and 22 lines. It is a demonstration, not a benchmark.
- **The problem is misdiagnosed as a language problem.** Jev made 0 errors on 28
  claims written in another language. All five of its Menu D misses were
  abbreviation or format readings (`jev-judge.md:95,107`; `0163:3829`). A "Turkish
  fine-tune" would not fix `Barb. d'Asti` read as Barbaresco on an Italian line.
- **The checker that caught `kdh` is the one the ADR does not count as
  independent.** Opus (c) "belongs to the same model family as P6" (`0163:1111-1114`),
  and P6 is the reader that proposes the claims. The experiment's claims were written
  by Opus, not produced by P6. Correlated reader and judge errors were therefore
  never tested. For a listing fact, (d) is the menu itself (`0163:1109`), so
  independence rests on (a) and (b). And (b) is Jev, whose false-accept rate on
  withheld-expansion claims was 5 of 22. **The independent check that can actually
  stop `kdh` is (a) with the table.** The gate must also be measured on real P6
  output, not only on constructed claims.
- **Releasing a slice starves its own audit.** Once Turkish claims auto-accept,
  human labels on Turkish stop flowing, which is exactly where drift arrives. A
  released slice must keep a random audit, and the ADR's own 1-in-10 re-check
  (`0163:1269`) is the rate to reuse.
- **Reviewers who see the model's score anchor on it.** A reviewer shown "Jev 0.87
  yes" is primed to approve "per carafe". Gate and test items need blind review, or
  the gold set grades the models against themselves.

### 2.2 The data it assumes Mudavym will have, and will not

- **Real Turkish lines: none today.** The ADR's corpus is 41 laptop PDFs, all US
  (CA 14, IL 4, NY 18, WA 5; `0163:279`), plus 26 corpus PDFs. The folder
  (`datasets/annotation_inbox/pdfs/`) lists only US restaurants. The Turkish gold set
  must come from:
  - house menus, under the notice and opt-out; or
  - public Turkish lists newly crawled under §8, storing quotes only.
- **False claims: the gate needs hundreds, and real reader output is mostly true**
  (`jev-judge.md:67`).
  - Natural reader errors will not reach 381 false Turkish-line claims at 1-10
    houses.
  - **Build the false claims by deterministic mutation of real lines**: swap the kdh
    and şişe prices, shift the vintage, swap the currency, put a half-bottle price on
    a full bottle, or pick a same-prefix wrong neighbour from the library's own
    catalog. The label is known by construction and still confirmed by a person.
  - This also removes the "same model wrote, labelled and graded it" bias
    (`jev-judge.md:70`).
- **Reviewers: three accounts hold roles, and no sommelier has been invited**
  (`0163:1888-1889`).
  - ft-data's "double-annotate every gold candidate" would double a load that has
    no one to carry it.
  - Double-annotate only the gate sample and the frozen test split. Use the ADR's
    1-in-10 re-check everywhere else.
- **Training volume.** A LoRA classifier needs a few hundred confirmed rows per
  class and language (ft-methods §1; ft-data §1.3). That does not exist at 1 house,
  and Italian lines at Turkish houses may never reach it. **Italian may stay in
  review permanently at this scale**, and that is acceptable.

### 2.3 Cost at 1, 10 and 50 houses

Two inputs are estimates:
- **Volume per menu version:** about 500 claims per house. That is about 100 wines
  per list, the ADR's US-list figure (`0163:2633`), times about 5 checked values per
  line (my assumption).
- **Tokens per claim:** about 440 (`jev-exp.md:9`).

| | 1 house | 10 houses | 50 houses |
|---|---|---|---|
| Claims per menu version | ~500 | ~5,000 | ~25,000 |
| Jev at $0.0000185 per claim | ~$0.01 | ~$0.09 | ~$0.46 |
| Opus at $0.0079-0.0125 per claim (list price; really plan quota) | ~$4-6 | ~$40-63 | ~$198-313 |
| Human verdicts while non-English goes to review (nearly every Turkish line) | ~500 | ~5,000 | ~25,000 |
| Tokens per full pass | ~0.2M | ~2.2M | ~11M |

- **Self-hosting a fine-tuned model breaks even only at about 2-5M tokens a day**
  (Introl, via ft-methods §1). At 50 houses a full pass is about 11M tokens. Even a
  monthly re-check of every menu is about 0.37M tokens a day, 5-14x below
  break-even. **A self-hosted model never pays for itself on model spend at 1-50
  houses.**
- The only cost worth attacking is human review: points per verdict, times nearly
  every claim at a Turkish house. The table in (a) and the release gate attack it
  with no training at all.

### 2.4 The privacy and terms rules it would break

- **Retention by stealth.** Opting out removes a house from future training, but
  "models already trained are not retrained" (`0163:2078`). Training therefore writes
  data into weights for good.
  - Mudavym's own retention of gold rows, reviewer verdict logs and training exports
    is not decided anywhere.
  - OD-133 covers what TypeSafe retains. It does not cover Mudavym's own retention,
    and ft-release §4.2 conflates the two.
  - Training before that is decided would decide it by default, which breaks CLAUDE.md
    §0.1.
- **A single price at one house.** "One other house's single price is never shown on
  its own" (`0163:1513`). A training row is exactly one house's single price.
  - **Fix: mask the digits in training rows**, with the same shape in both the line
    and the claim. For example, `kdh 240` becomes `kdh 731`, and "240 TL per
    carafe" becomes "731 TL per carafe".
  - The task is about which format the price belongs to, not the number, so the
    house's price never enters the weights.
- **Anthropic's terms.** The consumer terms bar using the Services "to develop or
  train any artificial intelligence or machine learning algorithms or models". How
  that applies to training Mudavym's models on the tasks' outputs is an open lawyer
  question, Q17(i) (`0163:3395-3398`), and P7(c) runs on plan credit.
  - **Distilling Opus falls squarely inside that question.** Training on
    reader-written claim text touches it too.
  - Distillation also clones Opus into the slot that exists to be a different model
    family (`0163:1111-1115`).
  - **Opus scores may be analysed. They are never training labels.**
- **KVKK.** Reviewer verdict histories are personal data. Menu prices are business
  data. A training export carries an opaque reviewer id only (ft-data §8.4).
- **Cross-border transfer.** A hosted fine-tune (Vertex, Mistral, or a vendor-tuned
  Jev) is a bulk export abroad under Law 7499's tiered regime (ft-data §8.3). A
  model self-hosted in-region avoids that for training.

### 2.5 Where a glossary beats a fine-tune, and where it does not

- **`kdh` is a closed-vocabulary format word.** A table of about 12 entries, with
  each price tied to the format word before it, fixed 10 of the rule's 17 errors in
  `jev-judge.md` (flaw 3: 72.2% to 89/96).
  - With the table, (a) rejects "240 TL per carafe" deterministically.
  - It needs no labels and no GPU. It can be rolled back instantly and every
    decision is auditable.
  - It also covers `sise` (ASCII-folded) and `ŞİŞE`, provided folding follows
    Turkish case rules (ft-methods §5).
  - Fine-tuning would spend hundreds of labelled rows teaching weights a 12-row
    table, and could still score a wrong mapping at 0.87.
- **The glossary loses on open-class name abbreviations** (`St-Jos.`,
  `Barb. d'Asti`, `Ch. Haut-B.`), because those cannot be enumerated.
  - Even there, the right behaviour is to **abstain on ambiguity**, not to resolve it
    confidently. Jev scoring Haut-Brion at 0.94 is the wrong behaviour.
  - A gazetteer check against the library's own producer and appellation catalog
    does this deterministically: if more than one entry fits the letters, the claim
    goes to review.
  - Fine-tuning becomes a real candidate only when this class still leaves a large
    share of claims in review after the gazetteer is in place.

### 2.6 What survives: the leading approach with six amendments

1. The format-word table goes into P7(a) **and** into routing. Routing reads the raw
   span, fails closed, and runs before any normalisation.
2. Drop Opus distillation as a training source.
3. The gate's false claims are rule-generated mutations of real lines, confirmed by
   people. Gate items are reviewed blind.
4. Training rows mask prices and carry only an opaque reviewer id.
5. Nothing is trained until two things are answered: Mudavym's own retention for
   gold and training rows, and Q17(i).
6. The release gate measures the composite gate per language and per stratum, keeps
   a 1-in-10 audit after release, and has one-flag rollback.

## 3. Errors in the three research files

- **ft-data §1.3:** the Wilson lower bound for 200 claims with 6 errors is 0.936,
  not 0.916. The "no" verdict is unchanged.
- **ft-release §2.2:** "Wilson gives n=268" uses a one-sided z of 1.645. The ADR's
  own convention, z = 1.96 (`0163:187`), needs **381**, which is larger than the
  Clopper-Pearson 299, not smaller. The Clopper-Pearson table itself reproduces
  exactly.
- **ft-release §4.2:** the retention of reviewer-corrected data is not OD-133.
  OD-133 is TypeSafe's retention (`OPEN-DECISIONS.md:76`).
- **ft-data §1.2, §4 and §10.1:** the claim-versus-span fork is now **decided**. It
  keys on the span ("review by the menu line", round 8, `0163:1146-1159`).
- **ft-methods (bottom line and §3):** it calls `kdh` Jev's "one false accept on Menu
  D". Jev had five, and `kdh` was the one on a Turkish line. Its `0163:880-883` P7
  citations are stale: P7 is now at `0163:1101-1159`. "Distillation needs no human
  labelling" ignores §2.4 above.
- **ft-data §9.1:** revisiting mDeBERTa needs the same licence-lineage check the ADR
  ran on MiniCheck. MiniCheck's ANLI training data is CC BY-NC (Q6 (remainder),
  `0163:2874-2878`). The same applies to any Qwen, Llama or Cosmos base.

## 4. For the founder

### 4.1 Recommended approach

**Glossary and gold set now, training last.**
- Fix format words (kdh, şişe/sise, yarım şişe, bardak, karafe) with a table in the
  rule check and in the routing test.
- Turn every review verdict into a stored, versioned row.
- Let a language skip the person only when §4.4's numbers are met.
- If a named mistake class still keeps too much in review at 10 or more houses, and
  the table and catalog cannot cover it, then train. Train a small open multilingual
  model that Mudavym hosts in-region, on rows people have checked, with prices
  masked. It enters as a shadow challenger, then becomes an extra co-signer, and
  never accepts alone.
- Neither Jev nor current Claude can be fine-tuned by Mudavym today. The only model
  Mudavym can train is one it hosts itself.

### 4.2 Options (mutually exclusive, recommended first)

1. **Glossary, gold set, gate (recommended).**
   - A format-word table fixes the `kdh` class in the rule check. Review verdicts
     grow a human-confirmed gold set, and each language is released only when the
     gate's measured numbers clear. Nothing is trained.
   - Cost: a few days of engineering, plus reviewer points on about 500 claims per
     house per menu version (estimate) until release. Model spend stays under $1 of
     Jev per 25,000 claims.
2. **Train own small checker.**
   - Once several hundred confirmed Turkish rows exist, LoRA-tune a self-hosted open
     multilingual model as an extra co-signer.
   - Cost: the same gold set first, a licence check, a superseding ADR, and GPU
     serving that does not break even below about 2-5M tokens a day. That is well
     above the ~0.37M tokens a day of a monthly full pass at 50 houses.
3. **Distil Opus into student.**
   - Label a large menu corpus with Opus and train a small model on its verdicts,
     skipping most human labelling.
   - Cost: about $8-13 per 1,000 lines at list price. It copies Opus's blind spots
     into the slot meant to be independent, and it sits inside the open terms
     question Q17(i).

### 4.3 Stages

- **1 house:**
  - Every claim on a non-English line goes to review, as the founder ruled.
  - Ship the format-word table into P7(a) and into routing. Routing reads the raw
    span and fails closed.
  - Store each verdict with:
    - the span;
    - the claim;
    - the (a), Jev and Opus scores;
    - an opaque reviewer id;
    - the gold-set version.
  - Add rule-made false mutations of the house's own lines. Seed Menu D as items to
    be confirmed. Freeze a test split.
  - No training and no release. Expect about 500 verdicts per menu version.
- **10 houses:**
  - Run the gate in shadow on every reviewed Turkish claim.
  - Measure per language and stratum. Try prompt, retrieval and catalog fixes against
    the frozen set.
  - The founder decides Mudavym's own retention for gold and training rows, and gets
    Q17(i) answered.
  - Turkish can clear §4.4 here; Italian probably cannot. Release Turkish behind one
    flag, with a 1-in-10 audit.
- **50 houses:**
  - Turkish runs released, with a live audit and automatic rollback. Italian is gated
    on its own counts.
  - Only if a named miss class still holds a large share of claims in review, and
    the table and catalog cannot cover it, take option 2: a masked-price LoRA model,
    shadow first, then co-signer.
  - It must be non-inferior on the frozen set (the G6 rule, `0163:1262`).

### 4.4 Release gate for Turkish lines without a person

This is measured on the composite (a)∧(b)∧(c) gate, never on Jev alone. The same gate
applies to Italian, with its own counts. Every condition must hold:

1. **Hard false claims.**
   - At least **381** human-confirmed false claims on real Turkish lines, with **0**
     auto-accepted.
   - They come from **5 or more houses, none over 25%**. That is the ADR's own k=5
     and 25% shape (`0163:1511-1513`).
   - At least a third are format swaps (kdh, şişe, yarım şişe, bardak) and a third
     are withheld-expansion abbreviations (Menu D's shape, `0163:1274-1293`).
   - With 0 accepted, the false-accept rate is below 1% at the ADR's own Wilson
     bound, z = 1.96 (`0163:187`; computed). One accepted false claim raises the
     requirement to 563.
   - The exact one-sided 95% Clopper-Pearson alternative needs 299 (ft-release
     §2.2, recomputed).
   - Why 1%: at 1%, the 0.95 sourced floor still holds even if the reader got about
     80% of Turkish lines wrong, assuming 90% of true claims are accepted (computed).
2. **Real stream.**
   - In shadow on real reader claims on Turkish lines, look at the claims the gate
     would have accepted. Checked by people, their Wilson lower bound must be at
     least **0.95**. That is the ADR's sourced floor (`0163:187`).
   - That needs 73 or more with 0 errors, or 150 with 1 error (lower bound 0.963,
     computed).
3. **Labels.**
   - Every gate item is reviewed blind, by two people, with a third adjudicating.
   - Cohen's kappa must be at least **0.81** on the Turkish slice (Landis-Koch
     "almost perfect", ft-data §2).
   - No label may be written by the model family under test.
4. **After release.**
   - Routing still reads the raw span.
   - **1 in 10** auto-accepted Turkish claims still goes to a person (`0163:1269`).
   - If the running false-accept bound on those audits crosses 1%, one flag reverts
     Turkish to review automatically.

### 4.5 One example

A guest asks for a glass of the Sevilen Güneşin Kızı, and the list reads
`kdh 240 / şişe 1.100 TL`. The reader proposes "240 TL per carafe".

- **Today:** the line is not English, so it goes to a person. With the table, (a)
  has already rejected it, because kdh is a glass. The reviewer marks it false:
  240 TL is a glass. The reviewer earns points, and that verdict becomes one gold
  row (Jev 0.87 yes, Opus no).
- **After Turkish clears the gate:** the same wrong claim is still stopped by the
  table, with no person involved. The true "240 TL per glass" is accepted in seconds
  when the rule, Jev and Opus all agree, and 1 in 10 of those is still checked by a
  person.

## 5. Open forks this surfaces (not decided here)

1. **Mudavym's own retention** for gold rows, reviewer verdict logs and training
   exports. This is not OD-133. It needs its own row before any training.
2. **Q17(i).** Does training Mudavym's models on the Cowork tasks' outputs breach
   Anthropic's consumer terms? This is open (`0163:3395-3398`).
3. **The definition of "not English" for a line.** I recommend: not confidently
   English, or containing any non-English format word. This is stricter than, and
   consistent with, "review by the menu line", but it should be put to the founder.
   Build order step 1.5's check (`0163:2503-2507`) should add the
   `Cloudy Bay ... kdh` fixture, which its two current fixtures would not catch.
4. **Wilson z=1.96 (381) or Clopper-Pearson one-sided 95% (299)** for the gate. I
   recommend the ADR's own Wilson convention for consistency.
5. **Whether reviewers see model scores.** I recommend blind review for gate and
   test items.

## 6. Limits (stated plainly)

- **Volume and cost:** the 500-claims-per-house figure is an estimate (a US-list
  wine count times an assumed 5 values per line). Reviewer minutes per verdict are
  unmeasured, so review cost is given in verdicts, not hours.
- **Language detection:** one library (`langdetect` 1.0.9) on 22 hand-picked lines.
  The implementer's detector is unknown because no code exists
  (`0163:1155-1159`).
- **Vendor facts not re-verified:** I did not re-fetch any vendor or pricing source
  the research files cite, including OpenAI's wind-down, Bedrock's Haiku-only route,
  Introl's break-even and Mistral's pricing.
- **No count of public Turkish lists:** how many public Turkish wine lists are
  crawlable under §8 was not measured.
- **The 1% target is derived, not given:** it is my reasoning from the ADR's 0.95
  floor, not a founder decision.
