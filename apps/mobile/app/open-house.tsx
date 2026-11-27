import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import {
  AuthButton,
  AuthField,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { requestThenAdopt } from "@/state/session";
import { authErrorMessage } from "@/auth/outcomes";
import { createFirstHouse } from "@/api/auth";

/**
 * Path B, step 2 -- the verified owner opens the restaurant.
 *
 * Reached from `/verify-email` once the address is proved. The account exists
 * and is verified; this is the only thing that makes it a house
 * (`POST /auth/register/house`, which refuses an unverified address).
 */
export default function OpenHouseScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [issues, setIssues] = useState<Record<string, string | null>>({});

  const set =
    (key: string, setter: (v: string) => void) => (next: string) => {
      setter(next);
      setIssues((prev) => ({ ...prev, [key]: null }));
    };

  const submit = async () => {
    if (busy) return;
    const next: Record<string, string | null> = {
      restaurantName: restaurantName.trim() ? null : "Name the restaurant.",
      address: address.trim() ? null : "Enter the street address.",
      city: city.trim() ? null : "Enter the city.",
      country: country.trim() ? null : "Enter the country.",
    };
    setIssues(next);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    setError(null);
    try {
      const { outcome } = await requestThenAdopt(() =>
        createFirstHouse({
          restaurantName: restaurantName.trim(),
          address: address.trim(),
          city: city.trim(),
          country: country.trim(),
        }),
      );
      if (outcome === "noTokens") throw new Error("No session was returned.");
      if (outcome === "superseded") return;
      haptic.confirm();
      router.replace("/get-started" as never);
    } catch (e) {
      setError(authErrorMessage(e));
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Open your restaurant."
      intro="Your address is verified. Tell us where the restaurant is."
    >
      <AuthField
        label="Restaurant name"
        value={restaurantName}
        onChangeText={set("restaurantName", setRestaurantName)}
        error={issues.restaurantName}
        placeholder="Bistro Konyaaltı"
        editable={!busy}
      />
      <AuthField
        label="Street address"
        value={address}
        onChangeText={set("address", setAddress)}
        error={issues.address}
        placeholder="12 Liman Caddesi"
        editable={!busy}
      />
      <AuthField
        label="City"
        value={city}
        onChangeText={set("city", setCity)}
        error={issues.city}
        placeholder="Antalya"
        editable={!busy}
      />
      <AuthField
        label="Country"
        value={country}
        onChangeText={set("country", setCountry)}
        error={issues.country}
        placeholder="Türkiye"
        editable={!busy}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
        </AuthNotice>
      ) : null}
      <View style={{ marginTop: space.sm }}>
        <AuthButton label="Open restaurant" onPress={submit} busy={busy} />
      </View>
    </AuthShell>
  );
}
