/**
 * The house's data-and-privacy terms — what an owner accepts to turn Jev on
 * (ADR 0207 round 4).
 *
 * THE FOUNDER, 2026-09-22, round 6y, verbatim: "owner only, but also we're
 * going to use this as complete data and privacy usage, they have to accept
 * that, and when they do they'd accept the jev too with their names and
 * sensitive topics redacted."
 *
 * Pure module: no database, no HTTP. `TERMS_VERSION` bumps whenever a
 * statement's WORDS change (never for a formatting change alone); a version
 * bump pauses Jev for every house until an owner accepts the new one
 * (`house-data-terms.service.ts`).
 *
 * TWO KINDS OF STATEMENT:
 *   `fact`  — a claim about where the house's data goes, cited to a code path
 *             (or a vendor document in `.planning/07-reference/`). What this
 *             file asserts must be true of the tree, not merely believable.
 *   `term`  — who is responsible, what Mudavym does not do. Carries no
 *             evidence; belongs to the lawyer list (ADR 0207 §A7), not to a
 *             fact a spec can check.
 *
 * EVERY HOST IS NAMED OR EXCUSED (ADR 0207 round 5, ADR 0224; the founder,
 * 2026-09-25: complete the subprocessor list first, then merge):
 * `scripts/check_data_terms_name_every_host.py` fails the build unless every
 * outside host that the gateway's and the orchestrator's code can send to — a
 * URL or hostname literal in code, or a network SDK it imports — is named by a
 * `host` below (a row may name several, comma-separated) or excused there with
 * the reason no house data reaches it. Change this list and that guard together.
 */

import { createHash } from "node:crypto";

export const TERMS_VERSION = 1 as const;

export type StatementKind = "fact" | "term";

export interface DataTermStatement {
  key: string;
  kind: StatementKind;
  text: string;
  /** Code paths or repo documents backing a `fact` statement; empty for a `term`. */
  evidence: string[];
}

export interface Subprocessor {
  name: string;
  host: string;
  what: string;
  when: string;
  /** Whether what this subprocessor receives has already had names/topics masked. */
  masked: boolean;
}

export const STATEMENTS: readonly DataTermStatement[] = [
  {
    key: "vendor-mail-to-anthropic",
    kind: "fact",
    text:
      "Every vendor email thread this house receives — its messages and their PDF and image " +
      "attachments — is sent WHOLE to Anthropic, to read it and draft replies. Nothing is masked " +
      "for this flow.",
    evidence: [
      "apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:31",
      "apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:756-770",
      "apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:1398-1410",
    ],
  },
  {
    key: "vendor-mail-to-gemini",
    kind: "fact",
    text:
      "Vendor email is also read by Google Gemini, for email intelligence and extraction.",
    evidence: ["services/agent-orchestrator/services/model_clients.py:68"],
  },
  {
    key: "jev-tone-scoring",
    kind: "fact",
    text:
      "Jev (built by TypeSafe) reads the LATEST part of a vendor message, with names, emails, " +
      "phone numbers, private topics, account numbers, government ids and credentials removed " +
      "first — never the whole thread, never an automated message — and only while this switch is " +
      "on and an owner has accepted these terms in their current version. Up to the last 365 days " +
      "of mail is read once the switch is first turned on. The removal is a rule-based pass: a name " +
      "it was never told, or a private matter written in words its list does not hold, can still get " +
      "through. A message not written in Turkish or English is not sent at all.",
    evidence: [
      "apps/api-gateway/src/vendor-tone/jev-tone.client.ts",
      "apps/api-gateway/src/vendor-tone/pii-mask.ts",
      "apps/api-gateway/src/vendor-tone/sensitive-mask.ts",
      "apps/api-gateway/src/vendor-tone/vendor-tone-scoring.service.ts:45",
    ],
  },
  {
    key: "jev-retention-unagreed",
    kind: "fact",
    text:
      "TypeSafe states it does not train on customer data. What it keeps of a masked message, and " +
      "for how long, is NOT yet agreed with Mudavym in writing.",
    evidence: [".planning/07-reference/TYPESAFE_AI_OVERVIEW.md:176-178"],
  },
  {
    key: "jev-readings-kept-as-numbers",
    kind: "fact",
    text:
      "Jev's own reading of a message — a point on a scale, never the text — is kept as Mudavym's " +
      "internal data.",
    evidence: [
      "supabase/migrations/20260925191000_an_overdue_order_is_asked_and_vendor_tone_is_ml_data.sql:137",
    ],
  },
  {
    key: "other-connections",
    kind: "fact",
    text:
      "This house's data also reaches every other service listed below, each for the reason its row " +
      "gives: Sentry (error reports), Google (Gmail, sign-in, Drive and Calendar), Microsoft " +
      "(sign-in and profile), Plivo, Twilio and Meta's WhatsApp (text messages), SendGrid (email, " +
      "when it is the mail path), Firebase, Expo and the browsers' own push services (notifications), " +
      "Toast (point of sale), Stripe (billing), Serper (web search), OpenAI (only when a key is set), " +
      "the US National Weather Service (the house's map point, for its forecast), and the services " +
      "Mudavym itself runs on: Supabase (the database), CloudAMQP (the message queue), Upstash (the " +
      "cache), Railway (the servers) and Vercel (the web app and its /api relay). " +
      "A check in Mudavym's build fails whenever its code can send to a host this list does not name.",
    evidence: [
      ".planning/foundation/EXTERNAL_CONNECTIONS.md:34-64",
      "scripts/check_data_terms_name_every_host.py",
      "vercel.json:8-12",
    ],
  },
  {
    key: "not-a-vendor-consent",
    kind: "term",
    text:
      "This acceptance is the house's own — it instructs Mudavym and accepts its subprocessors. It " +
      "is not the vendor's people's consent; they are never asked. The lawful footing for sending " +
      "their masked words is this house's own interest in its vendor relations.",
    evidence: [],
  },
  {
    key: "responsibility",
    kind: "term",
    text:
      "The house remains responsible for what it sends to a vendor and for the accuracy of its own " +
      "records. Mudavym is a processor of the house's data for the purposes named above, not the " +
      "house's legal or compliance advisor.",
    evidence: [],
  },
] as const;

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Anthropic",
    host: "api.anthropic.com",
    what: "vendor mail, whole, for reading and drafting replies",
    when: "every inbound vendor message",
    masked: false,
  },
  {
    name: "Google Gemini",
    host: "generativelanguage.googleapis.com",
    what: "vendor mail, for email intelligence and extraction",
    when: "every inbound vendor message",
    masked: false,
  },
  {
    name: "TypeSafe (Jev)",
    host: "api.typesafe.ai",
    what: "the latest part of a vendor message, masked",
    when: "only while this house's switch is on",
    masked: true,
  },
  {
    name: "Sentry",
    host: "sentry.io",
    what: "error reports, with identities removed",
    when: "when the product errors",
    masked: false,
  },
  {
    name: "Gmail / Google",
    host: "gmail.googleapis.com, smtp.gmail.com",
    what: "vendor email: sending it and watching the inbox",
    when: "every vendor email",
    masked: false,
  },
  {
    name: "Google account, Drive and Calendar",
    host: "www.googleapis.com, oauth2.googleapis.com, accounts.google.com",
    what: "Google sign-in, the connected person's profile, the mail archive written to Drive, calendar sync",
    when: "sign-in, and while a Google connection is on",
    masked: false,
  },
  {
    name: "Microsoft",
    host: "login.microsoftonline.com, graph.microsoft.com",
    what: "sign-in (Outlook/365) and the connected person's profile",
    when: "sign-in, and while a Microsoft connection is on",
    masked: false,
  },
  {
    name: "Plivo",
    host: "api.plivo.com",
    what: "text messages and calls: the number and the words",
    when: "SMS reminders, summaries and vendor calls",
    masked: false,
  },
  {
    name: "Twilio",
    host: "api.twilio.com",
    what: "text messages: the number and the words",
    when: "only for a house that connects a Twilio sender",
    masked: false,
  },
  {
    name: "Meta (WhatsApp)",
    host: "graph.facebook.com",
    what: "WhatsApp messages: the number and the words",
    when: "only for a house that connects a WhatsApp sender",
    masked: false,
  },
  {
    name: "SendGrid",
    host: "api.sendgrid.com",
    what: "outgoing email: the address and the letter",
    when: "only when SendGrid is set as the mail path",
    masked: false,
  },
  {
    name: "Firebase (FCM)",
    host: "fcm.googleapis.com",
    what: "push notifications: the words shown on the phone or in Chrome",
    when: "app and browser notifications",
    masked: false,
  },
  {
    name: "Expo",
    host: "exp.host",
    what: "mobile push notifications: the title and words shown on the phone",
    when: "app notifications",
    masked: false,
  },
  {
    name: "Browser push services",
    host: "updates.push.services.mozilla.com, web.push.apple.com, notify.windows.com",
    what: "browser notifications: the words shown, encrypted for the browser",
    when: "only for a person who turns on browser notifications",
    masked: false,
  },
  {
    name: "Toast",
    host: "toasttab.com",
    what: "point-of-sale orders, stock and menu events",
    when: "continuous, for houses on Toast",
    masked: false,
  },
  {
    name: "Supabase",
    host: "supabase.co",
    what: "the house's own data — the system of record",
    when: "continuous",
    masked: false,
  },
  {
    name: "Serper",
    host: "google.serper.dev",
    what: "web search for price verification",
    when: "research and price checks",
    masked: false,
  },
  {
    name: "Stripe",
    host: "api.stripe.com",
    what: "the house's name and email, and a card on file (the card is typed on Stripe's own page)",
    when: "when an owner sets up billing",
    masked: false,
  },
  {
    name: "OpenAI",
    host: "api.openai.com",
    what: "auction-wine research questions",
    when: "only when an OpenAI key is set",
    masked: false,
  },
  {
    name: "US National Weather Service",
    host: "api.weather.gov",
    what: "the house's map point (to four decimal places), for its local forecast",
    when: "houses in the United States",
    masked: false,
  },
  {
    name: "CloudAMQP",
    host: "cloudamqp.com",
    what: "the message queue between Mudavym's own servers — house events in transit",
    when: "continuous",
    masked: false,
  },
  {
    name: "Upstash",
    host: "upstash.io",
    what: "the cache and background jobs — copies of house data for a short time",
    when: "continuous",
    masked: false,
  },
  {
    name: "Railway",
    host: "railway.app",
    what: "the servers Mudavym runs on — every request and every job",
    when: "continuous",
    masked: false,
  },
  {
    name: "Vercel",
    host: "vercel.com",
    what: "the web app's pages, and any call sent through its /api relay to Mudavym's servers",
    when: "every visit",
    masked: false,
  },
] as const;

/** What changed between released versions, shown above the terms when an owner is asked again. */
export const CHANGED_SINCE: Readonly<Record<number, readonly string[]>> = {};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The exact words and subprocessor list an owner is shown — canonical JSON, key order fixed. */
export function snapshot(): Record<string, unknown> {
  return {
    version: TERMS_VERSION,
    statements: STATEMENTS,
    subprocessors: SUBPROCESSORS,
  };
}

/** SHA-256 hex of the canonical snapshot. No I/O, no state — a pure digest. */
export function digest(): string {
  return createHash("sha256").update(stableStringify(snapshot())).digest("hex");
}
