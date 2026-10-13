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
import { confirmSignOut } from "@/lib/confirmSignOut";
import {
  chooserStep,
  LAST_HOUSE_KEY,
  orderHouses,
  parseHeld,
  parseMemory,
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
 * F-1569: a house joined from an invite before the address was proved is
 * held. It is listed under "Waiting for you" with a Join button, as web
 * ChooseHouse lists it; a session whose address is not proved yet cannot read
 * its houses at all, so it goes to /verify-email first.
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

  const step = chooserStep(user?.emailVerified, houses, held);

  const load = useCallback(async () => {
    setFailed(false);
    if (user?.emailVerified === false) return;
    try {
      const body = await api<{ houses?: HouseSummary[]; held?: unknown }>(
        "/auth/houses",
      );
      const list = Array.isArray(body.houses) ? body.houses : [];
      setHeld(parseHeld(body.held));
      if (list.length === 0) {
        setHouses([]);
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
  }, [user?.id, user?.emailVerified]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (step === "verify") router.replace("/verify-email");
    else if (step === "noAccess") router.replace("/no-access");
  }, [step, router]);

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
          <AppText variant="headline">Waiting for you</AppText>
          <AppText variant="footnote" tone="secondary">
            You joined these from an invite before your email address was
            confirmed. Nothing opens until you choose to join. If you do not
            know a house, leave it.
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
              <AppText variant="wineName">{house.name}</AppText>
              {house.city ? (
                <AppText variant="footnote" tone="secondary">
                  {house.city}
                </AppText>
              ) : null}
              <AppText variant="caption" tone="wine">
                {opening === house.id
                  ? `Joining ${house.name}…`
                  : `Join ${house.name}`}
              </AppText>
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
        onPress={() =>
          // Says first what stays unsent on this phone (F-1026).
          confirmSignOut(() => {
            void signOut();
            router.replace("/login");
          })
        }
      />
    </AuthShell>
  );
}
