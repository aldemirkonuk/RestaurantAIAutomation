/**
 * Build provenance for the web bundle — which commit was THIS build made from?
 *
 * WHY THIS EXISTS (ADR 0219)
 * --------------------------
 * On 2026-09-21 two production merges (#421, #424) were refused by Vercel's
 * deployment cap and mudavym.com kept serving #418's build for hours, and
 * nothing noticed: `.github/workflows/deploy.yml`'s web step checked only for
 * HTTP 200 and, with its secret unset, was skipped outright; no web code
 * embedded a commit id (`git grep` for `VERCEL_GIT_COMMIT_SHA` /
 * `VITE_(GIT|COMMIT|BUILD)` under apps/web found zero hits, measured
 * 2026-09-22 at origin/main 9cfc4e96d). A 200 proves *a* build is serving,
 * never WHICH ONE — the same fault ADR 0097 closed for the gateway
 * (apps/api-gateway/src/health/build-provenance.ts), one service over.
 *
 * MIRRORS THE GATEWAY, ADAPTED FOR A STATIC SPA
 * ----------------------------------------------
 * The gateway is a running process a client can ask at request time
 * (`/api/v1/health/live`). A built SPA has no server of its own to ask —
 * Vercel serves static files — so the commit is written into the HTML
 * ITSELF at build time (see `buildProvenancePlugin` below) and read back
 * with a plain `GET` by `scripts/check_web_deployed_sha.py`. Everything
 * else — the variable order, the "never empty, never omitted" rule for the
 * unknown case — is the same reasoning as the gateway's module, restated
 * here because a static build has no shared runtime to import it from.
 *
 * ORDER, AND WHY
 * ---------------
 *   1. VERCEL_GIT_COMMIT_SHA   — set by Vercel for a build connected to git
 *      (https://vercel.com/docs/environment-variables/system-environment-variables,
 *      read 2026-09-21). This is production today.
 *   2. RAILWAY_GIT_COMMIT_SHA  — the founder's named next home for this app
 *      (ADR 0219, founder verbatim: "I'll move every config to railway
 *      after all UI deployment is over"). Checked here so that move needs
 *      no change to this file — the same two-path shape the gateway already
 *      uses for exactly this reason.
 *   3. `git rev-parse HEAD`    — a build with neither platform variable set
 *      (a developer's machine, a from-scratch CI runner). Never trusted
 *      first: a platform variable names the exact revision the ARTIFACT was
 *      built from, while a git read in a CI checkout can answer for a
 *      working tree that has since moved on. Wrapped so it can never throw —
 *      it fails outside a git checkout on purpose (a packaged build step
 *      might run in an image with no `.git`), and that failure must fall
 *      through to step 4, not crash the build.
 *   4. UNKNOWN_COMMIT ("unknown") — never an empty string, never an omitted
 *      tag. A blank value reads as "nobody has looked yet"; "unknown" is a
 *      claim `check_web_deployed_sha.py` can act on and fail loudly against,
 *      which is the whole point — a check that accepts a fabricated-looking
 *      value certifies its own blindness (same rule, same wording, as the
 *      gateway's module).
 *
 * WHY apps/web/turbo.json EXISTS
 * ------------------------------
 * Vercel runs this build through `turbo run build --filter=@wineops/web`,
 * and turbo's task hash does not include an environment variable unless the
 * task declares it. Without the declaration, two commits with the same web
 * inputs share one hash, and the second build is a cache hit that replays
 * the first build's `dist/` — tag included — so the page names a commit that
 * is not the one deployed (a squash merge would name its PR's head commit,
 * which is not on main). apps/web/turbo.json declares both variables in the
 * build task's `env`, so every commit hashes differently and runs this
 * plugin. Measured 2026-09-22 with a scratch --cache-dir: without it, the
 * second of two builds was a cache hit carrying the first commit's tag.
 */

import { execFileSync } from 'node:child_process';
import type { HtmlTagDescriptor, Plugin } from 'vite';

/** The `<meta name="…">` this build writes into every served HTML shell. */
export const COMMIT_META_NAME = 'mudavym:commit';

/**
 * The literal reported when no build variable reached this build and no git
 * checkout was available to ask either. Exported so the check script and any
 * test of it cannot drift from this by retyping the string.
 */
export const UNKNOWN_COMMIT = 'unknown';

/** Checked in this order; the first non-blank value wins. */
const CANDIDATE_VARS = ['VERCEL_GIT_COMMIT_SHA', 'RAILWAY_GIT_COMMIT_SHA'] as const;

export type GitHeadReader = () => string | null;

/**
 * `git rev-parse HEAD` in `cwd`. Returns null on ANY failure — no `.git`, a
 * detached/corrupt checkout, `git` missing from PATH — rather than throwing,
 * because a build must still produce a page (carrying `UNKNOWN_COMMIT`)
 * instead of crashing over a provenance nicety.
 */
export function readGitHead(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Pure: given an environment map and a HEAD reader, which commit should this
 * build claim? Kept apart from `process.env`/`readGitHead` so a test can
 * drive every branch (including "git failed") without mutating the real
 * environment or needing a real checkout — see build-provenance.test.ts.
 */
export function resolveCommitSha(
  env: Record<string, string | undefined>,
  readHead: GitHeadReader,
): string {
  for (const name of CANDIDATE_VARS) {
    const raw = env[name];
    // A blank or whitespace-only variable is absent, not a build id: a
    // variable declared with an empty value must never be reported as an
    // identity.
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > 0) return value;
  }
  const head = readHead();
  if (head && head.trim().length > 0) return head.trim();
  return UNKNOWN_COMMIT;
}

/**
 * Vite plugin: writes `<meta name="mudavym:commit" content="…">` into every
 * HTML page this build produces.
 *
 * Uses `transformIndexHtml` with `injectTo: 'head'` (Vite's own tag-injection
 * API, not a string replace) so this never touches the `<!-- seo:head:start
 * -->…<!-- seo:head:end -->` block `apps/web/src/lib/seo/head.ts` owns —
 * `replaceHeadBlock` throws if those markers are missing or duplicated, and
 * this tag must never be mistaken for part of that block. `injectTo: 'head'`
 * places the tag immediately before `</head>`, after the marked block.
 *
 * Runs BEFORE `crawlSurface`'s `writeBundle` needs to matter, but not
 * because of plugin declaration order: Vite's own HTML processing (which
 * calls every plugin's `transformIndexHtml`) runs inside the bundle's
 * `generateBundle` phase and WRITES `dist/index.html` before ANY plugin's
 * `writeBundle` hook fires — `writeBundle` fires only after files are
 * already on disk (Rollup's own hook ordering). So `crawlSurface`, which
 * reads `dist/index.html` in `writeBundle` and derives every other crawl
 * file from that same text (vite-plugin.ts), always sees this tag already
 * in the shell — meaning the root `/`, every `crawl/heads/*.html`, the
 * closed `crawl/app.html`, and `404.html` all carry the SAME commit, because
 * they are all cut from the one shell this plugin wrote it into.
 */
export function buildProvenancePlugin(cwd: string = process.cwd()): Plugin {
  return {
    name: 'mudavym-build-provenance',
    transformIndexHtml(): HtmlTagDescriptor[] {
      const commit = resolveCommitSha(process.env, () => readGitHead(cwd));
      if (commit === UNKNOWN_COMMIT) {
        // Loud in the build log, not only in the payload — the same rule the
        // gateway's module keeps ("Loud in the logs as well as in the
        // payload"), so a build that cannot name itself is visible before
        // anyone has to go read the deploy check's failure to find out why.
        // (No eslint-disable here: the root config turns no-console off, and
        // `pnpm run lint` passes --report-unused-disable-directives, so a
        // disable comment would itself be the lint error.)
        console.warn(
          '[build-provenance] No build revision could be resolved — this build will ' +
            `serve <meta name="${COMMIT_META_NAME}" content="${UNKNOWN_COMMIT}">, and ` +
            'scripts/check_web_deployed_sha.py will fail loudly rather than certify a ' +
            'build nobody can identify. Set VERCEL_GIT_COMMIT_SHA or ' +
            'RAILWAY_GIT_COMMIT_SHA, or build from inside a git checkout.',
        );
      }
      return [
        {
          tag: 'meta',
          attrs: { name: COMMIT_META_NAME, content: commit },
          injectTo: 'head',
        },
      ];
    },
  };
}
