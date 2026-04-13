# 🔧 Troubleshooting Guide

**Last Updated**: January 15, 2026

This guide consolidates common issues and their solutions.

---

## 🌐 Safari Cannot Connect to Localhost

### Issue
Safari cannot connect to `http://localhost:3000`

### Solutions (Try in Order)

1. **Use 127.0.0.1 Instead of localhost**
   ```
   http://127.0.0.1:3000
   ```
   Safari sometimes has issues with "localhost" DNS resolution.

2. **Clear Safari Cache**
   - Safari → Preferences → Advanced → Show Develop menu
   - Develop → Empty Caches
   - Restart Safari

3. **Check Server Status**
   ```bash
   curl http://localhost:3000
   # Should return HTTP 200
   ```

4. **Disable Safari Extensions**
   - Some extensions block localhost connections
   - Try Safari in Private Browsing mode

5. **Use Chrome/Firefox**
   - Chrome: `http://localhost:3000`
   - Firefox: `http://localhost:3000`

---

## 📧 Communications Page Issues

### Issue
Duplicate pages, broken navigation, templates not showing

### Solution

**Problem**: Multiple communication pages causing routing conflicts

**Fixed**:
- ✅ Removed duplicate `Communication.tsx` (singular)
- ✅ Kept `Communications.tsx` (plural) as main page
- ✅ Fixed sidebar navigation to point to `/communications`
- ✅ Consolidated all communication features into one page

**Current Structure**:
- `/communications` - Main communications page (templates, history, scheduled reports)
- `/documents-reports` - Reports archive (read-only)

**If you still see issues**:
1. Clear browser cache
2. Restart dev server: `pnpm dev`
3. Check `apps/web/src/pages/Communications.tsx` exists

---

## 🔌 Connection Issues

### API Gateway Not Connecting

**Symptoms**: Network errors, CORS issues, 404s

**Solutions**:
1. **Check API Gateway is Running**
   ```bash
   cd apps/api-gateway
   pnpm start:dev
   # Should see: Server running on http://localhost:4000
   ```

2. **Test Connection**
   ```bash
   curl http://localhost:4000/api/v1/auth/me
   # Should return JSON (even if 401, connection works)
   ```

3. **Check Environment Variables**
   - Web app: `apps/web/.env` should have `VITE_API_GATEWAY_URL=http://localhost:4000`
   - Mobile app: `apps/mobile/constants/Config.ts` should point to correct port

4. **Check CORS Configuration**
   - API Gateway should allow `http://localhost:3000` (web app)
   - See `apps/api-gateway/src/main.ts` for CORS settings

### Mobile App Connection Issues

**Symptoms**: "Network request failed" in mobile app

**Solutions**:
1. **iOS Simulator**: Use `http://localhost:4000`
2. **Android Emulator**: Use `http://10.0.2.2:4000`
3. **Physical Device**: Use your Mac's IP (e.g., `http://10.103.240.113:4000`)
4. **Update Config**: Edit `apps/mobile/constants/Config.ts` with correct IP

---

## 🗄️ Database Connection Issues

### Supabase Connection Failed

**Symptoms**: Database errors, connection timeouts

**Solutions**:
1. **Check Environment Variables**
   ```bash
   # Should be in .env files:
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.your-project.supabase.co:5432/postgres
   ```

2. **Test Connection**
   ```bash
   cd services/agent-orchestrator
   python3 -c "from database.supabase_client import get_supabase; print(get_supabase())"
   ```

3. **Check Supabase Dashboard**
   - Go to https://supabase.com
   - Check project status
   - Verify API keys are correct

---

## 🚀 Development Server Issues

### Port Already in Use

**Symptoms**: "Port 3000 is already in use" or similar

**Solutions**:
1. **Find Process Using Port**
   ```bash
   lsof -i :3000  # For port 3000
   lsof -i :4000  # For port 4000
   lsof -i :8000  # For port 8000
   ```

2. **Kill Process**
   ```bash
   kill -9 <PID>  # Replace <PID> with process ID from lsof
   ```

3. **Use Different Port**
   ```bash
   # Vite
   pnpm dev --port 3001
   
   # NestJS
   PORT=4001 pnpm start:dev
   ```

---

## 📦 Dependency Issues

### npm/pnpm Install Fails

**Symptoms**: Package installation errors, version conflicts

**Solutions**:
1. **Clear Cache**
   ```bash
   npm cache clean --force
   # or
   pnpm store prune
   ```

2. **Delete node_modules**
   ```bash
   rm -rf node_modules
   pnpm install
   ```

3. **Check Node Version**
   ```bash
   node --version  # Should be 18+ or 20+
   ```

---

## 🤖 Agent Orchestrator Issues

### Agents Not Starting

**Symptoms**: "Agent not found" or agents not responding

**Solutions**:
1. **Check Agent Registration**
   - See `services/agent-orchestrator/core/orchestrator.py`
   - All agents should be registered in `_register_agent_classes()`

2. **Check RabbitMQ**
   ```bash
   # Should be running
   docker-compose ps
   # or
   curl http://localhost:15672  # RabbitMQ management UI
   ```

3. **Check Logs**
   ```bash
   tail -f /tmp/agent-orchestrator.log
   # or check console output
   ```

---

## 📱 Mobile App Issues

### Expo Not Starting

**Symptoms**: Expo dev server won't start, QR code not showing

**Solutions**:
1. **Clear Expo Cache**
   ```bash
   cd apps/mobile
   npx expo start --clear
   ```

2. **Check Node Version**
   ```bash
   node --version  # Should be 18+ or 20+
   ```

3. **Reinstall Dependencies**
   ```bash
   rm -rf node_modules
   pnpm install
   ```

---

## 🔐 Authentication Issues

### JWT Token Expired

**Symptoms**: 401 errors, redirected to login

**Solutions**:
1. **Clear Local Storage**
   ```javascript
   // In browser console:
   localStorage.clear()
   ```

2. **Check Token Refresh**
   - Tokens should auto-refresh
   - Check `apps/web/src/contexts/AuthContext.tsx`

3. **Re-login**
   - Simply log in again
   - New tokens will be issued

---

## 📊 Reporting Issues

### Reports Not Generating

**Symptoms**: Scheduled reports not appearing

**Solutions**:
1. **Check Supabase pg_cron**
   ```sql
   -- In Supabase SQL Editor:
   SELECT * FROM cron.job;
   ```

2. **Check Manager Preferences**
   - Reports are scheduled based on manager preferences
   - Check `manager_preferences` table

3. **Check Agent Orchestrator URL**
   - In `SUPABASE_CRON_SETUP.sql`
   - Should point to your agent orchestrator URL

---

## 🐛 Still Having Issues?

1. **Check Logs**
   - Frontend: Browser console (F12)
   - Backend: Terminal output
   - Agent Orchestrator: `/tmp/agent-orchestrator.log`

2. **Check Documentation**
   - See `md_files/DOCUMENTATION_INDEX.md`
   - See `README.md` for quick start

3. **Verify Environment**
   - All services running?
   - All environment variables set?
   - All dependencies installed?

---

**Last Updated**: January 15, 2026
