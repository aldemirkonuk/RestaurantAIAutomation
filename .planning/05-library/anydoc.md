---
type: reference
name: anydoc
category: ingestion
url: https://github.com/firecrawl/anydoc
status: candidate
decision: OD-06
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[OPEN-DECISIONS]]", "[[unlimited-ocr]]"]
---

# anydoc (firecrawl/anydoc)

## What it is

Verified 2026-08-24 against the repository and its README.

- Rust library that converts office documents to GitHub-Flavored Markdown. MIT. Bindings
  for Node.js (`@firecrawl/anydoc`), Python (`firecrawl-anydoc`), Rust (`anydoc`), and
  browser WASM (`@firecrawl/anydoc-wasm`). Also ships a CLI and an Agent Skill.
- **Supported formats, as listed in the README:** Word (`.doc/.docx/.docm`), PowerPoint
  (`.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm`), Excel (`.xls/.xlsx/.xlsm/.xlsb`),
  OpenDocument (`.odt/.ods/.odp`), RTF, EPUB, CSV, PDF. That is **8 format families /
  14 extensions-classes**; the project's own benchmark scores itself "14/14 formats".
  The often-repeated "14 formats" figure comes from the benchmark axis, not from a
  14-row format table — worth stating precisely so the number is not re-derived wrong.
- **No ML, no network.** Pure Rust; README claims median conversion under 5ms. Text-based
  PDFs are handled locally via `pdf-inspector`.
- **It does not OCR.** Scanned pages are explicitly out of scope — the README points at
  the hosted Firecrawl Parse API for those.

## Why it might matter here specifically

`apps/api-gateway/src/procurement/documents/document-extractor.service.ts` is the current
document path. It accepts exactly five media types (`document-extractor.service.ts:59-64`):
`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf` — and sends the
bytes to Anthropic (`claude-haiku-4-5` by default, `:72-77`) as a single vision/document
block with a JSON-only extraction prompt.

Consequences worth naming:

1. A vendor who emails an **`.xlsx` price list or a `.docx` invoice** — routine in
   beverage distribution — has no path through this service at all. anydoc would give one
   without an LLM call.
2. Every PDF, including clean digital ones, currently costs a model call. anydoc converts
   digital PDFs locally, which would leave the model to do only the *understanding* step
   on already-clean Markdown, or nothing at all for structured inputs.
3. anydoc is **not** a replacement for the vision path on **photographed or scanned**
   invoices, which is the other half of the intake. Any bake-off that treats it as one
   will produce a misleading result.

## What adopting it would cost

- One dependency in `apps/api-gateway` (`@firecrawl/anydoc`, prebuilt native binary per
  platform) plus a format-detection branch ahead of the existing media-type switch.
- A second prompt path: extraction from Markdown text is a different prompt from
  extraction from an image, so `SYSTEM_PROMPT` in the extractor forks.
- Native binary in the deploy image — needs checking against the current runtime target.
- Ongoing: two ingestion routes to keep correct instead of one.

## What decision it bears on

**OD-06** — AnyDoc adoption for digital-document parsing vs the current Claude Vision path.
Open. Nothing here adopts it. The bake-off OD-06 calls for should be scoped to *digital*
documents; scanned images are a separate axis and belong with [[unlimited-ocr]].

## Status

`candidate` — verified to exist and to do what is claimed; not adopted.
