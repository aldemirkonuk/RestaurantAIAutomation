/**
 * Honest reporter (ADR 0135): turns the `nightly-check` annotations every test
 * pushes into ONE machine-readable summary plus a Markdown table, with the four
 * states counted separately. A test that ran no check at all is itself
 * recorded as `cannot_check` — a walk that recorded nothing must not look like
 * a walk that passed (absence-reported-as-health, instance 2 and 16).
 *
 * It also joins the founder's recorded design calls (design-verdicts.json,
 * generated from the ADR 0148 artifact snapshots) with each page's walked
 * state into `design_calls`: context printed beside the page, never counted
 * as a check and never able to pass or fail one.
 *
 * Output: <outputDir>/nightly-summary.json and nightly-summary.md.
 * scripts/e2e/nightly_summary.py merges this with the Python waves.
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

interface DesignCallRow {
  page: string
  walked: string
  calls: string[]
}

function designCalls(records: CheckRecord[]): DesignCallRow[] {
  let pages: Record<string, { source: string; kind: string; call?: string; at?: string; label?: string; state?: string; as_of?: string | null }[]> = {}
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'design-verdicts.json')
    pages = (JSON.parse(fs.readFileSync(file, 'utf8')) as { pages?: typeof pages }).pages ?? {}
  } catch {
    return []
  }
  const stateOf = (slug: string) => records.find((r) => r.id === `page.${slug}.next`)?.state ?? 'not walked'
  return Object.entries(pages).map(([page, calls]) => ({
    page,
    walked: stateOf(page),
    calls: calls.map((c) => (c.kind === 'verdict' ? `${c.call} (${c.source}, ${(c.at ?? '').slice(0, 10)})` : `${c.label} · ${c.state} (${c.source}, ${c.as_of ?? 'undated'})`)),
  }))
}

interface CheckRecord {
  id: string
  state: 'pass' | 'fail' | 'absent' | 'cannot_check'
  reason: string
  evidence?: Record<string, unknown>
  test?: string
}

export default class HonestReporter implements Reporter {
  private records: CheckRecord[] = []
  private tests: { title: string; status: string; durationMs: number; error?: string }[] = []
  private outDir = 'test-results/nightly'
  private startedAt = new Date().toISOString()

  onBegin(config: FullConfig): void {
    const project = config.projects[0]
    this.outDir = project?.outputDir ? path.join(path.dirname(project.outputDir), 'nightly') : this.outDir
    fs.mkdirSync(this.outDir, { recursive: true })
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = [...((result as unknown as { annotations?: TestCase['annotations'] }).annotations ?? []), ...test.annotations]
    const seen = new Set<string>()
    let recorded = 0
    for (const a of annotations) {
      if (a.type !== 'nightly-check' || !a.description) continue
      if (seen.has(a.description)) continue
      seen.add(a.description)
      try {
        const rec = JSON.parse(a.description) as CheckRecord
        rec.test = test.title
        this.records.push(rec)
        recorded += 1
      } catch {
        this.records.push({ id: 'reporter.parse', state: 'cannot_check', reason: 'a nightly-check annotation was not JSON', test: test.title })
      }
    }
    if (recorded === 0) {
      this.records.push({
        id: `test.${slug(test.title)}`,
        state: result.status === 'passed' ? 'cannot_check' : result.status === 'skipped' ? 'cannot_check' : 'fail',
        reason:
          result.status === 'passed'
            ? 'the test passed but recorded no check — a pass with nothing behind it is not a pass'
            : `the test ended ${result.status} before recording a check: ${firstLine(result.error?.message)}`,
        test: test.title,
      })
    }
    this.tests.push({ title: test.title, status: result.status, durationMs: result.duration, error: firstLine(result.error?.message) })
    // Screenshots attached with a body live only in memory unless a reporter
    // writes them; the nightly artifact must carry the evidence, not just the verdict.
    const shots = path.join(this.outDir, 'shots')
    for (const a of result.attachments) {
      if (a.body && a.contentType === 'image/png' && a.name.endsWith('.png')) {
        fs.mkdirSync(shots, { recursive: true })
        fs.writeFileSync(path.join(shots, a.name.replace(/[^a-z0-9_.-]/gi, '_')), a.body)
      }
    }
  }

  onEnd(result: FullResult): void {
    const counts = { pass: 0, fail: 0, absent: 0, cannot_check: 0 }
    for (const r of this.records) counts[r.state] += 1
    const verdict = counts.cannot_check > 0 ? 'cannot_check' : counts.fail > 0 ? 'fail' : counts.pass > 0 ? 'pass' : 'cannot_check'
    const summary = {
      suite: 'nightly-playwright',
      started_at: this.startedAt,
      finished_at: new Date().toISOString(),
      playwright_status: result.status,
      target: process.env.E2E_BASE_URL ?? '',
      api: process.env.E2E_API_URL ?? process.env.API_GATEWAY_URL ?? '',
      verdict,
      counts,
      checks: this.records,
      design_calls: designCalls(this.records),
      tests: this.tests,
    }
    fs.mkdirSync(this.outDir, { recursive: true })
    fs.writeFileSync(path.join(this.outDir, 'nightly-summary.json'), JSON.stringify(summary, null, 2))
    fs.writeFileSync(path.join(this.outDir, 'nightly-summary.md'), renderMarkdown(summary))
    console.log(`\n[nightly] verdict=${verdict} pass=${counts.pass} fail=${counts.fail} absent=${counts.absent} cannot_check=${counts.cannot_check} → ${this.outDir}/nightly-summary.md`)
  }
}

function renderMarkdown(s: { verdict: string; counts: Record<string, number>; target: string; api: string; checks: CheckRecord[]; design_calls: DesignCallRow[] }): string {
  const lines: string[] = []
  lines.push(`## Nightly — browser walk: **${s.verdict.toUpperCase()}**`)
  lines.push('')
  lines.push(`Target ${s.target || '(unset)'} · API ${s.api || '(unset)'}`)
  lines.push('')
  lines.push(`| pass | fail | absent | cannot_check |`)
  lines.push(`|---|---|---|---|`)
  lines.push(`| ${s.counts.pass} | ${s.counts.fail} | ${s.counts.absent} | ${s.counts.cannot_check} |`)
  lines.push('')
  lines.push('| check | state | reason |')
  lines.push('|---|---|---|')
  for (const r of s.checks) {
    lines.push(`| \`${cell(r.id)}\` | ${badge(r.state)} | ${cell(r.reason)} |`)
  }
  lines.push('')
  lines.push('_absent_ = not on this build (never a pass) · _cannot_check_ = the check did not run (never a pass).')
  if (s.design_calls.length) {
    lines.push('')
    lines.push("### Founder's recorded calls (context — not counted, never gating)")
    lines.push('')
    lines.push('| page | walked (override on) | recorded call |')
    lines.push('|---|---|---|')
    for (const d of s.design_calls) lines.push(`| \`${cell(d.page)}\` | ${badge(d.walked)} | ${cell(d.calls.join('; '))} |`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Make one string safe to sit in a Markdown table cell.
 *
 * Order matters and is the whole point: the backslash is escaped FIRST, because
 * it is the character doing the escaping. Escaping only `|` (which this did
 * until CodeQL's js/incomplete-sanitization flagged it on PR #349) leaves
 * `\|` in the input rendering as an escaped backslash followed by a LIVE pipe,
 * which ends the cell early and shifts every later column. Newlines end the
 * ROW, so they are folded to spaces. The text reaching here is page-derived —
 * sentences read out of the browser and gateway error messages — so it is not
 * ours to trust.
 */
function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function badge(state: string): string {
  return { pass: '✅ pass', fail: '❌ fail', absent: '⬜ absent', cannot_check: '🚫 cannot_check' }[state] ?? state
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function firstLine(s: string | undefined): string {
  return (s ?? '').split('\n')[0].slice(0, 300)
}
