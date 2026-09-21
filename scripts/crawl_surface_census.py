#!/usr/bin/env python3
"""
Census: what a crawler actually receives from a deployment of mudavym.com.

WHY THIS EXISTS
---------------
The Technical SEO team's rule is that the crawl surface is accepted on a
status code or served bytes observed from a real request, never a screenshot
or a green deploy (technical-seo-ai-answer-surface-directive.md, DO-9). Unit
tests prove the build writes the right files; only a request proves the host
serves them, on the host a crawler uses, with the status a crawler believes.
ADR 0158 records the design this checks.

WHAT IT CHECKS (each line of output is one check)
-------------------------------------------------
  robots      /robots.txt is 200 text/plain and starts with the company marker
  llms        /llms.txt is 200 text/plain and starts with "# Mudavym"
  sitemap     /sitemap.xml is a sitemap index; every child parses; every
              sampled <loc> answers 200 with a canonical equal to itself
  heads       each public page serves its own title, `index, follow` and a
              self canonical in the HTML (JavaScript off)
  closed      a signed-in route serves `noindex` in the HTML
  soft-404    three paths that exist nowhere answer 404
  token-route each link that carries a secret (/reset-password, /verify-email,
              /invite/*, /studio/invite/*), with and without a trailing slash,
              answers 200 with noindex and nofollow (exactly those two on
              mudavym.com) and exactly Referrer-Policy: no-referrer. It probes
              the base host only, not --duplicate-host (ADR 0158, Known limits)
  vendor      the first published catalogue (if any) serves its title, one
              parseable JSON-LD block and a listing row; a bad slug is 404
  old-host    (--old-host) pages 308 to mudavym.com keeping path and query,
              /api does not redirect
  duplicate   (--duplicate-host) every response carries X-Robots-Tag noindex

Metrics printed for the team's census record: seo.soft_404_rate and
seo.title_in_source_pct. seo.soft_404_rate only samples unknown FIRST path
segments (an SPA rewrite necessarily matches every sub-path under a known
first segment, e.g. /login/x or /v/acme/x, to the same shell) — a rate of
0.0 means "no unknown top-level route serves 200", not "no soft 404 exists
anywhere on the site". That is harmless for indexing (the shell those
sub-paths get is noindex,nofollow) but is not the same claim.

EXIT CODES
----------
  0  every check passed
  1  at least one check failed (the failing lines say which and why)
  2  the deployment could not be reached, so NOTHING was measured. A census
     that cannot see the site must not print green.

  python3 scripts/crawl_surface_census.py --self-test drives the token-route
  check through a local server (no base, offline): 0 all verdicts right, 1 a
  wrong verdict, 2 no local port. CLAIMS row ADR-0158-TOKEN-ROUTES-ARE-CHECKED-LIVE
  runs it.

Usage:
  python3 scripts/crawl_surface_census.py https://mudavym.com \
      --old-host https://restaurant-ai-automation-web.vercel.app \
      --duplicate-host https://restaurant-ai-automation-api-gatewa.vercel.app
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from html.parser import HTMLParser

UA = "MudavymCrawlCensus/1.0 (+https://mudavym.com/robots.txt)"
ROBOTS_MARKER = "# robots.txt for mudavym.com"
SM_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
PUBLIC_PAGES = ["/", "/login", "/register", "/privacy"]
CLOSED_SAMPLE = "/inventory"
NOWHERE = ["/zz-census-nowhere-1", "/inventory-zz-census", "/zz/census/nowhere"]
BAD_SLUG = "/v/zz-census-not-a-vendor"
# The token paths of TOKEN_PREFIXES in apps/web/src/lib/seo/routes.ts, each with and without a
# trailing slash (Vercel matches strictly, so /reset-password/ is a different path from
# /reset-password and answers 200 too), and a nested path under the two exact routes. A prefix
# ending in "/" gets a made-up token. crawl-surface.test.ts fails when this list and its own
# token paths differ in shape.
TOKEN_SAMPLES = [
    "/reset-password", "/reset-password/", "/reset-password/zz-census",
    "/verify-email", "/verify-email/", "/verify-email/zz-census",
    "/invite/zz-census", "/invite/zz-census/",
    "/studio/invite/zz-census", "/studio/invite/zz-census/",
]
CANONICAL_HOST = "mudavym.com"
TOKEN_ROBOTS = {"noindex", "nofollow"}
MAX_CHILD_SITEMAPS = 5
MAX_LOCS_PER_SITEMAP = 25


class CannotReach(Exception):
    pass


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: str


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def header_map(msg) -> dict[str, str]:
    """Lower-cased names; a field sent more than once is one comma-joined value (RFC 9110 5.3),
    which is how a browser reads it. A plain dict would keep only the last copy and hide the
    first, and a second Referrer-Policy is exactly the case worth seeing."""
    out: dict[str, list[str]] = {}
    for name, value in msg.items():
        out.setdefault(name.lower(), []).append(value)
    return {name: ", ".join(values) for name, values in out.items()}


def fetch(url: str, follow: bool = False, timeout: float = 20.0) -> Response:
    handlers = [] if follow else [NoRedirect()]
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with opener.open(req, timeout=timeout) as res:
            body = res.read().decode("utf-8", "replace")
            return Response(res.status, header_map(res.headers), body)
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace") if err.fp else ""
        return Response(err.code, header_map(err.headers) if err.headers else {}, body)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
        raise CannotReach(f"{url}: {err}") from err


class HeadReader(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title: str | None = None
        self.robots: list[str] = []
        self.canonical: list[str] = []
        self.jsonld: list[str] = []
        self.td = 0
        self._in_title = False
        self._in_ld = False
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title, self._buf = True, []
        elif tag == "meta" and a.get("name") == "robots":
            self.robots.append(a.get("content") or "")
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical.append(a.get("href") or "")
        elif tag == "script" and a.get("type") == "application/ld+json":
            self._in_ld, self._buf = True, []
        elif tag == "td":
            self.td += 1

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self.title, self._in_title = "".join(self._buf), False
        elif tag == "script" and self._in_ld:
            self.jsonld.append("".join(self._buf))
            self._in_ld = False

    def handle_data(self, data):
        if self._in_title or self._in_ld:
            self._buf.append(data)


def read_head(html: str) -> HeadReader:
    reader = HeadReader()
    reader.feed(html)
    return reader


@dataclass
class Census:
    base: str
    results: list[tuple[str, bool, str]] = field(default_factory=list)
    metrics: dict[str, object] = field(default_factory=dict)

    def check(self, name: str, ok: bool, detail: str) -> bool:
        self.results.append((name, ok, detail))
        return ok

    def url(self, path: str) -> str:
        return self.base.rstrip("/") + path


def check_text_file(c: Census, name: str, path: str, first_line: str) -> str:
    r = fetch(c.url(path))
    ctype = r.headers.get("content-type", "")
    head = r.body.splitlines()[0] if r.body else ""
    c.check(name, r.status == 200 and ctype.startswith("text/plain") and head == first_line,
            f"{path}: {r.status} {ctype!r} first line {head[:60]!r}")
    return r.body


def check_robots_permits_sitemap(c: Census, robots_body: str) -> None:
    """robots.txt is worthless as a sitemap pointer if its own rules forbid
    fetching the file it names. Found live (adversarial review, ADR 0158):
    the generated file advertised a Sitemap: line inside every group's own
    Disallow: /, so no compliant crawler could ever fetch it — and this
    census's own sitemap check would have kept reporting PASS regardless,
    because it fetches /sitemap.xml directly rather than asking whether
    robots.txt permits that fetch first. This check closes that gap: read
    only the FIRST group (the most permissive one, search/answer engines),
    up to its first blank line, and require an Allow line for the sitemap
    the file names in its own Sitemap: directive.
    """
    lines = [ln.strip() for ln in robots_body.splitlines()]
    first_group: list[str] = []
    seen_group = False
    for ln in lines:
        if ln.startswith("User-agent:"):
            seen_group = True
        elif not ln and seen_group:
            break
        if seen_group:
            first_group.append(ln)
    sitemap_line = next((ln for ln in lines if ln.startswith("Sitemap:")), None)
    if not sitemap_line:
        c.check("robots-permits-sitemap", False, "no Sitemap: directive in robots.txt")
        return
    sitemap_path = "/" + sitemap_line.split("/", 3)[-1]

    def matches(pattern: str) -> bool:
        # `$` anchors an EXACT match; its absence is a PREFIX match. Treating
        # both the same by stripping `$` before comparing is the exact bug
        # this check exists to catch: "/$".rstrip("$") is "/", and every path
        # starts with "/", so an anchored root rule would wrongly cover
        # everything — which is what let the real regression pass silently.
        return sitemap_path == pattern[:-1] if pattern.endswith("$") else sitemap_path.startswith(pattern)

    allowed = any(ln.startswith("Allow:") and matches(ln.split(":", 1)[1].strip()) for ln in first_group)
    detail = (
        f"the most permissive group has an Allow: line covering {sitemap_path}"
        if allowed
        else f"the most permissive group has no Allow: line covering {sitemap_path}"
    )
    c.check("robots-permits-sitemap", allowed, detail)


def check_heads(c: Census) -> None:
    own = 0
    for path in PUBLIC_PAGES:
        r = fetch(c.url(path))
        h = read_head(r.body)
        expected = "https://mudavym.com" + path
        ok = (r.status == 200 and h.robots == ["index, follow"] and h.canonical == [expected]
              and bool(h.title) and (path == "/" or h.title != "Mudavym"))
        own += 1 if ok else 0
        c.check("heads", ok, f"{path}: {r.status} title={h.title!r} robots={h.robots} canonical={h.canonical}")
    c.metrics["seo.title_in_source_pct"] = round(100 * own / len(PUBLIC_PAGES))

    r = fetch(c.url(CLOSED_SAMPLE))
    h = read_head(r.body)
    c.check("closed", r.status == 200 and h.robots == ["noindex, nofollow"] and not h.canonical,
            f"{CLOSED_SAMPLE}: {r.status} robots={h.robots} canonical={h.canonical}")


def check_soft_404(c: Census) -> None:
    soft = 0
    for path in NOWHERE:
        r = fetch(c.url(path))
        soft += 0 if r.status == 404 else 1
        c.check("soft-404", r.status == 404, f"{path}: {r.status}")
    c.metrics["seo.soft_404_rate"] = round(soft / len(NOWHERE), 2)


def check_page_url(c: Census, loc: str) -> None:
    r = fetch(loc)
    h = read_head(r.body)
    c.check("sitemap-loc", r.status == 200 and h.canonical == [loc],
            f"{loc}: {r.status} canonical={h.canonical}")


def check_sitemaps(c: Census) -> list[str]:
    r = fetch(c.url("/sitemap.xml"))
    try:
        root = ET.fromstring(r.body)
    except ET.ParseError as err:
        c.check("sitemap", False, f"/sitemap.xml: {r.status} does not parse ({err})")
        return []
    if not c.check("sitemap", r.status == 200 and root.tag == f"{SM_NS}sitemapindex",
                   f"/sitemap.xml: {r.status} root={root.tag}"):
        return []
    children = [e.text or "" for e in root.iter(f"{SM_NS}loc")]
    c.check("sitemap", any(x.endswith("/sitemap-pages.xml") for x in children),
            f"index lists {len(children)} files")
    vendor_locs: list[str] = []
    if len(children) > MAX_CHILD_SITEMAPS:
        print(f"note: sampled {MAX_CHILD_SITEMAPS} of {len(children)} child sitemaps")
    for child in children[:MAX_CHILD_SITEMAPS]:
        path = re.sub(r"^https://mudavym\.com", "", child)
        cr = fetch(c.url(path))
        try:
            urlset = ET.fromstring(cr.body)
        except ET.ParseError:
            c.check("sitemap", False, f"{path}: {cr.status} does not parse")
            continue
        locs = [e.text or "" for e in urlset.iter(f"{SM_NS}loc")]
        c.check("sitemap", cr.status == 200 and urlset.tag == f"{SM_NS}urlset" and len(locs) > 0,
                f"{path}: {cr.status} {len(locs)} urls")
        if len(locs) > MAX_LOCS_PER_SITEMAP:
            print(f"note: sampled {MAX_LOCS_PER_SITEMAP} of {len(locs)} urls in {path}")
        for loc in locs[:MAX_LOCS_PER_SITEMAP]:
            if "/v/" in loc:
                vendor_locs.append(loc)
            check_page_url(c, re.sub(r"^https://mudavym\.com", c.base.rstrip("/"), loc)
                           if c.base.rstrip("/") != "https://mudavym.com" else loc)
    return vendor_locs


def check_vendor(c: Census, vendor_locs: list[str]) -> None:
    r = fetch(c.url(BAD_SLUG))
    c.check("vendor", r.status == 404, f"{BAD_SLUG}: {r.status}")
    if not vendor_locs:
        print("note: no published vendor catalogue in the sitemap; the published-page check did not run")
        return
    loc = vendor_locs[0]
    r = fetch(loc)
    h = read_head(r.body)
    parsed = 0
    for block in h.jsonld:
        try:
            json.loads(block)
            parsed += 1
        except json.JSONDecodeError:
            pass
    c.check("vendor", r.status == 200 and bool(h.title) and parsed == 1 and h.td > 0
            and h.robots == ["index, follow"],
            f"{loc}: {r.status} title={h.title!r} jsonld={parsed}/{len(h.jsonld)} cells={h.td}")


def check_old_host(c: Census, old: str) -> None:
    for path in ["/login?census=1", "/"]:
        r = fetch(old.rstrip("/") + path)
        want = "https://mudavym.com" + path
        c.check("old-host", r.status == 308 and r.headers.get("location") == want,
                f"{path}: {r.status} location={r.headers.get('location')!r}")
    r = fetch(old.rstrip("/") + "/api/v1/health/live")
    c.check("old-host", r.status != 308, f"/api/v1/health/live: {r.status} (must not redirect)")


def check_token_routes(c: Census, exact_robots: bool = False) -> None:
    """A link that carries a secret is not indexed and does not leak in a Referer.

    The static guard in apps/web/src/lib/seo/crawl-surface.test.ts reads vercel.json, not what
    Vercel sends; this reads what it sends, whichever of several matching header rules won.
    Referrer-Policy must be exactly no-referrer. X-Robots-Tag must carry noindex and nofollow,
    and with exact_robots (used on mudavym.com, where one rule applies) nothing else: a live
    "noindex, nofollow, all" passes on any other host, where a second rule adds its own noindex.
    """
    for path in TOKEN_SAMPLES:
        r = fetch(c.url(path))
        robots = r.headers.get("x-robots-tag", "")
        directives = {d.strip().lower() for d in robots.split(",") if d.strip()}
        policies = {p.strip().lower() for p in r.headers.get("referrer-policy", "").split(",") if p.strip()}
        robots_ok = directives == TOKEN_ROBOTS if exact_robots else TOKEN_ROBOTS <= directives
        ok = r.status == 200 and robots_ok and policies == {"no-referrer"}
        c.check("token-route", ok,
                f"{path}: {r.status} x-robots-tag={robots!r} "
                f"referrer-policy={r.headers.get('referrer-policy', '')!r}")


# What a token route can answer, wrong and right: (status, headers, passes as superset, passes exact).
_TOKEN_CASES = {
    "good": (200, [("X-Robots-Tag", "noindex, nofollow"), ("Referrer-Policy", "no-referrer")], True, True),
    "weak-referrer": (200, [("X-Robots-Tag", "noindex, nofollow"),
                            ("Referrer-Policy", "strict-origin-when-cross-origin")], False, False),
    "two-referrer-fields": (200, [("X-Robots-Tag", "noindex, nofollow"), ("Referrer-Policy", "no-referrer"),
                                  ("Referrer-Policy", "strict-origin-when-cross-origin")], False, False),
    "two-referrer-fields-reversed": (200, [("X-Robots-Tag", "noindex, nofollow"),
                                           ("Referrer-Policy", "strict-origin-when-cross-origin"),
                                           ("Referrer-Policy", "no-referrer")], False, False),
    "no-referrer-header": (200, [("X-Robots-Tag", "noindex, nofollow")], False, False),
    "noindex-without-nofollow": (200, [("X-Robots-Tag", "noindex"), ("Referrer-Policy", "no-referrer")],
                                 False, False),
    "two-robots-fields": (200, [("X-Robots-Tag", "noindex"), ("X-Robots-Tag", "noindex, nofollow"),
                                ("Referrer-Policy", "no-referrer")], True, True),
    "robots-with-extra-directive": (200, [("X-Robots-Tag", "noindex, nofollow, all"),
                                          ("Referrer-Policy", "no-referrer")], True, False),
    "indexable": (200, [("X-Robots-Tag", "all"), ("Referrer-Policy", "no-referrer")], False, False),
    "no-robots-header": (200, [("Referrer-Policy", "no-referrer")], False, False),
    "404-with-right-headers": (404, [("X-Robots-Tag", "noindex, nofollow"),
                                     ("Referrer-Policy", "no-referrer")], False, False),
    "redirect": (308, [("Location", "https://example.invalid/"), ("X-Robots-Tag", "noindex, nofollow"),
                       ("Referrer-Policy", "no-referrer")], False, False),
}


def self_test() -> int:
    """Drive check_token_routes and header_map through a local server that answers every way in
    _TOKEN_CASES. Offline; the CLAIMS row for this check runs it, so a gutted predicate, a
    last-wins header dict or a lost probe loop fails the build. Exit 2 when it cannot run."""
    import http.server
    import threading

    current = {"case": "good"}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            status, headers, _, _ = _TOKEN_CASES[current["case"]]
            self.send_response(status)
            for key, value in headers:
                self.send_header(key, value)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args):
            pass

    try:
        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    except OSError as err:
        print(f"CANNOT CHECK: no local port for the self-test: {err}", file=sys.stderr)
        return 2
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    wrong = 0
    for name, (_, _, want_superset, want_exact) in _TOKEN_CASES.items():
        current["case"] = name
        for exact, want in ((False, want_superset), (True, want_exact)):
            c = Census(base)
            check_token_routes(c, exact_robots=exact)
            got = len(c.results) == len(TOKEN_SAMPLES) and all(ok for _, ok, _ in c.results)
            if got != want:
                wrong += 1
                print(f"WRONG  {name} ({'exact' if exact else 'superset'}): passed={got}, want {want}")
    server.shutdown()
    if wrong:
        print(f"self-test FAILED: {wrong} wrong verdicts")
        return 1
    print(f"self-test ok: {len(_TOKEN_CASES)} cases x 2 modes x {len(TOKEN_SAMPLES)} paths")
    return 0


def check_duplicate(c: Census, dup: str) -> None:
    for path in ["/", "/login", "/robots.txt"]:
        r = fetch(dup.rstrip("/") + path)
        tag = r.headers.get("x-robots-tag", "")
        c.check("duplicate", "noindex" in tag, f"{path}: {r.status} x-robots-tag={tag!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description="What a crawler receives from a mudavym.com deployment.")
    ap.add_argument("base", nargs="?", help="deployment origin, e.g. https://mudavym.com")
    ap.add_argument("--old-host", help="the retired production alias that must 308")
    ap.add_argument("--duplicate-host", help="a non-canonical host that must answer noindex")
    ap.add_argument("--json", action="store_true", help="print the result as JSON too")
    ap.add_argument("--self-test", action="store_true",
                    help="check the token-route check itself against a local server; offline, needs no base")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.base:
        ap.error("base is required unless --self-test is given")

    c = Census(args.base)
    try:
        fetch(c.url("/robots.txt"))
    except CannotReach as err:
        print(f"CANNOT CHECK: {err}", file=sys.stderr)
        print("Nothing was measured. This is a failure, not a pass.", file=sys.stderr)
        return 2
    try:
        robots_body = check_text_file(c, "robots", "/robots.txt", ROBOTS_MARKER)
        check_robots_permits_sitemap(c, robots_body)
        check_text_file(c, "llms", "/llms.txt", "# Mudavym")
        check_heads(c)
        check_soft_404(c)
        check_token_routes(c, exact_robots=urllib.parse.urlparse(args.base).hostname == CANONICAL_HOST)
        vendors = check_sitemaps(c)
        check_vendor(c, vendors)
        if args.old_host:
            check_old_host(c, args.old_host)
        if args.duplicate_host:
            check_duplicate(c, args.duplicate_host)
    except CannotReach as err:
        print(f"CANNOT CHECK: lost the deployment mid-census: {err}", file=sys.stderr)
        return 2

    failed = 0
    for name, ok, detail in c.results:
        failed += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name:<12} {detail}")
    for key, value in c.metrics.items():
        print(f"metric {key} = {value}")
    if args.json:
        print(json.dumps({"base": c.base, "failed": failed, "metrics": c.metrics,
                          "results": [{"check": n, "ok": o, "detail": d} for n, o, d in c.results]}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
