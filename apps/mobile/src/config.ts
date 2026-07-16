import { Platform } from "react-native";

/**
 * API base resolution:
 * 1. EXPO_PUBLIC_API_URL wins when set (physical-device dev: your Mac's LAN IP).
 * 2. Dev builds hit the local gateway (Android emulator maps host localhost
 *    to 10.0.2.2).
 * 3. Release builds hit the Railway deployment.
 */
const PROD_API = "https://wineopsapi-gateway-production.up.railway.app";

function resolveBase(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (!__DEV__) return PROD_API;
  if (Platform.OS === "android") return "http://10.0.2.2:4000";
  return "http://localhost:4000";
}

export const API_BASE = resolveBase();
export const API_URL = `${API_BASE}/api/v1`;
export const SOCKET_URL = API_BASE;
