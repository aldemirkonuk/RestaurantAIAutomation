-- Phase 27 VENDOR-03: vendor_catalogue seed data
-- Sourced from apps/web/src/data/providerData.ts (20 US wine distributors/importers/wholesalers)
-- Uses fixed UUIDs for idempotent re-runs (ON CONFLICT DO NOTHING).

INSERT INTO vendor_catalogue (id, name, type, country, state, city, address, phone, email, website, wine_specialties, is_active) VALUES

-- PROV_001: Southern Glazer's Wine & Spirits
(
  'a1000001-0000-4000-8000-000000000001',
  'Southern Glazer''s Wine & Spirits',
  'wholesaler',
  'US',
  'FL',
  'Fort Lauderdale',
  '4300 Alcoa Avenue, Fort Lauderdale, FL 33309',
  '(954) 739-9000',
  'customerservice@sgws.com',
  'https://www.southernglazers.com',
  'California, French, Italian, Spanish, Australian, New Zealand, South American wines. E. & J. Gallo, Constellation Brands, Treasury Wine Estates, Domaines Barons de Rothschild',
  TRUE
),

-- PROV_002: Republic National Distributing Company (RNDC)
(
  'a1000001-0000-4000-8000-000000000002',
  'Republic National Distributing Company (RNDC)',
  'wholesaler',
  'US',
  'TX',
  'Dallas',
  '6440 L.B.J. Freeway, Suite 400, Dallas, TX 75240',
  '(972) 308-8800',
  'info@rndc-usa.com',
  'https://www.rndc-usa.com',
  'California, Oregon, Washington, New York, French, Italian, Spanish, Australian, Chilean, Argentinian. Duckhorn, Silver Oak, Opus One, Château d''Yquem',
  TRUE
),

-- PROV_003: Breakthru Beverage Group
(
  'a1000001-0000-4000-8000-000000000003',
  'Breakthru Beverage Group',
  'wholesaler',
  'US',
  'CA',
  'Pasadena',
  '155 N. Lake Avenue, Pasadena, CA 91101',
  '(626) 449-8500',
  'onpremise@breakthrubev.com',
  'https://www.breakthrubev.com',
  'California premium, Champagne, Burgundy, Bordeaux, Tuscany, Piedmont, Spanish, Australian. Kendall-Jackson, Rodney Strong, Stag''s Leap',
  TRUE
),

-- PROV_004: Young's Market Company
(
  'a1000001-0000-4000-8000-000000000004',
  'Young''s Market Company',
  'wholesaler',
  'US',
  'CA',
  'Costa Mesa',
  '3000 Red Hill Avenue, Costa Mesa, CA 92626',
  '(714) 850-8000',
  'sales@youngsmarket.com',
  'https://www.youngsmarket.com',
  'Napa, Sonoma, Oregon, Washington. Burgundy, Bordeaux, Rhône, Champagne, Tuscany, Piedmont, Rioja, Priorat, Australian, New Zealand',
  TRUE
),

-- PROV_005: Charmer Sunbelt Group
(
  'a1000001-0000-4000-8000-000000000005',
  'Charmer Sunbelt Group',
  'wholesaler',
  'US',
  'WA',
  'Seattle',
  '1201 3rd Avenue, Seattle, WA 98101',
  '(206) 624-4600',
  'contact@charmer.com',
  'https://www.charmer.com',
  'California, Washington, Oregon, New York, French, Italian, Spanish, Chilean, Argentinian, Australian, South African',
  TRUE
),

-- PROV_006: Martignetti Companies
(
  'a1000001-0000-4000-8000-000000000006',
  'Martignetti Companies',
  'wholesaler',
  'US',
  'MA',
  'Chelsea',
  '100 Everett Avenue, Chelsea, MA 02150',
  '(617) 889-7700',
  'finewine@martignetti.com',
  'https://www.martignetti.com',
  'Screaming Eagle, Harlan Estate, Colgin Cellars, Domaines Leroy, Domaine de la Romanée-Conti, Château Latour, Sassicaia, Ornellaia, Gaja',
  TRUE
),

-- PROV_007: Empire Merchants
(
  'a1000001-0000-4000-8000-000000000007',
  'Empire Merchants',
  'wholesaler',
  'US',
  'NY',
  'Brooklyn',
  '2100 86th Street, Brooklyn, NY 11214',
  '(718) 256-8800',
  'restaurant@empiremerchants.com',
  'https://www.empiremerchants.com',
  'New York State, California premium, Bordeaux, Burgundy, Champagne, Rhône, Super Tuscans, Barolo, Brunello, Spanish, Australian',
  TRUE
),

-- PROV_008: Northwestern Distributing
(
  'a1000001-0000-4000-8000-000000000008',
  'Northwestern Distributing',
  'wholesaler',
  'US',
  'OR',
  NULL,
  NULL,
  NULL,
  NULL,
  'https://www.nwdistributing.com',
  'Oregon Pinot Noir, Pinot Gris, Washington Cabernet, Merlot, California premium, Burgundy, Loire, Piedmont, Tuscany, New Zealand, Argentinian',
  TRUE
),

-- PROV_009: Winebow
(
  'a1000001-0000-4000-8000-000000000009',
  'Winebow',
  'importer',
  'US',
  'NJ',
  'Dayton',
  '2240 Route 130, Suite 108, Dayton, NJ 08810',
  NULL,
  NULL,
  'https://www.winebow.com',
  'Italian (200+ producers): Antinori, Gaja, Masi, Alois Lageder, Livio Felluga. French Burgundy, Rhône, Spanish, Portuguese, Greek, Austrian, natural wines',
  TRUE
),

-- PROV_010: Skurnik Wines & Spirits
(
  'a1000001-0000-4000-8000-000000000010',
  'Skurnik Wines & Spirits',
  'importer',
  'US',
  'NY',
  'New York',
  '116 East 27th Street, 10th Floor, New York, NY 10016',
  NULL,
  NULL,
  'https://www.skurnik.com',
  'Artisanal French (Burgundy, Loire, Alsace, Rhône, Jura), Italian (Piedmont, Tuscany, Sicily, Campania), Austria, Germany, Spain, Portugal. Organic, biodynamic, natural wines',
  TRUE
),

-- PROV_011: Kobrand Corporation
(
  'a1000001-0000-4000-8000-000000000011',
  'Kobrand Corporation',
  'importer',
  'US',
  'NY',
  'New York',
  '225 West 39th Street, New York, NY 10018',
  NULL,
  NULL,
  'https://www.kobrandwineandspirits.com',
  'Bollinger, Dom Pérignon, Veuve Clicquot, Taittinger, Louis Roederer, Moët & Chandon, Perrier-Jouët, Bordeaux, Burgundy, Frescobaldi, Penfolds, Lindemans',
  TRUE
),

-- PROV_012: Terlato Wine Group
(
  'a1000001-0000-4000-8000-000000000012',
  'Terlato Wine Group',
  'importer',
  'US',
  'IL',
  'Lake Bluff',
  '900 Armour Drive, Lake Bluff, IL 60044',
  NULL,
  NULL,
  'https://www.terlatowines.com',
  'Italian (Ruffino, Masi, Ca'' del Bosco, San Polo), French (Piper-Heidsieck, Château de la Nerthe, E. Guigal), Australian, California (Markham, Chimney Rock)',
  TRUE
),

-- PROV_013: Frederick Wildman & Sons
(
  'a1000001-0000-4000-8000-000000000013',
  'Frederick Wildman & Sons',
  'importer',
  'US',
  'CA',
  'Los Angeles',
  '1537 North Cahuenga Boulevard, Los Angeles, CA 90028',
  NULL,
  NULL,
  'https://www.frederickwildman.com',
  'Italian (Castello di Gabbiano, Il Poggione, Ruffino, Castello di Bossi, Masi), French (Domaine Laroche, Château de Beaucastel, Domaine Tempier), Spanish, Portuguese, South African',
  TRUE
),

-- PROV_014: Polaner Selections
(
  'a1000001-0000-4000-8000-000000000014',
  'Polaner Selections',
  'importer',
  'US',
  'NJ',
  'Montclair',
  '55 Church Street, Montclair, NJ 07042',
  NULL,
  NULL,
  'https://www.polanerselections.com',
  'Artisanal French (Burgundy, Loire, Rhône, Jura, Languedoc), Italian (Piedmont, Tuscany, Sicily), Spain, Portugal, Austria, Germany. Organic, biodynamic, natural wines',
  TRUE
),

-- PROV_015: Dreyfus, Ashby & Co.
(
  'a1000001-0000-4000-8000-000000000015',
  'Dreyfus, Ashby & Co.',
  'importer',
  'US',
  'NY',
  'New York',
  '1495 Lexington Avenue, New York, NY 10128',
  NULL,
  NULL,
  'https://www.dreyfusashby.com',
  'Domaines Barons de Rothschild (Lafite), Château d''Yquem, Château Margaux, Domaine de la Romanée-Conti, Domaine Leflaive, Krug, Dom Pérignon, Sassicaia',
  TRUE
),

-- PROV_016: Banfi Vintners
(
  'a1000001-0000-4000-8000-000000000016',
  'Banfi Vintners',
  'importer',
  'US',
  'NY',
  'Glen Head',
  '1111 Cedar Swamp Road, Glen Head, NY 11545',
  NULL,
  NULL,
  'https://www.banfivintners.com',
  'Italian (Castello Banfi, Riunite, Centine), French (Bouchard Père & Fils), Chilean (Concha y Toro), Australian, New Zealand, South African',
  TRUE
),

-- PROV_017: Palm Bay International
(
  'a1000001-0000-4000-8000-000000000017',
  'Palm Bay International',
  'importer',
  'US',
  'NJ',
  'Carlstadt',
  '100 Triangle Boulevard, Carlstadt, NJ 07072',
  NULL,
  NULL,
  'https://www.palmbay.com',
  'Italian (Ruffino, Masi, Castello di Gabbiano, Avignonesi, Badia a Coltibuono), French (Bollinger, Domaines Barons de Rothschild), Spanish, Portuguese, Chilean, Australian',
  TRUE
),

-- PROV_018: Europvin USA
(
  'a1000001-0000-4000-8000-000000000018',
  'Europvin USA',
  'importer',
  'US',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'https://www.europvin.com',
  'Burgundy, Bordeaux: Domaines des Comtes Lafon, Domaine de la Romanée-Conti, Château Latour, Château Margaux, Château Haut-Brion, Château Mouton Rothschild, Château d''Yquem. Rhône, Loire, Alsace, Champagne',
  TRUE
),

-- PROV_019: A. Bommarito Wines
(
  'a1000001-0000-4000-8000-000000000019',
  'A. Bommarito Wines',
  'distributor',
  'US',
  'MO',
  'St. Louis',
  '501 North Broadway, St. Louis, MO 63102',
  NULL,
  NULL,
  'https://www.bommaritowines.com',
  'California (Napa, Sonoma, Central Coast), Oregon (Willamette Valley Pinot Noir), Washington (Columbia Valley), French, Italian, Spanish',
  TRUE
),

-- PROV_020: Henry Wine Group
(
  'a1000001-0000-4000-8000-000000000020',
  'Henry Wine Group',
  'distributor',
  'US',
  'WA',
  'Seattle',
  '701 5th Avenue, Suite 4200, Seattle, WA 98104',
  NULL,
  NULL,
  'https://www.henrywine.com',
  'California boutique (Ridge, Stag''s Leap Wine Cellars, Grgich Hills), Oregon (Domaine Serene, Ponzi), Washington. Burgundy, Bordeaux, Champagne, Rhône, Tuscany, Piedmont, Spanish, Australian, New Zealand',
  TRUE
)

ON CONFLICT (id) DO NOTHING;
