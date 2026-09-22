# jev-exp: did Jev help as the ADR 0163 P7(b) claim checker?

Run on 2026-09-21, 15:15-15:27 UTC, from the founder's Mac. Two synthetic menus were written for this run, so no house data left the machine. Every raw request and response is in `jev-exp/raw/` (only the API key is redacted). Scripts and fixtures sit next to them. [CORRECTED 2026-09-22: neither `jev-exp/raw/` nor the scripts and fixtures were kept in this repo. They stay in a local scratch folder that a reboot clears; ADR 0032's waiver for these judges brought in only the judged summaries.]

## Bottom line

- **Against the deterministic rule (P7(a)-style check): Jev helped a lot.** On the complex menu, accuracy went from 72.2% to 100%. The rule rejected 15 of 27 true claims because it cannot read abbreviations or other languages ("Ch. Marg.", "şişe", "btl", "verre"). On the simple menu, the rule accepted 2 of 21 false claims where a bottle price was relabelled as a glass price. Jev caught both.
- **Against Claude Opus 5 (the P7(c) judge the ADR already has): no accuracy gain.** Both scored 96/96 on the experiment the founder specified. Both also scored 171/171 when the adversarial probe rounds are added and each gets only the quoted menu line. In P7's all-must-agree gate, adding Jev to Opus changed **0 of 96** outcomes: it caught no false claim that Opus missed and blocked no true claim that Opus accepted.
- **Efficiency is where Jev wins.** Median latency was 154 ms (p90 197) against Opus 5's 1,918 ms (p90 2,522) of API time, which is **about 12x faster**. Wall time through the CLI was about 26x slower for Opus. Cost was **$0.0000185 per claim** against $0.0079-0.0125 for Opus, which is **about 420-680x cheaper**. Accuracy was equal on this data.
- **Where Jev weakened:**
  - It made **one wrong call in 171 claims, and only when given the whole menu**. It accepted "Ch. Lat." as Château Lafite at 0.55; the correct reading is Latour.
  - With only the quoted line it made **no wrong calls**. Its doubtful answers landed in the 0.2-0.8 band on three kinds of claim, all of which a careful reader would also hesitate on:
    - near-identical producers (Domaine vs Olivier Leflaive, 0.23-0.30)
    - a decimal comma ("18,50 €" read against "1,850 euros", 0.17-0.23)
    - a claim written in Turkish (0.76-0.78)
  - Its confidence is measurably lower on Turkish text, typos and slang than on English. Opus's is not.
- **The sample is small, synthetic and labelled by the author.** It is not the pilot gold set ADR 0163 §4 P7 requires before any threshold is set. It shows Jev *can* do this job. It does not clear ADR 0163's default of sending every non-English claim to review.

## What was run

**Menus.** The house names are invented. The producer names are real and appear only as menu text. Ground truth is *what the line states*, not what is true of the wine in the world.

```
A (simple, English, 7 lines)
HARBOUR TABLE - WINE LIST
All wines by the bottle (750 ml); selected wines also by the glass (175 ml).
Domaine William Fèvre, Chablis Premier Cru "Montmains", Burgundy, France, 2021 — glass £16 / bottle £78
Cloudy Bay, Sauvignon Blanc, Marlborough, New Zealand, 2023 — glass £13 / bottle £62
Marchesi Antinori, Tignanello, Tuscany, Italy, 2019 — bottle £165
Château Musar, Château Musar Red, Bekaa Valley, Lebanon, 2016 — glass £18 / bottle £88
Catena Zapata, Malbec Argentino, Mendoza, Argentina, 2020 — glass £15 / bottle £72
Domaine du Vieux Télégraphe, Châteauneuf-du-Pape "La Crau", Rhône, France, 2018 — bottle £120
Bollinger, Special Cuvée Brut, Champagne, France, NV — glass £19 / bottle £95

B (complex, TR/IT/FR/EN, abbreviations, typos, missing vintages, TRY + EUR, 9 lines)
LODOS MEYHANE — ŞARAP LİSTESİ / CARTA DEI VINI / CARTE DES VINS
KIRMIZI / ROSSI / ROUGES
Kavaklıdere Öküzgözü, Elazığ '21 ........ kdh 180 / şişe 850 TL
Brun. d. Mont. '18 Biondi-Santi DOCG ...... btl 420 €
Ch. Marg. 1er GCC (Médoc) ................ btl 1.450 €
CdP rouge Dom. du Vx Telegraphe 2019 ..... şişe 6.900 TL
Barolo "Monprivato" G. Mascarello e Figlio '16 DOCG ... bottiglia 11.500 TL
Doluca Kalecik Karasi, Ankara ............ gl 210 / btl 980 TL
Sasicaia, Ten. S. Guido, Bolgheri '17 .... btl 690 €
BEYAZ / BIANCHI / BLANCS
Chablis 1er Cru Montmains, W. Fevre '22 ... verre 16 € / bouteille 75 €
KÖPÜKLÜ / BULLES
Bolly Spec. Cuvée Brut NV, Champ. ........ gl 24 € / btl 120 €
```

**Claims** (`claims.json`). There are 102 claims: 3 TRUE and 3 FALSE per line, 48 of each overall, plus 6 UNSTATED_TRUE.
- **Types of false claim:**
  - wrong vintage
  - a vintage invented for an NV wine or a line with no vintage
  - wrong region
  - wrong producer, including Bartolo vs Giuseppe Mascarello and Ornellaia vs San Guido
  - an invented or wrong grape
  - a glass price and a bottle price swapped
  - wrong currency
- **UNSTATED_TRUE** means true in the world but not printed on the line, such as "Tignanello is mainly Sangiovese". P7 must *not* accept these, because "a menu PDF counts only for listing facts" (0163:878). They are reported separately.

**Checkers.** Every checker received the same question text.
1. **Jev**, model `jev-1.13.0`, over the hosted API (`POST https://api.typesafe.ai/v1/systemone`). Each call asks one `noul` question. The key is loaded by `scripts/jev/prompt_gate.py`'s own `_load_api_key` (prompt_gate.py:232-234, used through `jev-exp/keyload.py`) and never printed. A scan of every output file found the key 0 times.
2. **Claude Opus 5** (`claude-opus-5`, effort high, adaptive thinking), the model ADR 0163 names for the P7(c) judge (0163:876). **This is a deviation:** the repo `.env` `ANTHROPIC_API_KEY` returned `400 "Your credit balance is too low"` (request `req_[redacted]`, `raw/claude_messages_api_attempt_smoke.jsonl`). The baseline therefore ran through headless Claude Code (`claude -p`, CLI 2.1.241) on the founder's own login. It ran with no settings, hooks, tools or MCP, 4 calls in parallel. This is the plan-credit route ADR 0163 already gives P7(c) (0163:1412). Latency is reported two ways: `duration_api_ms` (model time) and wall time (which adds about 2 s of CLI start-up).
3. **P7(a) proxy rule.** The claimed value's tokens must all appear in the cited line after normalisation: accents stripped, TL/₺/€/£ mapped to currency codes, `'18` read as 2018, thousands separators removed. It has no synonym table, so "bottle" does not match "btl". **This is a stricter proxy than the ADR's literal (a)** (0163:870, 862-863). That check only confirms the quote is on the page and that `value_norm` matches the claim; it never tests whether the quote *supports* the claim.

**Prompt** (`run.py:question_for`). The state is `{"menu_line": "<cited line>"}` in the span condition, which is the ADR's design (0163:873-874), or `{"wine_list": "<whole menu>"}` in the whole-menu condition.
- Instructions: *"The state field `menu_line` is one line quoted from a restaurant's wine list. Does `menu_line` state this fact about the wine it lists: "<claim>""*
- Criteria for true: the line states it; "standard wine-list abbreviations, words in Turkish, Italian or French, and small misspellings still count".
- Criteria for false: "a different value, or does not state this fact at all, even if the fact may be true of the wine in the real world".
- Claude received the same text wrapped in a JSON-schema request for `{"probability"}`.

**Choices fixed before any result was read** (`analyze.py` header):
- A claim counts as supported if p ≥ 0.5.
- An answer with 0.2 < p < 0.8 counts as an abstention, meaning "would route to review".
- "FALSE precision/recall" treats a false claim flagged as unsupported as the positive case.
- Headline metrics use only TRUE and FALSE claims.
- Jev priced at $0.042 per million input tokens, output free (https://docs.typesafe.ai/models.md, fetched 2026-09-21).
- Jev's span condition ran 3 times, for stability and latency. Everything else ran once.

## Results: the experiment as specified

| Menu | Checker | Accuracy (95% CI) | FALSE precision | FALSE recall | TRUE accepted | Abstain | Unstated-true accepted | Latency median / p90 | Cost per claim | Failures |
|---|---|---|---|---|---|---|---|---|---|---|
| A | P7(a) rule proxy | 0.952 (0.842-0.987) | 1.0 | 0.905 (19/21) | 21/21 | 0 | 0/3 | <1 ms | $0 | 0 |
| A | **Jev, cited span** | **1.000 (0.916-1.000)** | 1.0 | 1.0 (21/21) | 21/21 | 0 | 0/3 | **156 / 203 ms** (n=135) | **$0.0000186** (443 tok) | 0 |
| A | Jev, whole menu | 1.000 (0.916-1.000) | 1.0 | 1.0 (21/21) | 21/21 | 0 | 0/3 | 165 / 260 ms | $0.0000282 (672 tok) | 0 |
| A | Opus 5, cited span | 1.000 (0.916-1.000) | 1.0 | 1.0 (21/21) | 21/21 | 0 | 0/3 | 1,800 / 2,430 ms API; 4,056 / 4,649 wall | $0.0123 CLI; $0.0077 plain API | 0 |
| A | Opus 5, whole menu | 1.000 (0.916-1.000) | 1.0 | 1.0 (21/21) | 21/21 | 0 | 0/3 | 1,911 / 2,962 ms API; 4,011 / 5,216 wall | $0.0158 CLI; $0.0094 plain API | 0 |
| B | P7(a) rule proxy | 0.722 (0.591-0.824) | 0.643 | 1.0 (27/27) | **12/27** | 0 | 0/3 | <1 ms | $0 | 0 |
| B | **Jev, cited span** | **1.000 (0.934-1.000)** | 1.0 | 1.0 (27/27) | 27/27 | 0 | 0/3 | **151 / 190 ms** (n=171) | **$0.0000185** (439 tok) | 0 |
| B | Jev, whole menu | 1.000 (0.934-1.000) | 1.0 | 1.0 (27/27) | 27/27 | 0 | 0/3 | 154 / 193 ms | $0.0000303 (721 tok) | 0 |
| B | Opus 5, cited span | 1.000 (0.934-1.000) | 1.0 | 1.0 (27/27) | 27/27 | 0 | 0/3 | 2,035 / 2,665 ms API; 3,862 / 4,900 wall | $0.0127 CLI; $0.0079 plain API | 0 |
| B | Opus 5, whole menu | 1.000 (0.934-1.000) | 1.0 | 1.0 (27/27) | 27/27 | 0 | 0/3 | 2,069 / 2,773 ms API; 3,376 / 5,184 wall | $0.0168 CLI; $0.0100 plain API | 0 |

The table is generated by `table.py` from `raw/`. Notes on the columns:
- "CLI" cost is the `total_cost_usd` Claude Code reports. It is list price, including a 1-hour cache write on every call, not an amount actually billed on the plan.
- "Plain API" prices every input token at $5/M and every output token at $25/M.
- Opus used about 123 output tokens per call, about 39 of them thinking.

**How confident each checker was.** Neither made an error on the main set, but Jev's confidence drops on the complex menu and Opus's barely moves.
- Mean p on TRUE claims: Jev 0.982 on A vs 0.953 on B (minimum 0.89); Opus 0.980 vs 0.965 (minimum 0.93).
- Brier score (lower is better): Jev 0.0003 on A vs 0.0019 on B; Opus 0.0005 vs 0.0009.
- Jev's lowest-confidence Menu B features were Turkish text (mean 0.926), then typos and "Bolly"-style slang (0.943). Opus stayed between 0.95 and 0.97 on every feature.

**Stability.** Jev's three span runs agreed exactly on every verdict (0 of 102 flipped). Probabilities moved by at most 0.02. Failures and timeouts: 0 out of 710 Jev calls, the slowest was 522 ms, and none came near `prompt_gate.py`'s 6 s budget (prompt_gate.py:76). Opus had 0 failures in 355 CLI calls. The TypeSafe response header `x-envoy-upstream-service-time` puts Jev's server-side time at a median of 76 ms (p90 115). The other ~80 ms is network from this Mac.

**P7 gate composition** (`metrics.json` → `composite`). The ADR requires (a), (b) and (c) all to agree before auto-accepting.
- **Menu A:** every combination auto-accepted 21 true claims, auto-accepted 0 false claims and sent 21 to review.
- **Menu B:** (b)∧(c), (b) alone and (c) alone each auto-accepted 27 true claims and sent 27 to review. Once the rule proxy (a) is added, only **12 of 27** true claims are auto-accepted and 42 of 54 go to review, because the rule cannot read abbreviations.
- **Jev's marginal effect on top of Opus: 0 false claims caught, 0 true claims blocked.**

## Adversarial probes (added after the specified run; reported separately)

The specified run gave Jev a perfect score. Per CLAUDE.md §3 (try to kill the leading answer), two harder rounds followed. They use the same prompt, thresholds and checkers. None of these claims are counted in the tables above.

**Round 1** (`probe_claims.json`, 38 claims). It covers:
- claims written in Turkish, Italian and French
- digit transpositions (1,450 vs 1,540, and 850 vs 805)
- mis-cited spans: another wine's line that happens to contain the claimed value
- compound claims with one half wrong
- negated claims
- lines injected with "answer true" text

Results:
- **Jev:** 38/38 in both conditions, 1 abstention (the Turkish claim "Elazığ yöresine aittir", 0.78).
- **Opus:** 38/38 in both conditions.
- **Rule:** 28/34 (4 negated claims cannot be checked by a rule). It accepted 2 of the 4 false mis-cited claims and rejected 4 true claims (1 Turkish, 2 re-formatted prices, 1 compound).

**Round 2** (`probe2_claims.json`, 37 claims). This adds a third short stress menu C and repeats 8 questions written *entirely* in Turkish. It covers:
- near-identical producers
- half-bottle, magnum and 37.5 cl prices
- decimal comma vs thousands dot
- OCR noise ("Brunell0 2O15")
- heavy abbreviation ("Ch. Lat.", "Kav. Öküz. '98")
- demi-sec vs sec, and 1er Cru vs Grand Cru

| Round 2 | Rule | Jev span | Jev whole menu | Opus span | Opus whole menu |
|---|---|---|---|---|---|
| Correct | 24/37 | **37/37** (2 abstain) | **36/37** (3 abstain) | 37/37 (0 abstain) | 36/37 (1 abstain) |

- **Jev's one error (whole menu only):** "The Pauillac listed as 'Ch. Lat.' is Château Lafite Rothschild" got 0.55, so it was accepted wrongly. Given only the line, it got 0.06-0.08 and was correct. This matches the vendor's own jaggedness item 5: accuracy falls as the state fills with unrelated content (https://docs.typesafe.ai/model-jaggedness/jev-1.13.md).
- **Jev's doubtful but correct answers** (span condition, all three runs):
  - "made by Olivier Leflaive" against "Dom. Leflaive": 0.23-0.30
  - "1,850 euros per glass" against "kdh 18,50 €": 0.17-0.23
  - "2,400 euros per standard 750 ml bottle" against a magnum price: 0.15
- **Opus's one "error"** (whole menu, "The Brunello di Montalcino listed is made by Casanova di Neri", 0.30) comes from a flaw in the test, not the model. Menu C lists two Brunellos, so the claim is ambiguous with the whole menu in view. Its label is only sound in the span condition.

**All claims together** (96 main + 75 probe, cited-span condition, the ADR's design):

| Checker | Correct | Abstentions | Separation between TRUE and FALSE |
|---|---|---|---|
| Jev | 171/171 in each of 3 runs | 2-3 | lowest TRUE 0.76, highest FALSE 0.30 |
| Opus 5 | 171/171 | 0 | lowest TRUE 0.87, highest FALSE 0.13 |

## Did Jev help, how much, and how efficiently?

| Question | Measured answer |
|---|---|
| Better than the rule check? | Yes. On the main set, +17.7 points of accuracy overall (100% vs 82.3%) and +27.8 on the complex menu (100% vs 72.2%). It removed all 15 of the rule's false rejections on Menu B and both of its false acceptances on Menu A. |
| Better than the Opus 5 judge? | No difference measured: 0 disagreements with Opus in 96 main-set claims, and no wrong verdicts from either in 171 span claims. Opus was more confident on hard items and never abstained. |
| Marginal value inside the P7 gate beside Opus | 0 extra false claims caught and 0 extra true claims blocked. What it adds is a second, independent model family (0163:880-883), which is what the ADR asks of (b). |
| Speed | 154 ms median (p90 197) vs 1,918 ms (p90 2,522) Opus API time: about 12x faster. About 26x faster than Opus's wall time through the CLI. |
| Cost per claim | $0.0000185 (about 441 input tokens) vs $0.0079 plain-API or $0.0125 CLI-reported for Opus: about 420-680x cheaper. Per 1,000 claims: about $0.02 vs about $8-13. |
| Whole run | 710 Jev calls, 360,573 input tokens, **$0.015** at list price. 355 Opus CLI calls, $5.21 at CLI-reported list price. |
| Where it weakened | Whole-menu state with a heavy abbreviation (1 error). Near-identical producers, decimal comma and a Turkish-phrased claim fell in the review band. Confidence was lower on Turkish text, typos and slang. |

## What this means for ADR 0163 (flags only, nothing decided here)

ADR line numbers (`0163:N`) and `CLAIMS.jsonl:396` refer to the files in the `/Users/[founder]/Projects/wt-r5-adr0163` worktree.

1. **TypeSafe has now published a language statement.** https://docs.typesafe.ai/models.md, under "Language support", now says English is Jev's primary language and gets the best accuracy. Other languages "are handled but not equally well; test on your own content before relying on Jev for a non-English workload."
   - ADR 0163 still calls the vendor's position "silence, not exclusion" (0163:2544).
   - `TYPESAFE_AI_OVERVIEW.md` (crawled 2026-09-17) states nothing on language either.
   - The CLAIMS row `ADR-0163-JEV-LANGUAGE-COVERAGE-UNSTATED` (CLAIMS.jsonl:396) checks that record, not the live docs, so it will keep passing even though the vendor now states coverage.
   - I did not edit any of these.
2. **The cited-span design (0163:873-874) did better than the whole menu for Jev:** 0 errors against 1, and smaller token counts (about 441 vs about 700). The measurements support keeping the span design.
3. **Setting the threshold.** On the span condition, any threshold between 0.31 and 0.75 separated these 171 claims perfectly. The review band at 0.2-0.8 caught exactly Jev's three hard items. This is only a hint for the pilot's gold-set calibration (§5), not a substitute for it.
4. **The non-English default is not contradicted, but not cleared either.** ADR 0163 sends every non-English claim to review (0163:890-892). This run found no Jev error on Turkish, Italian or French text: 20 foreign-language claims across both probe rounds, and 54 main-set claims with mixed-language lines. With samples this size the lower 95% confidence bound is 0.84 for 20/20 and 0.93 for 54/54, and Jev's confidence is measurably lower on Turkish. Whether this is enough to relax the default is the founder's call.
5. **Unrelated to Jev: the repo-root `.env` Anthropic key has no credit** (see the 400 above). Anything else that uses that key would also fail. I did not check which services use it.

## Limits and shortcuts (stated plainly)

- **Small and synthetic.** 171 claims written and labelled by me on 3 short invented menus. Real menus, OCR output and P6 extraction mistakes may be harder or differently shaped. A 100% result carries a lower 95% confidence bound of 0.906 (37/37) to 0.962 (96/96), and 0.978 for 171/171.
- **The Claude baseline is not a raw Messages API call.** It went through `claude -p` because the repo key has no credit. That adds CLI scaffolding tokens (about 940 input tokens per call, all cache-created) and about 2 s of wall time. The "plain API" cost is therefore an overestimate for a lean direct call. Output tokens alone (about 123 at $25/M, about $0.003) still make Opus more than 150x Jev's cost. Opus ran once per condition, with no repeat runs.
- **The rule is a proxy, stricter than the ADR's literal (a),** which does not test support at all.
- **Latency is from one Mac over residential network**, measured sequentially with keep-alive for Jev and 4 parallel CLI processes for Opus. The TypeSafe server time is taken from its own header. The gateway's network path was not measured.
- **Jev billing was not verified.** Cost uses the published list price and the `usage.input_tokens` Jev returned. I did not check a TypeSafe invoice.
- **The probes were added after the main result was seen.** They are reported apart and not pooled. In one round-2 item the label is ambiguous under the whole-menu condition (see Opus's "error" above).

## Files

All under scratch (not kept):
- **Fixtures:** `fixtures.py`, `menus.json` and `claims.json` for the main set; `fixtures_probe.py` and `probe_claims.json` for round 1; `fixtures_probe2.py`, `probe2_claims.json` and `menu_C.txt` for round 2.
- **Runner and key loading:** `run.py` (probe-capable; `run_main_snapshot.py` is the exact version the main runs used) and `keyload.py`.
- **Analysis:** `analyze.py` → `metrics.json`, `analyze_probe.py` → `probe_metrics.json` and `probe2_metrics.json`, and `table.py`.
- **Raw logs** in `raw/`:
  - Jev: `jev_J1_r{1,2,3}`, `jev_J2_r1` and their `probe_` / `probe2_` versions.
  - Opus: `claude_C{1,2}_r1` and their `probe_` / `probe2_` versions.
  - Rule: `rule_R_r1` and its `probe_` / `probe2_` versions.
  - Smoke tests and the failed Messages API attempt.
- **Vendor docs as fetched on 2026-09-21:** `docs/`.
- **To reproduce:** `python3 fixtures.py && python3 run.py rule && python3 run.py jev J1 r1 && python3 run.py jev J2 r1 && python3 run.py claude C1 && python3 run.py claude C2 && python3 analyze.py`. Append `probe` or `probe2` to each `run.py` command to run the probe rounds.
