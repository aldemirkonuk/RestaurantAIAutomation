"""ADR 0170: a vendor email body is text, never markup (Python half).

EmailComposerService._wrap_html builds the HTML that
provider_conversation_agent.py sends to the vendor as `bodyHtml`, via
send_via_gateway. The body is LLM-drafted. Before this fix it was split into
<p> blocks without escaping, and order_ref went into the Ref line raw, so a
draft saying '<a href=...>' reached the vendor as a live link under the
restaurant's name.

Run: python -m pytest tests/test_vendor_mail_is_escaped.py
"""

import re

from services.email_composer_service import EmailComposerService


def _wrap(body, tags=None):
    # _wrap_html reads no instance state; skip __init__ (settings, Gemini).
    svc = object.__new__(EmailComposerService)
    return svc._wrap_html(body, tags or {})


def _paragraphs(html):
    return re.findall(
        r'<p style="margin: 0 0 12px; line-height: 1.6;">(.*?)</p>', html, re.S
    )


def test_html_looking_body_arrives_as_visible_text():
    out = _wrap('Hi,\n\nPay here: <a href="https://evil.example">invoice</a>')
    assert "<a " not in out
    assert "&lt;a href=&quot;https://evil.example&quot;&gt;invoice&lt;/a&gt;" in out


def test_plain_text_with_brackets_and_ampersands_is_escaped():
    paras = _paragraphs(_wrap("Qty < 5 & price > $10\nthanks"))
    assert paras == ["Qty &lt; 5 &amp; price &gt; $10<br/>thanks"]


def test_escaping_happens_before_line_breaks_are_written():
    # If <br/> were written first and then escaped, it would show as text.
    paras = _paragraphs(_wrap("a\nb"))
    assert paras == ["a<br/>b"]


def test_paragraph_shape_is_kept():
    assert _paragraphs(_wrap("Hi there,\n\nLine one\nLine two\n\n   \n\nBye")) == [
        "Hi there,",
        "Line one<br/>Line two",
        "Bye",
    ]


def test_order_ref_is_escaped():
    out = _wrap("Hello", {"order_number": '<script>x</script>"'})
    assert "<script>" not in out
    assert "Ref: &lt;script&gt;x&lt;/script&gt;&quot;" in out


def test_only_the_wrappers_own_tags_survive_a_hostile_body():
    out = _wrap(
        "<img src=x onerror=alert(1)>\n\n<style>*{}</style>", {"order_id": "o-1"}
    )
    tags = set(re.findall(r"<\s*([a-zA-Z!/]+)", out))
    assert tags <= {
        "!DOCTYPE",
        "html",
        "/html",
        "head",
        "/head",
        "meta",
        "body",
        "/body",
        "table",
        "/table",
        "tr",
        "/tr",
        "td",
        "/td",
        "p",
        "/p",
        "br/",
    }


def test_none_body_is_empty_not_a_crash():
    assert _paragraphs(_wrap(None)) == []
