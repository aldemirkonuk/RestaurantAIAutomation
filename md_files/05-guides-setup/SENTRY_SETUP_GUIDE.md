# 🐛 Sentry Setup Guide - Error Tracking & Monitoring

## What is Sentry?

**Sentry** is an **error tracking and performance monitoring platform** that helps you:

- 🔍 **Catch errors** in real-time across your entire stack
- 📊 **Track performance** issues and slow queries
- 📧 **Get alerts** when errors occur (email, Slack, etc.)
- 🔬 **Debug faster** with full stack traces, context, and breadcrumbs
- 📈 **Monitor trends** - see error rates, affected users, etc.

**Platform:** https://sentry.io (SaaS) or self-hosted

**Free Tier:** 5,000 events/month (perfect for development/small production)

---

## Step-by-Step Setup

### Step 1: Create Sentry Account

1. Go to **https://sentry.io**
2. Click **"Sign Up"** (top right)
3. Sign up with:
   - **GitHub** (recommended - easiest)
   - **Google**
   - **Email**

### Step 2: Create Organization & Project

1. After signup, you'll be prompted to:
   - **Create Organization** (or join existing)
     - Name: `WineOps AI` (or your company name)
   - **Create Project**
     - **Platform:** Select your language/framework:
       - **Python** → `Python` or `FastAPI` or `Django`
       - **JavaScript/TypeScript** → `JavaScript` or `React` or `Next.js`
       - **Node.js** → `Node.js`
     - **Project Name:** `restaurant-ai-automation` (or your choice)

### Step 3: Get Your DSN (Data Source Name)

After creating the project, Sentry will show you:

1. **Installation Instructions** with code snippets
2. **Your DSN** - looks like:
   ```
   https://abc123def456@o1234567.ingest.sentry.io/1234567
   ```

**To find it later:**
- Go to your project → **Settings** → **Client Keys (DSN)**
- Copy the **DSN** value

### Step 4: Install Sentry SDK

**For Python (FastAPI/Flask/Django):**

```bash
pip install sentry-sdk
```

**For JavaScript/TypeScript:**

```bash
npm install @sentry/react @sentry/tracing
# or
yarn add @sentry/react @sentry/tracing
```

**For Node.js:**

```bash
npm install @sentry/node
```

### Step 5: Initialize Sentry in Your Code

#### Python Example (FastAPI)

```python
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

# Initialize Sentry
sentry_sdk.init(
    dsn="https://YOUR_DSN_HERE@o1234567.ingest.sentry.io/1234567",
    integrations=[
        FastApiIntegration(),
        SqlalchemyIntegration(),
    ],
    # Set traces_sample_rate to 1.0 to capture 100%
    # of the transactions for performance monitoring.
    traces_sample_rate=1.0,
    # Set profiles_sample_rate to 1.0 to profile 100%
    # of sampled transactions.
    profiles_sample_rate=1.0,
    environment="development",  # or "production"
    # Release tracking (optional)
    release="restaurant-ai@1.0.0",
)

# Your FastAPI app
from fastapi import FastAPI
app = FastAPI()
```

#### Python Example (Environment Variable)

```python
import os
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

SENTRY_DSN = os.getenv('SENTRY_DSN')

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
        environment=os.getenv('ENVIRONMENT', 'development'),
    )
```

#### JavaScript/TypeScript Example (React/Next.js)

```javascript
import * as Sentry from "@sentry/react";
import { BrowserTracing } from "@sentry/tracing";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  integrations: [
    new BrowserTracing(),
  ],
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});
```

#### Node.js Example

```javascript
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  environment: process.env.NODE_ENV || "development",
});
```

### Step 6: Test Sentry Integration

**Python:**
```python
import sentry_sdk

# Test error capture
try:
    1 / 0
except Exception:
    sentry_sdk.capture_exception()

# Or manually capture a message
sentry_sdk.capture_message("Something went wrong", level="error")
```

**JavaScript:**
```javascript
// Test error capture
try {
  throw new Error("Test error");
} catch (error) {
  Sentry.captureException(error);
}

// Or capture a message
Sentry.captureMessage("Something went wrong", "error");
```

### Step 7: Add to Environment Variables

**Create/Update `.env` file:**
```bash
# Sentry Error Tracking
SENTRY_DSN=https://YOUR_DSN_HERE@o1234567.ingest.sentry.io/1234567
ENVIRONMENT=development  # or production
```

**For production:**
- Add to your hosting platform's environment variables
- Vercel: Project Settings → Environment Variables
- Heroku: Config Vars
- AWS: Environment Variables or Secrets Manager

---

## Advanced Configuration

### Custom Context & Tags

**Python:**
```python
import sentry_sdk

# Add user context
sentry_sdk.set_user({
    "id": user_id,
    "email": user_email,
    "restaurant_id": restaurant_id,
})

# Add tags
sentry_sdk.set_tag("restaurant_id", restaurant_id)
sentry_sdk.set_tag("environment", "production")

# Add extra context
sentry_sdk.set_context("order", {
    "order_id": order_id,
    "provider_id": provider_id,
})
```

**JavaScript:**
```javascript
Sentry.setUser({
  id: userId,
  email: userEmail,
  restaurant_id: restaurantId,
});

Sentry.setTag("restaurant_id", restaurantId);
Sentry.setContext("order", {
  order_id: orderId,
  provider_id: providerId,
});
```

### Filter Sensitive Data

**Python:**
```python
sentry_sdk.init(
    dsn=SENTRY_DSN,
    before_send=lambda event, hint: {
        # Remove sensitive data
        **event,
        "request": {
            **event.get("request", {}),
            "data": None,  # Don't send request body
        }
    },
)
```

### Performance Monitoring

**Python (FastAPI):**
```python
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_sdk.init(
    dsn=SENTRY_DSN,
    integrations=[FastApiIntegration()],
    traces_sample_rate=0.1,  # 10% of transactions
    profiles_sample_rate=0.1,  # 10% of transactions
)
```

---

## Sentry Dashboard Features

### 1. **Issues** Tab
- See all errors grouped by type
- View stack traces
- See affected users
- Mark as resolved/ignored

### 2. **Performance** Tab
- Slow API endpoints
- Database query performance
- Transaction traces

### 3. **Releases** Tab
- Track deployments
- See which release introduced bugs
- Rollback tracking

### 4. **Alerts**
- Email notifications
- Slack integration
- PagerDuty integration
- Custom webhooks

---

## Setting Up Alerts

### Email Alerts (Default)

1. Go to **Settings** → **Projects** → Your Project
2. Click **Alerts**
3. Click **"Create Alert Rule"**
4. Configure:
   - **When:** Error rate exceeds threshold
   - **Conditions:** Number of events, time window
   - **Actions:** Send email to team

### Slack Integration

1. Go to **Settings** → **Integrations**
2. Click **"Slack"**
3. Connect your Slack workspace
4. Configure which channels/alerts to send

---

## Best Practices

### ✅ DO:
- Initialize Sentry early in your app startup
- Use environment variables for DSN
- Set appropriate `environment` (dev/staging/prod)
- Add user context for better debugging
- Use tags to filter/organize errors
- Set up alerts for critical errors

### ❌ DON'T:
- Commit DSN to Git (use environment variables)
- Send sensitive data (passwords, tokens, PII)
- Capture every exception (filter noise)
- Use same DSN for dev/prod (create separate projects)

---

## Free Tier Limits

- **5,000 events/month** (errors + performance)
- **1 project**
- **7 days data retention**
- **Email alerts**
- **Basic integrations**

**Upgrade if you need:**
- More events (10K+ events/month)
- Longer data retention (90 days)
- More projects
- Advanced features

---

## Troubleshooting

### Errors not showing up?

1. **Check DSN is correct** - Copy directly from Sentry dashboard
2. **Check network** - Sentry needs outbound HTTPS (443)
3. **Check environment** - Make sure you're looking at the right project/environment
4. **Check SDK version** - Update to latest version
5. **Check logs** - Sentry SDK logs errors to console in development

### Too many events?

1. **Filter in code:**
   ```python
   def before_send(event, hint):
       # Ignore specific errors
       if 'specific_error' in str(event.get('exception', {})):
           return None
       return event
   
   sentry_sdk.init(before_send=before_send)
   ```

2. **Adjust sample rate:**
   ```python
   sentry_sdk.init(
       traces_sample_rate=0.1,  # Only 10% of transactions
   )
   ```

---

## Quick Reference

**Sentry Dashboard:** https://sentry.io  
**Documentation:** https://docs.sentry.io  
**Python SDK:** https://docs.sentry.io/platforms/python  
**JavaScript SDK:** https://docs.sentry.io/platforms/javascript  

**Your DSN Format:**
```
https://abc123def456@o1234567.ingest.sentry.io/1234567
```

**Environment Variable:**
```bash
SENTRY_DSN=https://abc123def456@o1234567.ingest.sentry.io/1234567
```

---

## Next Steps

1. ✅ Create Sentry account
2. ✅ Create organization & project
3. ✅ Copy DSN
4. ⬜ Install Sentry SDK in your project
5. ⬜ Initialize Sentry in your code
6. ⬜ Add DSN to `.env` file
7. ⬜ Test error capture
8. ⬜ Set up alerts
9. ⬜ Update `CREDENTIALS_CHECKLIST.md` with your DSN

---

## Example Integration (FastAPI)

```python
# main.py
import os
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from fastapi import FastAPI

# Initialize Sentry
SENTRY_DSN = os.getenv('SENTRY_DSN')
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
        environment=os.getenv('ENVIRONMENT', 'development'),
    )

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/test-error")
def test_error():
    # This will be captured by Sentry
    raise ValueError("Test error for Sentry")
```

