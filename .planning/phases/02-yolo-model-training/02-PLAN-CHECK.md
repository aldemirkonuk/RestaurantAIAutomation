# Phase 2 Plan Check — YOLO Model Training

**Checked:** 2026-03-31
**Plans:** 02-01-PLAN.md (Train YOLOv8s), 02-02-PLAN.md (Evaluate and generate report)
**Verdict:** PASS with warnings

---

## Summary

Both plans are structurally sound, correctly wired, and will achieve the phase goal. All six YOLO requirements are covered. The critical correctness concerns raised in the checklist are all handled correctly. Two warnings are raised — neither is blocking.

---

## Dimension 1: Requirement Coverage

Phase 2 requirements from ROADMAP.md: YOLO-01, YOLO-02, YOLO-03, YOLO-04, YOLO-05, YOLO-06

| Requirement | Description | Covered By | Status |
|-------------|-------------|------------|--------|
| YOLO-01 | YOLOv8s fine-tuned on 13-class dataset | 02-01 | COVERED |
| YOLO-02 | mAP50 >= 0.95 for wine_entry | 02-01, 02-02 | COVERED |
| YOLO-03 | mAP50 >= 0.90 for section_header | 02-01, 02-02 | COVERED (AT RISK documented) |
| YOLO-04 | CPU inference < 5s | 02-02 | COVERED |
| YOLO-05 | Weights saved with reproducible config | 02-01 | COVERED |
| YOLO-06 | Per-class mAP report for all 13 classes | 02-02 | COVERED |

Result: PASS — all 6 requirements have covering tasks.

---

## Dimension 2: Task Completeness

### Plan 02-01

| Task | Files | Action | Verify | Done |
|------|-------|--------|--------|------|
| Task 1: Write train_model.py | Yes | Yes (detailed) | Yes | Yes |
| Task 2: Run training | Yes | Yes (detailed) | Yes | Yes |

Both tasks have all required fields. Actions are specific, not vague. Verify commands are concrete and runnable. Done criteria are measurable.

Result: PASS

### Plan 02-02

| Task | Files | Action | Verify | Done |
|------|-------|--------|--------|------|
| Task 1: Write eval_model.py | Yes | Yes (detailed) | Yes | Yes |
| Task 2: Run evaluation | Yes | Yes (detailed) | Yes | Yes |

All required fields present. Verify commands are concrete Python assertions.

Result: PASS

---

## Dimension 3: Dependency Correctness

- 02-01: `depends_on: []` — Wave 1. Correct (no upstream plans in Phase 2).
- 02-02: `depends_on: [02-01]` — Wave 2. Correct (needs best.pt from 02-01).

No circular dependencies. No missing references. Wave assignments are consistent with dependency graph.

Result: PASS

---

## Dimension 4: Key Links Planned

### 02-01 key_links

- `data.yaml -> YOLO.train() via data= argument` — Task 1 action explicitly codes `DATA_YAML = PROJECT_ROOT / "datasets/wine_menus/data.yaml"` and passes it as `"data": str(DATA_YAML)`. WIRED.
- `train_model.py -> runs/train/weights/best.pt via ultralytics auto-save` — Task 2 action documents the actual output path including the `weights/` subdirectory, and the `project=` + `name=` pattern is in TRAIN_CONFIG. WIRED.

### 02-02 key_links

- `best.pt -> YOLO.val() via model.val()` — Task 1 action codes `BEST_PT = RUNS_DIR / "train" / "weights" / "best.pt"` and calls `model.val(data=str(DATA_YAML), split="val")`. WIRED.
- `val() results -> eval_report.md via results.box.maps` — Task 1 action explicitly uses `val_results.box.maps` to build the 13-row table. WIRED.
- `best.pt -> inference timing via perf_counter` — Task 1 action codes the warm-up + timed predict block with 2352x1076 dummy image. WIRED.

Result: PASS

---

## Dimension 5: Scope Sanity

| Plan | Tasks | Files Modified | Wave |
|------|-------|----------------|------|
| 02-01 | 2 | 3 | 1 |
| 02-02 | 2 | 2 | 2 |

Both plans are well within the 2-3 task / 5-8 file targets. The long-running step (100-epoch CPU training) is a single task with a clear run command. No scope issues.

Result: PASS

---

## Dimension 6: Verification Derivation (must_haves)

### 02-01 must_haves

Truths:
- "YOLOv8s model trains on the 13-class dataset to completion" — user-observable, testable via results.csv.
- "Training uses DATA-05 augmentation hyperparameters" — verifiable from training_config.json.
- "best.pt exists and loads without error" — concrete, testable.
- "Training config saved as JSON for reproducibility" — concrete, testable.

Artifacts: train_model.py, best.pt, training_config.json — all map directly to truths.

Key_links: data.yaml->train() and train()->best.pt are specific with pattern regexes.

Result: PASS — truths are user-observable (or operator-observable) and testable.

### 02-02 must_haves

Truths:
- Per-class mAP50 table for all 13 classes — user-observable, verifiable by reading eval_report.md.
- wine_entry mAP50 with explicit PASS/FAIL — concrete verdict.
- section_header evaluated on test set with AT RISK annotation — handles the val=0 edge case correctly.
- CPU inference time with PASS/FAIL — directly testable.
- Section header imbalance documented — auditable.

Artifacts: eval_model.py and eval_report.md map to all truths.

Key_links: all three wiring paths (best.pt->val(), val()->report, best.pt->timing) are specific and coded.

Result: PASS

---

## Dimension 7: Context Compliance

No CONTEXT.md was provided for Phase 2 (no /gsd:discuss-phase session recorded). No locked decisions to check.

Result: SKIPPED (no CONTEXT.md)

---

## Dimension 8: Nyquist Compliance

No VALIDATION.md or RESEARCH.md exists in the 02-yolo-model-training phase directory (only 02-01-PLAN.md and 02-02-PLAN.md are present). No Nyquist validation architecture was defined for this phase.

Result: SKIPPED (no RESEARCH.md or VALIDATION.md for Phase 2)

---

## Dimension 9: Cross-Plan Data Contracts

The shared data path across plans is:

```
02-01 produces: datasets/wine_menus/runs/train/weights/best.pt
02-02 consumes: datasets/wine_menus/runs/train/weights/best.pt
```

The path is identical in both plans:
- 02-01, Task 2 action: `RUNS_DIR / "train" / "weights" / "best.pt"` (explicitly documented)
- 02-02, Task 1 action: `BEST_PT = RUNS_DIR / "train" / "weights" / "best.pt"` (hardcoded in script template)
- 02-02, key_links frontmatter: `datasets/wine_menus/runs/train/weights/best.pt`

No conflicting transforms. 02-01 produces the file; 02-02 reads it read-only via YOLO().

The secondary contract — training_config.json path — is also consistent:
- 02-01: `RUNS_DIR / "train" / "training_config.json"`
- 02-02, Task 2 read_first: `datasets/wine_menus/runs/train/training_config.json`

Result: PASS

---

## Dimension 10: CLAUDE.md Compliance

No CLAUDE.md found at the project root.

Result: SKIPPED (no CLAUDE.md)

---

## Checklist Responses (from verification prompt)

**1. Does 02-01 correctly build the absolute path to data.yaml?**
YES. Task 1 action explicitly uses:
```python
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_YAML    = PROJECT_ROOT / "datasets/wine_menus/data.yaml"
```
This resolves the path from the script file's own location, not from cwd. The `data=` argument receives the absolute string path. The context note about ultralytics resolving `path: wine_menus` relative to the yaml file directory is documented in the plan's context block. Correct.

**2. Does 02-02 handle the section_header AT RISK case (0 val instances) correctly?**
YES. The plan:
- Hardcodes "N/A (0 val instances)" in the val mAP50 column for section_header — does not show zero or blank.
- Runs a separate `model.val(split="test")` call to get the 3-instance test-set mAP.
- Guards for None returns: `while len(test_maps) < NC: test_maps.append(None)`.
- Uses three-way verdict: PASS / FAIL / INSUFFICIENT DATA based on whether the value is None.
- Documents "16 train / 0 val / 3 test, 125:1 ratio" in the report prose.

**3. Are the DATA-05 augmentation parameters in the training call?**
YES. TRAIN_CONFIG in 02-01 Task 1 action contains exactly:
```python
"fliplr": 0.5,
"degrees": 10,
"hsv_v": 0.4,
"mosaic": 1.0,
```
These match dataset_stats.json `data_augmentation.hyperparameters` exactly. All four parameters are present.

**4. Does 02-02 write eval_report.md with all 13 class names in the mAP table?**
YES. The script uses CLASS_NAMES (a 13-element list matching data.yaml order) to build the table. The plan's final verification block explicitly checks all 13 names:
```python
classes = ['wine_entry','section_header','wine_name','producer','vintage',
           'price','grape_variety','origin_info','description','serving_type',
           'rating','classification','bottle_info']
missing = [c for c in classes if c not in text]
assert not missing, ...
```

**5. Is the best.pt path consistent across both plans?**
YES. Both plans reference `datasets/wine_menus/runs/train/weights/best.pt` (with the `weights/` subdirectory). 02-01 Task 2 documents the ultralytics default layout and explicitly corrects the frontmatter (which erroneously showed `runs/train/best.pt` without `weights/`). See warning W-01 below.

**6. Are acceptance criteria testable with concrete bash/python commands?**
YES. Every task has a `<verify>` block with a runnable Python one-liner or multi-line assertion. The plan-level `<verification>` sections also provide standalone commands. All assertions check file existence and content — none rely on subjective evaluation.

---

## Warnings

### W-01 (warning): Frontmatter artifact path differs from task body for best.pt

**Plan:** 02-01
**Location:** frontmatter `files_modified` line 9 and `must_haves.artifacts[1].path`

The frontmatter lists:
```yaml
files_modified:
  - datasets/wine_menus/runs/train/best.pt   # missing weights/ subdirectory
must_haves:
  artifacts:
    - path: "datasets/wine_menus/runs/train/best.pt"   # same error
```

But the task body (Task 2 action and verify), the plan-level verification block, and 02-02's key_links all correctly use:
```
datasets/wine_menus/runs/train/weights/best.pt
```

The frontmatter discrepancy will not cause execution failure (the executor follows task body instructions, not frontmatter paths), but it creates confusion for any tooling that reads frontmatter to locate artifacts post-execution.

**Fix:** Update frontmatter in 02-01 to:
```yaml
files_modified:
  - datasets/wine_menus/runs/train/weights/best.pt
must_haves:
  artifacts:
    - path: "datasets/wine_menus/runs/train/weights/best.pt"
```

### W-02 (warning): ROADMAP.md success criterion 3 says "val set" for section_header but val has 0 instances

**Location:** ROADMAP.md Phase 2 success criterion 3:
> "Validation mAP50 >= 0.90 for class 1 (section_header) in eval report"

The plans correctly use the test set for section_header mAP (0 val instances make val mAP undefined), which is the right technical approach. However, the roadmap success criterion says "validation" — the eval_report.md will show test-set mAP for that class, not val-set. The report documents why with clear AT RISK / INSUFFICIENT DATA language.

This is a documentation gap in the roadmap, not a plan defect. The plans handle reality correctly. Reviewers reading ROADMAP.md to evaluate Phase 2 success should be aware the criterion wording does not match the technically achievable evaluation.

**Fix (optional):** Update ROADMAP.md criterion 3 to:
> "mAP50 >= 0.90 for class 1 (section_header) measured on test set (AT RISK — 0 val instances; 3 test instances)"

This is cosmetic only. Execution can proceed with the plans as written.

---

## Overall Result

**PASS** — Plans are executable and will achieve the phase goal.

All 6 YOLO requirements are covered. Both plans have complete task structure (files, action, verify, done). Dependencies are correct and acyclic. Key links are wired with specific code patterns. Scope is within budget (2 tasks each). The critical correctness concerns (absolute data.yaml path, section_header AT RISK handling, augmentation params, 13-class report, consistent best.pt path, testable acceptance criteria) are all correctly addressed.

W-01 (frontmatter path mismatch) should be fixed before execution to prevent confusion but will not cause plan failure. W-02 is a roadmap documentation note only.

---

*Plan check performed: 2026-03-31*
