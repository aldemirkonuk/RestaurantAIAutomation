# WineOps ML Notebooks

Data-science companions to the production analytics engine
(`apps/api-gateway/src/analytics`). Each notebook mirrors a production
endpoint's math, then goes further with models that don't belong in a request
path — the workflow is **prototype here → promote winners into the engine or
the Python orchestrator**.

| Notebook | Question | Production counterpart |
|---|---|---|
| `01_demand_forecasting` | Which model beats seasonal-naive on MASE? (Holt-Winters vs SARIMA vs GBM) | `/analytics/forecast` |
| `02_table_geometry_ml` | Does floor geometry (bar/kitchen/pool distance, seats, outdoor) move spend? RF + permutation importance + partial dependence | `/analytics/table-performance` drivers |
| `03_market_basket` | Which food→wine pairs have real lift? (apriori rules) | `/analytics/basket` |
| `04_menu_engineering_pricing` | Quadrants + log-log elasticity + Lerner optimal price | `/analytics/menu-engineering`, `/analytics/recommendations` |
| `05_waiter_effects` | Server skill after removing table/weekday luck (two-way fixed effects, OLS + logit) | `/analytics/waiters` adjusted effects |

## Setup

```bash
cd notebooks
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
jupyter lab
```

## Data: live or synthetic

`wineops_data.py` loads LIVE rows when these env vars are set (same as the
API gateway):

```bash
export SUPABASE_URL=...            # project url
export SUPABASE_SERVICE_ROLE_KEY=...
export WINEOPS_RESTAURANT_ID=...   # optional: scope to one restaurant
```

Without them (or while `pos_checks` is still empty pre-POS-integration) it
generates **schema-faithful synthetic data** with planted effects — weekday
seasonality, bar-proximity spend lift, server skill spread, food↔wine
affinities — so every pipeline can be validated end-to-end before real data
arrives. Synthetic mode never writes to the database.

## Promotion rule of thumb

A notebook finding ships when it (a) beats the production baseline by a
meaningful margin on held-out data, (b) survives a re-run on the next month
of data, and (c) can be expressed either in the pure TS engine or as an
orchestrator job with a stored output the API can serve.
