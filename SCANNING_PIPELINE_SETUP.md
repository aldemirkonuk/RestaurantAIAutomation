# Scanning Pipeline Setup Guide

Complete setup instructions for the FREE-First Wine Menu Extraction Pipeline.

---

## Quick Start

### 1. Install Dependencies

```bash
cd services/agent-orchestrator
pip install -r requirements.txt
```

**New dependencies added:**
- `surya-ocr` - Self-hosted OCR (Apache 2.0, free)
- `PyPDF2` - PDF text extraction
- `pdf2image` - PDF to image conversion
- `playwright` - Headless browser for web crawling

### 2. Install Playwright Browsers

```bash
playwright install chromium
```

### 3. Start Label Studio (Optional - for human review)

**Option A: Docker (recommended)**
```bash
cd docker/label-studio
docker-compose up -d
```

**Option B: Standalone**
```bash
pip install label-studio
label-studio start --port 8080
```

**Option C: Quick script**
```bash
./scripts/start_label_studio.sh
```

Access at http://localhost:8080

---

## Architecture Overview

### Live camera capture stack (target — 2026-07-27)

Canonical stack for `/get-started` scan / in-app menu camera. **Boxes live; OCR only on shutter.**

```
Live preview (camera frames)
  └─ RF-DETR          → region / line boxes only (~2–5 fps)
                         NO full OCR per frame

Shutter / uploaded photo
  └─ PaddleOCR        → text + layout (Apache 2.0; production default)
     or DeepSeek-OCR  → GPU path when available (MIT)

Field parse
  └─ Gemini (now)     → producer / vintage / region / price / etc.
  └─ evaluate later   → Qwen2.5-VL / RolmOCR as open VLM alternatives
```

| Stage | Tool | Role | Do not |
|---|---|---|---|
| Live preview | **RF-DETR** | Draw detection boxes in the camera modal | Run full OCR every frame |
| On capture | **PaddleOCR** (or **DeepSeek-OCR** on GPU) | Extract text/layout from the shuttered image | Stream OCR over live video |
| Field parse | **Gemini** (keep for now) | Structure wine fields from OCR/text+image | Replace prematurely without eval |
| Field parse (eval) | Qwen2.5-VL / RolmOCR | Open VLM candidates for later A/B | Assume they beat Gemini on messy menus yet |

**Current code note:** live preview may still use Ultralytics YOLO until RF-DETR is wired; invoice/PDF path may still use Surya. New work should converge on the target stack above.

### FREE Path (95% of data)

```
HTML Menu → Playwright DOM → Local Parser → Structured Wines ($0)
Digital PDF → PyPDF2 → Local Parser → Structured Wines ($0)
Scanned PDF → Surya OCR → Local Parser → Structured Wines ($0)
  (target: migrate scanned-PDF OCR toward PaddleOCR where practical)
```

### PAID Path (5% of data)

```
Complex Text → Gemini TEXT → Structured Wines (~$0.0001/page)
Photo Upload → PaddleOCR (or DeepSeek-OCR) → Gemini field parse (~$0.001/photo)
```

**Projected costs:**
- 10,000 crawled menus: ~$0.05 total
- 1,000 user photos: ~$1.00 total

---

## Usage Examples

### CLI: Ingest Documents

```bash
# Ingest a menu PDF (dev upload, highest quality tier)
python scripts/ingest.py menu --source dev_pdf --path /path/to/menu.pdf

# Ingest a folder of menus
python scripts/ingest.py menu --source dev_pdf --path /path/to/menus/

# Ingest with extraction
python scripts/ingest.py menu --source dev_pdf --path menu.pdf --restaurant "The French Laundry" --extract

# Ingest an invoice
python scripts/ingest.py invoice --source dev_pdf --path invoice.pdf

# View dataset statistics
python scripts/ingest.py stats
```

### API: Extract from Text (FREE)

```bash
curl -X POST http://localhost:8000/api/v1/scan/extract/text \
  -H "Content-Type: application/json" \
  -d '{
    "text": "BORDEAUX\nChateau Margaux 2015 $450\nChateau Latour 2016 $520",
    "source_type": "html",
    "restaurant_name": "Restaurant ABC"
  }'
```

Response:
```json
{
  "success": true,
  "extraction_method": "free_local_parser",
  "cost": 0.0,
  "wines": [
    {
      "wine_name": "Chateau Margaux",
      "vintage": 2015,
      "price": 450.0,
      "country": "France",
      "region": "Bordeaux",
      "section_path": "Bordeaux",
      "confidence": 0.75
    }
  ],
  "total_wines": 2
}
```

### API: Extract from PDF (FREE)

```bash
# Convert PDF to base64
PDF_B64=$(base64 -i menu.pdf)

curl -X POST http://localhost:8000/api/v1/scan/extract/pdf \
  -H "Content-Type: application/json" \
  -d "{
    \"pdf_base64\": \"$PDF_B64\",
    \"document_type\": \"menu\",
    \"restaurant_name\": \"Restaurant ABC\"
  }"
```

### API: Extract from Photo (PAID)

```bash
# Convert photo to base64
PHOTO_B64=$(base64 -i photo.jpg)

curl -X POST http://localhost:8000/api/v1/scan/extract/photo \
  -H "Content-Type: application/json" \
  -d "{
    \"image_base64\": \"$PHOTO_B64\",
    \"document_type\": \"menu\",
    \"restaurant_name\": \"Restaurant ABC\"
  }"
```

Response includes field-parse cost when Gemini is used after PaddleOCR / DeepSeek-OCR (~`$0.001`/photo typical).

---

## Crawler Usage

### Discover Restaurants (OpenTable)

```bash
curl -X POST http://localhost:8000/api/v1/scan/crawler/discover \
  -H "Content-Type: application/json" \
  -d '{
    "city_slug": "new-york",
    "max_pages": 5
  }'
```

**Available cities:**
- new-york, san-francisco, los-angeles, chicago, miami
- washington-dc, boston, seattle, portland, nashville
- denver, austin, philadelphia, atlanta, las-vegas

### Crawl a Restaurant Website

```bash
curl -X POST http://localhost:8000/api/v1/scan/crawler/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "website_url": "https://restaurant.com",
    "restaurant_name": "Restaurant ABC"
  }'
```

### Get Pending Restaurants for a City

```bash
curl http://localhost:8000/api/v1/scan/crawler/pending/new-york
```

---

## Quality Review Workflow

### 1. Get Review Queue

```bash
curl http://localhost:8000/api/v1/scan/quality/queue
```

### 2. Approve an Item

```bash
curl -X POST http://localhost:8000/api/v1/scan/quality/approve/{review_id}
```

### 3. Submit Corrections

```bash
curl -X POST http://localhost:8000/api/v1/scan/quality/correct/{review_id} \
  -H "Content-Type: application/json" \
  -d '{
    "corrections": {
      "wine_name": "Correct Name",
      "vintage": 2019,
      "price": 125.00
    }
  }'
```

### 4. View Statistics

```bash
curl http://localhost:8000/api/v1/scan/quality/stats
```

---

## Active Learning

### Get Accuracy Report

```bash
curl http://localhost:8000/api/v1/scan/learning/accuracy
```

Response:
```json
{
  "accuracy": {
    "overall_accuracy": 0.8234,
    "per_field": {
      "wine_name": {"accuracy": 0.92, "total_reviewed": 150},
      "vintage": {"accuracy": 0.88, "total_reviewed": 120},
      "price": {"accuracy": 0.95, "total_reviewed": 140}
    },
    "lowest_accuracy_fields": [
      ["grape_variety", 0.65],
      ["classification", 0.58]
    ]
  },
  "proposed_rules": [
    {
      "pattern": "region_map: pauillac -> bordeaux",
      "description": "Parser mapped 'pauillac' but correct is 'bordeaux'",
      "status": "proposed"
    }
  ],
  "benchmark": {
    "size": 45,
    "target": 200
  }
}
```

### Run Improvement Cycle

```bash
curl -X POST http://localhost:8000/api/v1/scan/learning/run-cycle
```

### Run Benchmark Test

```bash
curl http://localhost:8000/api/v1/scan/learning/benchmark
```

---

## Restaurant Dataset Queries

### List All Cities

```bash
curl http://localhost:8000/api/v1/scan/restaurants/cities
```

### Get Restaurants in a City

```bash
curl http://localhost:8000/api/v1/scan/restaurants/new_york
```

Response includes per-restaurant wine menu snapshots:
```json
{
  "city": "new_york",
  "count": 23,
  "restaurants": [
    {
      "restaurant_name": "Le Bernardin",
      "city": "New York",
      "menu_date": "2026-02-15",
      "total_wines": 450,
      "sections": [...],
      "extraction_confidence": 0.87,
      "cuisine_type": "French",
      "price_range": "$$$$",
      "website_url": "https://le-bernardin.com"
    }
  ]
}
```

---

## Automated Tasks (Celery Beat)

Add to `services/agent-orchestrator/jobs/celery_app.py`:

```python
from celery.schedules import crontab

celery_app.conf.beat_schedule = {
    'daily-menu-crawl': {
        'task': 'scraping.daily_crawl',
        'schedule': crontab(hour=2, minute=0),  # Daily at 2 AM
    },
    'weekly-discovery': {
        'task': 'scraping.discovery',
        'schedule': crontab(hour=1, minute=0, day_of_week='monday'),
        'kwargs': {'max_pages': 10},
    },
    'daily-research-unknowns': {
        'task': 'scraping.research_unknowns',
        'schedule': crontab(hour=4, minute=0),
        'kwargs': {'max_wines': 20},
    },
}
```

---

## Configuration (Environment Variables)

Add to `.env`:

```bash
# Scanning Pipeline
SCAN_SURYA_ENABLED=true
SCAN_VLM_ENABLED=true
SCAN_VLM_MODEL=gemini-2.0-flash
SCAN_PARSER_CONFIDENCE_THRESHOLD=0.50
SCAN_QUALITY_ACCEPT_THRESHOLD=85.0
SCAN_QUALITY_REVIEW_THRESHOLD=50.0
SCAN_QUALITY_SAMPLE_RATE=0.15

# Crawler
CRAWL_RATE_LIMIT_PER_DAY=100
CRAWL_PAGE_TIMEOUT_MS=20000
CRAWL_NAVIGATION_DELAY_S=1.5
CRAWL_FRESHNESS_DAYS=30
CRAWL_RESPECT_ROBOTS_TXT=true
```

---

## Testing the Pipeline

### Test 1: HTML Extraction (FREE)

```bash
# Create a test HTML menu
cat > test_menu.html << 'EOF'
<div class="wine-list">
  <h2>RED WINES</h2>
  <h3>Bordeaux</h3>
  <p>Chateau Margaux 2015 - $450</p>
  <p>Chateau Latour 2016 - $520</p>
  <h3>Burgundy</h3>
  <p>Domaine de la Romanee-Conti Echezeaux 2018 - $680</p>
</div>
EOF

# Extract text from HTML (in real usage, Playwright does this)
TEXT=$(cat test_menu.html | sed 's/<[^>]*>//g')

# Call API
curl -X POST http://localhost:8000/api/v1/scan/extract/text \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$TEXT\", \"source_type\": \"html\"}"
```

### Test 2: PDF Extraction (FREE)

```bash
# Use the CLI tool
python scripts/ingest.py menu --source dev_pdf --path test_menu.pdf --extract
```

### Test 3: Crawler Discovery

```bash
# Discover restaurants in NYC
curl -X POST http://localhost:8000/api/v1/scan/crawler/discover \
  -H "Content-Type: application/json" \
  -d '{"city_slug": "new-york", "max_pages": 2}'

# Check pending restaurants
curl http://localhost:8000/api/v1/scan/crawler/pending/new-york

# Crawl first restaurant
curl -X POST http://localhost:8000/api/v1/scan/crawler/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "website_url": "https://example-restaurant.com",
    "restaurant_name": "Example Restaurant"
  }'
```

---

## File Structure

```
services/agent-orchestrator/services/
├── html_menu_parser.py          # Core FREE parser (750 lines)
├── pdf_extraction_service.py    # PDF pipeline (487 lines)
├── wine_menu_classifier.py      # Quality gate (296 lines)
├── vlm_extraction_service.py    # Gemini fallback (453 lines)
├── quality_scorer.py            # 3-signal scoring (317 lines)
├── web_crawler.py               # Playwright crawler (443 lines)
├── opentable_discovery.py       # Restaurant discovery (480 lines)
├── restaurant_dataset_service.py # Per-restaurant datasets (348 lines)
├── wine_research_service.py     # Master library gap (380 lines)
└── active_learning_service.py   # Accuracy tracking (632 lines)

datasets/
├── raw_uploads/menus/           # Manual dev uploads
├── raw_uploads/invoices/        # Manual dev uploads
├── annotated/menus/             # Human-reviewed (benchmark)
├── scraped/menus/               # Web-crawled
└── restaurant_menus/            # Per-restaurant JSONL snapshots

scripts/
├── ingest.py                    # CLI ingestion tool
├── start_label_studio.sh        # Label Studio launcher
└── process_label_studio_corrections.py  # Sync corrections to active learning

docker/label-studio/
├── docker-compose.yml           # Label Studio + Postgres
├── wine_menu_config.xml         # Annotation template
└── README.md                    # Setup instructions
```

---

## Next Steps

1. **Start the API server:**
   ```bash
   cd services/agent-orchestrator
   uvicorn main:app --reload --port 8000
   ```

2. **Upload test menus:**
   ```bash
   python scripts/ingest.py menu --source dev_pdf --path /path/to/test/menus/
   ```

3. **Start Label Studio:**
   ```bash
   ./scripts/start_label_studio.sh
   ```

4. **Run discovery (optional):**
   ```bash
   curl -X POST http://localhost:8000/api/v1/scan/crawler/discover \
     -H "Content-Type: application/json" \
     -d '{"city_slug": "new-york", "max_pages": 3}'
   ```

5. **Check quality review queue:**
   ```bash
   curl http://localhost:8000/api/v1/scan/quality/queue
   ```

6. **View accuracy metrics:**
   ```bash
   curl http://localhost:8000/api/v1/scan/learning/accuracy
   ```

---

## Cost Optimization

The pipeline is designed to minimize API costs:

| Scenario | Method | Cost |
|----------|--------|------|
| 10,000 restaurant websites crawled | HTML DOM + PyPDF2 + Surya | **$0.05** |
| 1,000 user photo uploads | PaddleOCR / DeepSeek-OCR + Gemini fields | **$1.00** |
| 100 complex menus (parser fails) | Gemini TEXT fallback | **$0.01** |

**Total for 10K menus + 1K photos: ~$1.06**

Compare to VLM-first approach: 10K menus × $0.001 = **$10.00** (10x more expensive)

---

## Quality Assurance

### 3-Signal Quality Scoring

Every extraction gets a composite score from:

1. **Parser Confidence** (40%) - How confident is the local parser?
2. **Field Completeness** (40%) - How many identity fields are populated?
3. **Cross-Validation** (20%) - Do parser output and OCR text agree?

**Score >= 85:** Auto-accept → master library + restaurant dataset  
**Score 50-84:** Queue for dev review  
**Score < 50:** Auto-reject (flag for reprocessing)

### Human Review (10-20% Sample)

- 15% random sample of auto-accepted extractions
- 100% of low-confidence extractions
- Review in Label Studio or via API
- Corrections feed back into active learning

### Active Learning Loop

1. Dev reviews extraction → submits corrections
2. Accuracy tracker updates per-field accuracy rates
3. Rule learner proposes new regex patterns
4. Benchmark validates against 200 gold-standard docs
5. If improvement detected → patterns merged into parser

---

## OpenTable Discovery → Restaurant Crawl Flow

### Phase A: Discovery

```bash
# Discover restaurants in San Francisco
curl -X POST http://localhost:8000/api/v1/scan/crawler/discover \
  -d '{"city_slug": "san-francisco", "max_pages": 5}'
```

This searches OpenTable and extracts:
- Restaurant name, cuisine, price range, neighborhood, rating
- **Website URL** (the key field)
- OpenTable URL (for reference only)

Saves to `datasets/restaurant_menus/_directory_san_francisco.json`

### Phase B: Crawl Restaurant Websites

```bash
# Get pending restaurants
curl http://localhost:8000/api/v1/scan/crawler/pending/san-francisco

# Crawl one restaurant
curl -X POST http://localhost:8000/api/v1/scan/crawler/crawl \
  -d '{
    "website_url": "https://restaurant-website.com",
    "restaurant_name": "Restaurant Name"
  }'
```

This visits the **restaurant's own website** (not OpenTable), extracts:
- HTML menu text from DOM (FREE)
- PDF links (downloads and extracts, FREE)
- Runs through classifier → parser → quality scorer
- Saves to restaurant dataset

**Legal:** Only visits restaurant's own website. OpenTable used purely for discovery.

---

## Dataset Outputs

### Restaurant Menu Snapshots

Location: `datasets/restaurant_menus/{city}.jsonl`

Each line is a restaurant's wine menu snapshot:

```json
{
  "restaurant_name": "Le Bernardin",
  "city": "New York",
  "state": "NY",
  "menu_date": "2026-02-15",
  "source_type": "scraped",
  "source_url": "https://le-bernardin.com/wine-list",
  "extraction_method": "free",
  "extraction_confidence": 0.87,
  "total_wines": 450,
  "sections": [
    {
      "name": "Champagne",
      "hierarchy_path": "Sparkling/Champagne",
      "wines": [
        {
          "wine_name": "Dom Pérignon",
          "vintage": 2013,
          "price_bottle": 450.0,
          "currency": "USD",
          "extraction_confidence": 0.92
        }
      ]
    }
  ],
  "cuisine_type": "French",
  "price_range": "$$$$",
  "website_url": "https://le-bernardin.com"
}
```

### Master Wine Library

Deduped wine entries saved to Supabase `master_wine_library` table.

### Audit Trail

Every invoice processed is logged to `datasets/raw_uploads/invoices/_audit_trail.jsonl`.

---

## Troubleshooting

### Surya OCR not working

```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt-get install poppler-utils

# Install system dependencies (macOS)
brew install poppler

# Verify installation
python -c "import surya; print('Surya OK')"
```

### Playwright browser not found

```bash
playwright install chromium
```

### Label Studio connection refused

```bash
# Check if running
docker ps | grep label-studio

# View logs
cd docker/label-studio
docker-compose logs -f
```

### Rate limit reached

The crawler has a daily limit (default 100/day). To change:

```bash
# In .env
CRAWL_RATE_LIMIT_PER_DAY=500
```

Or programmatically:

```python
from services.web_crawler import get_crawler_service
crawler = get_crawler_service(rate_limit=500)
```

---

## Performance Benchmarks

Based on the FREE-first architecture:

| Task | Time | Cost |
|------|------|------|
| HTML menu (50 wines) | ~0.5s | $0 |
| Digital PDF (100 wines) | ~1.2s | $0 |
| Scanned PDF (100 wines) | ~8s (Surya OCR) | $0 |
| Photo (Gemini Vision) | ~2s | $0.001 |
| Complex text fallback | ~1.5s | $0.0001 |

**Throughput:** ~5,000 menus/hour on a single CPU instance (all FREE paths).

---

## Production Deployment

### GPU Acceleration (Optional)

For capture OCR and scanned PDFs:

```bash
# In .env
SCAN_SURYA_DEVICE=cuda          # legacy PDF path (Surya)
# Target stack: prefer PaddleOCR GPU, or DeepSeek-OCR when GPU is available
# Live preview stays RF-DETR boxes-only — do not enable full OCR on the live stream

# Requires CUDA-capable GPU
```

### Celery Workers

```bash
# Start Celery worker for background tasks
celery -A jobs.celery_app worker --loglevel=info

# Start Celery beat for scheduled tasks
celery -A jobs.celery_app beat --loglevel=info
```

### Scale Crawling

The 100/day limit is conservative. For production:

```bash
# In .env
CRAWL_RATE_LIMIT_PER_DAY=1000  # 1,000 websites/day
```

With proper rate limiting and caching, you can scale to:
- 1,000 websites/day = 30,000/month
- ~$1.50/month in API costs (only for VLM fallbacks)

---

## Summary

You now have:

✅ **FREE extraction** for 95% of data (HTML, PDF, OCR)  
✅ **VLM fallback** for photos and complex cases  
✅ **Live camera target stack** — RF-DETR (boxes) → PaddleOCR / DeepSeek-OCR (shutter) → Gemini fields  
✅ **Hard rule** — no full OCR on every live frame  
✅ **Quality gates** to filter non-wine menus  
✅ **3-signal scoring** with human review (10-20% sample)  
✅ **Active learning** that improves parser accuracy over time  
✅ **Per-restaurant datasets** for AI recommendations  
✅ **OpenTable discovery** → restaurant website crawling  
✅ **Audit trail** for invoices  
✅ **Label Studio** for human review  
✅ **Celery tasks** for daily automation  

**Next:** Start ingesting menus and building your dataset!
