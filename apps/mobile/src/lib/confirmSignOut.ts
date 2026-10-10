import { Alert } from "react-native";
import { signOutWords, unsentAtSignOut, useOutbox } from "@/state/outbox";
import { useSession } from "@/state/session";

/**
 * Sign out, but say first what stays behind (F-952).
 *
 * A receipt saved offline is kept on this phone for the person who saved it:
 * it sends only when they sign in here again, and the next person on a shared
 * door phone never sees it. So when any of theirs is still waiting, they are
 * told the count and can send it now (while the phone is unlocked) instead.
 * The web asks the same before signing out (AuthContext `logout`, OD-203).
 */
export function confirmSignOut(signOut: () => void | Promise<void>): void {
  const session = useSession.getState();
  const unsent = unsentAtSignOut(useOutbox.getState().entries, session.user);
  const words = signOutWords(unsent);
  if (!words) {
    void signOut();
    return;
  }
  // "Send now" sends what waits for the house that is open, and nothing else
  // (F-1026): it is offered only when there is some, and says so when other
  // houses' work stays behind.
  const sendNow = session.status === "signedIn" && unsent.here > 0;
  Alert.alert(
    "Not sent yet",
    sendNow && unsent.otherHouses > 0
      ? `${words} Send now sends only what is for the house you are in.`
      : words,
    [
      { text: "Cancel", style: "cancel" },
      ...(sendNow
        ? [{ text: "Send now", onPress: () => useOutbox.getState().flush() }]
        : []),
      { text: "Sign out anyway", style: "destructive" as const, onPress: () => void signOut() },
    ],
  );
}
