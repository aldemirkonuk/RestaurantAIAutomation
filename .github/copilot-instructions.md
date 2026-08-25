# WineOps AI - Copilot Instructions

## Key Files to Reference
- `CLAUDE.md` - Working rules (the six non-negotiables). Start here.
- `.planning/00-index/HOME.md` - Vault entry point: org map, plan, agenda
- `.planning/decisions/` - ADRs + the open-decision register
- `DATABASE_OVERVIEW.md` - Schema reference
- `md/` - Legacy long-form docs (historical; `md_files/` was a duplicate tree, retired)

## Project Overview
WineOps AI is an AI-powered wine inventory management and procurement automation platform for restaurants. It features 17 AI agents, real-time notifications, and intelligent procurement.

## Tech Stack
- Frontend: React 18 + TypeScript + Vite + Tailwind + Tremor
- Backend: NestJS 10 + TypeScript + Socket.IO
- Agents: FastAPI + Python 3.11
- Database: Supabase (PostgreSQL + pgvector)
- Message Bus: RabbitMQ
- Cache: Redis
- AI/ML: Gemini Pro, YOLOv8, EasyOCR

## Project Structure