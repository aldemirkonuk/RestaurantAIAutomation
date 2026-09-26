#!/usr/bin/env python3
"""
Guard: every outside host that can receive a house's data is named in the
house's data terms.

    python3 scripts/check_data_terms_name_every_host.py
    python3 scripts/check_data_terms_name_every_host.py --self-test
    python3 scripts/check_data_terms_name_every_host.py --census   # print what it sees

WHY THIS IS A GUARD (ADR 0207 round 5; ADR 0224)
------------------------------------------------
An owner accepts the house's data terms at sign-in (ADR 0207 question 19,
"Every owner, next sign-in"). Those terms list SUBPROCESSORS, and the list is
a claim about the code: "this is every place your data goes". A list written
from one round's research rotted within a day: the 2026-09-25 census found
`exp.host` (Expo push, carrying message text) and a dozen other hosts the list
neither named nor excused. The founder's word of 2026-09-25 was "complete the
list first" -- so the list is held by a check, not by a paragraph.

WHAT IT CHECKS
--------------
Over every non-test source file under apps/api-gateway/src and services/:

  1. HOSTS. Every host in an http(s)/ws(s) URL, and every string literal that
     is a bare hostname, found in CODE (comments and Python docstrings are
     stripped first, so a citation in a comment is not a finding). Each must be
     either NAMED -- equal to, or a subdomain of, a `host:` in SUBPROCESSORS
     (apps/api-gateway/src/settings/data-terms/house-data-terms.ts) -- or
     EXCUSED in EXCUSED_HOSTS below with a category and a reason.
  2. SDKS. Every third-party package the code imports. An SDK can send data to
     a host that never appears as a literal (Sentry from a DSN, Supabase from
     SUPABASE_URL, Stripe/Twilio/Resend/OpenAI from their defaults). Each
     imported package must be classified in PACKAGES: either the subprocessor
     host it sends to (which must then be NAMED), or LOCAL with no outbound
     host of its own. A new SDK nobody classified fails the build.
  3. NO DEAD NAMES. Every SUBPROCESSORS host must be reached by at least one
     finding (a literal or a classified SDK) or be listed in NAMED_WITHOUT_CODE
     with the reason (e.g. the hosting platform the code runs on). A name the
     code no longer backs is a claim nobody checks.
  4. NO DEAD EXCUSES. Every EXCUSED_HOSTS / PACKAGES entry must still match
     something. An exemption that excuses nothing is the same hole as one that
     outlived its field (memory: solve-it-once-means-add-a-guard).

An EXCUSED host is a claim that no house data reaches it. The categories:
  own        -- Mudavym's own domains (we are the processor, not a third party).
  local      -- loopback / link-local / placeholder addresses; never a real peer.
  reference  -- a link the code carries as DATA (a source citation shown to a
                person or stored), never fetched by the code.
  public     -- fetched, but only public, non-house data leaves (a public price
                list, a public statute). The reason must say what is sent.
  nothost    -- a string shaped like a hostname that is not one (a settings
                key, a package name).
A PACKAGES entry is (target, reason): target is a host some SUBPROCESSORS row
names, or LOCAL (no outbound peer of its own -- a generic HTTP client's
destinations are the literals above; a parser sends nothing).

WHAT IT DOES NOT CATCH (named, CLAUDE.md §0.5)
----------------------------------------------
  - A host built at run time from pieces, or read from an environment variable
    or a database row with no literal and no SDK in the code (a vendor's own
    URL typed by a person, a webhook target). SDK classification and the SSRF
    guard cover part of that; the rest is review.
  - Whether a `reference` link really is never fetched, or a `public` fetch
    really carries nothing of the house: those are the excuse's own words, held
    by review. The guard makes each one a sentence someone had to write.
  - apps/web (the browser talks to our gateway and to Supabase/Sentry, both
    named) and apps/mobile are out of scope; so are tests.

Exit 0 pass, 1 violation, 2 cannot check.
"""

from __future__ import annotations

import ast
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TERMS = Path("apps/api-gateway/src/settings/data-terms/house-data-terms.ts")
SCAN_ROOTS = (Path("apps/api-gateway/src"), Path("services"))
SUFFIXES = (".ts", ".js", ".mjs", ".cjs", ".py")
EXCLUDE_DIRS = {
    "node_modules",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    "tests",
    "test",
    "__tests__",
    "__mocks__",
    "coverage",
    ".pytest_cache",
}
TEST_FILE = re.compile(
    r"(\.spec\.[cm]?[jt]s$|\.test\.[cm]?[jt]s$|(^|/)test_[^/]*\.py$|_test\.py$|(^|/)conftest\.py$)"
)

URL_RE = re.compile(
    r"\b(?:https?|wss?)://([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)"
)
# A string literal that IS a hostname (e.g. `host: "smtp.gmail.com"`). The TLD
# list is deliberate: every two-letter ccTLD would also match file names
# (`config.py`, `index.ts`, `README.md`), so ccTLDs are the ones this code base's
# partners actually use.
BARE_HOST_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"
    r"(?:com|net|org|io|ai|dev|co|app|host|cloud|tech|gov|info|biz|so|me|"
    r"tr|uk|us|de|eu|fr|it|es|nz|au|ca|jp|cn|ar|cl|za|pt|at|ch|nl|be|ie)$"
)

# --------------------------------------------------------------------------
# Classification. Filled from the 2026-09-25 census (ADR 0224 has the table's
# provenance). Editing these is the mechanism: deliberate, reviewable, and a
# sentence somebody has to be willing to write.
# --------------------------------------------------------------------------

CATEGORIES = {"own", "local", "reference", "public", "nothost"}
LOCAL = "LOCAL"


def _group(category: str, reason: str, *hosts: str) -> dict[str, tuple[str, str]]:
    return {h: (category, reason) for h in hosts}


# Hosts no house data reaches -- each with the sentence that says why.
EXCUSED_HOSTS: dict[str, tuple[str, str]] = {
    **_group(
        "own",
        "Mudavym's own domains: links in mail, CORS origins, the API's own address",
        "mudavym.com",
        "www.mudavym.com",
        "app.mudavym.com",
        "api.mudavym.com",
    ),
    **_group(
        "own",
        "the former WineOps brand: our bot's user-agent names it so a shop can block us",
        "wineops.ai",
    ),
    **_group(
        "own",
        "Mudavym's own earlier web deployment, allowed as a CORS origin",
        "restaurant-ai-automation-web.vercel.app",
    ),
    **_group(
        "local", "loopback: the local development servers", "localhost", "127.0.0.1"
    ),
    **_group(
        "local",
        "placeholders returned or parsed locally, never requested: a reserved .invalid "
        "base for URL parsing, mock-mode URLs, an example in a warning, a hostile test payload",
        "return-path.invalid",
        "mock-recording.plivo.com",
        "docs.google.com",
        "drive.google.com",
        "myapp.vercel.app",
        "evil",
    ),
    **_group(
        "nothost",
        "shaped like a host, is not one: a settings key, a bus routing key, a package "
        "name, model weight files",
        "categories.ai",
        "notification.info",
        "socket.io",
        "yolov8n.pt",
        "yolov8m.pt",
        "best.pt",
    ),
    **_group(
        "reference",
        "a citation carried as data in the retention rules, shown to a person; never fetched",
        "developers.google.com",
        "gdpr-info.eu",
        "hukukmusavirligi.diyanet.gov.tr",
        "leginfo.legislature.ca.gov",
        "mgm.adalet.gov.tr",
        "www.cdtfa.ca.gov",
        "www.irs.gov",
        "www.kvkk.gov.tr",
        "www.legislation.gov.uk",
    ),
    **_group(
        "reference",
        "the distributor-feed register's portal links and evidence (distributor-feed."
        "registry.ts): shown to a person, never fetched -- the register records that no feed can be built",
        "analyticsapi.libdib.com",
        "app.erndc.com",
        "app.libdib.com",
        "docs.restaurant365.com",
        "go.sevenfifty.com",
        "now.breakthrubev.com",
        "shop.sgproof.com",
        "www.breakthrubev.com",
        "www.cleo.com",
        "www.provi.com",
        "www.rndc-usa.com",
        "www.southernglazers.com",
        "www.truecommerce.com",
    ),
    **_group(
        "reference",
        "source citations behind the goal scenarios' figures; never fetched",
        "blackboxintelligence.com",
        "dclcorp.com",
        "goodsource.com",
        "premiumwineglasses.com",
        "relayfi.com",
        "restaurant.org",
        "supy.io",
        "www.restaurant.org",
        "www.restaurant365.com",
        "www.sculpturehospitality.com",
        "www.thehospitalityhangout.com",
        "www.touchbistro.com",
        "www.vastcfo.com",
    ),
    **_group(
        "reference",
        "POS vendors' developer documentation linked from the POS register; never fetched",
        "developer.squareup.com",
        "developers.lightspeedhq.com",
        "docs.clover.com",
        "docs.oracle.com",
    ),
    **_group(
        "reference",
        "statute and agency citations in the price-index silence notes; never fetched",
        "data.michigan.gov",
        "ilcc.illinois.gov",
        "ilga.gov",
        "law.onecle.com",
        "www.ilga.gov",
        "www.legislature.mi.gov",
    ),
    **_group(
        "reference",
        "a namespace or licence URI written into our own output (JSON-LD, sitemap, "
        "image licence), or a provider's error-doc link in a recorded response; never fetched",
        "schema.org",
        "www.sitemaps.org",
        "creativecommons.org",
        "www.twilio.com",
        "www.liv-ex.com",
    ),
    **_group(
        "reference",
        "domain tables that classify a URL someone else found (source tiers, critic "
        "sources, social links); matched as strings, never fetched from these tables",
        "agriculture.gouv.fr",
        "amaroneducati.it",
        "ams.usda.gov",
        "awri.com.au",
        "biodyvin.com",
        "bivb.com",
        "cellartracker.com",
        "champagne.fr",
        "chiantidocg.it",
        "civb.com",
        "consorziobarolo.it",
        "consorziobrunellomontalcino.it",
        "cvr-dao.pt",
        "cvrverdelhos.pt",
        "demeter-usa.org",
        "denominacionorigen.es",
        "eambrosia.europa.eu",
        "fao.org",
        "federdoc.com",
        "germanwines.de",
        "guildsomm.com",
        "icqrf.gov.it",
        "inao.gouv.fr",
        "inv.gov.ar",
        "ivdp.pt",
        "ivv.gov.pt",
        "masi.it",
        "napavalleyvintners.com",
        "nzwine.com",
        "priorat.org",
        "prosecco.it",
        "rhone-wines.com",
        "ribera.es",
        "riberadelduero.es",
        "riojawine.com",
        "robertparker.com",
        "sawis.co.za",
        "soave.it",
        "sonomacountywine.com",
        "ttb.gov",
        "vdp.de",
        "vinsalsace.com",
        "vinsdeloire-wines.com",
        "weinrecht.de",
        "wine-pages.com",
        "wineaustralia.com",
        "winefolly.com",
        "winefromspain.com",
        "wineinstitute.org",
        "winemag.com",
        "winesofargentina.org",
        "winesofchile.org",
        "wosa.co.za",
        "decanter.com",
        "jancisrobinson.com",
        "vivino.com",
        "wine-searcher.com",
        "wineadvocate.com",
        "winespectator.com",
        "facebook.com",
        "instagram.com",
        "opentable.com",
        "twitter.com",
        "yelp.com",
    ),
    **_group(
        "public",
        "public statistics and price postings fetched by series or page; the request "
        "carries a series key and, for TUIK, Mudavym's own API key -- nothing of any house",
        "nsiws.tuik.gov.tr",
        "giris.tuik.gov.tr",
        "www.tuik.gov.tr",
        "tax.illinois.gov",
        "www.ams.usda.gov",
        "www.fao.org",
        "www.gib.gov.tr",
        "www.gov.uk",
        "www.ons.gov.uk",
        "s7fcylvn8j.execute-api.us-west-2.amazonaws.com",
        "priceposting.abc.ca.gov",
        "assets.publishing.service.gov.uk",
        "idh-be.iowa.gov",
        "www.michigan.gov",
        "data.oregon.gov",
    ),
    **_group(
        "public",
        "the merchant-shop sweep GETs a public shop page it is given; it has no join to "
        "a house's wines and is off by default (shop-reference-sweep.service.ts)",
        "hedonism.co.uk",
        "merchantsfinewine.com",
        "winechateau.com",
        "www.bbr.com",
        "www.binnys.com",
        "www.hitimewine.net",
        "www.kavaklidere.com",
        "www.klwines.com",
        "www.slurp.co.uk",
        "www.tanners-wines.co.uk",
    ),
    **_group(
        "public",
        "the training-image collector and city discovery: a restaurant name and city "
        "typed by an operator, or a city, or a wine name -- no house record is read or sent",
        "maps.googleapis.com",
        "places.googleapis.com",
        "api.apify.com",
        "api.yelp.com",
        "www.vivino.com",
        "www.opentable.com",
    ),
    **_group(
        "public",
        "wine-name lookups reachable only from a stub task that researches nothing "
        "today (jobs/tasks.py research_unknowns_task); a query would carry a wine's name only",
        "www.cellartracker.com",
        "www.wine-searcher.com",
    ),
    **_group(
        "public",
        "sovereign-cloud sign-in hosts allowed for an operator's issuer/JWKS override: "
        "only Microsoft's public signing keys are fetched from them",
        "login.microsoftonline.us",
        "login.microsoftonline.de",
        "login.partner.microsoftonline.cn",
    ),
}

# Every third-party package the scanned code imports: (target, reason).
PACKAGES: dict[str, tuple[str, str]] = {
    # SDKs that send to a subprocessor
    "js:@sentry/node": ("sentry.io", "error events to the DSN's Sentry ingest host"),
    "py:sentry_sdk": ("sentry.io", "error events to the DSN's Sentry ingest host"),
    "js:@supabase/supabase-js": (
        "supabase.co",
        "the database, auth and storage at SUPABASE_URL",
    ),
    "py:supabase": ("supabase.co", "the database, auth and storage at SUPABASE_URL"),
    "py:postgrest": ("supabase.co", "Supabase's REST layer"),
    "py:asyncpg": (
        "supabase.co",
        "direct Postgres, which is Supabase's (operator migration tool)",
    ),
    "py:psycopg2": (
        "supabase.co",
        "direct Postgres, which is Supabase's (operator import tool)",
    ),
    "py:anthropic": ("api.anthropic.com", "Anthropic's SDK"),
    "py:openai": (
        "api.openai.com",
        "OpenAI's SDK (auction-wine research; only with a key)",
    ),
    "py:google.genai": ("generativelanguage.googleapis.com", "the Gemini SDK"),
    "py:google.generativeai": (
        "generativelanguage.googleapis.com",
        "the older Gemini SDK",
    ),
    "js:googleapis": (
        "gmail.googleapis.com, www.googleapis.com",
        "Gmail send/watch and Google APIs",
    ),
    "js:google-auth-library": (
        "oauth2.googleapis.com",
        "Google token exchange and push-auth verification",
    ),
    "js:passport-google-oauth20": (
        "accounts.google.com, oauth2.googleapis.com, www.googleapis.com",
        "Google sign-in: consent page, token exchange, profile",
    ),
    "js:passport-azure-ad": ("login.microsoftonline.com", "Microsoft sign-in"),
    "js:nodemailer": ("smtp.gmail.com", "SMTP to Gmail (gmail.service.ts)"),
    "py:aiosmtplib": ("smtp.gmail.com", "SMTP to Gmail (email_client.py)"),
    "py:sendgrid": (
        "api.sendgrid.com",
        "SendGrid's SDK, one of email_client.py's mail paths",
    ),
    "js:plivo": ("api.plivo.com", "Plivo's SDK"),
    "py:plivo": ("api.plivo.com", "Plivo's SDK"),
    "js:web-push": (
        "fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com, "
        "notify.windows.com",
        "Web Push to the endpoint in the browser's subscription",
    ),
    "py:pywebpush": (
        "fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com, "
        "notify.windows.com",
        "Web Push to the endpoint in the browser's subscription",
    ),
    "js:amqplib": (
        "cloudamqp.com",
        "RabbitMQ at RABBITMQ_URL, which is CloudAMQP in production",
    ),
    "py:aio_pika": (
        "cloudamqp.com",
        "RabbitMQ at RABBITMQ_URL, which is CloudAMQP in production",
    ),
    "js:redis": ("upstash.io", "Redis at REDIS_URL, which is Upstash in production"),
    "py:redis": ("upstash.io", "Redis at REDIS_URL, which is Upstash in production"),
    "py:celery": (
        "upstash.io, cloudamqp.com",
        "broker and result URLs come from env (config/"
        "settings.py:68-73, Redis by default); production runs Redis on Upstash and "
        "RabbitMQ on CloudAMQP",
    ),
    # Generic clients: their destinations are the literals the host scan already classifies
    "js:axios": (LOCAL, "generic HTTP client"),
    "py:httpx": (LOCAL, "generic HTTP client"),
    "py:aiohttp": (LOCAL, "generic HTTP client"),
    "py:requests": (LOCAL, "generic HTTP client"),
    "py:playwright": (
        LOCAL,
        "a headless browser; it opens the URL literals the host scan classifies",
    ),
    # No outbound peer
    **{
        k: (LOCAL, "framework, server or in-process library; no outbound peer")
        for k in (
            "js:@nestjs/common",
            "js:@nestjs/config",
            "js:@nestjs/core",
            "js:@nestjs/jwt",
            "js:@nestjs/passport",
            "js:@nestjs/platform-express",
            "js:@nestjs/schedule",
            "js:@nestjs/swagger",
            "js:@nestjs/websockets",
            "js:bcrypt",
            "js:class-transformer",
            "js:class-validator",
            "js:exceljs",
            "js:express",
            "js:ical-generator",
            "js:multer",
            "js:passport-jwt",
            "js:pdf-lib",
            "js:rxjs",
            "js:socket.io",
            "py:PIL",
            "py:PyPDF2",
            "py:apscheduler",
            "py:dotenv",
            "py:easyocr",
            "py:fastapi",
            "py:jinja2",
            "py:jwt",
            "py:numpy",
            "py:pdf2image",
            "py:pydantic",
            "py:pythonjsonlogger",
            "py:pytz",
            "py:rapidfuzz",
            "py:surya",
            "py:tenacity",
            "py:ultralytics",
            "py:unidecode",
            "py:uvicorn",
            "py:weasyprint",
        )
    },
    "py:prometheus_client": (
        LOCAL,
        "exposes a metrics endpoint to be scraped; sends nothing",
    ),
    "py:opentelemetry": (
        LOCAL,
        "not in requirements.txt; the exporter defaults to the console and "
        "an OTLP endpoint would have to be configured -- name it here if one ever is",
    ),
}

# Subprocessors no line of the scanned code names, and why they are still named.
NAMED_WITHOUT_CODE: dict[str, str] = {
    "railway.app": "the gateway and the orchestrator run on Railway (vercel.json's /api rewrite "
    "targets *.up.railway.app); hosting has no call site",
    "vercel.com": "the web app is served by Vercel, and vercel.json relays /api/* through it; "
    "apps/web is outside this scan",
}


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def strip_js_comments(src: str) -> str:
    """Blank out // and /* */ comments, keeping strings, templates and regex
    literals intact and every newline in place (so line numbers survive)."""
    out: list[str] = []
    i, n = 0, len(src)
    stack: list[str] = []  # "tpl" for template, "brace" for ${ } code inside a template
    prev_sig = ""  # last significant non-space char in code, for regex detection

    def blank(s: str) -> str:
        return "".join(c if c == "\n" else " " for c in s)

    while i < n:
        c = src[i]
        in_tpl = bool(stack) and stack[-1] == "tpl"
        if in_tpl:
            if c == "\\":
                out.append(src[i : i + 2])
                i += 2
                continue
            if c == "`":
                stack.pop()
                out.append(c)
                i += 1
                prev_sig = "`"
                continue
            if c == "$" and i + 1 < n and src[i + 1] == "{":
                stack.append("brace")
                out.append("${")
                i += 2
                prev_sig = "{"
                continue
            out.append(c)
            i += 1
            continue
        # code (top level or inside ${ })
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j == -1 else j
            out.append(blank(src[i:j]))
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append(blank(src[i:j]))
            i = j
            continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(src[i : j + 1])
            i = j + 1
            prev_sig = c
            continue
        if c == "`":
            stack.append("tpl")
            out.append(c)
            i += 1
            continue
        if c == "/" and (
            prev_sig == ""
            or prev_sig in "(,=:[!&|?{};+-*%<>~^"
            or _ends_with_keyword(out)
        ):
            j = i + 1
            in_class = False
            while j < n and src[j] != "\n":
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    break
                j += 1
            out.append(src[i : j + 1])
            i = j + 1
            prev_sig = "/"
            continue
        if c == "{" and stack:
            stack.append("brace")
        elif c == "}" and stack and stack[-1] == "brace":
            stack.pop()
            if stack and stack[-1] == "tpl":
                out.append(c)
                i += 1
                continue
        if not c.isspace():
            prev_sig = c
        out.append(c)
        i += 1
    return "".join(out)


def _ends_with_keyword(out: list[str]) -> bool:
    tail = "".join(out[-12:]).rstrip()
    return bool(
        re.search(
            r"(?:^|[^\w$])(?:return|typeof|case|in|of|delete|void|throw|new)$", tail
        )
    )


def py_code_strings(src: str) -> list[tuple[int, str]] | None:
    """Every string constant in Python CODE, docstrings excluded. None when the
    file does not parse (the caller reports it: a file the guard cannot read is
    a file it cannot vouch for)."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(
            node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                docstrings.add(id(body[0].value))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in docstrings
        ):
            found.append((getattr(node, "lineno", 0), node.value))
    return found


JS_IMPORT_RE = re.compile(
    r"""(?:^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*|^[ \t]*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']""",
    re.M,
)


def package_root(spec: str) -> str | None:
    if spec.startswith((".", "/", "node:")) or spec.startswith("src/"):
        return None
    parts = spec.split("/")
    return "/".join(parts[:2]) if spec.startswith("@") else parts[0]


NODE_BUILTINS = {
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "crypto",
    "dns",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "querystring",
    "readline",
    "stream",
    "string_decoder",
    "timers",
    "tls",
    "url",
    "util",
    "v8",
    "vm",
    "worker_threads",
    "zlib",
}


def python_local_modules(repo: Path) -> set[str]:
    """Top-level names that are this repo's own Python packages/modules."""
    names: set[str] = set()
    for root in (
        repo / "services" / "agent-orchestrator",
        repo / "services" / "self-evolution",
        repo / "services" / "database",
        repo / "services",
    ):
        if not root.is_dir():
            continue
        for p in root.iterdir():
            if p.is_dir() and not p.name.startswith("."):
                names.add(p.name)
            elif p.suffix == ".py":
                names.add(p.stem)
    return names


def iter_files(repo: Path):
    for root in SCAN_ROOTS:
        base = repo / root
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*")):
            if not p.is_file() or p.suffix not in SUFFIXES:
                continue
            rel = p.relative_to(repo)
            if rel == TERMS:  # the list itself is what is checked, never a finding
                continue
            if any(part in EXCLUDE_DIRS for part in rel.parts):
                continue
            if TEST_FILE.search(rel.as_posix()):
                continue
            yield rel, p


def hosts_in(text: str) -> list[str]:
    found = [m.group(1).lower().rstrip(".") for m in URL_RE.finditer(text)]
    t = text.strip().lower()
    if BARE_HOST_RE.match(t):
        found.append(t)
    return found


def scan(repo: Path):
    hosts: dict[str, list[str]] = {}
    imports: dict[str, list[str]] = {}
    errors: list[str] = []
    stdlib = set(getattr(sys, "stdlib_module_names", ()))
    local_py = python_local_modules(repo)
    files = 0

    def add(d: dict[str, list[str]], k: str, loc: str) -> None:
        d.setdefault(k, []).append(loc)

    for rel, path in iter_files(repo):
        files += 1
        src = path.read_text(encoding="utf-8", errors="replace")
        relp = rel.as_posix()
        if path.suffix == ".py":
            strings = py_code_strings(src)
            if strings is None:
                errors.append(f"{relp}: does not parse as Python")
                continue
            for line, s in strings:
                for h in hosts_in(s):
                    add(hosts, h, f"{relp}:{line}")
            try:
                tree = ast.parse(src)
            except SyntaxError:  # pragma: no cover - already reported
                continue
            for node in ast.walk(tree):
                mods: list[str] = []
                if isinstance(node, ast.Import):
                    mods = [a.name for a in node.names]
                elif (
                    isinstance(node, ast.ImportFrom) and node.level == 0 and node.module
                ):
                    # `from google import genai` names the SDK in the imported name
                    mods = (
                        [f"google.{a.name}" for a in node.names]
                        if node.module == "google"
                        else [node.module]
                    )
                for m in mods:
                    top = m.split(".")[0]
                    if top in stdlib or top in local_py or top == "__future__":
                        continue
                    # google.genai / google.generativeai / google.cloud.x are distinct SDKs
                    key = ".".join(m.split(".")[:2]) if top == "google" else top
                    add(imports, "py:" + key, f"{relp}:{node.lineno}")
        else:
            code = strip_js_comments(src)
            for lineno, line in enumerate(code.split("\n"), 1):
                for m in re.finditer(r"""(["'`])((?:\\.|(?!\1).)*)\1""", line):
                    for h in hosts_in(m.group(2)):
                        add(hosts, h, f"{relp}:{lineno}")
            for m in JS_IMPORT_RE.finditer(code):
                root = package_root(m.group(1))
                if root is None or root in NODE_BUILTINS:
                    continue
                lineno = code.count("\n", 0, m.start()) + 1
                add(imports, "js:" + root, f"{relp}:{lineno}")
    if files == 0:
        errors.append("no source files found under the scan roots")
    return hosts, imports, errors


# --------------------------------------------------------------------------
# The terms' own list
# --------------------------------------------------------------------------


def read_subprocessor_hosts(repo: Path) -> list[str] | None:
    p = repo / TERMS
    if not p.is_file():
        return None
    src = strip_js_comments(p.read_text(encoding="utf-8"))
    m = re.search(
        r"export const SUBPROCESSORS\s*:[^=]*=\s*\[(.*?)\n\]\s*as const;", src, re.S
    )
    if not m:
        return None
    hosts: list[str] = []
    for field in re.findall(r"""\bhost:\s*["']([^"']+)["']""", m.group(1)):
        hosts += [h.strip().lower() for h in field.split(",") if h.strip()]
    return hosts or None


def named_by(host: str, names: list[str]) -> str | None:
    """The most specific SUBPROCESSORS host that names `host` (itself, or a
    parent domain of it), or None."""
    best = None
    for n in names:
        if (host == n or host.endswith("." + n)) and (
            best is None or len(n) > len(best)
        ):
            best = n
    return best


def evaluate(
    repo: Path, excused=None, packages=None, named_without_code=None, out=print
) -> int:
    excused = EXCUSED_HOSTS if excused is None else excused
    packages = PACKAGES if packages is None else packages
    named_without_code = (
        NAMED_WITHOUT_CODE if named_without_code is None else named_without_code
    )

    if not getattr(sys, "stdlib_module_names", None):
        out(
            "CANNOT CHECK: Python 3.10+ is needed to tell the standard library from a third-party SDK"
        )
        return 2
    names = read_subprocessor_hosts(repo)
    if names is None:
        out(f"CANNOT CHECK: no SUBPROCESSORS host list found in {TERMS}")
        return 2
    for h, (cat, why) in excused.items():
        if cat not in CATEGORIES or not why.strip():
            out(
                f"CANNOT CHECK: EXCUSED_HOSTS[{h!r}] needs a category in {sorted(CATEGORIES)} and a reason"
            )
            return 2
    for pkg, (_t, why) in packages.items():
        if not why.strip():
            out(f"CANNOT CHECK: PACKAGES[{pkg!r}] needs a reason")
            return 2
    hosts, imports, errors = scan(repo)
    if errors:
        for e in errors:
            out(f"CANNOT CHECK: {e}")
        return 2
    if not hosts or not imports:
        out(
            "CANNOT CHECK: the scan found no hosts or no imports -- the extractor has rotted"
        )
        return 2

    violations: list[str] = []
    reached: set[str] = set()
    used_excuses: set[str] = set()

    for host, locs in sorted(hosts.items()):
        n = named_by(host, names)
        if n:
            reached.add(n)
            if host in excused:
                violations.append(
                    f"{host}: both NAMED ({n}) and EXCUSED -- a host is one or the other"
                )
            continue
        if host in excused:
            used_excuses.add(host)
            continue
        violations.append(
            f"{host}: neither named in SUBPROCESSORS nor excused -- first seen at {locs[0]}"
            + (f" (+{len(locs) - 1} more)" if len(locs) > 1 else "")
        )

    used_packages: set[str] = set()
    for pkg, locs in sorted(imports.items()):
        if pkg not in packages:
            violations.append(
                f"{pkg}: imported at {locs[0]} but not classified in PACKAGES (a subprocessor host, or LOCAL)"
            )
            continue
        used_packages.add(pkg)
        target, _why = packages[pkg]
        if target == LOCAL:
            continue
        for t in (x.strip() for x in target.split(",")):
            n = named_by(t, names)
            if not n:
                violations.append(
                    f"{pkg}: sends to {t} (PACKAGES), which SUBPROCESSORS does not name -- imported at {locs[0]}"
                )
            else:
                reached.add(n)

    for n in names:
        if n not in reached and n not in named_without_code:
            violations.append(
                f"SUBPROCESSORS host {n}: nothing in the code reaches it and NAMED_WITHOUT_CODE gives no reason"
            )
    for n in named_without_code:
        if n not in names:
            violations.append(f"NAMED_WITHOUT_CODE[{n!r}] is not a SUBPROCESSORS host")
    for h in sorted(set(excused) - used_excuses):
        if named_by(h, names) is None:
            violations.append(
                f"EXCUSED_HOSTS[{h!r}] excuses nothing the scan found -- delete it"
            )
    for p in sorted(set(packages) - used_packages):
        violations.append(
            f"PACKAGES[{p!r}] classifies a package nothing imports -- delete it"
        )

    if violations:
        out(
            f"FAIL: {len(violations)} finding(s) against the data terms' SUBPROCESSORS ({TERMS})"
        )
        for v in violations:
            out("  - " + v)
        out(
            "Name the host in SUBPROCESSORS (and EXTERNAL_CONNECTIONS.md §2), or excuse it here with the reason no house data reaches it."
        )
        return 1
    out(
        f"PASS: {len(hosts)} hosts and {len(imports)} imported packages; {len(names)} subprocessors named, "
        f"{len(used_excuses)} hosts excused"
    )
    return 0


# --------------------------------------------------------------------------
# Self-test: the guard must be able to go red (memory: checks-cannot-see-their-own-removal)
# --------------------------------------------------------------------------


def _fixture(root: Path, subprocessors: list[str], files: dict[str, str]) -> None:
    t = root / TERMS
    t.parent.mkdir(parents=True, exist_ok=True)
    rows = "\n".join(
        f'  {{ name: "x", host: "{h}", what: "w", when: "w", masked: false }},'
        for h in subprocessors
    )
    t.write_text(
        f"export const SUBPROCESSORS: readonly Subprocessor[] = [\n{rows}\n] as const;\n"
    )
    for rel, body in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body)


def self_test() -> int:
    quiet = lambda *_a, **_k: None  # noqa: E731
    base_files = {
        "apps/api-gateway/src/push.ts": 'import axios from "axios";\nconst URL = "https://exp.host/--/api/v2/push/send";\n'
        "// see https://docs.example.org/in-a-comment\n"
        'const re = /"https:\\/\\/not-a-host/;\n',
        "services/x/client.py": '"""Docs: https://docstring.example.org"""\nimport httpx\nBASE = "https://api.vendor.ai/v1"\n'
        "# https://comment.example.org\n",
    }
    pk = {"js:axios": (LOCAL, "generic client"), "py:httpx": (LOCAL, "generic client")}
    cases = [
        ("all named", ["exp.host", "api.vendor.ai"], base_files, {}, pk, 0),
        ("a name removed", ["api.vendor.ai"], base_files, {}, pk, 1),
        (
            "a new host added",
            ["exp.host", "api.vendor.ai"],
            {**base_files, "services/x/new.py": 'U = "https://api.newcomer.com/x"\n'},
            {},
            pk,
            1,
        ),
        (
            "a bare hostname added",
            ["exp.host", "api.vendor.ai"],
            {**base_files, "services/x/smtp.py": 'HOST = "smtp.newmail.com"\n'},
            {},
            pk,
            1,
        ),
        (
            "excused with a reason",
            ["exp.host", "api.vendor.ai"],
            {**base_files, "services/x/new.py": 'U = "https://www.statute.gov/x"\n'},
            {"www.statute.gov": ("reference", "a citation")},
            pk,
            0,
        ),
        (
            "excuse without a reason",
            ["exp.host", "api.vendor.ai"],
            base_files,
            {"api.vendor.ai": ("reference", "")},
            pk,
            2,
        ),
        (
            "dead excuse",
            ["exp.host", "api.vendor.ai"],
            base_files,
            {"gone.example.com": ("reference", "was a citation")},
            pk,
            1,
        ),
        (
            "unclassified sdk",
            ["exp.host", "api.vendor.ai"],
            {
                **base_files,
                "apps/api-gateway/src/s.ts": 'import Stripe from "stripe";\n',
            },
            {},
            pk,
            1,
        ),
        (
            "sdk to an unnamed host",
            ["exp.host", "api.vendor.ai"],
            {
                **base_files,
                "apps/api-gateway/src/s.ts": 'import Stripe from "stripe";\n',
            },
            {},
            {**pk, "js:stripe": ("api.stripe.com", "billing")},
            1,
        ),
        (
            "sdk to a named host",
            ["exp.host", "api.vendor.ai", "stripe.com"],
            {
                **base_files,
                "apps/api-gateway/src/s.ts": 'import Stripe from "stripe";\n',
            },
            {},
            {**pk, "js:stripe": ("api.stripe.com", "billing")},
            0,
        ),
        (
            "dead name",
            ["exp.host", "api.vendor.ai", "nobody.calls.io"],
            base_files,
            {},
            pk,
            1,
        ),
        (
            "a test file is out of scope",
            ["exp.host", "api.vendor.ai"],
            {
                **base_files,
                "apps/api-gateway/src/a.spec.ts": 'const u = "https://api.testonly.com";\n',
            },
            {},
            pk,
            0,
        ),
        (
            "dead package row",
            ["exp.host", "api.vendor.ai"],
            base_files,
            {},
            {**pk, "js:gone": (LOCAL, "was imported once")},
            1,
        ),
    ]
    failures = 0
    for name, subs, files, exc, pkgs, want in cases:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _fixture(root, subs, files)
            got = evaluate(
                root, excused=exc, packages=pkgs, named_without_code={}, out=quiet
            )
        ok = got == want
        failures += not ok
        print(f"  {'ok ' if ok else 'BAD'} {name}: exit {got} (want {want})")
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        _fixture(root, ["exp.host"], base_files)
        (root / TERMS).write_text("// the list moved\n")
        got = evaluate(root, excused={}, packages=pk, named_without_code={}, out=quiet)
        ok = got == 2
        failures += not ok
        print(f"  {'ok ' if ok else 'BAD'} terms list missing: exit {got} (want 2)")
    print("SELF-TEST " + ("PASS" if failures == 0 else f"FAIL ({failures})"))
    return 0 if failures == 0 else 1


def census() -> int:
    hosts, imports, errors = scan(REPO)
    for e in errors:
        print("ERROR", e)
    names = read_subprocessor_hosts(REPO) or []
    for h in sorted(hosts):
        tag = (
            "NAMED"
            if named_by(h, names)
            else ("EXCUSED:" + EXCUSED_HOSTS[h][0] if h in EXCUSED_HOSTS else "??")
        )
        print(f"host\t{h}\t{tag}\t{len(hosts[h])}\t{' '.join(hosts[h][:3])}")
    for p in sorted(imports):
        print(
            f"pkg\t{p}\t{PACKAGES.get(p, ('??', ''))[0]}\t{len(imports[p])}\t{' '.join(imports[p][:2])}"
        )
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    if "--census" in sys.argv[1:]:
        sys.exit(census())
    sys.exit(evaluate(REPO))
