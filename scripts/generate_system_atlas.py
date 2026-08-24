#!/usr/bin/env python3
"""Generate the Mudavym System Atlas: endpoints, pages, page-graph, external connections."""
import os, re, json, collections, pathlib

ROOT = pathlib.Path("/Users/aldemirkonuk/Projects/restaurant-ai-automation")
API = ROOT / "apps/api-gateway/src"
WEB = ROOT / "apps/web/src"
MOB = ROOT / "apps/mobile"
SVC = ROOT / "services"

PRUNE = {"node_modules", "dist", "build", ".turbo", "venv", ".venv",
         "site-packages", "__pycache__", ".git", "coverage", ".next"}

def files(base, *exts):
    out = []
    for dp, dn, fn in os.walk(base):
        dn[:] = [d for d in dn if d not in PRUNE]
        for f in fn:
            if f.endswith(exts):
                out.append(pathlib.Path(dp) / f)
    return sorted(out)

# ---------- 1. API ENDPOINTS ----------
METHODS = ("Get", "Post", "Put", "Patch", "Delete", "Head", "Options")
endpoints = []
for f in files(API, ".controller.ts"):
    src = f.read_text(errors="replace")
    m = re.search(r'@Controller\(\s*["\']?([^"\')]*)["\']?\s*\)', src)
    base = (m.group(1) if m else "").strip("/")
    cls_auth = bool(re.search(r'@UseGuards\([^)]*JwtAuthGuard', src))
    module = str(f.relative_to(API)).replace(".controller.ts", "")
    for mm in re.finditer(r'@(%s)\(\s*(?:["\']([^"\']*)["\'])?\s*\)' % "|".join(METHODS), src):
        verb, sub = mm.group(1).upper(), (mm.group(2) or "").strip("/")
        seg = src[max(0, mm.start() - 400):mm.start()]
        endpoints.append({
            "method": verb,
            "path": "/" + "/".join(x for x in (base, sub) if x),
            "module": module,
            "auth": cls_auth or bool(re.search(r'@UseGuards\([^)]*JwtAuthGuard', seg)),
            "public": bool(re.search(r'@Public\(\)', seg)),
        })
endpoints.sort(key=lambda e: (e["path"], e["method"]))

# ---------- 2. WEB ROUTES + component->file ----------
app_tsx = WEB / "App.tsx"
src = app_tsx.read_text(errors="replace")
comp_path = {}
for mm in re.finditer(r'import\s*\{\s*([A-Za-z0-9_]+)[^}]*\}\s*from\s*[\'"]\.(/[^\'"]+)[\'"]', src):
    comp_path[mm.group(1)] = mm.group(2)
for mm in re.finditer(r'const\s+([A-Za-z0-9_]+)\s*=\s*lazyWithRefresh\(\s*\(\)\s*=>\s*import\(\s*[\'"]\.(/[^\'"]+)[\'"]', src):
    comp_path[mm.group(1)] = mm.group(2)

routes, seen = [], set()
for mm in re.finditer(r'<Route\b([^>]*?)/?>', src, re.S):
    attrs = mm.group(1)
    p = re.search(r'path="([^"]*)"', attrs)
    el = re.search(r'element=\{<\s*([A-Za-z0-9_]+)', attrs)
    if p and p.group(1) not in seen:
        seen.add(p.group(1))
        routes.append({"path": p.group(1),
                       "component": el.group(1) if el else "?",
                       "file": comp_path.get(el.group(1) if el else "", "")})
routes.sort(key=lambda r: r["path"])

def resolve(rel):
    """map './pages/Foo' -> actual file, and return its sibling dir for deep scan"""
    if not rel: return None
    for cand in (WEB / (rel.lstrip("/") + ".tsx"), WEB / (rel.lstrip("/") + "/index.tsx")):
        if cand.exists(): return cand
    return None

# ---------- 3. PAGE GRAPH ----------
route_paths = {r["path"] for r in routes}
edges = collections.defaultdict(set)
NAV_PATS = (r'navigate\(\s*[\'"`](/[^\'"`?]*)', r'<Link\b[^>]*?\bto="(/[^"?]*)"',
            r'href="(/[^"?]*)"', r'pathname:\s*[\'"](/[^\'"?]*)')
for r in routes:
    f = resolve(r["file"])
    if not f: continue
    scan = [f]
    # include co-located subtree (e.g. pages/inventory/command/*) one level deep
    if f.parent != WEB / "pages":
        scan += [x for x in files(f.parent, ".tsx", ".ts") if x != f][:40]
    text = ""
    for s in scan:
        try: text += s.read_text(errors="replace")
        except Exception: pass
    for pat in NAV_PATS:
        for mm in re.finditer(pat, text):
            t = (mm.group(1).rstrip("/") or "/")
            if t == r["path"]: continue
            if t in route_paths:
                edges[r["path"]].add(t)
            else:
                for rp in route_paths:
                    if ":" in rp and t.startswith(rp.split(":")[0].rstrip("/")) and rp.split(":")[0].rstrip("/"):
                        edges[r["path"]].add(rp); break

# ---------- 4. EXTERNAL CONNECTIONS ----------
DOC_HOSTS = re.compile(r'(wikipedia|arxiv|github\.com|readthedocs|docs\.|developer\.mozilla|'
                       r'stackoverflow|apache\.org|opensource\.org|w3\.org|rfc-editor|ietf|'
                       r'mathworld|doi\.org|nist\.gov|playwright\.dev|pytorch|tensorflow|'
                       r'huggingface|nltk|cocodataset|ultralytics|python\.org|npmjs|'
                       r'tiangolo|jax\.|scipy|numpy|pandas|sklearn|matplotlib)')
SDKS = {
    "@anthropic-ai": "Anthropic (Claude)", "@google/generative-ai": "Google Gemini",
    "googleapis": "Google APIs (Gmail/Calendar)", "@supabase": "Supabase",
    "twilio": "Twilio (SMS)", "nodemailer": "SMTP mail", "resend": "Resend",
    "openai": "OpenAI", "stripe": "Stripe", "@sentry": "Sentry",
    "amqplib": "RabbitMQ", "ioredis": "Redis", "redis": "Redis",
    "@aws-sdk": "AWS", "imapflow": "IMAP", "firecrawl": "Firecrawl",
    "axios": "HTTP client (axios)",
}
runtime_hosts, ref_hosts = collections.Counter(), collections.Counter()
sdk_hits, envs = collections.defaultdict(set), collections.Counter()

for base in (API, WEB, MOB, SVC):
    if not base.exists(): continue
    for f in files(base, ".ts", ".tsx", ".py", ".js"):
        try: src2 = f.read_text(errors="replace")
        except Exception: continue
        rel = str(f.relative_to(ROOT))
        app = rel.split("/")[1] if rel.count("/") > 1 else rel
        for mm in re.finditer(r'https?://([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})', src2):
            h = mm.group(1).lower()
            if any(x in h for x in ("localhost", "example.", "127.0.0.1")): continue
            (ref_hosts if DOC_HOSTS.search(h) else runtime_hosts)[h] += 1
        for k, label in SDKS.items():
            if re.search(r'from ["\']%s|require\(["\']%s|^\s*import %s' % (re.escape(k), re.escape(k), re.escape(k)), src2, re.M):
                sdk_hits[label].add(app)
        for mm in re.finditer(r'process\.env\.([A-Z0-9_]{3,})|os\.getenv\(["\']([A-Z0-9_]{3,})', src2):
            envs[mm.group(1) or mm.group(2)] += 1

out = {"endpoints": endpoints, "routes": routes,
       "edges": {k: sorted(v) for k, v in edges.items()},
       "runtime_hosts": runtime_hosts.most_common(50),
       "ref_hosts_count": len(ref_hosts),
       "sdks": {k: sorted(v) for k, v in sdk_hits.items()},
       "envs": envs.most_common(80)}
pathlib.Path(os.environ["SCRATCH"], "atlas.json").write_text(json.dumps(out, indent=1))
print("endpoints:", len(endpoints), "| authed:", sum(1 for e in endpoints if e["auth"]),
      "| unauthed:", sum(1 for e in endpoints if not e["auth"]))
print("routes:", len(routes), "| resolved:", sum(1 for r in routes if resolve(r["file"])),
      "| edges:", sum(len(v) for v in edges.values()))
print("runtime hosts:", len(runtime_hosts), "| reference hosts (excluded):", len(ref_hosts))
print("sdks:", len(sdk_hits), "| env vars:", len(envs))
