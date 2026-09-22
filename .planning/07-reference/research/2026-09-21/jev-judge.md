# jev-judge: adversarial review of the Jev experiment (`jev-exp.md`)

Judged 2026-09-21. I recomputed every headline number from `jev-exp/raw/` with my own script, which does not import `analyze.py`. I also ran one extra round built to fix the experiment's biggest flaw. Nothing in the repo was edited.

## Verdict

- **The numbers reproduce.** Every figure I re-derived matches the report except one small citation drift, covered below.
- **The main result overstates Jev.** Its 100% came from claims that already spelled out the abbreviation for the checker, as in "The *Château Margaux* listed…" written against "Ch. Marg.".
- **The re-run gave the checker the abbreviation alone.** Each claim began "The wine on this line…" and named a plausible wrong expansion. Results:
  - **Jev** accepted 5 of 22 false claims, 2 of them at p ≥ 0.8.
  - **Opus 5** rejected all 22.
  - Jev also read the genuinely ambiguous "Ch. Haut-B." as Haut-Brion at 0.94. Opus gave it 0.38.
- **Jev is still worth something.** It is cheap and fast, it never blocked a true claim in 280 true-claim verdicts, and it plainly reads the line: 0 of 48 line-blind controls were accepted.
- **It adds nothing beside Opus.** Across 216 span-condition claims it caught 0 false claims that Opus missed.

## Headline numbers (re-checked)

| Measure | Jev (cited span) | Opus 5 (same prompt) | Rule proxy (report's) |
|---|---|---|---|
| Main set, Menu A (42 claims) | 42/42 | 42/42 | 40/42 (2 false accepts) |
| Main set, Menu B (54 claims) | 54/54 | 54/54 | 39/54 (15 true blocked) |
| The report's probes, rounds 1-2 (75 claims) | 75/75 | 75/75 | 52/71 |
| **Judge re-run, no abbreviation hints (45 claims)** | **40/45** (r1), 41/45 (r2) | **45/45** | not run |
| False claims caught, all 216 pooled | 110/115 | 115/115 | — |
| True claims blocked, every Jev span run | 0 of 280 verdicts | 0 of 101 | — |
| Line-blind control (48 true claims, each against the wrong line) | 0 accepted, max p 0.01 | not run | — |
| Median / p90 latency | 154 / 197 ms (TypeSafe server time 76 / 115 ms) | 1,918 / 2,522 ms API; 4,030 ms wall | <1 ms |
| Cost per claim, list price | $0.0000185 (441 input tokens × $0.042/M) | $0.0125 as the CLI reports it; $0.0078 at plain API rates; output tokens alone give a $0.0031 floor | $0 |
| Failures / timeouts | 0 of 899 calls (the report's 710 plus my 189) | 0 of 402 calls | — |

- **Jev vs Opus, pooled over 216 span claims:** Jev was wrong and Opus right on 5 claims, and never the other way round. The exact McNemar p is 0.0625, so this is not significant at 0.05. The direction is one-sided.
- **Efficiency:** Jev is about 12x faster on API time, about 26x faster on wall time, and 166-680x cheaper per claim at list price.
- **Opus's real cost is quota, not dollars.** P7(c) runs on plan credits (ADR 0163 §11), so the Opus dollar figures are list-price equivalents, not money spent.

## What reproduced, and what did not

- **Reproduced exactly:** every cell in the report's main table, including accuracy, FALSE precision and recall, true claims accepted, abstentions, unstated-true claims accepted, latency, tokens and cost.
- **Also reproduced:**
  - 710 Jev calls using 360,573 tokens, costing $0.0151.
  - 355 Opus calls at a CLI-reported $5.207.
  - 0 verdict flips across Jev's three span runs, with a maximum probability change of 0.02.
  - Span separation: lowest TRUE 0.76 and highest FALSE 0.30 for Jev; 0.87 and 0.13 for Opus.
  - The Jev server time of 76/115 ms, measured on the main J1 runs. Pooled over all 710 calls it is 83/128 ms.
- **Opus prices are consistent with the CLI's own cost figures.** For A1-t1, 967 cache-read, 2 input and 128 output tokens come to exactly $0.0036935 at $0.50, $5 and $25 per million tokens.
- **Key hygiene:** I loaded both keys inside a helper process and scanned 163 files under `q921/`. Neither key appeared anywhere.
- **Not verifiable: "fixed before any result was read."** `analyze.py` was last modified at 11:19, after the Jev main-set logs were written (11:17-11:18). The chosen thresholds are conventional, and on the main set any threshold from 0.31 to 0.75 gives the same verdicts, so the practical risk is low.
- **Stale citations: the ADR is being edited live.** Another session modified `0163-…md` at 11:38, adding 95 lines. The report's `0163:N` citations are now off by about 36 lines. Current anchors:
  - P7 at :906-914
  - "silence, not exclusion" at :2610
  - the non-English-to-review default at :2613
  - the notice fork "Whether the notice must name Jev" at :1758, now marked **NOT ANSWERED**, waiting on this experiment

## Flaws found, most serious first

1. **The claims gave away the answer on abbreviations.** Every Menu B claim was the expanded form:
   - "The Château Margaux listed…" for "Ch. Marg."
   - "The Biondi-Santi Brunello di Montalcino…" for "Brun. d. Mont."
   - "The Domaine du Vieux Télégraphe…" for "Dom. du Vx Telegraphe"

   So the checker only had to confirm an expansion it was handed. In P7, catching a *wrong* expansion from the P6 extractor is the job that matters. The main set tested it about twice (B5-f2 Bartolo Mascarello, B8-f1 Ornellaia), and the probes once more (Ch. Lat. read as Lafite). I measured it directly (see the re-run below), and that is where Jev fails.
2. **About 21 of the 48 main-set false claims could be rejected from world knowledge alone,** without reading the line. Examples: Tignanello from Pinot Noir, Châteauneuf-du-Pape from Nebbiolo, Bollinger from Penedès, Sassicaia made by Ornellaia. Most of the rest are simple number mismatches. The report's 6 UNSTATED_TRUE claims were too few to show the checkers were actually reading the line. My 48-claim line-blind control settles that point in Jev's favour.
3. **The comparison with the rule is partly a straw man.** The proxy has no format synonyms (btl, şişe, bottiglia, gl, verre, kdh), and it does not tie a price to its format. Adding a 12-entry synonym table and linking each price to the format word before it fixed 10 of the rule's 17 errors, taking it to 89/96. That is 42/42 on Menu A and 47/54 on Menu B. The 7 claims it still gets wrong are all name abbreviations, and in each case it rejects a true claim, which only sends the claim to review.
   - This better rule is post hoc, since I wrote it after seeing the errors.
   - Jev's real lead over a rule is **+7.3 points, all of it true claims the rule would send to review**, not the +17.7 the report gives.
   - P7 is an AND gate, so Jev can never override a rule rejection anyway. Its "help" against the rule is not something the pipeline can use.
4. **The sample cannot separate Jev from Opus.** On the report's 171 claims both scored 100%, with no disagreements, so there was nothing to measure a difference with. With the extra round there are 5 disagreements, all in Opus's favour (p = 0.06). Other limits:
   - The classes are 50/50, so FALSE precision will not carry over to real P6 output, which should be mostly true.
   - Opus ran once per condition.
5. **The Opus cost is the most expensive Claude option.** The report compared Jev with Opus 5 at high effort with thinking, going through CLI scaffolding of about 940 tokens. No cheaper Claude model and no lower effort setting was measured. In any case P7(b) must come from a non-Anthropic model family (0163 P7), so no Claude model can take Jev's slot. The Opus figure answers what P7(c) costs, not what Jev's alternatives cost.
6. **The same model wrote the claims, labelled them, and acted as the baseline.** Claude Opus 5 did all three. My re-run shares this bias. I reduced it by choosing only labels that anyone can decide from the text, such as "Barb. d'Asti" not being Barbaresco and "kdh" (kadeh) meaning glass, not carafe.
7. **Cost figures:** Jev's tokens are measured, but its price is the published list price, with no invoice checked. Opus is at list price, while on the plan it actually consumes quota.

## Judge re-run: abbreviations without hints, and a line-blind control

**Files:** `jev-judge/fixtures_judge.py`, `run_judge.py` and `fair_rule.py`. Raw logs are in `jev-exp/raw/judge_*.jsonl`. The runs used the same prompt (`run.py:question_for`), endpoint, model, thresholds and key loader as the report.

**The menu.** Menu D is 11 synthetic lines. Its abbreviations can each be expanded to a real, plausible neighbour, for example:
- "Barb. d'Asti Sup." (Barbera, not Barbaresco)
- "Montepulc. d'Abr." (not Vino Nobile di Montepulciano)
- "St-Jos." (Saint-Joseph, not Saint-Julien)
- "Ch. Pav. Bl. du Ch. Marg." (Pavillon Blanc, not Rouge)
- "Coche-D." (Dury, not Bizouard)
- "kdh" (glass, not carafe)
- "yarım şişe" (half bottle)
- "Krug Gr. Cuv. 171ème Éd."

**The claims.** 23 TRUE, 22 FALSE and 2 AMBIG. 8 are written in Turkish, Italian or French.

| Checker | True accepted | False caught | Wrong expansions accepted (p) | AMBIG "Ch. Haut-B." = Haut-Brion | Foreign-language claims |
|---|---|---|---|---|---|
| Jev, run 1 | 23/23 | 17/22 | Barbaresco 0.89, carafe 0.87, Pavillon Rouge 0.70, Vino Nobile 0.65, Saint-Julien 0.51 | **0.94 (accepted)** | 8/8 |
| Jev, run 2 | 23/23 | 18/22 | same, except Saint-Julien 0.36 | 0.94 | 8/8 |
| Opus 5 | 23/23 | 22/22 | none (all ≤ 0.06) | 0.38 | 8/8 |

- **Pattern:** Jev accepts a claim when the expansion shares letters with the abbreviation, and it settles a genuinely ambiguous abbreviation with high confidence. Every one of its misses is an abbreviation or a format. None comes from language: all 8 foreign-language claims were right. In P6 output, this is the error most likely to occur.
- **Inside the gate:** Opus caught every one of Jev's misses. The (b)∧(c) gate therefore let 0 false claims through. That result depends on Opus staying in the gate.
- **Line-blind control:** I gave all 48 main-set TRUE claims a different wine's line. Jev rejected all 48, with a maximum p of 0.01. It answers from the line, not from world knowledge.
- **My own mistake:** I also ran Jev with the whole menu as state on this set. That run is **invalid**, because "the wine on this line" has no referent when there is no line. Its log is kept but not counted.
- **Cost of this round:** 189 Jev calls for about $0.004, and 47 Opus CLI calls at $0.62 list-price equivalent on plan credit.

## Did Jev help, how much, and how efficiently?

| Question | Answer |
|---|---|
| **Accuracy against the rule** | +17.7 points against the report's proxy, but only +7.3 against a fairer rule. All of the gain is on true claims the rule would send to review. In the AND gate Jev cannot recover them. |
| **Accuracy against Opus** | **No help.** Jev caught 0 false claims that Opus missed, out of 216. It was worse on wrong abbreviation expansions: it caught 7 of 12, against 12 of 12 for Opus. |
| **Where it failed** | Abbreviation *disambiguation* (Barb., Montepulc., St-Jos., Pav. Bl., kdh, Haut-B.), a whole menu used as state (Ch. Lat. read as Lafite), and doubtful scores on near-identical producers and decimal commas. It did **not** fail on Turkish, Italian or French. That covers 28 foreign-language claims with 0 errors, a lower 95% bound of 0.88. Its confidence was lower on Turkish. |
| **What it does well** | It never blocked a true claim (0 of 280 verdicts), and it reads the line (0 of 48 controls accepted). In the AND gate it adds no review load, while giving the independent model family that ADR 0163 requires for (b). |
| **Efficiency** | About 150 ms and about $0.02 per 1,000 claims, against about 2 s and $3-13 per 1,000 claims for Opus at list price. |

## Options for the founder

### The notice: does §14 name TypeSafe as a processor?

The notice fork is still open (0163:1758). The founder deferred it until this experiment was done. The experiment cannot answer it, because whether the notice must name TypeSafe is a disclosure and legal question (Q17), not an accuracy one. What the experiment does settle is what would be sent: one quoted menu line plus the claim, about 440 tokens, and never the whole menu, since the span design did better anyway.

- **N1: name TypeSafe (recommended if Jev stays).**
  - The notice gains one line beside the Cowork line from Q17(h). It would say that each checked menu line and its claim go to TypeSafe AI's Jev, a hosted API; that TypeSafe states it does not train on customer data (`docs/models.md:56`); and that zero data retention is not in place, since it is enterprise-only and on request.
  - Filing TypeSafe in the subprocessor register, which today holds 0 of 50 entries (ADR 0182 addendum), goes with it.
  - Cost: one sentence, plus reading the DPA, which is vendor-stated and unreviewed.
- **N2: do not name it.** The argument is that only single lines are sent, that nothing is pooled, and that TypeSafe says it does not train on them.
  - Cost: nothing now.
  - Risk: it contradicts naming Cowork. The notice exists to tell a house where its menu prices go, and TypeSafe's default retention is unknown.
- **N3: make the question moot by routing.** Jev (b) sees only public, non-house sources, such as producer pages and public crawled menus. Lines from menus a house uploads skip (b) and go through (a), (c) and review.
  - Cost: a small code branch, and house listing facts lose their independent check.

### Does Jev stay the P7(b) claim checker?

- **S1: keep it exactly as ADR 0163 has it (recommended).** That means span only, all of (a)∧(b)∧(c)∧(d) required, and every non-English claim sent to review until the pilot's gold set is ready.
  - Add two things to the pilot gold set: this run's no-hint abbreviation set, and a rule that Jev's "yes" never auto-accepts on its own.
  - Cost: about $0.02 per 1,000 claims.
  - Why: it is the only non-Anthropic check, it is cheap, and it never blocked a true claim. Its misses are covered only while Opus stays in the gate.
- **S2: keep it, but call it first as a screen.** A Jev "no" (p < 0.2) goes straight to review with no Opus call; only claims Jev passes go on to Opus.
  - Evidence: Jev blocked 0 of 280 true-claim verdicts.
  - Saving: Opus quota on false extractions only, which should be a minority in real P6 output (not measured).
- **S3: drop Jev.** Opus (c) caught everything Jev caught, and 5 more.
  - Cost: independence then rests only on (a) and (d). That is the objection ADR 0163 raised against C2, so a superseding decision would be needed.
  - The notice question disappears.

## What I could not verify (stated plainly)

- **No real menus, OCR or P6 output.** Every menu here is synthetic, and every claim was written by Claude Opus 5. That is not the pilot gold set ADR 0163 §5 requires.
- **Few repeat runs.** Opus ran once per set, and Jev ran twice on the new set.
- **Nothing independent of TypeSafe.** There is no Jev invoice, no reading of the DPA, and no check of TypeSafe's default retention period.
- **The report's "fixed before results" claim for its thresholds** cannot be confirmed from file times.
- **Possibly old wording.** I did not check whether the language statement in TypeSafe's `models.md` is actually new since the 2026-09-17 overview crawl, or was only missed by it.
- **Menu D labels.** They are mine and were not validated by a sommelier. The 5 Jev misses turn on unambiguous expansions, but D1-a1 ("Haut-B.") is ambiguous by design.
- **No cheaper baseline measured.** I did not measure a cheaper Claude model or a lower effort setting.
