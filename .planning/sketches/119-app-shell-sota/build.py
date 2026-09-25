#!/usr/bin/env python3
"""Sketch 119 — the app shell, second round. Emits direction-d.html and direction-e.html.

Edit THIS file, not the HTML: the two files share the built header, the page
stand-ins, the tokens, the toast anatomy, the failure sheet, the loader ladder,
the offline strip and ladder, the 404, the palette, the bell and the
fit-to-width script, and they would drift apart if hand-edited.
Run:  python3 build.py
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
# Icons — lucide stand-ins, 24-box, stroke 1.75 (a build keeps lucide-react)
# ─────────────────────────────────────────────────────────────────────────────
def ico(name: str, size: int = 15) -> str:
    d = {
        'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
        'chev': '<path d="m6 9 6 6 6-6"/>',
        'chevr': '<path d="m9 6 6 6-6 6"/>',
        'menu': '<path d="M4 7h16M4 12h16M4 17h16"/>',
        'x': '<path d="M18 6 6 18M6 6l12 12"/>',
        'counter': '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',
        'rooms': '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M10 21v-6h4v6"/>',
        'ask': '<path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
        'more': '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
        'copy': '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        'wifi': '<path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><path d="M12 19h.01"/><path d="M3 3l18 18"/>',
        'floor': '<path d="M3 10h18"/><path d="M5 10v9h14v-9"/><path d="M8 4h8l3 6H5z"/>',
        'door': '<path d="M14 3v18"/><path d="M4 21h16"/><path d="M4 3h10v18"/><circle cx="11" cy="12" r="1"/>',
        'cellar': '<path d="M9 3h6v4l2 4v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l2-4z"/><path d="M9 13h6"/>',
        'books': '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
        'seal': '<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    }[name]
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>')


# ─────────────────────────────────────────────────────────────────────────────
# Houses — one US, one Turkish. Formats are what Intl prints for the locale.
# ─────────────────────────────────────────────────────────────────────────────
US = dict(
    key='us', name='Larkspur &amp; Vine', place='Oakland, CA', person='Maya Ferrante', initial='M',
    role='Owner', locale='en-US', currency='USD', date='Thu 17 Sep 2026', clock='14:02:11',
    now='14:02', unread='12', tz='America/Los_Angeles',
    hours=dict(prep='10:00', doors='17:00', close='23:00'),
    manager_word='a manager',
    orders=[
        dict(vendor='Kermit Lynch', lines='12 lines', total='$3,910.00', by='Mudavym', at='08:40',
             basis='AGREED', basis_txt='9 of 12 lines at the agreed price; 3 at last invoice'),
        dict(vendor='Southern Glazer&#8217;s', lines='6 lines', total='$1,284.50', by='Maya', at='11:02',
             basis='INVOICE', basis_txt='all 6 at last invoice price, 2026-09-03'),
        dict(vendor='Chambers &amp; Chambers', lines='4 lines', total='$642.18', by='Maya', at='12:15',
             basis='NO PRICE', basis_txt='1 line has no price on file &mdash; the total omits it'),
    ],
    verify=[
        dict(what='Invoice 4471 &middot; Southern Glazer&#8217;s', detail='$699.60 &middot; 3 lines, 2 matched, 1 short', at='11:32'),
        dict(what='Credit note &middot; Revel Wine', detail='$96.00 promised &middot; not recovered', at='09:50'),
    ],
    reply=[
        dict(who='Revel Wine', detail='asked which Sancerre vintage', at='09:14'),
        dict(who='Chambers &amp; Chambers', detail='confirmed Friday &middot; your draft reply is kept, not sent', at='13:10'),
    ],
    decide=[
        dict(what='Invitation &middot; Jon Park as staff', detail='sent 2026-09-15 &middot; not yet accepted', at='15 Sep'),
        dict(what='Identity &middot; &ldquo;Caymus Cab Sauv 1L&rdquo;', detail='candidate LWIN 1012345 &middot; 1 sighting waits on it', at='16 Sep'),
    ],
    proposed=[
        dict(what='Set the par for Chablis Vaillons to 6', detail='this house sold 11 in 14 days &middot; a proposal, not applied', at='13:41'),
    ],
    market_built=dict(what='Chablis Vaillons 2023', detail='12% under its 30-day mean &middot; Kermit Lynch quote, 2026-09-16', at='by 18:00',
                      figure='$27.40', mean='$31.10', move='&minus;12%', n='4 quotes', cls='class A &middot; quote', expires='18:00'),
    deliveries=[
        dict(t='11:32', who='Southern Glazer&#8217;s', state='arrived', txt='arrived 11:32 &middot; 6 lines &middot; invoice 4471 at the door', pos=None),
        dict(t='16:00', who='Kermit Lynch', state='expected', txt='expected by 16:00 &middot; 12 lines &middot; the vendor confirmed 2026-09-15', pos=None),
        dict(t='&mdash;', who='Revel Wine', state='unconfirmed', txt='sent 09:14 &middot; not received by the vendor &middot; no window', pos=None),
    ],
    events=[dict(t='15:00', txt='Kermit Lynch rep &middot; tasting', src='calendar/today')],
    shifts=[dict(t='16:00', txt='Daniel Reyes on the floor', src='team/week')],
    count=dict(t='22:30', txt='Weekly wine count due', src='calendar/today &middot; reminder'),
    kpi=[('4', 'Drafted &mdash; not sent'), ('3', 'Awaiting your seal'), ('2', 'Sent &mdash; no reply yet'),
         ('1', 'At the door today'), ('&mdash;', 'Received this week &mdash; no register read')],
    sentence='Three orders wait on your seal; Kermit Lynch&#8217;s is due at the door by four.',
    log=[
        ('DISMISSED', '14:02', 'Reorder Chablis Vaillons left the docket.', 'Recommendations 4 &rarr; 3 &middot; nothing else changed.'),
        ('WRITTEN HERE', '13:58', 'Count of 6 for Sancerre, Domaine Vacheron &mdash; kept on this device.', 'Not sent. It is not counted until the house answers.'),
        ('SEALED', '13:41', 'Order to Vineyard Brands sealed &mdash; seal 2b7e.', 'Sent by email 13:41:20 &middot; the vendor has not replied.'),
        ('DRAFT KEPT', '13:10', 'Reply to Chambers &amp; Chambers kept as a draft.', 'It has not gone. Open it to send.'),
    ],
    toasts=dict(
        dismissed=('Dismissed &middot; the house confirmed', '14:02', 'Reorder Chablis Vaillons left the docket.', 'Recommendations 4 &rarr; 3 &middot; nothing else changed.'),
        written=('Written here &middot; not on the house', '14:04', 'Count of 6 for Sancerre, Domaine Vacheron &mdash; kept on this device.', 'Not sent. It is not counted until the house answers.'),
        sealed=('Sealed &middot; receipt', '14:05', 'Order to Kermit Lynch sealed &mdash; seal 9d21.', 'Sent by email 14:05:12 &middot; the vendor has not yet replied.'),
        refused=('Refused by the house', '14:06', 'The shift could not be removed: Daniel is the only closer on Friday.', 'Nothing changed. Set another closer first, or ask a manager.'),
        draft=('Draft kept &middot; not sent', '14:07', 'Reply to Revel Wine kept as a draft.', 'It has not gone. Open it to send.'),
    ),
    outbox=[('Count &middot; Sancerre 6', '14:03:40'), ('Note on the Kermit Lynch order', '14:04:12'), ('Reply draft &middot; Revel Wine', '14:06:02')],
    doc=dict(title='Invoice 4471', vendor='Southern Glazer&#8217;s', total='$699.60', date='2026-09-17', lines=[
        ('Ridge Vineyards Three Valleys 2022 &middot; 12 &times; 750 ml', '6', '$27.40', '$164.40'),
        ('J. Lohr Riverstone Chardonnay 2023 &middot; 12 &times; 750 ml', '12', '$24.10', '$289.20'),
        ('Chateau Ste. Michelle Cabernet 2021 &middot; 6 &times; 750 ml', '6', '$41.00', '$246.00'),
    ]),
)
TR = dict(
    key='tr', name='Sim Meyhouse', place='Kadıköy, İstanbul', person='Ayşe Demir', initial='A',
    role='Staff', locale='tr-TR', currency='TRY', date='17.09.2026', clock='14:02:11',
    now='14:02', unread='3', tz='Europe/Istanbul',
    hours=dict(prep='15:00', doors='18:00', close='01:00'),
    manager_word='Kerem',
    orders=[
        dict(vendor='Kavaklıdere', lines='8 lines', total='₺12.480,00', by='Mudavym', at='09:10',
             basis='AGREED', basis_txt='8 of 8 lines at the agreed price'),
        dict(vendor='Doluca', lines='5 lines', total='₺3.150,00', by='Kerem', at='11:45',
             basis='INVOICE', basis_txt='all 5 at last invoice price, 10.09.2026'),
    ],
    verify=[],
    reply=[dict(who='Doluca', detail='asked which vintage of Öküzgözü', at='10:20')],
    decide=[],
    proposed=[],
    market_built=None,
    deliveries=[
        dict(t='12:10', who='Suvla', state='arrived', txt='arrived 12:10 &middot; 4 lines &middot; irsaliye at the door', pos=None),
        dict(t='15:30', who='Efes', state='expected', txt='expected by 15:30 &middot; 12 cases &middot; the vendor confirmed 16.09.2026', pos=None),
    ],
    events=[dict(t='17:30', txt='Rezervasyon &middot; 14 kişi, Yıldız ailesi', src='calendar/today')],
    shifts=[dict(t='18:00', txt='Ayşe Demir on the floor', src='team/my-week')],
    count=None,
    kpi=[('1', 'Expected today'), ('1', 'Arrived &mdash; at the door'), ('4', 'Lines to count'),
         ('&mdash;', 'Claims promised &mdash; refused for your role'), ('&mdash;', 'Credits recovered')],
    sentence='One delivery is expected before half past three; nothing else is due at the door.',
    log=[
        ('WRITTEN HERE', '13:52', '12 kasa Efes Pilsen sayıldı &mdash; bu cihazda tutuldu.', 'Gönderilmedi. Ev cevap verene kadar sayılmaz.'),
        ('DISMISSED', '13:30', 'Suvla teslimatı hatırlatması kapatıldı.', 'Nothing else changed.'),
    ],
    toasts=dict(
        dismissed=('Dismissed &middot; the house confirmed', '14:02', 'Suvla delivery reminder left the docket.', 'Notifications 3 &rarr; 2 &middot; nothing else changed.'),
        written=('Written here &middot; not on the house', '14:04', '12 cases of Efes Pilsen counted &mdash; kept on this device.', 'Not sent. It is not counted until the house answers.'),
        sealed=('Sealed &middot; receipt', '14:05', 'Suvla delivery received &mdash; seal 91c2.', 'Received at the door 14:05:12 &middot; the invoice cost is not yet verified.'),
        refused=('Refused by the house', '14:06', 'The order to Kavaklıdere could not be sealed by you.', 'Nothing changed. It waits on Kerem&#8217;s seal.'),
        draft=('Draft kept &middot; not sent', '14:07', 'Reply to Doluca kept as a draft.', 'It has not gone. Kerem can send it.'),
    ),
    outbox=[('Count &middot; Efes Pilsen 12 kasa', '14:03:40'), ('Note on the Suvla delivery', '14:04:12')],
    doc=None,
)

ROOMS = [
    ('The floor', [('Dashboard', '/'), ('Notifications', '/notifications'), ('Calendar', '/calendar'), ('Recommendations', '/recommendations')]),
    ('The door', [('Orders', '/orders'), ('Receiving', '/receiving'), ('Providers', '/providers'), ('Promotions', '/promotions'), ('Vendor prices', '/vendor-prices')]),
    ('The cellar', [('Inventory', '/inventory'), ('Cellar', '/cellar')]),
    ('The books', [('Receipts &amp; Credits', '/receipts'), ('Documents &amp; Reports', '/documents-reports'), ('Reports', '/reports'), ('Logs', '/logs')]),
    ('The people', [('Team', '/team'), ('Communications', '/communications')]),
]
CELLAR = ['Wines', 'Beer', 'Whiskey', 'Cocktails', 'Spirits', 'Non-alcoholic']
FOOT = [('Settings', '/settings', None), ('Connections', '/connections', 'manager'), ('The desk', '/admin', 'owner'), ('Help', '/help', None)]

# ─────────────────────────────────────────────────────────────────────────────
# Shared CSS
# ─────────────────────────────────────────────────────────────────────────────
COMMON_CSS = r"""
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#f3efe6;color:#211c16;font-family:'DM Sans','Plus Jakarta Sans',system-ui,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.sk-band{padding:34px 40px 8px;max-width:1360px}
.sk-band h1{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:26px;letter-spacing:-.01em;margin:0 0 6px;color:#211c16}
.sk-band h2{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:19px;letter-spacing:-.01em;margin:0}
.sk-sub{font-size:13.5px;color:#4f473c;max-width:880px;margin:6px 0 0}
.sk-label{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#665d50;padding:26px 40px 8px}
.sk-label small{display:block;text-transform:none;letter-spacing:0;font-family:'DM Sans',system-ui,sans-serif;font-size:12.5px;color:#4f473c;margin-top:3px;max-width:1000px}
.sk-note{margin:10px 40px 0;font-size:12.5px;color:#4f473c;max-width:900px}
.sk-row{display:flex;flex-wrap:wrap;gap:24px;padding:0 40px;align-items:flex-start}
.fit{margin:0 auto}
.fitwrap{padding:0 12px}
@media (max-width:560px){.sk-band,.sk-label,.sk-note{padding-left:14px;padding-right:14px}.sk-row{padding:0 12px;gap:14px}}
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
.mudavym[data-ground="paper"] .toast__eyebrow,.mudavym[data-ground="paper"] .toast__sub,.mudavym[data-ground="paper"] .kbd,
.mudavym[data-ground="paper"] .sect,.mudavym[data-ground="paper"] .quiet,.mudavym[data-ground="paper"] .act__at,
.mudavym[data-ground="paper"] .act__detail,.mudavym[data-ground="paper"] .counter__read,.mudavym[data-ground="paper"] .dl__lbl,
.mudavym[data-ground="paper"] .dl__read,.mudavym[data-ground="paper"] .pg__eyebrow,.mudavym[data-ground="paper"] .rail__foot .quiet,
.mudavym[data-ground="paper"] .said__sub,.mudavym[data-ground="paper"] .row__sub,.mudavym[data-ground="paper"] .row__at,.mudavym[data-ground="paper"] .tbl th,
.mudavym[data-ground="paper"] .tbl .basis,.mudavym[data-ground="paper"] .kpi__l,.mudavym[data-ground="paper"] .pop__eyebrow,.mudavym[data-ground="paper"] .regline,
.mudavym[data-ground="paper"] .dl__tick .w b,.mudavym[data-ground="paper"] .hdr__search,.mudavym[data-ground="paper"] .item__ic,.mudavym[data-ground="paper"] .room--sub,
.mudavym[data-ground="paper"] .sheet__close,.mudavym[data-ground="paper"] .nf .addr,.mudavym[data-ground="paper"] .ladder__mono,.mudavym[data-ground="paper"] .fail dt,
.mudavym[data-ground="paper"] .strip span,.mudavym[data-ground="paper"] .cstrip span,.mudavym[data-ground="paper"] .cstrip button,.mudavym[data-ground="paper"] .chip--quiet,
.mudavym[data-ground="paper"] .act--dash .act__what,.mudavym[data-ground="paper"] .tab,.mudavym[data-ground="paper"] .offstrip .mono,.mudavym[data-ground="paper"] .offstrip svg{color:var(--ink-4)}
/* every selector coloured --ink-3 above is remapped here; the frame-10 band is re-measured for #7c7365 after each render, not asserted */

/* ── frames ── */
.frame{position:relative;width:1440px;min-height:880px;overflow:hidden;border:1px solid #b6ad9e;box-shadow:0 1px 0 rgba(0,0,0,.04);display:flex;flex-direction:column}
.frame--short{min-height:560px}
.frame--tall{min-height:1080px}
.frame--fixed{height:900px;min-height:0}
.frame--fixed-short{height:620px;min-height:0}
.phone{position:relative;width:390px;height:844px;overflow:hidden;border:1px solid #b6ad9e;flex:none;display:flex;flex-direction:column}
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
.btn--sm{padding:5px 10px;font-size:12px}
.rule{height:1px;background:var(--paper-2)}
.quiet{color:var(--ink-3);font-size:12.5px;line-height:1.55}
.em{color:var(--ink-4)}
.ring{display:inline-block;width:9px;height:9px;border-radius:999px;border:1.5px dashed var(--ink-4);vertical-align:middle}
.dot{display:inline-block;width:6px;height:6px;border-radius:999px;background:var(--seal);vertical-align:middle}
.hair{display:inline-block;width:12px;height:1.5px;background:var(--ink-4);vertical-align:middle}
.wax{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:var(--seal);color:var(--paper-0);flex:none}
.wax svg{width:11px;height:11px}
.chip{display:inline-block;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border-radius:4px;border:1px solid var(--seal-ring);color:var(--seal-deep);white-space:nowrap}
.chip--quiet{border-color:var(--paper-2);color:var(--ink-3)}
.chip--dash{border-style:dashed;color:var(--ink-4)}
.chip--warn{border-color:#a8743a;color:#d9a35e}

/* ── the house header, as built (components/mudavym/house-header.css) — ThemeMenu removed, ADR 0149 row 6 ── */
.hdr{position:relative;z-index:30;background:color-mix(in srgb,var(--paper-0) 88%,transparent);border-bottom:1px solid var(--paper-2);flex:none}
.hdr__in{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 24px}
.hdr__left{display:flex;align-items:center;gap:10px;min-width:0}
.hdr__mark{display:inline-flex;align-items:center;color:var(--seal);border-radius:6px;padding:2px}
.hdr__rule{width:1px;height:18px;background:var(--paper-2);flex:none}
.hdr__page{font-family:var(--serif);font-weight:600;font-size:15px;letter-spacing:-.01em;color:var(--ink-1);white-space:nowrap}
.hdr__pagebtn{display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 4px;margin-left:-4px;border:1px solid transparent;border-radius:8px;background:transparent;cursor:pointer;color:var(--ink-1)}
.hdr__pagebtn:hover{border-color:var(--paper-2);background:var(--paper-1)}
.hdr__pagebtn[aria-expanded="true"]{border-color:var(--paper-2);background:var(--paper-1)}
.hdr__pagebtn .hdr__chev{color:var(--ink-4)}
.hdr__search{display:inline-flex;align-items:center;gap:8px;margin:0 auto;padding:6px 10px 6px 11px;border:1px solid var(--paper-2);border-radius:9px;background:var(--paper-1);color:var(--ink-3);font-size:12.5px;cursor:pointer}
.hdr__search svg{flex:none}
.hdr__right{display:flex;align-items:center;gap:6px;margin-left:auto}
.hdr__house{font-size:12.5px;font-weight:500;color:var(--ink-2);padding:0 8px 0 2px;white-space:nowrap}
.hdr__btn{display:inline-flex;align-items:center;gap:7px;position:relative;padding:7px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--ink-2);cursor:pointer}
.hdr__btn[aria-expanded="true"]{background:var(--paper-1);border-color:var(--paper-2)}
.hdr__btn--user{padding:5px 8px 5px 5px}
.hdr__avatar{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:var(--seal-tint);color:var(--seal);font-size:11.5px;font-weight:700;flex:none}
.hdr__who{font-size:12.5px;font-weight:500;color:var(--ink-1);white-space:nowrap}
.hdr__chev{color:var(--ink-4);flex:none}
.hdr__badge{position:absolute;top:1px;right:0;min-width:15px;height:15px;padding:0 3px;border-radius:999px;background:var(--seal);color:var(--paper-0);font-size:9.5px;font-weight:700;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}
.hdr__badge--unknown{min-width:9px;width:9px;height:9px;padding:0;top:4px;right:4px;background:transparent;border:1.5px dashed var(--ink-4)}
.hdr__dot{position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:999px;background:var(--seal)}
.hdr__menu{display:none;width:36px;height:36px;align-items:center;justify-content:center;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--ink-2);flex:none;position:relative}
.narrow .hdr__in{padding:0 10px;gap:8px;min-height:50px}
.narrow .hdr__menu{display:inline-flex}
.narrow .hdr__searchtext,.narrow .hdr__chord,.narrow .hdr__house,.narrow .hdr__who,.narrow .hdr__chev{display:none}
.narrow .hdr__search{margin:0 0 0 auto;padding:7px}
/* the loading hairline — a stated exception to the seven tokens (1.4s ambient loop, pauses under reduced motion) */
.loadbar{position:absolute;left:0;right:0;bottom:-1px;height:2px;overflow:hidden}
.loadbar::after{content:'';position:absolute;top:0;bottom:0;width:28%;background:var(--seal);animation:loadbar 1.4s cubic-bezier(.45,0,.55,1) infinite}
@keyframes loadbar{from{left:-30%}to{left:100%}}

/* ── the body under the header ── */
.body{display:flex;flex:1;min-height:0;align-items:stretch}
.pg{flex:1;min-width:0;position:relative}
.pg__in{max-width:1180px;margin:0 auto;padding:28px 36px 40px}
.pg__eyebrow{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-top:8px}
.pg__sentence{font-family:var(--serif);font-weight:600;font-size:30px;line-height:1.15;letter-spacing:-.015em;margin:8px 0 0;max-width:20ch}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);margin-top:26px;border-top:1px solid var(--paper-2)}
.kpi{padding:18px 16px 18px 0;border-right:1px solid var(--paper-2);margin-right:16px}
.kpi:last-child{border-right:0}
.kpi__n{font-family:var(--mono);font-size:26px;font-weight:500;color:var(--ink-1);font-variant-numeric:tabular-nums}
.kpi__l{font-size:12px;color:var(--ink-3);margin-top:6px;line-height:1.4}
.tbl{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}
.tbl th{text-align:left;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);padding:12px 12px 10px 0;border-bottom:1px solid var(--paper-2)}
.tbl td{padding:15px 12px 15px 0;white-space:nowrap;border-bottom:1px solid var(--paper-2);vertical-align:middle;color:var(--ink-2)}
.tbl td:first-child{color:var(--ink-1)}
.tbl td.num{font-family:var(--mono);color:var(--ink-1);text-align:right;padding-right:28px;font-variant-numeric:tabular-nums}
.tbl tr.cur td{background:var(--paper-1)}
.tbl .basis{font-size:12px;color:var(--ink-3);white-space:normal}
.tbl td.wrap{white-space:normal}
.pg__foot{display:flex;justify-content:space-between;gap:16px;margin-top:28px;font-size:11.5px;color:var(--ink-4)}

/* skeleton — the dashboard's own .dn-skel sheen (1.9s), pauses under reduced motion */
.skel{position:relative;overflow:hidden;background:var(--paper-2);border-radius:3px}
.skel::after{content:'';position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,var(--paper-1),transparent);animation:sheen 1.9s cubic-bezier(.45,0,.55,1) infinite}
@keyframes sheen{to{transform:translateX(100%)}}

/* ── the toast: eyebrow · one sentence · what is not claimed · Undo/Open · a drain ── */
.toast{width:320px;padding:11px 14px 12px;border:1px solid var(--paper-2);border-radius:10px;background:var(--paper-1);position:relative;overflow:hidden;box-shadow:0 8px 24px -14px rgba(0,0,0,.6)}
.toast--written{border-style:dashed}
.toast--refused{border-color:#5a4a2a}
.toast__eyebrow{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.toast__eyebrow b{color:var(--seal-deep);font-weight:600}
.toast--refused .toast__eyebrow b{color:#d9a35e}
.toast__eyebrow .at{margin-left:auto;font-weight:500;letter-spacing:.04em;text-transform:none;color:var(--ink-4)}
.toast__txt{font-size:13px;color:var(--ink-1);margin-top:5px;line-height:1.4}
.toast__sub{font-size:11.5px;color:var(--ink-3);margin-top:3px;line-height:1.4}
.toast__acts{display:flex;align-items:center;gap:10px;margin-top:8px}
.toast__drain{position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--seal);transform-origin:left;animation:drain 8s linear forwards}
.toast:hover .toast__drain,.toast:focus-within .toast__drain{animation-play-state:paused}
@keyframes drain{to{transform:scaleX(0)}}
.toast__wax{width:14px;height:14px;margin-right:2px}
.toast__wax svg{width:9px;height:9px}
.toaststack{position:absolute;display:flex;flex-direction:column;gap:8px;z-index:40}

/* ── overlays: the three shapes (ADR 0112) drawn inside the frame ── */
.scrim{position:absolute;inset:0;background:rgba(21,19,15,.55);z-index:45}
.sheet{position:absolute;top:0;right:0;bottom:0;width:440px;background:var(--paper-0);border-left:1px solid var(--paper-2);z-index:50;display:flex;flex-direction:column;box-shadow:-20px 0 40px -30px rgba(0,0,0,.8)}
.sheet__head{padding:18px 22px 14px;border-bottom:1px solid var(--paper-2);display:flex;align-items:flex-start;gap:12px}
.sheet__title{font-family:var(--serif);font-weight:600;font-size:20px;letter-spacing:-.01em;margin:3px 0 0}
.sheet__close{margin-left:auto;color:var(--ink-3);background:none;border:0;padding:4px;cursor:pointer}
.sheet__body{padding:16px 22px;overflow:auto;flex:1}
.sheet__foot{padding:14px 22px 18px;border-top:1px solid var(--paper-2)}
.panel{position:absolute;left:50%;top:96px;transform:translateX(-50%);width:620px;background:var(--paper-0);border:1px solid var(--paper-2);border-radius:14px;z-index:50;box-shadow:0 30px 60px -30px rgba(0,0,0,.8);overflow:hidden}
.pop{position:absolute;width:320px;background:var(--paper-0);border:1px solid var(--paper-2);border-radius:12px;z-index:60;box-shadow:0 18px 40px -22px rgba(0,0,0,.8);padding:12px 14px 12px}
.pop--wide{width:350px}
.pop__eyebrow{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.pop__title{font-family:var(--serif);font-weight:600;font-size:15px;margin:3px 0 8px;letter-spacing:-.01em}
.pop__foot{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--paper-2);margin-top:10px;padding-top:9px;font-size:11.5px;color:var(--ink-4)}
.item{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;font-size:13px;color:var(--ink-1);cursor:pointer;margin:0 -8px}
.item:hover,.item.cur{background:var(--paper-1)}
.item .kbd{margin-left:auto}
.item__meta{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-4);white-space:nowrap;display:inline-flex;align-items:center;gap:5px;padding-left:10px}
.item__ic{color:var(--ink-3);flex:none;width:16px;display:inline-flex;justify-content:center}
.ruled{border-top:1px solid var(--paper-2);margin-top:6px;padding-top:8px}

/* rows: a note or a record line */
.row{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--paper-2);font-size:12.5px}
.row:last-child{border-bottom:0}
.row__txt{flex:1;min-width:0;color:var(--ink-1);line-height:1.4}
.row__sub{color:var(--ink-3);font-size:11.5px;margin-top:2px}
.row__at{font-family:var(--mono);font-size:10px;color:var(--ink-4);white-space:nowrap;text-align:right;line-height:1.35}
.row__at b{display:block;color:var(--ink-1);font-weight:500}
.row__ptr{display:block;font-family:var(--sans);font-size:10.5px;font-weight:500;color:var(--seal-deep);margin-top:2px;letter-spacing:0}

/* the hold-to-approve fill: pour, 620ms linear (the operator times it) */
.hold{position:relative;height:44px;border:1px solid var(--seal);border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:var(--ink-1);background:var(--paper-1)}
.hold__fill{position:absolute;left:0;top:0;bottom:0;width:62%;background:var(--seal-tint);border-right:1px solid var(--seal)}
.hold span{position:relative}

/* the loader ladder */
.ladder{max-width:1180px;margin:0 auto;padding:28px 36px}
.ladder__mono{font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:18px}
.ladder__12{margin-top:26px;max-width:560px}
.ladder__12 p{font-family:var(--serif);font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0 0 10px;line-height:1.3}

/* the offline strip under the header */
.offstrip{display:flex;align-items:center;gap:14px;padding:8px 24px;background:var(--paper-1);border-bottom:1px solid var(--paper-2);font-size:12px;color:var(--ink-2);flex:none}
.offstrip .mono{color:var(--ink-3);font-size:11px}
.offstrip .link{margin-left:auto}
.offstrip svg{color:var(--ink-3);flex:none}

/* the failure sheet, under the shell */
.fail{max-width:640px;margin:48px auto;padding:0 36px}
.fail h2{font-family:var(--serif);font-weight:600;font-size:26px;letter-spacing:-.015em;margin:0 0 8px}
.fail p{color:var(--ink-2);margin:0 0 14px;font-size:13.5px}
.fail dl{display:grid;grid-template-columns:110px 1fr;gap:6px 14px;font-size:12px;margin:0 0 16px;padding:12px 14px;border:1px solid var(--paper-2);border-radius:10px;background:var(--paper-1)}
.fail dt{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);padding-top:2px}
.fail dd{margin:0;font-family:var(--mono);font-size:12px;color:var(--ink-1)}
.fail__acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center}

/* the 404 */
.nf{max-width:760px;margin:44px auto;padding:0 36px}
.nf h2{font-family:var(--serif);font-weight:600;font-size:28px;letter-spacing:-.015em;margin:0 0 6px}
.nf .addr{font-family:var(--mono);font-size:12px;color:var(--ink-3);margin-bottom:14px}
.nf .near{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--seal-ring);border-radius:10px;background:var(--seal-tint);margin-bottom:22px;font-size:13px}
.nf__rooms{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 28px;font-size:12.5px}
.nf__rooms .sect{margin-bottom:6px}
.nf__rooms a{display:block;color:var(--ink-2);text-decoration:none;padding:2px 0}
.nf__rooms a:hover{color:var(--seal-deep)}

.said{padding:8px 0;border-bottom:1px solid var(--paper-2);font-size:12px}
.said:last-child{border-bottom:0}
.said__eb{display:flex;gap:8px;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--seal-deep)}
.said__eb .at{margin-left:auto;font-weight:500;letter-spacing:.02em;color:var(--ink-4)}
.said__eb.w{color:var(--ink-4)}
.said__txt{color:var(--ink-1);margin-top:3px;line-height:1.35}
.said__sub{color:var(--ink-3);font-size:11px;margin-top:2px}
/* phones */
.tabbar{position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;align-items:stretch;background:color-mix(in srgb,var(--paper-0) 92%,transparent);backdrop-filter:blur(10px);border-top:1px solid var(--paper-2);z-index:30;padding-bottom:6px}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:10px;color:var(--ink-3);position:relative;background:none;border:0;font-family:var(--sans)}
.tab.cur{color:var(--seal)}
.tab .dot{position:absolute;top:10px;right:calc(50% - 14px)}
.bsheet{position:absolute;left:0;right:0;bottom:0;background:var(--paper-0);border-top:1px solid var(--paper-2);border-radius:16px 16px 0 0;z-index:50;padding:8px 16px 18px;box-shadow:0 -20px 40px -30px rgba(0,0,0,.9)}
.bsheet__grip{width:36px;height:4px;border-radius:999px;background:var(--paper-2);margin:0 auto 10px}
.lsheet{position:absolute;left:0;top:0;bottom:0;width:300px;background:var(--paper-0);border-right:1px solid var(--paper-2);z-index:50;overflow:auto}
/* the envelope boxes drawn beside a frame (both directions) — shared, so E's are pre-formatted too */
.mkt{font-family:var(--mono);font-size:10px;line-height:1.55;color:var(--ink-2);background:var(--paper-1);border:1px solid var(--paper-2);border-radius:8px;padding:10px 12px;white-space:pre;overflow:auto}
.mkt .k{color:var(--seal-deep)}
.mkt .s{color:var(--ink-4)}
"""

# ─────────────────────────────────────────────────────────────────────────────
# Direction D — the counter
# ─────────────────────────────────────────────────────────────────────────────
D_CSS = r"""
/* the rooms rail — words only, grouped by where the work happens (sketch 106 A's grammar) */
.rail{width:232px;flex:none;border-right:1px solid var(--paper-2);display:flex;flex-direction:column;padding:14px 12px 12px}
.rail__ask{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--paper-2);border-radius:9px;background:var(--paper-1);font-size:12.5px;color:var(--ink-2);cursor:pointer;margin-bottom:14px}
.rail__ask .wm{font-size:13px}
.rail__ask .kbd{margin-left:auto}
.rail .sect{padding:12px 10px 5px}
.room{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;font-size:13px;color:var(--ink-2);text-decoration:none;cursor:pointer}
.room:hover{background:var(--paper-1);color:var(--ink-1)}
.room.cur{background:var(--paper-1);color:var(--ink-1);box-shadow:inset 2px 0 0 var(--seal)}
.room .kbd{margin-left:auto}
.room--sub{padding-left:24px;font-size:12.5px;color:var(--ink-3)}
.rail__foot{margin-top:auto;padding-top:10px;border-top:1px solid var(--paper-2)}
.rail__tuck{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:11.5px;color:var(--ink-4);cursor:pointer}
.rail__tuck .kbd{margin-left:auto}
.strip{width:28px;flex:none;border-right:1px solid var(--paper-2);display:flex;align-items:flex-start;justify-content:center;padding-top:14px}
.strip span{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}

/* the counter — a shell region, not an overlay: it stays across pages */
.counter{width:320px;flex:none;border-left:1px solid var(--paper-2);display:flex;flex-direction:column;background:var(--paper-0);position:relative}
.counter__head{display:flex;align-items:baseline;gap:8px;padding:16px 16px 6px;flex-wrap:wrap}
.counter__head .sect{padding:0;flex:none}
.counter__read{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--ink-4);white-space:normal;text-align:right;max-width:100%}
.counter__body{padding:0 16px;overflow:hidden;flex:1}
.counter__sec{padding:10px 0 6px}
.counter__sec + .counter__sec{border-top:1px solid var(--paper-2)}
.counter__sec .sect{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.counter__sec .sect .n{margin-left:auto;font-weight:500;letter-spacing:.02em;color:var(--ink-4);text-transform:none}
.act{display:flex;gap:10px;align-items:flex-start;padding:8px 8px;margin:0 -8px;border-radius:8px;cursor:pointer}
.act:hover,.act.cur{background:var(--paper-1)}
.act.cur{box-shadow:inset 2px 0 0 var(--seal)}
.act__verb{flex:none;width:58px;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--seal-deep);padding-top:3px}
.act__verb.quiet{color:var(--ink-4)}
.act__verb.warn{color:#d9a35e}
.act__main{flex:1;min-width:0}
.act__what{font-size:12.5px;color:var(--ink-1);line-height:1.35}
.act__detail{font-size:11px;color:var(--ink-3);margin-top:2px;line-height:1.4}
.act__at{font-family:var(--mono);font-size:10px;color:var(--ink-4);white-space:nowrap;padding-top:3px}
.act--dash .act__what{color:var(--ink-3)}
.act--dash{border:1px dashed var(--paper-2);margin:4px -8px}
.regline{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink-3);padding:6px 0}
.regline .mono{font-size:10px;color:var(--ink-4);margin-left:auto}
.regline .link{font-size:11.5px}
.counter__said{border-top:1px solid var(--paper-2);padding:10px 16px 6px}
.counter__said .sect{display:flex;align-items:center}
.counter__said .sect .n{margin-left:auto;color:var(--ink-4);text-transform:none;letter-spacing:.02em}
.counter__foot{padding:10px 16px 14px;border-top:1px solid var(--paper-2);font-family:var(--mono);font-size:10px;color:var(--ink-4);display:flex;gap:10px;align-items:center}
.counter__foot .link{margin-left:auto;font-family:var(--sans)}
.counter__toast{padding:12px 12px 0}
.counter__toast .toast{width:100%}
.cstrip{width:36px;flex:none;border-left:1px solid var(--paper-2);display:flex;flex-direction:column;align-items:center;padding-top:14px;gap:12px}
.cstrip button{background:none;border:0;color:var(--ink-3);position:relative;padding:6px;cursor:pointer}
.cstrip span{writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.cstrip .dot{position:absolute;top:4px;right:4px}
.counter--off .act__at,.counter--off .act__verb{color:var(--ink-4)}
.counter--off .act{border:1px dashed transparent}
"""

# ─────────────────────────────────────────────────────────────────────────────
# Direction E — the day
# ─────────────────────────────────────────────────────────────────────────────
E_CSS = r"""
/* the day line — line two of the header: the house's service arc, today, with its fixed points */
.dl{display:flex;align-items:center;gap:18px;padding:8px 24px 6px;min-height:58px;border-bottom:1px solid var(--paper-2);background:var(--paper-0);flex:none;position:relative}
.dl__today{flex:none;width:118px}
.dl__today .sect{color:var(--ink-4)}
.dl__today b{display:block;font-family:var(--serif);font-weight:600;font-size:14px;letter-spacing:-.01em;margin-top:1px}
.dl__track{flex:1;position:relative;min-width:0}
.dl__line{position:absolute;left:0;right:0;top:18px;height:1px;background:var(--paper-2)}
.dl__band{position:absolute;top:18px;height:1px;background:var(--ink-3)}
.dl__band--service{background:var(--seal-ring);height:2px;top:17.5px}
.dl__lbl{position:absolute;top:0;font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4);white-space:nowrap;transform:translateX(-50%)}
.dl__lbl.short{font-size:8px}
.dl__lbl.l{transform:none}
.dl__lbl.r{transform:translateX(-100%)}
.dl__tick{position:absolute;top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;cursor:pointer}
.dl__tick .m{width:8px;height:8px;border-radius:999px;border:1.5px solid var(--ink-2);background:var(--paper-0);margin-top:14.5px}
.dl__tick.arrived .m{border-color:var(--ink-3);background:var(--ink-3);box-shadow:0 0 0 2px var(--paper-0),0 0 0 3px var(--ink-3)}
.dl__tick.expected .m{border-color:var(--seal);background:var(--paper-0)}
.dl__tick.dash .m{border-style:dashed;border-color:var(--ink-4)}
.dl__tick.said .m{width:5px;height:5px;border:0;background:var(--ink-4);margin-top:16px}
.dl__tick .w,.dl__now .w{position:absolute;font-size:10.5px;color:var(--ink-2);white-space:nowrap;line-height:12px}
.dl__tick .w.l,.dl__now .w.l{left:-4px}
.dl__tick .w.r,.dl__now .w.r{right:-4px}
.dl__tick .w.c,.dl__now .w.c{left:50%;transform:translateX(-50%)}
.dl__tick .w::first-letter{}
.dl__tick .w{font-family:var(--sans)}
.dl__tick .w b{font-family:var(--mono);font-weight:500;font-size:9.5px;color:var(--ink-3)}
.dl__tick.expected .w{color:var(--ink-1)}
.dl__tick:hover .w,.dl__tick.cur .w{color:var(--seal-deep)}
.dl__now{position:absolute;top:0;bottom:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center}
.dl__now .m{width:10px;height:10px;border-radius:999px;background:var(--seal);margin-top:13.5px;box-shadow:0 0 0 3px var(--seal-tint)}
.dl__now .w{font-family:var(--mono);font-size:9.5px;font-weight:600;color:var(--seal-deep)}
.dl__now.hollow .m{background:transparent;border:1.5px dashed var(--seal);box-shadow:none}
.dl__gap{position:absolute;top:14px;height:9px;background:repeating-linear-gradient(135deg,transparent 0 3px,var(--ink-4) 3px 4px);opacity:.7}
.dl__right{flex:none;display:flex;align-items:center;gap:12px;margin-left:8px}
.dl__read{font-family:var(--mono);font-size:10px;color:var(--ink-4);white-space:nowrap;text-align:right;line-height:1.35}
.dl__log{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--paper-2);border-radius:8px;background:transparent;font-family:var(--mono);font-size:10.5px;color:var(--ink-2);cursor:pointer}
.dl__ask{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border:1px solid var(--paper-2);border-radius:9px;background:var(--paper-1);font-size:12.5px;color:var(--ink-2);cursor:pointer}
.dl__ask .wm{font-size:13px}
/* the moment: in flow under the line, never over the page — the line grows by a row for 8 s (settle 320) and the page moves down with it */
.dl--moment{border-bottom:0}
.dl__momentrow{position:relative;padding:0 0 10px;border-bottom:1px solid var(--paper-2);background:var(--paper-0);flex:none}
.dl__moment{position:relative;z-index:1;width:340px;margin-top:6px}
.dl__moment::before{content:'';position:absolute;left:14px;top:-6px;width:1px;height:6px;background:var(--seal)}
.dl__moment .toast{width:340px}
/* hours not set: the sentence sits where the bands' words would; the fixed points still draw on the bandless rule */
.dl__lbl--unset{font-family:var(--sans);font-size:10.5px;letter-spacing:0;text-transform:none;color:var(--ink-3);display:inline-flex;align-items:center;gap:8px;top:-1px}
.dl__lbl--unset .link{font-size:10.5px}
/* the rooms menu — the page's name is the trigger (supersedes .mdv-hdr__page's plain span) */
.rooms{width:560px;padding:12px 14px 10px}
.rooms__grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px}
.rooms .sect{margin-bottom:4px}
.rooms .item{padding:5px 8px;font-size:12.5px}
.rooms__foot{display:flex;align-items:center;gap:14px;border-top:1px solid var(--paper-2);margin-top:12px;padding-top:10px;font-size:12px}
.rooms__foot .item{padding:4px 8px;margin:0}
.rooms__foot .kbd{margin-left:6px}
.phone .dl__tick .w{max-width:76px;overflow:hidden;text-overflow:ellipsis}
.phone .dl__now .w{max-width:none}
.phone .dl__tick .w b{font-size:9px}
"""

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
})();
</script>
"""


def doc(title: str, css: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>{COMMON_CSS}{css}
@media (prefers-reduced-motion:reduce){{*,*::before,*::after{{animation:none!important;transition:none!important}}}}
</style>
</head>
<body>
{body}
{FIT_JS}</body>
</html>
"""


def fitframe(inner: str, w: int = 1440) -> str:
    return f'<div class="fitwrap"><div class="fit" data-fit="{w}">{inner}</div></div>'


def label(n: str, small: str = '') -> str:
    s = f'<small>{small}</small>' if small else ''
    return f'<div class="sk-label">{n}{s}</div>'


# ─────────────────────────────────────────────────────────────────────────────
# The header (built HouseHeader, ported) — one function, two small variants
# ─────────────────────────────────────────────────────────────────────────────
def header(h: dict, page: str, *, badge='n', narrow=False, loading=False,
           menu=False, rooms_trigger=False, rooms_open=False, counter_btn=False,
           counter_dot=True, counter_open=False, bell_open=False, user_open=False,
           offline=False) -> str:
    if badge == 'n':
        b = f'<span class="hdr__badge">{h["unread"]}</span>'
    elif badge == 'hollow':
        b = '<span class="hdr__badge hdr__badge--unknown" aria-hidden="true"></span>'
    else:
        b = ''
    if rooms_trigger:
        name = (f'<button class="hdr__pagebtn" aria-haspopup="dialog" aria-expanded="{"true" if rooms_open else "false"}" '
                f'aria-label="{page} — open the rooms"><span class="hdr__page">{page}</span>{ico("chev", 13)}</button>')
    else:
        name = f'<span class="hdr__page">{page}</span>'
    menu_btn = (f'<button class="hdr__menu" aria-label="Open the rooms">{ico("menu", 18)}</button>' if menu else '')
    counter = ''
    if counter_btn:
        dot = '<span class="hdr__dot"></span>' if counter_dot else ''
        counter = (f'<button class="hdr__btn" aria-label="The counter" aria-expanded="{"true" if counter_open else "false"}">'
                   f'{ico("counter", 17)}{dot}</button>')
    load = '<div class="loadbar" aria-hidden="true"></div>' if loading else ''
    return f"""
<header class="hdr" role="banner" aria-label="House header">
  <div class="hdr__in">
    {menu_btn}
    <div class="hdr__left">
      <a class="hdr__mark" href="#" aria-label="Mudavym — dashboard">{mark(24)}</a>
      <span class="hdr__rule" aria-hidden="true"></span>
      {name}
    </div>
    <button class="hdr__search" aria-label="Search or act — open the command palette">{ico('search', 15)}<span class="hdr__searchtext">Search or act</span><kbd class="kbd hdr__chord">&#8984;K</kbd></button>
    <div class="hdr__right">
      <span class="hdr__house">{h['name']}</span>
      <button class="hdr__btn" aria-label="Notifications" aria-expanded="{'true' if bell_open else 'false'}">{ico('bell', 17)}{b}</button>
      {counter}
      <button class="hdr__btn hdr__btn--user" aria-label="Account menu" aria-expanded="{'true' if user_open else 'false'}"><span class="hdr__avatar">{h['initial']}</span><span class="hdr__who">{h['person']}</span>{ico('chev', 14)}</button>
    </div>
  </div>
  {load}
</header>"""


def offstrip(h: dict, n: int, region: str = 'the counter') -> str:
    return f"""
<div class="offstrip" role="status">
  {ico('wifi', 15)}
  <span>Offline since <span class="mono">14:02:11</span> &middot; <b>{n} records written here, none sent</b></span>
  <span class="mono">{region} and the bell are from 14:01:48, the house&#8217;s last answer</span>
  <button class="link">What is written here</button>
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# Page stand-ins — the rebuilt pages' own grammar; labelled, not part of the sketch
# ─────────────────────────────────────────────────────────────────────────────
def page_orders(h: dict) -> str:
    rows = ''
    for i, o in enumerate(h['orders']):
        cur = ' class="cur"' if i == 0 else ''
        chipcls = 'chip' if o['basis'] == 'AGREED' else ('chip chip--dash' if o['basis'] == 'NO PRICE' else 'chip chip--quiet')
        rows += (f'<tr{cur}><td>{o["vendor"]}</td><td>{o["lines"]}</td><td class="num">{o["total"]}</td>'
                 f'<td>Awaiting seal</td><td class="wrap"><span class="{chipcls}">{o["basis"]}</span> <span class="basis">{o["basis_txt"]}</span></td></tr>')
    if h['key'] == 'us':
        rows += ('<tr><td>Revel Wine</td><td>8 lines</td><td class="num">$2,105.00</td><td class="wrap">Sent 09:14 &mdash; not received by the vendor</td>'
                 '<td class="wrap"><span class="chip chip--quiet">QUOTE</span> <span class="basis">the rep&#8217;s message of 2026-09-11</span></td></tr>'
                 '<tr><td>Kermit Lynch</td><td>12 lines</td><td class="num">$3,880.00</td><td class="wrap">At the door &mdash; expected before 16:00</td>'
                 '<td class="wrap"><span class="chip">SEALED</span> <span class="basis">seal 7f3a, 2026-09-15</span></td></tr>')
    kp = ''.join(f'<div class="kpi"><div class="kpi__n">{n}</div><div class="kpi__l">{l}</div></div>' for n, l in h['kpi'])
    return f"""
<div class="pg__in">
  {wordmark(13)}
  <h1 class="pg__sentence">{h['sentence']}</h1>
  <div class="pg__eyebrow">{h['date']} &nbsp;&middot;&nbsp; Orders &nbsp;&middot;&nbsp; read {h['clock']} &nbsp;&middot;&nbsp; prices in {h['currency']}</div>
  <div class="kpis">{kp}</div>
  <table class="tbl"><thead><tr><th>Vendor</th><th>Lines</th><th style="text-align:right;padding-right:28px">Total</th><th>State</th><th>What the price rests on</th></tr></thead><tbody>{rows}</tbody></table>
  <div class="pg__foot"><span>{wordmark(12)}</span><span>Page stand-in &mdash; the rebuilt /orders in its own grammar, not part of this sketch.</span></div>
</div>"""


def page_receiving(h: dict) -> str:
    kp = ''.join(f'<div class="kpi"><div class="kpi__n">{n}</div><div class="kpi__l">{l}</div></div>' for n, l in h['kpi'])
    rows = ''
    for d in h['deliveries']:
        chip = '<span class="chip chip--quiet">ARRIVED</span>' if d['state'] == 'arrived' else ('<span class="chip">EXPECTED</span>' if d['state'] == 'expected' else '<span class="chip chip--dash">UNCONFIRMED</span>')
        rows += f'<tr><td>{d["who"]}</td><td class="num">{d["t"]}</td><td>{chip}</td><td class="wrap"><span class="basis">{d["txt"]}</span></td></tr>'
    return f"""
<div class="pg__in">
  {wordmark(13)}
  <h1 class="pg__sentence">{h['sentence']}</h1>
  <div class="pg__eyebrow">{h['date']} &nbsp;&middot;&nbsp; Receiving &nbsp;&middot;&nbsp; read {h['clock']} &nbsp;&middot;&nbsp; {h['currency']}</div>
  <div class="kpis">{kp}</div>
  <table class="tbl"><thead><tr><th>Vendor</th><th style="text-align:right;padding-right:28px">Window</th><th>State</th><th>What the house knows</th></tr></thead><tbody>{rows}</tbody></table>
  <div class="pg__foot"><span>{wordmark(12)}</span><span>Page stand-in &mdash; the rebuilt /receiving in its own grammar. Received stock is not verified invoice cost; a promised credit is not recovered money.</span></div>
</div>"""


def page_document(h: dict) -> str:
    d = h['doc']
    rows = ''.join(f'<tr><td>{a}</td><td class="num">{b}</td><td class="num">{c}</td><td class="num">{e}</td></tr>' for a, b, c, e in d['lines'])
    return f"""
<div class="pg__in" style="max-width:920px">
  <span class="sect" style="color:var(--ink-4)">Documents &amp; Reports &middot; invoice &middot; as the vendor sent it</span>
  <h1 class="pg__sentence" style="font-size:26px">{d['title']} &mdash; {d['vendor']}</h1>
  <div class="pg__eyebrow">{d['date']} &nbsp;&middot;&nbsp; invoice &nbsp;&middot;&nbsp; {d['total']} &nbsp;&middot;&nbsp; 3 lines, 2 matched, 1 short</div>
  <table class="tbl"><thead><tr><th>Line</th><th style="text-align:right;padding-right:28px">Qty</th><th style="text-align:right;padding-right:28px">Unit</th><th style="text-align:right;padding-right:28px">Total</th></tr></thead><tbody>{rows}</tbody></table>
  <div class="pg__foot"><span>{wordmark(12)}</span><span>Page stand-in &mdash; /documents/:id, the one declared paper surface. Captions here are --ink-4.</span></div>
</div>"""


def page_skeleton(with_mono: bool = False, twelve: bool = False, route='/orders') -> str:
    if twelve:
        return f"""
<div class="ladder">
  <div class="ladder__12">
    <span class="sect">12 s &middot; the register has not answered</span>
    <p>The orders register has not answered in twelve seconds.</p>
    <div class="quiet" style="margin-bottom:14px">Nothing has been drawn in its place. The counts you saw before this page are from the last answer, 14:01:48.</div>
    <div style="display:flex;gap:10px"><button class="btn btn--seal">Try again</button><button class="btn">Go to Dashboard</button></div>
  </div>
</div>"""
    mono = f'<div class="ladder__mono">still reading {route} &middot; 3.2 s &middot; the house has not answered yet</div>' if with_mono else ''
    return f"""
<div class="ladder">
  <div class="skel" style="width:76px;height:12px"></div>
  <div class="skel" style="width:520px;height:32px;margin-top:12px"></div>
  <div class="skel" style="width:360px;height:32px;margin-top:6px"></div>
  <div class="skel" style="width:300px;height:10px;margin-top:12px"></div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:24px;margin-top:30px">
    <div><div class="skel" style="width:40px;height:26px"></div><div class="skel" style="width:110px;height:10px;margin-top:10px"></div></div>
    <div><div class="skel" style="width:40px;height:26px"></div><div class="skel" style="width:120px;height:10px;margin-top:10px"></div></div>
    <div><div class="skel" style="width:40px;height:26px"></div><div class="skel" style="width:100px;height:10px;margin-top:10px"></div></div>
    <div><div class="skel" style="width:40px;height:26px"></div><div class="skel" style="width:90px;height:10px;margin-top:10px"></div></div>
    <div><div class="skel" style="width:40px;height:26px"></div><div class="skel" style="width:140px;height:10px;margin-top:10px"></div></div>
  </div>
  <div class="skel" style="height:1px;margin-top:26px"></div>
  <div class="skel" style="height:44px;margin-top:14px;opacity:.7"></div>
  <div class="skel" style="height:44px;margin-top:8px;opacity:.55"></div>
  <div class="skel" style="height:44px;margin-top:8px;opacity:.4"></div>
  {mono}
</div>"""


def page_fail(h: dict, stale: bool = False) -> str:
    if stale:
        return f"""
<div class="fail">
  <span class="sect">Reloading once</span>
  <h2>This page is from before the last publish.</h2>
  <p>The house published a newer build while this tab was open, and the piece this room needs is no longer where the old build looks for it. Reloading once &mdash; nothing you wrote here is lost, because nothing was written.</p>
  <dl><dt>Missing chunk</dt><dd>OrdersNext-8f2c1a.js</dd><dt>Build here</dt><dd>web@fb19885e</dd><dt>Route</dt><dd>/orders</dd></dl>
  <div class="fail__acts"><button class="btn">Reload now</button><span class="quiet">If it comes back a second time, this page stops reloading and says so.</span></div>
</div>"""
    return f"""
<div class="fail">
  <span class="sect">This room failed to draw</span>
  <h2>Orders failed to draw.</h2>
  <p>The room threw while drawing. The chrome around it is fine, and nothing was written: the register was being read, not changed.</p>
  <dl>
    <dt>Error id</dt><dd>evt_9c1e4b70 <button class="link" style="margin-left:8px">{ico('copy', 12)} Copy</button></dd>
    <dt>Build</dt><dd>web@fb19885e</dd>
    <dt>Route</dt><dd>/orders</dd>
    <dt>House</dt><dd>{h['name']}</dd>
    <dt>When</dt><dd>{h['date']} 14:02:31 {h['tz']}</dd>
  </dl>
  <div class="fail__acts"><button class="btn btn--seal">Try again</button><button class="btn">Go to Dashboard</button><span class="quiet">Or write to <b>support@mudavym.com</b> with these readings.</span></div>
</div>"""


def page_404(h: dict, addr: str = '/ordres') -> str:
    groups = ''
    for g, rooms in ROOMS:
        links = ''.join(f'<a href="#">{r}</a>' for r, _ in rooms)
        groups += f'<div><span class="sect">{g}</span>{links}</div>'
    groups += ('<div><span class="sect">Mudavym</span><a href="#">Ask Mudavym. <span class="mono em" style="font-size:10px">/ask</span></a>'
               '<a href="#" class="em">/sommelier redirects here</a></div>')
    groups += ('<div><span class="sect">The house</span><a href="#">Settings</a><a href="#">Connections</a><a href="#">The desk</a><a href="#">Help</a></div>')
    return f"""
<div class="nf">
  <span class="sect">Not a room</span>
  <h2>There is no room at this address.</h2>
  <div class="addr">{addr}</div>
  <div class="near">{ico('chevr', 14)}<span>Nearest room: <b>Orders</b> <span class="mono em" style="font-size:11px">/orders</span></span><button class="btn btn--sm" style="margin-left:auto">Go there</button></div>
  <div class="nf__rooms">{groups}</div>
  <p class="quiet" style="margin-top:22px">A room you may not enter is a different door &mdash; it says so at <span class="mono">/no-access</span>. </p>
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# Shared overlays — toast, palette, bell, ladder
# ─────────────────────────────────────────────────────────────────────────────
def toast(h: dict, kind: str, *, undo=True, drain=True, stamp=False) -> str:
    eb, at, txt, sub = h['toasts'][kind]
    cls = {'written': ' toast--written', 'refused': ' toast--refused'}.get(kind, '')
    first, _, rest = eb.partition(' &middot; ')
    ebh = f'<b>{first}</b>' + (f'<span>{rest}</span>' if rest else '')
    acts = ''
    if kind == 'dismissed' and undo:
        acts = '<div class="toast__acts"><button class="link">Undo</button><kbd class="kbd">&#8984;Z</kbd></div>'
    elif kind == 'draft':
        acts = '<div class="toast__acts"><button class="link">Open the draft</button></div>'
    elif kind == 'sealed':
        acts = '<div class="toast__acts"><button class="link">Open the receipt</button></div>'
    wax = f'<span class="wax toast__wax">{ico("seal", 9)}</span>' if kind == 'sealed' else ''
    dr = '<div class="toast__drain" aria-hidden="true"></div>' if (drain and kind in ('dismissed',)) else ''
    return f"""<div class="toast{cls}" role="status">
  <div class="toast__eyebrow">{wax}{ebh}<span class="at">{at}</span></div>
  <div class="toast__txt">{txt}</div>
  <div class="toast__sub">{sub}</div>{acts}{dr}
</div>"""


def palette(h: dict, direction: str, typed: str = 'ker') -> str:
    if direction == 'd':
        first_sect = 'On the counter'
        first = (act_item('Seal', 'Order to Kermit Lynch &mdash; 12 lines, $3,910.00', 'awaiting your seal') +
                 act_item('Verify', 'Invoice 4471 &middot; Southern Glazer&#8217;s', 'arrived 11:32'))
    else:
        first_sect = 'Today'
        first = (act_item('16:00', 'Kermit Lynch expected at the door', '12 lines &middot; the vendor confirmed') +
                 act_item('15:00', 'Kermit Lynch rep &middot; tasting', 'calendar'))
    rooms = ''.join(f'<div class="item"><span class="item__ic">{ico("rooms", 14)}</span>Receiving <span class="item__meta">The door &middot; G R</span></div>' for _ in [0])
    return f"""
<div class="panel" role="dialog" aria-label="Search or act">
  <div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--paper-2)">{ico('search', 16)}<span style="font-size:15px;color:var(--ink-1)">{typed}<span style="display:inline-block;width:1px;height:16px;background:var(--seal);vertical-align:-3px;margin-left:1px"></span></span><span class="quiet" style="margin-left:auto">esc</span></div>
  <div style="padding:10px 18px 6px">
    <span class="sect" style="margin:6px 0 4px">{first_sect}</span>
    {first}
    <span class="sect" style="margin:12px 0 4px">Rooms</span>
    <div class="item cur"><span class="item__ic">{ico('rooms', 14)}</span>Receiving<span class="item__meta">The door &middot; G then R</span></div>
    <div class="item"><span class="item__ic">{ico('rooms', 14)}</span>Receipts &amp; Credits<span class="item__meta">The books</span></div>
    <span class="sect" style="margin:12px 0 4px">Records</span>
    <div class="item"><span class="item__ic">{ico('door', 14)}</span>Kermit Lynch<span class="item__meta">Provider &middot; 3 open orders</span></div>
    <div class="item"><span class="item__ic">{ico('cellar', 14)}</span>Kermit Lynch Chablis Vaillons 2023<span class="item__meta">Wines &middot; 14 in the cellar</span></div>
    <div class="item ruled" style="margin-top:10px"><span class="item__ic">{ico('ask', 14)}</span>Ask <span class="wm" style="font-size:13px;margin-left:4px">Mudavym<span class="wm-stop">.</span></span>&nbsp;<span class="quiet">&ldquo;{typed}&hellip;&rdquo;</span><kbd class="kbd">&#8984;&#8679;K</kbd></div>
  </div>
  <div style="display:flex;gap:16px;padding:9px 18px 11px;border-top:1px solid var(--paper-2);font-family:var(--mono);font-size:10px;color:var(--ink-4)"><span>&uarr;&darr; move</span><span>&#8629; open</span><span>&#8984;&#8629; open in place</span><span style="margin-left:auto">esc closes</span></div>
</div>"""


def act_item(verb: str, what: str, meta: str) -> str:
    return f'<div class="item"><span class="chip" style="min-width:52px;text-align:center">{verb}</span>{what}<span class="item__meta">{meta}</span></div>'


def bell_pop(h: dict, left: int, top: int, *, points: str = 'counter') -> str:
    """points: 'counter' (D — a line may point at an act on the counter) | 'line' (E — at a tick on the day line).
    The pointer is a line under the timestamp; the two never share a number."""
    if h['key'] == 'us':
        p_del = 'on the line &middot; by 16:00' if points == 'line' else None
        p_par = 'Seal &middot; Kermit Lynch' if points == 'counter' else None
        rows = [('Kermit Lynch confirmed Thursday&#8217;s delivery', '12 lines &middot; by 16:00', '3h ago', p_del),
                ('Sancerre, Domaine Vacheron is below par', '4 left &middot; par 12', '5h ago', p_par),
                ('Price sighting: Chablis Vaillons below its 30-day mean', 'Kermit Lynch quote &middot; class A &middot; &minus;12%', 'yesterday', None),
                ('Jon Park has not accepted the invitation', 'sent 2026-09-15', '2d ago', None)]
        eb = '12 unread &middot; 8 lines after folding 4 &middot; newest 20 shown'
    else:
        rows = [('Efes teslimatı 15:30&#8217;a kadar bekleniyor', '12 kasa', '2h ago', None),
                ('Öküzgözü, Doluca par altında', '3 kaldı &middot; par 12', '6h ago', None),
                ('Doluca sordu: hangi yıl?', 'cevap bekliyor', '4h ago', None)]
        eb = '3 unread &middot; 3 lines'
    lines = ''
    for t, s, at, lead in rows:
        stamp = f'<span class="row__at">{at}<span class="row__ptr">&rarr; {lead}</span></span>' if lead else f'<span class="row__at">{at}</span>'
        lines += f'<div class="row"><span class="dot" style="margin-top:6px"></span><div class="row__txt">{t}<div class="row__sub">{s}</div></div>{stamp}</div>'
    return f"""
<div class="pop pop--wide" role="dialog" aria-label="Notifications" style="left:{left}px;top:{top}px">
  <div style="display:flex;align-items:baseline;gap:8px"><div><div class="pop__eyebrow">{eb}</div><div class="pop__title">Notifications</div></div><button class="link" style="margin-left:auto">Rule all off</button></div>
  {lines}
  <div class="pop__foot"><button class="link">Open notifications</button><span>read {h['clock']} &middot; again in 60 s</span></div>
</div>"""


def ladder_pop(h: dict, left: int, top: int) -> str:
    rows = ''.join(f'<div class="row"><span class="ring" style="margin-top:5px"></span><div class="row__txt">{w}<div class="row__sub">written here &middot; rung 1 of 4 &middot; not sent</div></div><span class="row__at">{at}</span></div>' for w, at in h['outbox'])
    return f"""
<div class="pop" role="dialog" aria-label="What is written here" style="left:{left}px;top:{top}px">
  <div class="pop__eyebrow">Written here &middot; {len(h['outbox'])} records</div>
  <div class="pop__title">Waiting for the house to answer</div>
  {rows}
  <div class="pop__foot" style="display:block">
    <div style="display:flex;gap:10px;flex-wrap:wrap;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase"><span>1 written here</span><span>&rarr; 2 sent</span><span>&rarr; 3 received</span><span>&rarr; 4 sealed by the house</span></div>
    <div style="margin-top:6px">Every record stays on rung 1 until the house answers. A seal is never queued.</div>
  </div>
</div>"""


def user_pop(h: dict, left: int, top: int) -> str:
    role = f'{h["role"]} at {h["name"]}.' if h['key'] == 'us' else f'{h["role"]} at {h["name"]}.'
    return f"""
<div class="pop" role="dialog" aria-label="Account menu" style="left:{left}px;top:{top}px;width:274px">
  <div class="pop__eyebrow">{'maya@larkspurvine.com' if h['key']=='us' else 'ayse@simmeyhouse.com'}</div>
  <div class="pop__title">{h['person']}</div>
  <div class="quiet" style="font-size:11.5px;margin-bottom:6px">{role}</div>
  <div class="item">Profile</div><div class="item">Settings</div><div class="item">Help &amp; Support</div>
  <div class="item ruled">Log out</div>
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# Direction D pieces
# ─────────────────────────────────────────────────────────────────────────────
def rail(h: dict, active: str, *, tucked=False, staff=False, cellar_open=False) -> str:
    if tucked:
        return '<div class="strip" aria-label="The rooms, tucked"><span>Rooms &middot; &#8984;\\</span></div>'
    groups = ''
    for g, rooms in ROOMS:
        groups += f'<span class="sect">{g}</span>'
        for r, path in rooms:
            cur = ' cur' if r == active else ''
            groups += f'<a class="room{cur}" href="#">{r}</a>'
            if r == 'Cellar' and cellar_open:
                for c in CELLAR:
                    groups += f'<a class="room room--sub" href="#">{c}</a>'
    foot = ''
    for r, path, need in FOOT:
        if need == 'manager' and staff:
            continue
        if need == 'owner' and h['role'] != 'Owner':
            continue
        foot += f'<a class="room" href="#">{r}</a>'
    return f"""
<nav class="rail" aria-label="The rooms">
  <button class="rail__ask">Ask {wordmark(13)}<kbd class="kbd">&#8984;&#8679;K</kbd></button>
  {groups}
  <div class="rail__foot">{foot}<div class="rail__tuck">Tuck the rooms<kbd class="kbd">&#8984;\\</kbd></div></div>
</nav>"""


def act(verb: str, what: str, detail: str, at: str, *, cur=False, cls='', vcls='') -> str:
    return (f'<div class="act{" cur" if cur else ""}{" " + cls if cls else ""}"><span class="act__verb{" " + vcls if vcls else ""}">{verb}</span>'
            f'<div class="act__main"><div class="act__what">{what}</div><div class="act__detail">{detail}</div></div><span class="act__at">{at}</span></div>')


def regline(txt: str, mark_: str = 'ring', act_: str = '') -> str:
    m = {'ring': '<span class="ring"></span>', 'hair': '<span class="hair"></span>', 'none': ''}[mark_]
    a = f'<button class="link">{act_}</button>' if act_ else ''
    return f'<div class="regline">{m}<span>{txt}</span>{a}</div>'


def counter_head(outcomes: list[str], *, offline=False) -> str:
    """The counter's head, computed from the registers actually rendered and their outcomes — never a
    constant. A 501 is a real answer (the register said *not built*), but it is named on its own and
    never folded into `n of n`: a register that returns nothing by construction is not the same as one
    that answered with content, and counting it as ok is absence reported as health. A refusal, a 503 or
    a timeout is likewise not ok, and each is named after the count. Never `n of n` when a register
    refused, was not read, was not built or was not shown."""
    n = len(outcomes)
    if offline:
        return f'{n} registers &middot; from 14:01:48'
    ok = sum(1 for o in outcomes if o == 'answered')
    parts = [f'{ok} of {n} registers']
    if outcomes.count('unbuilt'):
        parts.append(f'{outcomes.count("unbuilt")} not built')
    if outcomes.count('refused'):
        parts.append(f'{outcomes.count("refused")} refused')
    if outcomes.count('notread'):
        parts.append(f'{outcomes.count("notread")} not read')
    return ' &middot; '.join(parts)


def counter(h: dict, *, state='ready', opened=None, market='unbuilt', toast_kind=None, staff=False,
            partial=False, with_said=True, offline=False) -> str:
    """state: ready | empty | reading | offline ; opened: 'seal' | 'market' | None"""
    body = ''
    read = h['clock'] if not offline else '14:01:48'
    if state == 'reading':
        body = ('<div class="counter__sec">' + regline('Reading the registers', 'hair') +
                '<div class="skel" style="height:14px;margin:8px 0"></div><div class="skel" style="height:14px;margin:8px 0;opacity:.7"></div><div class="skel" style="height:14px;margin:8px 0;opacity:.5"></div></div>')
        answered = 'reading'
    elif state == 'empty':
        body = ('<div class="counter__sec"><div class="quiet" style="padding:12px 0 8px;font-size:12.5px;color:var(--ink-2)">Nothing waits on you.</div>'
                '<div class="quiet" style="font-size:11.5px">Every other register answered at 14:02:11: orders, receipts, replies, invitations, identities and proposals all came back empty. The market register is not built and said so.</div>'
                + regline('Market &middot; not built', 'ring') + '</div>')
        answered = counter_head(['answered'] * 5 + ['unbuilt'])
    else:
        secs: list[tuple[str, str]] = []   # (html, outcome) — outcome: answered | refused | notread | unbuilt
        # Seal
        if staff:
            secs.append(('<div class="counter__sec"><span class="sect">Seal<span class="n">not yours</span></span>' +
                         f'<div class="act act--dash"><span class="act__verb quiet">Seal</span><div class="act__main"><div class="act__what">2 orders wait on {h["manager_word"]}&#8217;s seal</div><div class="act__detail">Kavaklıdere ₺12.480,00 &middot; Doluca ₺3.150,00 &middot; the house&#8217;s count, not your act</div></div><span class="act__at">09:10</span></div></div>', 'answered'))
        else:
            rows = ''.join(act('Seal', f'{o["vendor"]} &mdash; {o["lines"]} &middot; {o["total"]}', f'drafted by {o["by"]} {o["at"]} &middot; {o["basis_txt"]}', o['at'], cur=(opened == 'seal' and i == 0)) for i, o in enumerate(h['orders']))
            secs.append((f'<div class="counter__sec"><span class="sect">Seal<span class="n">{len(h["orders"])} orders</span></span>{rows}</div>', 'answered'))
        # Verify
        if staff:
            secs.append(('<div class="counter__sec"><span class="sect">Verify</span>' + regline('Receipts &amp; Credits &middot; refused for your role', 'none') + '</div>', 'refused'))
        elif partial:
            secs.append(('<div class="counter__sec"><span class="sect">Verify</span>' + regline('Receipts &amp; Credits &middot; not read &middot; 503 at 14:02:11', 'ring', 'Read again') + '</div>', 'notread'))
        else:
            rows = ''.join(act('Verify', v['what'], v['detail'], v['at']) for v in h['verify'])
            secs.append((f'<div class="counter__sec"><span class="sect">Verify<span class="n">{len(h["verify"])} receipts</span></span>{rows}</div>', 'answered'))
        # Reply
        rows = ''.join(act('Reply', r['who'], r['detail'], r['at']) for r in h['reply'])
        secs.append((f'<div class="counter__sec"><span class="sect">Reply<span class="n">{len(h["reply"])} waiting</span></span>{rows}</div>', 'answered'))
        # Decide splits into two registers for a staff role: identity candidates carry a handler-level
        # @Roles("owner","manager","staff") on both the queue and its decide route
        # (vendor-intel.controller.ts:460-461, :489-490) — RolesGuard.getAllAndOverride reads the handler
        # before the class (roles.guard.ts:12-14), so this overrides the controller's owner/manager
        # default, and the controller's own comment says the queue "moves with the decision" because only
        # the ones holding the bottles can answer it. Invitations are owner/manager only: the controller
        # carries just JwtAuthGuard (members.controller.ts:28, :45) but getInvites calls assertMembership
        # with 'owner|manager' (members.service.ts:129), which throws 403 for staff (:60-62).
        if staff:
            identity_items = [d for d in h['decide'] if 'Identity' in d['what']]
            if identity_items:
                rows = ''.join(act('Decide', d['what'], d['detail'], d['at']) for d in identity_items)
                secs.append((f'<div class="counter__sec"><span class="sect">Decide<span class="n">{len(identity_items)} waiting &middot; yours to decide</span></span>{rows}</div>', 'answered'))
            else:
                secs.append(('<div class="counter__sec"><span class="sect">Decide</span>' + regline('Identities &middot; none waiting', 'none') + '</div>', 'answered'))
            secs.append(('<div class="counter__sec" style="border-top:0;padding-top:0">' + regline('Invitations &middot; refused for your role', 'none') + '</div>', 'refused'))
        elif partial:
            rows = ''.join(act('Decide', d['what'], d['detail'], d['at']) for d in h['decide'][:1])
            secs.append(('<div class="counter__sec"><span class="sect">Decide<span class="n">1 + ?</span></span>' + rows + regline('Identities &middot; not read &middot; timed out', 'ring', 'Read again') + '</div>', 'notread'))
        else:
            rows = ''.join(act('Decide', d['what'], d['detail'], d['at']) for d in h['decide'])
            secs.append((f'<div class="counter__sec"><span class="sect">Decide<span class="n">{len(h["decide"])}</span></span>{rows}</div>', 'answered'))
        # Mudavym proposes — GET /ask-ai/actions is readable by every member (class guards only, ask-ai.controller.ts:76, :124);
        # confirming is owner/manager (:152). For staff the register answers and the act is not theirs. An empty register is a line, never an absence.
        if staff:
            n_p = len(h['proposed'])
            txt = (f'{n_p} proposals wait on {h["manager_word"]}&#8217;s confirmation' if n_p else f'Nothing proposed &middot; a proposal would wait on {h["manager_word"]}, not on you')
            secs.append(('<div class="counter__sec"><span class="sect">Mudavym proposes<span class="n">not yours to confirm</span></span>' + regline(txt, 'none') + '</div>', 'answered'))
        elif h['proposed']:
            rows = ''.join(act('Proposed', p['what'], p['detail'], p['at']) for p in h['proposed'])
            secs.append((f'<div class="counter__sec"><span class="sect">Mudavym proposes<span class="n">{len(h["proposed"])}</span></span>{rows}</div>', 'answered'))
        else:
            secs.append(('<div class="counter__sec"><span class="sect">Mudavym proposes<span class="n">none</span></span>' + regline('Nothing proposed since the last read', 'none') + '</div>', 'answered'))
        # Judge
        if staff:
            secs.append(('<div class="counter__sec"><span class="sect">Judge</span>' + regline('Market &middot; refused for your role', 'none') + '</div>', 'refused'))
        elif market == 'built' and h['market_built']:
            m = h['market_built']
            secs.append(('<div class="counter__sec"><span class="sect">Judge<span class="n">1 market action</span></span>' +
                         act('Judge', m['what'], m['detail'], m['at'], cur=(opened == 'market')) + '</div>', 'answered'))
        else:
            secs.append(('<div class="counter__sec"><span class="sect">Judge</span>' +
                         f'<div class="act act--dash{" cur" if opened == "market" else ""}"><span class="act__verb quiet">Judge</span><div class="act__main"><div class="act__what">Market &middot; not built</div><div class="act__detail">the signals exist; nothing turns one into an act for this house</div></div><span class="ring" style="margin-top:6px"></span></div></div>', 'unbuilt'))
        body = ''.join(s for s, _ in secs)
        answered = counter_head([o for _, o in secs], offline=offline)
    said = ''
    if with_said:
        n = len(h['log'])
        rows = ''
        for eb, at, txt, sub in h['log'][:3]:
            w = ' w' if eb == 'WRITTEN HERE' else ''
            rows += f'<div class="said"><div class="said__eb{w}"><span>{eb}</span><span class="at">{at}</span></div><div class="said__txt">{txt}</div><div class="said__sub">{sub}</div></div>'
        said = f'<div class="counter__said"><span class="sect">The house said<span class="n">this session &middot; {n}</span></span>{rows}</div>'
    off_head = ''
    if offline:
        off_head = (f'<div class="counter__sec" style="border-top:0;padding-top:4px"><div class="act act--dash"><span class="act__verb quiet">Held</span><div class="act__main"><div class="act__what">Written here, not sent &middot; {len(h["outbox"])}</div>'
                    '<div class="act__detail">each stays on rung 1 of 4 until the house answers</div></div><span class="act__at">14:06</span></div></div>')
    tk = ''
    if toast_kind:
        tk = f'<div class="counter__toast">{toast(h, toast_kind)}</div>'
    # The foot never claims a read that has not landed: `again in 60 s` follows only a
    # completed read, and `state == 'reading'` has not completed one yet (the same class
    # E's cadence line was fixed for in the first round).
    if offline:
        foot = 'read 14:01:48 &middot; offline &middot; will read on return'
    elif state == 'reading':
        foot = 'reading the registers&hellip;'
    else:
        foot = f'read {read} &middot; again in 60 s &middot; on focus'
    foot_btn = '' if state == 'reading' else '<button class="link">Read now</button>'
    return f"""
<aside class="counter{' counter--off' if offline else ''}" aria-label="The counter">
  {tk}
  <div class="counter__head"><span class="sect">On the counter</span><span class="counter__read">{answered}</span></div>
  <div class="counter__body">{off_head}{body}</div>
  {said}
  <div class="counter__foot">{foot}{foot_btn}</div>
</aside>"""


def cstrip(dot=True) -> str:
    d = '<span class="dot"></span>' if dot else ''
    return f'<div class="cstrip" aria-label="The counter, tucked"><button aria-label="Open the counter">{ico("counter", 16)}{d}</button><span>Counter</span></div>'


def sheet_seal(h: dict) -> str:
    o = h['orders'][0]
    lines = ('<div class="row"><div class="row__txt">Chablis Vaillons 2023 &middot; 12 &times; 750 ml<div class="row__sub">agreed price &middot; 2026-08-30</div></div><span class="row__at"><b>6</b>$27.40</span></div>'
             '<div class="row"><div class="row__txt">Sancerre, Domaine Vacheron 2024 &middot; 12 &times; 750 ml<div class="row__sub">agreed price</div></div><span class="row__at"><b>12</b>$24.10</span></div>'
             '<div class="row"><div class="row__txt">Bandol Rouge, Tempier 2022 &middot; 6 &times; 750 ml<div class="row__sub">last invoice, 2026-09-03 &mdash; no agreed price</div></div><span class="row__at"><b>6</b>$41.00</span></div>'
             '<div class="row"><div class="row__txt quiet">9 more lines<div class="row__sub">7 agreed &middot; 2 last invoice</div></div><button class="link" style="align-self:center">Show all</button></div>')
    return f"""
<div class="sheet" role="dialog" aria-label="Seal this order">
  <div class="sheet__head"><div><span class="eyebrow">Seal &middot; order &middot; drafted by {o['by']} {o['at']}</span><h2 class="sheet__title">Order to {o['vendor']}</h2></div><button class="sheet__close" aria-label="Close">{ico('x', 16)}</button></div>
  <div class="sheet__body">
    <div style="display:flex;gap:18px;margin-bottom:10px"><div><span class="sect">Total</span><div class="mono" style="font-size:22px;margin-top:2px">{o['total']}</div></div><div><span class="sect">Lines</span><div class="mono" style="font-size:22px;margin-top:2px">12</div></div><div><span class="sect">Rests on</span><div style="font-size:12px;margin-top:6px"><span class="chip">AGREED</span> <span class="quiet">{o['basis_txt']}</span></div></div></div>
    {lines}
    <div class="quiet" style="margin-top:14px;font-size:11.5px">Sealing sends this order to {o['vendor']} by email from the house&#8217;s own address and writes the seal to the ledger. The total omits nothing; every line names what its price rests on. You are still on <b>Orders</b> &mdash; this sheet closes back to it.</div>
  </div>
  <div class="sheet__foot">
    <div class="hold" role="button" aria-label="Hold to seal"><div class="hold__fill"></div><span>Hold to seal</span></div>
    <div style="display:flex;justify-content:space-between;margin-top:10px"><button class="link">Open in Orders</button><button class="link" style="color:var(--ink-3)">Send back to draft</button></div>
  </div>
</div>"""


def market_json(built: bool) -> str:
    if built:
        return """<span class="s">HTTP 200</span>
{
  <span class="k">"register"</span>: "market_actions", <span class="k">"state"</span>: "ready",
  <span class="k">"readAt"</span>: "2026-09-17T21:02:11Z", <span class="k">"house"</span>: { "id": "&lt;restaurantId&gt;" },
  <span class="k">"actions"</span>: [{
    <span class="k">"id"</span>: "ma_01J…", <span class="k">"kind"</span>: "buy_now",
    <span class="k">"subject"</span>: { "identityId": "…", "houseItemId": "…", "name": "Chablis Vaillons 2023" },
    <span class="k">"signal"</span>: { "source": "vendor-intel/below-average", "class": "A", "issuer": "Kermit Lynch",
                "issuedAt": "2026-09-16", "unit": "750 ml bottle", "figure": 27.40,
                "baseline": 31.10, "move": -0.12, "n": 4, "currency": "USD" },
    <span class="k">"judgement"</span>: { "expectedValue": null, "confidence": "low",
                   "working": "newest quote vs mean of 3 earlier quotes, 30 days",
                   "notKnown": ["pass-through to this house", "how long the quote holds"] },
    <span class="k">"draft"</span>: { "oneTapActionId": null }, <span class="k">"expiresAt"</span>: "2026-09-18T01:00:00Z"
  }],
  <span class="k">"skipped"</span>: [{ "reason": "thin_history", "count": 3 }, { "reason": "mixed_currency", "count": 0 }]
}"""
    return """<span class="s">HTTP 501 Not Implemented</span>
{
  <span class="k">"success"</span>: false,
  <span class="k">"register"</span>: "market_actions",
  <span class="k">"state"</span>: "unbuilt",
  <span class="k">"readAt"</span>: "2026-09-17T21:02:11Z",
  <span class="k">"house"</span>: { "id": "&lt;restaurantId&gt;" },
  <span class="k">"refusal"</span>: {
    <span class="k">"code"</span>: "MARKET_ACTIONS_NOT_BUILT",
    <span class="k">"sentence"</span>: "The market register has no judged
                 actions yet. The signals exist; nothing
                 turns one into an act for this house.",
    <span class="k">"sources"</span>: ["GET /vendor-intel/below-average",
                "GET /commodity-index/me",
                "GET /price-index/status"]
  },
  <span class="k">"actions"</span>: []
}"""


def sheet_market(h: dict, built: bool) -> str:
    if built:
        m = h['market_built']
        return f"""
<div class="sheet" role="dialog" aria-label="Judge a market action">
  <div class="sheet__head"><div><span class="eyebrow">Judge &middot; market action &middot; read {h['clock']}</span><h2 class="sheet__title">{m['what']} is {m['move']} under its mean</h2></div><button class="sheet__close" aria-label="Close">{ico('x', 16)}</button></div>
  <div class="sheet__body">
    <div style="display:flex;gap:18px;margin-bottom:10px"><div><span class="sect">Quote</span><div class="mono" style="font-size:22px;margin-top:2px">{m['figure']}</div></div><div><span class="sect">30-day mean</span><div class="mono" style="font-size:22px;margin-top:2px">{m['mean']}</div></div><div><span class="sect">Basis</span><div style="font-size:12px;margin-top:6px"><span class="chip">{m['cls']}</span><div class="quiet" style="font-size:11px;margin-top:3px">{m['n']} &middot; the mean excludes the newest</div></div></div></div>
    <div class="row"><div class="row__txt">Kermit Lynch &middot; quote &middot; 2026-09-16<div class="row__sub">class A &middot; per 750 ml bottle &middot; source, date and unit as the vendor gave them</div></div><span class="row__at"><b>$27.40</b></span></div>
    <div class="row"><div class="row__txt">Posted list, CA &middot; issued 2026-09-01<div class="row__sub">index line &middot; its own register &middot; never beside the quote</div></div><span class="row__at"><b>$29.95</b>class B</span></div>
    <div class="row"><div class="row__txt">This house<div class="row__sub">14 in the cellar &middot; par 12 &middot; sold 11 in 14 days</div></div><span class="row__at"><b>9 days</b>cover</span></div>
    <div class="quiet" style="margin-top:14px;font-size:11.5px"><b style="color:var(--ink-2)">What is not known.</b> How much of a quote move reaches this house&#8217;s invoice has never been measured here, so no saving is stated. How long the quote holds is the vendor&#8217;s to say; the register assumes the close of business. Confidence: low &mdash; four quotes.</div>
  </div>
  <div class="sheet__foot">
    <div style="display:flex;gap:10px"><button class="btn btn--seal">Draft an order &middot; 12</button><button class="btn">Hold &middot; ask again in 7 days</button></div>
    <div class="quiet" style="margin-top:10px;font-size:11px">A draft is a draft. Nothing is sent, approved or sealed from this sheet &mdash; the draft opens in Orders and waits on the seal there.</div>
  </div>
</div>"""
    return f"""
<div class="sheet" role="dialog" aria-label="Market actions">
  <div class="sheet__head"><div><span class="eyebrow">Judge &middot; market &middot; read {h['clock']}</span><h2 class="sheet__title">The market register has no judged actions yet.</h2></div><button class="sheet__close" aria-label="Close">{ico('x', 16)}</button></div>
  <div class="sheet__body">
    <div class="quiet" style="font-size:12.5px;color:var(--ink-2);margin-bottom:12px">The signals exist. Nothing turns one into an act for this house, so this row stays hollow and never prints a zero.</div>
    <span class="sect" style="margin-bottom:4px">What the house can read today</span>
    <div class="row"><span class="dot" style="margin-top:6px"></span><div class="row__txt">2 products below their 30-day mean<div class="row__sub">the house&#8217;s own quotes and invoices &middot; class A only &middot; 3 too thin to compare</div></div><span class="row__at">{h['clock']}</span></div>
    <div class="row"><span class="dot" style="margin-top:6px"></span><div class="row__txt">Posted list, CA &middot; issued 2026-09-01<div class="row__sub">the state&#8217;s posted list &middot; its own register, never beside a quote</div></div><span class="row__at">{h['clock']}</span></div>
    <div class="row"><span class="ring" style="margin-top:5px"></span><div class="row__txt">Commodity &middot; no series armed<div class="row__sub">the rule is built and cannot yet reach a person</div></div><span class="row__at">{h['clock']}</span></div>
    <div class="quiet" style="margin-top:14px;font-size:11.5px">Until the register is built this row stays hollow. Nothing is drawn in its place, and no figure on this sheet is a saving.</div>
    <div class="mono" style="margin-top:12px;font-size:10px;color:var(--ink-4)">read {h['clock']} &middot; again in 60 s &middot; on focus</div>
  </div>
  <div class="sheet__foot"><div style="display:flex;gap:10px"><button class="btn">Open Vendor prices</button><button class="btn">Open the market box</button></div></div>
</div>"""


def frame_d(h: dict, page_html: str, page_name: str, *, active: str, badge='n', rail_tucked=False, staff=False,
            counter_html: str | None = None, counter_tucked=False, overlays='', loading=False, offline_n=0,
            cellar_open=False, cls='', ground=None, bell_open=False, counter_open=True) -> str:
    g = f' data-ground="{ground}"' if ground else ''
    c = ('' if counter_html == '' else (cstrip() if counter_tucked else counter_html))
    off = offstrip(h, offline_n) if offline_n else ''
    return f"""
<div class="mudavym frame {cls}"{g}>
  {header(h, page_name, badge=badge, loading=loading, counter_btn=True, counter_open=counter_open and not counter_tucked, bell_open=bell_open)}
  {off}
  <div class="body">
    {rail(h, active, tucked=rail_tucked, staff=staff, cellar_open=cellar_open)}
    <main class="pg">{page_html}</main>
    {c}
  </div>
  {overlays}
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# Direction E pieces
# ─────────────────────────────────────────────────────────────────────────────
def _mins(t: str) -> int:
    hh, mm = t.split(':')
    return int(hh) * 60 + int(mm)


def _abs(h: dict, t: str) -> int:
    """Absolute minutes on today's service arc. A day that closes after midnight
    puts any time at or before the close on the next calendar day."""
    hrs = h['hours']
    prep, close = _mins(hrs['prep']), _mins(hrs['close'])
    x = _mins(t)
    if close < prep and x <= close:
        x += 1440
    return x


def _window(h: dict, extra=(), *, use_hours=True) -> tuple[int, int]:
    """The visible window: everything the day holds, with a little air at both ends.
    Nothing is ever clamped off the line — a tick before prep is drawn before prep.
    With the hours unset the window is the fixed points and now alone."""
    hrs = h['hours']
    pts = ([_abs(h, hrs['prep']), _abs(h, hrs['doors']), _abs(h, hrs['close'])] if use_hours else []) + [_abs(h, h['now'])] + [_abs(h, t) for t in extra]
    return min(pts) - 30, max(pts) + 30


def _layout(items: list, trackpx: float, maxw: float | None = None, gap: float = 8, charw: float = 5.6) -> int:
    """Greedy row assignment for labels centred on their marks, by estimated width.
    Mutates each item with `row` and `align`; returns the number of rows used."""
    rows: list[list[tuple[float, float]]] = []
    for it in sorted(items, key=lambda i: i['x']):
        w = len(it['plain']) * charw + 6
        if maxw:
            w = min(w, maxw)
        x = it['x'] / 100 * trackpx
        x0, x1 = x - w / 2, x + w / 2
        if x0 < 0:
            x1 -= x0; x0 = 0; it['align'] = 'l'
        elif x1 > trackpx:
            x0 -= x1 - trackpx; x1 = trackpx; it['align'] = 'r'
        else:
            it['align'] = 'c'
        for r, occ in enumerate(rows):
            if all(x0 >= ox1 + gap or x1 <= ox0 - gap for ox0, ox1 in occ):
                occ.append((x0, x1)); it['row'] = r; break
        else:
            rows.append([(x0, x1)]); it['row'] = len(rows) - 1
    return len(rows)


def _day_items(h: dict, *, offline=False, staff=False, market='unbuilt', cur_tick=None, said=None, partial=False) -> list:
    """Today's fixed points as label items, same-time records merged into one mark.
    partial: the calendar and team registers did not answer — their ticks are absent, not drawn from memory."""
    raw = []
    for d in h['deliveries']:
        if d['t'] == '&mdash;':
            continue
        raw.append(dict(t=d['t'], word=d['who'], kind=('arrived' if d['state'] == 'arrived' else 'expected'), cur=(cur_tick == d['who'])))
    for e in ([] if partial else h['events']):
        raw.append(dict(t=e['t'], word=e['txt'].split(' &middot; ')[0], kind='event', cur=False))
    for sh in ([] if partial else h['shifts']):
        raw.append(dict(t=sh['t'], word=sh['txt'].split(' on ')[0] if ' on ' in sh['txt'] else sh['txt'], kind='shift', cur=False))
    if h['count'] and not staff and not partial:
        raw.append(dict(t=h['count']['t'], word='Count due', kind='event', cur=False))
    if market == 'built' and h['market_built']:
        raw.append(dict(t=h['market_built']['expires'], word='Market &middot; judge', kind='market', cur=(cur_tick == 'market'), tl='by '))
    merged: dict = {}
    for r in raw:
        m = merged.setdefault(r['t'], dict(t=r['t'], words=[], kinds=[], cur=False, tl=''))
        m['words'].append(r['word']); m['kinds'].append(r['kind']); m['cur'] = m['cur'] or r['cur']; m['tl'] = m['tl'] or r.get('tl', '')
    items = []
    for m in merged.values():
        kind = 'expected' if 'expected' in m['kinds'] or 'market' in m['kinds'] else ('arrived' if 'arrived' in m['kinds'] else 'plain')
        if offline and kind == 'expected':
            kind = 'expected dash'
        word = ' &middot; '.join(m['words'])
        label = f'<b>{m["tl"]}{m["t"]}</b> {word}'
        plain = f'{m["tl"]}{m["t"]} {word}'.replace('&middot;', '·').replace('&#8217;', "'").replace('&amp;', '&')
        items.append(dict(t=m['t'], label=label, plain=plain, kind=kind, cur=m['cur'], said=False))
    return items


def _dl_track(h: dict, *, trackpx: float, state='ready', offline=False, staff=False, market='unbuilt', cur_tick=None,
              said=None, maxw=None, band_words=True, unset=False, partial=False) -> tuple[str, int]:
    """The track: bands, marks, now and labels. Returns (html, rows) so the caller can size it."""
    hrs = h['hours']
    wall = '14:41' if offline else h['now']
    items = [] if state == 'reading' else _day_items(h, offline=offline, staff=staff, market=market, cur_tick=cur_tick, partial=partial)
    extra = [it['t'] for it in items] + [wall]
    # `hours` rides inside the same GET /house/day payload as the registers (README's shape), so while
    # still reading, the bands cannot be drawn from it either — the window falls back to now alone, same
    # as the unset case.
    start, end = _window(h, extra, use_hours=(not unset and state != 'reading'))

    def p(t: str) -> float:
        return (_abs(h, t) - start) / (end - start) * 100

    now_item = dict(t=wall, label=(f'{wall} &middot; offline' if offline else f'now {wall}'), plain=(f'{wall} · offline' if offline else f'now {wall}'), kind='now', cur=False)
    allitems = [now_item] + items
    for it in allitems:
        it['x'] = p(it['t'])
    rows = _layout(allitems, trackpx, maxw=maxw)
    # bands
    if state == 'reading':
        # The hours have not answered yet either (they are part of the same GET /house/day read) —
        # drawing Prep/Doors/Close now would be the bands' own absence-as-health bug.
        bands = '<div class="dl__line"></div>'
    elif unset:
        bands = ('<div class="dl__line"></div>'
                 '<span class="dl__lbl l dl__lbl--unset" style="left:0">Hours not set &mdash; no prep, doors or close today<button class="link">Set the hours</button></span>')
    else:
        bw = '' if band_words else ' short'
        bands = (f'<div class="dl__line"></div>'
                 f'<div class="dl__band" style="left:{p(hrs["prep"])}%;width:{p(hrs["doors"]) - p(hrs["prep"])}%"></div>'
                 f'<div class="dl__band dl__band--service" style="left:{p(hrs["doors"])}%;width:{p(hrs["close"]) - p(hrs["doors"])}%"></div>'
                 f'<span class="dl__lbl l{bw}" style="left:{p(hrs["prep"])}%">Prep{" " + hrs["prep"] if band_words else ""}</span>'
                 f'<span class="dl__lbl{bw}" style="left:{p(hrs["doors"])}%">Doors{" " + hrs["doors"] if band_words else ""}</span>'
                 f'<span class="dl__lbl r{bw}" style="left:{p(hrs["close"])}%">Close{" " + hrs["close"] if band_words else ""}</span>')
    ticks = ''
    for it in items:
        cur = ' cur' if it['cur'] else ''
        ticks += (f'<div class="dl__tick {it["kind"]}{cur}" style="left:{it["x"]:.2f}%"><span class="m"></span>'
                  f'<span class="w {it["align"]}" style="top:{25 + it["row"] * 12}px">{it["label"]}</span></div>')
    for eb, at, txt, sub in (said or []):
        ticks += f'<div class="dl__tick said" style="left:{p(at):.2f}%"><span class="m"></span></div>'
    gap = ''
    if offline:
        gap = f'<div class="dl__gap" style="left:{p("14:02"):.2f}%;width:{p(wall) - p("14:02"):.2f}%"></div>'
    nowcls = ' hollow' if (state == 'reading' or offline) else ''
    now = (f'<div class="dl__now{nowcls}" style="left:{now_item["x"]:.2f}%"><span class="m"></span>'
           f'<span class="w {now_item["align"]}" style="top:{25 + now_item["row"] * 12}px">{now_item["label"]}</span></div>')
    height = 25 + rows * 12 + 2
    html = f'<div class="dl__track" style="height:{height}px">{bands}{ticks}{gap}{now}</div>'
    return html, rows


def _day_head(*, staff=False, market='unbuilt') -> str:
    """The day line's six registers, in the Tick table's own order: delivery-expected
    (no source today — a new capability, see README Costs), delivery-arrived (GET /procurement/receiving/unverified),
    calendar (GET /calendar/today), shifts (GET /restaurants/:id/team/week|my-week), reminders
    (the same calendar/today read, no gate of its own — calendar.controller.ts:52-53 is JwtAuthGuard
    only and getTodayEvents at :582-591 applies no role filter, so it is answered for every role) and
    market (GET /house/market-actions — owner/manager, refused for staff; unbuilt otherwise). Reuses
    counter_head's rule so E never masks the unbuilt or refused register the way D's first-round bug did.
    """
    mkt = 'refused' if staff else ('answered' if market == 'built' else 'unbuilt')
    return counter_head(['answered', 'answered', 'answered', 'answered', 'answered', mkt])


def dayline(h: dict, *, state='ready', cur_tick=None, offline=False, log_n=None, unset=False, market='unbuilt',
            partial=False, staff=False, said=None, moment=None) -> str:
    n = log_n if log_n is not None else len(h['log'])
    if unset:
        # the fixed points still draw, on a bandless rule; the sentence sits where the bands' words would (frame 05, left)
        track, rows = _dl_track(h, trackpx=840, unset=True)
        head = _day_head(staff=staff, market=market)
        right = f'<div class="dl__right"><div class="dl__read">read {h["clock"]} &middot; {head}<br>hours: not set &middot; again in 60 s &middot; on focus</div><button class="dl__log" aria-label="What the house said this session"><span class="hair" style="width:8px"></span>+{n}</button><button class="dl__ask">Ask {wordmark(13)}<kbd class="kbd">&#8984;&#8679;K</kbd></button></div>'
        return f'<div class="dl" aria-label="The day"><div class="dl__today"><span class="sect">Today</span><b>{h["date"]}</b></div>{track}{right}</div>'
    track, rows = _dl_track(h, trackpx=840, state=state, offline=offline, staff=staff, market=market, cur_tick=cur_tick, said=said, partial=partial)
    # the read and its cadence: `again in 60 s · on focus` only after a read that succeeded; `will read on return` offline; nothing while reading
    if state == 'reading':
        readtxt, cadence = 'reading the day &middot; 0.8 s', ''
    elif offline:
        readtxt, cadence = 'from 14:01:48 &middot; offline', 'will read on return'
    elif partial:
        # calendar and shifts did not answer; reminders rides the same calendar read, so it has not
        # either — the market register is unaffected and keeps its own state.
        mkt = 'refused' if staff else ('answered' if market == 'built' else 'unbuilt')
        outcomes = ['answered', 'answered', 'notread', 'notread', 'notread', mkt]
        readtxt, cadence = f'read {h["clock"]} &middot; <span style="color:#d9a35e">{counter_head(outcomes)}</span>', 'again in 60 s &middot; on focus'
    else:
        readtxt, cadence = f'read {h["clock"]} &middot; {_day_head(staff=staff, market=market)}', 'again in 60 s &middot; on focus'
    mom = ''
    if moment:
        # the moment docks in flow under the line, at the now mark's x; it never overlaps the page's first block
        start, end = _window(h, [d['t'] for d in h['deliveries'] if d['t'] != '&mdash;'] + [e['t'] for e in h['events']] + [sh['t'] for sh in h['shifts']] + ([h['count']['t']] if h['count'] else []))
        nowpx = 160 + (_abs(h, h['now']) - start) / (end - start) * 840
        mom = f'<div class="dl__momentrow"><div class="dl__moment" style="margin-left:{nowpx - 14:.0f}px">{toast(h, moment)}</div></div>'
    right = (f'<div class="dl__right"><div class="dl__read">{readtxt}{("<br>" + cadence) if cadence else ""}</div>'
             f'<button class="dl__log" aria-label="What the house said this session"><span class="hair" style="width:8px"></span>+{n}</button>'
             f'<button class="dl__ask">Ask {wordmark(13)}<kbd class="kbd">&#8984;&#8679;K</kbd></button></div>')
    return f'<div class="dl{" dl--moment" if moment else ""}" aria-label="The day"><div class="dl__today"><span class="sect">Today</span><b>{h["date"]}</b></div>{track}{right}</div>{mom}'



def tick_pop(h: dict, left: int, top: int, kind='delivery') -> str:
    if kind == 'market':
        m = h['market_built']
        return f"""
<div class="pop" role="dialog" aria-label="Market action" style="left:{left}px;top:{top}px">
  <div class="pop__eyebrow">Judge &middot; market action &middot; holds until 18:00</div>
  <div class="pop__title">{m['what']} is {m['move']} under its 30-day mean</div>
  <div class="row"><div class="row__txt">Kermit Lynch quote, 2026-09-16<div class="row__sub">class A &middot; per 750 ml &middot; {m['n']} &middot; the mean excludes the newest</div></div><span class="row__at"><b>{m['figure']}</b>mean {m['mean']}</span></div>
  <div class="row"><div class="row__txt">This house<div class="row__sub">14 in the cellar &middot; par 12 &middot; 9 days of cover</div></div></div>
  <div class="quiet" style="font-size:11px;margin-top:8px">No saving is stated: pass-through to this house has not been measured. A draft is a draft &mdash; it waits on the seal in Orders.</div>
  <div class="pop__foot"><button class="link">Draft an order</button><span>read {h['clock']} &middot; holds until 18:00</span></div>
</div>"""
    d = h['deliveries'][1]
    return f"""
<div class="pop" role="dialog" aria-label="Expected delivery" style="left:{left}px;top:{top}px">
  <div class="pop__eyebrow">Expected &middot; the door &middot; by {d['t']}</div>
  <div class="pop__title">{d['who']}</div>
  <div class="row"><div class="row__txt">12 lines &middot; $3,880.00<div class="row__sub">seal 7f3a, 2026-09-15 &middot; the vendor confirmed 2026-09-15 09:02</div></div></div>
  <div class="row"><div class="row__txt">Not yet received<div class="row__sub">the window is the vendor&#8217;s word; the house has no truck signal</div></div><span class="row__at">{h['clock']}</span></div>
  <div class="pop__foot"><button class="link">Open at the door</button><span>read {h['clock']}</span></div>
</div>"""


def rooms_pop(h: dict, left: int, top: int, *, staff=False, market='unbuilt') -> str:
    cols = ''
    for g, rooms in ROOMS:
        items = ''
        for r, path in rooms:
            extra = ''
            if r == 'Vendor prices':
                if staff:
                    extra = '<span class="item__meta">refused</span>'
                elif market == 'built':
                    extra = '<span class="item__meta"><span class="dot"></span> 1 to judge</span>'
                else:
                    extra = '<span class="item__meta"><span class="ring"></span> market not built</span>'
            if r == 'Vendor prices':
                sub = extra.replace('class="item__meta"', 'class="item__meta" style="margin-left:0;padding-left:0;font-size:9.5px"')
                items += f'<div class="item" style="{"color:var(--ink-3);" if staff else ""}align-items:flex-start;flex-direction:column;gap:2px">{r}{sub}</div>'
            else:
                items += f'<div class="item{" cur" if r == "Orders" else ""}">{r}{extra}</div>'
        cols += f'<div><span class="sect">{g}</span>{items}</div>'
    foot = ''.join(f'<div class="item">{r}</div>' for r, _, need in FOOT if not (need == 'manager' and staff) and not (need == 'owner' and h['role'] != 'Owner'))
    return f"""
<div class="pop rooms" role="dialog" aria-label="The rooms" style="left:{left}px;top:{top}px">
  <div class="rooms__grid">{cols}<div><span class="sect">Mudavym</span><div class="item">Ask {wordmark(13)}<kbd class="kbd">&#8984;&#8679;K</kbd></div><div class="item" style="color:var(--ink-3)">/sommelier redirects here</div></div></div>
  <div class="rooms__foot">{foot}<span class="quiet" style="margin-left:auto;font-size:11px">G then a letter jumps to a room &middot; &#8984;K searches</span></div>
</div>"""


def log_pop(h: dict, left: int, top: int) -> str:
    rows = ''
    for eb, at, txt, sub in h['log']:
        w = ' w' if eb == 'WRITTEN HERE' else ''
        undo = '<button class="link" style="font-size:11px">Undo</button>' if eb == 'DISMISSED' else ''
        rows += f'<div class="said"><div class="said__eb{w}"><span>{eb}</span><span class="at">{at}</span></div><div class="said__txt">{txt}</div><div class="said__sub">{sub}</div>{undo}</div>'
    return f"""
<div class="pop" role="dialog" aria-label="What the house said" style="left:{left}px;top:{top}px;width:380px">
  <div class="pop__eyebrow">This session &middot; {len(h['log'])} entries &middot; newest first</div>
  <div class="pop__title">What the house said</div>
  {rows}
  <div class="pop__foot"><span>The bell&#8217;s book is the house&#8217;s record; this is yours.</span></div>
</div>"""


def frame_e(h: dict, page_html: str, page_name: str, *, badge='n', overlays='', loading=False, offline_n=0,
            dl: str | None = None, cls='', ground=None, rooms_open=False, bell_open=False, user_open=False) -> str:
    g = f' data-ground="{ground}"' if ground else ''
    off = offstrip(h, offline_n, 'the day') if offline_n else ''
    d = dl if dl is not None else dayline(h)
    return f"""
<div class="mudavym frame {cls}"{g}>
  {header(h, page_name, badge=badge, loading=loading, rooms_trigger=True, rooms_open=rooms_open, bell_open=bell_open, user_open=user_open)}
  {d}
  {off}
  <div class="body"><main class="pg">{page_html}</main></div>
  {overlays}
</div>"""


# ─────────────────────────────────────────────────────────────────────────────
# Phones
# ─────────────────────────────────────────────────────────────────────────────
def phone_page(h: dict, kind='orders') -> str:
    if kind == 'orders':
        rows = ''.join(f'<div class="row"><div class="row__txt">{o["vendor"]}<div class="row__sub">{o["lines"]} &middot; awaiting seal</div></div><span class="row__at"><b>{o["total"]}</b>{o["at"]}</span></div>' for o in h['orders'])
        return f"""<div style="padding:18px 16px 90px">{wordmark(12)}<h1 class="pg__sentence" style="font-size:22px;max-width:none">{h['sentence']}</h1>
<div class="pg__eyebrow">{h['date']} &middot; read {h['clock']}</div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px;border-top:1px solid var(--paper-2);padding-top:14px">
  <div><div class="kpi__n" style="font-size:22px">{h['kpi'][0][0]}</div><div class="kpi__l">{h['kpi'][0][1]}</div></div>
  <div><div class="kpi__n" style="font-size:22px">{h['kpi'][1][0]}</div><div class="kpi__l">{h['kpi'][1][1]}</div></div>
  <div><div class="kpi__n" style="font-size:22px">{h['kpi'][4][0]}</div><div class="kpi__l">{h['kpi'][4][1]}</div></div>
</div><div style="margin-top:12px">{rows}</div></div>"""
    if kind == 'receiving':
        rows = ''.join(f'<div class="row"><div class="row__txt">{d["who"]}<div class="row__sub">{d["txt"]}</div></div><span class="row__at"><b>{d["t"]}</b></span></div>' for d in h['deliveries'])
        return f"""<div style="padding:18px 16px 90px">{wordmark(12)}<h1 class="pg__sentence" style="font-size:22px;max-width:none">{h['sentence']}</h1>
<div class="pg__eyebrow">{h['date']} &middot; read {h['clock']}</div><div style="margin-top:14px">{rows}</div></div>"""
    return ''


def phone_tabbar_d(cur: str, dot=True) -> str:
    tabs = [('counter', 'Counter', ico('counter', 20)), ('rooms', 'Rooms', ico('rooms', 20)), ('search', 'Search', ico('search', 20)), ('ask', 'Ask Mudavym', ico('ask', 20))]
    out = ''
    for k, l, i in tabs:
        d = '<span class="dot"></span>' if (k == 'counter' and dot) else ''
        out += f'<button class="tab{" cur" if k == cur else ""}">{i}{l}{d}</button>'
    return f'<nav class="tabbar" aria-label="Shell">{out}</nav>'


def phone_tabbar_e(cur: str) -> str:
    tabs = [('floor', 'Floor', ico('floor', 20)), ('door', 'Door', ico('door', 20)), ('cellar', 'Cellar', ico('cellar', 20)), ('books', 'Books', ico('books', 20)), ('more', 'More', ico('more', 20))]
    return '<nav class="tabbar" aria-label="Books">' + ''.join(f'<button class="tab{" cur" if k == cur else ""}">{i}{l}</button>' for k, l, i in tabs) + '</nav>'


def phone_header(h: dict, page: str, *, badge='n', rooms_trigger=False, menu=False) -> str:
    return header(h, page, badge=badge, narrow=True, menu=menu, rooms_trigger=rooms_trigger)


def phone(h: dict, inner: str, *, cls='narrow') -> str:
    return f'<div class="fit" data-fit="390"><div class="mudavym phone {cls}">{inner}</div></div>'


def phone_counter_sheet(h: dict) -> str:
    """The counter at a mid detent: every register, the first act of each, sized to its content (tuck 300);
    the page stays visible above it and the four doors under it. The head follows the desktop's rule."""
    secs: list[str] = []
    outcomes: list[str] = []

    def more(n: int, word: str, plural: str | None = None) -> str:
        w = word if n == 1 or plural is None else plural
        return f'<div class="quiet" style="font-size:11px;padding:0 0 6px 68px">{n} more {w} on the counter</div>' if n > 0 else ''

    o = h['orders'][0]
    secs.append(act('Seal', f'{o["vendor"]} &mdash; {o["total"]}', o['basis_txt'], o['at']) + more(len(h['orders']) - 1, 'order', 'orders')); outcomes.append('answered')
    v = h['verify'][0]
    secs.append(act('Verify', v['what'], v['detail'], v['at']) + more(len(h['verify']) - 1, 'receipt', 'receipts')); outcomes.append('answered')
    r = h['reply'][0]
    secs.append(act('Reply', r['who'], r['detail'], r['at']) + more(len(h['reply']) - 1, 'waiting')); outcomes.append('answered')
    d = h['decide'][0]
    secs.append(act('Decide', d['what'], d['detail'], d['at']) + more(len(h['decide']) - 1, 'to decide')); outcomes.append('answered')
    p = h['proposed'][0]
    secs.append(act('Proposed', p['what'], p['detail'], p['at'])); outcomes.append('answered')
    secs.append('<div class="act act--dash"><span class="act__verb quiet">Judge</span><div class="act__main"><div class="act__what">Market &middot; not built</div><div class="act__detail">the signals exist; nothing turns one into an act here</div></div><span class="ring" style="margin-top:6px"></span></div>'); outcomes.append('unbuilt')
    return f"""<div class="bsheet" style="bottom:70px;max-height:640px;overflow:auto"><div class="bsheet__grip"></div>
<div style="display:flex;align-items:baseline"><span class="sect">On the counter</span><span class="counter__read" style="margin-left:auto">{counter_head(outcomes)}</span></div>
<div style="padding:4px 0">{''.join(secs)}</div>
<div class="counter__foot" style="padding:10px 0 0;margin-top:6px">read {h['clock']} &middot; again in 60 s<button class="link">Read now</button></div></div>"""


def phone_seal_sheet(h: dict) -> str:
    o = h['orders'][0]
    return f"""<div class="bsheet" style="bottom:70px;max-height:640px;overflow:auto"><div class="bsheet__grip"></div>
<span class="eyebrow">Seal &middot; order &middot; drafted by {o['by']} {o['at']}</span><h2 class="sheet__title" style="font-size:19px">Order to {o['vendor']}</h2>
<div style="display:flex;gap:18px;margin:10px 0"><div><span class="sect">Total</span><div class="mono" style="font-size:20px">{o['total']}</div></div><div><span class="sect">Lines</span><div class="mono" style="font-size:20px">12</div></div><div><span class="sect">Rests on</span><div style="margin-top:4px"><span class="chip">AGREED</span></div></div></div>
<div class="row"><div class="row__txt">Chablis Vaillons 2023<div class="row__sub">agreed &middot; 6 &times; $27.40</div></div></div>
<div class="row"><div class="row__txt">Sancerre, Domaine Vacheron 2024<div class="row__sub">agreed &middot; 12 &times; $24.10</div></div></div>
<div class="row"><div class="row__txt quiet">10 more lines<div class="row__sub">7 agreed &middot; 3 last invoice</div></div></div>
<div class="quiet" style="font-size:11.5px;margin:10px 0 12px">Sealing sends this order by email and writes the seal to the ledger. You are still on Orders.</div>
<div class="hold"><div class="hold__fill" style="width:40%"></div><span>Hold to seal</span></div></div>"""


def phone_more_sheet(h: dict, staff=False) -> str:
    foot = ''.join(f'<div class="item">{r}</div>' for r, _, need in FOOT if not (need == 'manager' and staff) and not (need == 'owner' and h['role'] != 'Owner'))
    return f"""<div class="bsheet"><div class="bsheet__grip"></div><span class="sect">The house</span>{foot}<span class="sect" style="margin-top:8px">Mudavym</span><div class="item">Ask {wordmark(13)}<span class="item__meta">/ask</span></div><div class="item" style="color:var(--ink-3)">Notifications<span class="item__meta">{h['unread']} unread</span></div></div>"""


def phone_rooms_sheet(h: dict, staff=False, cur_room='Orders') -> str:
    # Fork 8: hide only gateway-refused rooms. Receipts & Credits is what D's own staff counter draws
    # refused (a real gate is this direction's cost, drawn as if it existed); Vendor prices' registers
    # (vendor-intel's below-average route, price-index, commodity-index) are genuinely owner/manager
    # (RolesGuard, vendor-intel.controller.ts:36-39). Both are dropped from the staff sheet to match.
    hidden = {'Receipts &amp; Credits', 'Vendor prices'} if staff else set()
    groups = ''
    for g, rooms in ROOMS:
        shown = [(r, path) for r, path in rooms if r not in hidden]
        if not shown:
            continue
        groups += f'<span class="sect" style="padding:10px 0 4px">{g}</span>' + ''.join(f'<div class="item{" cur" if r == cur_room else ""}">{r}</div>' for r, _ in shown)
    foot = ''.join(f'<div class="item">{r}</div>' for r, _, need in FOOT if not (need == 'manager' and staff) and not (need == 'owner' and h['role'] != 'Owner'))
    return f"""<div class="lsheet"><div style="padding:14px 16px;border-bottom:1px solid var(--paper-2)"><div style="font-size:13px;font-weight:500">{h['name']}</div><div class="quiet" style="font-size:11.5px">{h['person']} &middot; {h['role']}</div></div><div style="padding:4px 16px 16px">{groups}<div class="ruled" style="margin-top:10px">{foot}</div></div></div>"""


def phone_dayline(h: dict, *, offline=False) -> str:
    track, rows = _dl_track(h, trackpx=290, offline=offline, maxw=76, band_words=False)
    return f'<div class="dl" style="padding:0 14px;gap:10px;height:auto;min-height:0;padding-top:6px;padding-bottom:6px"><div class="dl__track" style="display:contents">{track}</div><div class="dl__right" style="margin:0"><button class="dl__log">+{len(h["log"])}</button></div></div>'


# ─────────────────────────────────────────────────────────────────────────────
# Direction D — the document
# ─────────────────────────────────────────────────────────────────────────────
def build_d() -> str:
    us, tr = US, TR
    html = """
<div class="sk-band">
  <h1>Sketch 119 &middot; Direction D &mdash; The counter</h1>
  <p class="sk-sub">The work comes to the person. The rooms stay a quiet rail of words (sketch 106 A&#8217;s grammar, the built header reused, the theme menu retired, the floating agent removed); the new organ is <b>the counter</b> &mdash; a right-hand column that stays across every page and holds the acts waiting on <i>this</i> person, grouped by verb: Seal &middot; Verify &middot; Reply &middot; Decide &middot; Judge &middot; Mudavym proposes. Each act opens as a side sheet <i>over the page you are on</i>, with the seal inside it, so an owner clears a morning without leaving Orders and a floor manager sees what waits without leaving Receiving. Counts appear only as the section eyebrows print them &mdash; a register that did not answer is a hollow ring, a register the role may not read says <i>refused</i>, and an unbuilt register says <i>not built</i>. One read: <span class="mono" style="font-size:12px">GET /house/counter</span>, per-register outcomes. Toasts land at the counter&#8217;s head and fold into <i>The house said</i>, the session&#8217;s own log. Warm charcoal is the ground (ADR 0138).</p>
</div>"""
    # 01 owner, orders, counter open, toast at the head
    html += label('01 &middot; owner &middot; Larkspur &amp; Vine, Oakland &middot; en-US &middot; USD &middot; 1440 &middot; rail expanded, the counter open, a dismissal landed at its head',
                  'Every act names its register: seal (GET /procurement/orders/pending), verify (GET /procurement/receiving/unverified + /procurement/credits), reply (GET /conversations/pending/list, scoped), decide (GET /restaurants/:id/invites, GET /vendor-intel/identity/candidates), proposed (GET /ask-ai/actions), judge (GET /house/market-actions, placeholder). The eyebrow says how many registers answered, never a sum.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us, toast_kind='dismissed')))
    # 02 the seal in place
    html += label('02 &middot; owner &middot; the Seal act opened in place &mdash; a side sheet (ADR 0112, 440, tuck) over Orders; the counter marks the row open',
                  'The seal is HoldToApprove inside the sheet (pour, 620 ms, linear). The page under it does not navigate; closing the sheet lands back on Orders exactly as it was.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us, opened='seal'),
                             overlays='<div class="scrim"></div>' + sheet_seal(us), cls='frame--fixed'))
    # 03 staff TR, rail tucked, refused + partial
    html += label('03 &middot; staff &middot; Sim Meyhouse, Kadıköy &middot; tr-TR &middot; TRY &middot; 1440 &middot; the rooms tucked to a strip, the counter for a floor staff member',
                  'Decide splits into two registers here, so seven are rendered and the head reads 4 of 7 registers &middot; 3 refused &mdash; never n of n when a register refused or was not shown. Answered: Seal (the house&#8217;s count, not her act), Reply, Identities (vendor-intel.controller.ts:460-461 and :489-490 carry a handler-level owner/manager/staff role on the queue and its decide route, overriding the controller&#8217;s own owner/manager default &mdash; roles.guard.ts:12-14 reads the handler first &mdash; because, in the controller&#8217;s words, only &ldquo;the ones holding the bottles&rdquo; can answer it: yours to decide, not refused), and Mudavym proposes (readable by every member, ask-ai.controller.ts:76 and :124; confirming is owner/manager, :152 &mdash; not hers to confirm). Refused in words: receipts, invitations and the market &mdash; invitations are owner/manager (members.controller.ts:28, :45 carries only JwtAuthGuard, but getInvites calls assertMembership(&hellip;,&#8216;owner|manager&#8217;) at members.service.ts:129, which throws for staff at :60-62); the market&#8217;s sources (vendor-intel&#8217;s below-average route, price-index, commodity-index) are owner/manager (RolesGuard, vendor-intel.controller.ts:36-39); credits.controller.ts and receiving.controller.ts:228-229,347 both carry only JwtAuthGuard, so a real staff gate on receipts is this direction&#8217;s cost, drawn as if it existed.')
    html += fitframe(frame_d(tr, page_receiving(tr), 'Receiving', active='Receiving', badge='n', rail_tucked=True, staff=True,
                             counter_html=counter(tr, staff=True)))
    # 04 partial + reading + empty, three counters side by side (short frames)
    html += label('04 &middot; the counter&#8217;s own states &mdash; partial (two registers did not answer), still reading, and empty',
                  'Partial prints what answered and a hollow ring with the failure per register, never a zero &mdash; the head now also names the market&#8217;s own unbuilt register rather than folding it into the count (3 of 6 registers &middot; 1 not built &middot; 2 not read). Reading is a static hairline, not the ring, and the foot does not promise a read that has not landed. Empty is a sentence with the read time: five of six registers answered and nothing waits; the market stays unbuilt, never counted as answered.')
    html += '<div class="sk-row">'
    for st, kw in (('partial', dict(partial=True, with_said=False)), ('reading', dict(state='reading', with_said=False)), ('empty', dict(state='empty', with_said=False))):
        inner = counter(us, **kw).replace('<aside class="counter', '<aside style="width:328px;border-left:0" class="counter', 1)
        html += (f'<div class="fit" data-fit="330"><div class="mudavym frame frame--short" style="width:330px;min-height:0;display:block">'
                 f'{inner}</div></div>')
    html += '</div>'
    # 05 palette open
    html += label('05 &middot; owner &middot; the command entry open (&#8984;K) &mdash; the house Panel (620, settle), reading the same rooms table as the rail and the counter',
                  'Sections: On the counter &middot; Rooms &middot; Records &middot; Ask Mudavym. The last row is the second door to the assistant (&#8984;&#8679;K) with the typed text carried across. Internal rooms (Studio, SimPOS, /dev/truth, /dev-sandbox) are not in the table and cannot be found here by a house.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us),
                             overlays='<div class="scrim"></div>' + palette(us, 'd'), cls='frame--fixed'))
    # 06 bell + user menu open (built), the distinction
    html += label('06 &middot; owner &middot; the bell open (built HouseBell, 350) beside the counter &mdash; the bell is news, the counter is acts; then the account menu (built HouseUserMenu, 274)',
                  'The bell keeps the built popover unchanged. A line in the bell can point at an act on the counter &mdash; a line under its timestamp (&rarr; Seal &middot; Kermit Lynch), the number printed once &mdash; but the two never share a number: 12 unread is not 8 acts. Profile lives in the account menu; the operator&#8217;s internal rooms do not appear in it.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us), bell_open=True,
                             overlays=bell_pop(us, 856, 50, points='counter'), cls='frame--fixed-short'))
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us),
                             overlays=user_pop(us, 1148, 50), cls='frame--fixed-short'))
    # 07 market action — today (unbuilt) and when built
    html += label('07 &middot; owner &middot; where a price or market action surfaces: the Judge section &mdash; today (not built, hollow) with its placeholder answer opened',
                  'GET /house/market-actions returns 501 until the quant lands; the sheet prints the refusal as a sentence and what the house can already read (below-average, the index line, the commodity register) in the house&#8217;s words. The 501 and 200 envelopes are drawn beside the frame, never in it &mdash; Maya reads the sentence, the build reads the shape. Nothing here is a zero.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us, opened='market'),
                             overlays='<div class="scrim"></div>' + sheet_market(us, False), cls='frame--fixed'))
    html += f'<div class="sk-row"><div class="fit" data-fit="640"><div class="mudavym" style="padding:18px;border:1px solid #b6ad9e;width:640px"><span class="sect">The placeholder answer, until the quant lands &mdash; beside the frame, never in it</span><div class="mkt" style="margin-top:8px">{market_json(False)}</div></div></div><div class="fit" data-fit="640"><div class="mudavym" style="padding:18px;border:1px solid #b6ad9e;width:640px"><span class="sect">The same register, when built</span><div class="mkt" style="margin-top:8px">{market_json(True)}</div></div></div></div>'
    html += '<div class="sk-note">The envelopes are the build&#8217;s reading, drawn as annotation. Nothing inside a frame prints an HTTP code, a REST path or a decision number; the spec is in the README.</div>'
    html += label('08 &middot; owner &middot; the same act when the register is built &mdash; a judged action with its signal, its class, what is not known, and a draft that is only a draft',
                  'The action opens a one-tap order draft (commodity-signals-plan §9e); the seal stays in Orders. Confidence and the unmeasured pass-through are printed, not implied.')
    html += fitframe(frame_d(us, page_orders(us), 'Orders', active='Orders', counter_html=counter(us, market='built', opened='market'),
                             overlays='<div class="scrim"></div>' + sheet_market(us, True), cls='frame--fixed'))
    # 09 toasts, five states
    html += label('09 &middot; the toast &mdash; five states on charcoal, docked at the counter&#8217;s head; one on the declared paper ground',
                  'Eyebrow (what the house did &middot; when) &middot; one sentence &middot; what is not claimed &middot; Undo or Open &middot; a drain (8 s, pauses on hover and focus, &#8984;Z only where F10 allows). Written-here is dashed and carries no Undo and no &ldquo;saved&rdquo;. Refused changes nothing and says so. A draft is not sent.')
    html += '<div class="sk-row" style="align-items:stretch">'
    for k in ('dismissed', 'written', 'sealed', 'refused', 'draft'):
        html += f'<div class="mudavym" style="padding:18px;border:1px solid #b6ad9e">{toast(us, k)}</div>'
    html += f'<div class="mudavym" data-ground="paper" style="padding:18px;border:1px solid #b6ad9e">{toast(us, "draft")}</div>'
    html += '</div><div class="sk-note">The paper cell is a real case, not a demo: the shell renders over /documents/:id, which is paper by decision (ADR 0104 D9). Its captions use --ink-4 (5.64:1), never --ink-3.</div>'
    # 10 the shell on paper — over the canonical document
    html += label('10 &middot; owner &middot; the whole shell over the one declared paper page (/documents/:id) &mdash; the header, the rail and the counter take the paper column with it',
                  'PageGate hands the header the ground it measured; the rail and the counter sit under the same .mudavym[data-ground="paper"] root. Nothing is restyled by hand.')
    html += fitframe(frame_d(us, page_document(us), 'Document', active='Documents &amp; Reports', counter_html=counter(us), ground='paper', cls='frame--fixed-short'))
    # 11 loader ladder
    html += label('11 &middot; the loader ladder &mdash; 0&ndash;400 ms nothing but the hairline; 400 ms&ndash;3 s the page&#8217;s own skeleton; after 3 s a mono line; at 12 s a sentence and two acts',
                  'The counter shows the static reading mark while it reads and never a ring; the ring is for a read that failed. Never a spinner, never a fake row.')
    html += fitframe(frame_d(us, page_skeleton(with_mono=True), 'Orders', active='Orders', counter_html=counter(us, state='reading', with_said=False), loading=True, cls='frame--fixed-short', badge='hollow'))
    html += fitframe(frame_d(us, page_skeleton(twelve=True), 'Orders', active='Orders', counter_html=counter(us, state='reading', with_said=False), loading=True, cls='frame--fixed-short', badge='hollow'))
    # 12 offline
    html += label('12 &middot; owner &middot; offline since 14:02:11 &mdash; the strip under the header, the counter frozen and dated, the queue as a held row at its head, the ladder opened',
                  'Every queued record stays on rung 1 of 4 (written here &middot; sent &middot; received &middot; sealed by the house) until the house answers &mdash; the ADR 0140 door outbox, generalised. A seal is never queued. The counts on the page are from the last answer and say so.')
    html += fitframe(frame_d(us, page_orders({**us, 'clock': '14:01:48'}), 'Orders', active='Orders', counter_html=counter(us, offline=True), offline_n=3, badge='hollow',
                             overlays=ladder_pop(us, 780, 88), cls='frame--fixed'))
    # 13 failure + stale chunk
    html += label('13 &middot; owner &middot; the room failed to draw &mdash; the boundary sits under the shell, so the rooms, the counter, the bell and the search survive; and the stale-chunk reload',
                  'A second ErrorBoundary around the outlet inside the layout; the outer one at App.tsx:160 stays for the shell itself. The readings are copyable; the address is support@mudavym.com (ADR 0143).')
    html += fitframe(frame_d(us, page_fail(us), 'Orders', active='Orders', counter_html=counter(us, with_said=False), cls='frame--fixed-short'))
    html += fitframe(frame_d(us, page_fail(us, stale=True), 'Orders', active='Orders', counter_html=counter(us, with_said=False), cls='frame--fixed-short'))
    # 14 404
    html += label('14 &middot; owner &middot; a real 404 at the catch-all &mdash; the address kept, the nearest room by edit distance over the rooms table, the rooms listed, /sommelier redirects into /ask',
                  'No status-code claim is printed: vercel.json rewrites every path to index.html (200). Refused is /no-access, a different door.')
    html += fitframe(frame_d(us, page_404(us), 'Not a room', active='', counter_html=counter(us, with_said=False), cls='frame--fixed'))
    # 15 phones
    html += label('15 &middot; 390 &middot; the phone &mdash; a bottom bar with four doors (Counter &middot; Rooms &middot; Search &middot; Ask Mudavym); the counter as a bottom sheet at a mid detent, sized to its content, the page above it and the four doors under it (F9); the seal in place, the same way; offline; the 404; the failure',
                  'The Counter tab carries a dot, never a sum. Ask Mudavym is a tab because &#8984;&#8679;K has no phone equivalent. The legacy mobile top bar is deleted; the house header is the only bar.')
    html += '<div class="sk-row">'
    html += phone(us, phone_header(us, 'Orders') + f'<div style="flex:1;overflow:auto">{phone_page(us)}</div>' + f'<div class="toaststack" style="left:12px;right:12px;bottom:76px">{toast(us, "dismissed")}</div>'.replace('width:320px', 'width:auto') + phone_tabbar_d('none'))
    html += phone(us, phone_header(us, 'Orders') + f'<div style="flex:1;overflow:auto">{phone_page(us)}</div>' + '<div class="scrim" style="bottom:70px"></div>' + phone_counter_sheet(us) + phone_tabbar_d('counter'))
    html += phone(us, phone_header(us, 'Orders') + f'<div style="flex:1;overflow:auto">{phone_page(us)}</div>' + '<div class="scrim" style="bottom:70px"></div>' + phone_seal_sheet(us) + phone_tabbar_d('counter'))
    html += '</div><div class="sk-row" style="margin-top:24px">'
    html += phone(tr, phone_header(tr, 'Receiving') + f'<div style="flex:1;overflow:auto">{phone_page(tr, "receiving")}</div>' + '<div class="scrim"></div>' + phone_rooms_sheet(tr, staff=True, cur_room='Receiving') + phone_tabbar_d('rooms'))
    off_phone = (phone_header(tr, 'Receiving', badge='hollow') + f'<div class="offstrip" style="padding:8px 12px;flex-wrap:wrap;gap:6px">{ico("wifi", 14)}<span>Offline since <span class="mono">14:02:11</span> &middot; <b>2 written here</b></span><button class="link" style="margin-left:auto">What is written here</button></div>'
                 + f'<div style="flex:1;overflow:auto">{phone_page({**tr, "clock": "14:01:48"}, "receiving")}</div>' + phone_tabbar_d('none'))
    html += phone(tr, off_phone)
    nf_phone = page_404(us).replace('class="nf__rooms"', 'class="nf__rooms" style="grid-template-columns:1fr 1fr"')
    html += phone(us, phone_header(us, 'Not a room') + f'<div style="flex:1;overflow:auto">{nf_phone}</div>' + phone_tabbar_d('none'))
    html += '</div><div class="sk-row" style="margin-top:24px">'
    html += phone(us, phone_header(us, 'Orders') + f'<div style="flex:1;overflow:auto">{page_fail(us)}</div>' + phone_tabbar_d('none'))
    html += phone(us, phone_header(us, 'Orders', badge='hollow') + f'<div style="flex:1;overflow:auto">{page_skeleton(twelve=True)}</div>' + phone_tabbar_d('none'))
    html += '</div>'
    html += """<div class="sk-foot">Sketch only. Example houses; no live data. The page under the chrome is a stand-in for the rebuilt /orders and /receiving and is not part of this sketch. Motion: ink 160 for chrome micro-states, tuck 300 for the sheet, settle 320 for the panel, pour 620 linear for the hold, stamp 360 for the wax; the drain is an 8 s linear hairline (the token names the curve, not the duration); the loading hairline and the skeleton sheen are stated exceptions and pause under prefers-reduced-motion. No emoji.</div>"""
    return doc('Sketch 119 · D — The counter', D_CSS, html)


# ─────────────────────────────────────────────────────────────────────────────
# Direction E — the document
# ─────────────────────────────────────────────────────────────────────────────
def build_e() -> str:
    us, tr = US, TR
    html = """
<div class="sk-band">
  <h1>Sketch 119 &middot; Direction E &mdash; The day</h1>
  <p class="sk-sub">The time comes to the person. No rail: the built header keeps line one, and the page&#8217;s name becomes the door to the rooms (an anchored popover, one click, letter chords). Line two is <b>the day line</b> &mdash; the house&#8217;s service arc for today, read from its own hours (<span class="mono" style="font-size:12px">restaurants.operating_hours</span>, ADR 0093 D1): Prep &middot; Doors &middot; Close as bands, <i>now</i> marked, and today&#8217;s fixed points as ticks that open to their records &mdash; a delivery expected by four, one that arrived and is ruled off, the rep&#8217;s tasting, the shift change, the count due at close. A floor manager at 15:40 sees <i>Kermit Lynch at the door by 16:00</i> on every page; the owner sees the same day at a glance. The page gets the width. Toasts are <b>moments</b>: they land at the now mark and stay on the line as a small mark, the day&#8217;s own log. One read: <span class="mono" style="font-size:12px">GET /house/day</span>, per-register outcomes. Warm charcoal is the ground (ADR 0138).</p>
</div>"""
    html += label('01 &middot; owner &middot; Larkspur &amp; Vine, Oakland &middot; en-US &middot; USD &middot; 1440 &middot; the day line under the header, five of six registers answered (the market unbuilt), a dismissal landing under the now mark &mdash; in flow, the page moved down for its 8 s',
                  'Six registers, in the order the read names them below: delivery-expected (no source today &mdash; a new cost, see README), delivery-arrived (GET /procurement/receiving/unverified, ruled off with the calendar&#8217;s double rule), calendar (GET /calendar/today, the tasting), shifts (GET /restaurants/:id/team/week, the shift change), reminders (the same calendar/today read, ungated &mdash; the count due) and market (GET /house/market-actions, unbuilt today, never folded into the ok count). Bands come from GET /restaurants/:id/operating-hours. The dashed Revel Wine order has no window and therefore no tick &mdash; missing is not a time.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, moment='dismissed')))
    html += label('02 &middot; owner &middot; a tick opened &mdash; the anchored popover (ADR 0112, 320, ink) names the record, its source and when it was read; Open goes to the door',
                  'The window is the vendor&#8217;s word and the popover says so. Nothing on the line claims a truck it cannot see.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, cur_tick='Kermit Lynch'), overlays=tick_pop(us, 812, 118), cls='frame--fixed-short'))
    html += label('03 &middot; owner &middot; the rooms, from the page&#8217;s name &mdash; five groups and the house, in one anchored popover; Vendor prices carries the market&#8217;s state in words',
                  'Same rooms table as the palette and the 404. Internal rooms never appear. /sommelier redirects here is printed under Mudavym (ADR 0145 fork 5).')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', rooms_open=True, overlays=rooms_pop(us, 88, 50), cls='frame--fixed'))
    html += label('04 &middot; staff &middot; Sim Meyhouse, Kadıköy &middot; tr-TR &middot; TRY &middot; 1440 &middot; a day that crosses midnight (Prep 15:00 &middot; Doors 18:00 &middot; Close 01:00); the read says 5 of 6 registers &middot; 1 refused',
                  'The market is the one refused register (GET /house/market-actions is owner/manager) &mdash; drawn the same way D draws Judge refused for staff. The count-due tick is absent for this house only because none is scheduled today, not a role gate: calendar.controller.ts carries only JwtAuthGuard and getTodayEvents applies no role filter, so reminders reads the same for every role. Efes is expected by 15:30 and Suvla is ruled off.')
    html += fitframe(frame_e(tr, page_receiving(tr), 'Receiving', dl=dayline(tr, staff=True)))
    html += label('05 &middot; the line&#8217;s own states &mdash; hours not set (the fixed points still draw on a bandless rule, the sentence where the bands&#8217; words would be); partial (calendar and shifts did not answer, and reminders with them since it rides the same calendar read: their ticks are absent, the read says 2 of 6 registers &middot; 1 not built &middot; 3 not read); still reading (the now mark hollow, no bands and no cadence promised &mdash; hours arrive on the same read as the registers)',
                  'Three short frames. A day with nothing written prints a sentence, never an empty track.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, unset=True), cls='frame--short'))
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, partial=True), cls='frame--short'))
    html += fitframe(frame_e(us, page_skeleton(with_mono=True), 'Orders', dl=dayline(us, state='reading', log_n=0), loading=True, badge='hollow', cls='frame--short'))
    html += label('06 &middot; owner &middot; the command entry open (&#8984;K) &mdash; the house Panel, with Today as its first section, then Rooms, Records, Ask Mudavym',
                  'The palette and the day line read one table. Internal tools are not in it.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', overlays='<div class="scrim"></div>' + palette(us, 'e'), cls='frame--fixed'))
    html += label('07 &middot; owner &middot; toasts as moments &mdash; the five states, each landing at the now mark; after 8 s a moment becomes a small mark on the line, and the +N at the right opens the day&#8217;s log',
                  'The bell&#8217;s book is the house&#8217;s record; the log is yours. Written-here is dashed and carries no Undo. Nothing floats over the work on a desktop: the moment docks in flow under the line and moves the page down for its 8 s (settle 320), so the page&#8217;s headline is never covered.')
    html += '<div class="sk-row" style="align-items:stretch">'
    for k in ('dismissed', 'written', 'sealed', 'refused', 'draft'):
        html += f'<div class="mudavym" style="padding:18px;border:1px solid #b6ad9e">{toast(us, k)}</div>'
    html += f'<div class="mudavym" data-ground="paper" style="padding:18px;border:1px solid #b6ad9e">{toast(us, "written")}</div>'
    html += '</div>'
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, said=us['log']), overlays=log_pop(us, 1000, 66), cls='frame--fixed-short'))
    html += label('08 &middot; owner &middot; the bell open (built HouseBell) over the day line &mdash; the bell is the house&#8217;s book; a line in it may point at a tick, the two never share a number',
                  'HouseBell and HouseUserMenu are reused unchanged. The pointer is a line under the timestamp (&rarr; on the line &middot; by 16:00); the number is printed once.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', bell_open=True, overlays=bell_pop(us, 1036, 50, points='line'), cls='frame--fixed-short'))
    html += label('09 &middot; owner &middot; where a price or market action surfaces &mdash; today: the rooms menu says <i>market not built</i> and the day&#8217;s log carries the refusal; when built: a tick at the hour the action stops holding (the quote&#8217;s close), opening to the judgement',
                  'A market action is not a time-of-day event, but it has an expiry &mdash; that is its honest place on a day line. Until GET /house/market-actions answers 200, no tick is drawn; the 501 is a sentence in the log, never a mark on the line.')
    html += fitframe(frame_e(us, page_orders(us), 'Orders', dl=dayline(us, market='built', cur_tick='market'), overlays=tick_pop(us, 1000, 118, kind='market'), cls='frame--fixed-short'))
    html += f'<div class="sk-row"><div class="fit" data-fit="640"><div class="mudavym" style="padding:18px;border:1px solid #b6ad9e;width:640px"><span class="sect">The placeholder answer, until the quant lands</span><div class="mkt" style="margin-top:8px">{market_json(False)}</div></div></div><div class="fit" data-fit="640"><div class="mudavym" style="padding:18px;border:1px solid #b6ad9e;width:640px"><span class="sect">The same register, when built</span><div class="mkt" style="margin-top:8px">{market_json(True)}</div></div></div></div>'
    html += label('10 &middot; owner &middot; the shell over the one declared paper page (/documents/:id) &mdash; the header and the day line take the paper column',
                  'Captions on paper are --ink-4. One cell, to prove the tokens hold on the exception.')
    html += fitframe(frame_e(us, page_document(us), 'Document', ground='paper', cls='frame--short'))
    html += label('11 &middot; the loader at 12 s &mdash; the now mark hollow, the line&#8217;s read says reading, the page says what it is waiting for and offers two acts',
                  'Before this: 0&ndash;400 ms nothing but the hairline; to 3 s the skeleton; after 3 s the mono line (frame 05, right).')
    html += fitframe(frame_e(us, page_skeleton(twelve=True), 'Orders', dl=dayline(us, state='reading', log_n=0), loading=True, badge='hollow', cls='frame--short'))
    html += label('12 &middot; owner &middot; offline since 14:02:11 &mdash; the line stops advancing: a hatched gap from the last answer to the wall clock, expected ticks dashed, the strip under the line, the ladder opened',
                  'The now mark is hollow and dated. Every written-here record stays on rung 1 of 4. A seal is never queued.')
    html += fitframe(frame_e(us, page_orders({**us, 'clock': '14:01:48'}), 'Orders', dl=dayline(us, offline=True), offline_n=3, badge='hollow', overlays=ladder_pop(us, 780, 156), cls='frame--fixed'))
    html += label('13 &middot; owner &middot; the room failed to draw &mdash; the boundary under the shell; the day line survives; and the stale-chunk reload',
                  'The readings are copyable; the address is support@mudavym.com.')
    html += fitframe(frame_e(us, page_fail(us), 'Orders', cls='frame--short'))
    html += fitframe(frame_e(us, page_fail(us, stale=True), 'Orders', cls='frame--short'))
    html += label('14 &middot; owner &middot; a real 404 &mdash; under the day line, the address kept, the nearest room, the rooms listed',
                  'No HTTP status is claimed. Refused is /no-access.')
    html += fitframe(frame_e(us, page_404(us), 'Not a room', cls='frame--short'))
    html += label('15 &middot; 390 &middot; the phone &mdash; the day line as the strip under the header (scrolls sideways, now centred), the books as a bottom tab bar (Floor &middot; Door &middot; Cellar &middot; Books &middot; More), a tick as a bottom sheet, More with Ask Mudavym, offline, the 404',
                  'Toasts are cards above the tab bar on a phone (the line has no room for a moment). More holds Settings, the two role-gated rooms, Help and Ask Mudavym &mdash; the phone&#8217;s only door to the assistant.')
    html += '<div class="sk-row">'
    html += phone(us, phone_header(us, 'Orders', rooms_trigger=True) + phone_dayline(us) + f'<div style="flex:1;overflow:auto">{phone_page(us)}</div>' + f'<div class="toaststack" style="left:12px;right:12px;bottom:76px">{toast(us, "dismissed")}</div>'.replace('width:320px', 'width:auto') + phone_tabbar_e('door'))
    tick_sheet = f"""<div class="bsheet"><div class="bsheet__grip"></div><span class="eyebrow">Expected &middot; the door &middot; by 16:00</span><h2 class="sheet__title" style="font-size:19px">Kermit Lynch</h2>
<div class="row"><div class="row__txt">12 lines &middot; $3,880.00<div class="row__sub">seal 7f3a &middot; the vendor confirmed 2026-09-15</div></div></div>
<div class="row"><div class="row__txt">Not yet received<div class="row__sub">the window is the vendor&#8217;s word</div></div><span class="row__at">{us['clock']}</span></div>
<div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn--seal">Open at the door</button><button class="btn">Close</button></div></div>"""
    html += phone(us, phone_header(us, 'Orders', rooms_trigger=True) + phone_dayline(us) + f'<div style="flex:1;overflow:auto">{phone_page(us)}</div>' + '<div class="scrim"></div>' + tick_sheet + phone_tabbar_e('door'))
    html += phone(tr, phone_header(tr, 'Receiving', rooms_trigger=True) + phone_dayline(tr) + f'<div style="flex:1;overflow:auto">{phone_page(tr, "receiving")}</div>' + '<div class="scrim"></div>' + phone_more_sheet(tr, staff=True) + phone_tabbar_e('more'))
    html += '</div><div class="sk-row" style="margin-top:24px">'
    off_phone = (phone_header(us, 'Orders', badge='hollow', rooms_trigger=True) + phone_dayline(us, offline=True)
                 + f'<div class="offstrip" style="padding:8px 12px;flex-wrap:wrap;gap:6px">{ico("wifi", 14)}<span>Offline since <span class="mono">14:02:11</span> &middot; <b>3 written here</b></span><button class="link" style="margin-left:auto">What is written here</button></div>'
                 + f'<div style="flex:1;overflow:auto">{phone_page({**us, "clock": "14:01:48"})}</div>' + phone_tabbar_e('door'))
    html += phone(us, off_phone)
    nf_phone = page_404(us).replace('class="nf__rooms"', 'class="nf__rooms" style="grid-template-columns:1fr 1fr"')
    html += phone(us, phone_header(us, 'Not a room', rooms_trigger=True) + phone_dayline(us) + f'<div style="flex:1;overflow:auto">{nf_phone}</div>' + phone_tabbar_e('none'))
    html += phone(us, phone_header(us, 'Orders', rooms_trigger=True) + phone_dayline(us) + f'<div style="flex:1;overflow:auto">{page_fail(us)}</div>' + phone_tabbar_e('door'))
    html += '</div>'
    html += """<div class="sk-foot">Sketch only. Example houses; no live data. The page under the chrome is a stand-in for the rebuilt /orders and /receiving and is not part of this sketch. Motion: ink 160 for the line&#8217;s micro-states, settle 320 for a moment landing, tuck 300 for the phone sheets, pour 620 linear for any hold, stamp 360 for the wax; the now mark does not animate &mdash; it is re-placed on each read (a line that creeps asks to be watched). The loading hairline and the skeleton sheen are stated exceptions and pause under prefers-reduced-motion. No emoji.</div>"""
    return doc('Sketch 119 · E — The day', E_CSS, html)


if __name__ == '__main__':
    with open(os.path.join(HERE, 'direction-d.html'), 'w', encoding='utf-8') as f:
        f.write(build_d())
    with open(os.path.join(HERE, 'direction-e.html'), 'w', encoding='utf-8') as f:
        f.write(build_e())
    print('wrote direction-d.html, direction-e.html')
