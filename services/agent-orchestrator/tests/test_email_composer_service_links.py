"""
`_build_manager_review_html` (email_composer_service.py). This template IS
LIVE: `compose_manager_review_email` is the only caller of it, and its own
only caller is `provider_conversation_agent.py`, which is wired into the
real conversation flow.

Before this pass every "Approve & Send" / "Edit Message" / "Reject" / "Ask
for More" button pointed at `https://app.wineops.ai`, a domain that does not
resolve at all (curl -> connection failure). Fixing only the domain was not
enough: all four still deep-linked to
`/orders/{oid}?action=...&cid=...`, and nothing in apps/web reads `action` or
`cid` (OrdersNext.tsx reads only `order`/`station`), so four distinct
promises resolved to one identical, unfiltered order view -- and two of them
("Edit Message", "Ask for More") do not correspond to any real act at all
(ResponsesSheet.tsx's own header comment: Edit ran `openCreateOrderFlow()` on
an empty form, Ask for More `alert()`ed a fabricated follow-up). This pins
the fix: one honest link, no `action`/`cid` params, opening the order itself
(`/orders/:id`, which now has a real route — App.tsx) where the draft and the
real Confirm/Reject ceremony live.
"""

from unittest.mock import MagicMock

from services.email_composer_service import EmailComposerService


def _service() -> EmailComposerService:
    return EmailComposerService(database=MagicMock(), config={"mock_mode": True})


def test_one_honest_link_never_uses_the_dead_domain(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com")
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1", "urgency": "high"}
    )

    assert "app.wineops.ai" not in html
    assert 'href="https://mudavym.com/orders/ord-9"' in html
    # The four dead action/cid promises this replaced -- nothing in apps/web
    # reads `action` or `cid`, and two of the four acts do not exist at all.
    assert "action=" not in html
    assert "cid=" not in html
    assert "Approve" not in html
    assert "Edit Message" not in html
    assert "Ask for More" not in html
    # Exactly one CTA link, not four.
    assert html.count("/orders/ord-9") == 1

    get_settings.cache_clear()


def test_falls_back_to_mudavym_when_frontend_url_is_unset(monkeypatch):
    """ADR 0149 row 45: unset FRONTEND_URL outside development/DEBUG defaults
    to https://mudavym.com, not localhost. Previously this test's name
    claimed this while only asserting `app.wineops.ai`'s absence -- the
    measured href actually started with `http://localhost:5173`. Now the
    code and the assertion agree."""
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1"}
    )

    assert "app.wineops.ai" not in html
    assert 'href="https://mudavym.com/orders/ord-9"' in html

    get_settings.cache_clear()


def test_falls_back_to_mudavym_when_frontend_url_and_environment_are_unset(monkeypatch):
    """The real production shape ADR 0149 row 45 exists to
    guard: a deploy that never sets ENVIRONMENT at all (not `"production"`,
    just absent) -- unlike the test above, which sets ENVIRONMENT=production
    explicitly. This is the case settings.py:166's `self.environment`
    (`os.getenv("ENVIRONMENT", "development")`) turns into a silent
    `"development"`. Mutation check: reverting settings.py's frontend_url
    condition to `self.environment == "development"` fails this test (it
    asserts localhost instead of mudavym.com); the fix reads
    `os.getenv("ENVIRONMENT")` directly, so unset is not development."""
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("DEBUG", raising=False)
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1"}
    )

    assert "app.wineops.ai" not in html
    assert 'href="https://mudavym.com/orders/ord-9"' in html
    assert "localhost" not in html

    get_settings.cache_clear()


def test_falls_back_to_localhost_when_frontend_url_is_unset_in_development(monkeypatch):
    """ADR 0149 row 45's other half: the localhost fallback survives, but
    only behind ENVIRONMENT=development (or DEBUG=true) -- never as the
    unconditional default."""
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.delenv("DEBUG", raising=False)
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1"}
    )

    assert "app.wineops.ai" not in html
    assert 'href="http://localhost:5173/orders/ord-9"' in html

    get_settings.cache_clear()


def test_falls_back_to_localhost_when_frontend_url_is_unset_with_debug(monkeypatch):
    """ADR 0149 row 45: DEBUG=true also unlocks the localhost fallback, even
    outside ENVIRONMENT=development."""
    monkeypatch.delenv("FRONTEND_URL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "true")
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1"}
    )

    assert "app.wineops.ai" not in html
    assert 'href="http://localhost:5173/orders/ord-9"' in html

    get_settings.cache_clear()


def test_uses_first_origin_when_frontend_url_is_comma_separated(monkeypatch):
    """R1/F5 (mutation M-f1): `os.getenv("FRONTEND_URL")`
    hands back the whole comma-separated CORS allow-list (`cors-origins.ts`'s
    shape, e.g. "https://mudavym.com,https://www.mudavym.com"), and nothing
    before this test caught a Python link builder reading it unparsed --
    `settings.py` reading FRONTEND_URL raw (dropping `_canonical_origin`)
    still passed 17/17 of this file's tests. `_canonical_origin` must take
    only the first origin, never the raw comma-joined string."""
    monkeypatch.setenv("FRONTEND_URL", "https://mudavym.com,https://www.mudavym.com")
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DEBUG", "false")
    from config.settings import get_settings

    get_settings.cache_clear()
    svc = _service()

    html = svc._build_manager_review_html(
        {"order_id": "ord-9", "conversation_id": "conv-1"}
    )

    assert 'href="https://mudavym.com/orders/ord-9"' in html
    # The raw comma-joined string must never leak into the mailed href --
    # scoped to the href itself (the surrounding template's inline CSS has
    # commas of its own, e.g. `font-family:-apple-system,BlinkMacSystemFont`).
    assert 'href="https://mudavym.com,https://www.mudavym.com/orders/ord-9"' not in html
    assert "www.mudavym.com" not in html

    get_settings.cache_clear()
