import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import {
  AuthButton,
  AuthField,
  AuthLink,
  AuthNotice,
  AuthShell,
} from "@/components/auth/AuthShell";
import { color, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { useSession } from "@/state/session";
import {
  emailError,
  nameError,
  normalizeEmail,
  passwordError,
  passwordStrength,
} from "@/auth/credentials";
import {
  inviteCodeError,
  isCompleteInviteCode,
  describeInviteRejection,
  normalizeInviteCode,
} from "@/auth/inviteCode";
import { inviteCodeFromPaste, safeRedirectTarget } from "@/auth/deepLink";
import { authErrorMessage } from "@/auth/outcomes";
import { clearPendingRoute, setPendingRoute } from "@/auth/pendingRoute";
import {
  checkEmailAvailable,
  fetchInvitePreview,
  joinViaInvite,
  registerRestaurant,
} from "@/api/auth";

type Path = "join" | "new";

/**
 * Create an account — the two paths `register.md` §1a describes.
 *
 * **Path A, "Join Your Team"**, is the one that earns this screen's place on a
 * phone. Line cooks and floor staff are invited by an owner and handed an
 * eight-character code; they are not sitting at a desk. Web can lean on the
 * invite URL, but on mobile the code is *typed*, which is why
 * `inviteCode.ts` exists and why the field validates against the exact charset
 * the server mints from.
 *
 * **Path B, "Open a Restaurant"**, is a 3-section rail form on web — identity,
 * location, contact — with address autocomplete, a phone input and a cuisine
 * picker. Mobile collects the seven fields `RegisterRestaurantDto` actually
 * requires and stops there. The three optional embellishments are **not**
 * ported and are named in the gap document rather than quietly counted:
 * autocomplete needs a places provider mobile has no key for.
 *
 * Deep links pre-route the path (`?invite=CODE`, `?type=join|new`, D-09), the
 * same three parameters web honours.
 */
export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    invite?: string;
    type?: string;
    redirect?: string;
  }>();
  const adoptTokens = useSession((s) => s.adoptTokens);

  const presetCode = inviteCodeFromPaste(params.invite ?? "");
  const [path, setPath] = useState<Path>(
    presetCode || params.type === "join" ? "join" : params.type === "new" ? "new" : "join",
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared identity fields.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [issues, setIssues] = useState<Record<string, string | null>>({});

  // Path A.
  const [code, setCode] = useState(presetCode ?? "");
  const [invitePreview, setInvitePreview] = useState<string | null>(null);

  // Path B.
  const [restaurantName, setRestaurantName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");

  const redirect = safeRedirectTarget(params.redirect);

  /**
   * Validate the code as it is typed (`register.md` §1a: "validated live as
   * you type"), but only once it is well-formed — a request per keystroke on a
   * partial code tells the user nothing and rate-limits them for the attempt
   * that would have.
   */
  const lastPreviewed = useRef<string>("");
  useEffect(() => {
    const normalized = normalizeInviteCode(code);
    if (!isCompleteInviteCode(normalized)) {
      setInvitePreview(null);
      lastPreviewed.current = "";
      return;
    }
    if (lastPreviewed.current === normalized) return;
    lastPreviewed.current = normalized;

    let cancelled = false;
    fetchInvitePreview(normalized)
      .then((preview) => {
        if (cancelled) return;
        if (preview.valid) {
          const where = preview.restaurant ?? preview.organization ?? "the team";
          setInvitePreview(
            preview.role ? `${where} — as ${preview.role}` : `${where}`,
          );
          setIssues((prev) => ({ ...prev, code: null }));
        } else {
          setInvitePreview(null);
          setIssues((prev) => ({
            ...prev,
            code: describeInviteRejection(preview.reason),
          }));
        }
      })
      .catch(() => {
        // An unreachable server says nothing about the code. Leave it alone.
        if (!cancelled) setInvitePreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  /** "Live 'email already in use' check while typing" (`register.md` §1a). */
  const lastChecked = useRef<string>("");
  useEffect(() => {
    const address_ = normalizeEmail(email);
    if (emailError(address_)) return;
    if (lastChecked.current === address_) return;
    const timer = setTimeout(() => {
      lastChecked.current = address_;
      checkEmailAvailable(address_)
        .then((result) => {
          setIssues((prev) => ({
            ...prev,
            email: result.available
              ? null
              : "That address already has an account — sign in instead.",
          }));
        })
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [email]);

  const submit = async () => {
    if (busy) return;
    const address_ = normalizeEmail(email);
    const next: Record<string, string | null> = {
      name: nameError(name),
      email: emailError(address_),
      password: passwordError(password),
    };
    if (path === "join") {
      next.code = inviteCodeError(code);
    } else {
      next.restaurantName = restaurantName.trim() ? null : "Name the restaurant.";
      next.address = address.trim() ? null : "Enter the street address.";
      next.city = city.trim() ? null : "Enter the city.";
      next.country = country.trim() ? null : "Enter the country.";
    }
    setIssues(next);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    setError(null);
    try {
      const tokens =
        path === "join"
          ? await joinViaInvite({
              code: normalizeInviteCode(code),
              name: name.trim(),
              email: address_,
              password,
            })
          : await registerRestaurant({
              name: name.trim(),
              email: address_,
              password,
              restaurantName: restaurantName.trim(),
              address: address.trim(),
              city: city.trim(),
              country: country.trim(),
            });

      // Path A lands on the dashboard, or wherever the user was headed; Path B
      // ends at email verification (`register.md` §1a). Left for the layout
      // rather than navigated to here — both fire on the same session
      // transition, and whichever ran second would win. See
      // `src/auth/pendingRoute.ts`.
      setPendingRoute(path === "join" ? (redirect ?? "/") : "/verify-email");
      await adoptTokens(tokens.accessToken, tokens.refreshToken);
      haptic.confirm();
    } catch (e) {
      clearPendingRoute();
      setError(authErrorMessage(e));
      haptic.warn();
    } finally {
      setBusy(false);
    }
  };

  const strength = password ? passwordStrength(password) : null;

  return (
    <AuthShell
      title={path === "join" ? "Join your team." : "Open a restaurant."}
      intro={
        path === "join"
          ? "Someone sent you an eight-character code. That's all you need."
          : "Create the owner account and the restaurant record together."
      }
    >
      <PathSwitch path={path} onChange={setPath} disabled={busy} />

      {path === "join" ? (
        <>
          <AuthField
            label="Invite code"
            value={code}
            onChangeText={(next) => {
              // Paste the whole link if that is what is on the clipboard.
              setCode(inviteCodeFromPaste(next) ?? next.toUpperCase());
              setIssues((prev) => ({ ...prev, code: null }));
            }}
            error={issues.code}
            hint={invitePreview ? `Invite to ${invitePreview}` : undefined}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCD2345"
            maxLength={40}
            editable={!busy}
          />
        </>
      ) : null}

      <AuthField
        label="Your name"
        value={name}
        onChangeText={(next) => {
          setName(next);
          setIssues((prev) => ({ ...prev, name: null }));
        }}
        error={issues.name}
        autoComplete="name"
        placeholder="Ada Lovelace"
        editable={!busy}
      />

      <AuthField
        label="Email"
        value={email}
        onChangeText={(next) => {
          setEmail(next);
          setIssues((prev) => ({ ...prev, email: null }));
        }}
        error={issues.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="you@restaurant.com"
        editable={!busy}
      />

      <AuthField
        label="Password"
        value={password}
        onChangeText={(next) => {
          setPassword(next);
          setIssues((prev) => ({ ...prev, password: null }));
        }}
        error={issues.password}
        hint={
          strength === "strong"
            ? "Strong."
            : strength === "fair"
              ? "Fine. Longer would be better."
              : "At least 8 characters."
        }
        secureTextEntry
        autoComplete="new-password"
        placeholder="••••••••"
        editable={!busy}
      />

      {path === "new" ? (
        <>
          <AuthField
            label="Restaurant name"
            value={restaurantName}
            onChangeText={(next) => {
              setRestaurantName(next);
              setIssues((prev) => ({ ...prev, restaurantName: null }));
            }}
            error={issues.restaurantName}
            placeholder="Bistro Konyaaltı"
            editable={!busy}
          />
          <AuthField
            label="Street address"
            value={address}
            onChangeText={(next) => {
              setAddress(next);
              setIssues((prev) => ({ ...prev, address: null }));
            }}
            error={issues.address}
            placeholder="12 Liman Caddesi"
            editable={!busy}
          />
          <AuthField
            label="City"
            value={city}
            onChangeText={(next) => {
              setCity(next);
              setIssues((prev) => ({ ...prev, city: null }));
            }}
            error={issues.city}
            placeholder="Antalya"
            editable={!busy}
          />
          <AuthField
            label="Country"
            value={country}
            onChangeText={(next) => {
              setCountry(next);
              setIssues((prev) => ({ ...prev, country: null }));
            }}
            error={issues.country}
            placeholder="Türkiye"
            editable={!busy}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
        </>
      ) : null}

      {error ? (
        <AuthNotice tone="danger">
          <AppText variant="footnote" tone="danger">
            {error}
          </AppText>
        </AuthNotice>
      ) : null}

      <View style={{ marginTop: space.sm }}>
        <AuthButton
          label={path === "join" ? "Join" : "Create restaurant"}
          onPress={submit}
          busy={busy}
        />
      </View>

      <AuthLink
        label="I already have an account"
        onPress={() => router.replace("/login")}
      />
      <AuthLink label="Privacy" onPress={() => router.push("/privacy")} />
    </AuthShell>
  );
}

function PathSwitch({
  path,
  onChange,
  disabled,
}: {
  path: Path;
  onChange: (next: Path) => void;
  disabled?: boolean;
}) {
  const options: { value: Path; label: string }[] = [
    { value: "join", label: "Join a team" },
    { value: "new", label: "Open a restaurant" },
  ];
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: color.fill,
        borderRadius: radius.control,
        padding: space.xs,
        gap: space.xs,
      }}
    >
      {options.map((option) => {
        const active = option.value === path;
        return (
          <PressableScale
            key={option.value}
            onPress={() => !disabled && onChange(option.value)}
            style={{
              flex: 1,
              paddingVertical: space.sm,
              borderRadius: radius.control - 4,
              alignItems: "center",
              backgroundColor: active ? color.surface : "transparent",
            }}
          >
            <AppText
              variant="caption"
              tone={active ? "primary" : "tertiary"}
              numberOfLines={1}
            >
              {option.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}
