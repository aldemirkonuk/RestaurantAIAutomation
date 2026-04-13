# Phase 2 E2E Crawl Report

**Generated:** 2026-04-06T01:33:52Z

**Pass threshold:** 80% field completeness

## Summary

| Restaurant | Wines | Completeness | Dedup | Image Menu | Schema Violations | Result |
|------------|-------|-------------|-------|------------|-------------------|--------|
| The Tailors Son | 57 | 97.4% | PASS | — | 0 | PASS |
| Chicago Winery | 12 | 69.4% | PASS | — | 0 | FAIL |
| BLVD Steakhouse | 14 | 77.4% | PASS | — | 10 | FAIL |
| The Albert Chicago | 6 | 83.3% | PASS | — | 0 | PASS |
| Siena Tavern | 46 | 80.4% | PASS | PASS | 10 | PASS |

## Overall

- **Aggregate completeness:** 81.6%
- **Dedup failures:** 0
- **Total schema violations:** 20
- **Result:** PASS

## Per-Restaurant Detail

### The Tailors Son

**Sample wines:**

| wine_name | vintage | region | country | price_reference | grape_variety |
|-----------|---------|--------|---------|-----------------|---------------|
| PROSECCO | None | Veneto | Italy | 52.0 | Glera |
| BLANC DE NOIRS | 2021 | California | USA | 88.0 | Pinot Noir, Pinot Meunier |
| BLANC DE NOIRS | None | Champagne | France | 80.0 | Pinot Noir, Pinot Meunier |

### Chicago Winery

**Sample wines:**

| wine_name | vintage | region | country | price_reference | grape_variety |
|-----------|---------|--------|---------|-----------------|---------------|
| SANGIOVESE | None | None | USA | 48.0 | Sangiovese |
| MERLOT | None | None | USA | 48.0 | Merlot |
| SYRAH | None | None | USA | 48.0 | Syrah |

### BLVD Steakhouse

**Schema violations:**

- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'

**Sample wines:**

| wine_name | vintage | region | country | price_reference | grape_variety |
|-----------|---------|--------|---------|-----------------|---------------|
| Moët & Chandon Imperial Brut | None | Champagne | France | None | None |
| Pierre Sparr Cremant d'Alsace Brut Reserve | None | Alsace | France | None | None |
| Saint Clair Sauvignon Blanc | 2024 | Marlborough | New Zealand | None | Sauvignon Blanc |

### The Albert Chicago

**Sample wines:**

| wine_name | vintage | region | country | price_reference | grape_variety |
|-----------|---------|--------|---------|-----------------|---------------|
| Rose | None | California | USA | 35.0 | rosé |
| Prosecco | None | Tuscany | Italy | 19.0 | prosecco |
| Sauvignon Blanc | None | California | USA | 32.0 | sauvignon blanc |

### Siena Tavern

**Schema violations:**

- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'
- Missing or empty required field: 'primary_type'

**Sample wines:**

| wine_name | vintage | region | country | price_reference | grape_variety |
|-----------|---------|--------|---------|-----------------|---------------|
| Canard Duchene Cuvee Leonie | None | Reims | France | None | Champagne Blend |
| Berlucchi Franciacorta Brut | None | Lombardy | Italy | None | Franciacorta Blend |
| Avissi Prosecco | None | Veneto | Italy | None | Prosecco |

