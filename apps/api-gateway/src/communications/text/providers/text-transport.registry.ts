/**
 * Which adapter, and whether there is one at all.
 *
 * THE REGISTRY IS THE REFUSAL, NOT A LOOKUP TABLE
 * -----------------------------------------------
 * `TextSenderService.send()` returned `transport_not_built` unconditionally
 * because there was no adapter and nowhere for a credential to live. Both now
 * exist, so the refusal has to become a CHECK rather than a constant — and the
 * check has to fail for a house that is not wired, which is every house on this
 * deployment today (`house_text_sender_credentials` holds zero rows).
 *
 * This class is where that check lives. It returns an adapter ONLY when a live
 * credential resolved; every other path returns a reason. That is deliberately
 * the opposite arrangement from a registry that maps a provider name to a class
 * and lets the caller worry about credentials — with that shape, forgetting the
 * credential check is a one-line omission that produces an adapter holding an
 * empty Bearer token, and a manager is then told the provider refused them.
 *
 * NO NETWORK CALL HAPPENS HERE OR ANYWHERE BELOW THIS FILE IN THIS BUILD.
 * There is no `dispatch`. Building a request is not sending one, and the send
 * path stops at the built request — see `text-sender.service.ts`. When a
 * transport is wired, the one function that performs the HTTP call goes here,
 * behind the same credential check, and the ADR's "not built" line is replaced
 * rather than deleted.
 */

import { Injectable } from "@nestjs/common";
import { MetaCloudAdapter } from "./meta-cloud.adapter";
import { TwilioAdapter } from "./twilio.adapter";
import { TextCredentialsService } from "./text-credentials.service";
import type {
  TextTransport,
  TransportCredential,
  TransportProvider,
} from "./text-transport";

export type TransportResolution =
  | {
      state: "ready";
      transport: TextTransport;
      credential: TransportCredential;
      /** True when the house pays its provider directly (bring-your-own-key). */
      ownKeys: boolean;
      words: string;
    }
  | {
      state: "no_credential" | "unreadable" | "unusable" | "no_adapter";
      transport: null;
      credential: null;
      ownKeys: false;
      words: string;
    };

@Injectable()
export class TextTransportRegistry {
  private readonly meta = new MetaCloudAdapter();
  private readonly twilio = new TwilioAdapter();

  constructor(private readonly credentials: TextCredentialsService) {}

  /**
   * The adapter for a provider, or `null`.
   *
   * A `switch` over a union rather than a map, so adding a third provider is a
   * compile error here instead of a silent `undefined` at run time.
   */
  adapterFor(provider: TransportProvider): TextTransport | null {
    switch (provider) {
      case "meta_cloud":
        return this.meta;
      case "twilio":
        return this.twilio;
      default:
        return null;
    }
  }

  /** The whole question: is this sender wired, and to what? */
  async resolve(
    restaurantId: string,
    senderId: string,
  ): Promise<TransportResolution> {
    const resolved = await this.credentials.resolve(restaurantId, senderId);

    if (resolved.state !== "ready" || !resolved.credential) {
      return {
        state:
          resolved.state === "none"
            ? "no_credential"
            : resolved.state === "unreadable"
              ? "unreadable"
              : "unusable",
        transport: null,
        credential: null,
        ownKeys: false,
        words: resolved.words,
      };
    }

    const transport = this.adapterFor(resolved.credential.provider);
    if (!transport) {
      // Unreachable through the type system today, and kept because the
      // provider string comes off a database row: a value added to the
      // table's CHECK before the adapter exists arrives here, and the honest
      // answer is "we have no code for that", not a crash.
      return {
        state: "no_adapter",
        transport: null,
        credential: null,
        ownKeys: false,
        words: `This sender is recorded against a provider this build has no adapter for, so nothing was attempted. Nothing was sent and nothing was queued.`,
      };
    }

    return {
      state: "ready",
      transport,
      credential: resolved.credential,
      ownKeys: resolved.credential.owner === "house",
      words: resolved.words,
    };
  }
}
