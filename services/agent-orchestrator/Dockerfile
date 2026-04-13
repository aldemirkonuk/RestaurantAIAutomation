# WineOps Agent Orchestrator — Railway Production Dockerfile
# Uses requirements.prod.txt to exclude ~2GB ML/OCR stack
# Port: Railway injects $PORT env var at runtime (default 8000 for local docker run)

FROM python:3.11-slim

WORKDIR /app

# System dependencies required by golden-path agents:
# - libpq-dev: psycopg2 (Supabase PostgreSQL driver)
# - libglib2.0-0, libsm6, libxext6: transitive deps from pillow/aiohttp
# - libgomp1: some numpy/linear algebra ops
# - build-essential: compile C extensions in some packages
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy only requirements first for Docker layer caching
COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt

# Copy application source
COPY . .

# Railway injects $PORT at runtime. Default to 8000 for local docker run.
# Shell form (sh -c) is required for $PORT variable expansion.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
