import { Platform } from "react-native";
import Constants from "expo-constants";

const PROD_API = "https://wineopsapi-gateway-production.up.railway.app";
// Matches the gateway's local dev port (.env PORT=8000). Prod is fronted by
// Railway over https (no explicit port), so this only affects local dev.
const GATEWAY_PORT = 8000;

/**
 * API base resolution, most specific wins:
 *
 * 1. EXPO_PUBLIC_API_URL — explicit override, always wins.
 * 2. Metro's own LAN host. When Expo Go / a dev client loads the app over
 *    wifi, the phone already knows the IP it used to reach Metro — and
 *    that's the same machine running the API gateway. Deriving the gateway
 *    URL from it means physical devices work with zero manual IP typing,
 *    and it keeps working when the Mac's address changes between networks.
 *    (Simulators/emulators report "localhost" here, so this step is a
 *    no-op for them and falls through to step 3.)
 * 3. Simulator/emulator fallbacks — the iOS simulator shares the Mac's
 *    localhost; the Android emulator maps host localhost to 10.0.2.2.
 * 4. Release builds hit the Railway deployment.
 */
function resolveBase(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");

  if (!__DEV__) return PROD_API;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).manifest2?.extra?.expoClient?.hostUri ??
    (Constants as any).manifest?.debuggerHost;
  const lanHost = typeof hostUri === "string" ? hostUri.split(":")[0] : undefined;
  if (lanHost && lanHost !== "localhost" && lanHost !== "127.0.0.1") {
    return `http://${lanHost}:${GATEWAY_PORT}`;
  }

  if (Platform.OS === "android") return `http://10.0.2.2:${GATEWAY_PORT}`;
  return `http://localhost:${GATEWAY_PORT}`;
}

export const API_BASE = resolveBase();
export const API_URL = `${API_BASE}/api/v1`;
export const SOCKET_URL = API_BASE;
