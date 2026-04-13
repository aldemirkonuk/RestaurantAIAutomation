# 🔐 PRODUCTION CREDENTIALS CHECKLIST

**WineOps AI - Complete Credentials & Configuration Guide**  
**Date:** January 10, 2026

---

## 📋 REQUIRED CREDENTIALS FOR PRODUCTION

### 1. 🗄️ DATABASE (Supabase)

**Location:** `.env` in all services

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.your-project.supabase.co:5432/postgres
```

**How to Get:**
1. Go to https://supabase.com
2. Create project: "wineops-production"
3. Go to Settings → API
4. Copy URL and keys
5. Go to Settings → Database → Connection string

**Security:**
- ⚠️ NEVER commit service role key to git
- ✅ Use environment variables only
- ✅ Rotate keys every 90 days

---

### 2. 📱 NOTIFICATIONS

#### A. Plivo (SMS)

```bash
PLIVO_AUTH_ID=MAMXXXXXXXXXXXXXXXXX
PLIVO_AUTH_TOKEN=YourSecretToken123
PLIVO_PHONE_NUMBER=+14155551234
```

**How to Get:**
1. Sign up at https://www.plivo.com
2. Go to Dashboard → Account → Auth ID & Token
3. Purchase phone number (US: ~$0.80/month)
4. Verify number for SMS capability

**Cost:** ~$0.0035 per SMS in US

---

#### B. Gmail/SendGrid (Email)

**Option 1 - Gmail (Simple):**
```bash
EMAIL_BACKEND=gmail
GMAIL_USER=wineops.ai@gmail.com
GMAIL_PASSWORD=your-app-specific-password
FROM_EMAIL=wineops.ai@gmail.com
```

**How to Get Gmail App Password:**
1. Go to myaccount.google.com
2. Security → 2-Step Verification (enable)
3. App passwords → Generate
4. Select "Mail" and "Other device"
5. Copy 16-character password

**Option 2 - SendGrid (Scalable):**
```bash
EMAIL_BACKEND=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=noreply@wineops.ai
```

**How to Get:**
1. Sign up at https://sendgrid.com
2. Settings → API Keys → Create API Key
3. Full Access permissions
4. Verify sender email/domain

**Cost:** SendGrid free tier: 100 emails/day

---

#### C. Push Notifications

**Web Push (VAPID Keys):**
```bash
VAPID_PRIVATE_KEY=your-base64-private-key
VAPID_PUBLIC_KEY=your-base64-public-key
VAPID_EMAIL=mailto:admin@wineops.ai
```

**How to Generate:**
```bash
# Install vapid tool
pip install py-vapid

# Generate keys
vapid --gen

# Output:
# Public key: BN...
# Private key: xxxxxx
```

**Firebase Cloud Messaging (Mobile):**
```bash
FCM_SERVER_KEY=AAAA...:APA91bG...
```

**How to Get:**
1. Go to https://console.firebase.google.com
2. Create project: "wineops-mobile"
3. Project settings → Cloud Messaging
4. Copy Server Key (Legacy)

---

### 3. 🍷 TOAST POS INTEGRATION

```bash
TOAST_API_KEY=your-toast-api-key
TOAST_WEBHOOK_SECRET=your-webhook-secret
TOAST_ENVIRONMENT=production  # or sandbox
TOAST_RESTAURANT_GUID=your-restaurant-guid
```

**How to Get:**
1. Contact Toast support for API access
2. Request Developer Portal access
3. Create application in portal
4. Generate API credentials
5. Configure webhook URL

**Webhook URL:** `https://api.wineops.ai/webhooks/toast/order-completed`

**Documentation:** https://doc.toasttab.com/

---

### 4. 🤖 AI SERVICES

#### A. Google Gemini Pro

```bash
GOOGLE_API_KEY=AIzaSyC...your-api-key
GEMINI_MODEL=gemini-1.5-pro
```

**How to Get:**
1. Go to https://makersuite.google.com/app/apikey
2. Create API key
3. Enable Gemini API

**Cost:** Free tier: 60 requests/minute

---

#### B. Google Vision API (OCR)

```bash
GOOGLE_VISION_API_KEY=AIzaSyC...
# OR use service account JSON
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

**How to Get:**
1. Go to https://console.cloud.google.com
2. Enable Vision API
3. Create service account
4. Download JSON key file

**Cost:** Free tier: 1,000 units/month

---

### 5. 💬 WHATSAPP BUSINESS API

```bash
WHATSAPP_BUSINESS_ACCOUNT_ID=your-account-id
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-secret-verify-token
```

**How to Get:**
1. Apply for WhatsApp Business API access
2. Go to https://business.facebook.com
3. Create Business App
4. Add WhatsApp product
5. Generate access token
6. Register phone number

**Documentation:** https://developers.facebook.com/docs/whatsapp

**Cost:** Free tier available, then pay per conversation

---

### 6. 📊 ACCOUNTING INTEGRATIONS

#### A. QuickBooks

```bash
QUICKBOOKS_CLIENT_ID=your-client-id
QUICKBOOKS_CLIENT_SECRET=your-client-secret
QUICKBOOKS_REDIRECT_URI=https://app.wineops.ai/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production  # or sandbox
```

**How to Get:**
1. Go to https://developer.intuit.com
2. Create app
3. Get OAuth 2.0 credentials
4. Configure redirect URI

---

#### B. Xero

```bash
XERO_CLIENT_ID=your-client-id
XERO_CLIENT_SECRET=your-client-secret
XERO_REDIRECT_URI=https://app.wineops.ai/auth/xero/callback
```

**How to Get:**
1. Go to https://developer.xero.com/myapps
2. Create app
3. Get OAuth 2.0 credentials

---

### 7. 📑 GOOGLE SHEETS API

```bash
GOOGLE_SHEETS_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_SHEETS_CLIENT_SECRET=your-secret
GOOGLE_SHEETS_REDIRECT_URI=https://app.wineops.ai/auth/google/callback
```

**How to Get:**
1. Go to https://console.cloud.google.com
2. Enable Google Sheets API
3. Create OAuth 2.0 credentials
4. Configure redirect URI

---

### 8. 📨 MESSAGE QUEUE (RabbitMQ)

```bash
RABBITMQ_URL=amqp://user:password@rabbitmq.example.com:5672
CLOUDAMQP_URL=amqps://user:pass@jellyfish.rmq.cloudamqp.com/vhost
```

**How to Get (CloudAMQP - Recommended):**
1. Sign up at https://www.cloudamqp.com
2. Create instance (Little Lemur - Free)
3. Copy AMQP URL

**Alternative - Self-hosted:**
```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:management
```

---

### 9. 🔴 REDIS (Caching)

```bash
REDIS_URL=redis://default:password@redis.example.com:6379
```

**How to Get (Upstash - Recommended):**
1. Sign up at https://upstash.com
2. Create Redis database
3. Copy connection string

**Alternative - Self-hosted:**
```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

---

### 10. 📊 MONITORING & ERROR TRACKING

#### Sentry (Error Tracking)

```bash
SENTRY_DSN=https://xxxxx@o123456.ingest.sentry.io/123456
SENTRY_ENVIRONMENT=production
```

**How to Get:**
1. Sign up at https://sentry.io
2. Create project
3. Copy DSN

---

#### LogTail (Log Management)

```bash
LOGTAIL_SOURCE_TOKEN=your-source-token
```

**How to Get:**
1. Sign up at https://betterstack.com/logtail
2. Create source
3. Copy token

---

### 11. 🚀 DEPLOYMENT PLATFORMS

#### Vercel (Frontend)

```bash
VITE_API_GATEWAY_URL=https://api.wineops.ai
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Deploy:**
```bash
vercel --prod
```

---

#### Railway (Agent Orchestrator - Python)

```bash
# Set in Railway dashboard
PORT=8000
PYTHON_VERSION=3.11
```

**Deploy:**
```bash
railway up
```

---

#### Fly.io (API Gateway - Node.js)

```bash
# fly.toml already configured
```

**Deploy:**
```bash
flyctl deploy
```

---

## 🔒 SECURITY BEST PRACTICES

### 1. Environment Variables

✅ **DO:**
- Use `.env.production` for production values
- Store secrets in platform secret managers
- Use different keys for dev/staging/prod
- Rotate credentials every 90 days
- Use least privilege principle

❌ **DON'T:**
- Commit `.env` files to git
- Share credentials in chat/email
- Use same keys across environments
- Store credentials in code

---

### 2. API Keys Hierarchy

**Public (Client-side OK):**
- ✅ Supabase Anon Key
- ✅ VAPID Public Key
- ✅ Google Maps API Key (with restrictions)

**Secret (Server-side ONLY):**
- 🔒 Supabase Service Role Key
- 🔒 All API secrets/tokens
- 🔒 Database passwords
- 🔒 VAPID Private Key
- 🔒 Webhook secrets

---

### 3. Credential Rotation Schedule

| Credential Type | Rotation Frequency |
|-----------------|-------------------|
| Database passwords | 90 days |
| API keys | 90 days |
| OAuth secrets | 180 days |
| JWT secrets | 30 days |
| Webhook secrets | 180 days |
| Service account keys | 365 days |

---

## 📝 CONFIGURATION FILES

### 1. Frontend (.env.production)

```bash
# API
VITE_API_GATEWAY_URL=https://api.wineops.ai
VITE_WS_URL=wss://api.wineops.ai

# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Features
VITE_ENABLE_MOCK_MODE=false
VITE_ENABLE_DEBUG=false
```

---

### 2. Agent Orchestrator (.env.production)

```bash
# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://...

# Message Queue
RABBITMQ_URL=amqps://...

# Redis
REDIS_URL=redis://...

# Notifications
PLIVO_AUTH_ID=...
PLIVO_AUTH_TOKEN=...
PLIVO_PHONE_NUMBER=...
GMAIL_USER=...
GMAIL_PASSWORD=...
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...
FCM_SERVER_KEY=...

# AI
GOOGLE_API_KEY=...
GEMINI_MODEL=gemini-1.5-pro

# Integrations
TOAST_API_KEY=...
TOAST_WEBHOOK_SECRET=...
WHATSAPP_ACCESS_TOKEN=...

# Security
JWT_SECRET=your-random-secret-key
WEBHOOK_SECRET=your-webhook-secret

# Monitoring
SENTRY_DSN=...
LOGTAIL_SOURCE_TOKEN=...

# Environment
ENVIRONMENT=production
DEBUG=false
MOCK_NOTIFICATIONS=false
```

---

### 3. API Gateway (.env.production)

```bash
# Database
DATABASE_URL=postgresql://...

# Message Queue
RABBITMQ_URL=amqps://...

# Services
AGENT_ORCHESTRATOR_URL=https://agents.wineops.ai

# Auth
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret

# CORS
ALLOWED_ORIGINS=https://app.wineops.ai,https://www.wineops.ai

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000

# Monitoring
SENTRY_DSN=...

# Environment
NODE_ENV=production
PORT=4000
```

---

## ✅ DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] All credentials obtained and tested
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] RLS policies enabled
- [ ] Seed data loaded (master wine library)
- [ ] API keys have correct permissions
- [ ] Webhook URLs configured
- [ ] SSL certificates valid
- [ ] Domain DNS configured
- [ ] Monitoring tools configured

### Post-Deployment

- [ ] Health checks passing
- [ ] Webhooks receiving events
- [ ] Notifications sending successfully
- [ ] Database connections stable
- [ ] Message queue processing
- [ ] Error tracking active
- [ ] Log aggregation working
- [ ] Performance monitoring active
- [ ] Backup strategy configured
- [ ] Disaster recovery tested

---

## 🆘 CREDENTIAL EMERGENCY PROCEDURES

### If Credentials Compromised:

1. **Immediate Actions (within 1 hour):**
   - Rotate all affected credentials
   - Revoke compromised keys
   - Check audit logs for unauthorized access
   - Deploy new credentials

2. **Investigation (within 24 hours):**
   - Review access logs
   - Identify scope of breach
   - Document incident
   - Notify affected parties if required

3. **Prevention (within 1 week):**
   - Implement additional security measures
   - Update access policies
   - Retrain team on security practices
   - Review and update documentation

---

## 📞 SUPPORT CONTACTS

| Service | Support URL | Emergency |
|---------|------------|-----------|
| Supabase | https://supabase.com/support | support@supabase.io |
| Plivo | https://www.plivo.com/support | High priority ticket |
| Toast | https://pos.toasttab.com/support | (401) 273-9898 |
| Vercel | https://vercel.com/support | dashboard |
| Railway | https://railway.app/help | Discord |

---

## 🎯 QUICK START FOR PRODUCTION

1. **Clone repo and checkout production branch**
2. **Create `.env.production` files** (use this checklist)
3. **Test locally with production credentials** (use staging first!)
4. **Deploy to staging environment**
5. **Run smoke tests**
6. **Deploy to production**
7. **Monitor for 24 hours**
8. **Enable features gradually** (use feature flags)

---

**Status:** 📋 Complete Credentials Checklist  
**Last Updated:** January 10, 2026  
**Total Credentials Required:** 40+ keys/tokens  
**Estimated Setup Time:** 4-6 hours

---

*Keep this document secure and update as credentials change*
