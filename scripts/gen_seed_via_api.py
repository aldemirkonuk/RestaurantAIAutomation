#!/usr/bin/env python3
"""API-driven seed generation for grape_varieties, appellation_rules, vintage_rules."""
import os, sys, time, re, pathlib
import anthropic

SEED_DIR = pathlib.Path("supabase/migrations/seed")
SEED_DIR.mkdir(parents=True, exist_ok=True)

API_KEY = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY")
if not API_KEY:
    sys.exit("ERROR: Set ANTHROPIC_API_KEY or CLAUDE_API_KEY")

client = anthropic.Anthropic(api_key=API_KEY)
MODEL = "claude-opus-4-5"


def call(prompt, max_tokens=16000):
    r = client.messages.create(model=MODEL, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}])
    return r.content[0].text


def fix_aliases(sql):
    def _j2p(m):
        items = re.findall(r'"([^"]+)"', m.group(1))
        if not items: return "'{}'"
        return "'{" + ",".join(i.replace("'","''") for i in items) + "}'"
    return re.sub(r"'\[([^\]]*)\]'", _j2p, sql)


def extract(text, table):
    lines = []
    for line in text.split("\n"):
        s = line.strip()
        if re.match(rf"INSERT\s+INTO\s+{re.escape(table)}\s*\(", s, re.I):
            if not s.endswith(";"): s += ";"
            s = fix_aliases(s)
            lines.append(s)
    return lines


def write_file(fname, header, lines):
    p = SEED_DIR / fname
    p.write_text(f"-- {header}\n-- Source: claude-opus-seed-v1\n\n" + "\n".join(lines) + "\n")
    return len(lines)


# ── grape_varieties ─────────────────────────────────────────────────────────
GRAPE_PROMPT_RED = """Generate SQL INSERT INTO grape_varieties (name, canonical_name, color, family, aliases, typical_regions, typical_blending_partners) for 220+ distinct RED grape varieties.

Include: Cabernet Sauvignon, Merlot, Pinot Noir, Syrah, Nebbiolo, Sangiovese, Tempranillo, Grenache Noir, Barbera, Dolcetto, Mourvèdre, Zinfandel, Malbec, Carménère, Touriga Nacional, Touriga Franca, Tinta Roriz, Alicante Bouschet, Trincadeira, Tinta Barroca, Sousão, Bastardo, Castelão, Baga, Nero d'Avola, Nerello Mascalese, Nerello Cappuccio, Gaglioppo, Aglianico, Negramaro, Nero di Troia, Lagrein, Schiava, Teroldego, Marzemino, Pignolo, Refosco, Raboso, Corvina, Corvinone, Rondinella, Molinara, Sagrantino, Montepulciano, Canaiolo, Colorino, Ciliegiolo, Cesanese, Monica, Carignano, Cinsaut, Frappato, Primitivo, Malvasia Nera, Piedirosso, Casavecchia, Tintilia, Pallagrello Nero, Bombino Nero, Susumaniello, Blaufränkisch, Zweigelt, St. Laurent, Pinotage, Counoise, Vaccarèse, Muscardin, Terret Noir, Piquepoul Noir, Graciano, Mencía, Garnacha Tintorera, Juan García, Prieto Picudo, Bobal, Mandó, Feteasca Neagra, Kadarka, Portugieser, Dornfelder, Spätburgunder, Meunier, César, Gamay Noir, Mondeuse, Persan, Poulsard, Trousseau, Pineau d'Aunis, Grolleau, Cabernet Franc, Petit Verdot, Marselan, Tannat, Fer Servadou, Négrette, Duras, Abouriou, Xinomavro, Agiorgitiko, Mavrodaphne, Limnio, Mavrotragano, Kotsifali, Mandilari, Liatiko, Saperavi, Aleksandrouli, Rkatsiteli (some red-skinned), Ojaleshi, Müller-Thurgau (some red), Regent, Cabernet Mitos, Cabernet Cortis, Muscaris (red), Solaris (red), Johanniter (some red), Rondo, Léon Millot, Maréchal Foch, Baco Noir, Chambourcin, Vidal Blanc (red cross), Corot Noir, Noiret, Marquette, Frontenac, La Crescent (red), Chancellor, De Chaunac, Villard Noir, plus more varieties from Southern Italy, Greece, Georgia, Portugal, and Spain.

Rules:
- canonical_name: lowercase, underscores for spaces (pinot_noir, cabernet_sauvignon)  
- color: exactly 'red' for all entries in this batch
- aliases: PostgreSQL TEXT[] — '{alias1,alias2}' — include ALL common synonyms
  Key aliases: Syrah→'{shiraz,petite_syrah}', Garnacha→'{grenache,cannonau,aragones}', Tempranillo→'{tinto_fino,tinta_del_pais,aragones,cencibel,ull_de_llebre}', Malbec→'{cot,auxerrois,pressac,cote}', Primitivo→'{zinfandel}', Monastrell→'{mourvedre,mataro}', Carignane→'{carignan,mazuelo,carinena}', Graciano→'{morrastel,tinto_menudo}', Mencía→'{jaen}', Lemberger→'{blaufrankisch,kekfrankos}', Spätburgunder→'{pinot_noir}', Meunier→'{pinot_meunier}', Uva di Troia→'{nero_di_troia}', Tinta Roriz→'{aragonez,tempranillo}', Corvina→'{corvina_veronese}', Touriga Franca→'{touriga_francesa}'
- typical_regions: '{region1,region2}' — 2-5 regions
- typical_blending_partners: '{grape1,grape2}' — 2-4 grapes or '{}'
- Output ONLY valid SQL INSERT statements, one per line, each ending with semicolon, no other text"""

GRAPE_PROMPT_WHITE = """Generate SQL INSERT INTO grape_varieties (name, canonical_name, color, family, aliases, typical_regions, typical_blending_partners) for 220+ distinct WHITE, ROSÉ, and ORANGE grape varieties.

Include: Chardonnay, Sauvignon Blanc, Riesling, Pinot Gris, Gewürztraminer, Viognier, Albariño, Verdejo, Vermentino, Grüner Veltliner, Muscat Blanc à Petits Grains, Muscat of Alexandria, Moscato Giallo, Torrontés, Chenin Blanc, Sémillon, Roussanne, Marsanne, Clairette, Bourboulenc, Picpoul Blanc, Grenache Blanc, Macabeo, Xarel·lo, Parellada, Airén, Palomino Fino, Pedro Ximénez, Verdelho, Arinto, Loureiro, Trajadura, Viosinho, Roupeiro, Antão Vaz, Fernão Pires, Bical, Encruzado, Sercial, Bual, Terrantez, Malvasia Fina, Malvasia Rei, Malvasia Candida, Malvasia delle Lipari, Fiano, Greco di Tufo, Coda di Volpe, Falanghina, Biancolella, Pallagrello Bianco, Verdicchio, Pecorino, Passerina, Trebbiano Toscano, Trebbiano d'Abruzzo, Bombino Bianco, Turbiana, Friulano, Ribolla Gialla, Malvasia Istriana, Verduzzo, Picolit, Vitovska, Glera, Garganega, Catarratto, Grecanico Dorato, Carricante, Nuragus, Nasco, Savagnin, Kerner, Müller-Thurgau, Silvaner, Elbling, Bacchus, Scheurebe, Rieslaner, Huxelrebe, Ortega, Optima, Pinot Blanc, Auxerrois, Chasselas, Welschriesling, Furmint, Hárslevelű, Kabar, Kövérszőlő, Zéta, Juhfark, Sárga Muskotály, Dimiat, Rkatsiteli, Mtsvane Kakhuri, Chinuri, Goruli Mtsvane, Khikhvi, Kisi, Tsolikouri, Tsitska, Krakhuna, Assyrtiko, Moschofilero, Malagouzia, Robola, Lagorthi, Debina, Vilana, Dafni, Plyto, Vidiano, Savvatiano, Romeiko, Athiri, Sultaniye, Gewürztraminer, plus Grenache Gris, Pinot Grigio Ramato (orange style), Ribolla Gialla orange, Schiava Grigia, Gewürztraminer gris, Ramato. Also include: Colombard, Ugni Blanc, Folle Blanche, Melon de Bourgogne, Muscadelle, Rolle, Rolle/Vermentino distinction, Rolle (Provence), Picpoul de Pinet, Rolle (Corsica), Vermentino (Sardinia), Vernaccia di San Gimignano, Vernaccia di Oristano, Zibibbo, Nero d'Avola Bianco (skin-contact), plus hybrid varieties: Solaris, Johanniter, Souvignier Gris, Muscaris, Calardis Blanc, Helios, Orion, Hibernal, Seyval Blanc, Vidal Blanc, Cayuga White, Aurora, Vignoles, Traminette, Chardonel, Frontenac Gris, La Crescent white, Marquette white, GR 7, NY 65.533.13, St. Pepin, Edelweiss, Prairie Star, Swenson White.

Rules:
- canonical_name: lowercase, underscores for spaces
- color: 'white' for white varieties, 'rosé' for rosé/gris varieties, 'orange' for orange-style varieties
- aliases: PostgreSQL TEXT[] — '{alias1,alias2}' — include ALL common synonyms
  Key aliases: Sauvignon Blanc→'{fume_blanc,blanc_fume}', Pinot Gris→'{pinot_grigio,grauburgunder,malvoisie,rulander}', Gewürztraminer→'{traminer,roter_traminer,savagnin_rose}', Albariño→'{alvarinho}', Vermentino→'{rolle,pigato,favorita}', Grüner Veltliner→'{gruner_veltliner,gruner}', Chenin Blanc→'{steen,pineau_de_la_loire,vouvray}', Trebbiano→'{ugni_blanc,clairette_of_languedoc}', Macabeo→'{macabeu,viura}', Friulano→'{tocai_friulano,sauvignonasse}', Palomino→'{listan_blanco}', Müller-Thurgau→'{rivaner}', Silvaner→'{sylvaner,johannisberg_riesling}', Chasselas→'{gutedel,fendant,pendant}', Welschriesling→'{riesling_italico,olaszrizling,laski_rizling}', Glera→'{prosecco}', Muscadet→'{melon_de_bourgogne}', Pedro Ximénez→'{px}', Turbiana→'{trebbiano_di_lugana}', Ribolla Gialla→'{rebula}', Assyrtiko→'{santorini}', Savagnin→'{traminer_nature,heida}', Sémillon→'{semillon_blanc}'
- typical_regions: '{region1,region2}' — 2-5 regions  
- typical_blending_partners: '{grape1,grape2}' — 2-4 grapes or '{}'
- Output ONLY valid SQL INSERT statements, one per line, each ending with semicolon, no other text"""

APPELLATION_PROMPT = """Generate SQL INSERT INTO appellation_rules (appellation_name, required_grapes, allowed_grapes, min_aging_months, min_vintage_release_delay_months, allowed_colors, classification_levels, source_ref) for 130+ major wine appellations worldwide.

Include EXACTLY these and more: Barolo DOCG, Barbaresco DOCG, Brunello di Montalcino DOCG, Brunello Riserva, Chianti DOCG, Chianti Classico DOCG, Chianti Classico Riserva, Chianti Classico Gran Selezione, Vino Nobile di Montepulciano DOCG, Morellino di Scansano DOCG, Amarone della Valpolicella DOCG, Recioto della Valpolicella DOCG, Soave Superiore DOCG, Sagrantino di Montefalco DOCG, Taurasi DOCG, Greco di Tufo DOCG, Fiano di Avellino DOCG, Primitivo di Manduria DOCG, Cerasuolo di Vittoria DOCG, Franciacorta DOCG, Valtellina Superiore DOCG, Sforzato di Valtellina DOCG, Barolo Riserva, Barbaresco Riserva, Champagne NV, Champagne Vintage, Champagne Blanc de Blancs, Champagne Blanc de Noirs, Champagne Prestige Cuvée, Chablis Grand Cru, Chablis Premier Cru, Gevrey-Chambertin Premier Cru, Gevrey-Chambertin Grand Cru, Chambolle-Musigny Premier Cru, Vosne-Romanée Grand Cru, Nuits-Saint-Georges Premier Cru, Meursault Premier Cru, Puligny-Montrachet Grand Cru, Chassagne-Montrachet Grand Cru, Pommard Premier Cru, Volnay Premier Cru, Corton Grand Cru, Beaune Premier Cru, Côte-Rôtie, Hermitage, Crozes-Hermitage, Cornas, Saint-Joseph, Condrieu, Châteauneuf-du-Pape, Gigondas, Vacqueyras, Sancerre, Pouilly-Fumé, Vouvray, Muscadet Sèvre et Maine, Savennières, Saumur-Champigny, Bordeaux AOC, Pauillac, Saint-Julien, Margaux, Saint-Estèphe, Pessac-Léognan, Sauternes, Graves, Pomerol, Saint-Émilion Grand Cru, Rioja Joven, Rioja Crianza, Rioja Reserva, Rioja Gran Reserva, Ribera del Duero Crianza, Ribera del Duero Reserva, Ribera del Duero Gran Reserva, Priorat DOCa, Rías Baixas DO, Rueda DO, Napa Valley Cabernet Sauvignon, Willamette Valley Pinot Noir, Willamette Valley Chardonnay, Mosel Riesling Spätlese, Mosel Riesling Auslese, Pfalz Riesling Spätlese, Rheingau Riesling Spätlese, Grüner Veltliner Smaragd (Wachau), Grüner Veltliner Federspiel, Grüner Veltliner Steinfeder, Riesling Smaragd (Wachau), Barossa Valley Shiraz, McLaren Vale Shiraz, Coonawarra Cabernet Sauvignon, Margaret River Cabernet Sauvignon, Hunter Valley Semillon, Marlborough Sauvignon Blanc, Central Otago Pinot Noir, Hawke's Bay Syrah, Mendoza Malbec, Valle de Uco Malbec, Cafayate Torrontés, Colchagua Valley Carménère, Casablanca Valley Sauvignon Blanc, Tokaji Aszú, Tokaji Eszencia, Douro Tinto, Port Vintage, Port LBV (Late Bottled Vintage), Port Tawny 10yr, Port Tawny 20yr, Madeira Sercial, Madeira Verdelho, Madeira Bual, Madeira Malmsey, Cava NV, Cava Reserva, Cava Gran Reserva, Crémant d'Alsace, Crémant de Bourgogne, Crémant de Loire, Beaujolais Nouveau, Alsace Grand Cru Riesling, Alsace Grand Cru Gewurztraminer, Alsace Grand Cru Pinot Gris.

Rules:
- required_grapes: JSONB array '[{{"grape": "Nebbiolo", "min_pct": 100}}]' or '[]'
- allowed_grapes: JSONB array or '[]'
- min_aging_months INTEGER: total minimum aging (0 if none specified)
- min_vintage_release_delay_months INTEGER: months from harvest to legal release
  CRITICAL values: Barolo=38, Barolo Riserva=62, Barbaresco=26, Barbaresco Riserva=50, Brunello=60, Brunello Riserva=72, Chianti Classico=12, Chianti Classico Riserva=24, Chianti Classico Gran Selezione=30, Amarone=24, Champagne NV=15, Champagne Vintage=36, Champagne Prestige=60, Beaujolais Nouveau=0, Rioja Joven=0, Rioja Crianza=24, Rioja Reserva=36, Rioja Gran Reserva=60, Ribera Reserva=36, Ribera Gran Reserva=60, Bordeaux AOC=0, Chablis=0, Sancerre=0, Barossa=0, Napa Valley=0, Wachau=0, Tokaji Aszú=18, Port Vintage=24, Port LBV=48
- allowed_colors: PostgreSQL TEXT[] literal — '{{red}}', '{{white}}', '{{red,white}}', '{{sparkling}}'
- classification_levels: TEXT[] — '{{DOCG}}', '{{AOC}}', '{{AVA}}', '{{DOCa}}', '{{DO}}'
- source_ref: 'claude-opus-seed-v1'
- Do NOT include id or appellation_id columns
- Output ONLY valid SQL INSERT statements, one per line, each ending with semicolon, no other text"""

VINTAGE_PROMPT = """Generate SQL INSERT INTO vintage_rules (appellation_name, rule_type, min_release_delay_months, allows_nv, notes, source_ref) for 40+ wine appellations with vintage constraints.

Include ALL of: Barolo Standard, Barolo Riserva, Barbaresco Standard, Barbaresco Riserva, Brunello di Montalcino Standard, Brunello di Montalcino Riserva, Chianti Classico Standard, Chianti Classico Riserva, Chianti Classico Gran Selezione, Amarone della Valpolicella Standard, Amarone della Valpolicella Riserva, Sagrantino di Montefalco Standard, Sagrantino di Montefalco Passito, Champagne NV, Champagne Vintage, Beaujolais Nouveau, Beaujolais Cru Standard, Chablis Grand Cru, Burgundy Grand Cru Standard, Bordeaux AOC Standard, Pessac-Léognan Standard, Sauternes Standard, Côte-Rôtie Standard, Hermitage Standard, Châteauneuf-du-Pape Standard, Sancerre Standard, Rioja Joven, Rioja Crianza, Rioja Reserva, Rioja Gran Reserva, Ribera del Duero Crianza, Ribera del Duero Reserva, Ribera del Duero Gran Reserva, Priorat Standard, Cava NV, Cava Reserva, Cava Gran Reserva, Napa Valley Cabernet Sauvignon Standard, Willamette Valley Pinot Noir Standard, Barossa Valley Shiraz Standard, Coonawarra Cabernet Standard, Marlborough Sauvignon Blanc Standard, Central Otago Pinot Noir Standard, Mendoza Malbec Standard, Tokaji Aszú Standard, Douro Tinto Standard, Port Vintage Standard, Port LBV Standard, Port Tawny NV, Madeira NV, Mosel Riesling Spätlese, Wachau Riesling Smaragd.

Rules:
- rule_type: exactly ONE of 'standard', 'riserva', 'gran_reserva', 'nouveau', 'special'
- min_release_delay_months: exact INTEGER matching real regulations:
  Barolo standard=38, Barolo Riserva=62, Barbaresco standard=26, Barbaresco Riserva=50, Brunello=60, Brunello Riserva=72, Chianti Classico=12, Chianti Classico Riserva=24, Chianti Classico GS=30, Amarone=24, Amarone Riserva=48, Champagne NV=15, Champagne Vintage=36, Beaujolais Nouveau=0, Rioja Joven=0, Rioja Crianza=24, Rioja Reserva=36, Rioja Gran Reserva=60, Ribera Crianza=24, Ribera Reserva=36, Ribera Gran Reserva=60, Cava NV=9, Cava Reserva=18, Cava Gran Reserva=30, Port Vintage=24, Port LBV=48, Tokaji Aszú=18, Bordeaux=0, Sancerre=0, Napa=0, Barossa=0, Champagne Prestige=60
- allows_nv: true ONLY for Champagne NV, Cava NV, Port Tawny NV, Madeira NV, Manzanilla, Fino, Amontillado, Oloroso; false for all others
- notes: brief factual note about the regulation
- source_ref: 'claude-opus-seed-v1'
- Do NOT include id or region_id columns
- Output ONLY valid SQL INSERT statements, one per line, each ending with semicolon, no other text"""


if __name__ == "__main__":
    print("=== API seed generation (grapes + appellations + vintage) ===")

    print("\n[1/4] grape_varieties - red batch...")
    t0 = time.time()
    raw = call(GRAPE_PROMPT_RED, 16000)
    red_rows = extract(raw, "grape_varieties")
    print(f"  {len(red_rows)} red grapes ({time.time()-t0:.0f}s)")

    print("[2/4] grape_varieties - white/rosé/orange batch...")
    t0 = time.time()
    raw = call(GRAPE_PROMPT_WHITE, 16000)
    white_rows = extract(raw, "grape_varieties")
    print(f"  {len(white_rows)} white/rosé/orange grapes ({time.time()-t0:.0f}s)")

    grape_rows = red_rows + white_rows
    n = (SEED_DIR / "09_grape_varieties_seed.sql").write_text(
        "-- Phase 9: grape_varieties seed data (≥400 rows with aliases)\n"
        "-- Source: claude-opus-seed-v1\n\n" + "\n".join(grape_rows) + "\n"
    ) or len(grape_rows)
    print(f"  Wrote grape_varieties: {len(grape_rows)} total rows")

    print("[3/4] appellation_rules...")
    t0 = time.time()
    raw = call(APPELLATION_PROMPT, 16000)
    app_rows = extract(raw, "appellation_rules")
    (SEED_DIR / "09_appellation_rules_seed.sql").write_text(
        "-- Phase 9: appellation_rules seed data (≥100 rows)\n"
        "-- Source: claude-opus-seed-v1\n\n" + "\n".join(app_rows) + "\n"
    )
    print(f"  {len(app_rows)} appellation_rules ({time.time()-t0:.0f}s)")

    print("[4/4] vintage_rules...")
    t0 = time.time()
    raw = call(VINTAGE_PROMPT, 8000)
    vint_rows = extract(raw, "vintage_rules")
    (SEED_DIR / "09_vintage_rules_seed.sql").write_text(
        "-- Phase 9: vintage_rules seed data (≥20 rows with release delays)\n"
        "-- Source: claude-opus-seed-v1\n\n" + "\n".join(vint_rows) + "\n"
    )
    print(f"  {len(vint_rows)} vintage_rules ({time.time()-t0:.0f}s)")

    print("\nResults:")
    print(f"  grape_varieties:   {len(grape_rows)}")
    print(f"  appellation_rules: {len(app_rows)}")
    print(f"  vintage_rules:     {len(vint_rows)}")

    assert len(grape_rows) >= 400, f"Need >=400 grapes, got {len(grape_rows)}"
    assert len(app_rows) >= 100, f"Need >=100 appellations, got {len(app_rows)}"
    assert len(vint_rows) >= 20, f"Need >=20 vintage rules, got {len(vint_rows)}"
    print("All assertions PASSED.")
