# GitHub Actions Workflows - Summary

**Source:** `.github/workflows/README.md` (full details in repository)  
**Last Updated:** January 2026

---

## Overview

Automated CI/CD workflows for WineOps AI live in **`.github/workflows/`**. Use this doc for a quick reference; see the **YAML files** in that directory for exact definitions.

---

## Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **CI** (`ci.yml`) | Push to `main`/`develop`, PRs | Lint (TS + Python), build (Turborepo), test (Vitest/Jest, Pytest), Trivy security |
| **Deploy** (`deploy.yml`) | Push to `main`, version tags `v*.*.*`, manual | Deploy frontend → Vercel, API → Fly.io, agents → Railway; migrations; health checks; Slack notify |
| **Dependabot** (`dependabot.yml`) | Weekly (Mondays) | Automated dependency updates (npm/pnpm, pip, Actions) |
| **CodeQL** (`codeql.yml`) | Push, PR, weekly | Security scanning for JS/TS and Python; results in GitHub Security tab |

---

## Required Secrets

Configure under **Settings → Secrets and variables → Actions**:

- **Vercel:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- **Fly.io:** `FLY_API_TOKEN`
- **Railway:** `RAILWAY_TOKEN`
- **Supabase:** `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- **Service URLs:** `API_GATEWAY_URL`, `AGENT_ORCHESTRATOR_URL`, `FRONTEND_URL`
- **Notifications:** `SLACK_WEBHOOK`

---

## Deployment Flow

1. Push to `main` → CI runs → Deploy runs  
2. Frontend → Vercel, API Gateway → Fly.io, Agent Orchestrator → Railway  
3. Database migrations → Health checks → Slack notification  

**Manual:** Actions → Deploy to Production → Run workflow, or `gh workflow run deploy.yml`  
**Tagged release:** `git tag v1.0.0 && git push origin v1.0.0` → workflow creates GitHub Release

---

## Quick Links

- **Workflow runs:** `https://github.com/aldemirkonuk/wineops-ai/actions`
- **Workflow files:** `.github/workflows/` (e.g. `ci.yml`, `deploy.yml`, `dependabot.yml`, `codeql.yml`)
- **GitHub Actions docs:** https://docs.github.com/actions  
- **Local testing:** `brew install act` then `act push`; `brew install actionlint` for workflow linting

---

**For full setup, branching, troubleshooting, and examples, see `.github/workflows/README.md` in the repository.**
