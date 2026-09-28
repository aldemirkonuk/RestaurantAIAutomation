/**
 * One interface, two providers, and a hard line between BUILDING a request and
 * SENDING one (ADR 0121, the transport half).
 *
 * WHY THE SPLIT IS THE WHOLE DESIGN
 * ---------------------------------
 * ADR 0121 says nothing sends, and that is still true after this file: no house
 * on this deployment has a `connected` sender, `house_text_sender_credentials`
 * is empty, and `TextTransportRegistry` refuses to build an adapter without a
 * credential row. What this file adds is the ability to be WRONG ON PAPER
 * rather than wrong in production — a request shape can be checked against the
 * provider's own documentation today, months before a token exists.
 *
 * So every adapter is two pure functions and one impure one:
 *
 *   `buildRequest(...)`  pure. Method, URL, headers, body. Testable.
 *   `parseResponse(...)` pure. Provider JSON in, our outcome out. Testable.
 *   `dispatch(...)`      impure. The only place an HTTP call can happen, and it
 *                        cannot be reached without a credential.
 *
 * THE TESTS NEVER SEND. Every fixture under `__fixtures__/` is transcribed from
 * the provider's published documentation with the URL and fetch date in the
 * file, and the specs feed those fixtures to `parseResponse` directly. A test
 * that hit a provider would be a test that could pass because a network was
 * down, and it would be the first thing to send a message from this repo.
 *
 * WHAT AN ADAPTER MAY NOT DO
 * --------------------------
 * Invent an id. ADR 0084 deleted `mockSendSms` for returning a fabricated
 * `messageId` for a message nobody sent, and `parseResponse` here returns
 * `providerRef: null` with a stated reason rather than a placeholder when the
 * provider's body does not carry one.
 *
 * Invent a cost. Twilio's Message resource says `price` "is populated after the
 * message has been sent/received, and may not be immediately available"
 * (twilio.com/docs/messaging/api/message-resource, via Twilio's docs MCP,
 * 2026-09-05), so the ordinary outcome of a successful send is
 * `cost: { state: "not_reported_yet" }`. That is why
 * `house_message_meter.provider_cost_state` exists and has no default.
 */

/** The providers an adapter can be built for. Mirrors the CHECK on the table. */
export type TransportProvider = "meta_cloud" | "twilio";

/** Whose provider account holds the sender. Mirrors the CHECK on the table. */
export type CredentialOwner = "platform" | "house";

/**
 * A credential, already decrypted, ready for one adapter.
 *
 * `accessToken` is `null` on the platform path: the adapter reads Mudavym's own
 * credential from configuration instead, because a deployment secret copied
 * into fourteen tenant rows is a leak surface with no upside (the migration's
 * CHECK makes storing one impossible).
 */
export interface TransportCredential {
  provider: TransportProvider;
  owner: CredentialOwner;
  /** Decrypted, in memory, for the length of one call. Never logged. */
  accessToken: string | null;
  /** meta_cloud: WABA id. twilio: subaccount SID. */
  accountRef: string | null;
  /** meta_cloud: business phone number id. twilio: the `From` value. */
  senderRef: string | null;
  /** twilio: Messaging Service SID. Unused by meta_cloud. */
  serviceRef: string | null;
  apiVersion: string | null;
}

/** Everything an adapter needs to address one message. */
export interface OutboundText {
  /** E.164, as the book holds it. */
  toE164: string;
  body: string;
  /**
   * True when this house has an OPEN 24-hour customer service window with this
   * recipient, which is what decides whether a WhatsApp message may be
   * free-form and whether it is charged at all. `null` means WE DO NOT KNOW —
   * distinct from `false`, and it must never be folded into it, because "the
   * window is closed" and "we could not read the window" lead to different
   * messages and only one of them is a refusal the house can act on.
   */
  windowOpen: boolean | null;
}

/** An HTTP request an adapter WOULD make. Building one sends nothing. */
export interface TransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  /** JSON body, or form-encoded pairs for Twilio's 2010 API. */
  body: Record<string, string> | Record<string, unknown>;
  /** How `body` is meant to be serialised, so `dispatch` cannot guess wrong. */
  encoding: "json" | "form";
}

export type TransportCostState =
  | "not_reported_yet"
  | "reported"
  | "unavailable";

export interface TransportCost {
  state: TransportCostState;
  /** Minor units. Present only when `state === "reported"`. */
  minor: number | null;
  /** ISO 4217, upper case. Present only when `state === "reported"`. */
  currency: string | null;
}

export type TransportOutcomeKind =
  /** The provider took it. NOT the same as delivered. */
  | "accepted_by_provider"
  /** The provider refused it and said why. */
  | "refused_by_provider"
  /** The response did not parse as anything this adapter recognises. */
  | "unreadable";

export interface TransportOutcome {
  kind: TransportOutcomeKind;
  /**
   * The provider's own id for the message: a `wamid.…` or a Twilio `SM…` SID.
   * `null` when the body carried none, and `detail` then says so. NEVER a
   * placeholder — ADR 0084 deleted a fabricated `messageId` for exactly this.
   */
  providerRef: string | null;
  /** The provider's own status word, verbatim, when it gave one. */
  providerStatus: string | null;
  /** The provider's error code, when it refused. */
  errorCode: string | null;
  /** The sentence a person reads. Always populated. */
  detail: string;
  cost: TransportCost;
  /**
   * Whether this message is chargeable at all, as far as the PROVIDER's own
   * rules go, with the reason. Separate from `cost` because "free by rule" is
   * knowable at send time and "what it cost" is not.
   */
  chargeable: boolean;
  chargeableReason: string;
}

/** The one door. Two implementations, no third. */
export interface TextTransport {
  readonly provider: TransportProvider;

  /** Pure. Builds the request; sends nothing. */
  buildRequest(
    credential: TransportCredential,
    message: OutboundText,
  ): TransportRequest;

  /** Pure. Turns a provider body into our outcome. */
  parseResponse(status: number, body: unknown): TransportOutcome;
}

/**
 * The cost shape for a send whose price the provider has not reported.
 *
 * A named constant rather than an inline literal in each adapter, because two
 * adapters each spelling out `{ state: "not_reported_yet", minor: null,
 * currency: null }` is two places for one of them to acquire a zero.
 */
export const COST_NOT_REPORTED_YET: TransportCost = Object.freeze({
  state: "not_reported_yet",
  minor: null,
  currency: null,
});

export const COST_UNAVAILABLE: TransportCost = Object.freeze({
  state: "unavailable",
  minor: null,
  currency: null,
});

/**
 * Read a string off an unknown body without asserting a shape.
 *
 * Provider responses are untyped JSON off a network. `as` would make a typo in
 * a provider's field name into `undefined` flowing on as if it were data.
 */
export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
