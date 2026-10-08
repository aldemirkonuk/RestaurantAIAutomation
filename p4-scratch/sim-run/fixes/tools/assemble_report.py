#!/usr/bin/env python3
"""assemble_report.py <journal-dir> <pr> <full-sha> <verdict> <out>
Builds an ADR 0090 report from a fix-pr-audit-gate workflow journal when its
post step was refused. Each section is the named agent's return, verbatim."""
import json, sys, re, os
D, n, sha, verdict, out = sys.argv[1:6]
lab, res = {}, {}
for l in open(f"{D}/journal.jsonl"):
    e = json.loads(l)
    if e.get('type') == 'started' and e.get('label'): lab[e['label']] = e['agentId']
    if e.get('type') == 'result': res[e.get('agentId')] = e.get('value') if 'value' in e else e.get('result')
def get(role):
    if f"{role}:{n}" not in lab or lab[f"{role}:{n}"] not in res:
        return "(not run: the workflow stops before the final call when a reviewer returns BLOCK; the BLOCK rests on the reviews above)\nVERDICT: NOT RUN"
    v = res[lab[f"{role}:{n}"]]
    return v.strip() if isinstance(v, str) else json.dumps(v, indent=1)
plan, aud, adv, fin = get('plan'), get('auditor'), get('adversary'), get('final')
def verdict_of(t):
    m = re.findall(r'VERDICT:\s*([A-Z ]+?)\s*$', t, re.M)
    return m[-1].strip() if m else 'UNSTATED'
run = os.path.basename(D.rstrip('/'))
body = f"""<!-- pr-audit-gate: pr={n} sha={sha} verdict={verdict} -->
## ADR 0090 PR audit — #{n} at `{sha}`: **{verdict}**

- Correctness / compliance (pr-merge-auditor, Sonnet): {verdict_of(aud)}
- Security / adversarial (pr-merge-adversary, Sonnet): {verdict_of(adv)}
- Final adjudication (pr-merge-planner, Opus): **{verdict_of(fin)}**

### Plan (pr-merge-planner, Opus)

{plan}

### Correctness / compliance review (pr-merge-auditor, Sonnet)

{aud}

### Security / adversarial review (pr-merge-adversary, Sonnet)

{adv}

### Final adjudication (pr-merge-planner, Opus)

{fin}

### Limitations

- The workflow's post step could not write this report (a subagent may not write report files); the coordinator assembled it from the workflow journal ({run}), each section verbatim from the named agent's return.
- The final adjudication was a fresh planner call given its own plan, not a resumed session.
"""
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w').write(body)
print(out, len(body), verdict_of(aud), verdict_of(adv), verdict_of(fin))
