# 📱 WineOps AI Mobile App - Setup, Connection & Status

**Consolidated guide** from README, CONNECTION_SETUP, LOCALHOST_SETUP, QUICK_START, SETUP_COMPLETE, and STATUS.

---

## Overview

**WineOps AI Mobile App** — Modern, interactive React Native mobile app for restaurant wine operations.

**Tech stack:** Expo SDK 51, React Native 0.74.5, TypeScript, Zustand, Axios, Socket.io client.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (Mac only) or Android Emulator, or Expo Go on your phone

### Installation & Run

```bash
# Install dependencies
cd apps/mobile
npm install   # or pnpm install

# Start development server
npx expo start
```

### Connect to Localhost

**Quick reference:**

| Platform | URL | Notes |
|----------|-----|-------|
| **iOS Simulator** | `http://localhost:4000` | ✅ Works directly |
| **Android Emulator** | `http://10.0.2.2:4000` | Special IP required |
| **Physical Device** | `http://YOUR_MAC_IP:4000` | Find IP with `ifconfig` |
| **Web (Expo)** | `http://localhost:4000` | ✅ Works directly |

### View Your App

- **iOS Simulator:** Press `i` in Expo terminal, or `npx expo start --ios`
- **Android Emulator:** Press `a` in Expo terminal, or `npx expo start --android`
- **Web Browser:** Press `w` in Expo terminal, or `npx expo start --web` (opens at http://localhost:19006)
- **Physical Device:** Install Expo Go, scan QR code from terminal; ensure device and Mac are on same WiFi

---

## 🔌 Connection Setup

### API Configuration

- **Base URL:** `http://localhost:4000` (iOS Simulator & Web)
- **Android Emulator:** `http://10.0.2.2:4000`
- **Physical Device:** `http://YOUR_MAC_IP:4000` (e.g. `10.103.240.113`)

### WebSocket Configuration

- **WS URL:** `ws://localhost:4000` (iOS Simulator & Web)
- **Android Emulator:** `ws://10.0.2.2:4000`
- **Physical Device:** `ws://YOUR_MAC_IP:4000`

### Configuration File

Edit `apps/mobile/constants/Config.ts`:

- API base URL, WebSocket URL, platform-specific settings
- For physical device: set `MAC_IP` to your Mac’s IP (`ifconfig | grep "inet " | grep -v 127.0.0.1`)

### Connection Test Component

The app includes a **Connection Test** component that:

- Shows current platform (iOS/Android/Web)
- Displays the API URL in use
- Tests connection to API Gateway (`/api/v1/auth/me`)
- Shows troubleshooting tips

**Quick test:**

```bash
# Terminal 1: Start API Gateway
cd apps/api-gateway && pnpm start:dev

# Terminal 2: Start Mobile App
cd apps/mobile && npx expo start

# Then press 'w' (web), 'i' (iOS), or 'a' (Android)
```

A 401 from `/api/v1/auth/me` is OK — it means the API is reachable; you just need to log in.

---

## 📱 Localhost Setup (Platform-Specific)

### iOS Simulator ✅

Uses `http://localhost:4000` directly. No extra config.

### Android Emulator ⚠️

Use `http://10.0.2.2:4000`. `10.0.2.2` is the emulator’s alias for the host’s localhost.

### Physical Device 📱

1. **Find Mac IP:** `ifconfig | grep "inet " | grep -v 127.0.0.1`
2. **Update `Config.ts`:** Set `MAC_IP` or use `getPhysicalDeviceUrl()`
3. **Same WiFi:** Device and Mac on same network
4. **Firewall:** Allow connections on port 4000

### Web (Expo) 🌐

Use `http://localhost:4000`. Run `npx expo start --web`; app opens at http://localhost:19006.

---

## ✅ Setup Complete & Status

### What’s Installed & Running

- **Expo SDK 51**, React Native 0.74.5, TypeScript
- Expo modules (camera, notifications, secure-store, etc.)
- Socket.io client, Axios, Zustand
- **Expo Metro Bundler** on http://localhost:8081
- API client, WebSocket, secure token storage
- Platform-specific localhost handling
- **ConnectionTest** component

### Project Structure

```
apps/mobile/
├── App.tsx                 # Main entry point
├── app.json                # Expo configuration
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── constants/
│   └── Config.ts           # API & platform config
├── services/
│   ├── api.ts              # Axios API client
│   └── websocket.ts        # Socket.io client
├── components/
│   └── ConnectionTest.tsx  # Connection tester
├── app/                    # Expo Router screens (if used)
├── stores/                 # Zustand state (if used)
└── assets/                 # App icons, etc.
```

### Features (Current & Planned)

**Current:**

- Basic UI structure, API client with auth, WebSocket integration
- Connection test, platform-specific localhost handling, secure token storage

**Planned:**

- Login screen, one-tap approvals, push notifications
- Camera wine label scanner, inventory view, offline mode

---

## 🐛 Troubleshooting

### "Network request failed"

1. **API Gateway running?**  
   `curl http://localhost:4000/api/v1/auth/me`  
   Should return JSON (401 is fine).

2. **Port:** Config uses **4000**. API Gateway must run on 4000.

3. **Physical device:** Same WiFi, correct `MAC_IP` in `Config.ts`, firewall allows port 4000.

### "CORS error" (Web only)

Ensure API Gateway CORS includes Expo web:

```typescript
// apps/api-gateway/src/main.ts
cors: {
  origin: ['http://localhost:3000', 'http://localhost:19006'],
  credentials: true,
}
```

### Expo not starting / no QR code

```bash
cd apps/mobile
npx expo start --clear
```

### Connection timeout

- Confirm API is listening: `lsof -i :4000`
- Test from host: `curl http://localhost:4000/api/v1/auth/me`
- Physical device: `curl http://YOUR_MAC_IP:4000/api/v1/auth/me`

### Package version warnings (optional)

```bash
cd apps/mobile
pnpm add expo-image-picker@~15.1.0 typescript@~5.3.3
```

---

## 📋 Quick Commands

```bash
cd apps/mobile

npx expo start              # Start dev server
npx expo start --ios        # iOS Simulator
npx expo start --android    # Android Emulator
npx expo start --web        # Web browser
npx expo start --clear      # Clear cache and restart
pnpm add <package>          # Add dependency
```

---

## 📚 Related Documentation

- **Localhost / connection:** This guide (Localhost Setup, Connection Setup, Troubleshooting)
- **API & architecture:** `md_files/02-architecture/`
- **Feature roadmap:** `md_files/06-planning/FEATURE_ROADMAP.md`

---

## ✅ Setup Checklist

- [x] Dependencies installed
- [x] Expo dev server runs (http://localhost:8081)
- [x] `Config.ts` configured for API (port 4000)
- [x] ConnectionTest component available
- [ ] API Gateway running on port 4000
- [ ] App opened in simulator/web/device
- [ ] Connection test passes
- [ ] First feature (e.g. login or approvals) implemented

---

**Your mobile app is set up and ready for development.**  
Use **Connection Test** in the app to verify API connectivity.
