/**
 * ConnectionsNext data — one read per register, and each one fails alone.
 *
 * WHY SEVEN QUERIES AND NOT ONE LEDGER ENDPOINT
 * ---------------------------------------------
 * A single `GET /connections/ledger` was the obvious build and it is the wrong
 * one. ADR 0020 requires that a failed read NAME the register it could not
 * read; one endpoint assembling seven sources has exactly two answers — the
 * whole page, or a 500 — so the till being unreadable would blank the payment
 * register too, and the page would say nothing about which of the seven had
 * gone. Seven queries mean seven independent honesty states, which is the
 * thing this surface exists to have. It costs seven requests on a page a
 * manager opens rarely. Recorded in ADR 0114 with the alternative.
 *
 * G20 — ONE CATALOGUE, NOT A FOURTH
 * ---------------------------------
 * `components/settings/IntegrationsAuth.tsx:161`,
 * `settings/next/ServicesSection.tsx:128` and
 * `profile/next/ConnectionsRegister.tsx:224` each render the OAuth catalogue
 * and each shows a different subset. This page adds no fourth: it reads
 * `GET /integrations/oauth/catalog`, the same route the other three read,
 * which is served from the one shared constant
 * (`apps/api-gateway/src/integrations/integrations-oauth.constants.ts:43-66`).
 * The list it shows is longer than theirs only because it also reads the four
 * registers none of them has ever shown.
 *
 * TENANT KEYING
 * -------------
 * The api client stamps `X-Restaurant-Id` from localStorage
 * (services/api/client.ts), so the header never reaches a query key on its own.
 * Every key below carries `activeRestaurantId`, and a branch switch therefore
 * cannot serve the previous tenant's ledger.
 *
 * ROLE
 * ----
 * `/connections` is manager-and-owner. The page refuses in words for anyone
 * else, and the two registers that would actually leak are gated at the
 * GATEWAY as well (G19: `GET /payment-methods` and `GET /billing/provider`
 * now run `assertCanManageRestaurant`, and `GET /integrations/oauth/
 * house-grants` was born gated). A client-side check alone would be a curtain.
 */

import { useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '../../../contexts/AuthContext';
import { apiClient } from '../../../services/api/client';
import { stripePublishableKey } from '../../../components/mudavym/stripe-js';
import { readError } from './cx-format';

/* ── view models ──────────────────────────────────────────────────────── */

/** Whose an attachment is. The first of the four columns on every row. */
export type Owner = 'house' | 'person' | 'deployment' | 'public';

export interface PosStatusVM {
  unavailable: boolean;
  totalChecks: number | null;
  sources:
    | Array<{
        source: string;
        providerName?: string;
        checks?: number;
        open?: number;
        latest?: string | null;
      }>
    | null;
  windowDays: number;
}

/**
 * The provider's state, field-for-field as `payment-methods/dto` declares it
 * (`PaymentProviderState`, `payment-method.dto.ts:116-135`). Named against the
 * DTO rather than invented: a first draft of this file guessed a
 * `secrets: Record<string, boolean>` bag, and the row rendered "the provider
 * did not say which secrets it holds" while the gateway was saying exactly
 * which — a page inventing an absence out of its own naming mistake, which is
 * the fault this surface exists to catch, caught on the surface itself.
 */
export interface ProviderStateVM {
  connected: boolean;
  mode: string | null;
  reason: string | null;
  secretKeyPresent?: boolean;
  webhookSecretPresent?: boolean;
  apiVersion?: string;
  webhookLastReceivedAt?: string | null;
  webhookLastEventType?: string | null;
  webhookReason?: string | null;
}

export interface PaymentMethodVM {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface SenderIdentityVM {
  address: string | null;
  scope: 'deployment' | 'house';
  configuredBy: string;
  resolvedFromProfile: boolean;
  perHouse: { supported: boolean; reason: string };
}

/**
 * The house's TEXT sender — the mail row's sibling (ADR 0121).
 *
 * `state` is the whole story and there are six of it, because "we asked", "they
 * are looking at it" and "it is live" are three different facts a manager acts
 * on differently. Only `connected` may send.
 */
export interface HouseTextSenderVM {
  id: string;
  channel: 'whatsapp' | 'sms';
  path: 'bring_your_own' | 'mudavym_registers';
  state:
    | 'requested'
    | 'submitted'
    | 'in_review'
    | 'connected'
    | 'rejected'
    | 'revoked';
  stateDetail: string | null;
  identity: string | null;
  identityKind: 'e164' | 'alphanumeric' | null;
  displayName: string | null;
  market: string;
  provider: string | null;
  /** NULL means NEVER PROBED, which is not the same as unreachable. */
  lastProbeAt: string | null;
  lastProbeResult: string | null;
  feeStated: string | null;
  timelineStated: string | null;
}

export interface TextMarketVM {
  market: string;
  marketLabel: string;
  twoWay: boolean;
  provides: string[];
  fee: string;
  timeline: string;
  refusals: string[];
}

export interface TextSenderDefinitionVM {
  id: 'whatsapp_business' | 'sms_sender';
  channel: 'whatsapp' | 'sms';
  label: string;
  providerLabel: string;
  description: string;
  connection: { bring_your_own: string; mudavym_registers: string };
  revocation: string;
  custody: string;
  markets: TextMarketVM[];
}

export interface TextSendersVM {
  senders: { whatsapp: HouseTextSenderVM | null; sms: HouseTextSenderVM | null };
  readable: boolean;
  reason: string | null;
  catalogue: Record<'whatsapp_business' | 'sms_sender', TextSenderDefinitionVM>;
  surveyedMarkets: { whatsapp: string[]; sms: string[] };
  /** The server's own statement that nothing can leave yet. */
  /**
   * MEASURED BY THE GATEWAY FOR THIS HOUSE, not a constant about the
   * deployment. `built` says a dispatch exists in this build at all; `wired`
   * says whether THIS house has a live provider credential behind its sender,
   * and it is `null` when that could not be read — never `false`, which would
   * claim the house has no provider account when the truth is that we could not
   * tell (ADR 0121 P1).
   */
  transport: { built: boolean; wired: boolean | null; words: string };
  myConsent: {
    consent: { phone: string; channel: string; consentedAt: string } | null;
    readable: boolean;
    reason: string | null;
  };
}

/** The four MCP behaviour hints, tri-state. Null = the server did not say. */
export interface McpAnnotationsVM {
  readOnlyHint: boolean | null;
  destructiveHint: boolean | null;
  idempotentHint: boolean | null;
  openWorldHint: boolean | null;
}

export interface McpToolGrantVM {
  toolName: string;
  /** The classification the GATE uses. Never looser than `declaredRead`. */
  writes: boolean;
  /**
   * What the SERVER declared. TRUE = it said readOnlyHint: true. FALSE = it
   * said otherwise. NULL = it said nothing, which carries the same permission
   * as FALSE and is a different fact — so the row shows which.
   */
  declaredRead: boolean | null;
  declaredAnnotations: McpAnnotationsVM | null;
  /** 'manager_override' = a declared read that a manager made a write. */
  classificationSource: 'declared' | 'manager_override';
  /** Set = this grant is REFUSED at the gate until a manager re-consents. */
  needsReconsentAt: string | null;
  /** What changed, in words. Never null when the timestamp is set. */
  needsReconsentReason: string | null;
  toolListHash: string | null;
  /**
   * What the LAST sealed call on this tool was worth. 'proven' = a one-time
   * challenge was redeemed for exactly that call; 'asserted' = the caller
   * claimed the seal and nothing checked it (every call before 2026-09-04);
   * null = no sealed call has ever been made, which is a third state and not a
   * quiet 'asserted'.
   */
  lastSeal: 'proven' | 'asserted' | null;
  grantedBy: string | null;
  grantedByName: string | null;
  grantedAt: string;
}

export interface McpServerVM {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastProbeAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked';
  declaredBy: string | null;
  declaredByName: string | null;
  hasSecret: boolean;
  secretSetAt: string | null;
  consent: { given: boolean; at: string | null; liveCount: number };
  toolGrants: McpToolGrantVM[];
  probe: {
    status: 'ok' | 'unreachable' | 'refused' | 'protocol_error' | 'unconfigured';
    detail: string | null;
    serverName: string | null;
    serverVersion: string | null;
    protocolVersion: string | null;
    tools: Array<{
      name: string;
      title: string | null;
      description: string | null;
      annotations: McpAnnotationsVM | null;
    }> | null;
    toolCount: number | null;
  } | null;
}

export interface McpRuntimeVM {
  secretStorage: { configured: boolean; reason: string | null };
  invocation: { enabled: boolean; reason: string };
  probeTimeoutMs: number;
}

/**
 * The house's own archive of its mail (ADR 0118 D16).
 *
 * `owner.keptIn` is composed by the GATEWAY and printed verbatim. The page must
 * not build that sentence: it has to separate a name that was read, an account
 * that records none, and a read that FAILED, and only the server can tell those
 * apart. `owner.name` is here to be shown beside it, never to be substituted for
 * a missing `keptIn`.
 */
export interface ArchiveVM {
  mode: 'own_cloud' | 'mudavym_archive' | 'none'
  chosen: boolean
  armed: boolean
  says: string
  refusedBecause: string | null
  connectionId: string | null
  driveFolderPath: string | null
  owner: {
    userId: string | null
    name: string | null
    unreadableBecause: string | null
    keptIn: string
  }
}

/**
 * One licensed distributor, as the register measured it (ADR 0126).
 *
 * Field-for-field against `DistributorCatalogueRow`
 * (`distributor-feed.service.ts`) rather than invented, for the reason
 * `ProviderStateVM` records above: a guessed shape renders a real answer as an
 * absence, which is the exact fault this page exists to catch.
 */
export interface DistributorVM {
  key: string;
  distributor: string;
  jurisdictions: string[];
  portal: { name: string; url: string } | null;
  mechanism: string;
  automatedAccess: {
    verdict: 'forbidden' | 'permitted_with_bounds' | 'unstated';
    robots: string;
    terms: string | null;
    measuredOn: string;
    evidence: string[];
  };
  availability: string;
  unbuilt: { reason: string; measuredOn: string } | null;
  connectable: boolean;
}

export interface DistributorCatalogueVM {
  connection: {
    label: string;
    description: string;
    offerable: boolean;
    notOfferableBecause: string;
    waysIn: Array<{
      id: string;
      label: string;
      built: boolean;
      how: string;
      route: string;
      needs: string;
    }>;
  };
  requested: string;
  jurisdiction: string | null;
  distributors: DistributorVM[];
  /** Words when the list is empty. Never an empty array left to speak for itself. */
  silence: string | null;
}

export interface FeedLetterVM {
  id: string;
  filename: string;
  subject: string;
  signedBy: string;
  firstAsk: string;
  neverSent: string;
  brackets: string[];
  body: string;
}

/** What `POST /procurement/documents` says back about an 832's own lines. */
export interface CatalogueAdmissionVM {
  distributorKey: string | null;
  sha256: string;
  documentId: string | null;
  uploadedByName?: string | null;
  uploadedAt: string;
  admitted: number;
  refused?: number;
  alreadyRecorded?: number;
  writeFailed?: number;
  writeFailures?: string[];
  linesRead?: number;
  unmappedCodes?: string[];
  refusedWhole: string | null;
  knownDistributorKeys?: string[];
  sentence: string;
  lines?: Array<{
    admitted: boolean;
    item: string;
    reason: string | null;
    detail: string | null;
    priceBasis?: string;
    priceCode?: string;
    rawPrice?: number;
    currency?: string;
  }>;
}

/**
 * One manager's statement about one of a sender's price codes (ADR 0126 §7).
 *
 * Field-for-field against `PriceCodeMapping` (`distributor-feed/
 * price-code-mappings.ts`) as `mapRow` hands it out, so a key this page reads
 * is a key the gateway sends. `withdrawnBy` is an account id and NOT a name;
 * `withdrawnByName` is the name, added 2026-09-06 (migration 20260906150000)
 * because until then the register could say when a statement was withdrawn and
 * why but not by whom in words. It is null on a withdrawal recorded before that
 * day, and the panel says so rather than printing an id as if it were a person.
 */
export interface PriceCodeStatementVM {
  id: string;
  restaurantId: string;
  distributorKey: string;
  codeField: string;
  priceCode: string;
  priceBasis: string;
  evidence: string;
  declaredBy: string;
  declaredByName: string;
  declaredAt: string;
  withdrawnBy: string | null;
  withdrawnByName: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
}

/**
 * Every statement this house holds for ONE sender, live and withdrawn.
 *
 * `readFailed` and `unreadable` are two different failures and both are kept:
 * the first is the GATEWAY saying it could not read the table (it answers 200
 * with words, never an empty list — `PriceCodeMappingsService.forSender`), the
 * second is this browser never reaching the gateway at all. Collapsing either
 * into an empty `rows` would render "we do not know" as "nothing is mapped",
 * and the second reads as a manager's own omission.
 */
export interface PriceCodeStatementsVM {
  distributorKey: string;
  rows: PriceCodeStatementVM[];
  conflicted: string[];
  live: number;
  withdrawn: number;
  readFailed: boolean;
  /** The gateway's own sentence about this register. Never invented here. */
  note: string;
  /** Set only when the request itself failed. Null when the read landed. */
  unreadable: string | null;
}

/** What `POST /distributor-feed/codes/:key` answers. It refuses with 200 and a
 *  sentence rather than a status code, so `ok` is the field that matters. */
export interface PriceCodeWriteVM {
  ok: boolean;
  mappingId: string | null;
  refusedBecause: string | null;
}

/** What the withdrawal answers. `rowsAdmitted` is `null`, never 0, when the
 *  prices that statement admitted could not be counted. */
export interface PriceCodeWithdrawVM extends PriceCodeWriteVM {
  rowsAdmitted: number | null;
  rowsAdmittedUnreadable: string | null;
  note: string;
}

export interface HouseGrantVM {
  connectionId: string;
  integrationId: string;
  provider: string;
  label: string;
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  account: string | null;
  scopes: string[];
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  houseAccess: {
    revoked: boolean;
    at: string | null;
    by: string | null;
    byName: string | null;
    reason: string | null;
  };
}

export interface CatalogEntryVM {
  id: string;
  provider: string;
  label: string;
  providerLabel: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  /**
   * The integration's OWN scope disclosure and its "never asked for" list,
   * straight off `INTEGRATION_DEFINITIONS` (`integrations-oauth.controller.ts:69-70`).
   * The page's permission bullets are built from these and from nothing else,
   * so one integration cannot print another's promise (`cx-permissions.ts`).
   * Optional because a gateway that predates them sends neither, and an absent
   * disclosure must render as the em dash rather than as a guess.
   */
  scopes?: Array<{ scope: string; label: string; reason?: string }> | null;
  notRequested?: string[] | null;
}

/** A query as this page consumes it: never "empty" when it means "unread". */
export interface Register<T> {
  data: T | null;
  loading: boolean;
  /** The gateway's own words, or null. Never a sentence this file invented. */
  error: string | null;
  /** 403 specifically: the read was refused because of who is asking. */
  refused: boolean;
}

interface AxiosLikeError {
  response?: { status?: number; data?: { message?: string | string[] } };
  message?: string;
}

function isRefusal(e: unknown): boolean {
  return (e as AxiosLikeError)?.response?.status === 403;
}

function toRegister<T>(q: {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
}): Register<T> {
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? readError(q.error) : null,
    refused: q.error ? isRefusal(q.error) : false,
  };
}

/* ── the hook ─────────────────────────────────────────────────────────── */

export function useConnectionsNextData() {
  const auth = useContext(AuthContext);
  const qc = useQueryClient();
  const rid = auth?.activeRestaurantId ?? null;
  const uid = (auth?.user as { user_id?: string; id?: string } | undefined)?.user_id
    ?? (auth?.user as { id?: string } | undefined)?.id
    ?? null;
  const role = (auth?.user as { role?: string } | undefined)?.role ?? null;
  const isManager = role === 'owner' || role === 'manager';

  const on = Boolean(rid) && isManager;

  /* read 1 — the till. `unavailable` is the field that stops a dead read
     reading as a quiet integration (ADR 0067, pos-hub.service.ts:1230). */
  const posQ = useQuery({
    queryKey: ['connections-next-pos', rid],
    queryFn: async (): Promise<PosStatusVM> => {
      const { data } = await apiClient.get<PosStatusVM>(`/pos-hub/status/${rid}`);
      return data;
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 2 — the payment provider, and what is on file behind it. */
  const providerQ = useQuery({
    queryKey: ['connections-next-provider', rid],
    queryFn: async (): Promise<ProviderStateVM> => {
      const { data } = await apiClient.get<ProviderStateVM>('/billing/provider');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  const paymentsQ = useQuery({
    queryKey: ['connections-next-payments', rid],
    queryFn: async (): Promise<{ provider: ProviderStateVM; methods: PaymentMethodVM[] }> => {
      const { data } = await apiClient.get<{
        provider: ProviderStateVM;
        methods: PaymentMethodVM[];
      }>('/payment-methods');
      return { provider: data.provider, methods: data.methods ?? [] };
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 3 — the address the letters leave from. */
  const senderQ = useQuery({
    queryKey: ['connections-next-sender', rid],
    queryFn: async (): Promise<SenderIdentityVM> => {
      const { data } = await apiClient.get<SenderIdentityVM>(
        '/communications/sender-identity',
      );
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 3b — the TEXT senders, and what each registrar would require.
     A separate request from the mail sender on purpose: ADR 0114 rejected one
     `/connections/ledger` endpoint because it has exactly two answers, the
     whole page or a 500 — so a WhatsApp read failing must not blank the row
     that says which address the letters leave from. */
  const textQ = useQuery({
    queryKey: ['connections-next-text-senders', rid],
    queryFn: async (): Promise<TextSendersVM> => {
      const { data } = await apiClient.get<TextSendersVM>(
        '/communications/text-senders',
      );
      return data;
    },
    enabled: on,
    staleTime: 120_000,
  });

  /* read 4 — the calendar feed. Provisioned on read by the gateway, which is
     why this is a GET that can create: the token exists so the row can name
     it, and naming a feed that does not exist yet would be worse. */
  const icalQ = useQuery({
    queryKey: ['connections-next-ical', rid],
    queryFn: async (): Promise<{ token: string }> => {
      const { data } = await apiClient.get<{ token: string }>('/calendar/ical-token');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 5 — model-context servers, and what this deployment can do with one. */
  const mcpQ = useQuery({
    queryKey: ['connections-next-mcp', rid, uid],
    queryFn: async (): Promise<McpServerVM[]> => {
      const { data } = await apiClient.get<McpServerVM[]>('/mcp-connections');
      return Array.isArray(data) ? data : [];
    },
    enabled: on,
    staleTime: 30_000,
  });

  const mcpRuntimeQ = useQuery({
    queryKey: ['connections-next-mcp-runtime', rid],
    queryFn: async (): Promise<McpRuntimeVM> => {
      const { data } = await apiClient.get<McpRuntimeVM>('/mcp-connections/runtime');
      return data;
    },
    enabled: on,
    staleTime: 300_000,
  });

  /* read 6 — every personal grant recorded against this house.
     `unattributed` is carried through deliberately: a live grant with no
     recorded restaurant belongs to someone who works here and is on nobody's
     house page, and a list that dropped it silently would be incomplete in
     exactly the way this surface exists to prevent. */
  const houseGrantsQ = useQuery({
    queryKey: ['connections-next-house-grants', rid],
    queryFn: async (): Promise<{ grants: HouseGrantVM[]; unattributed: number }> => {
      const { data } = await apiClient.get<{
        grants: HouseGrantVM[];
        unattributed: number;
      }>('/integrations/oauth/house-grants');
      return { grants: data.grants ?? [], unattributed: data.unattributed ?? 0 };
    },
    enabled: on,
    staleTime: 60_000,
  });

  /* read 7 — the shared catalogue (G20: the SAME route the other three
     surfaces read, not a fourth copy). */
  const catalogQ = useQuery({
    queryKey: ['connections-next-catalog', rid],
    queryFn: async (): Promise<CatalogEntryVM[]> => {
      const { data } = await apiClient.get<{ integrations: CatalogEntryVM[] }>(
        '/integrations/oauth/catalog',
      );
      return data.integrations ?? [];
    },
    enabled: on,
    staleTime: 600_000,
  });

  /* read 8 — the house's own mail archive (ADR 0118 D16). Read on its own
     rather than folded into the grants read: the archive is a fact about the
     HOUSE, and the grant it writes through may be revoked, deleted or belong to
     somebody who has left. `owner.keptIn` arrives composed. */
  const archiveQ = useQuery({
    queryKey: ['connections-next-mail-archive', rid],
    queryFn: async (): Promise<ArchiveVM> => {
      const { data } = await apiClient.get<{ archive: ArchiveVM }>(
        '/communications/archive',
      )
      return data.archive
    },
    enabled: on,
    staleTime: 60_000,
  })

  /* read 9 — the distributors measured for THIS house's own state (ADR 0126).
     `/me` rather than `/catalog`: the register holds entries for jurisdictions
     this house is not in, and a list of Illinois distributors under a Michigan
     house's address would be a page inventing a market. The gateway resolves
     the state from `restaurants` and reports a FAILED read as a failure, which
     arrives here in `silence`. */
  const distributorsQ = useQuery({
    queryKey: ['connections-next-distributors', rid],
    queryFn: async (): Promise<DistributorCatalogueVM> => {
      const { data } = await apiClient.get<DistributorCatalogueVM>(
        '/distributor-feed/me',
      );
      return data;
    },
    enabled: on,
    staleTime: 600_000,
  });

  /* read 10 — the invoice-feed letter the house signs. A constant on the
     gateway, read rather than copied into this bundle so the text a house
     downloads and the text `07-reference/DISTRIBUTOR-INVOICE-FEED-LETTER.md`
     records cannot drift apart in a place nobody is testing. */
  const letterQ = useQuery({
    queryKey: ['connections-next-feed-letter'],
    queryFn: async (): Promise<FeedLetterVM> => {
      const { data } = await apiClient.get<{ letter: FeedLetterVM }>(
        '/distributor-feed/letter',
      );
      return data.letter;
    },
    enabled: on,
    staleTime: 3_600_000,
  });

  /* read 11 — what this house has said each sender's price codes mean
     (ADR 0126 §7, the founder's batch-59 call: "Build it on /connections in
     the distributor row").

     ONE QUERY OVER MANY SENDERS, AND EACH SENDER FAILS ALONE. The route is
     per distributor (`GET /distributor-feed/codes/:key`), so a query per row
     would be the obvious build; it is not the one here, because the number of
     rows is whatever the register measured and a hook cannot call `useQuery` a
     variable number of times. What it does instead keeps the property that
     matters: every sender is fetched in its own request inside one queryFn and
     its own failure is caught and NAMED against that sender, so one distributor
     being unreadable never blanks another's statements and never renders as
     "this house has mapped nothing". */
  const distributorKeys = useMemo(
    () => (distributorsQ.data?.distributors ?? []).map((d) => d.key).sort(),
    [distributorsQ.data],
  );

  const priceCodesQ = useQuery({
    queryKey: ['connections-next-price-codes', rid, distributorKeys.join('|')],
    queryFn: async (): Promise<Record<string, PriceCodeStatementsVM>> => {
      const pairs = await Promise.all(
        distributorKeys.map(
          async (key): Promise<[string, PriceCodeStatementsVM]> => {
            try {
              const { data } = await apiClient.get<{
                rows?: PriceCodeStatementVM[];
                conflicted?: string[];
                live?: number;
                withdrawn?: number;
                readFailed?: boolean;
                note?: string;
              }>(`/distributor-feed/codes/${encodeURIComponent(key)}`);
              return [
                key,
                {
                  distributorKey: key,
                  rows: data.rows ?? [],
                  conflicted: data.conflicted ?? [],
                  live: data.live ?? 0,
                  withdrawn: data.withdrawn ?? 0,
                  readFailed: data.readFailed === true,
                  note: data.note ?? '',
                  unreadable: null,
                },
              ];
            } catch (e) {
              return [
                key,
                {
                  distributorKey: key,
                  rows: [],
                  conflicted: [],
                  live: 0,
                  withdrawn: 0,
                  readFailed: true,
                  note: '',
                  unreadable: readError(e),
                },
              ];
            }
          },
        ),
      );
      return Object.fromEntries(pairs);
    },
    enabled: on && distributorKeys.length > 0,
    staleTime: 60_000,
  });

  /* ── writes ─────────────────────────────────────────────────────────── */

  const invalidate = useCallback(
    (key: string) => {
      void qc.invalidateQueries({ queryKey: [key, rid] });
      void qc.invalidateQueries({ queryKey: [key, rid, uid] });
    },
    [qc, rid, uid],
  );

  /**
   * Re-read the model-context register.
   *
   * Added by the collapse (2026-09-04) for `HouseServerControls`, which owns
   * declare and revoke since they left `/profile`. It is exposed rather than
   * given a mutation of its own so that component keeps NO react-query
   * dependency: it is a panel that can be lifted out whole the day the
   * ownership fork in ADR 0114 is answered, and a component holding a
   * `useQueryClient` cannot be rendered by a test that mocks this hook.
   */
  const refetchMcp = useCallback(() => {
    invalidate('connections-next-mcp');
    invalidate('connections-next-mcp-runtime');
  }, [invalidate]);

  const regenerateFeed = useMutation({
    mutationFn: async () => {
      await apiClient.post('/calendar/ical-token/regenerate');
    },
    onSuccess: () => invalidate('connections-next-ical'),
  });

  /**
   * Hand over a file the house already has (ADR 0126, batch 56).
   *
   * It posts to `/procurement/documents` — the SAME door every invoice goes
   * through, not a door of this page's own. That is the decision, not an
   * accident of routing: a second upload endpoint would be a second place for
   * a document to be stored, deduplicated and provenanced, and the two would
   * drift. An 810 is read as an invoice by the door itself; an 832 is stored
   * as a price list and its lines are priced only under the code meanings this
   * house has stated, which is what the `catalog` half of the answer reports.
   */
  const uploadDistributorFile = useMutation({
    mutationFn: async (v: {
      contentBase64: string;
      filename: string;
      distributorKey?: string | null;
      declaredCurrency?: string | null;
    }): Promise<{
      documentId: string | null;
      duplicate: boolean;
      document: { docType?: string; warnings?: string[] } | null;
      catalog?: CatalogueAdmissionVM;
    }> => {
      const { data } = await apiClient.post('/procurement/documents', {
        contentBase64: v.contentBase64,
        filename: v.filename,
        source: 'upload',
        ...(v.distributorKey ? { distributorKey: v.distributorKey } : {}),
        ...(v.declaredCurrency ? { declaredCurrency: v.declaredCurrency } : {}),
      });
      return data;
    },
  });

  /**
   * A manager states what one of a sender's price codes means (ADR 0126 §7).
   *
   * The name on the statement is NOT sent from here and must not be: the
   * gateway takes it from the session's own token, so a browser cannot sign a
   * colleague's name to an attestation. If the token resolves no name at all
   * the write is refused rather than written unsigned, and that refusal comes
   * back in `refusedBecause` like every other.
   *
   * A refusal is HTTP 200 with `ok: false` — the controller returns the
   * service's outcome rather than throwing — so this never rejects on a refusal
   * and the caller must read `ok`. That is why the mutation returns the body.
   */
  const declarePriceCode = useMutation({
    mutationFn: async (v: {
      distributorKey: string;
      priceCode: string;
      priceBasis: string;
      evidence: string;
    }): Promise<PriceCodeWriteVM> => {
      const { data } = await apiClient.post<PriceCodeWriteVM>(
        `/distributor-feed/codes/${encodeURIComponent(v.distributorKey)}`,
        {
          priceCode: v.priceCode,
          priceBasis: v.priceBasis,
          evidence: v.evidence,
        },
      );
      return data;
    },
    onSuccess: () => invalidate('connections-next-price-codes'),
  });

  /**
   * A manager withdraws one. It MARKS and never deletes: the rows that
   * statement admitted keep pointing at it (`ON DELETE RESTRICT`), and the
   * count of them comes back with the answer — `null`, never 0, when it could
   * not be counted.
   */
  const withdrawPriceCode = useMutation({
    mutationFn: async (v: {
      distributorKey: string;
      mappingId: string;
      reason: string;
    }): Promise<PriceCodeWithdrawVM> => {
      const { data } = await apiClient.post<PriceCodeWithdrawVM>(
        `/distributor-feed/codes/${encodeURIComponent(
          v.distributorKey,
        )}/${encodeURIComponent(v.mappingId)}/withdraw`,
        { reason: v.reason },
      );
      return data;
    },
    onSuccess: () => invalidate('connections-next-price-codes'),
  });

  const setHouseGrantAccess = useMutation({
    mutationFn: async (v: { connectionId: string; houseUses: boolean; reason?: string }) => {
      await apiClient.put(
        `/integrations/oauth/house-grants/${v.connectionId}/access`,
        { houseUses: v.houseUses, reason: v.reason ?? null },
      );
    },
    onSuccess: () => invalidate('connections-next-house-grants'),
  });

  const setConsent = useMutation({
    mutationFn: async (v: { id: string; given: boolean }) => {
      await apiClient.put(`/mcp-connections/${v.id}/consent`, { given: v.given });
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /**
   * Grant a tool, or re-consent to one whose declaration moved.
   *
   * `sealed` is not a second route. Re-consenting IS granting again — against
   * the declaration the server offers NOW — and a separate endpoint would have
   * been a second place for the classification rule to be applied slightly
   * differently. The gateway decides whether the seal was required; the page
   * sends it when it is re-consenting, which is the only case where it is.
   */
  /**
   * Ask the gateway for the one-time seal, at the moment the hold BEGINS.
   *
   * Not a mutation: it changes nothing the page renders, and a `useMutation`
   * here would put a pending flag on a request whose only visible effect is
   * that the gesture completes. It returns null on failure rather than
   * throwing, because `HoldToApprove` reads null as "do not approve" and says
   * so — a rejected promise there would surface as an unhandled error while
   * the operator was still holding the button.
   */
  const grantSeal = useCallback(
    async (v: { id: string; tool: string; writes: boolean }): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge: string }>(
          `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}/grant-seal`,
          { writes: v.writes },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const grantTool = useMutation({
    mutationFn: async (v: {
      id: string;
      tool: string;
      writes: boolean;
      /**
       * The redeemed-once seal from `grantSeal`. There is no `sealed` boolean
       * to send any more: the gateway derives whether a grant was sealed by
       * redeeming this token, and a client that could assert it was the flaw
       * the seal exists to close (audit, 2026-09-04).
       */
      challenge?: string;
    }) => {
      await apiClient.put(
        `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}`,
        { writes: v.writes, challenge: v.challenge },
      );
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /* ── the payment register's two writes, both sealed ───────────────────
   *
   * G-C9, half-closed (2026-09-04). The collapse moved Register II here and
   * left both controls disabled, because the client that performs them stayed
   * behind on `/profile`. They are here now — and they arrive already sealed,
   * because ADR 0110's addendum made `PATCH /payment-methods/:id/default` and
   * `DELETE /payment-methods/:id` REDEEM a one-time token rather than trust the
   * role alone. Adding a card is still not here: that needs Stripe's own card
   * fields, which is a panel and not a request (see the row's stop note).
   */

  /**
   * Mint the seal, when the hold BEGINS.
   *
   * Not a mutation, for the same reason `grantSeal` is not: it changes nothing
   * the page renders. It returns null instead of throwing because
   * `HoldToApprove` reads null as "do not approve" and says so on the control.
   */
  const paymentSeal = useCallback(
    async (v: {
      act: 'set_default' | 'remove';
      methodId: string;
    }): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge?: string }>(
          '/payment-methods/seal-challenge',
          { act: v.act, methodId: v.methodId },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * The same mint, for the act that has no instrument.
   *
   * `create` approves putting ONE instrument on this house's register, so its
   * subject is the register and no `methodId` is sent. It is a separate member
   * from `paymentSeal` above only because `CardPanelClient` asks for the
   * positional shape and the row controls already use the object one; both call
   * the same route.
   */
  const mintPaymentSeal = useCallback(
    async (act: 'create'): Promise<string | null> => {
      try {
        const { data } = await apiClient.post<{ challenge?: string }>(
          '/payment-methods/seal-challenge',
          { act },
        );
        return data?.challenge ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * The seal travels in a HEADER on both writes — it is not one of the
   * arguments it is a seal over, and `DELETE` carries no body here at all.
   * `payment-methods.controller.ts` reads `x-seal-challenge` on both.
   */
  const setDefaultPayment = useMutation({
    mutationFn: async (v: { methodId: string; challenge?: string | null }) => {
      await apiClient.patch(
        `/payment-methods/${v.methodId}/default`,
        {},
        v.challenge ? { headers: { 'X-Seal-Challenge': v.challenge } } : undefined,
      );
    },
    onSuccess: () => invalidate('connections-next-payments'),
  });

  const removePayment = useMutation({
    mutationFn: async (v: { methodId: string; challenge?: string | null }) => {
      await apiClient.delete(
        `/payment-methods/${v.methodId}`,
        v.challenge ? { headers: { 'X-Seal-Challenge': v.challenge } } : undefined,
      );
    },
    onSuccess: () => invalidate('connections-next-payments'),
  });

  /* ── adding a card: the two routes the panel actually walks ───────────
   *
   * G-C9's other half, closed 2026-09-05 ("port the card panel to /connections
   * now"). `StripeCardPanel` is shared with `/profile` and asks a page for
   * exactly these two functions (`CardPanelClient`), so this hook grows the two
   * members rather than the page growing a second copy of the panel.
   *
   * BOTH OF THESE NOW CARRY THE SEAL (G-PAY-SETUP closed, 2026-09-05).
   * `POST /billing/setup-intent` REDEEMS a `create` seal before it asks the
   * provider for anything and stamps the spent seal's id onto the intent;
   * `POST /billing/sync` names that intent and has the provider prove the id
   * back. So the pairing cannot be authored in this browser: the panel mints at
   * the hold that OPENS the form, because the client secret is the capability
   * and it exists the moment the form opens.
   */

  /**
   * Permission to STORE an instrument, not a payment.
   *
   * The client secret authorises Stripe.js to attach ONE instrument to ONE
   * customer; it cannot charge, list or read. `POST /billing/setup-intent`
   * answers 503 with the provider's own sentence while `STRIPE_SECRET_KEY` is
   * unset — which is this deployment's state — so the panel's failure text is
   * the server's, never page prose.
   */
  const createSetupIntent = useCallback(async (
    challenge: string,
  ): Promise<{
    clientSecret: string;
    setupIntentId: string;
    livemode: boolean;
  }> => {
    // A refused mint answers 403 with a whole sentence naming the check that
    // failed. Axios hides it in `response.data.message`, so it is lifted here:
    // the panel prints `.message`, and a status code is not an explanation.
    let data: {
      clientSecret?: string;
      setupIntentId: string;
      livemode: boolean;
    } | undefined;
    try {
      ({ data } = await apiClient.post<{
        clientSecret: string;
        setupIntentId: string;
        livemode: boolean;
      }>(
        '/billing/setup-intent',
        {},
        // The seal travels in a HEADER, never in the body: it is not one of the
        // arguments it is a seal over. The gateway reads `x-seal-challenge` and
        // REDEEMS before it asks the provider for anything
        // (`billing.controller.ts`, `setupIntent`).
        { headers: { 'X-Seal-Challenge': challenge } },
      ));
    } catch (e) {
      throw new Error(readError(e));
    }
    if (!data?.clientSecret) {
      throw new Error(
        'The provider answered without a client secret, so the card form cannot open. Nothing was stored.',
      );
    }
    return {
      clientSecret: data.clientSecret,
      setupIntentId: data.setupIntentId,
      livemode: data.livemode,
    };
  }, []);

  /**
   * Reconcile the register against the provider's list.
   *
   * Called right after a confirmation so the row appears without waiting for a
   * webhook. It DROPS instruments the provider no longer has — a sync that only
   * inserted would leave the register showing a card that cannot be charged.
   *
   * The refetch is awaited, not merely invalidated: the panel prints the count
   * the sync returned and the register beside it must already agree, or the two
   * would state different numbers of instruments in the same eyeful.
   */
  const syncPayments = useCallback(async (
    setupIntentId?: string,
  ): Promise<{
    syncedAt: string;
    kept: number;
    removed: number;
    note: string | null;
    provenance: 'sealed-intent' | 'reconcile-only';
  }> => {
    const { data } = await apiClient.post<{
      syncedAt: string;
      kept: number;
      removed: number;
      note: string | null;
      provenance: 'sealed-intent' | 'reconcile-only';
      // Naming the intent is what lets the gateway read the spent seal's id
      // back FROM STRIPE and prove this person opened that card form. Omitting
      // it is the register's plain refresh, and `provenance` says which ran.
    }>('/billing/sync', setupIntentId ? { setupIntentId } : {});
    await paymentsQ.refetch();
    return data;
  }, [paymentsQ]);

  const revokeTool = useMutation({
    mutationFn: async (v: { id: string; tool: string }) => {
      await apiClient.delete(
        `/mcp-connections/${v.id}/tools/${encodeURIComponent(v.tool)}`,
      );
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  const probeServer = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/mcp-connections/${id}/probe`);
    },
    onSuccess: () => invalidate('connections-next-mcp'),
  });

  /* ── the ledger sentence's own arithmetic ───────────────────────────── */

  const tally = useMemo(() => {
    const mcp = mcpQ.data ?? [];
    const grants = houseGrantsQ.data?.grants ?? [];
    const liveMcp = mcp.filter((s) => s.status === 'active');

    /**
     * Every count is `null` when the register behind it could not be read.
     * A zero here would be the page's own headline lying — "nothing can act"
     * is the most reassuring sentence on the surface and the one that must
     * never be produced by a failed request.
     */
    const houseCount =
      posQ.error || providerQ.error || senderQ.error || icalQ.error || mcpQ.error
        ? null
        : [
            (posQ.data?.totalChecks ?? 0) > 0 ? 1 : 0,
            providerQ.data?.connected ? 1 : 0,
            senderQ.data?.address ? 1 : 0,
            icalQ.data?.token ? 1 : 0,
            liveMcp.length,
          ].reduce((a, b) => a + b, 0);

    return {
      house: houseCount,
      persons: houseGrantsQ.error ? null : grants.length,
      /** How many can spend. Zero is MEASURED here, not assumed. */
      canSpend:
        providerQ.error || paymentsQ.error
          ? null
          : providerQ.data?.connected
            ? (paymentsQ.data?.methods.length ?? 0)
            : 0,
      /** How many may call a tool: live grants across live servers. */
      mayCallATool: mcpQ.error
        ? null
        : liveMcp.reduce((n, s) => n + s.toolGrants.length, 0),
      /** Of those, how many can change the world outside this app. */
      mayWrite: mcpQ.error
        ? null
        : liveMcp.reduce(
            (n, s) => n + s.toolGrants.filter((g) => g.writes).length,
            0,
          ),
      publicToAnyone: icalQ.error ? null : icalQ.data?.token ? 1 : 0,
      houseHasLetGoOf: houseGrantsQ.error
        ? null
        : grants.filter((g) => g.houseAccess.revoked).length,
    };
  }, [
    posQ.data, posQ.error,
    providerQ.data, providerQ.error,
    paymentsQ.data, paymentsQ.error,
    senderQ.data, senderQ.error,
    icalQ.data, icalQ.error,
    mcpQ.data, mcpQ.error,
    houseGrantsQ.data, houseGrantsQ.error,
  ]);

  return {
    restaurantId: rid,
    userId: uid,
    role,
    isManager,
    pos: toRegister(posQ),
    provider: toRegister(providerQ),
    payments: toRegister(paymentsQ),
    sender: toRegister(senderQ),
    textSenders: toRegister(textQ),
    /**
     * Re-read the text-sender register after a manager stops a sender.
     * Exposed as its own function rather than added to every `Register` because
     * this is the only row on the page with a write behind it, and a `reload`
     * on all fourteen would suggest thirteen more that do nothing.
     */
    reloadTextSenders: () =>
      void qc.invalidateQueries({ queryKey: ['connections-next-text-senders'] }),
    ical: toRegister(icalQ),
    mcp: toRegister(mcpQ),
    mcpRuntime: toRegister(mcpRuntimeQ),
    houseGrants: toRegister(houseGrantsQ),
    catalog: toRegister(catalogQ),
    mailArchive: toRegister(archiveQ),
    distributors: toRegister(distributorsQ),
    feedLetter: toRegister(letterQ),
    priceCodes: toRegister(priceCodesQ),
    /**
     * The name this session carries, shown beside the statement form so a
     * manager sees whose name is going on the attestation before they make it.
     * It is NOT what gets written — the gateway takes the name off the token —
     * and the panel says so, because a page that displayed one name while the
     * server recorded another would be the worst possible version of this.
     */
    sessionName:
      (auth?.user as { name?: string; email?: string } | undefined)?.name?.trim() ||
      (auth?.user as { email?: string } | undefined)?.email?.trim() ||
      null,
    tally,
    regenerateFeed,
    uploadDistributorFile,
    declarePriceCode,
    withdrawPriceCode,
    setHouseGrantAccess,
    setConsent,
    grantSeal,
    grantTool,
    revokeTool,
    probeServer,
    paymentSeal,
    setDefaultPayment,
    removePayment,
    /* `CardPanelClient` — the three members `StripeCardPanel` asks a page for. */
    mintPaymentSeal,
    createSetupIntent,
    syncPayments,
    /**
     * The BROWSER's half of the Stripe credential, read here rather than asked
     * of the gateway: `VITE_STRIPE_PUBLISHABLE_KEY` is baked into this bundle at
     * build time and the gateway has no view of the bundle that is running, so a
     * server-reported value would be a guess. Null renders as a named missing
     * variable, never as a generic "not configured".
     */
    stripePublishableKey: stripePublishableKey(),
    refetchMcp,
  };
}

export type ConnectionsNextData = ReturnType<typeof useConnectionsNextData>;
