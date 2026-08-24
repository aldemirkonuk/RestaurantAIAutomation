#!/usr/bin/env python3
import json, os, collections, pathlib, re

S = pathlib.Path(os.environ["SCRATCH"])
ROOT = pathlib.Path("/Users/aldemirkonuk/Projects/restaurant-ai-automation")
OUT = ROOT / ".planning/foundation"
d = json.load(open(S / "atlas.json"))

eps, routes, edges = d["endpoints"], d["routes"], d["edges"]
WEBHOOKS = ("toast", "simpos", "inbound-email", "vendor-portal", "pos-hub")

# ============ ENDPOINTS.md ============
by_mod = collections.defaultdict(list)
for e in eps: by_mod[e["module"]].append(e)

L = ["# API Endpoint Reference — Mudavym", "",
     "> Generated 2026-08-24 from `apps/api-gateway/src/**/*.controller.ts`.",
     "> **Grep target** — do not read whole (CLAUDE.md §2). Regenerate rather than hand-edit.", "",
     f"**{len(eps)} endpoints** across **{len(by_mod)} modules** · "
     f"{sum(1 for e in eps if e['auth'])} guarded by `JwtAuthGuard` · "
     f"{sum(1 for e in eps if not e['auth'])} unguarded.", "",
     "`Auth` column: ✅ = `JwtAuthGuard` present (class or method). "
     "⚠️ = no guard found — note `TenantGuard` returns `true` for unauthenticated "
     "requests (`common/tenant/tenant.guard.ts:38-46`), so ⚠️ means reachable unauthenticated.", ""]

for mod in sorted(by_mod):
    items = sorted(by_mod[mod], key=lambda e: (e["path"], e["method"]))
    n_un = sum(1 for e in items if not e["auth"])
    flag = ""
    if n_un:
        flag = (" — ⚠️ **%d unguarded**%s" % (n_un,
                " (webhook module — expected public, must verify signatures instead)"
                if any(w in mod for w in WEBHOOKS) else " — **classify these**"))
    L += [f"### `{mod}` ({len(items)}){flag}", "", "| Auth | Method | Path |", "|---|---|---|"]
    for e in items:
        L.append(f"| {'✅' if e['auth'] else '⚠️'} | `{e['method']}` | `{e['path']}` |")
    L.append("")
(OUT / "ENDPOINTS.md").write_text("\n".join(L))

# ============ PAGE GRAPH ============
def nid(p):
    s = re.sub(r'[^a-zA-Z0-9]', '_', p.strip('/')) or "root"
    return "n_" + s

PUBLIC = {"/login", "/register", "/forgot-password", "/reset-password",
          "/verify-email", "/invite/:code", "/privacy", "/terms", "/no-access", "*"}
mer = ["```mermaid", "graph LR"]
for r in routes:
    if r["path"] == "*": continue
    label = r["path"] + ("<br/><i>" + r["component"] + "</i>" if r["component"] not in ("?", "Navigate") else "")
    mer.append(f'  {nid(r["path"])}["{label}"]')
for src_p, tgts in sorted(edges.items()):
    for t in tgts:
        if src_p == "*" or t == "*": continue
        mer.append(f'  {nid(src_p)} --> {nid(t)}')
mer += ["  classDef pub fill:#fde68a,stroke:#b45309,color:#111;",
        "  class " + ",".join(nid(p) for p in PUBLIC if p != "*" and any(r["path"] == p for r in routes)) + " pub;",
        "```"]

orphans = [r["path"] for r in routes
           if r["path"] not in edges and not any(r["path"] in v for v in edges.values())
           and r["path"] != "*"]
unresolved = [r["path"] for r in routes if not r["file"]]
indeg = collections.Counter()
for v in edges.values():
    for t in v: indeg[t] += 1

P = ["# Page Interconnection Map — Web App", "",
     "> Generated 2026-08-24 from `apps/web/src/App.tsx` + page sources "
     "(`navigate()`, `<Link to>`, `href`).", "",
     f"**{len(routes)} routes** · **{sum(len(v) for v in edges.values())} in-app navigation edges** "
     f"· {len(unresolved)} route components unresolved (dynamic/inline).", "",
     "Yellow = unauthenticated/public entry points.", ""] + mer + ["",
     "## Entry points (no inbound in-app link)", "",
     "These are reached by URL, redirect, or external link — not by clicking through the app.",
     "Each is a place a user can land cold, so each needs its own auth + empty-state handling.", ""]
P += ["- `%s`" % o for o in sorted(orphans)] or ["- *(none)*"]
P += ["", "## Most-linked-to pages (in-degree)", "",
      "| Page | Inbound links |", "|---|---|"]
for p, c in indeg.most_common(12):
    P.append(f"| `{p}` | {c} |")
if unresolved:
    P += ["", "## Unresolved route components", "",
          "Route element could not be traced to a file (inline element, or non-standard binding). "
          "Navigation out of these pages is **not** represented in the graph above:", ""]
    P += ["- `%s`" % u for u in sorted(unresolved)]
(OUT / "PAGE_MAP.md").write_text("\n".join(P))

# ============ EXTERNAL CONNECTIONS ============
CLASSIFY = [
 (r'toasttab', 'Toast POS', 'Primary POS integration (webhooks + API)'),
 (r'anthropic', 'Anthropic', 'Claude — extraction, enrichment, drafting'),
 (r'googleapis|google\.com|gmail', 'Google', 'Gmail + Calendar OAuth'),
 (r'supabase', 'Supabase', 'Postgres + auth + storage'),
 (r'vercel\.app', 'Vercel', 'Frontend hosting'),
 (r'wine-searcher|vivino|consorzio', 'Wine data sources', 'Producer/critic enrichment'),
 (r'microsoftonline', 'Microsoft', 'OAuth (Outlook/365)'),
 (r'sentry', 'Sentry', 'Error tracking'),
 (r'ngrok', 'ngrok', '⚠️ Dev tunnel — should not appear in prod paths'),
 (r'placeholder|your-domain|\ba\.com\b|\bb\.com\b', 'Placeholder/sample', '⚠️ Fixture or stale sample value'),
 (r'schema\.org', 'schema.org', 'Structured-data vocabulary (not a network call)'),
 (r'wineops\.ai', 'wineops.ai', '⚠️ Legacy brand domain — pre-Mudavym'),
]
groups = collections.defaultdict(lambda: [0, "", []])
for h, c in d["runtime_hosts"]:
    for pat, name, note in CLASSIFY:
        if re.search(pat, h):
            groups[name][0] += c; groups[name][1] = note; groups[name][2].append(h); break
    else:
        groups["Other / unclassified"][0] += c
        groups["Other / unclassified"][1] = "Review individually"
        groups["Other / unclassified"][2].append(h)

E = ["# External Connections — Mudavym", "",
     "> Generated 2026-08-24. Hosts referenced in `apps/**` and `services/**` source "
     "(virtualenvs, `node_modules`, and documentation/reference URLs excluded).", "",
     f"**{len(d['runtime_hosts'])} distinct runtime hosts** · "
     f"**{len(d['sdks'])} SDKs** · **{len(d['envs'])} environment variables**.", "",
     "## Third-party services", "", "| Service | Refs | Role | Hosts |", "|---|---|---|---|"]
for name, (cnt, note, hs) in sorted(groups.items(), key=lambda kv: -kv[1][0]):
    E.append(f"| **{name}** | {cnt} | {note} | {', '.join('`%s`' % h for h in sorted(hs)[:5])}"
             + (f" *(+{len(hs)-5})*" if len(hs) > 5 else "") + " |")

E += ["", "## SDKs in use", "", "| SDK | Used by |", "|---|---|"]
for k, v in sorted(d["sdks"].items()):
    E.append(f"| {k} | {', '.join(v)} |")
E += ["", "> **Note:** Anthropic and Gemini appear as *hosts* but not as SDK imports — "
      "they are called over raw HTTP/axios. Worth confirming that retry, timeout, and "
      "cost accounting are handled consistently, since an SDK would normally provide those. "
      "This directly affects the NF-A telemetry track (foundation §4.2).", ""]

E += ["## Environment variables", "",
      f"{len(d['envs'])} distinct vars referenced. Top by reference count:", "",
      "| Var | Refs |", "|---|---|"]
for k, c in d["envs"][:35]:
    E.append(f"| `{k}` | {c} |")
E += ["", "*(full list in `atlas.json`; regenerate via the atlas script)*"]
(OUT / "EXTERNAL_CONNECTIONS.md").write_text("\n".join(E))

print("wrote ENDPOINTS.md PAGE_MAP.md EXTERNAL_CONNECTIONS.md")
print("orphan entry points:", len(orphans), "| unresolved:", len(unresolved))
print("service groups:", len(groups))
