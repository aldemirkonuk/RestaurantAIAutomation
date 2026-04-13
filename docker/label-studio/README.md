# Label Studio Setup for Wine Menu Review

Two installation options: Docker (recommended) or standalone.

---

## Option 1: Docker Installation (Recommended)

### Start Label Studio

```bash
cd docker/label-studio
docker-compose up -d
```

### Access

- URL: http://localhost:8080
- Username: `admin@wineops.ai`
- Password: `wineops2026`

### Stop

```bash
docker-compose down
```

### View logs

```bash
docker-compose logs -f label-studio
```

---

## Option 2: Standalone Installation

### Install

```bash
pip install label-studio
```

### Start

```bash
label-studio start --port 8080
```

### First-time setup

1. Open http://localhost:8080
2. Sign up with your email and password
3. You'll be redirected to the projects page

---

## Create Wine Menu Review Project

### Step 1: Create Project

1. Click **Create** button
2. Project Name: `Wine Menu Extraction Review`
3. Description: `Human-in-the-loop review for 10-20% sample + flagged extractions`
4. Click **Save**

### Step 2: Import Data

For now, skip data import. We'll populate via API from the quality scorer.

Alternatively, to test with sample data:

```bash
# Export review queue to Label Studio format
curl http://localhost:8000/api/v1/scan/quality/queue > review_queue.json
```

Then import `review_queue.json` in Label Studio.

### Step 3: Labeling Setup

1. Click **Labeling Setup**
2. Click **Code** tab (top right)
3. Paste the contents of `wine_menu_config.xml`
4. Click **Save**

### Step 4: Start Reviewing

1. Click **Label** to start reviewing
2. For each task:
   - Review the extracted wines table
   - Select decision: correct / partially_correct / incorrect / not_wine_menu
   - Check any issues found
   - Add correction notes if needed
   - Click **Submit**

---

## Integration with WineOps Pipeline

### Export Corrections

Label Studio annotations can be exported and fed back into the active learning pipeline:

```bash
# Export annotations
curl http://localhost:8080/api/projects/1/export?exportType=JSON > annotations.json

# Process corrections
python scripts/process_label_studio_corrections.py annotations.json
```

### Automatic Data Sync (Future)

The quality scorer can push review items directly to Label Studio via API:

```python
from services.quality_scorer import get_quality_scorer
scorer = get_quality_scorer()

# Push review queue to Label Studio
await scorer.sync_to_label_studio("http://localhost:8080", api_key="YOUR_KEY")
```

---

## Troubleshooting

### Docker: Can't access localhost:8080

**Wait for initialization:** Label Studio takes 10-15 seconds to start. Check status:

```bash
docker-compose ps
docker-compose logs -f label-studio
```

Look for: `Starting development server at http://0.0.0.0:8080/`

**Test connection:**
```bash
curl http://localhost:8080/
```

Should return HTTP 302 (redirect to login).

### Docker: Port already in use

```bash
# Change port in docker-compose.yml
ports:
  - "8081:8080"  # Use 8081 instead
```

### Docker: Database connection errors

If you see `connection to server at "127.0.0.1", port 5432 failed`, the Postgres environment variables are incorrect. The docker-compose.yml should use:

```yaml
environment:
  - POSTGRE_HOST=postgres  # Not POSTGRESQL_HOST
  - POSTGRE_PORT=5432
  - POSTGRE_USER=labelstudio
  - POSTGRE_PASSWORD=labelstudio_pass
  - POSTGRE_NAME=labelstudio
```

Then restart:
```bash
docker-compose down && docker-compose up -d
```

### Standalone: Database errors

Label Studio uses SQLite by default. For production, configure PostgreSQL:

```bash
label-studio start --database postgresql://user:pass@localhost/labelstudio
```

### Can't access from other machines

```bash
label-studio start --host 0.0.0.0 --port 8080
```
