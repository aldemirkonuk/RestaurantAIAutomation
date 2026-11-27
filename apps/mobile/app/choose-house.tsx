import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { AuthLink, AuthNotice, AuthShell } from "@/components/auth/AuthShell";
import { color, radius, space } from "@/design/tokens";
import { api } from "@/api/client";
import { useSession } from "@/state/session";
import {
  LAST_HOUSE_KEY,
  orderHouses,
  parseMemory,
  readHouseAnswer,
  type HeldHouse,
  type HouseSummary,
} from "@/auth/houseChoice";

/**
 * Which house today? (ADR 0164, R7), on the phone.
 *
 * The minimal chooser: the sign-in rule is the server's, and a person with
 * several houses whose phone has not used one within seven days signs in to a
 * session in no house. The Today tab sends that session here. One row per
 * house, name and city, this phone's last house first and marked; one tap
 * opens it. Someone with no house at all goes on to /no-access.
 *
 * A membership an invite join granted before the address was proved waits in
 * its own list (ADR 0229 fork 13): it grants nothing until the person taps
 * Join, which accepts it and then opens that house.
 */
export default function ChooseHouseScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const chooseHouse = useSession((s) => s.chooseHouse);
  const signOut = useSession((s) => s.signOut);

  const [houses, setHouses] = useState<HouseSummary[] | null>(null);
  const [held, setHeld] = useState<HeldHouse[]>([]);
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const read = readHouseAnswer(await api("/auth/houses"));
      if (!read) {
        setFailed(true);
        return;
      }
      const list = read.houses;
      setHeld(read.held);
      if (list.length === 0 && read.held.length === 0) {
        router.replace("/no-access");
        return;
      }
      let memory = {};
      try {
        memory = parseMemory(await SecureStore.getItemAsync(LAST_HOUSE_KEY));
      } catch {
        /* no memory: plain alphabetical order */
      }
      const ordered = orderHouses(list, memory, user?.id);
      setHouses(ordered.houses);
      setLastOpenedId(ordered.lastOpenedId);
    } catch {
      setFailed(true);
    }
  }, [router, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (house: HouseSummary) => {
    setRefused(null);
    setOpening(house.id);
    const ok = await chooseHouse(house.id);
    setOpening(null);
    if (ok) {
      router.replace("/");
      return;
    }
    setRefused(
      `We couldn't open ${house.name}. Try again, or choose another house.`,
    );
    void load();
  };

  const accept = async (house: HeldHouse) => {
    setRefused(null);
    setOpening(house.id);
    try {
      await api("/auth/held-memberships/accept", {
        method: "POST",
        body: { membershipId: house.membershipId },
      });
    } catch {
      setOpening(null);
      setRefused(
        `We couldn't add you to ${house.name}. Try again, or ask the house for a new invite.`,
      );
      void load();
      return;
    }
    const ok = await chooseHouse(house.id);
    setOpening(null);
    if (ok) {
      router.replace("/");
      return;
    }
    void load();
  };

  return (
    <AuthShell
      title="Which house today?"
      intro={user?.email ? `Signed in as ${user.email}` : undefined}
    >
      {refused ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote">{refused}</AppText>
        </AuthNotice>
      ) : null}

      {failed ? (
        <AuthNotice tone="warning">
          <AppText variant="footnote">
            We couldn't read your houses just now.
          </AppText>
          <AuthLink
            label="Try again"
            onPress={() => void load()}
            align="left"
          />
        </AuthNotice>
      ) : null}

      {houses === null && !failed ? (
        <AppText variant="footnote" tone="secondary">
          Opening your houses…
        </AppText>
      ) : null}

      {held.length > 0 ? (
        <View style={{ gap: space.md }}>
          <AppText variant="footnote" tone="secondary">
            Waiting for you. You joined these from an invite before your email
            address was confirmed. Nothing opens until you choose to join. If
            you do not know a house, leave it.
          </AppText>
          {held.map((house) => (
            <PressableScale
              key={house.membershipId}
              onPress={() => void accept(house)}
              disabled={opening !== null}
              accessibilityRole="button"
              accessibilityLabel={`Join ${house.name}`}
              style={{
                borderWidth: 1,
                borderColor: color.hairline,
                backgroundColor: color.surface,
                borderRadius: radius.control,
                paddingVertical: 16,
                paddingHorizontal: space.lg,
                opacity: opening !== null && opening !== house.id ? 0.6 : 1,
              }}
            >
              <AppText variant="wineName">
                {opening === house.id ? `Joining ${house.name}…` : `Join ${house.name}`}
              </AppText>
              {house.city ? (
                <AppText variant="footnote" tone="secondary">
                  {house.city}
                </AppText>
              ) : null}
            </PressableScale>
          ))}
        </View>
      ) : null}

      <View style={{ gap: space.md }}>
        {(houses ?? []).map((house) => {
          const last = house.id === lastOpenedId;
          return (
            <PressableScale
              key={house.id}
              onPress={() => void open(house)}
              disabled={opening !== null}
              accessibilityRole="button"
              accessibilityLabel={
                last ? `${house.name}, last opened here` : house.name
              }
              style={{
                borderWidth: 1,
                borderColor: last ? color.wine : color.hairline,
                backgroundColor: last ? color.wineTint : color.surface,
                borderRadius: radius.control,
                paddingVertical: 16,
                paddingHorizontal: space.lg,
                opacity: opening !== null && opening !== house.id ? 0.6 : 1,
              }}
            >
              <AppText variant="wineName">
                {opening === house.id ? `Opening ${house.name}…` : house.name}
              </AppText>
              {house.city ? (
                <AppText variant="footnote" tone="secondary">
                  {house.city}
                </AppText>
              ) : null}
              {last ? (
                <AppText variant="caption" tone="wine">
                  Last opened here
                </AppText>
              ) : null}
            </PressableScale>
          );
        })}
      </View>

      <AuthLink
        label="Not you? Sign out"
        onPress={() => {
          void signOut();
          router.replace("/login");
        }}
      />
    </AuthShell>
  );
}
