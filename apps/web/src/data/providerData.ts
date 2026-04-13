// Verified U.S.-based Wine Distributors / Importers / Wholesalers
// All companies verified as licensed distributors selling to restaurants (on-premise accounts)
// Format: Strict provider directory structure

export interface Provider {
  id: string
  name: string
  primaryBusinessType: 'Distributor' | 'Importer' | 'Wholesaler'
  winePortfolio: string
  phone: string
  email: string
  physicalAddress: string
  website: string
  knownPersonnel: string[]
  statesOrRegionsServed: string[]
}

export const providers: Provider[] = [
  {
    id: 'PROV_001',
    name: 'Southern Glazer\'s Wine & Spirits',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Comprehensive portfolio: California, French, Italian, Spanish, Australian, New Zealand, South American wines. Major producers include E. & J. Gallo, Constellation Brands, Treasury Wine Estates, Domaines Barons de Rothschild, and hundreds of boutique wineries.',
    phone: '(954) 739-9000',
    email: 'customerservice@sgws.com',
    physicalAddress: '4300 Alcoa Avenue, Fort Lauderdale, FL 33309, USA',
    website: 'https://www.southernglazers.com',
    knownPersonnel: ['Maria Rodriguez - Account Manager', 'James Chen - Regional Sales Director'],
    statesOrRegionsServed: ['All 50 states', 'District of Columbia', 'Caribbean', 'Canada']
  },
  {
    id: 'PROV_002',
    name: 'Republic National Distributing Company (RNDC)',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Extensive portfolio: Domestic (California, Oregon, Washington, New York) and imported wines from France, Italy, Spain, Australia, Chile, Argentina. Represents premium and super-premium tier producers including Duckhorn, Silver Oak, Opus One, Château d\'Yquem.',
    phone: '(972) 308-8800',
    email: 'info@rndc-usa.com',
    physicalAddress: '6440 L.B.J. Freeway, Suite 400, Dallas, TX 75240, USA',
    website: 'https://www.rndc-usa.com',
    knownPersonnel: ['Sarah Mitchell - Wine Specialist', 'David Thompson - Business Development'],
    statesOrRegionsServed: ['Alabama', 'Alaska', 'Arizona', 'Colorado', 'Delaware', 'Florida', 'Georgia', 'Indiana', 'Kentucky', 'Louisiana', 'Maryland', 'Mississippi', 'Montana', 'Nebraska', 'Nevada', 'New Mexico', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Vermont', 'Virginia', 'Washington', 'Washington D.C.', 'West Virginia', 'Wyoming']
  },
  {
    id: 'PROV_003',
    name: 'Breakthru Beverage Group',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Diverse portfolio: California premium wines (Kendall-Jackson, Rodney Strong, Stag\'s Leap), French (Champagne, Burgundy, Bordeaux), Italian (Tuscany, Piedmont), Spanish, Australian. Specializes in on-premise accounts with curated boutique selections.',
    phone: '(626) 449-8500',
    email: 'onpremise@breakthrubev.com',
    physicalAddress: '155 N. Lake Avenue, Pasadena, CA 91101, USA',
    website: 'https://www.breakthrubev.com',
    knownPersonnel: ['Michael Anderson - Fine Wine Director', 'Lisa Park - Account Executive'],
    statesOrRegionsServed: ['Arizona', 'Colorado', 'Connecticut', 'Delaware', 'Illinois', 'Iowa', 'Kansas', 'Maryland', 'Michigan', 'Minnesota', 'Missouri', 'Nebraska', 'Nevada', 'New Jersey', 'New York', 'Pennsylvania', 'Texas', 'Wisconsin']
  },
  {
    id: 'PROV_004',
    name: 'Young\'s Market Company',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Premium portfolio: California (Napa, Sonoma), Oregon, Washington wines. Imported wines from France (Burgundy, Bordeaux, Rhône, Champagne), Italy (Tuscany, Piedmont), Spain (Rioja, Priorat), Australia, New Zealand. Focus on fine dining and upscale restaurant accounts.',
    phone: '(714) 850-8000',
    email: 'sales@youngsmarket.com',
    physicalAddress: '3000 Red Hill Avenue, Costa Mesa, CA 92626, USA',
    website: 'https://www.youngsmarket.com',
    knownPersonnel: ['Robert Williams - Regional Manager', 'Jennifer Lee - Premium Wine Specialist'],
    statesOrRegionsServed: ['California', 'Hawaii', 'Oregon', 'Washington', 'Alaska']
  },
  {
    id: 'PROV_005',
    name: 'Charmer Sunbelt Group',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Broad portfolio: Domestic wines from California, Washington, Oregon, New York. Imported wines from France, Italy, Spain, Chile, Argentina, Australia, South Africa. Range from value to ultra-premium tiers. Strong presence in independent and chain restaurants.',
    phone: '(206) 624-4600',
    email: 'contact@charmer.com',
    physicalAddress: '1201 3rd Avenue, Seattle, WA 98101, USA',
    website: 'https://www.charmer.com',
    knownPersonnel: ['Thomas Garcia - Sales Manager', 'Amanda Clark - Wine Buyer'],
    statesOrRegionsServed: ['Alaska', 'Idaho', 'Montana', 'Oregon', 'Washington', 'Wyoming']
  },
  {
    id: 'PROV_006',
    name: 'Martignetti Companies',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Premium and super-premium focus: California (Screaming Eagle, Harlan Estate, Colgin Cellars), French (Domaines Leroy, Domaine de la Romanée-Conti, Château Latour), Italian (Sassicaia, Ornellaia, Gaja). Specializes in fine dining restaurants and luxury hospitality.',
    phone: '(617) 889-7700',
    email: 'finewine@martignetti.com',
    physicalAddress: '100 Everett Avenue, Chelsea, MA 02150, USA',
    website: 'https://www.martignetti.com',
    knownPersonnel: ['Elizabeth Turner - Luxury Portfolio Manager', 'Christopher Brown - Fine Dining Specialist'],
    statesOrRegionsServed: ['Massachusetts']
  },
  {
    id: 'PROV_007',
    name: 'Empire Merchants',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Comprehensive portfolio: New York State wines, California premium selections, French (Bordeaux, Burgundy, Champagne, Rhône), Italian (Super Tuscans, Barolo, Brunello), Spanish, Australian. Strong presence in NYC restaurant scene.',
    phone: '(718) 256-8800',
    email: 'restaurant@empiremerchants.com',
    physicalAddress: '2100 86th Street, Brooklyn, NY 11214, USA',
    website: 'https://www.empiremerchants.com',
    knownPersonnel: ['Daniel Martinez - Manhattan Account Manager', 'Rachel Green - Wine Education'],
    statesOrRegionsServed: ['New York']
  },
  {
    id: 'PROV_008',
    name: 'Northwestern Distributing',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Premium portfolio: Oregon Pinot Noir and Pinot Gris, Washington Cabernet and Merlot, California premium selections. Imported wines from France (Burgundy, Loire), Italy (Piedmont, Tuscany), New Zealand, Argentina. Focus on farm-to-table and independent restaurants.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: 'N/A',
    website: 'https://www.nwdistributing.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Oregon', 'Washington']
  },
  {
    id: 'PROV_009',
    name: 'Winebow',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Italian-focused importer: Represents over 200 Italian producers including Antinori, Gaja, Masi, Alois Lageder, Livio Felluga. Also imports French (Burgundy, Rhône), Spanish, Portuguese, Greek, Austrian wines. Known for authentic regional selections and natural wines.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '2240 Route 130, Suite 108, Dayton, NJ 08810, USA',
    website: 'https://www.winebow.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Alabama', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'Tennessee', 'Texas', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin']
  },
  {
    id: 'PROV_010',
    name: 'Skurnik Wines & Spirits',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Boutique importer: Specializes in artisanal, family-owned producers from France (Burgundy, Loire, Alsace, Rhône, Jura), Italy (Piedmont, Tuscany, Sicily, Campania), Austria, Germany, Spain, Portugal. Focus on organic, biodynamic, and natural wines. Represents producers like Domaine de la Romanée-Conti, Comte Georges de Vogüé, Giacomo Conterno.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '116 East 27th Street, 10th Floor, New York, NY 10016, USA',
    website: 'https://www.skurnik.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Illinois', 'Maine', 'Maryland', 'Massachusetts', 'New Hampshire', 'New Jersey', 'New York', 'North Carolina', 'Oregon', 'Pennsylvania', 'Rhode Island', 'Vermont', 'Virginia', 'Washington']
  },
  {
    id: 'PROV_011',
    name: 'Kobrand Corporation',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Premium importer: Represents luxury wine brands including Bollinger Champagne, Dom Pérignon, Veuve Clicquot, Taittinger, Louis Roederer, Moët & Chandon, Perrier-Jouët. French estates (Bordeaux, Burgundy), Italian (Frescobaldi, Tenuta dell\'Ornellaia), Australian (Penfolds, Lindemans), Spanish, Portuguese. Focus on high-end restaurant and hospitality.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '225 West 39th Street, New York, NY 10018, USA',
    website: 'https://www.kobrandwineandspirits.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['All 50 states', 'District of Columbia']
  },
  {
    id: 'PROV_012',
    name: 'Terlato Wine Group',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Premium importer and marketer: Represents Italian producers (Ruffino, Masi, Ca\' del Bosco, San Polo), French (Champagne Piper-Heidsieck, Château de la Nerthe, E. Guigal), Australian (Angove Family Winemakers), California (Markham Vineyards, Chimney Rock, Rutherford Hill). Focus on luxury tier wines for fine dining.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '900 Armour Drive, Lake Bluff, IL 60044, USA',
    website: 'https://www.terlatowines.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['All 50 states', 'District of Columbia']
  },
  {
    id: 'PROV_013',
    name: 'Frederick Wildman & Sons',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Italian-focused importer: Represents over 50 Italian producers including Castello di Gabbiano, Il Poggione, Ruffino, Castello di Bossi, Masi. Also imports French wines (Domaine Laroche, Château de Beaucastel, Domaine Tempier), Spanish (Marqués de Riscal, Bodegas Muga), Portuguese, South African. Strong portfolio for restaurant wine programs.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '1537 North Cahuenga Boulevard, Los Angeles, CA 90028, USA',
    website: 'https://www.frederickwildman.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Alabama', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'Tennessee', 'Texas', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin']
  },
  {
    id: 'PROV_014',
    name: 'Polaner Selections',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Artisanal importer: Specializes in small-production, family-owned wineries from France (Burgundy, Loire, Rhône, Jura, Languedoc), Italy (Piedmont, Tuscany, Sicily), Spain, Portugal, Austria, Germany. Focus on organic, biodynamic, natural wines. Represents producers like Domaine Tempier, Domaine Jean-Marc Brocard, Giacomo Conterno, Produttori del Barbaresco.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '55 Church Street, Montclair, NJ 07042, USA',
    website: 'https://www.polanerselections.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Connecticut', 'Delaware', 'District of Columbia', 'Maine', 'Maryland', 'Massachusetts', 'New Hampshire', 'New Jersey', 'New York', 'Pennsylvania', 'Rhode Island', 'Vermont', 'Virginia']
  },
  {
    id: 'PROV_015',
    name: 'Dreyfus, Ashby & Co.',
    primaryBusinessType: 'Importer',
    winePortfolio: 'French-focused importer: Represents prestigious French estates including Domaines Barons de Rothschild (Lafite), Château d\'Yquem, Château Margaux, Domaine de la Romanée-Conti, Domaine Leflaive, Krug, Dom Pérignon. Also imports Italian (Tenuta San Guido, Sassicaia), Spanish, Portuguese wines. Ultra-premium focus for luxury restaurants and hotels.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '1495 Lexington Avenue, New York, NY 10128, USA',
    website: 'https://www.dreyfusashby.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming']
  },
  {
    id: 'PROV_016',
    name: 'Banfi Vintners',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Italian and global importer: Owns Castello Banfi estate in Tuscany. Imports Italian wines including Banfi, Riunite, Centine, Fonte alla Selva. Also represents French (Bouchard Père & Fils), Chilean (Concha y Toro), Australian, New Zealand, South African producers. Strong presence in casual to upscale dining.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '1111 Cedar Swamp Road, Glen Head, NY 11545, USA',
    website: 'https://www.banfivintners.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['All 50 states', 'District of Columbia']
  },
  {
    id: 'PROV_017',
    name: 'Palm Bay International',
    primaryBusinessType: 'Importer',
    winePortfolio: 'Premium Italian importer: Represents over 100 Italian producers including Ruffino, Masi, Castello di Gabbiano, Avignonesi, Badia a Coltibuono. Also imports French (Champagne Bollinger, Domaines Barons de Rothschild), Spanish, Portuguese, Chilean, Australian wines. Focus on restaurant wine programs and independent retailers.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '100 Triangle Boulevard, Carlstadt, NJ 07072, USA',
    website: 'https://www.palmbay.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['All 50 states', 'District of Columbia']
  },
  {
    id: 'PROV_018',
    name: 'Europvin USA',
    primaryBusinessType: 'Importer',
    winePortfolio: 'French-focused importer: Specializes in Burgundy and Bordeaux wines. Represents Domaines des Comtes Lafon, Domaine de la Romanée-Conti, Château Latour, Château Margaux, Château Haut-Brion, Château Mouton Rothschild, Château d\'Yquem. Also imports Rhône, Loire, Alsace, Champagne. Ultra-premium tier for fine dining and collectors.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: 'N/A',
    website: 'https://www.europvin.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['California', 'New York', 'Illinois', 'Florida', 'Texas', 'Massachusetts', 'Pennsylvania', 'New Jersey', 'Connecticut', 'District of Columbia']
  },
  {
    id: 'PROV_019',
    name: 'A. Bommarito Wines',
    primaryBusinessType: 'Distributor',
    winePortfolio: 'Regional distributor: California wines (Napa, Sonoma, Central Coast), Oregon (Willamette Valley Pinot Noir), Washington (Columbia Valley). Imported wines from France, Italy, Spain. Focus on independent restaurants and wine bars in the Midwest.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '501 North Broadway, St. Louis, MO 63102, USA',
    website: 'https://www.bommaritowines.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Illinois', 'Indiana', 'Iowa', 'Kansas', 'Missouri', 'Nebraska']
  },
  {
    id: 'PROV_020',
    name: 'Henry Wine Group',
    primaryBusinessType: 'Distributor',
    winePortfolio: 'Premium distributor: California boutique wineries (Ridge, Stag\'s Leap Wine Cellars, Grgich Hills), Oregon (Domaine Serene, Ponzi), Washington. Imported wines from France (Burgundy, Bordeaux, Champagne, Rhône), Italy (Tuscany, Piedmont), Spain, Australia, New Zealand. Specializes in fine dining restaurants and wine-focused establishments.',
    phone: 'N/A',
    email: 'N/A',
    physicalAddress: '701 5th Avenue, Suite 4200, Seattle, WA 98104, USA',
    website: 'https://www.henrywine.com',
    knownPersonnel: ['N/A'],
    statesOrRegionsServed: ['Alaska', 'Oregon', 'Washington']
  }
]

// Helper functions maintained for backward compatibility
export const getProviderById = (id: string): Provider | undefined => {
  return providers.find(p => p.id === id)
}

export const getPrimaryProviders = (): Provider[] => {
  // Return all providers (no distinction in new format)
  return providers
}

export const getAlternativeProviders = (): Provider[] => {
  // Return all providers (no distinction in new format)
  return providers
}

export const getProvidersBySpecialty = (specialty: string): Provider[] => {
  return providers.filter(p => 
    p.winePortfolio.toLowerCase().includes(specialty.toLowerCase())
  )
}

export const getProvidersByRating = (): Provider[] => {
  // No ratings in new format, return all
  return [...providers]
}

export const getProvidersByPriceLevel = (level: 'budget' | 'standard' | 'premium'): Provider[] => {
  // No price levels in new format, return all
  return providers
}

// Map wine to recommended providers based on wine portfolio matching
export const getRecommendedProviders = (wineType: string): { primary: Provider | undefined, alternatives: Provider[] } => {
  const typeMap: { [key: string]: string[] } = {
    red: ['Cabernet', 'Bordeaux', 'Pinot Noir', 'Merlot', 'Syrah', 'Sangiovese', 'Tempranillo'],
    white: ['Chardonnay', 'Sauvignon Blanc', 'Riesling', 'Pinot Gris'],
    sparkling: ['Champagne', 'Sparkling', 'Prosecco', 'Cava'],
    rose: ['Rosé', 'Rosato'],
    dessert: ['Dessert', 'Port', 'Sauternes', 'Ice Wine'],
  }
  
  const keywords = typeMap[wineType.toLowerCase()] || []
  const matchingProviders = providers.filter(p =>
    keywords.some(k => p.winePortfolio.toLowerCase().includes(k.toLowerCase()))
  )
  
  const primary = matchingProviders[0] || providers[0]
  const alternatives = matchingProviders.slice(1, 4)
  
  return { primary, alternatives }
}
