export const meta = {
  name: 'fix-pr-audit-gate',
  description: 'ADR 0090 three-role audit (Opus plan, two Sonnet reviews, Opus final) for each analytics-fix PR, posting the SHA-stamped marker',
  phases: [
    { title: 'Bundle', detail: 'CI green + origin/main ownership classifier, before any model judgment' },
    { title: 'Plan', detail: 'pr-merge-planner (Opus)' },
    { title: 'Review', detail: 'pr-merge-auditor + pr-merge-adversary (Sonnet, parallel, independent)' },
    { title: 'Final', detail: 'pr-merge-planner final adjudication (Opus)' },
    { title: 'Post', detail: 'report file + marker comment' },
  ],
}

// args.prs: [{ n, lane, sha, wt }]
const REPO = '/Users/aldemirkonuk/Projects/restaurant-ai-automation'
const OUT = '/Users/aldemirkonuk/Projects/p4-scratch/sim-run/fixes/audits'

const BUNDLE = { type: 'object', properties: {
  proceed: { type: 'boolean' },
  ciGreen: { type: 'boolean' },
  ownershipExit: { type: 'number' },
  ownershipOutput: { type: 'string' },
  headMatches: { type: 'boolean' },
  bundlePath: { type: 'string' },
  why: { type: 'string' },
}, required: ['proceed', 'ciGreen', 'ownershipExit', 'ownershipOutput', 'headMatches', 'bundlePath', 'why'] }

const POSTED = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['PASS', 'BLOCK', 'NOT-RUN'] },
  commentUrl: { type: 'string' },
  reportPath: { type: 'string' },
  blockers: { type: 'string' },
}, required: ['verdict', 'commentUrl', 'reportPath', 'blockers'] }

const ctx = (p) => `PR #${p.n} (lane ${p.lane}) in the Mudavym repo; the audited head is EXACTLY ${p.sha}. Repo checkout for reading: ${p.wt} (the lane worktree; its HEAD should be ${p.sha}). Read ADRs and the decision index with \`git -C ${REPO} show origin/main:<path>\`, never from the checkout. The SHA-pinned bundle is at ${OUT}/${p.n}-${p.sha.slice(0, 9)}/ (diff.patch, checks.json, ownership.txt, pr.json). CI does not execute supabase/tests/*.sql; when the PR adds SQL, the coordinator's local Docker Postgres run (migrations from origin/main + the PR's, test on [fix] and on a [ctl] database without the PR's migration) is at ${OUT}/${p.n}-local-pg.txt — treat it as evidence to check, and you may re-run it read-only with \`bash /Users/aldemirkonuk/Projects/p4-scratch/sim-run/fixes/db/pgtest.sh lane ${p.wt} audit${p.n}\`.${p.prior && p.prior.verdict === 'BLOCK' ? `

AFTER A BLOCK. This PR was BLOCKED by this three-role audit at ${p.prior.sha}; that report is ${p.prior.report} — read its final adjudication and every blocker and owed note. Since then: ${p.prior.why}. A BLOCK at a SHA is permanent; this is a fresh audit of the new head, judged in full, not a diff review. Still, put weight on: (1) each blocker — is it actually fixed in code/records, with a test that fails at ${p.prior.sha.slice(0, 9)} and passes now where one was asked for (re-run it both ways if cheap); (2) whether the fix commits (\`git -C ${p.wt} log --oneline ${p.prior.sha}..${p.sha}\`) introduced anything new or any sentence broader than the code; (3) any commit main gained since that interacts with this PR. Re-run the PR's own tests at the new head.` : p.prior ? `

RE-AUDIT. This PR already PASSED this three-role audit at ${p.prior.sha}; that report is ${p.prior.report} — read it, including its owed notes. Since then the coordinator merged origin/main into the branch (${p.prior.why}). Judge the new head in full, but put your weight where the risk moved: (1) \`git -C ${p.wt} diff ${p.prior.sha} ${p.sha}\` — what main brought in and how each conflict was resolved; (2) whether any commit main gained since ${p.prior.sha.slice(0, 9)} interacts with this PR's files or claims (same tables, functions, routes, ADR rows, version constants, migration order); (3) that \`git diff origin/main...${p.sha}\` is the previously audited change and nothing new from the branch. Re-run the PR's own tests at the new head rather than trusting the earlier run.` : ''}`

const bundle = (p) => agent(`You prepare the evidence bundle for the ADR 0090 PR audit of PR #${p.n} at head ${p.sha}. Make no judgment of the code. Steps (exact commands, report exit codes):
1. \`gh pr view ${p.n} --json number,headRefOid,baseRefName,url,title,body > ${OUT}/${p.n}-${p.sha.slice(0, 9)}/pr.json\` (mkdir -p the dir first). headMatches = headRefOid == ${p.sha}. If it does not match, proceed=false.
2. CI: read main's required contexts \`gh api repos/{owner}/{repo}/branches/main/protection --jq '.required_status_checks.contexts'\` (use \`gh repo view --json nameWithOwner\`), then \`gh pr checks ${p.n} --json name,state,bucket,link > .../checks.json\`. ciGreen = every required context is pass on THIS head. Pending or red → proceed=false and say which.
3. \`gh pr diff ${p.n} > .../diff.patch\` and confirm it is complete (non-empty, matches \`git -C ${REPO} diff origin/main...${p.sha}\` file list).
4. Ownership with origin/main's classifier (never the checkout's copy):
   REPO="${REPO}"; GATE="$(mktemp -d)"; git -C "$REPO" fetch --no-tags -q origin +refs/heads/main:refs/remotes/origin/main && git -C "$REPO" show refs/remotes/origin/main:scripts/pr_audit_gate.py > "$GATE/pr_audit_gate.py" && PR_NUMBER=${p.n} PR_EXPECTED_HEAD=${p.sha} PR_AUDIT_REPO_DIR="$REPO" python3 -I "$GATE/pr_audit_gate.py" --ownership > .../ownership.txt 2>&1; echo $?
   Exit 0 → may proceed. Exit 3 → owned: proceed=false. Anything else → CANNOT CHECK: proceed=false.
proceed = headMatches && ciGreen && ownershipExit==0 && diff complete.`, { label: `bundle:${p.n}`, phase: 'Bundle', schema: BUNDLE, model: 'sonnet', effort: 'low' })

const planner = (p) => agent(`${ctx(p)}

FIRST CALL (plan). Inspect the original SHA-pinned diff and CI evidence in the bundle. Produce a short risk map and questions for two parallel Sonnet reviewers: correctness/compliance, and security/adversarial. Do not approve yet. End exactly PLAN: READY or PLAN: BLOCK.`, { label: `plan:${p.n}`, phase: 'Plan', agentType: 'pr-merge-planner' })

const auditor = (p, plan) => agent(`${ctx(p)}

The Opus planner's questions (fallible guidance, not a limit):
${plan}`, { label: `auditor:${p.n}`, phase: 'Review', agentType: 'pr-merge-auditor' })

const adversary = (p, plan) => agent(`${ctx(p)}

The Opus plan to challenge:
${plan}`, { label: `adversary:${p.n}`, phase: 'Review', agentType: 'pr-merge-adversary' })

const finalCall = (p, plan, a, b) => agent(`${ctx(p)}

FINAL CALL (adjudication). This run cannot resume the planning session, so your own first-call plan is quoted verbatim below; treat it as yours. Both reviewers approved. Recheck their claims against the original evidence, challenge your own plan, and resolve consequential judgment. Only a final VERDICT: HOLDS permits PASS; otherwise end VERDICT: OVERTURNED.

YOUR PLAN (verbatim):
${plan}

CORRECTNESS/COMPLIANCE REVIEW (verbatim):
${a}

SECURITY/ADVERSARIAL REVIEW (verbatim):
${b}`, { label: `final:${p.n}`, phase: 'Final', agentType: 'pr-merge-planner' })

const post = (p, verdict, parts) => agent(`Write the ADR 0090 audit report for PR #${p.n} at head ${p.sha} and post it.
1. Write ${OUT}/${p.n}-${p.sha.slice(0, 9)}/report.md with the verdict (${verdict}), each role's output verbatim under its own heading (plan, correctness review, adversarial review, final), and a "Limitations" section that states: the final adjudication was a fresh pr-merge-planner call given its own plan verbatim, not a resumed session; plus anything the bundle could not fetch.
2. Post it as a PR comment whose FIRST line is exactly \`<!-- pr-audit-gate: pr=${p.n} sha=${p.sha} verdict=${verdict} -->\` (full 40-hex sha), via \`gh pr comment ${p.n} --body-file <file>\`. If the body exceeds 65,000 characters, keep the marker line, the verdict, the final call verbatim and each review's findings, and say the full report path. Do NOT commit any file. Return the comment URL.

PARTS (JSON): ${JSON.stringify(parts)}`, { label: `post:${p.n}`, phase: 'Post', schema: POSTED, effort: 'low' })

const verdictOf = (t, re) => { const m = (t || '').trim().match(re); return m ? m[1] : null }

const results = await pipeline(args.prs,
  (p) => bundle(p),
  async (bd, p) => {
    if (!bd || !bd.proceed) return { pr: p.n, lane: p.lane, verdict: 'NOT-RUN', bundle: bd }
    const plan = await planner(p)
    if (!plan || !/PLAN:\s*READY\s*$/.test(plan.trim())) {
      const posted = await post(p, 'BLOCK', { plan, reason: 'plan missing or not READY' })
      return { pr: p.n, lane: p.lane, verdict: 'BLOCK', stage: 'plan', posted }
    }
    const [a, b] = await parallel([() => auditor(p, plan), () => adversary(p, plan)])
    const va = verdictOf(a, /VERDICT:\s*(APPROVE WITH NOTES|APPROVE|BLOCK)\s*$/)
    const vb = verdictOf(b, /VERDICT:\s*(APPROVE WITH NOTES|APPROVE|BLOCK)\s*$/)
    if (!va || !vb || va === 'BLOCK' || vb === 'BLOCK') {
      const posted = await post(p, 'BLOCK', { plan, correctness: a, adversarial: b })
      return { pr: p.n, lane: p.lane, verdict: 'BLOCK', stage: 'review', va, vb, posted, correctness: a, adversarial: b }
    }
    const fin = await finalCall(p, plan, a, b)
    const vf = verdictOf(fin, /VERDICT:\s*(HOLDS|OVERTURNED)\s*$/)
    const verdict = vf === 'HOLDS' ? 'PASS' : 'BLOCK'
    const posted = await post(p, verdict, { plan, correctness: a, adversarial: b, final: fin })
    return { pr: p.n, lane: p.lane, verdict, va, vb, vf, posted, final: verdict === 'PASS' ? '' : fin }
  })
return results
