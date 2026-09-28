#!/usr/bin/env python3
"""Sketch 106 — the app shell, three directions. Emits direction-{a,b,c}.html.

Edit THIS file, not the HTML: the three files share the built header, the page
stand-in, the tokens and the fit-to-width script, and they would drift apart if
hand-edited. Run:  python3 build.py
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────────────────────────────────────────────────────
# The mark — BrandMark.tsx AM_PATHS verbatim (ADR 0047), 483×574, currentColor
# ─────────────────────────────────────────────────────────────────────────────
AM_PATHS = [
    'M0 38H72V540H0Z', 'M15 38H96L460 574H379Z', 'M0 346H305L353 416H0Z',
    'M0 470H137V540H0Z', 'M99 0H151L278.7 187.8L284.8 273Z',
    'M389.5 40H460.9L284.8 273L251.4 224Z', 'M412 40H483V574H412Z',
    'M80 150V192H108Z', 'M142 346H206L174 292Z', 'M404 138L376 157L404 176Z',
    'M383 430H404V470Z',
]


def mark(h: int = 24, cls: str = '') -> str:
    w = round(h * 483 / 574)
    paths = ''.join(f'<path d="{d}"/>' for d in AM_PATHS)
    return (f'<svg class="{cls}" width="{w}" height="{h}" viewBox="0 0 483 574" aria-hidden="true">'
            f'<g fill="currentColor">{paths}</g></svg>')


def wordmark(size: int = 13) -> str:
    return (f'<span class="wm" style="font-size:{size}px" translate="no">Mudavym'
            f'<span class="wm-stop">.</span></span>')


# ─────────────────────────────────────────────────────────────────────────────
# Houses — one US, one Turkish. Formats are what Intl would print for the locale.
# ─────────────────────────────────────────────────────────────────────────────
US = dict(
    name='Larkspur &amp; Vine', place='Oakland, CA', person='Maya Ferrante', initial='M',
    role='Owner', locale='en-US', currency='USD', date='Thu 17 Sep 2026', clock='14:02:11',
    money=['$3,910.00', '$1,284.50', '$642.18', '$2,105.00', '$3,880.00'],
    vendors=['Kermit Lynch', 'Southern Glazer&#8217;s', 'Chambers &amp; Chambers', 'Revel Wine', 'Kermit Lynch'],
    manager='Maya', alcohol_free=False,
)
TR = dict(
    name='Sim Meyhouse', place='Kadıköy, İstanbul', person='Ayşe Demir', initial='A',
    role='Staff', locale='tr-TR', currency='TRY', date='17.09.2026', clock='14:02:11',
    money=['₺12.480,00', '₺3.150,00', '₺1.920,00', '₺7.640,00', '₺12.480,00'],
    vendors=['Kavaklıdere', 'Doluca', 'Suvla', 'Efes', 'Kavaklıdere'],
    manager='Kerem', alcohol_free=False,  # a meyhane pours; the room reads Non-alcoholic, not Soft drinks
)

# ─────────────────────────────────────────────────────────────────────────────
# Shared CSS
# ─────────────────────────────────────────────────────────────────────────────
COMMON_CSS = r"""
/* ── the sketch's own page: light paper, so the charcoal frames read as the product ── */
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#f3efe6;color:#211c16;font-family:'DM Sans','Plus Jakarta Sans',system-ui,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.sk-band{padding:34px 40px 8px;max-width:1360px}
.sk-band h1{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:26px;letter-spacing:-.01em;margin:0 0 6px;color:#211c16}
.sk-band h2{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:19px;letter-spacing:-.01em;margin:0}
.sk-sub{font-size:13.5px;color:#4f473c;max-width:880px;margin:6px 0 0}
.sk-label{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#665d50;padding:26px 40px 8px}
.sk-label small{display:block;text-transform:none;letter-spacing:0;font-family:'DM Sans',system-ui,sans-serif;font-size:12.5px;color:#4f473c;margin-top:3px}
.sk-note{margin:10px 40px 0;font-size:12.5px;color:#4f473c;max-width:900px}
.sk-row{display:flex;flex-wrap:wrap;gap:24px;padding:0 40px;align-items:flex-start}
.fit{margin:0 auto}
.fitwrap{padding:0 12px}
@media (max-width:560px){.sk-band,.sk-label,.sk-note{padding-left:14px;padding-right:14px}.sk-row{padding:0 12px;gap:14px}}
.sk-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px 28px;margin:14px 40px 0;max-width:1160px;font-size:12.5px;color:#4f473c}
.sk-legend b{color:#211c16;font-weight:600}
.sk-foot{padding:40px;font-size:12px;color:#665d50;max-width:900px}

/* ── the product's tokens (styles/mudavym.css, ADR 0042 · ADR 0138: charcoal is the ground) ── */
.mudavym,.mudavym[data-ground="charcoal"]{
  --seal:#5FB0BC;--seal-deep:#7DC3CD;--seal-tint:rgba(95,176,188,.14);--seal-ring:rgba(95,176,188,.38);
  --paper-0:#15130F;--paper-1:#1D1813;--paper-2:#262019;
  --ink-1:#EFE7D9;--ink-2:#C0B6A5;--ink-3:#8E8576;--ink-4:#ABA294;
  --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  --serif:'Fraunces',Georgia,serif;--sans:'DM Sans','Plus Jakarta Sans',system-ui,sans-serif;
  --house:cubic-bezier(.16,1,.3,1);
  color-scheme:dark;background:var(--paper-0);color:var(--ink-1);font-family:var(--sans)}
.mudavym[data-ground="paper"]{
  --seal:#1a5e6b;--seal-deep:#14515c;--seal-tint:rgba(26,94,107,.1);--seal-ring:rgba(26,94,107,.32);
  --paper-0:#fffdf8;--paper-1:#f3efe6;--paper-2:#eae4d8;
  --ink-1:#211c16;--ink-2:#4f473c;--ink-3:#7c7365;--ink-4:#665d50;color-scheme:light}
/* ADR 0149 row 30 (OD-112): --ink-3 is decorative only — captions on paper use --ink-4 (5.64:1, AA) */
.mudavym[data-ground="paper"] .toast__eyebrow,.mudavym[data-ground="paper"] .toast__sub,
.mudavym[data-ground="paper"] .kbd,.mudavym[data-ground="paper"] .entry .eyebrow{color:var(--ink-4)}

/* ── frames ── */
.frame{position:relative;width:1440px;min-height:880px;overflow:hidden;border:1px solid #b6ad9e;box-shadow:0 1px 0 rgba(0,0,0,.04)}
.frame--short{min-height:560px}
.phone{position:relative;width:390px;height:844px;overflow:hidden;border:1px solid #b6ad9e;flex:none}
.wm{font-family:var(--serif);font-weight:600;letter-spacing:-.02em;line-height:1;color:var(--ink-1)}
.wm-stop{color:var(--seal)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.kbd{flex:none;font-family:var(--mono);font-size:10px;font-weight:500;color:var(--ink-3);background:var(--paper-1);border:1px solid var(--paper-2);border-radius:5px;padding:1px 5px;white-space:nowrap}
.eyebrow{display:block;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--seal-deep)}
.sect{display:block;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.link{font-family:var(--sans);font-size:12px;font-weight:500;color:var(--seal-deep);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
.link:hover{text-decoration:underline;text-underline-offset:2px}
.btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--sans);font-size:12.5px;font-weight:500;padding:8px 14px;border-radius:9px;border:1px solid var(--paper-2);background:transparent;color:var(--ink-1);cursor:pointer;transition:border-color 160ms var(--house),background-color 160ms var(--house)}
.btn:hover{border-color:var(--seal-ring)}
.btn--seal{background:var(--seal);border-color:var(--seal);color:var(--paper-0)}
.btn--seal:hover{background:var(--seal-deep);border-color:var(--seal-deep)}
.rule{height:1px;background:var(--paper-2)}
.quiet{color:var(--ink-3);font-size:12.5px;line-height:1.55}
.em{color:var(--ink-4)}

/* ── the house header, as built (components/mudavym/house-header.css) — ThemeMenu removed, ADR 0149 row 6 ── */
.hdr{position:relative;z-index:30;background:color-mix(in srgb,var(--paper-0) 88%,transparent);border-bottom:1px solid var(--paper-2)}
.hdr__in{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 24px}
.hdr__left{display:flex;align-items:center;gap:10px;min-width:0}
.hdr__mark{display:inline-flex;align-items:center;color:var(--seal);border-radius:6px;padding:2px}
.hdr__rule{width:1px;height:18px;background:var(--paper-2);flex:none}
.hdr__page{font-family:var(--serif);font-weight:600;font-size:15px;letter-spacing:-.01em;color:var(--ink-1);white-space:nowrap}
.hdr__search{display:inline-flex;align-items:center;gap:8px;margin:0 auto;padding:6px 10px 6px 11px;border:1px solid var(--paper-2);border-radius:9px;background:var(--paper-1);color:var(--ink-3);font-size:12.5px;cursor:pointer}
.hdr__search svg{flex:none}
.hdr__right{display:flex;align-items:center;gap:6px;margin-left:auto}
.hdr__house{font-size:12.5px;font-weight:500;color:var(--ink-2);padding:0 8px 0 2px;white-space:nowrap}
.hdr__btn{display:inline-flex;align-items:center;gap:7px;position:relative;padding:7px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--ink-2);cursor:pointer}
.hdr__btn--user{padding:5px 8px 5px 5px}
.hdr__avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:var(--seal-tint);color:var(--seal);font-size:11.5px;font-weight:700;flex:none}
.hdr__who{font-size:12.5px;font-weight:500;color:var(--ink-1);white-space:nowrap}
.hdr__chev{color:var(--ink-4);flex:none}
.hdr__badge{position:absolute;top:1px;right:0;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--seal);color:var(--paper-0);font-size:9.5px;font-weight:700;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}
.hdr__badge--unknown{min-width:9px;width:9px;height:9px;padding:0;top:4px;right:4px;background:transparent;border:1.5px dashed var(--ink-4)}
.hdr__dot{position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:999px;background:var(--seal)}
.hdr__menu{display:none;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--ink-2);flex:none;position:relative}
/* the header on a phone: the rooms toggle joins the bar (the legacy 'mobile top chrome' is deleted) */
.narrow .hdr__in{padding:0 10px;gap:8px;min-height:50px}
.narrow .hdr__menu{display:inline-flex}
.narrow .hdr__searchtext,.narrow .hdr__chord,.narrow .hdr__house,.narrow .hdr__who,.narrow .hdr__chev{display:none}
.narrow .hdr__search{margin:0 0 0 auto;padding:7px}
.narrow .hdr__rule{display:none}

/* ── page stand-in (looks like /orders · /receiving next; not part of this sketch) ── */
.pg{padding:26px 32px 40px;max-width:1080px}
.pg__eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:8px 0 0;display:flex;gap:14px;flex-wrap:wrap}
.pg h1{font-family:var(--serif);font-weight:500;font-size:27px;line-height:1.18;letter-spacing:-.012em;margin:10px 0 0;max-width:720px;color:var(--ink-1);text-wrap:balance}
.spine{display:flex;gap:0;margin:26px 0 0;border-top:1px solid var(--paper-2);border-bottom:1px solid var(--paper-2)}
.spine div{flex:1;padding:12px 14px 12px 0;border-right:1px solid var(--paper-2);margin-right:14px}
.spine div:last-child{border-right:0;margin-right:0}
.spine .n{font-family:var(--mono);font-size:22px;font-weight:500;color:var(--ink-1);letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.spine .l{font-size:11.5px;color:var(--ink-3);margin-top:2px}
.spine .n.em{color:var(--ink-4);font-weight:400}
.ledger{margin:22px 0 0}
.lrow{display:grid;grid-template-columns:1.6fr .7fr 1fr 1.1fr 1.6fr;gap:16px;align-items:center;padding:11px 0;border-bottom:1px solid var(--paper-2);font-size:13px;color:var(--ink-2)}
.lrow b{color:var(--ink-1);font-weight:500}
.lrow .money{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink-1);text-align:right}
.lrow .state{font-size:12px;color:var(--ink-2)}
.lrow .prov{font-size:11.5px;color:var(--ink-3)}
.lrow.h{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);padding:6px 0}
.lrow[data-active="true"]{background:var(--seal-tint);margin:0 -10px;padding:11px 10px;border-radius:6px;border-bottom-color:transparent}
.chip{display:inline-block;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);border:1px solid var(--paper-2);border-radius:4px;padding:1px 5px;margin-right:6px}
.chip--seal{color:var(--seal-deep);border-color:var(--seal-ring)}
.pg__foot{margin-top:36px;display:flex;align-items:center;gap:10px;color:var(--ink-4);font-size:11px}
.narrow .pg{padding:18px 16px 120px}
.narrow .pg h1{font-size:21px}
.narrow .spine{flex-wrap:wrap;border-bottom:0}
.narrow .spine div{flex:1 1 42%;min-width:0;border-right:0;margin-right:0;border-bottom:1px solid var(--paper-2);padding:10px 8px 10px 0}
.narrow .spine div:nth-child(odd){border-right:1px solid var(--paper-2);margin-right:12px}
.narrow .lrow{grid-template-columns:1fr auto;gap:4px 12px}
.narrow .lrow .prov{grid-column:1/-1}
.narrow .lrow.h{display:none}
.narrow .lrow .state{grid-column:1}
.narrow .lrow .money{grid-column:2;grid-row:1}
.narrow .lrow .lines{display:none}

/* ── skeleton: the dashboard's own (dashboard-next.css .dn-skel), quiet paper-2 bars with a slow sheen ── */
.skel{position:relative;overflow:hidden;background:var(--paper-2);border-radius:3px;height:12px}
.skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,var(--paper-1),transparent);animation:sheen 1.9s cubic-bezier(.45,0,.55,1) infinite}
@keyframes sheen{to{transform:translateX(100%)}}
.load-note{position:absolute;left:32px;bottom:24px;font-family:var(--mono);font-size:10.5px;color:var(--ink-3);display:flex;gap:12px;align-items:center}
.load-bar{position:absolute;left:0;right:0;top:0;height:2px;background:var(--paper-2);overflow:hidden}
.load-bar i{position:absolute;left:0;top:0;bottom:0;width:38%;background:var(--seal);animation:loadbar 1.4s var(--house) infinite}
@keyframes loadbar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}

/* ── the toast, shared anatomy (each direction docks it differently) ── */
.toast{width:372px;max-width:100%;background:var(--paper-1);border:1px solid var(--paper-2);border-left:2px solid var(--ink-2);border-radius:10px;padding:10px 12px 10px 14px;color:var(--ink-1);box-shadow:0 18px 44px -22px rgba(0,0,0,.6);position:relative;overflow:hidden}
.toast__eyebrow{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);display:flex;justify-content:space-between;gap:10px}
.toast__eyebrow .t{font-weight:500;letter-spacing:.04em;text-transform:none}
.toast__line{display:flex;gap:12px;align-items:flex-start;margin-top:5px}
.toast__text{flex:1;font-size:13px;line-height:1.4}
.toast__sub{display:block;font-size:11.5px;color:var(--ink-3);margin-top:3px}
.toast__act{flex:none;display:flex;gap:8px;align-items:center;padding-top:1px}
.toast__act .link{font-size:12.5px}
.toast__act .kbd{font-size:9.5px}
.toast__drain{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--paper-2)}
.toast__drain i{position:absolute;left:0;top:0;bottom:0;background:var(--seal);width:100%;transform-origin:left;animation:drain 8s linear forwards}
.toast:hover .toast__drain i,.toast:focus-within .toast__drain i{animation-play-state:paused}
@keyframes drain{to{transform:scaleX(0)}}
.toast--sealed{border-left-color:var(--seal)}
.toast--held{border-left-color:var(--ink-4);border-left-style:dashed}
.toast--refused{border-left-color:var(--ink-1)}
.toast__wax{width:14px;height:14px;border-radius:999px;background:var(--seal);flex:none;margin-top:2px;box-shadow:0 0 0 3px var(--seal-tint)}
.toast-stack{display:flex;flex-direction:column;gap:8px;align-items:flex-start}

/* ── the offline strip ── */
.off{display:flex;align-items:center;gap:14px;padding:8px 24px;background:var(--paper-1);border-bottom:1px solid var(--paper-2);font-size:12.5px;color:var(--ink-1)}
.off .eyebrow{color:var(--ink-3);margin-right:4px}
.off .link{margin-left:auto}
.off__dot{width:8px;height:8px;border-radius:999px;border:1.5px dashed var(--ink-4);flex:none}

/* ── the ladder popover (the ADR 0112 popover shape; content per ADR 0140 · sketch 103 2e) ── */
.pop{position:absolute;z-index:60;background:var(--paper-0);color:var(--ink-1);border:1px solid var(--paper-2);border-radius:14px;box-shadow:0 18px 44px -22px rgba(0,0,0,.42);overflow:hidden;width:320px}
.pop__head{padding:12px 16px 10px;border-bottom:1px solid var(--paper-2)}
.pop__title{margin:2px 0 0;font-family:var(--serif);font-size:17px;font-weight:600;line-height:1.16;letter-spacing:-.01em}
.pop__body{padding:4px 0 6px}
.pop__foot{padding:9px 16px 12px;border-top:1px solid var(--paper-2);font-size:11px;line-height:1.5;color:var(--ink-3)}
.item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 16px;border:0;border-left:2px solid transparent;background:transparent;color:var(--ink-1);font-family:var(--sans);font-size:13px;text-align:left;cursor:pointer}
.item:hover{background:var(--paper-1)}
.item,.item:visited{text-decoration:none}
.item[data-active="true"]{background:var(--seal-tint);border-left-color:var(--seal)}
.item__text{flex:1;min-width:0}
.item__label{display:block;font-weight:500;color:var(--ink-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item__sub{display:block;font-size:11px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ladder{display:flex;gap:0;align-items:center;padding:8px 16px 4px}
.ladder span{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap}
.ladder i{flex:1;height:1px;background:var(--paper-2);margin:0 6px;min-width:10px}
.ladder span[data-on="true"]{color:var(--ink-1)}
.rung{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);flex:none;text-align:right}
.rung b{display:block;color:var(--ink-1);font-weight:500}

/* ── the failure sheet (the boundary sits UNDER the shell, so the chrome survives) ── */
.fail{padding:60px 32px;max-width:640px}
.fail h1{font-family:var(--serif);font-weight:500;font-size:28px;letter-spacing:-.012em;margin:10px 0 0;line-height:1.16}
.fail p{font-size:13.5px;line-height:1.55;color:var(--ink-2);margin:12px 0 0;max-width:560px}
.fail .known{margin:22px 0 0;border-top:1px solid var(--paper-2)}
.fail .known div{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--paper-2);font-size:12.5px}
.fail .known div span:first-child{color:var(--ink-3)}
.fail .known div span:last-child{font-family:var(--mono);font-size:11.5px;color:var(--ink-1);word-break:break-all}
.fail .acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:22px}
.narrow .fail{padding:34px 16px}
.narrow .fail h1{font-size:23px}
.narrow .fail .known div{grid-template-columns:1fr}

/* ── 404 ── */
.nf{padding:60px 32px;max-width:760px}
.nf h1{font-family:var(--serif);font-weight:500;font-size:30px;letter-spacing:-.012em;margin:10px 0 0;line-height:1.14}
.nf p{font-size:13.5px;color:var(--ink-2);margin:12px 0 0;max-width:560px;line-height:1.55}
.nf .url{font-family:var(--mono);font-size:12px;color:var(--ink-1);background:var(--paper-1);border:1px solid var(--paper-2);border-radius:6px;padding:2px 7px}
.nf .rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:0 28px;margin-top:22px;border-top:1px solid var(--paper-2);padding-top:6px}
.nf .rooms a{display:block;padding:7px 0;border-bottom:1px solid var(--paper-2);font-size:13px;color:var(--ink-2);text-decoration:none}
.nf .rooms a b{color:var(--ink-1);font-weight:500}
.nf .rooms a small{display:block;font-size:11px;color:var(--ink-3)}
.narrow .nf{padding:30px 16px}
.narrow .nf h1{font-size:24px}
.narrow .nf .rooms{grid-template-columns:1fr}

/* ── phone chrome pieces ── */
.scrim{position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:40}
/* .sheetL replaces the rail itself (a left, non-modal drawer), not an ADR 0112 right sheet — its width matches the rail it stands in for, not 440/640 */
.sheetL{position:absolute;top:0;bottom:0;left:0;width:304px;background:var(--paper-0);border-right:1px solid var(--paper-2);box-shadow:18px 0 48px rgba(0,0,0,.4);z-index:50;display:flex;flex-direction:column}
.sheetB{position:absolute;left:0;right:0;bottom:0;background:var(--paper-0);border-top:1px solid var(--paper-2);border-radius:14px 14px 0 0;box-shadow:0 -18px 48px rgba(0,0,0,.45);z-index:50}
.sheetB__grip{width:36px;height:4px;border-radius:2px;background:var(--paper-2);margin:8px auto 0}

@media (prefers-reduced-motion:reduce){.skel::after,.load-bar i,.toast__drain i,.fold{animation:none!important;transition:none!important}}
"""

# ─────────────────────────────────────────────────────────────────────────────
# Shared HTML fragments
# ─────────────────────────────────────────────────────────────────────────────
SEARCH_ICON = ('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
               'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>')
BELL_ICON = ('<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
             'stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>')
CHEV = ('<svg class="hdr__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
        'stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')
MENU_ICON = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
             'stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>')


def header(house: dict, page: str, badge: str = '12', narrow: bool = False, menu_dot: bool = False,
           extra_left: str = '') -> str:
    """The built HouseHeader (HouseHeader.tsx) — reused, not redrawn. ThemeMenu is gone."""
    if badge == 'unknown':
        b = '<span class="hdr__badge hdr__badge--unknown" aria-label="The bell could not read the register"></span>'
    elif badge == '':
        b = ''
    else:
        b = f'<span class="hdr__badge">{badge}</span>'
    menu = ''
    if narrow:
        dot = '<span class="hdr__dot" aria-label="Something is waiting"></span>' if menu_dot else ''
        menu = f'<button class="hdr__menu" aria-label="Rooms">{MENU_ICON}{dot}</button>'
    return f'''<header class="hdr" role="banner" aria-label="House header">
  <div class="hdr__in">
    {menu}
    <div class="hdr__left">
      {extra_left}
      <a class="hdr__mark" href="#" aria-label="Mudavym — dashboard">{mark(24)}</a>
      <span class="hdr__rule"></span>
      <span class="hdr__page">{page}</span>
    </div>
    <button class="hdr__search" aria-label="Search or act — open the command palette">{SEARCH_ICON}<span class="hdr__searchtext">Search or act</span><kbd class="kbd hdr__chord">⌘K</kbd></button>
    <div class="hdr__right">
      <span class="hdr__house" title="{house['place']}">{house['name']}</span>
      <button class="hdr__btn" aria-label="Notifications">{BELL_ICON}{b}</button>
      <button class="hdr__btn hdr__btn--user" aria-label="Account menu"><span class="hdr__avatar">{house['initial']}</span><span class="hdr__who">{house['person']}</span>{CHEV}</button>
    </div>
  </div>
</header>'''


def page_orders(house: dict, narrow: bool = False) -> str:
    m, v = house['money'], house['vendors']
    return f'''<div class="pg">
  {wordmark(13)}
  <h1>Three orders wait on your seal; {v[0]}&#8217;s is due at the door by four.</h1>
  <div class="pg__eyebrow"><span>{house['date']}</span><span>Orders</span><span>Read {house['clock']}</span><span class="em">Prices in {house['currency']}</span></div>
  <div class="spine">
    <div><div class="n">4</div><div class="l">Drafted — not sent</div></div>
    <div><div class="n">3</div><div class="l">Awaiting your seal</div></div>
    <div><div class="n">2</div><div class="l">Sent — no reply yet</div></div>
    <div><div class="n">1</div><div class="l">At the door today</div></div>
    <div><div class="n em">—</div><div class="l">Received this week — no register read</div></div>
  </div>
  <div class="ledger">
    <div class="lrow h"><span>Vendor</span><span class="lines">Lines</span><span style="text-align:right">Total</span><span>State</span><span>What the price rests on</span></div>
    <div class="lrow" data-active="true"><b>{v[0]}</b><span class="lines">12 lines</span><span class="money">{m[0]}</span><span class="state">Awaiting seal</span><span class="prov"><span class="chip chip--seal">agreed</span>9 of 12 lines at the agreed price; 3 at last invoice</span></div>
    <div class="lrow"><b>{v[1]}</b><span class="lines">6 lines</span><span class="money">{m[1]}</span><span class="state">Awaiting seal</span><span class="prov"><span class="chip">invoice</span>all 6 at last invoice price, 2026-09-03</span></div>
    <div class="lrow"><b>{v[2]}</b><span class="lines">4 lines</span><span class="money">{m[2]}</span><span class="state">Awaiting seal</span><span class="prov"><span class="chip">no price</span>1 line has no price on file — the total omits it</span></div>
    <div class="lrow"><b>{v[3]}</b><span class="lines">8 lines</span><span class="money">{m[3]}</span><span class="state">Sent 09:14 — not received by the vendor</span><span class="prov"><span class="chip">quote</span>the rep&#8217;s message of 2026-09-11</span></div>
    <div class="lrow"><b>{v[4]}</b><span class="lines">12 lines</span><span class="money">{m[4]}</span><span class="state">At the door — expected before 16:00</span><span class="prov"><span class="chip chip--seal">sealed</span>seal 7f3a, 2026-09-15</span></div>
  </div>
  <div class="pg__foot">{wordmark(12)}<span>·</span><span>page body is a stand-in — not part of this sketch</span></div>
</div>'''


def page_receiving(house: dict) -> str:
    m, v = house['money'], house['vendors']
    return f'''<div class="pg">
  {wordmark(13)}
  <h1>One delivery is expected before four; nothing else is at the door.</h1>
  <div class="pg__eyebrow"><span>{house['date']}</span><span>Receiving</span><span>Read {house['clock']}</span><span class="em">{house['currency']} · {house['locale']}</span></div>
  <div class="spine">
    <div><div class="n">1</div><div class="l">Expected today</div></div>
    <div><div class="n">1</div><div class="l">Received — short</div></div>
    <div><div class="n">0</div><div class="l">Claims promised</div></div>
    <div><div class="n em">—</div><div class="l">Credits recovered — no register read</div></div>
  </div>
  <div class="ledger">
    <div class="lrow h"><span>Vendor</span><span class="lines">Lines</span><span style="text-align:right">Order total</span><span>State</span><span>What is known</span></div>
    <div class="lrow" data-active="true"><b>{v[0]}</b><span class="lines">18 lines</span><span class="money">{m[0]}</span><span class="state">Expected 15:30</span><span class="prov"><span class="chip chip--seal">sealed</span>order sealed by {house['manager']}, 2026-09-15</span></div>
    <div class="lrow"><b>{v[1]}</b><span class="lines">16 lines</span><span class="money">{m[1]}</span><span class="state">Received 11:02 — 14 of 16</span><span class="prov"><span class="chip">short</span>two short; the credit is not yet promised, and a promise is not money</span></div>
    <div class="lrow"><b>{v[2]}</b><span class="lines">5 lines</span><span class="money">{m[2]}</span><span class="state">Received yesterday</span><span class="prov"><span class="chip">stock</span>on the shelf — the invoice cost is not verified</span></div>
  </div>
  <div class="pg__foot">{wordmark(12)}<span>·</span><span>page body is a stand-in — not part of this sketch</span></div>
</div>'''


def skeleton_page() -> str:
    return '''<div class="pg" aria-busy="true" aria-label="Loading">
  ''' + wordmark(13) + '''
  <div class="skel" style="width:62%;height:26px;margin-top:14px"></div>
  <div class="skel" style="width:34%;margin-top:12px;height:10px"></div>
  <div class="spine" style="border-color:transparent">
    <div><div class="skel" style="width:28px;height:22px"></div><div class="skel" style="width:80%;margin-top:8px;height:9px"></div></div>
    <div><div class="skel" style="width:28px;height:22px"></div><div class="skel" style="width:80%;margin-top:8px;height:9px"></div></div>
    <div><div class="skel" style="width:28px;height:22px"></div><div class="skel" style="width:80%;margin-top:8px;height:9px"></div></div>
    <div><div class="skel" style="width:28px;height:22px"></div><div class="skel" style="width:80%;margin-top:8px;height:9px"></div></div>
  </div>
  <div class="ledger">
    <div class="lrow"><div class="skel" style="width:70%"></div><div class="skel" style="width:50%"></div><div class="skel" style="width:60%;margin-left:auto"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:90%"></div></div>
    <div class="lrow"><div class="skel" style="width:55%"></div><div class="skel" style="width:50%"></div><div class="skel" style="width:60%;margin-left:auto"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:80%"></div></div>
    <div class="lrow"><div class="skel" style="width:80%"></div><div class="skel" style="width:50%"></div><div class="skel" style="width:60%;margin-left:auto"></div><div class="skel" style="width:70%"></div><div class="skel" style="width:60%"></div></div>
  </div>
</div>'''


def toast(kind: str, eyebrow: str, when: str, text: str, sub: str = '', act: str = '', drain: bool = False,
          wax: bool = False, width: int | None = None) -> str:
    cls = {'sealed': ' toast--sealed', 'held': ' toast--held', 'refused': ' toast--refused'}.get(kind, '')
    w = f' style="width:{width}px"' if width else ''
    d = '<div class="toast__drain"><i></i></div>' if drain else ''
    wx = '<span class="toast__wax" aria-hidden="true"></span>' if wax else ''
    s = f'<span class="toast__sub">{sub}</span>' if sub else ''
    a = f'<div class="toast__act">{act}</div>' if act else ''
    return f'''<div class="toast{cls}" role="status"{w}>
  <div class="toast__eyebrow"><span>{eyebrow}</span><span class="t">{when}</span></div>
  <div class="toast__line">{wx}<div class="toast__text">{text}{s}</div>{a}</div>{d}
</div>'''


def toast_set(house: dict, width: int | None = None) -> str:
    """The five states every direction must hold. F10 (sketch 102): undo-after only for
    dismiss · archive · a removed shift · a note. Money, sends and ledger rows keep the
    seal BEFORE, and the toast after is a receipt line, never an undo."""
    m = house['money']
    v = house['vendors']
    return '\n'.join([
        toast('undo', 'Dismissed · the house confirmed', house['clock'],
              'Reorder Chablis left the docket, house-wide.',
              'Undo brings it back for everyone in the house.',
              '<button class="link">Undo</button><kbd class="kbd">⌘Z</kbd>', drain=True, width=width),
        toast('held', 'Written here · not on the house', house['clock'],
              'Your note on the Doluca delivery is kept on this device.',
              'Not sent, not received, not sealed yet.', width=width),
        toast('sealed', 'Sealed · receipt', house['clock'],
              f'Order to {v[0]}, {m[0]} — seal 7f3a.',
              'The seal already happened; this line is the receipt.', wax=True,
              act='<button class="link">Open</button>', width=width),
        toast('refused', 'Refused by the house', house['clock'],
              'A staff member may not remove a shift; it needs a manager.',
              'Nothing changed — the shift stays as it was.', width=width),
        toast('undo', 'Draft kept · not sent', house['clock'],
              f'Reply to {v[1]} is a draft.',
              'It stays a draft until you seal and send it.',
              act='<button class="link">Open draft</button>', width=width),
    ])


def fail_block(house: dict, route: str = '/orders', page: str = 'Orders', stale: bool = False) -> str:
    if stale:
        return f'''<div class="fail">
  <span class="eyebrow">A newer Mudavym was published · {route} · 14:07:12</span>
  <h1>This page is from before the last publish.</h1>
  <p>It is being reloaded once, keeping your place at <span class="url mono">{route}</span>. If it does not draw after that, the failure sheet says what is known — it never reloads twice.</p>
  <div class="acts"><span class="quiet mono">reloading · 1 of 1</span></div>
</div>'''
    return f'''<div class="fail" role="alert">
  <span class="eyebrow">The page could not be drawn · {route} · 14:07:12</span>
  <h1>{page} failed to draw.</h1>
  <p>Anything the house had already confirmed is kept on the house. Anything you were typing on this page is not — it was never sent. The rooms, the bell and the search still work; only this page is down.</p>
  <div class="known">
    <div><span>Error id</span><span>evt_9f3a2c1b<button class="link" style="margin-left:8px;font-size:11px">Copy</button></span></div>
    <div><span>Build</span><span>2026-09-17 · 60ed83a7</span></div>
    <div><span>Route · house</span><span>{route} · {house['name']} ({house['locale']})</span></div>
    <div><span>What happened</span><span>TypeError: cannot read &#8216;lines&#8217; of undefined — LedgerRow.tsx:88</span></div>
  </div>
  <div class="acts">
    <button class="btn btn--seal">Try again</button>
    <button class="btn">Go to Dashboard</button>
    <a class="link" href="mailto:support@mudavym.com">Write to support@mudavym.com with these readings</a>
  </div>
</div>'''


ROOMS_404 = [
    ('Dashboard', '/', 'today, in one page'), ('Notifications', '/notifications', 'what needs a decision'),
    ('Calendar', '/calendar', 'the house&#8217;s day-book'), ('Recommendations', '/recommendations', 'cases, with money at stake'),
    ('Orders', '/orders', 'drafted · sealed · sent · received'), ('Receiving', '/receiving', 'the door'),
    ('Providers', '/providers', 'who supplies the house'), ('Promotions', '/promotions', 'offers pulled from mail'),
    ('Vendor prices', '/vendor-prices', 'every sighting, with its source'), ('Inventory', '/inventory', 'stock, par, counts'),
    ('Cellar', '/cellar', 'wines · beer · whiskey · cocktails · spirits'), ('Receipts &amp; Credits', '/receipts', 'to verify, to chase'),
    ('Documents &amp; Reports', '/documents-reports', 'invoices and generated reports'), ('Reports', '/reports', 'sales, margin, stock over time'),
    ('Logs', '/logs', 'one timeline across POS, stock, mail, agents'), ('Team', '/team', 'people, roles, shifts'),
    ('Communications', '/communications', 'vendor threads'), ('Mudavym', '/ask', 'ask the house a question · /sommelier redirects here'),
]


def nf_block(url: str = '/recieving', suggest: tuple = ('Receiving', '/receiving')) -> str:
    rooms = ''.join(f'<a href="#"><b>{n}</b><small>{p} · {d}</small></a>' for n, p, d in ROOMS_404)
    return f'''<div class="nf">
  <span class="eyebrow">No page at this address</span>
  <h1>There is no room at this address.</h1>
  <p style="margin-top:10px"><span class="url" style="font-size:14px;padding:4px 9px">{url}</span></p>
  <p>The address was typed or followed, and this house has no page there. Nothing was redirected — the address is left as it is so the link that brought you here can be corrected.</p>
  <p>Did you mean <a class="link" href="#" style="font-size:13.5px">{suggest[0]}</a> <span class="mono" style="font-size:11.5px;color:var(--ink-3)">{suggest[1]}</span>?</p>
  <div class="rooms">{rooms}</div>
  <p class="quiet" style="margin-top:18px">A room you may not enter is a different door: <span class="mono">/connections</span> for a staff member answers <em>refused</em> at <span class="mono">/no-access</span>, never &#8220;not found&#8221;. A stranger who lands here signed out sees the public shell&#8217;s version of this page (ADR 0143 §1), not this one.</p>
</div>'''


def loader_strip(narrow_cls: str = '') -> str:
    """Three moments of one load: nothing · skeleton · did not arrive."""
    return f'''<div class="sk-row" style="align-items:stretch;gap:20px">
  <div class="fit" data-fit="420"><div class="mudavym frame frame--short {narrow_cls}" style="width:420px;min-height:420px">
    <div class="load-bar"><i></i></div>
    <div style="padding:40px 24px"><span class="sect">0 – 400 ms</span><p class="quiet" style="margin:8px 0 0">Nothing drawn yet — only the hairline under the header moves.</p></div>
  </div></div>
  <div class="fit" data-fit="420"><div class="mudavym frame frame--short" style="width:420px;min-height:420px">
    <div class="load-bar"><i></i></div>
    <div style="zoom:.62">{skeleton_page()}</div>
    <div class="load-note"><span>400 ms – 3 s · still reading the house&#8217;s books · 3.2 s</span></div>
  </div></div>
  <div class="fit" data-fit="420"><div class="mudavym frame frame--short" style="width:420px;min-height:420px">
    <div style="padding:40px 24px"><span class="eyebrow">The page did not arrive · 12 s</span>
      <h1 style="font-family:var(--serif);font-weight:500;font-size:22px;margin:10px 0 0;letter-spacing:-.01em">Orders is still on its way.</h1>
      <p class="quiet" style="margin:10px 0 0">The house has not answered. Nothing is shown in its place.</p>
      <div style="display:flex;gap:10px;margin-top:18px"><button class="btn btn--seal">Try again</button><button class="btn">Go to Dashboard</button></div></div>
  </div></div>
</div>'''


CUR_TRUE = ' aria-current="true"'
CUR_PAGE = ' aria-current="page"'
UNDO_ACT = "<button class='link'>Undo</button><kbd class='kbd'>⌘Z</kbd>"
UNDO_ACT_M = "<button class='link'>Undo</button>"
TALLY_REC = "<span class='tallymove'>Recommendations <b>4</b> → <b>3</b></span>"
TALLY_REC_LONG = "<span class='tallymove'>Recommendations <b>4</b> → <b>3</b> · Dashboard unchanged</span>"

FIT_JS = r"""
<script>
(function(){
  function fit(){
    var vw = document.documentElement.clientWidth;
    document.querySelectorAll('[data-fit]').forEach(function(el){
      var w = +el.getAttribute('data-fit');
      var avail = vw >= w + 24 ? w : vw - 24;
      var s = Math.min(1, avail / w);
      el.style.zoom = s;
    });
  }
  fit(); window.addEventListener('resize', fit);
  // folds: settle, 320ms (lib/mudavym/motion.ts) — grid-template-rows 0fr→1fr
  document.querySelectorAll('[data-fold-toggle]').forEach(function(b){
    b.addEventListener('click', function(){
      var t = document.getElementById(b.getAttribute('data-fold-toggle'));
      if(!t) return; var open = t.getAttribute('data-open') === 'true';
      t.setAttribute('data-open', open ? 'false' : 'true'); b.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  });
})();
</script>
"""


def head(title: str, extra_css: str) -> str:
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{COMMON_CSS}{extra_css}</style>
</head>
<body>
'''


def tail() -> str:
    return FIT_JS + '</body>\n</html>\n'


def fitframe(inner: str, w: int = 1440) -> str:
    return f'<div class="fitwrap"><div class="fit" data-fit="{w}">{inner}</div></div>'


# ═════════════════════════════════════════════════════════════════════════════
# DIRECTION A — The rooms: a quiet left rail of words, grouped by where the work
# happens in the house. Expanded or tucked, never iconified. No counts.
# ═════════════════════════════════════════════════════════════════════════════
A_CSS = r"""
.shellA{display:grid;grid-template-columns:240px 1fr;min-height:880px}
.shellA[data-rail="tucked"]{grid-template-columns:28px 1fr}
.rail{background:var(--paper-0);border-right:1px solid var(--paper-2);display:flex;flex-direction:column;padding:10px 0 8px;min-width:0}
.rail__top{padding:4px 12px 8px}
.rail .sect,.pass .sect,.sheetL .sect{padding:12px 20px 4px}
.room{display:flex;align-items:center;gap:8px;padding:6px 18px 6px 18px;border-left:2px solid transparent;font-size:13px;color:var(--ink-2);text-decoration:none;line-height:1.3;transition:background-color 160ms var(--house),color 160ms var(--house)}
.room:hover{background:var(--paper-1);color:var(--ink-1)}
.room[aria-current="page"]{background:var(--seal-tint);border-left-color:var(--seal);color:var(--ink-1);font-weight:500}
.room .kbd{margin-left:auto}
.room--child{padding-left:34px;font-size:12.5px;color:var(--ink-3)}
.room--child[aria-current="page"]{color:var(--ink-1)}
.room__chev{margin-left:auto;color:var(--ink-4);transition:transform 320ms var(--house)}
.fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows 320ms var(--house)}
.fold[data-open="true"]{grid-template-rows:1fr}
.fold>div{min-height:0;overflow:hidden}
.room--ask{margin:0 10px 4px;padding:7px 10px;border:1px solid var(--paper-2);border-radius:9px;background:var(--paper-1);color:var(--ink-1)}
.room--ask:hover{border-color:var(--seal-ring)}
.room--ask .wm{font-size:13px}
.rail__foot{margin-top:auto;padding-top:8px;border-top:1px solid var(--paper-2)}
.arrival{margin:6px 12px 8px;padding:8px 10px;border:1px dashed var(--paper-2);border-radius:9px;font-size:12px;color:var(--ink-2)}
.arrival .bar{height:2px;background:var(--paper-2);margin-top:7px;border-radius:1px;overflow:hidden}
.arrival .bar i{display:block;height:100%;width:57%;background:var(--seal)}
.arrival small{display:block;font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:2px}
.tuck{display:flex;align-items:center;gap:8px;margin:8px 12px 0;padding:6px 8px;border:0;background:transparent;color:var(--ink-3);font-family:var(--sans);font-size:11.5px;cursor:pointer;border-radius:7px}
.tuck:hover{background:var(--paper-1);color:var(--ink-2)}
.tuck .kbd{margin-left:auto}
.strip{background:var(--paper-0);border-right:1px solid var(--paper-2);display:flex;flex-direction:column;align-items:center;padding:14px 0}
.strip button{writing-mode:vertical-rl;transform:rotate(180deg);border:0;background:transparent;color:var(--ink-3);font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;padding:10px 4px;cursor:pointer;border-radius:6px}
.strip button:hover{color:var(--ink-1);background:var(--paper-1)}
.pass{position:absolute;top:0;bottom:0;left:0;width:264px;background:var(--paper-0);border-right:1px solid var(--paper-2);box-shadow:18px 0 48px rgba(0,0,0,.42);z-index:40;display:flex;flex-direction:column;padding:10px 0 8px}
.hint{position:absolute;z-index:70;background:var(--paper-0);color:var(--ink-1);border:1px solid var(--paper-2);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.4);padding:8px 11px;width:240px;font-size:12px}
.hint b{display:block;font-weight:500;margin-bottom:2px}
.hint span{color:var(--ink-3);font-size:11.5px;line-height:1.4;display:block}
.mainA{position:relative;min-width:0}
.toastA{position:absolute;left:16px;bottom:16px;z-index:50}
.narrow .rail{padding:0}
"""


def a_rooms(house: dict, active: str = '/orders', staff: bool = False, cellar_open: bool = True,
            ask: bool = True, foot: bool = True, arrival: bool = True, tuck_btn: bool = True) -> str:
    def room(name, href, child=False, extra=''):
        cur = ' aria-current="page"' if href == active else ''
        c = ' room--child' if child else ''
        return f'<a class="room{c}" href="#"{cur}>{name}{extra}</a>'
    chev = '<svg class="room__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(%s)"><path d="m6 9 6 6 6-6"/></svg>' % ('0deg' if cellar_open else '-90deg')
    parts = []
    if ask:
        parts.append(f'<div class="rail__top"><a class="room room--ask" href="#"><span style="font-size:13px;color:var(--ink-2)">Ask</span>{wordmark(13)}<kbd class="kbd">⌘⇧K</kbd></a></div>')
    parts.append('<span class="sect">The floor</span>')
    parts += [room('Dashboard', '/'), room('Notifications', '/notifications'), room('Calendar', '/calendar'),
              room('Recommendations', '/recommendations')]
    parts.append('<span class="sect">The door</span>')
    parts += [room('Orders', '/orders'), room('Receiving', '/receiving'), room('Providers', '/providers'),
              room('Promotions', '/promotions'), room('Vendor prices', '/vendor-prices')]
    parts.append('<span class="sect">The cellar</span>')
    parts.append(room('Inventory', '/inventory'))
    parts.append(f'<button class="room" style="width:100%;border-top:0;border-right:0;border-bottom:0;background:transparent;cursor:pointer;font-family:var(--sans)" data-fold-toggle="cellarfold-{id(house)}-{active.strip("/") or "root"}" aria-expanded="{"true" if cellar_open else "false"}">Cellar{chev}</button>')
    kids = ''.join([room('Wines', '/wines', True), room('Beer', '/beer', True), room('Whiskey', '/whiskey', True),
                    room('Cocktails', '/cocktails', True), room('Spirits', '/spirits', True),
                    room('Soft drinks' if house.get('alcohol_free') else 'Non-alcoholic', '/non-alcoholic', True)])
    parts.append(f'<div class="fold" id="cellarfold-{id(house)}-{active.strip("/") or "root"}" data-open="{"true" if cellar_open else "false"}"><div>{kids}</div></div>')
    parts.append('<span class="sect">The books</span>')
    parts += [room('Receipts &amp; Credits', '/receipts'), room('Documents &amp; Reports', '/documents-reports'),
              room('Reports', '/reports'), room('Logs', '/logs')]
    parts.append('<span class="sect">The people</span>')
    parts += [room('Team', '/team'), room('Communications', '/communications')]
    if foot:
        f = ['<div class="rail__foot">']
        if arrival and not staff:
            f.append('<div class="arrival"><small>The arrival · folio 4 of 7</small>Three folios are still blank — the till, the senders, the first invoice.<div class="bar"><i></i></div></div>')
        f.append(room('Settings', '/settings'))
        if not staff:
            f.append(room('Connections', '/connections'))
            f.append(room('The desk', '/admin', extra='<span class="kbd" style="margin-left:auto;font-size:9px">owner</span>'))
        f.append(room('Help', '/help'))
        if tuck_btn:
            f.append('<button class="tuck">Tuck the rooms<kbd class="kbd">⌘\\</kbd></button>')
        f.append('</div>')
        parts.append(''.join(f))
    return ''.join(parts)


def a_frame(house: dict, page_html: str, page_name: str, active: str, staff: bool = False, badge: str = '12',
            overlay: str = '', rail: str = 'expanded', offline: str = '', cellar_open: bool = True, min_h: int = 880) -> str:
    if rail == 'tucked':
        left = '<div class="strip"><button aria-expanded="false">Rooms</button></div>'
    else:
        left = f'<nav class="rail" aria-label="Rooms">{a_rooms(house, active, staff, cellar_open=cellar_open)}</nav>'
    return f'''<div class="mudavym frame" style="min-height:{min_h}px"><div class="shellA" data-rail="{rail}">
  {left}
  <div class="mainA">
    {header(house, page_name, badge)}
    {offline}
    {page_html}
    {overlay}
  </div>
</div></div>'''


def a_phone(house: dict, inner: str, page: str = 'Orders', badge: str = '12', drawer: bool = False,
            bottom: str = '', offline: str = '', active: str = '/orders') -> str:
    d = ''
    if drawer:
        d = f'''<div class="scrim"></div><div class="sheetL">
  <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--paper-2)">
    <span class="hdr__mark">{mark(22)}</span><div><div style="font-size:13px;font-weight:500">{house['name']}</div><div class="quiet" style="font-size:11px">{house['role']} · {house['place']}</div></div>
    <button class="link" style="margin-left:auto">Close</button></div>
  <div style="overflow:auto;flex:1">{a_rooms(house, active, staff=(house is TR), cellar_open=False, ask=True, arrival=False, tuck_btn=False)}</div>
</div>'''
    return f'''<div class="mudavym phone narrow">
  {header(house, page, badge, narrow=True)}
  {offline}
  {inner}
  {bottom}{d}
</div>'''


def build_a() -> str:
    us, tr = US, TR
    ladder_pop = '''<div class="pop" style="right:24px;top:96px">
  <div class="pop__head"><span class="eyebrow">3 records · the house last answered 14:01:48</span><h2 class="pop__title">Written here, not on the house</h2></div>
  <div class="ladder"><span data-on="true">written here</span><i></i><span>sent</span><i></i><span>received</span><i></i><span>sealed by the house</span></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Door count — Kermit Lynch, 12 of 12</span><span class="item__sub">14:03 · the count sits on this phone</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Note on the Chablis line</span><span class="item__sub">14:05 · undo still works on it</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismiss: Reorder Chablis</span><span class="item__sub">14:06 · on this device only</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
  </div>
  <div class="pop__foot">Nothing here is confirmed. When the house answers, each line moves one rung and the toast says which. A seal is never queued: money and sends wait for the house to be reachable (ADR 0140).</div>
</div>'''
    offline_strip = '''<div class="off" role="status"><span class="off__dot"></span><span class="eyebrow">Offline since 14:02</span><span>3 records written here, none sent. The bell and the counts are from 14:01:48, the house&#8217;s last answer.</span><button class="link">What is where</button></div>'''
    hint = '''<div class="hint" style="left:6px;top:256px"><b>Receiving</b><span>Check a delivery in at the door and catch short cases. One room, one job.</span></div>'''
    toast_dock = f'<div class="toastA"><div class="toast-stack">{toast("undo", "Dismissed · the house confirmed", us["clock"], "Reorder Chablis left the docket, house-wide.", "", UNDO_ACT, drain=True)}</div></div>'

    html = head('Sketch 106 · A — The rooms', A_CSS)
    html += '''<div class="sk-band"><h1>Sketch 106 · Direction A — The rooms</h1>
<p class="sk-sub">A quiet left rail of words, grouped by where the work happens in the house — the floor, the door, the cellar, the books, the people — in the house&#8217;s own voice. &#8220;The desk&#8221; now names only /admin, in the foot, so one word does not sit twice on the same rail. Rooms keep the names the built header already prints (<span class="mono">lib/mudavym/pageNames.ts</span>), so nav and chrome agree word for word. No icons, no counts: the bell is the one count in the chrome. The rail is expanded or tucked, never iconified. The built house header is reused as it is, minus the theme menu (ADR 0149 row 6); the floating Wine Agent button is removed (ADR 0149 row 33) — <em>Ask Mudavym.</em> and the palette are the two doors that replace it. Warm charcoal is the ground (ADR 0138).</p></div>'''

    html += f'<div class="sk-label">01 · Owner · {us["name"]}, {us["place"]} · en-US · USD · 1440 · rail expanded, the cellar fold open, the undo toast docked at the page&#8217;s left edge<small>Profile lives in the account menu (built, HouseUserMenu); The desk (/admin) is an owner-only room; Studio, SimPOS, /dev/truth and /dev-sandbox never appear.</small></div>'
    html += fitframe(a_frame(us, page_orders(us), 'Orders', '/orders', overlay=toast_dock))

    html += f'<div class="sk-label">02 · Staff · {tr["name"]}, {tr["place"]} · tr-TR · TRY · 1440 · the role-gated rooms are absent<small>Connections (manager, ADR 0114 G19), The desk (owner) and the arrival are not drawn for staff. Hiding a row is not the boundary — the gateway refuses the URL regardless (Sidebar.tsx:58-64). Settings stays: its refused registers are named in words inside the page (sketch 111, fork 2b).</small></div>'
    html += fitframe(a_frame(tr, page_receiving(tr), 'Receiving', '/receiving', staff=True, badge='3', cellar_open=False))

    html += '<div class="sk-label">03 · Tucked (28 px) — the page takes the width; and the rail as a pass, hovered open over the page with no scrim<small>⌘\\ tucks; the strip&#8217;s one word opens the rooms as a non-modal pass (sketch 103, 1a) that closes when you leave it or choose a room. The persisted key is today&#8217;s <span class="mono">ui-storage.sidebarCollapsed</span>, read as &#8220;tucked&#8221;.</small></div>'
    tucked = a_frame(us, page_orders(us), 'Orders', '/orders', rail='tucked')
    passed = a_frame(us, page_orders(us), 'Orders', '/orders', rail='tucked', min_h=1120,
                     overlay=f'<div class="pass" style="left:-28px">{a_rooms(us, "/orders", arrival=False, tuck_btn=False)}</div>')
    html += fitframe(tucked)
    html += '<div style="height:24px"></div>'
    html += fitframe(passed)

    html += '<div class="sk-label">04 · The rail&#8217;s hover hint (the one Mudavym-aware fragment that already ships, Sidebar.tsx:244-263) — geometry unchanged, tokens only</div>'
    html += fitframe(a_frame(us, page_orders(us), 'Orders', '/orders', overlay=hint))

    html += f'<div class="sk-label">05 · Toasts — the margin note, docked at the page&#8217;s left edge, five states<small>One system replaces sonner (App.tsx:424-441) and the Radix ToastContext. Anatomy: an eyebrow that says what the house did and when; one sentence; a second line that says what is NOT claimed. Undo drains an 8 s hairline (linear, the pour token&#8217;s reason: you are timing it). Undo only where F10 allows.</small></div>'
    html += f'<div class="sk-row"><div class="mudavym" style="padding:24px;border:1px solid #b6ad9e;width:100%;max-width:1360px"><div class="toast-stack" style="flex-direction:row;flex-wrap:wrap;gap:14px">{toast_set(us, 400)}</div><p class="quiet" style="margin:16px 0 0;max-width:820px">Stacking: at most three; the oldest tucks behind the newest (tuck, 300 ms) and is reachable from the bell&#8217;s book. A toast never carries a form and never the seal (F8). On a phone it docks bottom-centre above the safe area, full width less 12 px.</p></div></div>'

    html += '<div class="sk-label">06 · The page loader — three moments of one load (Suspense fallback + the page&#8217;s own skeleton)<small>Under 400 ms nothing is drawn, so a flash never reads as information. At 12 s the state is never faked — it says the house has not answered.</small></div>'
    html += loader_strip()

    html += '<div class="sk-label">07 · Offline — the strip under the header, and the ladder it opens · queued is never confirmed (ADR 0140, sketch 103 2e)<small>Replaces the amber OfflineBanner (SyncStatus.tsx:247-267), which says &#8220;will sync&#8221; — a promise the device cannot keep. The strip says what is written here and what the house last answered; the popover names each record&#8217;s rung.</small></div>'
    html += fitframe(a_frame(us, page_orders({**us, 'clock': '14:01:48'}), 'Orders', '/orders', badge='unknown', offline=offline_strip, cellar_open=False,
                             overlay=ladder_pop + f'<div class="toastA"><div class="toast-stack">{toast("held", "Written here · not on the house", "14:05:40", "Your note on the Chablis line is kept on this device.", "Not sent, not received, not sealed.")}</div></div>'))

    html += '<div class="sk-label">08 · The failure sheet — the boundary sits under the shell, so the rooms, the bell and the search survive a page crash<small>Today ErrorBoundary wraps the whole app above the router (App.tsx:160), so a crash takes the chrome with it. Two states: an unknown error, and the stale-chunk case that reloads once and says so.</small></div>'
    html += fitframe(a_frame(us, fail_block(us), 'Orders', '/orders', cellar_open=False))
    html += '<div style="height:24px"></div>'
    html += fitframe(a_frame(us, fail_block(us, stale=True), 'Orders', '/orders', cellar_open=False))

    html += '<div class="sk-label">09 · A real 404 — no room at that address; the address is kept, the nearest room is offered, the rooms are listed<small>Today the catch-all silently redirects to / (App.tsx:416-417).</small></div>'
    html += fitframe(a_frame(us, nf_block(), 'Not found', '/nowhere', cellar_open=False))

    html += '<div class="sk-label">10 · 390 — the header gains the rooms toggle (the legacy mobile top bar is deleted); the rooms open as a left sheet; the ladder is a bottom sheet with detents (F9)</div>'
    ph1 = a_phone(us, page_orders(us), bottom=f'<div style="position:absolute;left:12px;right:12px;bottom:14px;z-index:50">{toast("undo", "Dismissed · the house confirmed", us["clock"], "Reorder Chablis left the docket.", "", UNDO_ACT_M, drain=True, width=366)}</div>')
    ph2 = a_phone(tr, page_receiving(tr), page='Receiving', badge='3', drawer=True, active='/receiving')
    ladder_sheet = '''<div class="sheetB"><div class="sheetB__grip"></div>
  <div class="pop__head" style="padding-top:8px"><span class="eyebrow">3 records · the house last answered 14:01:48</span><h2 class="pop__title">Written here, not on the house</h2></div>
  <div class="ladder" style="flex-wrap:wrap;gap:6px 0"><span data-on="true">written here</span><i></i><span>sent</span><i></i><span>received</span><i></i><span>sealed</span></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Door count — Kavaklıdere, 18 of 18</span><span class="item__sub">14:03 · on this phone</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Note on the Doluca delivery</span><span class="item__sub">14:05</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismiss: Reorder Öküzgözü</span><span class="item__sub">14:06 · on this device only</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
  </div>
  <div class="pop__foot">Nothing here is confirmed. A seal is never queued.</div></div>'''
    ph3 = a_phone(tr, page_receiving(tr), page='Receiving', badge='unknown',
                  offline='<div class="off" style="padding:8px 12px;font-size:12px;gap:8px"><span class="off__dot"></span><span class="eyebrow">Offline 14:02</span><span>3 written here</span><button class="link">Where</button></div>',
                  bottom='<div class="scrim"></div>' + ladder_sheet)
    html += f'<div class="sk-row"><div class="fit" data-fit="390">{ph1}</div><div class="fit" data-fit="390">{ph2}</div><div class="fit" data-fit="390">{ph3}</div></div>'

    html += '<div class="sk-label">11 · 390 — the shared pieces at phone width: the failure sheet, the stale-chunk reload, a real 404, and the 12 s loader state<small>Built once, docked three ways — drawn once at 390 here since the chrome around them is shared.</small></div>'
    fail_ph = a_phone(us, fail_block(us))
    stale_ph = a_phone(us, fail_block(us, stale=True))
    nf_ph = a_phone(us, nf_block())
    loader12_ph = a_phone(us, f'''<div style="padding:32px 18px"><span class="eyebrow">The page did not arrive · 12 s</span>
      <h1 style="font-family:var(--serif);font-weight:500;font-size:19px;margin:8px 0 0;letter-spacing:-.01em">Orders is still on its way.</h1>
      <p class="quiet" style="margin:8px 0 0">The house has not answered. Nothing is shown in its place.</p>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn--seal">Try again</button><button class="btn">Go to Dashboard</button></div></div>''')
    html += f'<div class="sk-row"><div class="fit" data-fit="390">{fail_ph}</div><div class="fit" data-fit="390">{stale_ph}</div><div class="fit" data-fit="390">{nf_ph}</div><div class="fit" data-fit="390">{loader12_ph}</div></div>'

    html += '''<div class="sk-label">12 · Paper, declared — the one escape (ADR 0104 D9): the toast on a paper surface keeps its anatomy</div>
<div class="sk-row"><div class="mudavym" data-ground="paper" style="padding:24px;border:1px solid #b6ad9e;width:100%;max-width:800px">''' + toast('undo', 'Dismissed · the house confirmed', '14:02:11', 'Reorder Chablis left the docket, house-wide.', 'Undo brings it back for everyone in the house.', '<button class="link">Undo</button>', drain=True) + '''</div></div>
<p class="sk-note">This cell is pinned to the paper ground (ADR 0104 D9) to prove the tokens hold on the declared exception.</p>
<p class="sk-foot">Sketch 106 · A. Fonts load from Google for the drawing; the product self-hosts them (ADR 0149 row 9). Icons: none — this direction has no glyph set to maintain. Motion used: ink 160 (hover), settle 320 (the cellar fold), tuck 300 (the pass, the toast stack), the toast&#8217;s 8 s drain is linear like pour. Reduced motion collapses every transition.</p>'''
    html += tail()
    return html


# ═════════════════════════════════════════════════════════════════════════════
# DIRECTION B — The ledger bar: no rail. The header grows a second line — the
# six books of the house as tabs, the open book's rooms inline. The page gets 1440.
# ═════════════════════════════════════════════════════════════════════════════
B_CSS = r"""
.bar2{display:flex;align-items:stretch;gap:0;min-height:40px;padding:0 24px;border-bottom:1px solid var(--paper-2);background:var(--paper-0)}
.books{display:flex;align-items:stretch;gap:2px}
.book{display:inline-flex;align-items:center;gap:5px;padding:0 9px;color:var(--ink-3);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px;font-family:var(--serif);font-weight:600;letter-spacing:-.005em;font-size:13px;white-space:nowrap;transition:color 160ms var(--house),border-color 160ms var(--house)}
.book:hover{color:var(--ink-1)}
.book[aria-current="true"]{color:var(--ink-1);border-bottom-color:var(--seal)}
.book .kbd{font-size:9px}
.bar2__rule{width:1px;background:var(--paper-2);margin:8px 14px}
.roomsB{display:flex;align-items:center;gap:2px;min-width:0;flex:1 1 auto;overflow-x:auto;scrollbar-width:none;mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent 100%);-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent 100%)}
.roomsB::-webkit-scrollbar{display:none}
.roomB--more{flex:none;color:var(--ink-3);font-family:var(--mono);font-size:11px;border:1px dashed var(--paper-2);white-space:nowrap}
.roomB{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:7px;font-size:12.5px;color:var(--ink-2);text-decoration:none;white-space:nowrap;transition:background-color 160ms var(--house),color 160ms var(--house)}
.roomB:hover{background:var(--paper-1);color:var(--ink-1)}
.roomB[aria-current="page"]{background:var(--seal-tint);color:var(--ink-1);font-weight:500;box-shadow:inset 2px 0 0 var(--seal)}
.roomB[data-gated]{color:var(--ink-4)}
.bar2__right{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none}
.entry{display:flex;align-items:center;gap:8px;padding:0 0 0 12px;border-left:1px solid var(--paper-2);height:28px;font-size:12px;color:var(--ink-1);min-width:0;max-width:520px}
.entry .eyebrow{color:var(--ink-3);white-space:nowrap;font-size:9px}
.entry .txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px}
.entry .link{white-space:nowrap}
.entry .count{font-family:var(--mono);font-size:10px;color:var(--ink-3);border:1px solid var(--paper-2);border-radius:5px;padding:1px 5px}
.entry .drain{width:36px;height:2px;background:var(--paper-2);position:relative;overflow:hidden;flex:none}
.entry .drain i{position:absolute;inset:0;background:var(--seal);transform-origin:left;animation:drain 8s linear forwards}
.entry:hover .drain i,.entry:focus-within .drain i{animation-play-state:paused}
.entry--held{border-left:1px dashed var(--ink-4)}
.entry--sealed .wax{width:10px;height:10px;border-radius:999px;background:var(--seal);box-shadow:0 0 0 2px var(--seal-tint);flex:none}
.mainB{position:relative;min-height:760px}
.bookpop{position:absolute;z-index:60;background:var(--paper-0);border:1px solid var(--paper-2);border-radius:14px;box-shadow:0 18px 44px -22px rgba(0,0,0,.42);width:320px;overflow:hidden}
/* .entries is a session log, not an ADR 0112 popover — wider (420) so a full entry sentence doesn't wrap mid-word */
.entries{position:absolute;right:24px;top:92px;z-index:60;width:420px;background:var(--paper-0);border:1px solid var(--paper-2);border-radius:14px;box-shadow:0 18px 44px -22px rgba(0,0,0,.42);overflow:hidden}
.entries .item{align-items:flex-start;padding:9px 16px}
/* phone: books as a bottom tab bar, the open book's rooms as a chip row under the header */
.tabbar{position:absolute;left:0;right:0;bottom:0;height:64px;background:color-mix(in srgb,var(--paper-0) 92%,transparent);backdrop-filter:blur(10px);border-top:1px solid var(--paper-2);display:flex;align-items:stretch;padding:0 4px 8px;z-index:45}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:var(--serif);font-weight:600;font-size:11.5px;color:var(--ink-3);text-decoration:none;border-top:2px solid transparent;margin-top:-1px}
.tab[aria-current="true"]{color:var(--ink-1);border-top-color:var(--seal)}
.tab small{font-family:var(--mono);font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-4);font-weight:400}
.chiprow{display:flex;gap:6px;padding:8px 10px;overflow-x:auto;border-bottom:1px solid var(--paper-2);scrollbar-width:none}
.chiprow::-webkit-scrollbar{display:none}
.chiprow .roomB{border:1px solid var(--paper-2);border-radius:999px;padding:5px 11px;font-size:12px}
.chiprow .roomB[aria-current="page"]{border-color:var(--seal-ring);box-shadow:none}
.entryM{position:absolute;left:12px;right:12px;bottom:74px;z-index:50}
"""

BOOKS = [
    ('Floor', [('Dashboard', '/'), ('Notifications', '/notifications'), ('Calendar', '/calendar'), ('Recommendations', '/recommendations')]),
    ('Door', [('Orders', '/orders'), ('Receiving', '/receiving'), ('Providers', '/providers'), ('Promotions', '/promotions'), ('Vendor prices', '/vendor-prices')]),
    ('Cellar', [('Inventory', '/inventory'), ('Cellar', '/cellar'), ('Wines', '/wines'), ('Beer', '/beer'), ('Whiskey', '/whiskey'), ('Cocktails', '/cocktails'), ('Spirits', '/spirits'), ('Non-alcoholic', '/non-alcoholic')]),
    ('Books', [('Receipts &amp; Credits', '/receipts'), ('Documents &amp; Reports', '/documents-reports'), ('Reports', '/reports'), ('Logs', '/logs')]),
    ('People', [('Team', '/team'), ('Communications', '/communications')]),
    ('House', [('Settings', '/settings'), ('Connections', '/connections'), ('The desk', '/admin'), ('Help', '/help')]),
]
GATED = {'/connections': 'manager', '/admin': 'owner'}


def b_bar(house: dict, active: str, staff: bool = False, entry: str = '', open_book: str | None = None) -> str:
    book_of = None
    for name, rooms in BOOKS:
        if any(h == active for _, h in rooms):
            book_of = name
    book_of = open_book or book_of or 'Floor'
    tabs = ''.join(
        f'<a class="book" href="#"{CUR_TRUE if name == book_of else ""}>{name}<kbd class="kbd">{i + 1}</kbd></a>'
        for i, (name, _) in enumerate(BOOKS))
    rooms = ''
    shown = 0
    for name, rs in BOOKS:
        if name == book_of:
            visible_rs = [r for r in rs if not (staff and r[1] in GATED)]
            for label, href in rs:
                if staff and href in GATED:
                    continue
                cur = ' aria-current="page"' if href == active else ''
                g = f' data-gated="{GATED[href]}" title="{GATED[href]} only"' if href in GATED else ''
                rooms += f'<a class="roomB" href="#"{cur}{g}>{label}{("<span class=kbd style=font-size:9px>" + GATED[href] + "</span>") if href in GATED else ""}</a>'
            shown = len(visible_rs)
    # past ~6 rooms the strip scrolls under the edge fade above; a chip outside the
    # scroll track says so rather than leaving the cut-off silent — a chip appended
    # INSIDE the scrolling row would itself scroll out of view with the rooms it names
    # (measured: Cellar's 8 rooms overflow the strip at 1440)
    more_chip = f'<span class="roomB roomB--more" title="scrolls">+{shown - 6} rooms</span>' if shown > 6 else ''
    ask = f'<a class="roomB" href="#" style="border:1px solid var(--paper-2)">{wordmark(12)}<kbd class="kbd">⌘⇧K</kbd></a>'
    return f'''<nav class="bar2" aria-label="Rooms">
  <div class="books">{tabs}</div>
  <span class="bar2__rule"></span>
  <div class="roomsB">{rooms}</div>
  {more_chip}
  <div class="bar2__right">{entry}{ask}</div>
</nav>'''


def b_frame(house: dict, page_html: str, page_name: str, active: str, staff: bool = False, badge: str = '12',
            entry: str = '', overlay: str = '', offline: str = '', open_book: str | None = None, min_h: int = 880) -> str:
    return f'''<div class="mudavym frame" style="min-height:{min_h}px">
  {header(house, page_name, badge)}
  {b_bar(house, active, staff, entry, open_book)}
  {offline}
  <div class="mainB">{page_html}{overlay}</div>
</div>'''


def b_entry(kind: str, eyebrow: str, text: str, act: str = '', count: str = '') -> str:
    cls = {'held': ' entry--held', 'sealed': ' entry--sealed'}.get(kind, '')
    wax = '<span class="wax"></span>' if kind == 'sealed' else ''
    dr = '<span class="drain"><i></i></span>' if kind == 'undo' else ''
    c = f'<span class="count">{count}</span>' if count else ''
    return f'<div class="entry{cls}" role="status">{wax}<span class="eyebrow">{eyebrow}</span><span class="txt">{text}</span>{act}{dr}{c}</div>'


def b_phone(house: dict, inner: str, page: str, active: str, badge: str = '12', bottom: str = '', offline: str = '',
            staff: bool = False) -> str:
    book_of = 'Floor'
    for name, rooms in BOOKS:
        if any(h == active for _, h in rooms):
            book_of = name
    tabs = ''.join(f'<a class="tab" href="#"{CUR_TRUE if n == book_of else ""}>{n}</a>' for n, _ in BOOKS[:5])
    tabs += '<a class="tab" href="#">More<small>house · ask</small></a>'
    chips = ''
    for n, rs in BOOKS:
        if n == book_of:
            chips = ''.join(f'<a class="roomB" href="#"{CUR_PAGE if h == active else ""}>{l}</a>' for l, h in rs if not (staff and h in GATED))
    return f'''<div class="mudavym phone narrow">
  {header(house, page, badge, narrow=False).replace('<div class="hdr__in">', '<div class="hdr__in">')}
  {offline}
  <div class="chiprow">{chips}</div>
  {inner}
  {bottom}
  <nav class="tabbar" aria-label="Books">{tabs}</nav>
</div>'''


def build_b() -> str:
    us, tr = US, TR
    entry_undo = b_entry('undo', 'Dismissed', 'Reorder Chablis left the docket.', '<button class="link">Undo</button>')
    entry_held = b_entry('held', 'Written here', 'Note on the Chablis line — not on the house.', count='+5')
    entry_sealed = b_entry('sealed', 'Sealed', f'Order to {us["vendors"][0]}, {us["money"][0]} — seal 7f3a.', '<button class="link">Open</button>')
    book_pop = f'''<div class="bookpop" style="left:246px;top:-6px">
  <div class="pop__head"><span class="eyebrow">The door · 5 rooms</span><h2 class="pop__title">Where goods come in</h2></div>
  <div class="pop__body">
    <a class="item" href="#" data-active="true"><span class="item__text"><span class="item__label">Orders</span><span class="item__sub">drafted · sealed · sent · received</span></span><kbd class="kbd">2 1</kbd></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Receiving</span><span class="item__sub">the door — one-handed, at the dock</span></span><kbd class="kbd">2 2</kbd></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Providers</span><span class="item__sub">who supplies the house, and on what terms</span></span><kbd class="kbd">2 3</kbd></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Promotions</span><span class="item__sub">offers pulled from mail; dismissal is house-wide</span></span><kbd class="kbd">2 4</kbd></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Vendor prices</span><span class="item__sub">every sighting names its source, date and unit</span></span><kbd class="kbd">2 5</kbd></a>
  </div>
  <div class="pop__foot">Hover or press 2 on a book: the popover is the book&#8217;s index. Press the room&#8217;s number to go; Esc closes.</div>
</div>'''
    entries_pop = f'''<div class="entries">
  <div class="pop__head"><span class="eyebrow">This session · 5 entries · newest first</span><h2 class="pop__title">What the house said</h2></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Written here — note on the Chablis line</span><span class="item__sub">14:05 · not on the house · undo-after still open (F10)</span></span><button class="link" style="font-size:12px">Undo</button></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismissed — Reorder Chablis</span><span class="item__sub">14:02:11 · confirmed · undone at 14:02:19</span></span></div>
    <div class="item"><span class="item__text"><span class="item__label">Sealed — order to {us['vendors'][0]}, {us['money'][0]}</span><span class="item__sub">14:01:48 · seal 7f3a · a receipt, not an undo</span></span></div>
    <div class="item"><span class="item__text"><span class="item__label">Refused — remove shift, Fri 18:00</span><span class="item__sub">13:58:02 · a staff member tried; needs a manager</span></span></div>
    <div class="item"><span class="item__text"><span class="item__label">Draft kept — reply to {us['vendors'][1]}</span><span class="item__sub">13:41:10 · not sent</span></span></div>
  </div>
  <div class="pop__foot">Entries are the toasts this direction does not float: each lived 8 s in the bar and is kept here for the session. The bell&#8217;s book is the house&#8217;s record; this is yours.</div>
</div>'''
    offline_strip = '''<div class="off" role="status"><span class="off__dot"></span><span class="eyebrow">Offline since 14:02</span><span>3 records written here, none sent. The bell and the counts are from 14:01:48, the house&#8217;s last answer.</span><button class="link">What is where</button></div>'''
    ladder_pop = '''<div class="pop" style="right:24px;top:8px">
  <div class="pop__head"><span class="eyebrow">3 records · the house last answered 14:01:48</span><h2 class="pop__title">Written here, not on the house</h2></div>
  <div class="ladder"><span data-on="true">written here</span><i></i><span>sent</span><i></i><span>received</span><i></i><span>sealed by the house</span></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Door count — Kermit Lynch, 12 of 12</span><span class="item__sub">14:03 · the count sits on this device</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Note on the Chablis line</span><span class="item__sub">14:05</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismiss: Reorder Chablis</span><span class="item__sub">14:06 · on this device only</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
  </div>
  <div class="pop__foot">Nothing here is confirmed. A seal is never queued (ADR 0140).</div>
</div>'''

    html = head('Sketch 106 · B — The ledger bar', B_CSS)
    html += '''<div class="sk-band"><h1>Sketch 106 · Direction B — The ledger bar</h1>
<p class="sk-sub">No rail. The built house header keeps line one; a second line carries the six books of the house as tabs — Floor · Door · Cellar · Books · People · House — with the open book&#8217;s rooms inline beside them. One click inside a book, two across books, the palette for anything. The page gets all 1440 px, which /reports, /inventory and the orders ledger want. The house speaks in the same bar: a toast is a ledger entry at the right end of line two, never a card floating over the work. The theme menu is retired and the floating Wine Agent button is removed (ADR 0149 rows 6, 33); <em>Ask Mudavym.</em> sits at the bar&#8217;s right end on a desktop, and under More on a phone. On a phone the books become a bottom tab bar and the open book&#8217;s rooms a chip row; no drawer exists.</p></div>'''

    html += f'<div class="sk-label">01 · Owner · {us["name"]} · en-US · USD · 1440 · the Door book open, an undo entry in the bar<small>Number keys reach a book (1–6), then a room (1–8): &#8220;2 1&#8221; is Orders. Ask Mudavym sits at the bar&#8217;s right end; Profile is in the account menu.</small></div>'
    html += fitframe(b_frame(us, page_orders(us), 'Orders', '/orders', entry=entry_undo))

    html += f'<div class="sk-label">02 · Staff · {tr["name"]} · tr-TR · TRY · 1440 · the House book open — Connections and The desk are absent for staff, Settings and Help remain<small>The open book is House to show the gating; the page under it is Receiving, reached from the Door book a moment ago.</small></div>'
    html += fitframe(b_frame(tr, page_receiving(tr), 'Receiving', '/receiving', staff=True, badge='3', open_book='House', entry=b_entry('refused', 'Refused', 'A staff member may not remove a shift. Ask Kerem.')))

    html += '<div class="sk-label">03 · Owner · 1440 · the Cellar book open with a live sealed entry — the tightest case at this width, not the Door book<small>Measured: Cellar&#8217;s 8 rooms overflow the strip before the entry does. The strip now fades at its right edge and a &#8220;+N rooms&#8221; chip says more are off-screen, rather than a silent hidden scrollbar.</small></div>'
    html += fitframe(b_frame(us, page_orders(us), 'Orders', '/orders', open_book='Cellar', entry=entry_sealed, min_h=200).replace('<div class="mainB">', '<div class="mainB" style="min-height:60px">'))

    html += '<div class="sk-label">04 · A book&#8217;s index — hover or press its number, and the popover (the anchored shape, ADR 0112) lists the rooms with a line each</div>'
    html += fitframe(b_frame(us, page_orders(us), 'Orders', '/orders', overlay=book_pop, min_h=620))

    html += '<div class="sk-label">05 · Toasts as ledger entries — the three states in the bar, and the session&#8217;s entries opened from the +N count<small>An entry lives 8 s (the drain) and then folds into the count; its time is in the session&#8217;s entries. Undo only where F10 allows; a sealed act is a receipt line with the wax; a held write is a dashed rule.</small></div>'
    html += fitframe(b_frame(us, page_orders(us), 'Orders', '/orders', entry=entry_held, overlay=entries_pop, min_h=620))
    html += '<div style="height:16px"></div>'
    html += fitframe(b_frame(us, page_orders(us), 'Orders', '/orders', entry=entry_sealed, min_h=180).replace('<div class="mainB">', '<div class="mainB" style="min-height:60px">'))
    html += f'<div class="sk-row" style="margin-top:22px"><div class="mudavym" style="padding:24px;border:1px solid #b6ad9e;width:100%;max-width:1360px"><span class="sect" style="padding:0 0 10px">The same five states as cards — for the phone, and for the founder to compare against A and C</span><div class="toast-stack" style="flex-direction:row;flex-wrap:wrap;gap:14px">{toast_set(us, 400)}</div><p class="quiet" style="margin:16px 0 0;max-width:820px">On a phone the bar has no room for an entry, so the five states are cards docked above the tab bar — the same anatomy as A&#8217;s margin note. The cost of B&#8217;s idea is drawn plainly here: the desktop and the phone speak from different places.</p></div></div>'

    html += '<div class="sk-label">06 · The page loader — under the bar; the hairline that hardens on scroll doubles as the progress rule<small>Same three moments as A and C: nothing under 400 ms, the page&#8217;s own skeleton to 3 s, an honest 12 s state that never fakes a row.</small></div>'
    html += loader_strip()

    html += '<div class="sk-label">07 · Offline — the strip under the bar, and the ladder (queued is never confirmed)<small>The house name in line one is not replaced: the strip is the one place the state is said, and it says what was written here and when the house last answered.</small></div>'
    html += fitframe(b_frame(us, page_orders({**us, 'clock': '14:01:48'}), 'Orders', '/orders', badge='unknown', offline=offline_strip, overlay=ladder_pop, entry=b_entry('held', 'Written here', 'Note on the Chablis line — not on the house.', count='+2'), min_h=700))

    html += '<div class="sk-label">08 · The failure sheet — the bar survives; you can leave the room that failed</div>'
    html += fitframe(b_frame(us, fail_block(us), 'Orders', '/orders', min_h=640))

    html += '<div class="sk-label">09 · 404 — no book claims the address; the bar shows the Floor book, the page names the nearest room</div>'
    html += fitframe(b_frame(us, nf_block(), 'Not found', '/nowhere', open_book='Floor', min_h=760))

    html += '<div class="sk-label">10 · 390 — books as a bottom tab bar, the open book&#8217;s rooms as a chip row, no drawer; a toast card above the tabs; offline as the strip; the ladder as a bottom sheet</div>'
    ph1 = b_phone(us, page_orders(us), 'Orders', '/orders', bottom=f'<div class="entryM">{toast("undo", "Dismissed · the house confirmed", us["clock"], "Reorder Chablis left the docket.", "", UNDO_ACT_M, drain=True, width=366)}</div>')
    ph2 = b_phone(tr, page_receiving(tr), 'Receiving', '/receiving', badge='3', staff=True,
                  bottom=f'<div class="entryM">{toast("refused", "Refused by the house", tr["clock"], "A staff member may not remove a shift. Ask Kerem.", "", width=366)}</div>')
    ladder_sheet = '''<div class="sheetB" style="bottom:0;z-index:60"><div class="sheetB__grip"></div>
  <div class="pop__head" style="padding-top:8px"><span class="eyebrow">3 records · the house last answered 14:01:48</span><h2 class="pop__title">Written here, not on the house</h2></div>
  <div class="ladder" style="flex-wrap:wrap;gap:6px 0"><span data-on="true">written here</span><i></i><span>sent</span><i></i><span>received</span><i></i><span>sealed</span></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Door count — Kavaklıdere, 18 of 18</span><span class="item__sub">14:03 · on this phone</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Note on the Doluca delivery</span><span class="item__sub">14:05</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismiss: Reorder Öküzgözü</span><span class="item__sub">14:06 · on this device only</span></span><span class="rung"><b>written here</b>1 of 4</span></div>
  </div>
  <div class="pop__foot">Nothing here is confirmed. A seal is never queued.</div></div>'''
    ph3 = b_phone(tr, page_receiving(tr), 'Receiving', '/receiving', badge='unknown', staff=True,
                  offline='<div class="off" style="padding:8px 12px;font-size:12px;gap:8px"><span class="off__dot"></span><span class="eyebrow">Offline 14:02</span><span>3 written here</span><button class="link">Where</button></div>',
                  bottom='<div class="scrim" style="z-index:55"></div>' + ladder_sheet)
    html += f'<div class="sk-row"><div class="fit" data-fit="390">{ph1}</div><div class="fit" data-fit="390">{ph2}</div><div class="fit" data-fit="390">{ph3}</div></div>'

    html += '<div class="sk-label">11 · 390 — the More tab, open: Settings, the two role-gated rooms and the door to Mudavym, for owner and for staff<small>Neither door to the assistant (/ask or &#8984;&#8679;K) is visible on the tab bar itself; both live one tap under More.</small></div>'
    more_owner = '''<div class="scrim" style="z-index:55"></div><div class="sheetB" style="bottom:0;z-index:60;padding-bottom:12px"><div class="sheetB__grip"></div>
  <div class="pop__head" style="padding-top:8px"><h2 class="pop__title">More</h2></div>
  <div class="pop__body">
    <a class="item" href="#"><span class="item__text"><span class="item__label">Settings</span></span></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Connections</span></span><span class="kbd" style="font-size:9px">manager</span></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">The desk</span></span><span class="kbd" style="font-size:9px">owner</span></a>
    <a class="item" href="#"><span class="item__text"><span class="item__label">Help</span></span></a>
    <a class="item" href="#" style="border-top:1px solid var(--paper-2);margin-top:4px;padding-top:12px"><span class="item__text"><span class="item__label">Ask Mudavym.</span></span></a>
  </div></div>'''
    more_staff = more_owner.replace(
        '    <a class="item" href="#"><span class="item__text"><span class="item__label">Connections</span></span><span class="kbd" style="font-size:9px">manager</span></a>\n'
        '    <a class="item" href="#"><span class="item__text"><span class="item__label">The desk</span></span><span class="kbd" style="font-size:9px">owner</span></a>\n', '')
    ph4 = b_phone(us, page_orders(us), 'Orders', '/orders', bottom=more_owner)
    ph5 = b_phone(tr, page_receiving(tr), 'Receiving', '/receiving', badge='3', staff=True, bottom=more_staff)
    html += f'<div class="sk-row"><div class="fit" data-fit="390">{ph4}</div><div class="fit" data-fit="390">{ph5}</div></div>'

    html += '''<div class="sk-label">12 · Paper, declared — the bar on the canonical document&#8217;s paper ground (ADR 0104 D9)</div>
<div class="fitwrap"><div class="fit" data-fit="1440"><div class="mudavym frame" data-ground="paper" style="min-height:120px">''' + header(US, 'Document', '12') + b_bar(US, '/documents-reports', entry=b_entry('undo', 'Dismissed', 'Reorder Chablis left the docket.', '<button class="link">Undo</button>')) + '''</div></div></div>
<p class="sk-foot">Sketch 106 · B. Fonts load from Google for the drawing; the product self-hosts them (ADR 0149 row 9). Books are set in Fraunces 600 because they are the house&#8217;s own names; rooms in DM Sans because they are the built page names. Motion: ink 160 only in the bar (chrome that animates is chrome you look at); entries fold on tuck 300; the drain is linear. Reduced motion collapses every transition.</p>'''
    html += tail()
    return html


# ═════════════════════════════════════════════════════════════════════════════
# DIRECTION C — The tally rail: a rail whose rooms carry live counts, and every
# count opens to its source. A count is printed only when the register answered.
# ═════════════════════════════════════════════════════════════════════════════
C_CSS = r"""
.shellC{display:grid;grid-template-columns:260px 1fr;min-height:880px}
.shellC[data-rail="narrow"]{grid-template-columns:72px 1fr}
.railC{background:var(--paper-1);border-right:1px solid var(--paper-2);display:flex;flex-direction:column;padding:10px 0 0}
.railC .sect,.railC-m .sect{padding:12px 18px 4px}
.roomC{display:grid;grid-template-columns:18px 1fr auto;align-items:center;gap:10px;padding:6px 14px 6px 16px;border-left:2px solid transparent;font-size:13px;color:var(--ink-2);text-decoration:none;line-height:1.3}
.roomC:hover{background:var(--paper-2);color:var(--ink-1)}
.roomC[aria-current="page"]{background:var(--seal-tint);border-left-color:var(--seal);color:var(--ink-1);font-weight:500}
.roomC svg{color:var(--ink-3);width:16px;height:16px}
.roomC[aria-current="page"] svg{color:var(--seal)}
.tally{font-family:var(--mono);font-size:11px;font-weight:500;color:var(--ink-1);background:var(--paper-0);border:1px solid var(--paper-2);border-radius:5px;padding:1px 6px;min-width:22px;text-align:center;font-variant-numeric:tabular-nums;cursor:pointer;transition:border-color 160ms var(--house)}
.tally:hover{border-color:var(--seal-ring)}
.tally--unknown{width:9px;height:9px;min-width:0;padding:0;border-radius:999px;border:1.5px dashed var(--ink-4);background:transparent;justify-self:center}
.tally--loading{width:14px;height:2px;min-width:0;padding:0;border-radius:1px;background:var(--paper-2);justify-self:center;align-self:center}
.tally--stale{color:var(--ink-3);border-style:dashed}
.tally--seal{color:var(--seal-deep);border-color:var(--seal-ring)}
.tally--from{font-size:9px;letter-spacing:.04em;color:var(--ink-3);border:0;background:transparent;padding:0}
.railC__foot{margin-top:auto;border-top:1px solid var(--paper-2);padding:8px 0 8px}
.cadence{padding:8px 16px 4px;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;color:var(--ink-3);line-height:1.6}
.cadence b{color:var(--ink-2);font-weight:500}
.cadence .link{font-size:11px;margin-left:6px}
.shellC[data-rail="narrow"] .roomC{grid-template-columns:1fr;justify-items:center;padding:9px 0;position:relative}
.shellC[data-rail="narrow"] .roomC .lbl,.shellC[data-rail="narrow"] .sect,.shellC[data-rail="narrow"] .cadence .w,.shellC[data-rail="narrow"] .tally--from,.shellC[data-rail="narrow"] .roomC .kbd{display:none}
.shellC[data-rail="narrow"] .tally{position:absolute;top:3px;right:9px;font-size:9px;padding:0 4px;min-width:16px;line-height:14px}
.shellC[data-rail="narrow"] .tally--unknown{top:7px;right:14px;min-width:0;width:8px;height:8px;line-height:0}
.shellC[data-rail="narrow"] .cadence{padding:8px 4px;text-align:center;font-size:8.5px}
.srcpop{position:absolute;z-index:60;background:var(--paper-0);border:1px solid var(--paper-2);border-radius:14px;box-shadow:0 18px 44px -22px rgba(0,0,0,.42);width:320px;overflow:hidden}
.srcpop .q{font-family:var(--mono);font-size:10.5px;color:var(--ink-2);background:var(--paper-1);border:1px solid var(--paper-2);border-radius:6px;padding:6px 8px;margin:8px 16px 4px;word-break:break-all}
.srcpop .item{align-items:flex-start}
.mainC{position:relative;min-width:0}
.toastC{position:absolute;left:16px;bottom:16px;z-index:50}
.tallymove{font-family:var(--mono);font-size:11px;color:var(--ink-3);line-height:1.5}
.tallymove b{color:var(--ink-1);font-weight:500}
.hint{position:absolute;z-index:70;background:var(--paper-0);color:var(--ink-1);border:1px solid var(--paper-2);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.4);padding:8px 11px;width:250px;font-size:12px}
.hint b{display:block;font-weight:500;margin-bottom:2px}
.hint span{color:var(--ink-3);font-size:11.5px;line-height:1.4;display:block}
.dot{width:7px;height:7px;border-radius:999px;background:var(--seal);display:inline-block}
"""

ICONS = {
    'grid': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    'cal': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    'case': '<path d="M4 6h16v13H4z"/><path d="M4 11h16M9 6V4h6v2"/>',
    'cart': '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.7 12h11L21 7H6"/>',
    'door': '<path d="M5 3h14v18H5z"/><path d="M14 12h.01"/>',
    'truck': '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    'tag': '<path d="M3 12V4h8l9 9-8 8z"/><path d="M7 8h.01"/>',
    'price': '<path d="M4 20h16M6 16l4-5 4 3 4-7"/>',
    'box': '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    'wine': '<path d="M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v7M8 20h8"/>',
    'receipt': '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    'doc': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    'chart': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    'scroll': '<path d="M6 4h12v14H6z"/><path d="M6 18a2 2 0 0 0 4 0V4M9 8h6M9 12h6"/>',
    'users': '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20a5 5 0 0 1 6 0"/>',
    'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'gear': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    'plug': '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    'help': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
    'desk': '<path d="M3 10h18M5 10V6h14v4M4 10v10M20 10v10"/>',
    'ask': '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M5 17l.8 2 2 .8-2 .8L5 22l-.8-1.4-2-.8 2-.8z"/>',
}


def icon(name: str) -> str:
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" '
            f'stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


# (label, href, icon, tally kind, tally text)
# Owner (Larkspur & Vine) and staff (Sim Meyhouse) each read their own register — the
# staff rail is not the owner's numbers copied; the bell badge passed to header() must
# always equal the Notifications row here, since both name the same register.
def c_rooms_data(staff: bool, offline: bool = False, loading: bool = False, overrides: dict | None = None) -> list:
    unk = 'unknown'
    counts = dict(notif='3', orders='1', receipts='', reco='2', comms='1', team='0',
                  receiving='1', inv='4', promo='1', cal='1') if staff else \
              dict(notif='12', orders='3', receipts='2', reco='4', comms='2', team='1',
                   receiving='1', inv='7', promo='3', cal='2')
    if overrides:
        counts.update(overrides)
    rows = [
        ('sect', 'Waiting on you'),
        ('Dashboard', '/', 'grid', None, ''),
        ('Notifications', '/notifications', 'bell', 'n', counts['notif']),
        ('Orders', '/orders', 'cart', 'n', counts['orders']),
        ('Receipts &amp; Credits', '/receipts', 'receipt', 'n', counts['receipts']),
        ('Recommendations', '/recommendations', 'case', 'n', counts['reco']),
        ('Communications', '/communications', 'mail', 'n', counts['comms']),
        ('Team', '/team', 'users', 'n', counts['team']),
        ('sect', 'The house'),
        ('Receiving', '/receiving', 'door', 'n', counts['receiving']),
        ('Inventory', '/inventory', 'box', 'n', counts['inv']),
        ('Cellar', '/cellar', 'wine', None, ''),
        ('Providers', '/providers', 'truck', None, ''),
        ('Promotions', '/promotions', 'tag', 'n', counts['promo']),
        ('Vendor prices', '/vendor-prices', 'price', unk, ''),
        ('Documents &amp; Reports', '/documents-reports', 'doc', None, ''),
        ('Reports', '/reports', 'chart', None, ''),
        ('Calendar', '/calendar', 'cal', 'n', counts['cal']),
        ('Logs', '/logs', 'scroll', None, ''),
    ]
    if staff:
        # staff: the money tallies print nothing — the register refused the read (G19); the room stays
        rows = [(r[0], r[1], r[2], ('refused' if r[1] in ('/receipts', '/vendor-prices') else r[3]), ('' if r[1] in ('/receipts', '/vendor-prices') else r[4])) if r[0] != 'sect' else r for r in rows]
    if loading:
        # still reading is not the same state as a failed read — a distinct mark, not the
        # dashed ring Vendor prices below keeps for its own, genuinely failed read
        rows = [(r[0], r[1], r[2], 'loading' if r[3] == 'n' else r[3], '') if r[0] != 'sect' else r for r in rows]
    if offline:
        rows = [(r[0], r[1], r[2], 'stale' if r[3] == 'n' else r[3], r[4]) if r[0] != 'sect' else r for r in rows]
    return rows


def c_rail(house: dict, active: str, staff: bool = False, offline: bool = False, loading: bool = False,
           foot: bool = True, queued: bool = False, overrides: dict | None = None) -> str:
    out = []
    if queued:
        out.append('<span class="sect">On this device</span>')
        out.append('<a class="roomC" href="#" style="color:var(--ink-1)">%s<span class="lbl">Written here, not sent</span><span class="tally tally--stale">3</span></a>' % icon('doc'))
    for r in c_rooms_data(staff, offline, loading, overrides):
        if r[0] == 'sect':
            out.append(f'<span class="sect">{r[1]}</span>')
            continue
        label, href, ic, kind, txt = r
        cur = ' aria-current="page"' if href == active else ''
        if kind == 'n':
            t = f'<button class="tally" aria-label="{txt} — open the source">{txt}</button>'
        elif kind == 'stale':
            t = f'<button class="tally tally--stale" title="from 14:01">{txt}</button>'
        elif kind == 'unknown':
            t = '<span class="tally tally--unknown" title="the register did not answer"></span>'
        elif kind == 'loading':
            t = '<span class="tally tally--loading" title="still reading"></span>'
        elif kind == 'refused':
            t = '<span class="tally tally--from" title="refused for this role">refused</span>'
        else:
            t = '<span></span>'
        out.append(f'<a class="roomC" href="#"{cur}>{icon(ic)}<span class="lbl">{label}</span>{t}</a>')
    out.append('<span class="sect">Mudavym</span>')
    out.append(f'<a class="roomC" href="#">{icon("ask")}<span class="lbl">Ask Mudavym.</span><kbd class="kbd">⌘⇧K</kbd></a>')
    if foot:
        f = ['<div class="railC__foot">']
        f.append(f'<a class="roomC" href="#">{icon("gear")}<span class="lbl">Settings</span><span></span></a>')
        if not staff:
            f.append(f'<a class="roomC" href="#">{icon("plug")}<span class="lbl">Connections</span><span class="tally tally--from">manager</span></a>')
            f.append(f'<a class="roomC" href="#">{icon("desk")}<span class="lbl">The desk</span><span class="tally tally--from">owner</span></a>')
        f.append(f'<a class="roomC" href="#">{icon("help")}<span class="lbl">Help</span><span></span></a>')
        if offline:
            f.append('<div class="cadence"><b>Offline since 14:02</b><span class="w"> · counts are from <b>14:01:48</b> and are drawn dashed until the house answers again</span></div>')
        elif loading:
            f.append('<div class="cadence"><span class="w">Reading the registers …</span></div>')
        else:
            f.append('<div class="cadence"><span class="w">Read </span><b>14:02:11</b><span class="w"> · again in 60 s · and on focus</span><button class="link w">Read now</button></div>')
        f.append('</div>')
        out.append(''.join(f))
    return ''.join(out)


def c_frame(house: dict, page_html: str, page_name: str, active: str, staff: bool = False, badge: str = '12',
            overlay: str = '', rail: str = 'wide', offline: str = '', off: bool = False, loading: bool = False,
            queued: bool = False, min_h: int = 880, overrides: dict | None = None) -> str:
    return f'''<div class="mudavym frame" style="min-height:{min_h}px"><div class="shellC" data-rail="{rail}">
  <nav class="railC" aria-label="Rooms">{c_rail(house, active, staff, off, loading, queued=queued, overrides=overrides)}</nav>
  <div class="mainC">
    {header(house, page_name, badge)}
    {offline}
    {page_html}
    {overlay}
  </div>
</div></div>'''


def c_phone(house: dict, inner: str, page: str, badge: str = '12', drawer: bool = False, bottom: str = '',
            offline: str = '', staff: bool = False, off: bool = False, menu_dot: bool = True) -> str:
    d = ''
    if drawer:
        d = f'''<div class="scrim"></div><div class="sheetL" style="width:312px">
  <div style="display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--paper-2)">
    <span class="hdr__mark">{mark(22)}</span><div><div style="font-size:13px;font-weight:500">{house['name']}</div><div class="quiet" style="font-size:11px">{house['role']} · {house['place']}</div></div>
    <button class="link" style="margin-left:auto">Close</button></div>
  <div style="overflow:auto;flex:1;background:var(--paper-1)" class="railC-m">{c_rail(house, '/receiving' if staff else '/orders', staff=staff, offline=off)}</div>
</div>'''
    return f'''<div class="mudavym phone narrow">
  {header(house, page, badge, narrow=True, menu_dot=menu_dot)}
  {offline}
  {inner}
  {bottom}{d}
</div>'''


def build_c() -> str:
    us, tr = US, TR
    src_pop = f'''<div class="srcpop" style="left:8px;top:96px">
  <div class="pop__head"><span class="eyebrow">Orders · 3 · read 14:02:11 · the register answered</span><h2 class="pop__title">Three orders await your seal</h2></div>
  <div class="q">GET /procurement/orders/pending/count · 212 ms</div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">{us['vendors'][0]} — 12 lines</span><span class="item__sub">drafted by Mudavym 08:40 · 9 of 12 lines at the agreed price</span></span><span class="mono" style="font-size:11.5px">{us['money'][0]}</span></div>
    <div class="item"><span class="item__text"><span class="item__label">{us['vendors'][1]} — 6 lines</span><span class="item__sub">drafted by Maya 11:02 · last invoice price</span></span><span class="mono" style="font-size:11.5px">{us['money'][1]}</span></div>
    <div class="item"><span class="item__text"><span class="item__label">{us['vendors'][2]} — 4 lines</span><span class="item__sub">drafted by Mudavym 12:15 · one line has no price</span></span><span class="mono" style="font-size:11.5px">{us['money'][2]}</span></div>
  </div>
  <div class="pop__foot" style="display:flex;justify-content:space-between;align-items:center"><span>The number is the register&#8217;s, not the page&#8217;s: a different filter on /orders does not change it.</span><button class="link">Open, filtered</button></div>
</div>'''
    toast_dock = f'<div class="toastC"><div class="toast-stack">{toast("undo", "Dismissed · the house confirmed", us["clock"], "Reorder Chablis left the docket, house-wide.", TALLY_REC_LONG, UNDO_ACT, drain=True)}</div></div>'
    hint = '''<div class="hint" style="left:8px;top:70px"><b>Orders · 3 awaiting your seal</b><span>Drafted, sealed, sent, received. The count is the register&#8217;s own, read at 14:02:11.</span></div>'''
    offline_strip = '''<div class="off" role="status"><span class="off__dot"></span><span class="eyebrow">Offline since 14:02</span><span>3 records written here, none sent. Every tally in the rail is from 14:01:48 and is drawn dashed.</span><button class="link">What is where</button></div>'''
    ladder_pop = '''<div class="pop" style="left:-20px;top:-4px">
  <div class="pop__head"><span class="eyebrow">3 records · the house last answered 14:01:48</span><h2 class="pop__title">Written here, not on the house</h2></div>
  <div class="ladder"><span data-on="true">written here</span><i></i><span>sent</span><i></i><span>received</span><i></i><span>sealed by the house</span></div>
  <div class="pop__body">
    <div class="item"><span class="item__text"><span class="item__label">Door count — Kermit Lynch, 12 of 12</span><span class="item__sub">14:03 · the count sits on this device</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Note on the Chablis line</span><span class="item__sub">14:05</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
    <div class="item"><span class="item__text"><span class="item__label">Dismiss: Reorder Chablis</span><span class="item__sub">14:06 · on this device only</span></span><span class="rung"><b>written here</b>rung 1 of 4</span></div>
  </div>
  <div class="pop__foot">The queue is itself a tally with a source: this device. Nothing here is confirmed; a seal is never queued (ADR 0140).</div>
</div>'''

    html = head('Sketch 106 · C — The tally rail', C_CSS)
    html += '''<div class="sk-band"><h1>Sketch 106 · Direction C — The tally rail</h1>
<p class="sk-sub">A rail that keeps score. Every room that has a queue carries its count — unread, awaiting seal, to verify, open cases, replies waiting, invitations, below par, expected at the door, new offers, today&#8217;s events — and every count is a door: it opens to the query that produced it, the time it was read, and the rows behind it. A count is printed only when the register answered; a failed read is a hollow ring, never a zero; a register the role may not read says <em>refused</em>; a room with nothing waiting prints nothing. The rail collapses to 72 px and the numbers survive the collapse, because in this direction the number is the room&#8217;s identity. The cadence is written at the foot (60 s + on focus, the bell&#8217;s staircase). The theme menu is retired and the floating Wine Agent button is removed (ADR 0149 rows 6, 33); <em>Ask Mudavym.</em> is its own section of the rail.</p></div>'''

    html += f'<div class="sk-label">01 · Owner · {us["name"]} · en-US · 1440 · rail wide, the Orders tally opened to its source, the undo toast reporting which tally moved<small>Sources that exist today: unread (GET /notifications/unread/count), pending orders (ordersApi.getPendingOrdersCount), low stock (GET /inventory/:id/low-stock). The other seven counts need a count read each — named in the README as the cost.</small></div>'
    html += fitframe(c_frame(us, page_orders(us), 'Orders', '/orders', overlay=src_pop + toast_dock, overrides={'reco': '3'}))

    html += f'<div class="sk-label">02 · Staff · {tr["name"]} · tr-TR · 1440 · the money registers say refused, the rooms stay; Connections and The desk are absent<small>No route refuses a staff read on Receipts &amp; Credits or Vendor prices today (<span class="mono">credits.controller.ts</span> carries only <span class="mono">JwtAuthGuard</span>; ADR 0114&#8217;s G19 gates <span class="mono">/payment-methods</span> and <span class="mono">/billing/provider</span>, not these). This direction draws the refusal as its cost: a new staff gate on both reads, so the tally can say <em>refused</em> in words rather than print a number the role should not see.</small></div>'
    html += fitframe(c_frame(tr, page_receiving(tr), 'Receiving', '/receiving', staff=True, badge='3'))

    html += '<div class="sk-label">03 · Narrow (72 px) — icons with their tallies; the hover hint carries the count and its time</div>'
    html += fitframe(c_frame(us, page_orders(us), 'Orders', '/orders', rail='narrow', overlay=hint, min_h=700))

    html += '<div class="sk-label">04 · While the registers are read — a hairline mark for still-reading, never a zero (ADR 0020); Vendor prices keeps its own dashed ring beside it, since that read has actually failed, not merely not finished<small>Loading and failed look the same if both are a dashed ring; this direction gives &#8220;still reading&#8221; its own mark so the two are never confused.</small></div>'
    html += fitframe(c_frame(us, skeleton_page(), 'Orders', '/orders', badge='unknown', loading=True, min_h=700).replace('<div class="mainC">', '<div class="mainC"><div class="load-bar"><i></i></div>'))
    html += loader_strip()

    html += f'<div class="sk-label">05 · Toasts — docked at the rail&#8217;s foot; when an act moves a count, the toast names the move and the tally runs on the tally token (840 ms, overdamped)<small>Same five states as A and B; the second line is where C differs — it reports the tally that changed, and says &#8220;unchanged&#8221; when the act moved nothing, so a dismissal cannot pretend to have cleared a queue.</small></div>'
    tset = '\n'.join([
        toast('undo', 'Dismissed · the house confirmed', us['clock'], 'Reorder Chablis left the docket, house-wide.', '<span class="tallymove">Recommendations <b>4</b> → <b>3</b></span>', '<button class="link">Undo</button><kbd class="kbd">⌘Z</kbd>', drain=True, width=400),
        toast('held', 'Written here · not on the house', us['clock'], 'Your note on the Doluca delivery is kept on this device.', '<span class="tallymove">On this device <b>2</b> → <b>3</b> · no house tally moved</span>', width=400),
        toast('sealed', 'Sealed · receipt', us['clock'], f'Order to {us["vendors"][0]}, {us["money"][0]} — seal 7f3a.', '<span class="tallymove">Orders awaiting seal <b>3</b> → <b>2</b> · Sent <b>2</b> → <b>3</b></span>', wax=True, act='<button class="link">Open</button>', width=400),
        toast('refused', 'Refused by the house', us['clock'], 'A staff member tried to remove a shift; it needs a manager.', '<span class="tallymove">Team unchanged</span>', width=400),
        toast('undo', 'Draft kept · not sent', us['clock'], f'Reply to {us["vendors"][1]} is a draft.', '<span class="tallymove">Communications replies waiting <b>2</b> — unchanged; a draft is not a send</span>', act='<button class="link">Open draft</button>', width=400),
    ])
    html += f'<div class="sk-row"><div class="mudavym" style="padding:24px;border:1px solid #b6ad9e;width:100%;max-width:1360px"><div class="toast-stack" style="flex-direction:row;flex-wrap:wrap;gap:14px">{tset}</div></div></div>'

    html += '<div class="sk-label">06 · Offline — the tallies freeze and turn dashed, the foot says when they were read, and the queue appears as a tally of its own at the top of the rail<small>The ladder popover opens from that row; queued is never confirmed.</small></div>'
    html += fitframe(c_frame(us, page_orders({**us, 'clock': '14:01:48'}), 'Orders', '/orders', badge='unknown', off=True, queued=True, offline=offline_strip, overlay=ladder_pop.replace('left:-20px;top:-4px', 'left:8px;top:36px'), min_h=760))

    html += '<div class="sk-label">07 · The failure sheet — the rail keeps reading while the page is down</div>'
    html += fitframe(c_frame(us, fail_block(us), 'Orders', '/orders', min_h=640))

    html += '<div class="sk-label">08 · 404 — with the rooms and their tallies at hand</div>'
    html += fitframe(c_frame(us, nf_block(), 'Not found', '/nowhere', min_h=760))

    html += '<div class="sk-label">09 · 390 — the rooms toggle carries a dot (never a sum across registers); the drawer keeps every tally; offline as the strip with the dashed tallies in the drawer</div>'
    ph1 = c_phone(us, page_orders(us), 'Orders', bottom=f'<div style="position:absolute;left:12px;right:12px;bottom:14px;z-index:50">{toast("undo", "Dismissed · the house confirmed", us["clock"], "Reorder Chablis left the docket.", TALLY_REC, UNDO_ACT_M, drain=True, width=366)}</div>')
    ph2 = c_phone(tr, page_receiving(tr), 'Receiving', badge='3', drawer=True, staff=True)
    ph3 = c_phone(tr, page_receiving(tr), 'Receiving', badge='unknown', drawer=True, staff=True, off=True, menu_dot=False,
                  offline='<div class="off" style="padding:8px 12px;font-size:12px;gap:8px"><span class="off__dot"></span><span class="eyebrow">Offline 14:02</span><span>3 written here</span><button class="link">Where</button></div>')
    html += f'<div class="sk-row"><div class="fit" data-fit="390">{ph1}</div><div class="fit" data-fit="390">{ph2}</div><div class="fit" data-fit="390">{ph3}</div></div>'

    html += '''<div class="sk-label">10 · Paper, declared — a tally row on the paper ground (ADR 0104 D9)</div>
<div class="sk-row"><div class="mudavym" data-ground="paper" style="padding:12px 0;border:1px solid #b6ad9e;width:100%;max-width:420px"><div class="railC" style="border:0;background:transparent;padding:0">''' + f'<a class="roomC" href="#" aria-current="page">{icon("cart")}<span class="lbl">Orders</span><button class="tally">3</button></a><a class="roomC" href="#">{icon("price")}<span class="lbl">Vendor prices</span><span class="tally tally--unknown"></span></a>' + '''</div></div></div>
<p class="sk-foot">Sketch 106 · C. Fonts load from Google for the drawing; the product self-hosts them (ADR 0149 row 9). Icons here are stand-ins for lucide-react&#8217;s (the set the built sidebar uses); a real build keeps lucide. Motion: ink 160 (hover), tally 840 (a count changing), tuck 300 (the toast stack); the drain is linear. Reduced motion: counts change without travelling.</p>'''
    html += tail()
    return html


if __name__ == '__main__':
    for name, fn in (('direction-a.html', build_a), ('direction-b.html', build_b), ('direction-c.html', build_c)):
        with open(os.path.join(HERE, name), 'w', encoding='utf-8') as f:
            f.write(fn())
        print('wrote', name)
