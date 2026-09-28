/**
 * The collaborators `TextSenderService` gained when the transport and the meter
 * landed (ADR 0121 addendum), built over the same in-memory stub.
 *
 * TEST SUPPORT ONLY. Nothing in the runtime graph imports this file; it lives
 * under `src/` for the reason `team/testing/supabase-stub.ts` gives — a helper
 * shared between spec files cannot itself be named `.spec.ts` without jest
 * trying to run it as a suite.
 *
 * WHY A HELPER AND NOT THREE `new`s IN EACH SPEC. Two suites already construct
 * `TextSenderService` (`text-sender.spec.ts`, `team/notes.service.spec.ts`) and
 * a third is added here. Three copies of the wiring is three places for one of
 * them to hand the service a differently-configured crypto or config, and a
 * spec that passed for that reason would be the least useful kind of green.
 */

import { ConfigService } from "@nestjs/config";
import type { DatabaseService } from "../../../database/database.service";
import { TokenCryptoService } from "../../../common/crypto/token-crypto.service";
import { TextCredentialsService } from "../providers/text-credentials.service";
import { TextTransportRegistry } from "../providers/text-transport.registry";
import { TextUsageService } from "../text-usage.service";

/**
 * A `ConfigService` that answers from a plain object.
 *
 * DEFAULTS TO EMPTY, which is the production truth: no deployment holds a
 * platform WhatsApp or Twilio credential today, so the honest default for a
 * test is the same absence. A spec that wants the platform path wired passes
 * the env in explicitly, and that explicitness is the point.
 */
export function stubConfig(env: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

export interface TextCollaborators {
  usage: TextUsageService;
  credentials: TextCredentialsService;
  transports: TextTransportRegistry;
}

export function textCollaborators(
  db: DatabaseService,
  env: Record<string, string> = {},
): TextCollaborators {
  const config = stubConfig(env);
  const credentials = new TextCredentialsService(
    db,
    new TokenCryptoService(config),
    config,
  );
  return {
    usage: new TextUsageService(db),
    credentials,
    transports: new TextTransportRegistry(credentials),
  };
}
