---
type: reference
name: Unlimited-OCR
category: ingestion
url: https://github.com/baidu/Unlimited-OCR
status: candidate
decision: OD-06
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[OPEN-DECISIONS]]", "[[anydoc]]"]
---

# Unlimited-OCR (baidu/Unlimited-OCR)

## What it is

Verified 2026-08-24 against the repository README and GitHub metadata.

- An **open-weights OCR / document-parsing vision model** from Baidu, MIT-licensed, with
  weights on Hugging Face (`baidu/Unlimited-OCR`) and ModelScope. Paper:
  [arXiv:2606.23050](https://arxiv.org/abs/2606.23050).
- Positioned by its authors as pushing `deepseek-ai/DeepSeek-OCR` further, aimed at
  **long-horizon / multi-page parsing in one shot** (`model.infer_multi` takes a list of
  page images; `max_length=32768`).
- Runs through HuggingFace `transformers` or vLLM. The README's tested configuration is
  Python 3.12 + CUDA 12.9 + `torch==2.10.0`, i.e. **an NVIDIA GPU is assumed**.
- Also offered as a hosted Baidu Cloud OCR endpoint, which is a different adoption shape
  from self-hosting.

## Why it might matter here specifically

This is the half of document intake that [[anydoc]] explicitly does not cover: photographed
and scanned paper. Today that path is
`apps/api-gateway/src/procurement/documents/document-extractor.service.ts` sending the
image straight to Anthropic — one model call per page, no local fallback, and no
functioning path when `ANTHROPIC_API_KEY` is absent (`document-extractor.service.ts:79-93`
makes availability strictly conditional on that key).

The multi-page angle is the relevant one: a delivery packet is frequently several pages
that must be read **as one document** (invoice + packing slip + credit note), which is
precisely the case the model advertises.

## What adopting it would cost

This is the expensive candidate in the library, and the cost is not incremental:

- **GPU hosting.** Nothing in this repo currently serves a self-hosted model. Adopting it
  means a new inference surface, its own deploy target, and its own uptime story — versus
  today's stateless HTTP call to Anthropic.
- Python service boundary. `services/agent-orchestrator` is Python, so there is somewhere
  to put it, but that service is a RabbitMQ consumer, not a model server.
- Accuracy has **not** been measured on this project's corpus. The paper's benchmarks are
  not evidence about beverage invoices in the founder's actual vendor mix.
- Alternative with far lower cost: the hosted Baidu Cloud endpoint — but that swaps one
  third-party dependency for another and adds a second data-processor for compliance.

## What decision it bears on

**OD-06**, on the scanned/photographed axis. Also touches **OD-04** (external model
roster) if a self-hosted model becomes part of the routing story at all.

## Status

`candidate` — verified to exist, MIT, GPU-dependent. Not adopted, and the hosting cost is
the reason it should not be adopted casually.
