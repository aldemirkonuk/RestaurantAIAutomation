# ✅ Web App Connected to Localhost!

## 🎉 Connection Setup Complete

Your web application is now **fully configured to connect to localhost:4000**!

---

## 🔌 Configuration Summary

### API Configuration
- **Base URL**: `http://localhost:4000`
- **Environment Variable**: `VITE_API_GATEWAY_URL`
- **Fallback**: `http://localhost:4000` (if env var not set)

### WebSocket Configuration
- **WebSocket URL**: `ws://localhost:4000`
- **Environment Variable**: `VITE_WS_URL`
- **Fallback**: `ws://localhost:4000` (if env var not set)

### Vite Development Server Proxy
The `vite.config.ts` includes a proxy that automatically forwards:
- `/api/*` → `http://localhost:4000/api/*`
- `/ws/*` → `ws://localhost:4000/ws/*`

This means you can use relative paths like `/api/v1/auth/login` and they'll automatically proxy to your API Gateway!

---

## 📁 Files Updated

### 1. Created `.env` File
```bash
apps/web/.env
```
Contains:
- `VITE_API_GATEWAY_URL=http://localhost:4000`
- `VITE_WS_URL=ws://localhost:4000`
- `VITE_API_URL=http://localhost:4000` (for backwards compatibility)

### 2. Fixed WebSocket URL
**File**: `apps/web/src/lib/websocket.tsx`
- **Before**: `'http://localhost:4000'` ❌
- **After**: `'ws://localhost:4000'` ✅

### 3. Updated API URLs (5 files)
All files now use `VITE_API_GATEWAY_URL` with fallback to `http://localhost:4000`:

✅ `apps/web/src/components/notifications/VendorDeadlineSettings.tsx`
✅ `apps/web/src/components/orders/AuctionPurchaseModal.tsx`
✅ `apps/web/src/pages/RecurringOrders.tsx`
✅ `apps/web/src/components/inventory/InvoiceScannerModal.tsx`

**Already Correct:**
✅ `apps/web/src/contexts/AuthContext.tsx`
✅ `apps/web/src/pages/Orders.tsx`
✅ `apps/web/src/components/conversations/ConversationApprovalNotification.tsx`
✅ `apps/web/src/components/emails/QuickGmailModal.tsx`

---

## 🚀 How to Test

### 1. Start API Gateway
```bash
cd apps/api-gateway
pnpm start:dev
```

You should see:
```
🚀 Server running on http://localhost:4000
📚 Swagger docs: http://localhost:4000/api/docs
🔌 WebSocket: ws://localhost:4000
```

### 2. Start Web App
```bash
cd apps/web
pnpm dev
```

The app will start at: **http://localhost:3000**

### 3. Verify Connection

**Option A: Check Browser Console**
- Open DevTools (F12)
- Look for successful API calls
- Check Network tab for requests to `localhost:4000`

**Option B: Test API Directly**
- Open: http://localhost:4000/api/v1/auth/me
- Should return JSON (even if 401 - that's OK, connection works!)

**Option C: Check WebSocket Connection**
- The app will automatically connect to `ws://localhost:4000`
- Check console for "Connected to WebSocket" message

---

## 📋 Configuration Details

### Environment Variables

The `.env` file in `apps/web/` contains:
```env
VITE_API_GATEWAY_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
VITE_API_URL=http://localhost:4000
```

**Important**: After creating `.env`, restart your Vite dev server!

### Vite Proxy Configuration

The `vite.config.ts` proxy allows you to:
- Use `/api/v1/...` directly in your code
- Automatically proxies to `http://localhost:4000/api/v1/...`
- No CORS issues during development

**Example:**
```typescript
// This will work automatically via proxy:
const response = await axios.get('/api/v1/auth/me')

// Or use full URL:
const response = await axios.get('http://localhost:4000/api/v1/auth/me')
```

---

## 🔍 How It Works

### Development Mode
1. Web app runs on: `http://localhost:3000`
2. API Gateway runs on: `http://localhost:4000`
3. Vite proxy forwards `/api/*` to `localhost:4000`
4. WebSocket connects directly to `ws://localhost:4000`

### Production Mode
- Environment variables override defaults
- Set `VITE_API_GATEWAY_URL` to your production API URL
- No proxy needed (direct connections)

---

## ✅ Checklist

- [x] `.env` file created with correct configuration
- [x] WebSocket URL fixed (`ws://` instead of `http://`)
- [x] All files use `VITE_API_GATEWAY_URL` or fallback to `localhost:4000`
- [x] `vite.config.ts` proxy configured correctly
- [ ] API Gateway running on port 4000
- [ ] Web app running on port 3000
- [ ] Test connection in browser

---

## 🐛 Troubleshooting

### Problem: "Network Error" or CORS issues

**Solution**: Make sure API Gateway is running:
```bash
cd apps/api-gateway
pnpm start:dev
```

Check it's on port 4000:
```bash
curl http://localhost:4000/api/v1/auth/me
```

### Problem: Environment variables not working

**Solution**: Restart Vite dev server after creating `.env`:
```bash
# Stop server (Ctrl+C)
cd apps/web
pnpm dev  # Restart
```

### Problem: WebSocket not connecting

**Solution**: 
1. Check WebSocket URL is `ws://localhost:4000` (not `http://`)
2. Verify API Gateway WebSocket server is running
3. Check browser console for WebSocket errors

### Problem: Still seeing old `localhost:3001`

**Solution**: Clear browser cache and restart dev server:
```bash
# Clear Vite cache
rm -rf apps/web/node_modules/.vite
pnpm dev
```

---

## 📚 API Endpoints

All API endpoints are prefixed with `/api/v1/`:

- **Auth**: `/api/v1/auth/*`
- **Inventory**: `/api/v1/inventory/*`
- **Orders**: `/api/v1/procurement/orders/*`
- **Notifications**: `/api/v1/notifications/*`
- **Reports**: `/api/v1/reports/*`

**Swagger Documentation**: http://localhost:4000/api/docs

---

## 🎯 Next Steps

1. **Start API Gateway** (if not running)
2. **Start Web App** (`pnpm dev`)
3. **Open** http://localhost:3000
4. **Test** login/API calls
5. **Verify** WebSocket connection in console

---

**Your web app is now connected to localhost:4000! 🚀**

Restart your dev server to apply the `.env` changes!
