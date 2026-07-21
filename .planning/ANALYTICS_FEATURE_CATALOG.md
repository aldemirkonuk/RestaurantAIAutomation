# WineOps Analytics Feature Catalog

**Version:** 1.2  
**Created:** 2026-07-05 · **Updated:** 2026-07-20  
**Total features:** 460  
**Status:** Planning only — not built

> **v1.1 change:** Added Batch 5 (276–360) — Toast-parity / full-restaurant analytics.
>
> **v1.2 change:** Added Batch 6 (361–460) — **100 outcome-linked seating metrics**: sales vs check-in density over seating (covers/seat, sales/seat, zone/time/geometry links, manager alerts).

---

## How to use this file

- **Humans:** Browse by category sections below.
- **Extraction:** Use the [JSON file](./analytics-feature-catalog.json) for scripts, spreadsheets, or roadmap import.
- **CSV:** [analytics-feature-catalog.csv](./analytics-feature-catalog.csv) — open directly in Excel/Sheets/Notion.

### Field schema

| Field | Description |
|-------|-------------|
| `id` | Unique feature number (1–460) |
| `name` | Short feature title |
| `category` | Grouping for roadmap planning |
| `domain` | Primary area: `inventory`, `financial`, `sales`, `vendor`, `menu`, `calendar`, `ux`, `market`, `ai`, `risk`, `compliance`, `multi_location`, `notifications`, `documents`, `causal`, `network`, `forecasting`, `agent_observability`, `labor`, `payments`, `guest`, `marketing`, `operations`, `integration` |
| `description` | What it tracks and why it matters |
| `data_sources` | WineOps tables/systems (when known) |
| `priority` | `tier1` quick win, `tier2` differentiator, `tier3` advanced, `unassigned` |
| `toast_relationship` | How it relates to Toast Analytics (see legend) |
| `build_strategy` | `import` / `build` / `bridge` / `embed` |

### Toast relationship legend

| Value | Meaning |
|-------|---------|
| `toast_native` | Toast already computes this — pull via Toast Analytics API (**import**) |
| `toast_overlap` | Toast does a general version — WineOps builds a wine-focused/better one (**build**) |
| `wineops_bridge` | Fuses Toast POS data with WineOps wine intelligence — **unique value** (**bridge**) |
| `wineops_only` | Not in Toast at all — WineOps-native (**build**) |
| `integration` | Plumbing to bring Toast data into WineOps (**import**) |

---

## Summary by Toast relationship

| Relationship | Count | What it means for the roadmap |
|-------------|-------|-------------------------------|
| `wineops_only` | 254 | WineOps must build — Toast has nothing here (your moat) |
| `toast_native` | 55 | Import from Toast Analytics API — don't rebuild |
| `toast_overlap` | 32 | Toast has a generic version — build a wine-focused one |
| `wineops_bridge` | 14 | Fuse Toast POS data + wine intelligence — highest differentiation |
| `integration` | 5 | The Toast ingestion plumbing that enables the above |

## Summary by build strategy

| Strategy | Count |
|----------|-------|
| build | 286 |
| import | 60 |
| bridge | 14 |

---

## Batch 1: Core Analytics (1–75)

### Inventory & Stock (1–8)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 1 | Stock Change Ledger | Every increment/decrement with reason (POS, delivery, manual, spoilage) | event_store, decision_log, Toast | tier1 |
| 2 | Stock Velocity Score | Bottles sold per day per SKU with trend direction | POS, inventory | tier1 |
| 3 | Days-of-Cover Forecast | current_stock ÷ avg_daily_sales per wine | inventory, POS | tier1 |
| 4 | Shrinkage Anomaly Detection | Digital vs physical count divergence over time | manual counts, POS | tier2 |
| 5 | Par Level Optimizer | AI min/max from lead time + demand variance | sales, vendor lead times | tier2 |
| 6 | Vintage Substitution Impact | Success rate when primary vintage sells out | POS matching, inventory | tier2 |
| 7 | Low-Stock Alert Effectiveness | Alert → action → reorder latency | notification_deliveries | tier1 |
| 8 | Multi-Location Stock Rebalancing | Imbalance across cellar/bar/BoH | storage_locations | tier2 |

### Sales & Demand (9–16)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 9 | Busy Day Calendar Heatmap | Covers, wine revenue, bottles by day/month | Toast | tier1 |
| 10 | Busy Day ↔ Wine Correlation | SKU spikes by day-of-week | POS, calendar | tier1 |
| 11 | Peak Hour Wine Demand | Hourly bottle velocity | Toast timestamps | tier1 |
| 12 | Sales by Server | Revenue, bottles, avg check per server | POS | tier1 |
| 13 | BTG vs Bottle Mix | Pour vs full-bottle rate per wine | POS modifiers | tier2 |
| 14 | Wine Pairing Co-occurrence | Food+wine combos on same ticket | POS checks | tier2 |
| 15 | Cohort Repeat Purchase | Reorder same wine within 30/60/90 days | POS patterns | tier2 |
| 16 | Revenue Attribution by Category | Red/white/sparkling/BTG contribution % | ontology, POS | tier2 |

### Weather & External (17–20)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 17 | Weather ↔ Sales Correlation | Rain/temp vs category sales | OpenWeather, POS | tier2 |
| 18 | 7-Day Weather Forecast Overlay | Predicted weather on busy calendar | Weather API, demand model | tier2 |
| 19 | Event Proximity Impact | Local events within 2km vs demand | Events API, calendar | tier2 |
| 20 | Seasonal Decomposition | Trend + seasonality + residual per SKU | 12mo time series | tier3 |

### Manager UX & Adaptive AI (21–26)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 21 | Interaction Heatmap | Clicks on charts, tabs, filters, exports | frontend telemetry | tier2 |
| 22 | Cursor / Scroll Depth Analytics | Where managers linger on reports | session replay | tier2 |
| 23 | Widget Engagement Ranking | Most/least opened dashboard cards | dashboard events | tier2 |
| 24 | AI Layout Recommendations | Weekly dashboard reorder proposals | interaction + role | tier2 |
| 25 | Query Intent Log | NL questions in Sommelier AI | chat logs | tier2 |
| 26 | Time-to-Decision | Alert open → approve/reject seconds | approval UI | tier2 |

### Storage & Placement (27–30)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 27 | Velocity-Based Placement Score | Fast movers → bar reach recommendation | velocity, storage_locations | tier2 |
| 28 | Pick-Path Efficiency | Time from alert to physical retrieval | manual logs, locations | tier2 |
| 29 | Cellar Utilization % | Capacity used per zone | location capacity | tier2 |
| 30 | Temperature Zone Compliance | Wrong temp zone vs ontology | storage, wine type | tier2 |

### Vendor & Procurement (31–37)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 31 | Delivery Performance Dashboard | On-time %, delays, partial shipments | delivery records, PO | tier1 |
| 32 | Vendor Response Time (Email) | Median hours to first reply | Gmail, EmailIntel | tier1 |
| 33 | Vendor Response Time (SMS) | Plivo thread latency | SMS logs | tier2 |
| 34 | Lead Time Distribution | Order → received per vendor/SKU | PO, receipts | tier2 |
| 35 | Vendor Price Change Tracker | Historical unit price deltas | negotiation_facts, invoices | tier1 |
| 36 | Cross-Vendor Price Spread | Same wine across vendors $ delta | EmailIntel, price history | tier1 |
| 37 | Procurement Cycle Analytics | Alert → PO → delivery → stock-in funnel | saga_state, event_store | tier2 |

### Pricing & Buy-More (38–42)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 38 | Future Price Prediction | Predicted price change + reasons | vendor emails, crawls | tier3 |
| 39 | Margin Erosion Alert | COGS up, menu price flat | invoices, menu | tier2 |
| 40 | Markup Ratio Benchmark | Your markup vs metro average | restaurant_inventory | tier2 |
| 41 | Price Elasticity Estimate | Volume change after menu price edit | menu_changes, POS | tier3 |
| 42 | Promo ROI Calculator | Revenue lift vs discount cost | POS promos, vendor promos | tier2 |

### Calendar & Seasonality (43–46)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 43 | Bundle vs Sum Valuation | Detect misleading bundle pricing | EmailIntel PROMO | tier2 |
| 44 | Vendor Promo Urgency Score | Expiry + historical promo quality | vendor_promotions | tier2 |
| 45 | Promo Conversion Rate | Promo → PO → stock received | email → procurement | tier2 |
| 46 | Competitor Promo Intelligence | Promo terms across vendor network | cross-restaurant promos | tier3 |

### Calendar & Holidays (47–50)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 47 | Holiday Readiness Calendar | Valentine's, NYE prep checklist | CalendarAgent, history | tier1 |
| 48 | Holiday Wine Demand Profile | Historical SKU spikes per holiday | POS, calendar | tier1 |
| 49 | Vendor Holiday Blackout Predictor | Vendor silence Dec 20–Jan 2 | email patterns | tier2 |
| 50 | Local Event Overlay | Private parties vs sales anomalies | calendar, POS | tier2 |

### Menu Intelligence (51–54)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 51 | Menu Performance Scorecard | Revenue, velocity, margin per placement | POS, menu metadata | tier2 |
| 52 | Menu Update Recommendations | Remove/promote/add from 90-day data | sales, trends | tier2 |
| 53 | New Addition Success Rate | Wines <90 days — hit rate vs forecast | menu_changes, sales | tier2 |
| 54 | BTG Rotation Optimizer | Optimal 8 pours this week | velocity, margin | tier2 |

### Reports & Documents (55–59)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 55 | Inline PDF / File Viewer | Invoices, reports, vendor PDFs in-app | DocumentsPage, ReportingAgent | tier1 |
| 56 | Report Usage Analytics | Which reports opened/exported/scheduled | report access logs | tier1 |
| 57 | AI-Generated Custom Reports | Weekly digest from top used metrics | usage telemetry | tier2 |
| 58 | Document ↔ Analytics Linking | Chart → source invoice PDF | OCR metadata | tier2 |
| 59 | Scheduled Report Delivery Tracking | Email opened, PDF viewed, action taken | Gmail, notifications | tier2 |

### Notifications (60–63)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 60 | Notification Channel Effectiveness | SMS vs email vs in-app action rates | notification_deliveries | tier1 |
| 61 | Alert Fatigue Score | Alerts/day vs actions taken | NotificationAgent | tier2 |
| 62 | Quiet Hours Compliance | Alerts during quiet windows | settings, deliveries | tier2 |
| 63 | Digest Engagement | Weekly digest read/click rates | Redis digest, Gmail | tier2 |

### Market Intelligence (64–67)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 64 | Trending Wines (Metro) | Velocity-ranked peer menu wines | trending_wines | tier2 |
| 65 | Wine Timeline Viewer | Full lifecycle across restaurants | analytics timeline API | tier2 |
| 66 | Category Shift Radar | Natural wine +12, Bordeaux -8 locally | category_shifts | tier2 |
| 67 | Critic Score ↔ Sales Correlation | Do 95+ point wines sell better here? | critic scores, POS | tier2 |

### Financial (68–70)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 68 | Wine COGS % of Revenue | Weekly/monthly beverage cost ratio | invoices, POS | tier1 |
| 69 | Budget Burn Rate | Spend vs monthly wine budget | PO, budget settings | tier1 |
| 70 | Dead Stock Capital Lock | $ in zero-sales 60+ day inventory | inventory valuation | tier1 |

### Predictive AI (71–75)

| ID | Name | Description | Data Sources | Priority |
|----|------|-------------|--------------|----------|
| 71 | 7/30/90-Day Demand Forecast | Per-SKU predicted bottles | ML on POS | tier3 |
| 72 | Anomaly Explanation Engine | Multi-signal "why was Tuesday slow?" | weather, events, POS | tier3 |
| 73 | Scenario Simulator | Stockout risk if ordering X before NYE | forecast, calendar | tier3 |
| 74 | Manager Learning Loop | AI suggestion accept/reject tracking | decision_log | tier2 |
| 75 | Conversational Analytics | NL questions → multi-chart answers | Sommelier AI | tier3 |

---

## Batch 2: Advanced & Complex Analytics (76–150)

### Causal & Counterfactual (76–81)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 76 | Causal Attribution Engine | Was demand drop caused by rain, staff, or competitor? | tier3 |
| 77 | Counterfactual Order Simulator | Revenue uplift if ordered X cases on date Y | tier3 |
| 78 | Promotion Incrementality Test | Did promo cause incremental sales? | tier3 |
| 79 | Confounding Variable Decomposer | Isolate weather, holidays, events from true demand | tier3 |
| 80 | Lead-Time Sensitivity Analysis | Stockout probability if lead time increases | tier3 |
| 81 | Price Elasticity Grid | Wine × price-point iso-revenue matrix | tier3 |

### Graph & Network (82–86)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 82 | Vendor Dependency Network | Force-directed vendor-wine supply graph | tier3 |
| 83 | Wine Co-Purchase Clustering | Ticket-level wine family communities | tier3 |
| 84 | Supply Chain Fragility Index | HHI concentration per category | tier3 |
| 85 | Communication Network Centrality | Email thread bottleneck contacts | tier3 |
| 86 | Influence Propagation Model | Vendor A price hike → vendor B lag model | tier3 |

### Financial Engineering (87–91)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 87 | Portfolio Optimization (Efficient Frontier) | Markowitz wine SKU portfolio | tier3 |
| 88 | Working Capital LP Optimizer | Minimize cash locked at 98% service level | tier3 |
| 89 | Vendor Credit Scoring | Composite vendor reliability score | tier3 |
| 90 | Real-Time Price Arbitrage Detector | Cheapest vendor per SKU matrix | tier3 |
| 91 | Inventory Carrying Cost Attribution | Opportunity cost per bottle per day | tier3 |

### Time-Series & Forecasting (92–96)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 92 | Multi-Horizon Ensemble Forecast | ARIMA + LightGBM + Prophet ensemble | tier3 |
| 93 | Demand Shock Detector | PELT/CUSUM structural break alerts | tier3 |
| 94 | Temporal Cross-Correlation Matrix | Metro trend → local sales lag | tier3 |
| 95 | Fourier Seasonality Decomposition | Weekly/monthly/annual seasonality per SKU | tier3 |
| 96 | Intraday Nowcast | Run-out projection from mid-service pace | tier3 |

### Agent Observability (97–101)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 97 | Agent Decision Audit Trail | Searchable decision_log timeline | tier2 |
| 98 | Saga Flow Visualizer | Live PO → email → approval DAG | tier2 |
| 99 | DLQ Pattern Analysis | Failure clusters by agent and cause | tier2 |
| 100 | Agent Throughput vs Latency Scatter | Performance scatter by hour | tier2 |
| 101 | Circuit Breaker Trip History | Open/half-open/closed transitions | tier2 |

### Behavioral Economics (102–106)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 102 | Decision Fatigue Index | Rubber-stamp rate by queue depth + time | tier3 |
| 103 | Loss Aversion Quantifier | Over-ordering after stockout events | tier3 |
| 104 | Anchoring Effect Tracker | First quote vs final price regression | tier3 |
| 105 | Confirmation Bias Audit | Faster approval for preferred wines | tier3 |
| 106 | Nudge Effectiveness Score | Loss vs gain framing action rates | tier3 |

### Competitive Intelligence (107–111)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 107 | Regional Trend Velocity Map | Geographic category acceleration heatmap | tier3 |
| 108 | First-Mover Signal | Wine on 4 new menus, not local yet | tier3 |
| 109 | Competitive Markup Radar | Your markup vs metro distribution | tier3 |
| 110 | Trend-to-Stale Decay Timer | Trend relevance half-life | tier3 |
| 111 | Market Category Share Estimate | Your share of metro category presence | tier3 |

### Document Intelligence (112–116)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 112 | Contract Term Extractor | MOQ, exclusivity, net-terms from PDFs | tier3 |
| 113 | Invoice Anomaly Z-Score | ±2σ invoice amount flags | tier3 |
| 114 | Price Sheet Version Diff | Month-over-month vendor price diff | tier3 |
| 115 | PDF Knowledge Graph | Wines ↔ prices ↔ vendors ↔ terms graph | tier3 |
| 116 | Vendor SLA Compliance Ledger | Contract terms vs actual performance | tier3 |

### Operational Risk (117–121)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 117 | Stockout Cascade Probability | Downstream failure from one stockout | tier3 |
| 118 | Single Point of Failure Matrix | No substitute + low stock + single vendor | tier3 |
| 119 | Holiday Cliff Edge Detector | Stock vs holiday demand + reorder window | tier3 |
| 120 | Weather Resilience Score | Portfolio robustness to weather patterns | tier3 |
| 121 | Infrastructure Degradation Impact Map | Analytics degradation if Toast/Gmail down | tier3 |

### Revenue Intelligence (122–125)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 122 | Revenue Leak Detector | Voids, comps, open checks by server/day | tier3 |
| 123 | Upsell Conversion Funnel | Menu → suggestion → acceptance → bottle | tier3 |
| 124 | Margin-Velocity Quadrant | Stars/Cash Cows/Question Marks/Dogs | tier3 |
| 125 | Optimal Table Turn vs Wine Spend | Turn duration vs wine revenue per cover | tier3 |

### Subscription & Lifecycle (126–128)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 126 | Repeat Wine Buyer Profile | Anonymized reorder patterns | tier3 |
| 127 | Wine Life Cycle Stage Classifier | Emerging/Growing/Peak/Declining/Zombie | tier3 |
| 128 | Sommelier AI Query Mining | Top queried topics → report templates | tier3 |

### Multi-Restaurant (129–133)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 129 | Cross-Branch Performance Benchmarking | Velocity, margin, stockout per branch | tier2 |
| 130 | Chain-Level Procurement Aggregation | Group volume discount leverage | tier2 |
| 131 | Staff Role Impact Analysis | Manager vs staff order outcomes | tier2 |
| 132 | New Restaurant Ramp Curve | Time to stable velocity post-onboarding | tier2 |
| 133 | Invite Funnel Analytics | Invite → accept → first action | tier2 |

### AI Self-Intelligence (134–138)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 134 | Recommendation Accept Rate by Model | Haiku vs Flash acceptance by type | tier3 |
| 135 | Hallucination Proximity Score | Draft factual grounding vs inferred | tier3 |
| 136 | Token Budget Burn Rate | Daily LLM spend per agent | tier3 |
| 137 | Context Compression Effectiveness | Summary recall across rounds | tier3 |
| 138 | Agent Auto-Escalation Analysis | MAX_ROUNDS hits by vendor/wine | tier3 |

### Notification Quality (139–142)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 139 | Email Thread Abandonment Rate | Threads not responded in 48h | tier2 |
| 140 | Digest Engagement Heatmap | Section click-through by position | tier2 |
| 141 | SMS vs Email Action Rate by Urgency | Channel speed by alert type | tier2 |
| 142 | Notification De-duplication Effectiveness | False suppression rate | tier2 |

### Predictive Procurement (143–147)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 143 | Vendor Availability Predictor | Predict vendor silence windows | tier3 |
| 144 | Dynamic Safety Stock Calculator | Variance-based safety stock per SKU | tier3 |
| 145 | Reorder Cycle Optimizer | Optimal frequency per vendor | tier3 |
| 146 | Forward-Buy ROI Calculator | Buy now vs predicted price ROI | tier3 |
| 147 | Order Batching Efficiency Score | Fragmentation cost vs batch savings | tier3 |

### Compliance & Quality (148–150)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 148 | Storage Temperature Compliance Audit | Zone vs ontology mismatch | tier2 |
| 149 | Pour Consistency Tracker | BTG pour variance by server/shift | tier3 |
| 150 | Expiry & Vintage Rotation Compliance | Drink-window countdown alerts | tier2 |

---

## Batch 3: Manager & Financial POV (151–210)

### P&L & Margin (151–158)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 151 | Wine Program P&L Statement | Dedicated wine income statement | tier1 |
| 152 | Gross Margin by Tier | Entry/mid/premium margin decomposition | tier1 |
| 153 | COGS Trend vs Menu Price Lag | COGS rising, menu price static alert | tier1 |
| 154 | Markup Erosion Alert | Landed cost past margin floor | tier1 |
| 155 | Category Contribution Margin Rank | Absolute $ by category | tier1 |
| 156 | Cost-Per-Pour vs Revenue-Per-Pour | BTG margin % per glass | tier1 |
| 157 | Menu Price vs Competitor Benchmarking | Your price vs metro peers | tier2 |
| 158 | True Wine COGS (Landed Cost) | Invoice + freight + storage + breakage | tier1 |

### Cash Flow & Working Capital (159–164)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 159 | Weekly Cash Flow Forecast | Inflows vs vendor outflows 10-day view | tier1 |
| 160 | Inventory Cash Lock Report | $ in 30/60/90-day non-movers | tier1 |
| 161 | Accounts Payable Aging | Vendor invoices by age bracket | tier1 |
| 162 | Payment Terms Optimization | Net-30/45/60 vs cash cycle value | tier2 |
| 163 | Seasonal Cash Flow Map | 12-month order/revenue cash troughs | tier2 |
| 164 | Order Batching Cash Impact | Liquidity from consolidated orders | tier2 |

### Budget & Variance (165–169)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 165 | Budget vs Actual (Monthly) | Spend vs budget by vendor/category | tier1 |
| 166 | Spend Velocity vs Budget Burn Rate | Pace to overspend by day 10 | tier1 |
| 167 | Emergency Order Premium Tracker | Rush order cost premium annualized | tier2 |
| 168 | Budget Reforecast Trigger | Auto-revised forecast at >10% variance | tier2 |
| 169 | Category Budget Allocation ROI | Budget shift vs revenue impact | tier2 |

### Vendor Financial (170–176)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 170 | Vendor Discount Realization Rate | % promos acted on vs available | tier2 |
| 171 | Vendor Rebate Tracker | Volume rebate threshold progress | tier2 |
| 172 | Invoice Dispute Recovery Log | Disputed vs recovered $ per vendor | tier2 |
| 173 | Vendor Concentration Financial Risk | Spend % per vendor HHI | tier1 |
| 174 | Multi-Vendor Price Convergence Alert | Cartel-like simultaneous price hikes | tier3 |
| 175 | Total Vendor Relationship Value | Spend + savings + reliability score | tier2 |
| 176 | Early Payment Discount Opportunity | 2/10 net-30 annualized ROI | tier2 |

### Pricing Strategy (177–181)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 177 | Dynamic Pricing Opportunity Scan | Inelastic wines → raise price candidates | tier2 |
| 178 | Price Floor Guard | Below-floor comp/override alert | tier1 |
| 179 | Happy Hour ROI Analysis | BTG happy hour net contribution | tier2 |
| 180 | Bundle Pricing Optimizer | Flight cost vs sell price vs optimal | tier2 |
| 181 | Price Increase Impact Simulator | Revenue impact at 3 elasticity scenarios | tier3 |

### Profitability (182–187)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 182 | Revenue Per Cover (Wine Only) | Wine $/guest by day/shift/server | tier1 |
| 183 | Server Wine Margin Contribution | Highest-margin server ranking | tier1 |
| 184 | Table Revenue Efficiency Score | Wine revenue per table per turn | tier2 |
| 185 | Private Event vs Floor Revenue | Margin/head events vs regular service | tier2 |
| 186 | Slow Day Profitability Analysis | Min sell-through to cover fixed costs | tier2 |
| 187 | Breakeven Occupancy for Wine Program | Min covers to break even on wine | tier2 |

### Waste, Shrinkage & Loss (188–192)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 188 | Shrinkage Dollar Value | Unexplained loss $ by shift/location | tier1 |
| 189 | Spoilage Cost by Wine Type | Opened BTG spoilage $/week | tier1 |
| 190 | Comp & Void Financial Impact | Comp/void $ by reason code | tier1 |
| 191 | Pour Variance Loss | Inconsistent pour annual $ cost | tier2 |
| 192 | Breakage Reserve vs Actual | Reserve rate vs actual breakage | tier2 |

### Financial Forecasting (193–197)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 193 | 13-Week Rolling Cash Flow Projection | Base/bull/bear wine cash forecast | tier2 |
| 194 | Wine Program ROI by Quarter | Quarterly wine program ROI | tier2 |
| 195 | CapEx Payback Calculator | Cellar/Coravin investment payback | tier3 |
| 196 | Sommelier Labor ROI | Staff cost vs incremental wine revenue | tier2 |
| 197 | Seasonal Working Capital Requirement | Pre-NYE/Valentine's capital timeline | tier2 |

### Multi-Location Financial (198–200)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 198 | Branch Margin Comparison | Gross margin across branches | tier1 |
| 199 | Consolidated Group Spend Report | Group spend for vendor leverage | tier1 |
| 200 | Cost Allocation by Location | Central purchase allocated COGS | tier2 |

### Tax & Compliance Financial (201–202)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 201 | Beverage Tax Liability Tracker | Running beverage tax accrual | tier2 |
| 202 | COGS Timing for Tax Optimization | Dec vs Jan order tax impact | tier3 |

### Negotiation Financial (203–206)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 203 | Negotiation Savings Ledger | Opening vs final price savings | tier2 |
| 204 | Best Deal of the Quarter Recap | Top 5 deals by $ saved | tier2 |
| 205 | Missed Deal Cost | Expired promo savings left behind | tier2 |
| 206 | Vendor Loyalty Premium Analysis | Reliability premium quantified | tier2 |

### Executive Reporting (207–210)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 207 | One-Page Weekly P&L Summary | Monday 90-second owner summary | tier1 |
| 208 | Month-End Close Checklist | Financial close completion gates | tier1 |
| 209 | Ownership Distribution Report | Wine EBITDA for partners/investors | tier2 |
| 210 | Year-Over-Year Wine Business Growth | Revenue, COGS, margin, covers YoY | tier1 |

---

## Batch 4: Inventory Deep-Dive (211–275)

### Physical Counting (211–218)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 211 | Blind Count Variance Engine | Blind count vs system, counter accuracy | tier2 |
| 212 | Cycle Count Scheduler | ABC rolling count schedule | tier1 |
| 213 | Perpetual vs Physical Drift Curve | Digital drift between counts | tier2 |
| 214 | Count Confidence Score | Stock number freshness rating | tier2 |
| 215 | Reconciliation Exception Queue | Mismatches sorted by $ impact | tier1 |
| 216 | Ghost Inventory Detector | Positive stock, zero movement 90d | tier1 |
| 217 | Negative Stock Sentinel | Sold more than recorded — immediate flag | tier1 |
| 218 | Count Cadence ROI | Count frequency vs shrinkage reduction | tier3 |

### Stock Accuracy (219–225)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 219 | Inventory Record Accuracy (IRA) % | % SKUs matching physical count | tier1 |
| 220 | Receiving Error Rate | Ordered vs received vs invoiced mismatch | tier1 |
| 221 | Optimistic Lock Conflict Log | Concurrent update collision frequency | tier2 |
| 222 | Untracked Movement Detector | Stock changes with no linked event | tier1 |
| 223 | Double-Entry Delivery Catch | Duplicate receiving detection | tier2 |
| 224 | Manual Override Audit | Who/when/why manual corrections | tier1 |
| 225 | Unit-of-Measure Mismatch Guard | Bottle vs case confusion at receiving | tier1 |

### Storage & Location (226–233)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 226 | Bin-Level Location Accuracy | System location vs physical location | tier2 |
| 227 | Storage Density Heatmap | Packed vs empty zones visual map | tier2 |
| 228 | Slotting Optimization by Velocity | Fast movers to bar reach | tier2 |
| 229 | Multi-Zone Split-Stock Tracker | Same SKU across multiple zones | tier2 |
| 230 | Retrieval Path Time Study | Seconds to retrieve during service | tier2 |
| 231 | Storage Capacity Forecast | Zone full-in-X-days projection | tier2 |
| 232 | Cross-Contamination Zone Audit | Wrong temp/humidity zone flags | tier2 |
| 233 | Dead Zone Identifier | Rarely accessed storage locations | tier3 |

### Replenishment & Par Levels (234–241)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 234 | Dynamic Par Level Engine | Weekly recalculated min/max | tier1 |
| 235 | Par Level Breach Predictor | Predict when par hit, not just alert | tier1 |
| 236 | Stockout Probability Score | P(stockout) before next delivery | tier1 |
| 237 | Overstock Detector | SKUs with >X weeks cover | tier1 |
| 238 | Reorder Point vs Actual Behavior Gap | System vs manager reorder timing | tier2 |
| 239 | Safety Stock Adequacy Monitor | Safety stock used vs idle | tier2 |
| 240 | Substitute-Aware Replenishment | Downgrade urgency if substitutes stocked | tier2 |
| 241 | Fill Rate Tracker | % demand met from on-hand stock | tier1 |

### Movement & Velocity (242–248)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 242 | Inventory Turnover Ratio (per SKU) | COGS ÷ avg inventory value | tier1 |
| 243 | Days Inventory Outstanding (DIO) | Avg days bottle sits before sale | tier1 |
| 244 | Velocity Acceleration/Deceleration | Sell-through rate second derivative | tier2 |
| 245 | Sell-Through Rate by Delivery Batch | How fast each delivery batch moves | tier2 |
| 246 | Stock-to-Sales Ratio Trend | Inventory value / sales over time | tier2 |
| 247 | FIFO Compliance | Older bottles leaving before newer | tier2 |
| 248 | Movement Frequency Classification | Fast/medium/slow/non-moving buckets | tier1 |

### Valuation & Financial Inventory (249–255)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 249 | Real-Time Inventory Valuation | Live total $ on hand FIFO/weighted avg | tier1 |
| 250 | Valuation by Aging Bucket | Value by 0-30/31-60/61-90/90+ days held | tier1 |
| 251 | Dead Stock Capital Report | $ locked in zero-velocity with liquidation list | tier1 |
| 252 | Carrying Cost per SKU | Full holding cost per bottle/day | tier2 |
| 253 | Inventory Shrinkage Rate (%) | Shrinkage % of total value, monthly | tier1 |
| 254 | Write-Off Ledger | Every write-off with $ and reason | tier1 |
| 255 | Landed Cost Inventory Basis | Value at true landed cost not invoice | tier1 |

### Aging & Lifecycle (256–261)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 256 | Drink-Window Compliance Monitor | Peak/exit window alerts per vintage | tier2 |
| 257 | Inventory Age Pyramid | Stock distribution by age | tier2 |
| 258 | Vintage Rotation Priority List | What to sell/feature next | tier2 |
| 259 | Spoilage Risk Forecast | BTG bottles spoiling before sellout | tier2 |
| 260 | Slow-Mover Intervention Tracker | Intervention → velocity response | tier2 |
| 261 | Vintage Transition Manager | Old vintage sell-down + new phase-in | tier2 |

### Multi-Location Inventory (262–266)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 262 | Inter-Branch Stock Balancing | Overstock A / stockout B transfer rec | tier2 |
| 263 | Transfer Cost vs Reorder Cost | Transfer vs fresh order economics | tier2 |
| 264 | Consolidated Stock Position | Group-wide stock per SKU | tier1 |
| 265 | Branch Inventory Accuracy Ranking | IRA % per branch | tier2 |
| 266 | Location-Level Turnover Comparison | Same SKU turnover across branches | tier2 |

### Inventory Risk (267–271)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 267 | Concentration Risk (Stock) | % inventory value in few SKUs | tier2 |
| 268 | Single-Vendor Stock Dependency | 100% stock from one vendor | tier2 |
| 269 | Event Stock Adequacy Pre-Check | Pre-event stock vs projected consumption | tier1 |
| 270 | Seasonal Stock Readiness Score | NYE/Valentine's readiness % | tier1 |
| 271 | Supply Disruption Simulator | Vendor outage 3-week stockout timeline | tier3 |

### Inventory Automation (272–275)

| ID | Name | Description | Priority |
|----|------|-------------|----------|
| 272 | Auto-Reorder Draft Generator | Consolidated PO draft at reorder point | tier1 |
| 273 | Anomaly-Triggered Recount Request | Impossible velocity → targeted recount | tier2 |
| 274 | Inventory Health Composite Score | Single 0-100 inventory health score | tier1 |
| 275 | Natural-Language Inventory Query | "How many Caymus and where?" via AI | tier2 |

---

## Batch 5: Toast Parity & Full-Restaurant Analytics (276–360)

These close the gap against **Toast Analytics** — the whole-restaurant operational domains the first 275 features never covered. Column `T` = Toast relationship: `N` native (import), `O` overlap (build wine-focused), `B` bridge (fuse with wine data), `I` integration. Column `S` = build strategy.

### Labor & Staffing (276–288)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 276 | Labor Cost % of Sales | Labor $ as % of revenue — core staffing KPI | N | import | tier1 |
| 277 | Prime Cost Dashboard | COGS + labor as % of revenue — #1 restaurant health metric | O | build | tier1 |
| 278 | Sales Per Labor Hour (SPLH) | Revenue per labor hour worked | N | import | tier1 |
| 279 | Scheduled vs Actual Labor Hours | Planned schedule vs clocked hours variance | N | import | tier2 |
| 280 | Overtime Cost Tracker | OT hours and premium cost by employee/dept | N | import | tier2 |
| 281 | Labor Cost per Cover | Staffing cost per guest served | N | import | tier2 |
| 282 | Department Labor Split | BOH vs FOH vs bar labor breakdown | N | import | tier2 |
| 283 | Break Compliance Monitor | Mandated break adherence by shift | N | import | tier3 |
| 284 | Employee Turnover & Retention | Staff churn rate and tenure trends | O | build | tier2 |
| 285 | Clock-In Punctuality | Late/early clock-in patterns | N | import | tier3 |
| 286 | Labor Demand Forecast vs Schedule | Predicted covers vs scheduled staff | B | bridge | tier3 |
| 287 | Wine Staff Productivity | Bar/somm labor cost vs wine revenue (extends #196) | B | bridge | tier2 |
| 288 | Tip Pool Distribution Ledger | How pooled tips split across staff | N | import | tier2 |

### Tips & Gratuity (289–293)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 289 | Tips by Server | Tip totals and average per server | N | import | tier2 |
| 290 | Tip % Trend Analysis | Tip percentage trends over time/shift | N | import | tier3 |
| 291 | Auto-Gratuity Tracking | Auto-grat on large parties vs manual | N | import | tier3 |
| 292 | Wine Sales ↔ Tip Correlation | Do wine-selling servers earn more tips? | B | bridge | tier2 |
| 293 | Tip-Out Compliance | Support-staff tip-out adherence | N | import | tier3 |

### Prime Cost & Full P&L (294–299)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 294 | Full-Restaurant P&L | Food + beverage + labor income statement | O | build | tier1 |
| 295 | Food COGS % | Food cost ratio (complements wine COGS #68) | O | build | tier1 |
| 296 | Controllable Expense Tracker | Controllable costs vs revenue | O | build | tier2 |
| 297 | Full-Restaurant Break-Even | Covers/revenue to break even (extends #187) | O | build | tier2 |
| 298 | Beverage vs Food Revenue Mix | Revenue split food/wine/beer/spirits/NA | N | import | tier1 |
| 299 | Wine as % of Total Revenue | Wine share of total and beverage revenue | B | bridge | tier1 |

### Full Menu PMIX (300–307)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 300 | Product Mix Report (All Items) | Full menu item-level sales breakdown | N | import | tier1 |
| 301 | Full Menu Engineering Matrix | Stars/Plowhorses/Puzzles/Dogs whole menu | O | build | tier2 |
| 302 | Food Item Profitability | Gross profit/margin per food item | N | import | tier2 |
| 303 | Modifier Sales Analysis | Top/bottom modifiers, attach, revenue | N | import | tier2 |
| 304 | Food-Wine Attach Rate | Which entrées drive wine sales on same check | B | bridge | tier1 |
| 305 | Menu Item Velocity (Food) | Units/day per food item with trend | N | import | tier2 |
| 306 | Combo / Entrée Attach Rate | Which items sell together (full menu) | N | import | tier3 |
| 307 | Course Timing & Pacing | Time between courses fired per table | N | import | tier3 |

### Payments & Reconciliation (308–314)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 308 | Payment Method Mix | Card vs cash vs mobile vs gift split | N | import | tier2 |
| 309 | Credit Card Processing Fees | Total and effective card fee cost | N | import | tier1 |
| 310 | Payout / Deposit Reconciliation | Bank deposits vs POS sales matching | N | import | tier1 |
| 311 | Chargeback & Dispute Tracker | Chargeback volume, reasons, recovery | N | import | tier2 |
| 312 | Gift Card Liability & Redemption | Outstanding liability and redemption rate | N | import | tier2 |
| 313 | Settlement Timing Analysis | Time from sale to bank settlement | N | import | tier3 |
| 314 | Effective Processing Rate | Blended % processing cost | N | import | tier2 |

### Cash & Loss Management (315–320)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 315 | Cash Over/Short Tracker | Drawer cash discrepancies over time | N | import | tier2 |
| 316 | Paid-In / Paid-Out Log | Non-sale cash movements audit | N | import | tier3 |
| 317 | Cash Drawer Variance by Employee | Over/short attributed to staff | N | import | tier2 |
| 318 | Discount by Reason Code | Full-restaurant discounts/comps (extends #190) | N | import | tier2 |
| 319 | Refund Analysis | Refund volume, value, reasons, staff | N | import | tier2 |
| 320 | Deposit Tracking | Daily bank deposit vs expected cash | N | import | tier3 |

### Guest & CRM (321–328)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 321 | Guest Visit Frequency | How often guests return | N | import | tier2 |
| 322 | New vs Returning Guest Mix | Share of new vs repeat guests | N | import | tier2 |
| 323 | Guest Lifetime Value | Cumulative spend per guest | O | build | tier2 |
| 324 | Average Check by Guest Segment | Check size across cohorts | N | import | tier3 |
| 325 | Wine Spend by Guest Segment | Do loyal/high-value guests buy more wine? | B | bridge | tier2 |
| 326 | Reservation vs Walk-In Analysis | Wine spend/covers by booking type | B | bridge | tier3 |
| 327 | Identified Repeat Wine Buyer | Loyalty-ID wine reorders (upgrades #126) | B | bridge | tier3 |
| 328 | Guest Wine Preference Profile | Per-guest styles for server prompts | B | bridge | tier2 |

### Loyalty & Marketing (329–334)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 329 | Loyalty Enrollment Rate | Guests enrolling in loyalty program | N | import | tier3 |
| 330 | Marketing Campaign ROI | Revenue lift attributable to campaigns | N | import | tier3 |
| 331 | Gift Card Sales Performance | Gift card sales volume and trends | N | import | tier3 |
| 332 | POS Promotion Redemption | Guest-facing promo (distinct from vendor #42-46) | O | build | tier2 |
| 333 | Guest Email/SMS Performance | Open/click/redemption on guest marketing | N | import | tier3 |
| 334 | Wine Club / Wine Promotion ROI | ROI of wine-specific promotions/clubs | B | bridge | tier2 |

### Order Channel & Service Mode (335–342)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 335 | Channel Mix | Dine-in vs takeout vs delivery vs online | N | import | tier1 |
| 336 | Online Ordering Performance | Toast online order volume, AOV | N | import | tier2 |
| 337 | Third-Party Delivery Analytics | DoorDash/UberEats volume + fees via Toast | N | import | tier2 |
| 338 | Revenue Center Breakdown | Bar vs dining room vs patio revenue | N | import | tier1 |
| 339 | Daypart / Dining Option Analysis | Lunch vs dinner vs late-night (extends #11) | N | import | tier1 |
| 340 | Table Section Performance | Revenue and turns by floor section | N | import | tier2 |
| 341 | Wine Sales by Channel | Does takeout/delivery/online include wine? | B | bridge | tier2 |
| 342 | Wine Sales by Revenue Center | Bar vs dining wine sales split | B | bridge | tier1 |

### Kitchen & Operations (343–347)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 343 | Speed of Service / Ticket Times | Order-to-serve times by station/shift | N | import | tier2 |
| 344 | Kitchen Throughput | Tickets/hour and bottleneck detection | N | import | tier3 |
| 345 | Live 86 List (Out-of-Stock) | Items currently unavailable from POS live | N | import | tier1 |
| 346 | Order Accuracy / Remake Rate | Voids/remakes signaling kitchen errors | N | import | tier3 |
| 347 | Wine Service Timing | Time from wine order to pour at table | B | bridge | tier3 |

### Tax & Full Compliance (348–351)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 348 | Full Sales Tax Liability | All-category tax accrual (extends #201) | N | import | tier2 |
| 349 | Service Charge Reporting | Service charges collected and distributed | N | import | tier3 |
| 350 | Gratuity Tax Handling | Taxable vs non-taxable gratuity reporting | N | import | tier3 |
| 351 | Multi-Jurisdiction Tax Rollup | Tax across locations in different jurisdictions | O | build | tier3 |

### Multi-Location POS Compare (352–355)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 352 | Same-Store Sales Growth | Comparable-location YoY growth (comps) | N | import | tier1 |
| 353 | Cross-Location Sales Ranking | Rank locations by any sales metric | N | import | tier2 |
| 354 | Location Performance Scorecard | Full KPIs side-by-side by location | O | build | tier2 |
| 355 | Wine Program Cross-Location Compare | Wine velocity/margin across branches (extends #198) | B | bridge | tier2 |

### Toast Integration Layer (356–360)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 356 | Toast Analytics API Ingestion Pipeline | Scheduled pull of Toast metrics — the enabler | I | import | tier1 |
| 357 | Check-Level Data Import | Per-check line items for attach-rate/cover analytics | I | import | tier1 |
| 358 | Labor Data Import | Employee/job/hours feed for labor analytics | I | import | tier2 |
| 359 | Guest Data Import | Guest/payment-card feed for CRM analytics | I | import | tier2 |
| 360 | Aggregated Sales Metrics Sync | Daily/weekly sales+labor rollups cached | I | import | tier1 |

---


## Batch 6: Seating Density & Sales ↔ Check-In (361–460)

> Outcome-linked metrics tying **sales** to **check-in density over seating** (covers÷seats, checks÷seats, sales÷seats) across time, space, causal links, and manager actions.

### Seating Density Core (361–375)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 361 | Check-In Density per Seat | Covers (check-ins) ÷ seats for a table/zone — occupancy intensity over seating | W | build | tier1 |
| 362 | Checks per Seat | Number of checks ÷ seats — visit intensity normalized by seating capacity | W | build | tier1 |
| 363 | Sales per Seat | Revenue ÷ seats — sales density over seating (extends revenue_per_seat) | W | build | tier1 |
| 364 | Wine Sales per Seat | Wine revenue ÷ seats — wine-program sales density over seating | B | bridge | tier1 |
| 365 | Revenue per Cover | Revenue ÷ covers — spend intensity per check-in guest | W | build | tier1 |
| 366 | Wine Revenue per Cover | Wine $ ÷ covers — wine attach economics per guest check-in | B | bridge | tier1 |
| 367 | Seat Utilization Rate | Occupied seat-hours ÷ available seat-hours in window | W | build | tier2 |
| 368 | Table Turnover per Seat | Turns ÷ seats — how hard each seat works | W | build | tier2 |
| 369 | Cover Density vs Sales Elasticity | Δ sales % / Δ check-in density % — does denser seating lift or crush spend? | W | build | tier2 |
| 370 | Optimal Check-In Density Band | Density band where avg check and wine attach jointly maximize | W | build | tier3 |
| 371 | Overcrowding Penalty Score | Sales shortfall when check-in density exceeds optimal band | W | build | tier2 |
| 372 | Underutilized Seat Opportunity $ | Forgone sales when density below capacity-normalized target | W | build | tier2 |
| 373 | BTG Pours per Seat | By-the-glass pours ÷ seats — pour density over seating | B | bridge | tier2 |
| 374 | Bottle Opens per Seat | Full bottles ÷ seats | B | bridge | tier2 |
| 375 | Tip $ per Seat | Tips ÷ seats — gratuity density over seating | O | build | tier2 |

### Density × Time (376–395)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 376 | Hourly Check-In Density Heatmap | Covers/seat by hour of day across the floor | W | build | tier1 |
| 377 | Daypart Sales vs Density | Lunch/dinner/late sales plotted against check-in density | W | build | tier1 |
| 378 | Same-Weekday Density Baseline | Today's covers/seat vs typical for that weekday | W | build | tier1 |
| 379 | Weekend vs Weekday Density Gap | Check-in density differential weekend vs weekday | W | build | tier2 |
| 380 | Pre-Theater Density Spike | Check-in density in T-90..T-0 of calendar events | W | build | tier2 |
| 381 | Weather-Adjusted Density | Check-in density residual after weather controls | W | build | tier3 |
| 382 | Density Ramp Curve | How quickly covers/seat climb after open | W | build | tier2 |
| 383 | Density Decay Curve | How covers/seat fall after peak | W | build | tier2 |
| 384 | 15-Minute Density Pulse | Rolling covers/seat every 15 minutes (live) | W | build | tier2 |
| 385 | Density Forecast 7-Day | Predicted covers/seat next 7 days by zone | W | build | tier2 |
| 386 | Sales-per-Seat Trend 30d | MoM trend of sales/seat | W | build | tier1 |
| 387 | Check-In Density Anomaly Day | Days where covers/seat z-score exceeds threshold | W | build | tier2 |
| 388 | Happy-Hour Density vs Wine Attach | Does denser happy hour lift or dilute wine attach? | B | bridge | tier2 |
| 389 | Brunch Density Economics | Brunch covers/seat vs wine/BTG sales | B | bridge | tier3 |
| 390 | Late-Night Density Margin | Late-night covers/seat × contribution margin | W | build | tier3 |
| 391 | Reservation Density Load | Booked covers/seat vs walk-in residual capacity | O | build | tier2 |
| 392 | No-Show Impact on Density | Expected vs realized covers/seat after no-shows | W | build | tier2 |
| 393 | Turn-Time vs Density | Avg dwell minutes as check-in density rises | W | build | tier2 |
| 394 | Server Load at Peak Density | Covers/server when zone density is top-quartile | W | build | tier2 |
| 395 | Density-Normalized Labor Cost | Labor $ ÷ covers/seat — cost efficiency at density | W | build | tier3 |

### Density × Space (396–420)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 396 | Zone Check-In Density Ranking | Rank zones by covers/seat | W | build | tier1 |
| 397 | Zone Sales-per-Seat Ranking | Rank zones by revenue/seat | W | build | tier1 |
| 398 | Bar-Adjacent Density Premium | Sales/seat lift for tables near bar controlling density | W | build | tier2 |
| 399 | Kitchen-Distance × Density Interaction | Does far-from-kitchen hurt more when density is high? | W | build | tier3 |
| 400 | Outdoor Seat Density Yield | Outdoor covers/seat and sales/seat vs indoor | W | build | tier2 |
| 401 | Poolside Density Seasonality | Pool-adjacent covers/seat by season | W | build | tier3 |
| 402 | 2-Top vs 4-Top Density Efficiency | Sales/seat and covers/seat by table size class | W | build | tier2 |
| 403 | Communal Table Density | Check-in density on communal vs standard tables | W | build | tier3 |
| 404 | Booth vs Banquette Density | Density and spend by seating furniture type | W | build | tier3 |
| 405 | Sightline Density Effect | Sales at high-density tables with/without kitchen sightline | W | build | tier3 |
| 406 | Noise-Proxy Density Drag | Spend drop when neighboring table density spikes | W | build | tier3 |
| 407 | Patio Heater Zone Density | Covers/seat in heated vs unheated patio segments | W | build | tier3 |
| 408 | Window Seat Density Premium | Sales/seat for window seats at matched density | W | build | tier2 |
| 409 | Private Dining Density Utilization | PDR covers/seat vs main floor | W | build | tier2 |
| 410 | Rebalancing Suggestion Map | Move covers from over-dense to under-dense zones | W | build | tier2 |
| 411 | Seat Cap Stress Test | Simulated sales if seats ±10% at current demand | W | build | tier3 |
| 412 | Fire-Code Density Headroom | Covers vs max occupancy headroom by zone | W | build | tier2 |
| 413 | Wheelchair-Accessible Seat Yield | Sales/seat on accessible tables vs peers | W | build | tier3 |
| 414 | High-Top Density Wine Mix | Wine category mix at high-top seating by density | B | bridge | tier2 |
| 415 | Lounge Seat Check-In Cadence | Arrival spacing (check-ins/hour/seat) in lounge | W | build | tier3 |
| 416 | Floor Section Density Parity | Variance of covers/seat across sections — fairness | W | build | tier2 |
| 417 | Host Stand Density Feed | Live covers/seat by section for host tablet | W | build | tier1 |
| 418 | Waitlist Pressure vs Density | Waitlist length predicted from current density | W | build | tier2 |
| 419 | Combine-Table Density Shock | Density/spend change when tables are combined | W | build | tier3 |
| 420 | Geomarker Density Clusters | Spatial clusters of high sales/seat at similar density | W | build | tier3 |

### Sales ↔ Density Link (421–445)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 421 | Avg Check vs Check-In Density Scatter | Per-table scatter of avg check against covers/seat | W | build | tier1 |
| 422 | Wine Attach vs Density Curve | Wine attach rate as a function of covers/seat | B | bridge | tier1 |
| 423 | Tip % vs Density | Tip percentage response to seating density | O | build | tier2 |
| 424 | Bottle Mix Shift at High Density | BTG vs bottle share when density is high | B | bridge | tier2 |
| 425 | Upsell Success vs Density | Server upsell conversion at low/med/high density | W | build | tier2 |
| 426 | Dessert Attach vs Density | Non-wine attach rates under density pressure | W | build | tier3 |
| 427 | Price Realization vs Density | Discounting/comping rate as density rises | W | build | tier2 |
| 428 | VIP Guest Density Avoidance | Do high-LTV guests avoid peak-density tables? | B | bridge | tier3 |
| 429 | Party Size × Density Interaction | Large parties' spend at crowded vs calm density | W | build | tier2 |
| 430 | Duration × Density × Sales | Three-way: dwell × covers/seat × revenue | W | build | tier3 |
| 431 | Partial Correlation Sales~Distance | Density | Geometry–sales link controlling for check-in density | W | build | tier2 |
| 432 | Partial Correlation Sales~Density | Seats | Density–sales link controlling for raw seat count | W | build | tier2 |
| 433 | Ridge Drivers including Density | Driver weights for avg check with density as a feature | W | build | tier2 |
| 434 | Density Peer Rank on Sales/Seat | Table peer rank on sales/seat within density decile | W | build | tier2 |
| 435 | Concentration of Sales in Dense Seats | HHI of revenue across high-density seats | W | build | tier3 |
| 436 | Forecast Gap: Sales given Density | Actual sales vs forecast conditioned on realized density | W | build | tier2 |
| 437 | Goal Pace on Sales/Seat | Pace to sales/seat goal | W | build | tier2 |
| 438 | Live Surge: Density + Sales Spike | Tables where covers/seat and sales spike together | W | build | tier1 |
| 439 | Basket Affinity under Density | Wine+food pairs that survive high-density service | B | bridge | tier3 |
| 440 | Comp Rate vs Density | Manager comps per cover at each density band | W | build | tier2 |
| 441 | Void/Remake vs Density | Kitchen errors correlated with floor density | O | build | tier3 |
| 442 | Wine Service Time vs Density | Order-to-pour minutes as covers/seat rises | B | bridge | tier2 |
| 443 | Sommelier Visit Rate vs Density | Sommelier table touches per cover at density bands | W | build | tier3 |
| 444 | Pairing Card Conversion vs Density | Pairing suggestion acceptance under density | B | bridge | tier3 |
| 445 | Check Open-Rate Latency vs Density | Time-to-first-item as seating fills | W | build | tier3 |

### Density Ops & Alerts (446–460)

| ID | Name | Description | T | S | Priority |
|----|------|-------------|---|---|----------|
| 446 | Density Alert Threshold Config | Configurable covers/seat alert bands per zone | W | build | tier1 |
| 447 | Seat Rebalance Recommendation | AI suggestion to reseat parties to improve sales/seat | W | build | tier2 |
| 448 | Open Section Timing by Density | When to open patio/PDR based on main-floor density | W | build | tier2 |
| 449 | Server Section Density Balancing | Assign sections to equalize covers/seat load | W | build | tier2 |
| 450 | Density-Aware Par for BTG | Raise/lower BTG par when forecast density is high | B | bridge | tier2 |
| 451 | Event Seating Density Planner | Target covers/seat for calendar events with sales goals | W | build | tier2 |
| 452 | Density Digest Email | Daily email: densest zones, sales/seat winners, alerts | W | build | tier1 |
| 453 | Host Script at Peak Density | Prompt host with wait/upsell script when density high | W | build | tier2 |
| 454 | Density Goal Setting | Set covers/seat and sales/seat goals by zone | W | build | tier2 |
| 455 | Cross-Location Density Benchmark | Compare covers/seat and sales/seat across branches | W | build | tier2 |
| 456 | Density × Wine 86 Risk | Stockout risk for BTG when density forecast spikes | B | bridge | tier2 |
| 457 | Check-In Density SLA | Service-recovery flag when density > X and ticket time > Y | W | build | tier3 |
| 458 | Seating Chart Density Overlay | Floor map colored by live covers/seat and sales/seat | W | build | tier1 |
| 459 | Density Experiment Framework | A/B seating layouts measuring sales vs density | W | build | tier3 |
| 460 | Post-Service Density Retro | End-of-night report: density bands vs sales outcomes | W | build | tier1 |

## Toast vs WineOps — strategic read

- **Don't rebuild (`toast_native`, 55 features):** Import via Toast Analytics API (`/era/v1/metrics`, check/labor/guest endpoints). These are commodity POS reports — 356–360 is the ingestion layer that unlocks them.
- **Build wine-focused (`toast_overlap`, 32):** Toast has a generic version; WineOps adds wine-program lens and vendor/COGS depth.
- **The real moat (`wineops_bridge`, 14 + `wineops_only`, 254):** Fusing Toast POS data with wine inventory, vendor email intelligence, procurement, and market trends — Toast structurally cannot do this.
- **Highest-leverage bridges:** #304 Food-Wine Attach Rate, #342 Wine Sales by Revenue Center, #299 Wine as % of Total Revenue, #292 Wine↔Tip Correlation, #325 Wine Spend by Guest Segment.

---

## Priority rollout summary

| Tier | Count | Definition |
|------|-------|------------|
| tier1 | 92 | Existing data, high manager value, fast to ship |
| tier2 | 170 | Differentiators, moderate build effort |
| tier3 | 98 | Advanced AI, causal models, simulations |

---

## Related WineOps infrastructure

| System | Features that depend on it |
|--------|--------------------------|
| Toast POS | 1-16, 9-16, 71, 96, 122-125, 182-183 |
| event_store / decision_log | 1, 37, 74, 97, 221-222 |
| EmailIntel / Gmail | 32, 35-36, 43-46, 112-116, 139 |
| storage_locations | 8, 27-30, 226-233 |
| trending_wines / menu_changes | 64-66, 107-111 |
| provider_intelligence | 31-37, 170-176, 203-206 |
| CalendarAgent | 47-50, 269-270 |
| ReportingAgent PDFs | 55-59, 207-209 |
| notification_deliveries | 7, 60-63, 139-142 |
| restaurant_inventory | 3-8, 249-255 |
| multi-location (Phase 26) | 8, 129-130, 198-200, 262-266 |
| Toast Analytics API (new) | 276-360 (labor, payments, guest, PMIX, channels, kitchen) |
| Toast ingestion layer | 356-360 (enables all `toast_native` + `bridge` features) |

---

*Catalog maintained in `.planning/`. Machine-readable exports: [JSON](./analytics-feature-catalog.json) · [CSV](./analytics-feature-catalog.csv). **460** features (Batch 6 = seating density). *
