#!/usr/bin/env python3
"""Build sketch 102 from census.py.
  python3 build.py            → index.html, census.json, README.md (in this dir)
  python3 build.py --artifact PATH   → also the artifact fragment (no doctype/html/head/body)
  python3 build.py --docs     → also insert/refresh the 'Overlays' subsection in each 06-pages doc
"""
import sys, os, json, html, collections, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import census as C
esc = lambda s: html.escape(str(s), quote=True)
STATUS_WORD = dict(built="Built", migrate="Migrate", owed="Owed", target="Target", retire="Retires", delete="Delete", none="Not a shape", pattern="Behaviour")
STATUS_GLOSS = dict(pattern="a behaviour the best products have, proposed for the house", built="on the primitive today", migrate="renders legacy inside a house page today", owed="the rebuilt page owes this act",
                    target="page not yet rebuilt; shape decided", retire="retires with the legacy page", delete="unreachable — delete", none="paint or a label, no shape")
SHAPE_W = dict(sheet="440", panel="620", popover="320", peek="400", hover="300", toast="380", bar="560", bottom="360", inplace="620")
NONMODAL = ("peek", "hover", "toast", "bar", "bottom", "inplace")
DRAWN = ("built", "migrate", "owed", "target", "pattern")

# ── body rows ─────────────────────────────────────────────────────────────
def row(r):
    k = r[0]
    if k == "sect":  return f'<span class="sect">{esc(r[1])}</span>'
    if k == "item":
        lab, sub = r[1], (r[2] if len(r) > 2 else ""); on = len(r) > 3 and r[3]; kbd = r[4] if len(r) > 4 else None
        return (f'<div class="item{" on" if on else ""}"><span class="txt"><span class="lab">{esc(lab)}</span>'
                f'{f"<span class=sub>{esc(sub)}</span>" if sub else ""}</span>{f"<span class=kbd>{esc(kbd)}</span>" if kbd else ""}</div>')
    if k == "fact":  return f'<div class="fact"><span class="k">{esc(r[1])}</span><span class="v{" em" if len(r)>3 and r[3] else ""}">{esc(r[2])}</span></div>'
    if k == "field":
        lab, val = r[1], r[2]; ph = len(r) > 3 and r[3]
        return f'<div class="frow">{f"<span class=flab>{esc(lab)}</span>" if lab else ""}<div class="fin2{" ph" if ph or not val else ""}">{esc(val) if val else "&nbsp;"}</div></div>'
    if k == "two":
        cells = []
        for f in r[1:]:
            lab, val = f[0], f[1]; ph = len(f) > 2 and f[2]
            cells.append(f'<div class="frow"><span class="flab">{esc(lab)}</span><div class="fin2{" ph" if ph or not val else ""}">{esc(val) if val else "&nbsp;"}</div></div>')
        return f'<div class="two">{"".join(cells)}</div>'
    if k == "note":  return f'<div class="notice">{r[1]}</div>'
    if k == "quiet": return f'<p class="quiet">{esc(r[1])}</p>'
    if k == "hold":  return f'<div class="hta"><span class="sealdot"><i></i></span><span>{esc(r[1])}</span><span class="htk">hold</span></div>'
    if k == "btns":  return '<div class="btnrow">' + "".join(f'<span class="btn{" pri" if len(b)>1 and b[1] else ""}">{esc(b[0])}</span>' for b in r[1:]) + '</div>'
    if k == "chips": return '<div class="chiprow pad">' + "".join(f'<span class="chip{" on" if c[1] else ""}">{esc(c[0])}</span>' for c in r[1:]) + '</div>'
    if k == "table":
        cols, rows = r[1], r[2]
        return ('<div class="tbl"><table><thead><tr>' + "".join(f"<th>{esc(c)}</th>" for c in cols) + '</tr></thead><tbody>'
                + "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in rr) + "</tr>" for rr in rows) + '</tbody></table></div>')
    if k == "alert": return f'<div class="mdv-alert"><span class="ah">{esc(r[1])}</span><span>{esc(r[2])}</span></div>'
    if k == "text":  return f'<p class="letter">{esc(r[1])}</p>'
    if k == "mono":  return f'<pre class="mono">{esc(r[1])}</pre>'
    if k == "frame": return f'<div class="frame"><span>{esc(r[1])}</span></div>'
    if k == "sugg":  return f'<div class="sugg"><span class="k">{esc(r[1])}</span><span class="was">{esc(r[2])}</span><span class="now">{esc(r[3])}</span><span class="sg"><span class="ok">Accept</span><span class="no">Reject</span></span></div>'
    if k == "pill":  return f'<div class="pillwrap"><div class="pill"><span class="sealdot"><i></i></span><span>{esc(r[1])}</span><span class="arrow">↑</span></div></div>'
    if k == "avatars": return f'<div class="presence"><span class="av">E</span><span class="av">A</span><span>{esc(r[1])}</span></div>'
    raise ValueError(k)

def specimen(o, pg):
    shape = o["shape"]; cls = shape + (" wide" if o["wide"] else "")
    chips = [f'<span class="st st-{o["status"]}">{STATUS_WORD[o["status"]]}</span>',
             f'<span class="sh">{shape}{" · wide" if o["wide"] else ""}{" · modal" if o["modal"] else ""}{" · non-modal" if shape in NONMODAL and shape != "bottom" else ""} · {("640" if o["wide"] else SHAPE_W[shape])}px</span>']
    if o["seal"]: chips.append('<span class="sh">seal</span>')
    if o["fork"]: chips.append(f'<span class="sh fk">fork {o["fork"]}</span>')
    head = ('<div class="oh"><div>' + (f'<span class="oh-eyebrow">{esc(o["eyebrow"])}</span>' if o["eyebrow"] else "")
            + f'<h3 class="oh-title">{esc(o["title"] or o["name"])}</h3></div><div class="oh-side">'
            + (f'<span class="lnk">{esc(o["action"])}</span>' if o["action"] else "")
            + (f'<span class="oclose">{esc(o["close"])}</span>' if shape != "popover" or o["modal"] else "") + '</div></div>')
    body = '<div class="obody">' + "".join(row(r) for r in o["body"]) + '</div>'
    foot = f'<div class="ofoot">{esc(o["footer"])}</div>' if o["footer"] else ""
    pin = ' data-ground="charcoal"' if o.get("pin") else ""
    kind = "nonmodal" if shape in NONMODAL else "modal"
    if shape in ("toast", "bar"):
        surface = f'<div class="ovl {cls}"><div class="tline"><span class="ttext">{esc(o["title"] or o["name"])}</span>{body}</div></div>'
    elif shape == "bottom":
        surface = (f'<div class="phone"><div class="pscreen"><div class="under-p"><span class="u-eyebrow">The door</span></div><div class="pscrim"></div>'
                   f'<div class="bsheet"><div class="grab"></div>{head}{body}{foot}</div></div></div>')
    elif shape == "inplace":
        surface = (f'<div class="ovl inplace"><div class="rowhead"><span class="oh-eyebrow">{esc(o["eyebrow"] or "")}</span><span class="rowtitle">{esc(o["title"] or o["name"])}</span><span class="chev">▾</span></div>'
                   f'<div class="rowx">{body}{foot}</div></div>')
    else:
        surface = f'<div class="ovl {cls}">{head}{body}{foot}</div>'
    return (f'<article class="spec" data-shape="{shape}" data-kind="{kind}" data-status="{o["status"]}"{pin}>'
            f'<div class="spec-cap">{"".join(chips)}<span class="nm">{esc(o["name"])}</span></div>'
            f'{surface}'
            f'<p class="why">{o["why"] or ""}</p><p class="src">{esc(o["source"] or "")}</p></article>')

def tomb(o):
    return (f'<li data-status="{o["status"]}"><span class="st st-{o["status"]}">{STATUS_WORD[o["status"]]}</span>'
            f'<span class="tn">{esc(o["name"])}</span><span class="ta">{o["acts"] or ""}</span>'
            f'<span class="tw">{o["went"] or ""}{f" <span class=fk>fork {o[chr(102)+chr(111)+chr(114)+chr(107)]}</span>" if False else ""}</span><span class="src">{esc(o["source"] or "")}</span></li>')

PINS = {"Publish this week", "Write off 6 bottles?", "Ask the day-book", "The bell"}
for pg in C.PAGES:
    for o in pg["overlays"]:
        if o["name"] in PINS: o["pin"] = True

def counts():
    c = collections.Counter(); shapes = collections.Counter()
    for pg in C.PAGES:
        for o in pg["overlays"]:
            c[o["status"]] += 1
            if o["status"] in DRAWN and o["status"] != "pattern": shapes[o["shape"]] += 1
    c["total"] = sum(v for k, v in c.items() if k not in ("total", "pattern")); c["drawn"] = sum(c[s] for s in DRAWN)
    return c, shapes

CSS = r"""
:root{--seal:#1A5E6B;--seal-deep:#14515C;--seal-tint:rgba(26,94,107,.10);--seal-ring:rgba(26,94,107,.32);
 --paper-0:#FAF7F1;--paper-1:#F3EFE6;--paper-2:#EAE4D8;--ink-1:#211C16;--ink-2:#4F473C;--ink-3:#7C7365;--ink-4:#665D50;
 --mdv-scrim:rgba(23,19,15,.28);--serif:"Fraunces",Georgia,"Times New Roman",serif;--sans:"DM Sans","Plus Jakarta Sans",system-ui,sans-serif;
 --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--seal:#5FB0BC;--seal-deep:#7DC3CD;--seal-tint:rgba(95,176,188,.14);--seal-ring:rgba(95,176,188,.38);
 --paper-0:#15130F;--paper-1:#1D1813;--paper-2:#262019;--ink-1:#EFE7D9;--ink-2:#C0B6A5;--ink-3:#8E8576;--ink-4:#ABA294;--mdv-scrim:rgba(0,0,0,.5);color-scheme:dark}}
:root[data-theme="dark"]{--seal:#5FB0BC;--seal-deep:#7DC3CD;--seal-tint:rgba(95,176,188,.14);--seal-ring:rgba(95,176,188,.38);
 --paper-0:#15130F;--paper-1:#1D1813;--paper-2:#262019;--ink-1:#EFE7D9;--ink-2:#C0B6A5;--ink-3:#8E8576;--ink-4:#ABA294;--mdv-scrim:rgba(0,0,0,.5);color-scheme:dark}
[data-ground="charcoal"]{--seal:#5FB0BC;--seal-deep:#7DC3CD;--seal-tint:rgba(95,176,188,.14);--seal-ring:rgba(95,176,188,.38);
 --paper-0:#15130F;--paper-1:#1D1813;--paper-2:#262019;--ink-1:#EFE7D9;--ink-2:#C0B6A5;--ink-3:#8E8576;--ink-4:#ABA294;--mdv-scrim:rgba(0,0,0,.5);color-scheme:dark}
[data-ground="paper"]{--seal:#1A5E6B;--seal-deep:#14515C;--seal-tint:rgba(26,94,107,.10);--seal-ring:rgba(26,94,107,.32);
 --paper-0:#FAF7F1;--paper-1:#F3EFE6;--paper-2:#EAE4D8;--ink-1:#211C16;--ink-2:#4F473C;--ink-3:#7C7365;--ink-4:#665D50;--mdv-scrim:rgba(23,19,15,.28);color-scheme:light}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper-0)}
.mudavym{min-height:100vh;background:var(--paper-0);color:var(--ink-1);font-family:var(--sans);font-size:13px;line-height:1.5}
.banner{background:var(--ink-1);color:var(--paper-0);font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;padding:7px 20px}
.wrap{max-width:1280px;margin:0 auto;padding:22px 20px 78px}
.wordmark{font-family:var(--serif);font-weight:600;font-size:13px;letter-spacing:.04em}
h1{font-family:var(--serif);font-size:36px;font-weight:600;letter-spacing:-.018em;line-height:1.07;margin:4px 0 0;text-wrap:balance}
h1 .dot,.wordmark .dot{color:var(--seal)}
.lede{font-family:var(--serif);font-style:italic;font-size:16px;color:var(--ink-2);margin:8px 0 0;max-width:62ch}
.dbl{border-top:1px solid var(--ink-1);border-bottom:1px solid var(--ink-1);height:3px;opacity:.5;margin:17px 0 0}
p{margin:7px 0 0;color:var(--ink-2);font-size:12.5px;line-height:1.64}
b{color:var(--ink-1);font-weight:600}
code{font-family:var(--mono);font-size:11px;color:var(--ink-2)}
.nums{display:flex;flex-wrap:wrap;margin:16px 0 0;padding:12px 0 2px;border-top:1px solid var(--paper-2);border-bottom:1px solid var(--paper-2)}
.nums div{padding:0 16px 10px 0;margin-right:16px;border-right:1px solid var(--paper-2)}.nums div:last-child{border-right:0}
.nums .n{font-family:var(--mono);font-size:15px;font-weight:600;color:var(--ink-1);display:block;font-variant-numeric:tabular-nums}
.nums .k{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);display:block;margin-top:3px}
.rule{margin:22px 0 0;padding:14px 18px;border-left:2px solid var(--seal);background:linear-gradient(90deg,var(--seal-tint),transparent 70%)}
.rule .r{font-family:var(--serif);font-size:19px;font-weight:600;color:var(--ink-1);margin:0}
.rule p{margin-top:5px}
/* controls */
.ctl{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:14px 22px;align-items:center;margin:18px -20px 0;padding:10px 20px;background:var(--paper-0);border-bottom:1px solid var(--paper-2)}
.ctl .g{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ctl .gl{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-right:4px}
.ctl button{font:inherit;font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--paper-2);background:transparent;color:var(--ink-2);cursor:pointer}
.ctl button[aria-pressed="true"]{background:var(--seal-tint);border-color:var(--seal-ring);color:var(--ink-1)}
.ctl button:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
/* page sections */
.pg{margin:40px 0 0}
.pg-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.pg-h .rt{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--seal-deep)}
.pg-h h2{font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:-.012em;margin:0}
.pg-h .fl{font-family:var(--mono);font-size:9.5px;color:var(--ink-3)}
.pg .v{max-width:80ch}
.specs{display:flex;flex-wrap:wrap;gap:22px 20px;align-items:flex-start;margin:14px 0 0}
.spec{max-width:100%;display:flex;flex-direction:column;gap:6px}
.spec[hidden]{display:none}
.spec-cap{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;color:var(--ink-3)}
.spec-cap .nm{margin-left:auto;text-transform:uppercase;letter-spacing:.1em}
.st{padding:2px 7px;border-radius:999px;border:1px solid var(--paper-2);text-transform:uppercase;letter-spacing:.1em;font-size:9px;color:var(--ink-2)}
.st-built{border-color:var(--seal-ring);color:var(--seal-deep)}
.st-migrate,.st-owed{border-color:var(--ink-4);color:var(--ink-1)}
.st-retire,.st-none{color:var(--ink-3);border-style:dashed}
.st-pattern{border-color:var(--seal);color:var(--seal-deep);background:var(--seal-tint)}
.st-delete{color:var(--ink-3);text-decoration:line-through}
.sh{padding:2px 7px;border-radius:999px;background:var(--paper-1);text-transform:uppercase;letter-spacing:.1em;font-size:9px}
.fk{color:var(--seal-deep)}
.spec .why{margin:0;max-width:60ch;font-size:12px;color:var(--ink-2)}
.spec .src{margin:0;font-family:var(--mono);font-size:9.5px;color:var(--ink-3);max-width:70ch;word-break:break-word}
/* the surfaces — numbers from sheet.css */
.ovl{background:var(--paper-0);color:var(--ink-1);display:flex;flex-direction:column;font-family:var(--sans);border:1px solid var(--paper-2);overflow:hidden}
.ovl.sheet{width:440px;max-width:100%;min-height:260px;border-left:1px solid var(--paper-2);box-shadow:-18px 0 48px rgba(23,19,15,.14);border-radius:0}
.ovl.sheet.wide{width:640px}
.ovl.panel{width:620px;max-width:100%;border-radius:14px;box-shadow:0 24px 60px -30px rgba(0,0,0,.5)}
.ovl.popover{width:320px;max-width:100%;border-radius:14px;box-shadow:0 18px 44px -22px rgba(0,0,0,.42)}
.oh{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px 11px;border-bottom:1px solid var(--paper-2);flex:none}
.oh-eyebrow{display:block;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--seal-deep)}
.oh-title{margin:2px 0 0;font-family:var(--serif);font-size:19px;font-weight:600;line-height:1.16;letter-spacing:-.01em;color:var(--ink-1);text-wrap:balance}
.oh-side{display:flex;align-items:center;gap:8px;flex:none}
.oclose{font-size:12px;line-height:1.2;padding:5px 10px;border-radius:8px;border:1px solid var(--paper-2);color:var(--ink-2)}
.obody{flex:0 1 auto;padding:4px 0 12px}
.ofoot{flex:none;padding:9px 16px 12px;border-top:1px solid var(--paper-2);font-size:11px;line-height:1.5;color:var(--ink-3)}
.sect{display:block;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);padding:10px 16px 4px}
.item{display:flex;align-items:center;gap:10px;padding:7px 16px;border-left:2px solid transparent;font-size:13px}
.item.on{background:var(--seal-tint);border-left-color:var(--seal)}
.item .txt{flex:1 1 auto;min-width:0}.item .lab{display:block;font-weight:500;color:var(--ink-1)}.item .sub{display:block;font-size:11px;color:var(--ink-3)}
.kbd{flex:none;font-family:var(--mono);font-size:10px;font-weight:500;color:var(--ink-3);background:var(--paper-1);border:1px solid var(--paper-2);border-radius:5px;padding:1px 6px;font-variant-numeric:tabular-nums}
.quiet{margin:0;padding:8px 16px 4px;font-size:11.5px;line-height:1.5;color:var(--ink-2)}
.lnk{font-size:12px;font-weight:500;color:var(--seal-deep)}
.fact{display:grid;grid-template-columns:118px 1fr;gap:10px;padding:6px 16px;font-size:12.5px}
.fact .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3);padding-top:3px}
.fact .v{color:var(--ink-1)}.fact .v.em{color:var(--ink-3)}
.frow{padding:8px 16px 0}
.flab{display:block;font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px}
.fin2{border:1px solid var(--paper-2);background:var(--paper-1);border-radius:7px;padding:7px 9px;font-size:12.5px;color:var(--ink-1);min-height:31px}
.fin2.ph{color:var(--ink-3)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 16px 0}.two .frow{padding:0}
.chiprow{display:flex;flex-wrap:wrap;gap:5px}.chiprow.pad{padding:8px 16px 0}
.chip{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--paper-2);color:var(--ink-2)}
.chip.on{color:var(--ink-1);background:var(--seal-tint);border-color:var(--seal-ring)}
.notice{margin:10px 16px 0;padding:9px 11px;background:var(--paper-1);border-left:2px solid var(--ink-4);font-size:11.5px;line-height:1.55;color:var(--ink-2)}
.hta{margin:12px 16px 0;position:relative;border:1px solid var(--seal);border-radius:9px;padding:9px 12px;font-size:12.5px;color:var(--seal-deep);font-weight:500;display:flex;align-items:center;gap:10px}
.hta .htk{margin-left:auto;font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.sealdot{width:18px;height:18px;border-radius:999px;background:var(--seal);display:flex;align-items:center;justify-content:center;flex:none}
.sealdot i{display:block;width:8px;height:3px;border-top:1px solid var(--paper-0);border-bottom:1px solid var(--paper-0)}
.btnrow{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px 0}
.btn{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--paper-2);color:var(--ink-1)}
.btn.pri{border-color:var(--ink-4)}
.mdv-alert{margin:10px 16px 0;padding:9px 11px;background:var(--paper-1);border-left:2px solid var(--ink-1);font-size:11.5px;line-height:1.5;color:var(--ink-2);display:grid;gap:2px}
.mdv-alert .ah{font-family:var(--mono);font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-1)}
.letter{margin:8px 16px 0;font-family:var(--serif);font-size:14.5px;line-height:1.55;color:var(--ink-1);max-width:60ch}
pre.mono{margin:8px 16px 0;padding:9px 11px;background:var(--paper-1);border:1px solid var(--paper-2);border-radius:7px;font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--ink-1);white-space:pre-wrap;overflow-x:auto}
.frame{margin:10px 16px 0;aspect-ratio:16/9;border:1px dashed var(--ink-4);border-radius:8px;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);background:var(--paper-1)}
.tbl{margin:8px 16px 0;overflow-x:auto}
.tbl table{border-collapse:collapse;width:100%;font-size:11.5px}
.tbl th{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);text-align:left;padding:4px 8px 6px 0;border-bottom:1px solid var(--paper-2);font-weight:600}
.tbl td{padding:6px 8px 6px 0;border-bottom:1px solid var(--paper-2);color:var(--ink-1);font-variant-numeric:tabular-nums}
/* non-modal surfaces (research) */
.ovl.peek{width:400px;max-width:100%;border-radius:10px;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}
.ovl.hover{width:300px;max-width:100%;border-radius:10px;box-shadow:0 10px 30px -18px rgba(0,0,0,.35)}
.ovl.toast,.ovl.bar{border-radius:12px;box-shadow:0 12px 32px -18px rgba(0,0,0,.4)}
.ovl.toast{width:380px;max-width:100%}.ovl.bar{width:560px;max-width:100%}
.tline{display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;font-size:12.5px;color:var(--ink-1)}
.tline .ttext{flex:1 1 auto;font-weight:500}.tline .obody{padding:0;display:flex;align-items:center;gap:8px}.tline .btnrow{padding:0}.tline .quiet{padding:0;font-family:var(--mono);font-size:10px;color:var(--ink-3)}
.ovl.inplace{width:620px;max-width:100%;border-radius:0;border:0;border-top:1px solid var(--paper-2);border-bottom:1px solid var(--paper-2)}
.rowhead{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:12px;padding:10px 16px;background:var(--paper-1)}
.rowtitle{font-weight:600;color:var(--ink-1);font-size:13px}.chev{color:var(--ink-3);font-size:11px}
.rowx{padding:4px 0 12px;border-left:2px solid var(--seal)}
.sugg{display:grid;grid-template-columns:96px 1fr 1.3fr auto;gap:10px;align-items:baseline;padding:7px 16px;font-size:12px}
.sugg .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-3)}
.sugg .was{color:var(--ink-1)}.sugg .now{color:var(--ink-3);border-bottom:1px dotted var(--ink-3)}
.sugg .sg{display:flex;gap:6px;font-size:11px}.sugg .ok{color:var(--seal-deep)}.sugg .no{color:var(--ink-3)}
.phone{width:360px;max-width:100%;border:1px solid var(--paper-2);border-radius:28px;padding:10px;background:var(--paper-1)}
.pscreen{position:relative;height:560px;border-radius:20px;overflow:hidden;background:var(--paper-0)}
.under-p{position:absolute;inset:0;padding:22px 16px}
.pscrim{position:absolute;inset:0;background:var(--mdv-scrim)}
.bsheet{position:absolute;left:0;right:0;bottom:0;height:55%;background:var(--paper-0);border-top:1px solid var(--paper-2);border-radius:16px 16px 0 0;display:flex;flex-direction:column;box-shadow:0 -12px 32px rgba(23,19,15,.14)}
.grab{width:36px;height:4px;border-radius:999px;background:var(--paper-2);margin:8px auto 0}
.bsheet .oh{padding-top:8px}
.pillwrap{padding:14px 16px 0}
.pill{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:999px;border:1px solid var(--seal);color:var(--seal-deep);font-weight:500;font-size:12.5px}
.pill .arrow{margin-left:auto;font-family:var(--mono)}
.presence{display:flex;align-items:center;gap:6px;padding:8px 16px 0;font-size:11.5px;color:var(--ink-2)}
.presence .av{width:20px;height:20px;border-radius:999px;background:var(--seal-tint);box-shadow:inset 0 0 0 1px var(--seal-ring);color:var(--seal-deep);font-family:var(--mono);font-size:9px;display:inline-flex;align-items:center;justify-content:center}
.presence .av+.av{margin-left:-8px}
.access{list-style:none;margin:12px 0 0;padding:0;max-width:1000px;counter-reset:a}
.access li{display:grid;grid-template-columns:190px 1fr auto;gap:12px;padding:8px 0;border-top:1px solid var(--paper-2);font-size:12px;line-height:1.5;color:var(--ink-2);align-items:start}
.access .at{color:var(--ink-1);font-weight:600}.access .al{font-family:var(--mono);font-size:9.5px;color:var(--seal-deep);text-decoration:none}
@media (max-width:760px){.access li{grid-template-columns:1fr}.sugg{grid-template-columns:1fr}}
/* tombstones */
.tomb{list-style:none;margin:16px 0 0;padding:0;max-width:1100px}
.tomb li{display:grid;grid-template-columns:76px 170px 1fr 1fr;gap:12px;padding:8px 0;border-top:1px solid var(--paper-2);font-size:12px;line-height:1.5;color:var(--ink-2);align-items:start}
.tomb li[hidden]{display:none}
.tomb .tn{color:var(--ink-1);font-weight:500}.tomb .ta{color:var(--ink-2)}.tomb .tw{color:var(--ink-2)}
.tomb .src{grid-column:2/-1;font-family:var(--mono);font-size:9.5px;color:var(--ink-3);margin:-4px 0 0}
.tomb-h{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin:22px 0 0}
/* forks, method */
.sec-h{display:flex;align-items:baseline;gap:12px;margin:44px 0 0}
.sec-n{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--seal-deep);white-space:nowrap}
.sec-h h2{font-family:var(--serif);font-size:24px;font-weight:600;letter-spacing:-.012em;margin:0}
.forks{margin:14px 0 0;padding:0;list-style:none;max-width:960px}
.forks li{display:grid;grid-template-columns:44px 1fr;gap:14px;padding:10px 0;border-top:1px solid var(--paper-2)}
.forks .fn{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--seal-deep);padding-top:2px}
.forks .ft{font-weight:600;color:var(--ink-1)}
.forks p{margin-top:3px}
.nolist{columns:3;column-gap:24px;font-family:var(--mono);font-size:10.5px;line-height:1.9;color:var(--ink-2);margin:10px 0 0;max-width:1000px}
@media (max-width:760px){.nolist{columns:1}.tomb li{grid-template-columns:76px 1fr}.tomb .tw,.tomb .src{grid-column:1/-1}}
.foot{margin:42px 0 0;padding-top:14px;border-top:1px solid var(--ink-1);font-size:11.5px;line-height:1.72;color:var(--ink-3);max-width:980px}
.foot b{color:var(--ink-2)}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}
"""

JS = r"""
(function(){
  var root=document.getElementById('mdv-root');
  var shape='all',status='all';
  function apply(){
    document.querySelectorAll('.spec').forEach(function(s){
      var shapeOk=(shape==='all')||(shape==='nonmodal'?s.dataset.kind==='nonmodal':s.dataset.shape===shape);
      s.hidden=!(shapeOk&&(status==='all'||s.dataset.status===status));
    });
    document.querySelectorAll('.tomb li').forEach(function(l){
      l.hidden=!(shape==='all'&&(status==='all'||l.dataset.status===status));
    });
    document.querySelectorAll('.pg').forEach(function(p){
      var vis=p.querySelectorAll('.spec:not([hidden]),.tomb li:not([hidden])').length;
      p.querySelector('.pg-count').textContent=vis+' shown';
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function(b){
    b.addEventListener('click',function(){
      var g=b.dataset.filter,v=b.dataset.value;
      if(g==='shape')shape=v;else if(g==='status')status=v;else{ if(v==='auto')root.removeAttribute('data-ground');else root.setAttribute('data-ground',v); }
      document.querySelectorAll('[data-filter="'+g+'"]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
      if(g!=='ground')apply();
    });
  });
})();
"""

def page_section(pg):
    drawn = [o for o in pg["overlays"] if o["status"] in DRAWN]
    tombs = [o for o in pg["overlays"] if o["status"] not in DRAWN]
    title = "The shell — over every page" if pg["route"] == "shell" else ("Behaviours — what the best products do, drawn on our surfaces" if pg["route"] == "behaviours" else pg["route"])
    h = [f'<section class="pg" id="pg-{esc(pg["slug"])}"><div class="pg-h"><span class="rt">{"shell" if pg["route"]=="shell" else ("research · 2026-09-05 · nothing built" if pg["route"]=="behaviours" else ("rebuilt · flagged" if pg["rebuilt"] else "not yet rebuilt"))}</span>'
         f'<h2>{esc(title)}</h2>' + (f'<span class="fl">{esc(pg["flag"])}</span>' if pg["flag"] else "") + '<span class="fl pg-count"></span></div>',
         f'<p class="v">{esc(pg["verdict"])}</p>']
    if drawn: h.append('<div class="specs">' + "".join(specimen(o, pg) for o in drawn) + '</div>')
    if pg["route"] == "behaviours":
        h.append('<p class="tomb-h">More access — how the best products make every act reachable</p><ol class="access">'
                 + "".join(f'<li><span class="at">{esc(a)}</span><span class="ad">{b}</span><a class="al" href="{esc(u)}">{esc(u.split("/")[2])}</a></li>' for a, b, u in C.MORE_ACCESS) + '</ol>'
                 '<p class="tomb-h">A fit per act — proposed (F12), decided act by act</p><ol class="access">'
                 + "".join(f'<li><span class="at">{esc(a)}</span><span class="ad">{esc(b)}</span><span></span></li>' for a, b in C.FIT_PER_ACT) + '</ol>'
                 '<p class="v">Evidence and verdicts: <code>research/A-command-first.md</code>, <code>B-ops-finance.md</code>, <code>C-ai-mobile.md</code>, <code>D-implementation.md</code>, <code>E-adversary.md</code>, then <code>F-security-ceremonies.md</code>, the lead\'s own pass <code>G-security-adversary.md</code>, the deep pass on the assistant\'s ceremonies <code>H-assistant-security-deep.md</code> and its check <code>I-deep-pass-check.md</code> in the sketch directory. The adversary rejected five rows (an OS-wide capture a web app cannot honestly offer; two claims whose sources did not hold; a bare Approve on a push notification; a nested peek with no primary source) and found three misses: the manager passcode, the kitchen\'s bump-and-recall, and presence.</p>')
    if tombs:
        h.append('<p class="tomb-h">Not drawn — and why</p><ul class="tomb">' + "".join(tomb(o) for o in tombs) + '</ul>')
    if not drawn and not tombs: h.append('<p class="quiet" style="padding-left:0">No overlay opens from this page.</p>')
    h.append('</section>'); return "".join(h)

def body_html(for_artifact):
    c, shapes = counts()
    nums = [(141, "overlay sites read"), (c["total"], "census rows"), (len([p for p in C.PAGES if p["route"]!="shell"]), "pages with an overlay"),
            (c["built"], "built"), (c["migrate"], "migrate"), (c["owed"], "owed"), (c["target"], "target"),
            (c["retire"], "retire"), (c["delete"], "delete"), (shapes["sheet"], "sheets drawn"), (shapes["panel"], "panels drawn"), (shapes["popover"], "popovers drawn"), (c["pattern"], "behaviours drawn")]
    h = [f'<div class="mudavym" id="mdv-root"><div class="banner">Sketch 102 · modal census — example data, not a tenant</div><div class="wrap">',
         '<div class="wordmark">Mudavym<span class="dot">.</span></div>',
         '<h1>Every overlay, in its shape<span class="dot">.</span></h1>',
         '<p class="lede">The 141 sites where the web app opens something over the page, read from the tree on 2026-09-05 and folded into 117 overlays, plus the three the founder\'s rulings that day added — each given the shape ADR 0112 gives it, or a reason it has none.</p>',
         '<div class="dbl"></div>',
         '<div class="nums">' + "".join(f'<div><span class="n">{n}</span><span class="k">{k}</span></div>' for n, k in nums) + '</div>',
         '<div class="rule"><p class="r">An object gets a sheet. A question gets a panel. A choice gets a popover.</p>'
         '<p>The shape is chosen by what the reader must do next — never by how much content there is and never by which page it is on. '
         'A sheet arrives from the right so the list stays readable; a panel sits in the middle because it wants an answer; a popover hangs off the control it belongs to. '
         'The seal never sits in a popover (founder, 2026-09-04). Wax is for a real commitment; bulk gets the plain die.</p></div>',
         '<div class="ctl"><div class="g"><span class="gl">Shape</span>' + "".join(f'<button type="button" data-filter="shape" data-value="{v}" aria-pressed="{str(v=="all").lower()}">{l}</button>' for v, l in [("all","All"),("sheet","Sheet"),("panel","Panel"),("popover","Popover"),("nonmodal","Non-modal")]) + '</div>'
         '<div class="g"><span class="gl">Status</span>' + "".join(f'<button type="button" data-filter="status" data-value="{v}" aria-pressed="{str(v=="all").lower()}">{l}</button>' for v, l in [("all","All"),("built","Built"),("migrate","Migrate"),("owed","Owed"),("target","Target"),("pattern","Behaviours"),("retire","Retires"),("delete","Delete")]) + '</div>'
         '<div class="g"><span class="gl">Ground</span>' + "".join(f'<button type="button" data-filter="ground" data-value="{v}" aria-pressed="{str(v=="auto").lower()}">{l}</button>' for v, l in [("auto","Follow the viewer"),("paper","Paper"),("charcoal","Charcoal")]) + '</div></div>',
         '<p style="max-width:80ch">Every specimen is drawn at the primitive\'s real width — 440 for a sheet, 640 wide, 620 for a panel, 320 for a popover — with the head, the close-in-words and the footer exactly as <code>sheet.css</code> draws them. Four specimens are pinned to charcoal on purpose: that is the portal carrying the page\'s ground, demonstrated rather than described.</p>']
    for pg in C.PAGES: h.append(page_section(pg))
    h.append('<div class="sec-h"><span class="sec-n">No overlay</span><h2>Pages that open nothing</h2></div>'
             '<p>Read for completeness: each of these routes renders no fixed-inset element, no Radix dialog and no house overlay. The door and the receipts desk are on this list on purpose.</p>'
             '<div class="nolist">' + "".join(f'<div>{esc(r)}</div>' for r in C.NO_OVERLAY) + '</div>')
    h.append('<div class="sec-h"><span class="sec-n">The forks</span><h2>What only the founder can decide</h2></div><p>Eleven answered on 2026-09-05; F12 — the security ceremonies — is open with its research running. The fifth F4 act (assign a recommendation) still awaits an explicit yes.</p><ol class="forks">'
             + "".join(f'<li><span class="fn">{esc(n)}</span><div><span class="ft">{esc(t)}</span><p>{esc(d)}</p>{("<p><b>Answered " + esc(C.ANSWERS[n]) + "</b></p>") if n in C.ANSWERS else ""}</div></li>' for n, t, d in C.FORKS) + '</ol>')
    h.append('<div class="sec-h"><span class="sec-n">Method</span><h2>How this was read</h2></div>'
             f'<p>The tree is <b>{esc(C.META["tree"])}</b>. Every <code>.tsx</code> under <code>apps/web/src</code> (tests and stories excluded) was scanned for three things: a JSX <code>&lt;Sheet&gt;</code>, <code>&lt;Panel&gt;</code> or <code>&lt;Popover&gt;</code> whose import resolves to <code>components/mudavym</code>; a <code>fixed inset-0</code> or <code>position: fixed</code> wrapper; and a Radix <code>*Content</code>. '
             'That gave 141 sites in 25 house files and 69 legacy files, folded into 117 overlays; the founder\'s rulings of 2026-09-05 added three owed sheets (a one-tap action of your own, the carry sheet\'s auction-lot start, certifications on file), so the census holds 120 rows. Each site was then read by hand for what it does and who opens it; page-local components that merely share a name (<code>ReportsNext</code>\'s cutting <code>Sheet</code>, the dashboard rail\'s <code>Panel</code>, the door\'s local <code>Panel</code>) were excluded, and files nobody imports were checked twice. '
             'The house branches inside the eight shell files count once each here, not as separate legacy sites. Widths, motion tokens and the close-in-words rule are read from <code>components/mudavym/Sheet.tsx</code> and <code>sheet.css</code>.</p>'
             '<p>Status words: <b>Built</b> is on the primitive today. <b>Migrate</b> is a legacy overlay that renders inside a house-flagged page right now. <b>Owed</b> is an act the legacy page had that the rebuilt page does not yet offer. <b>Target</b> is a page not yet rebuilt whose overlay takes its shape now. <b>Retires</b> means the act already lives in something built. <b>Delete</b> is code nobody imports.</p>')
    h.append('<div class="foot"><b>Example data, not a tenant.</b> Every name, figure and date in the specimens is invented for the drawing. '
             'Sources: <code>.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md</code> · sketch 099 (the three shapes on their first pages) · sketch 100 (the wide sheet) · '
             '<code>apps/web/src/components/mudavym/Sheet.tsx</code>, <code>sheet.css</code>, <code>lib/mudavym/shellGround.ts</code> · the census itself lives in <code>.planning/sketches/102-modal-census/census.py</code> and <code>census.json</code>.</div>')
    h.append('</div></div>')
    return "".join(h)

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'

def write_index():
    doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
           '<title>102 · Every overlay, in its shape</title>' + FONTS + '<style>' + CSS + '</style></head><body>' + body_html(False)
           + '<script>' + JS + '</script></body></html>')
    open(os.path.join(HERE, "index.html"), "w").write(doc)

def write_artifact(path):
    doc = ('<title>Mudavym Overlay Census</title>' + FONTS + '<style>' + CSS + '</style>' + body_html(True) + '<script>' + JS + '</script>')
    open(path, "w").write(doc)

def write_json():
    out = dict(meta=C.META, pages=[dict(route=p["route"], slug=p["slug"], doc=p["doc"], rebuilt=p["rebuilt"], flag=p["flag"], verdict=p["verdict"],
              overlays=[{k: v for k, v in o.items() if k != "pin"} for o in p["overlays"]]) for p in C.PAGES], no_overlay=C.NO_OVERLAY,
               forks=[dict(id=a, title=b, text=c) for a, b, c in C.FORKS])
    json.dump(out, open(os.path.join(HERE, "census.json"), "w"), indent=1, ensure_ascii=False)

def md_table(pages):
    lines = ["| Page | Overlay | Shape | Status | Where the act lives or went | Source |", "|---|---|---|---|---|---|"]
    for p in pages:
        for o in p["overlays"]:
            shape = (o["shape"] or "—") + (" · wide" if o["wide"] else "") + (" · modal" if o["modal"] else "") + (" · seal" if o["seal"] else "")
            note = (o["why"] if o["status"] in DRAWN else (o["went"] or "")).replace("|", "\\|")
            note = re.sub(r"</?b>", "**", note)
            lines.append(f'| `{p["route"]}` | {o["name"]} | {shape} | {STATUS_WORD[o["status"]]}{(" · fork " + o["fork"]) if o["fork"] else ""} | {note} | `{(o["source"] or "").replace("|","/")}` |')
    return "\n".join(lines)

def write_readme():
    c, shapes = counts()
    md = f"""---
sketch: 102
name: modal-census
question: "Which shape does every overlay in the app take — and which overlays should not exist at all?"
winner: null
tags: [modal, sheet, panel, popover, census, mudavym, design-system, adr-0112]
---

# Sketch 102 · Every overlay, in its shape

## Design question

The founder, 2026-09-05: *"finalize all modal windows for all pages."* Sketch 099 drew the three
shapes on the first pages that used them; ADR 0112 built the primitive. This sketch reads **every**
place the web app opens something over the page — 141 sites, folded into 117 overlays plus the three the founder's rulings added ({c["total"]} rows), on {len([p for p in C.PAGES if p["route"]!="shell"])} pages plus the shell — and gives each
one the shape the policy gives it, or a reason it has none.

## How to view

```
open .planning/sketches/102-modal-census/index.html
```

Published gallery: <https://claude.ai/code/artifact/23f77c68-7766-40c8-934a-cfa7148c7508> — update THAT url, never republish new (`build.py --artifact PATH` then republish the same path).
Renders from `file://`, no server. Follows the viewer's `prefers-color-scheme`; the Ground control
pins paper or charcoal; four specimens are pinned to charcoal on purpose (the portal carrying the
page's ground). Filter by shape and by status.

**Regenerate:** `python3 .planning/sketches/102-modal-census/build.py` (add `--docs` to refresh the
`Overlays` subsection in each page doc; `--artifact PATH` for the published gallery fragment).
`census.py` is the single source of truth; `census.json` and `index.html` are build products.

## The rule this sketch applies

> **An object gets a sheet. A question gets a panel. A choice gets a popover.**
> The seal never sits in a popover. Wax is for a real commitment; bulk gets the plain die.

## The numbers

| | |
|---|---|
| Overlay sites read · census rows | 141 · {c["total"]} |
| Built on the primitive | {c["built"]} |
| Migrate — legacy inside a house-flagged page today | {c["migrate"]} |
| Owed — an act the rebuilt page does not yet offer | {c["owed"]} |
| Target — page not yet rebuilt, shape decided | {c["target"]} |
| Retires with the legacy page | {c["retire"]} |
| Delete — nobody imports it | {c["delete"]} |
| Not a shape (paint, a label) | {c["none"]} |
| Drawn: sheets · panels · popovers | {shapes["sheet"]} · {shapes["panel"]} · {shapes["popover"]} |
| Behaviours drawn from the research (nothing built) | {c["pattern"]} |

## Files

- **`index.html`** — the census: the shell, then every page in route order, specimens drawn at the
  primitive's real widths (440 · 640 wide · 620 · 320), tombstones for what retires or is deleted,
  the pages that open nothing, the seven forks, the method.
- **`census.py`** — the source of truth. Edit here.
- **`census.json`** — the same data for tools (the page-doc subsections are generated from it).
- **`build.py`** — the builder.
- **`BUILD-PROMPT.md`** — the LLM-ready brief for building these overlays: the rules, the primitive's exact contract, the non-modal class, the ceremonies, five work packets generated from the census, and what "done" means. Paste it whole into a fresh session, or hand one packet to one agent.
- **`research/`** — the research behind the Behaviours section: three angles (A–C), the implementation references (D), the adversary's verdicts (E), the security ceremonies (F) and the lead's own pass over them (G), the deep pass on the assistant's and tool-write ceremonies (H) and its check (I), plus the adversary's brief.

## What to look for

- Does every **Owed** row deserve its shape, or is the house idiom (expand in place) the answer? F5 and F7 are exactly this.
- **/inventory** is the one page whose flag turns on nothing new — legacy and next are the same component, so its eight modals are live inside a house-flagged page today. Are seven migrations the right cost, or does the page get rebuilt first?
- The **studio invite** is the same act as the team invite. Reusing the one exception component keeps the policy at one exception; a second component would trigger ADR 0112's collapse clause (F2).
- Two bells and two user menus exist (F6).

## The forks

{chr(10).join(f"- **{a} — {b}** {c_}" + (f" **Answered:** {C.ANSWERS[a]}" if a in C.ANSWERS else " *(open)*") for a, b, c_ in C.FORKS)}

## Pages that open nothing

{", ".join(f"`{r}`" for r in C.NO_OVERLAY)}

## The census

{md_table(C.PAGES)}

## Method

Tree: {C.META["tree"]}. Every `.tsx` under `apps/web/src` (tests and stories excluded) was scanned
for a JSX `<Sheet>` / `<Panel>` / `<Popover>` whose import resolves to `components/mudavym`, a
`fixed inset-0` or `position: fixed` wrapper, and a Radix `*Content`. That gave 141 sites across
25 house files and 69 legacy files, folded into 117 overlays; the founder's rulings of 2026-09-05
added three owed sheets, so the census holds {c["total"]} rows. Each site was then read by hand for what it does and who opens
it. Page-local components that merely share a name (`ReportsNext`'s cutting `Sheet`, the dashboard
rail's `Panel`, the door's local `Panel`) were excluded; files nobody imports were checked twice
(`rg` for their basename across `apps/web/src`). The house branches inside the eight shell files
count once each. Widths and the close-in-words rule come from `components/mudavym/Sheet.tsx` and
`sheet.css`.

**Example data, not a tenant** — every name, figure and date in the specimens is invented for the drawing.
"""
    open(os.path.join(HERE, "README.md"), "w").write(md)


# ─────────────────────────────────────────── the build prompt ──
PROMPT_HEAD = """# Build prompt — the overlays of Mudavym

*Generated from `census.py` by `build.py`. Edit the census or `build.py`, never this file.*
*Paste the whole file into a fresh Claude Code session at the repo root, or hand one `##`
packet to one agent. Every number and path below was read from the tree on {date}.*

---

## 0. Who you are, and what you are building

You are building the overlay layer of **Mudavym**, an autonomous restaurant-operations platform
(a Vite + React SPA in `apps/web`, a NestJS gateway in `apps/api-gateway`, Supabase Postgres, a
React Native app in `apps/mobile`). An "overlay" is anything that appears over the page: a record's
detail, a question, a menu, a preview, a toast.

The policy is **locked** — [`.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md`](../../decisions/0112-one-modal-policy-three-shapes-one-primitive.md).
You are not designing it. You are building what it decided, to the founder's bar:

> *"everything we touch, they have must all fully serve to their purpose to their max capacity
> meaning functionality, endpoints, UI UX, smoothness, and most importantly the design."*

A re-skin of an old modal fails that bar. So does a beautiful surface over a dead endpoint.

**Read before you write anything** (in this order, and do not skip the third):

1. `.planning/decisions/0112-one-modal-policy-three-shapes-one-primitive.md` — the policy, the
   twelve founder rulings, the security fit per act.
2. `apps/web/src/components/mudavym/Sheet.tsx` and `sheet.css` — the primitive you are using.
   Its header comments carry the reasoning; the numbers below are read from it.
3. `.planning/sketches/102-modal-census/index.html` — **every overlay drawn**, at the primitive's
   real widths, with its source and the reason for its shape. Open it. Your packet is drawn there.
4. `.planning/06-pages/<page>.md` §1a, §9, §13 and the `Overlays` subsection — the page you are
   touching, in the house's own words.

---

## 1. The rules. Break one and the work is rejected

1. **Three shapes, chosen by what the reader must do next.** An object gets a **Sheet** (right,
   440px; 640 with `wide` for a letter). A question gets a **Panel** (centred, 620px). A choice
   gets a **Popover** (anchored, 320px). Never by how much content there is, never by which page.
2. **One primitive.** `components/mudavym/Sheet.tsx` exports `Sheet`, `Panel`, `Popover`. It owns
   focus (moves in on open, cycles on Tab, returns to the opener on close), Esc, the counted body
   scroll lock, the scrim, the portal and the ground. **Never hand-roll `fixed inset-0`.** Never
   add a fourth modal shape.
3. **The seal is rationed.** A real commitment (approving an order, releasing a payment, writing
   off stock, recording a count, publishing a week, sending a letter) ends with `HoldToApprove` —
   the wax. Bulk gets a plain button. **The seal never sits in a Popover**: an approval reached
   from the bell opens the Panel first.
4. **The close control is words** (`closeLabel`, default "Close"), never an X. The house never
   invented a glyph and does not start now.
5. **AI proposes, a person applies.** A suggestion is a layer on the record, never an
   already-changed cell. The person's words stay ink; the engine's stay grey, permanently.
   A draft never looks sent.
6. **Absence is never health.** No invented zero, no placeholder figure, no cheerful empty state
   that hides a missing read. Every figure names the rows it summed; every flag names the rule it
   tripped; when the book holds nothing, the overlay says so in words.
7. **A page with its flag off renders byte-for-byte as it always has.** Every house branch is
   gated. `shellOverlays.test.tsx` pins the literal legacy class strings — if you change a legacy
   branch, that test must fail, and you must stop.
8. **One chromatic colour** (İznik teal, `--seal`) on paper or Warm Charcoal ink. **No emoji,
   anywhere** — a guard checks. Tokens only, never a literal hex.
9. **The house idiom is expansion.** If the reader stays on the list, expand the row in place and
   show the working; open a surface only when the reader leaves the list behind.
10. **Ceremony is seconds.** Hold is intent; a device prompt is identity; never stack a third
    confirmation. The reason field appears only on break-glass.

---

## 2. The primitive, exactly

```tsx
import {{ Sheet, Panel, Popover }} from '@/components/mudavym';

<Sheet
  open={{!!row}} onClose={{() => setRow(null)}}
  label="Order 118"                 // required: an accessible name; an overlay with no name is a room with no sign
  eyebrow="Vendor answers"          // mono, uppercase, seal-deep — what kind of thing this is
  title="Öküzgözü 2022"             // Fraunces — the product speaking
  action={{<button …/>}}              // header-right, left of Close
  footer={{<span>…</span>}}           // the quiet line under the body
  wide                              // 640 instead of 440. A LETTER only (sketch 100). A third width needs an ADR.
  closeLabel="Close"                // words
  initialFocusRef={{ref}}             // defaults to the first focusable
  zIndex={{100}}                      // default 100
>{{children}}</Sheet>
```

`Popover` additionally takes `anchorRef` (required) and `width` (default 320), and is **non-modal**
by default. `modal` on a Popover restores the trap, the lock and the dim — the system has **one**
such exception, `components/team/InviteTeamDialog.tsx` (a form that commits, anchored under its
button). The studio invite reuses that same component with a second opener; a second *component*
wanting `modal` is the signal to collapse the policy, and you stop and ask.

**Geometry and motion, from `sheet.css` and `lib/mudavym/motion.ts`:**

| Shape | Width | Enter | Token | ms |
|---|---|---|---|---|
| Sheet | 440 (`wide` 640), full-bleed under 640px viewport | `translateX(28px)` → none | `tuck` | 300 |
| Panel | `min(620px, 100vw − 32px)`, `margin-top: 10vh`, `max-height: 76vh` | `translateY(6px)` → none | `settle` | 320 |
| Popover | 320, `max-height: 72vh`, placed 10px under the anchor | `translateY(4px)` → none | `ink` | 160 |

`prefers-reduced-motion` renders **no** animation, not a shorter one. The panel's flex is
`align-items: flex-start` and the body is `flex: 0 1 auto` — both load-bearing: `stretch` made an
overlay holding one sentence render as 700px of empty paper.

**The ground is a DOM fact.** Tokens live on `.mudavym`, never `:root`, so a portalled node has no
tokens unless its own root carries `.mudavym` and, on charcoal, `data-ground` on that same element.
The primitive resolves most-specific-first: an explicit `ground` prop → `MudavymGroundContext` →
the nearest `.mudavym` ancestor of the opener → the shell store. Each reader returns `null` rather
than a paper default, because a default there is an absence reported as an answer.

**The shell gate.** `lib/mudavym/shellGround.ts` is a tiny external store `PageGate` claims while a
`next` tree is mounted. The eight shared shell overlays render the house shape only while it is on.
Nothing else writes to that store.

**The flag.** Every rebuilt page sits behind `mudavym_design_<page>`, a per-restaurant row in
`restaurant_feature_flags` read through `lib/mudavym/useMudavymDesign.ts` (`MUDAVYM_PAGES`). The
dev override is `localStorage['mudavym.design.<page>'] = '1'`. **Adding a slug shifts the readBy
anchor** — run `python3 scripts/check_flag_readby_anchors.py` after any `MUDAVYM_PAGES` edit.

---

## 3. The non-modal class (decided 2026-09-05, fork F8)

Six surfaces are **not shapes** and do not count against the three. Two constraints bind all six:
**no scrim and no focus trap; never a form and never the seal.**

- **Peek** — 400px beside the list. Space opens, ↑↓ step rows, Enter promotes it to the Sheet, Esc
  closes. The list stays live behind it.
- **Hover card** — 300px on a referenced name; dismissed by moving away; its own menu is
  open/copy-link only.
- **Undo toast** — the act fires, the way back is offered for a few seconds.
- **Bulk bar** — `x` toggles, `⇧` ranges, `⌘A` all, `Esc` clears; a plain button, never wax.
- **Bottom sheet** — the Sheet's phone form, resting at detents (peek · half · full; the grabber
  appears only when there is more than one height). Stacked sheets cap at **three**, with a
  breadcrumb.
- **The expanded row** — the house idiom; rule 9 above.

**Undo-after applies to a closed list** (fork F10): dismiss an entry, archive a thread, remove a
shift, a note, and a door count corrected within ten minutes. **Money, sends and ledger rows keep
the seal before.** Adding to that list is an ADR amendment, never a builder's call.

---

## 4. Authority and the ceremonies (forks F11–F12)

- **The authority rule.** One approval when the approver holds valid authority — an owner, a
  manager, or a person the owner authorized — and **double approval otherwise**. Separation of
  duties survives inside it: whoever confirms a vendor's bank detail cannot release the first
  payment to it.
- **Every security change is told to every owner** — a bank detail, an authority grant or
  revocation, a passcode reset, a limit change, a device added. A producer, not a ceremony.
- **Step-up** before money moves or a config applies when the session's last verification is older
  than two hours, read from a timestamp the gateway persists per session (Supabase has no
  `auth_time`; its JWT carries `amr`). A successful seal re-arms the window.
- **The seal proves who**: a house-owned WebAuthn ceremony — the hold begins, the server mints a
  single-use challenge encoding `hash(nonce ‖ amount ‖ payee ‖ order ‖ expiry)`, the release calls
  `navigator.credentials.get` with `userVerification: "required"`, the server verifies and consumes
  it. Web and mobile ship together. **Never build the mobile seal on `expo-local-authentication`** —
  a device-local prompt proves nothing to a server.
- **Break-glass**: owner-only, a written reason, every owner told at the moment, marked in the
  trail, reviewed within 48 hours by another owner, and the outcome told.
- **Grants** are rows: grantor, grantee, scope, limit, expiry, revoked-at, with *granted by* visible
  wherever the authority is used; expiry enforced server-side; grantor ≠ approver enforced in the
  database. Any owner may revoke any grant.
- **One tamper-evident `security_events` ledger.** Step-up verifications, break-glass uses and
  grant checks all write to it; the trail and the owners' notices read from it.

---

## 5. Build order

1. **The ten migrations** — legacy overlays rendering *inside* a house-flagged page today. Eight
   are on `/inventory`, whose flag turns on the same component (`App.tsx:311`), so a tenant with
   that flag on already sees them. This is the only packet with a live inconsistency in it.
2. **The twelve owed acts** — what a rebuilt page cannot yet do that its legacy page could.
3. **The seven targets** — pages not yet rebuilt whose overlays take their shape when they are.
4. **The fifteen deletions** — after 1–3 land, so nothing is deleted before its replacement exists.
5. **The behaviours** — the non-modal class and the ceremonies, each its own ADR-amendment-sized
   piece of work.

---
"""

PROMPT_TAIL = """
---

## {n}. What "done" means for one overlay

Every one of these, for every overlay you touch. A packet with any box unticked is reported as
unfinished, never as done.

- [ ] **The shape is the one the census gives it**, and the reason still holds. If you believe it
      is wrong, say so in the report and stop — do not quietly build a different shape.
- [ ] **On the primitive.** No `fixed inset-0`, no private Esc handler, no second focus effect, no
      hand-rolled scrim. The close control is words.
- [ ] **The endpoint is real and exercised.** Name the route and the controller `file:line` in the
      report. A surface over a route that does not exist is the failure this house calls hollow.
- [ ] **Four states, honestly**: empty, loading, error, permission-denied. The error says what did
      not happen in words the operator can act on ("The entry was not saved. It is unchanged."),
      never a toast that implies a write that did not land.
- [ ] **Provenance where a figure appears.** The rows it summed, the date it was read, who wrote it.
- [ ] **Motion is a house token** (`tuck` · `settle` · `ink`); reduced motion renders none.
- [ ] **Both grounds.** Paper and charcoal, checked, not assumed — the portal carries the ground.
- [ ] **Keyboard.** Tab cycles inside; Esc closes; focus returns to the opener; the anchored
      surfaces are reachable without a mouse.
- [ ] **Tests.** The overlay's own spec plus a regression that fails against the pre-fix code —
      prove it by running the test against a copy (`git show HEAD:path > /tmp/x`), **never by
      stashing or resetting the shared worktree**.
- [ ] **Flag off is byte-identical.** `shellOverlays.test.tsx` and the page's own legacy render.
- [ ] **The page doc is updated in the same session** — §1a features, §9 gaps, the Motions table,
      and the `Overlays` subsection via `python3 .planning/sketches/102-modal-census/build.py --docs`
      after editing `census.py`. Work that is not documented did not happen.

## {n2}. Verify, then report

```bash
cd apps/web && pnpm run typecheck && pnpm run lint && pnpm run test:run -- <your spec path>
cd ../api-gateway && pnpm run typecheck && pnpm run test -- <your spec path>
python3 scripts/check_flag_readby_anchors.py      # after any MUDAVYM_PAGES edit
python3 scripts/check_citation_pairing.py && python3 scripts/check_adr_numbers_unique.py
```

Run **both** tsconfigs (the app config and `tsconfig.spec.json`) before you claim green, and paste
**your own** measured counts — never a number you did not watch print. Screenshot the overlay on
both grounds and say which theme each shot is.

**Report honestly.** If you narrowed scope, skipped a check, or could not verify something, say so
in the first three lines. A partial result reported as complete is the one unrecoverable failure
here.

## {n3}. When you hit a fork

Some of these packets will raise a question only the founder can answer (a shape that does not fit,
an act with no home, a ceremony that would slow a floor down). **Ask it the moment you find it**,
with the options and their costs and your recommendation — do not default it, do not batch it to
the end, and do not stop the rest of the work while you wait. Then record the answer in ADR 0112
and in `census.py`, and rebuild.

## {n4}. Never

- Never `git add -A` or `git commit -a` — several sessions drive this repo at once; commit with
  explicit paths.
- Never `git stash` — the stash is repo-global across every worktree.
- Never edit a generated file (`index.html`, `census.json`, `README.md`, a page doc's `Overlays`
  table). Edit `census.py` or `build.py` and rebuild.
- Never delete a legacy modal before the act it carries exists somewhere else.
- Never invent a figure, a zero, or a success message for a write that did not land.
"""

def packet_lines(status):
    out = []
    for pg in C.PAGES:
        rows = [o for o in pg["overlays"] if o["status"] == status]
        if not rows: continue
        out.append(f"\n**`{pg['route']}`**" + (f" — flag `{pg['flag']}`" if pg["flag"] else "") + "\n")
        for o in rows:
            shape = (o["shape"] or "—") + (" · wide" if o["wide"] else "") + (" · modal" if o["modal"] else "") + (" · seal" if o["seal"] else "")
            note = (o["why"] if o["status"] in DRAWN else (o["went"] or "")).replace("<b>", "**").replace("</b>", "**")
            out.append(f"- **{o['name']}** — {shape}. {note}\n  `{o['source']}`")
    return "\n".join(out)

def write_build_prompt():
    c, _ = counts()
    body = [PROMPT_HEAD.format(date=C.META["date"])]
    packs = [
        ("Packet 1 — the ten migrations", "migrate",
         "These render legacy markup inside a house-flagged page **today**. Move each onto the primitive, "
         "shape as given, copy and behaviour preserved word for word unless the census says otherwise. "
         "`/inventory` is the urgent one: its flag turns on the same component, so a tenant with it on sees these now."),
        ("Packet 2 — the twelve owed acts", "owed",
         "A rebuilt page cannot do something its legacy page could. Build the act, not a shell: the endpoint, the four "
         "states, the provenance, the ceremony. Several need a gateway route that does not exist yet — say so and build it."),
        ("Packet 3 — the seven targets", "target",
         "Pages not yet rebuilt. Do not rebuild the page to do these; take the shape when the page's own rebuild happens, "
         "and leave the drawing as the contract."),
        ("Packet 4 — the fifteen deletions", "delete",
         "Files nobody imports, or whose act now lives somewhere built. Before deleting: grep the basename across "
         "`apps/web/src` to confirm nothing imports it, and state in the commit what the act does now instead."),
        ("Packet 5 — the behaviours", "pattern",
         "The non-modal class and the ceremonies, drawn in the sketch. Each is a piece of foundation work, not a page "
         "change: build it once in `components/mudavym`, prove it with its own spec, then adopt it page by page."),
    ]
    for i, (title, status, blurb) in enumerate(packs, start=6):
        body.append(f"\n## {i}. {title}\n\n{blurb}\n{packet_lines(status)}\n")
    n = 6 + len(packs)
    body.append(PROMPT_TAIL.format(n=n, n2=n + 1, n3=n + 2, n4=n + 3))
    open(os.path.join(HERE, "BUILD-PROMPT.md"), "w").write("\n".join(body))

MARK = "<!-- sketch-102-overlays -->"
def doc_section(doc, pages):
    lines = [f"### Overlays, 2026-09-05 (sketch 102 · ADR 0112)", "", MARK,
             "Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.",
             "The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.", ""]
    for p in pages:
        lines.append(f"**`{p['route']}`** — {p['verdict']}"); lines.append("")
    tbl = md_table(pages)
    if any(p["overlays"] for p in pages): lines.append(tbl); lines.append("")
    lines.append("Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].")
    lines.append("")
    return "\n".join(lines)

def apply_docs():
    root = os.path.abspath(os.path.join(HERE, "..", "..", "06-pages"))
    by_doc = collections.OrderedDict()
    for p in C.PAGES:
        if p["doc"]: by_doc.setdefault(p["doc"], []).append(p)
    for doc, pages in by_doc.items():
        path = os.path.join(root, doc)
        if not os.path.exists(path): print("  MISSING doc", doc); continue
        s = open(path).read()
        sec = doc_section(doc, pages)
        if MARK in s:
            # replace the whole existing generated subsection (from its heading to the next heading of level ### or ##)
            s = re.sub(r"### Overlays, 2026-09-05 \(sketch 102 · ADR 0112\)\n.*?(?=\n## |\n### |\Z)", sec.rstrip("\n") + "\n", s, count=1, flags=re.S)
            open(path, "w").write(s); print("  refreshed", doc); continue
        anchor = None
        if re.search(r"^## 1b\.", s, re.M): anchor = re.search(r"^## 2\. Entry", s, re.M)
        if anchor is None: anchor = re.search(r"^## 13\. Roadmap", s, re.M)
        if anchor is None:
            s = s.rstrip("\n") + "\n\n" + sec
        else:
            s = s[:anchor.start()] + sec + "\n" + s[anchor.start():]
        open(path, "w").write(s); print("  inserted into", doc)

if __name__ == "__main__":
    write_json(); write_index(); write_readme(); write_build_prompt()
    c, shapes = counts(); print("counts:", dict(c), "drawn shapes:", dict(shapes))
    if "--artifact" in sys.argv: write_artifact(sys.argv[sys.argv.index("--artifact") + 1]); print("artifact written")
    if "--docs" in sys.argv: apply_docs()
