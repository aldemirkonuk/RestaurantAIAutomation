# 🔑 WineOps AI - Credentials Checklist

## ✅ Required for MVP (Immediate)

### 1. **Supabase** (Database & Auth)
**Priority:** 🔴 CRITICAL

- `SUPABASE_URL` - `https://exzueerziesmczwlhomd.supabase.co`
- `SUPABASE_PROJECT_ID` - `exzueerziesmczwlhomd`
- `SUPABASE_ANON_KEY` - `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4enVlZXJ6aWVzbWN6d2xob21kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MDYwMzQsImV4cCI6MjA4MzQ4MjAzNH0.OrNlKx09PdqKBNmc20rz9nUJ8893TMxQk_UARP5-mJU`
- `SUPABASE_SERVICE_ROLE_KEY` - `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4enVlZXJ6aWVzbWN6d2xob21kIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzkwNjAzNCwiZXhwIjoyMDgzNDgyMDM0fQ.NAIyKPFr7-Ini6lTPUYqkvvy2rWNk44O7ppJmkS9Vcw`

**Where to get:**
1. Go to https://supabase.com
2. Create a new project (or use existing)
3. Go to Project Settings → API
4. Copy the URL and keys
DONE✅✅✅✅✅✅

**Setup Required:**
- ✅ Create database tables using `md_files/02-architecture/DATABASE_SCHEMA.sql`
- Enable Row Level Security (RLS)
- ✅ Enable Realtime for key tables

---

### 2. **Google Cloud (Gemini Pro)** - AI Conversations
**Priority:** 🔴 CRITICAL

- `AIzaSyDAUUOM_UsuDoU19WwiONuUatg5ribdpYY` - For Gemini Pro LLM

**Where to get:**
1. Go to https://makersuite.google.com/app/apikey
2. Or https://console.cloud.google.com/apis/credentials
3. Create API Key
4. Enable Generative Language API
5. API Key: 

**Usage:**
- Procurement agent negotiation messages
- Provider conversation analysis
- Future: Natural language queries

**Cost:** Free tier available (60 requests/minute)

---

### 3. **RabbitMQ** (Message Queue)
**Priority:** 🟠 HIGH (Can use local Docker for development)

#### Option A: Local (Docker) - FREE ✅
```bash
# Already configured in docker-compose.yml
docker-compose up -d rabbitmq
```
- `RABBITMQ_URL=amqp://guest:guest@localhost:5672` 

#### Option B: CloudAMQP (Production) - $19/month
1. Go to https://www.cloudamqp.com
2. Create account → New Instance
3. Copy connection URL

-  For local development (non-encrypted)
`RABBITMQ_URL=amqp://guest:guest@localhost:5672/`

 Or with explicit port (optional, 5672 is default for amqp://)
`RABBITMQ_URL=amqp://guest:guest@localhost:5672/`

 If using a different vhost
`RABBITMQ_URL=amqp://guest:guest@localhost:5672/wineops`

**Recommendation:** Use Docker for development, CloudAMQP for production

---

### 4. **Redis** (Caching)
**Priority:** 🟠 HIGH (Can use local Docker for development)

#### Option A: Local (Docker) - FREE ✅
```bash
# Already configured in docker-compose.yml
docker-compose up -d redis
```
- ✅ **Status:** Running
- ✅ **REDIS_URL:** `redis://localhost:6379`
- **Test:** `docker exec wineops-redis redis-cli ping` (should return `PONG`)

#### Option B: Upstash (Production) - Free tier available ⬜
**Setup Steps:**
1. Go to https://upstash.com
2. Sign up (GitHub/Google/Email)
3. Click "Create Database"
4. Fill in:
   - Name: `Restaurant-AI_Automation`
   - Type: Redis
   - Region: Choose closest to users
   - Tier: Free (10,000 commands/day, 256 MB)
5. Copy the **Redis URL** (looks like `rediss://default:password@endpoint:6379`)
6. Add to your environment variables

**Expected format:**
- `REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT:6379`
- Note: Use `rediss://` (with double 's') for SSL

- `REDIS_URL=redis://default:password@hostname:6379`
- `UPSTASH_REDIS_REST_URL="https://witty-wahoo-37180.upstash.io"`
- `UPSTASH_REDIS_REST_TOKEN="AZE8AAIncDE2NDc2OTRmOWNkMzM0YTAyYmQ1OTk2MGIyY2M3MzZkZXAxMzcxODA"`

**Recommendation:** Use Docker for development, Upstash for production

---

## 🟡 Required for Full Functionality (Phase 1) 

### 5. **Plivo** (SMS & Voice) - Communication
**Priority:** 🟡 MEDIUM
TRIAL ACCOUNT will be started soon - 14 day

- `PLIVO_AUTH_ID` - Account SID
- `PLIVO_AUTH_TOKEN` - Auth token
- `PLIVO_PHONE_NUMBER` - Your Plivo phone number

**Where to get:**
1. Go to https://www.plivo.com
2. Sign up → Console
3. Get Auth ID and Token
4. Buy a phone number ($1-5/month)

**Cost:** 
- $0.0035/SMS in US
- Much cheaper than Twilio

**Alternative:** Twilio (more expensive but widely used)

**Mock Mode Available:** Set `MOCK_SMS=true` in .env for development

---

### 6. **Gmail SMTP** (Email) - Reports & Notifications
**Priority:** 🟡 MEDIUM

- `GMAIL_USER` - `wineops.ai@gmail.com`
- `GMAIL_APP_PASSWORD` - `Ata14112010@99`

**Where to get:**
1. Go to https://myaccount.google.com/apppasswords
2. Generate app password for "Mail"
3. Copy the 16-character password

**Alternative:** SendGrid, AWS SES, Resend

**Mock Mode Available:** Set `MOCK_EMAIL=true` in .env for development

---

### 7. **Toast POS API** (Point of Sale Integration)
**Priority:** 🟠 HIGH (for pilot restaurant)

- `TOAST_API_URL` - `https://ws-api.toasttab.com`
- `TOAST_CLIENT_ID` - `LFtKsTzs65YJcSObjDEunu0BZQTeuiK1`
- `TOAST_CLIENT_SECRET` - `2PwOGn7eGUkPnJrqqu9seYC-8csnPxhvEnnClxFjiKkHDwjjph9ua2pS3TFgHPxA`
- `TOAST_RESTAURANT_GUID` - `e5d6d489-25fa-4082-9cad-3e9e74225517`

**Where to get:**
1. Go to https://pos.toasttab.com
2. Developer Portal → Create Application
3. Request API access from Toast
4. Get credentials

**Note:** Toast API access requires approval and partnership

**Sandbox Available:** Yes, for testing

---

## 🟢 Optional / Future (Phase 2+)

### 8. **Stripe** (Payment Processing) - Future
**Priority:** 🟢 LOW (Phase 2)

- `STRIPE_PUBLISHABLE_KEY` `pk_test_51SnTPnBNZf1NJVqMIK3VTMeGUqEbAfuwEj5XUnevmQj8vgJmyF9NrNyoxL9DooAdVpEhEEHXMlBQQtSarcRE1mor005XfsvFcK`
- `STRIPE_SECRET_KEY` `sk_test_51SnTPnBNZf1NJVqMe1i9vbrjyJ21rie0iPFvp4skbC6KaFyGOMmEw9wUzVrwbhtt6ZeOcL0bZHwqkm2gY7uUhxGF00pe9tSVWZ`
- `STRIPE_WEBHOOK_SECRET` - not DONE

**Where to get:** https://dashboard.stripe.com/apikeys

**When needed:** For subscription billing, multi-tenant SaaS

---

### 9. **Sentry** (Error Tracking) - Monitoring
**Priority:** 🟢 LOW (Recommended for production)

- `SENTRY_DSN` - `https://bf411aff828fee8ebb4912ee374ce079@o4510677969010688.ingest.us.sentry.io/4510677993127936`

**Where to get:**
1. Go to https://sentry.io
2. Create project
3. Copy DSN

**Cost:** Free tier: 5K events/month

DONE✅✅✅✅✅✅
---

### 10. **Google Cloud Vision** (OCR) - Phase 2
**Priority:** 🟢 LOW (Phase 2)

- `GOOGLE_CLOUD_PROJECT_ID` - `restaurant-ai-automation-2026`
- `GOOGLE_CLOUD_VISION_KEY` - `will be done in future`

**Where to get:** https://console.cloud.google.com/vision

**When needed:** For invoice scanning (EasyOCR used for MVP)

---

### 11. **Vivino API** (Wine Data) - Future
**Priority:** 🟢 LOW (Phase 2)

- `VIVINO_API_KEY` - `will be done in future`

**Where to get:** Contact Vivino for API access

**When needed:** Auto-populate wine library from external sources

---

### 12. **WhatsApp Business API** - Future
**Priority:** 🟢 LOW (Phase 2)

- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`

**Where to get:** https://business.facebook.com/wa/manage/home/

**When needed:** WhatsApp notifications for managers

---

## 📋 Summary Checklist

### Immediate (MVP - Week 1)
- [ ] Supabase URL + Keys
- [ ] Google API Key (Gemini Pro)
- [ ] RabbitMQ URL (Docker or CloudAMQP)
- [ ] Redis URL (Docker or Upstash)

### Phase 1 (Week 2-4)
- [ ] Plivo credentials (or Twilio)
- [ ] Gmail SMTP credentials
- [ ] Toast POS API credentials

### Phase 2+ (Week 5+)
- [ ] Stripe keys
- [ ] Sentry DSN
- [ ] Google Cloud Vision
- [ ] Vivino API
- [ ] WhatsApp Business API

---

## 🔐 Security Best Practices

### ✅ DO:
- Store credentials in `.env` files (never commit!)
- Use different credentials for dev/staging/prod
- Rotate keys regularly (every 90 days)
- Use service accounts with minimal permissions
- Enable 2FA on all accounts
- Use secrets manager in production (AWS Secrets Manager, Vault)

### ❌ DON'T:
- Commit `.env` files to git
- Share credentials in Slack/email
- Use production keys in development
- Hard-code credentials in source code
- Reuse passwords across services
- Give service role keys to frontend

---

## 💰 Cost Estimate (Monthly)

### Development (MVP)
- Supabase: **FREE** (500MB database)
- Google Gemini Pro: **FREE** (60 req/min)
- RabbitMQ (Docker): **FREE** (local)
- Redis (Docker): **FREE** (local)
- **Total: $0/month**

### Production (Single Restaurant)
- Supabase Pro: **$25/month** (8GB database)
- Gemini Pro: **~$10/month** (moderate usage)
- CloudAMQP: **$19/month** (Little Lemur plan)
- Upstash Redis: **FREE** (10K commands/day)
- Plivo SMS: **~$20/month** (500 SMS)
- Gmail SMTP: **FREE**
- Toast POS API: **$0** (included with Toast subscription)
- **Total: ~$74/month**

### Production (10 Restaurants)
- Supabase Pro: **$25/month**
- Gemini Pro: **~$50/month**
- CloudAMQP: **$49/month** (Tough Tiger plan)
- Upstash Redis: **$10/month**
- Plivo SMS: **~$100/month**
- Total: **~$234/month** = **$23.40/restaurant**

---

## 🚀 Next Steps After Providing Credentials

Once you provide the credentials, we will:

1. **✅ Configure Environment Files**
   - Update `.env` in all services
   - Verify all connections
   - Test API endpoints

2. **✅ Setup Supabase Database**
   - Run `DATABASE_SCHEMA.sql`
   - Enable Row Level Security
   - Configure Realtime subscriptions
   - Seed initial data (200 wines)

3. **✅ Test All Services**
   - FastAPI health check
   - NestJS health check
   - React dashboard connection
   - WebSocket real-time updates
   - Agent message flow

4. **✅ Create Demo Restaurant**
   - Add pilot restaurant data
   - Configure managers/owners
   - Set initial inventory (50-100 wines)
   - Configure thresholds

5. **✅ End-to-End Testing**
   - Simulate POS sale
   - Trigger low-stock alert
   - Test procurement workflow
   - Test notification delivery
   - Verify real-time updates

6. **✅ Deploy to Staging**
   - Deploy FastAPI to Railway
   - Deploy NestJS to Fly.io
   - Deploy React to Vercel
   - Configure production URLs

7. **✅ Pilot Restaurant Onboarding**
   - Import their wine list
   - Configure their providers
   - Train manager on dashboard
   - Set up mobile notifications

---

## 📝 Credential Template (Fill This Out)

```bash
# Copy this template and fill in your values
# Save as .env in project root

#============================================================================
# CRITICAL - DATABASE
#============================================================================
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...

#============================================================================
# CRITICAL - AI/ML
#============================================================================
GOOGLE_API_KEY=AIzaSy...

#============================================================================
# HIGH PRIORITY - INFRASTRUCTURE
#============================================================================
RABBITMQ_URL=amqp://guest:guest@localhost:5672
REDIS_URL=redis://localhost:6379

#============================================================================
# MEDIUM PRIORITY - COMMUNICATION
#============================================================================
# Plivo (SMS)
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=

# Gmail (Email)
GMAIL_USER=
GMAIL_APP_PASSWORD=

#============================================================================
# HIGH PRIORITY - POS INTEGRATION
#============================================================================
TOAST_API_URL=https://ws-api.toasttab.com
TOAST_CLIENT_ID=
TOAST_CLIENT_SECRET=
TOAST_RESTAURANT_GUID=

#============================================================================
# OPTIONAL - MONITORING
#============================================================================
SENTRY_DSN=

#============================================================================
# DEVELOPMENT SETTINGS
#============================================================================
ENVIRONMENT=development
DEBUG=true
MOCK_SMS=true
MOCK_EMAIL=true
MOCK_LLM=false
BUFFER_WINDOW_MINUTES=30
DEFAULT_THRESHOLD_MIN=5

#============================================================================
# URLS (Development)
#============================================================================
FRONTEND_URL=http://localhost:3000
API_GATEWAY_URL=http://localhost:4000
AGENT_ORCHESTRATOR_URL=http://localhost:8000
```

---

## 🔍 How to Get Started (Priority Order)

### Week 1 - Core Infrastructure
1. ✅ Supabase (30 minutes)
2. ✅ Google Gemini Pro (5 minutes)
3. ✅ Start local Docker (2 minutes)

**You can start developing with just these 3!**

### Week 2 - Full MVP
4. ✅ Plivo SMS (30 minutes)
5. ✅ Gmail SMTP (10 minutes)

### Week 3 - Pilot Restaurant
6. ✅ Toast POS API (requires approval, 1-2 weeks)

---

## ❓ Questions?

**Q: Can I start without all credentials?**
A: Yes! Start with Supabase, Google Gemini Pro, and local Docker. Use mock modes for everything else.

**Q: Which credentials are absolutely required?**
A: Only Supabase and Google Gemini Pro. Everything else has mock/local alternatives.

**Q: How long does credential setup take?**
A: 30-45 minutes for core credentials (Supabase + Google)

**Q: Are there free alternatives?**
A: Yes! Local Docker for dev, free tiers for most services.

---

**Ready to proceed? Provide the credentials and let's get this running! 🚀**

