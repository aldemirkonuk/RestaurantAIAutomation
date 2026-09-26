import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../services/api/client";
import { queryKeys } from "../../lib/query-keys";
import { useAuth } from "../../contexts/AuthContext";

export const draftKeys = {
  all: ["drafts"] as const,
  pending: (restaurantId: string) =>
    [...draftKeys.all, "pending", restaurantId] as const,
  byOrder: (orderId: string) => [...draftKeys.all, "order", orderId] as const,
};

export const activeConversationKeys = {
  all: ["conversations", "active"] as const,
  list: (restaurantId: string) =>
    [...activeConversationKeys.all, restaurantId] as const,
};

export interface ActiveConversationDto {
  id: string;
  orderId: string;
  providerId: string;
  emailType: string;
  roundCount: number;
  createdAt: string;
  constraintFlags: any;
  draftContent: string | null;
  orderNumber: string | null;
  quantity: number | null;
  quotedPrice: number | null;
  wineName: string | null;
  providerName: string | null;
  providerEmail: string | null;
  /** What the gateway will actually put in the subject line if this is sent (lane E audit D5). */
  subject: string;
  /** A staff member's request on this draft, or null (founder, 2026-09-21). */
  sendRequest?: SendRequestDto | null;
}

/**
 * A staff member's hold on a letter, recorded as a request a manager releases
 * (founder, 2026-09-21: "Staff ask, manager sends").
 */
export interface SendRequestDto {
  requestedBy: string | null;
  /** null when the name could not be read — the page says so; the request stays. */
  requestedByName: string | null;
  requestedAt: string;
  /** false once the letter's words changed after the request (an edit, a regenerate). */
  current: boolean;
  ccEmails: string[];
}

/**
 * Whether THIS viewer's hold sends the letter or asks a manager to — the
 * `mayApprove` twin the gateway returns beside the draft (`GET orders/:id/draft`,
 * `VendorSendAuthorityService.readout`). `readable: false` is an error the page
 * shows; it is never "ask" and never "send".
 */
export interface SendOrAskDto {
  readable: boolean;
  maySend: boolean;
  mode: "send" | "ask" | null;
  basis: "owner" | "manager" | "grant" | null;
  grant: {
    id: string;
    grantedBy: { userId: string; name: string | null };
    expiresAt: string | null;
    limitAmount: number | null;
    limitCurrency: string | null;
  } | null;
  sentence: string | null;
}

/** The draft readout's own request shape (snake case, like the rest of that object). */
export interface DraftSendRequestView {
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  current: boolean;
  ccEmails: string[];
}

export interface DraftStandingDto {
  draft: ({ id: string; content: string | null; send_request: DraftSendRequestView | null } & Record<string, unknown>) | null;
  sendOrAsk: SendOrAskDto;
}

export const draftStandingKeys = {
  byOrder: (orderId: string) => [...draftKeys.all, "standing", orderId] as const,
};

/**
 * The pending draft AND whether this viewer's hold sends or asks — one read,
 * so a panel never shows "hold to send" to a person whose hold would ask.
 */
export function useDraftStanding(orderId: string | null) {
  return useQuery({
    queryKey: draftStandingKeys.byOrder(orderId ?? ""),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/draft`)
        .then((r) => r.data as DraftStandingDto),
    enabled: !!orderId,
    staleTime: 10_000,
  });
}

/**
 * A staff member's hold: the letter becomes a request (founder, 2026-09-21).
 * Nothing is sent and no seal is spent; the gateway saves these exact words as
 * the version, records who asked and rings the owners' and managers' bells.
 */
export async function requestDraftSend(input: {
  orderId: string;
  content: string;
  ccEmails?: string[];
}): Promise<{ conversationId: string; requestedAt: string; told: number; says: string }> {
  const { data } = await apiClient.post(
    `/procurement/orders/${input.orderId}/draft-send-request`,
    { content: input.content, ccEmails: input.ccEmails ?? [] },
  );
  return data;
}

/**
 * A staff member's request that an owner or a manager send a letter or
 * confirm a deal (founder answer 3, 2026-09-21) — `vendor_send_requests`.
 * `payload` is exactly what was asked for: a deal's terms, or the whole letter.
 */
export interface VendorSendRequestDto {
  id: string;
  kind: "confirm_deal" | "house_letter";
  orderId: string | null;
  providerId: string | null;
  requestedBy: { userId: string | null; name: string | null };
  requestedAt: string;
  payload: Record<string, unknown>;
  state: "waiting" | "released" | "closed";
  releasedBy: { userId: string | null; name: string | null } | null;
  releasedAt: string | null;
  releasedAsWritten: boolean | null;
  conversationId: string | null;
}

/** The deal request waiting on an order, and whether this person's hold confirms or asks. */
export interface DealRequestReadoutDto {
  request: VendorSendRequestDto | null;
  standing: SendOrAskDto;
}

export const dealRequestKeys = {
  byOrder: (orderId: string) => ["deal-request", orderId] as const,
};

/**
 * Read BEFORE the hold, like the draft's standing: a deal's standing is read
 * with the deal's own money, so a grantee whose limit does not cover it is told
 * their hold will ask (ADR 0175 D10; founder answer 3).
 */
export function useDealRequest(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: dealRequestKeys.byOrder(orderId ?? ""),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/deal-request`)
        .then((r) => r.data as DealRequestReadoutDto),
    enabled: !!orderId && enabled,
    staleTime: 10_000,
  });
}

/** A staff member asks an owner or a manager to confirm the deal on these terms. Nothing is committed. */
export async function requestConfirmDeal(input: {
  orderId: string;
  finalPrice: number;
  quantity: number;
  sendConfirmation?: boolean;
}): Promise<{ requestId: string; requestedAt: string; told: number; says: string }> {
  const { data } = await apiClient.post(`/procurement/orders/${input.orderId}/confirm-deal-request`, {
    finalPrice: input.finalPrice,
    quantity: input.quantity,
    sendConfirmation: input.sendConfirmation !== false,
  });
  return data;
}

/** Mint the seal a hand-written reply must carry back (ADR 0175 D9, 2026-09-21). */
export async function issueManualReplyChallenge(input: {
  orderId: string;
  content: string;
  ccEmails?: string[];
}): Promise<string | null> {
  const { data } = await apiClient.post<{ challenge?: string }>(
    `/procurement/orders/${input.orderId}/manual-reply-seal-challenge`,
    { content: input.content, ccEmails: input.ccEmails ?? [] },
  );
  return data?.challenge ?? null;
}

/** Mint the seal a deal confirmation must carry back (ADR 0175 D9, 2026-09-21). */
export async function issueConfirmDealChallenge(input: {
  orderId: string;
  finalPrice?: number;
  quantity?: number;
  sendConfirmation?: boolean;
}): Promise<string | null> {
  const { data } = await apiClient.post<{ challenge?: string }>(
    `/procurement/orders/${input.orderId}/confirm-deal-seal-challenge`,
    {
      finalPrice: input.finalPrice,
      quantity: input.quantity,
      sendConfirmation: input.sendConfirmation,
    },
  );
  return data?.challenge ?? null;
}

export function useActiveConversations() {
  const { user, activeRestaurantId, isAuthenticated } = useAuth();
  // Prefer the runtime-updated activeRestaurantId over the JWT-origin user.restaurantId.
  // user.restaurantId becomes stale after a restaurant switch; activeRestaurantId always
  // reflects the current selection and is what the X-Restaurant-Id header sends.
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? "";
  return useQuery({
    queryKey: activeConversationKeys.list(restaurantId),
    queryFn: () =>
      apiClient
        .get("/procurement/conversations/active")
        .then((r) => r.data as ActiveConversationDto[]),
    enabled: !!restaurantId && isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useGetPendingDraft(orderId: string | null) {
  return useQuery({
    queryKey: draftKeys.byOrder(orderId ?? ""),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/draft`)
        .then((r) => r.data?.draft ?? r.data ?? null),
    enabled: !!orderId,
  });
}

export async function issueDraftSendChallenge(input: {
  orderId: string;
  body: string;
  to: string | null;
  ccEmails?: string[];
}): Promise<string | null> {
  const { data } = await apiClient.post<{ challenge?: string }>(
    `/procurement/orders/${input.orderId}/draft-seal-challenge`,
    { content: input.body, to: input.to, ccEmails: input.ccEmails ?? [] },
  );
  return data?.challenge ?? null;
}

export function useApproveDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      modifiedContent,
      managerNotes,
      ccEmails,
      challenge,
    }: {
      orderId: string;
      modifiedContent?: string;
      managerNotes?: string;
      ccEmails?: string[];
      challenge: string;
    }) =>
      apiClient
        .post(
          `/procurement/orders/${orderId}/approve-draft`,
          { modifiedContent, managerNotes, ccEmails },
          { headers: { "X-Seal-Challenge": challenge } },
        )
        .then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.all });
    },
  });
}

/**
 * Trigger the autonomous responder on an order's latest inbound vendor reply.
 * The backend understands the reply and stages a one-tap-approve AI draft, then
 * resolves once the draft exists — so invalidating here surfaces it immediately.
 */
export function useGenerateAiReply() {
  const queryClient = useQueryClient();
  return useMutation({
    // Accepts a bare orderId, or { orderId, force, instruction } for the P6 triage
    // escape hatches ("Reply anyway" forces past the reply gate; "Treat as offer"
    // adds an instruction). Normalized below so existing call sites keep working.
    mutationFn: (
      arg: string | { orderId: string; force?: boolean; instruction?: string },
    ) => {
      const { orderId, force, instruction } =
        typeof arg === "string"
          ? { orderId: arg, force: undefined, instruction: undefined }
          : arg;
      return apiClient
        .post(`/procurement/orders/${orderId}/generate-ai-reply`, {
          force,
          instruction,
        })
        .then(
          (r) =>
            r.data as {
              triggered: boolean;
              draftId?: string;
              needsApproval?: boolean;
              reason?: string;
            },
        );
    },
    onSettled: (_data, _error, arg) => {
      const orderId = typeof arg === "string" ? arg : arg.orderId;
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(orderId),
      });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
    },
  });
}

export function useDiscardDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/discard-draft`)
        .then((r) => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
    },
  });
}

export interface OrderConversationDto {
  id: string;
  orderId: string;
  status: string;
  /**
   * Why the gateway's own send closed this draft before anything left
   * (status SEND_REFUSED; founder answer 6, 2026-09-21). null otherwise.
   */
  refusalReason?: string | null;
  direction: "OUTBOUND" | "INBOUND";
  emailType: string;
  roundCount: number;
  createdAt: string;
  sentAt: string | null;
  scheduledSendAt?: string | null;
  draftContent: string | null;
  rollingSummary: string | null;
  constraintFlags?: any;
  detectedIntent?: string | null;
  detectedSentiment?: string | null;
  aiGenerated?: boolean | null;
  specialConditions?: string[];
  /**
   * Provenance for `rollingSummary`: which engine read this answer, and when.
   *
   * `conversation_context.model` / `.analyzed_at`, written beside the summary by
   * the understand step. Null on outbound rows and on inbound rows written
   * before the field existed — UNKNOWN, never "the house wrote it".
   */
  summaryModel?: string | null;
  summaryAnalyzedAt?: string | null;
  /** Triage classification for an inbound row (P6). Null on outbound / pre-triage rows. */
  classification?: {
    email_class?: string | null;
    is_automated?: boolean | null;
    requires_reply?: boolean | null;
    injection_suspected?: boolean | null;
    confidence?: number | null;
    transport?: Record<string, any> | null;
  } | null;
  orderNumber: string | null;
  quantity: number | null;
  quotedPrice: number | null;
  orderStatus?: string | null;
  aiPaused?: boolean;
  wineName: string | null;
  providerName: string | null;
  providerEmail: string | null;
  /** Latest inbound sender authentication (DKIM/DMARC); null when unknown / pre-Phase-0. */
  senderVerified?: boolean | null;
  /** Who sent this outbound letter; null on rows sent before 2026-09-21 (not recorded). */
  sentBy?: string | null;
  sentByName?: string | null;
  /** True when the sender sent under an owner's grant rather than their own role. */
  sentUnderGrant?: boolean;
  /** The staff member who asked for this letter to be sent, if one did. */
  requestedBy?: string | null;
  requestedByName?: string | null;
}

export const orderConversationKeys = {
  all: ["conversations", "order"] as const,
  byOrder: (orderId: string) =>
    [...orderConversationKeys.all, orderId] as const,
};

export function useOrderConversations(orderId: string | null) {
  return useQuery({
    queryKey: orderConversationKeys.byOrder(orderId ?? ""),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/conversations`)
        .then((r) => r.data as OrderConversationDto[]),
    enabled: !!orderId,
    staleTime: 10_000,
    // Keep the live undo countdown / auto-send status fresh while the drawer is open.
    refetchInterval: 15_000,
  });
}

export interface OrderAttachmentDto {
  id: string;
  conversationId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  /** short-lived signed URL to the persisted bytes (D2); null if it couldn't be signed. */
  url: string | null;
}

/** Persisted vendor email attachments for an order (D2), with signed URLs. */
export function useOrderAttachments(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["order-attachments", orderId ?? ""],
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/attachments`)
        .then((r) => r.data as OrderAttachmentDto[]),
    enabled: !!orderId && enabled,
    staleTime: 30_000,
  });
}

/**
 * A person's own threaded reply (bypasses the AI draft) — behind a redeemed
 * seal since 2026-09-21 (ADR 0175 D9): the challenge comes from
 * `issueManualReplyChallenge`, minted when the hold began.
 */
export function useManualReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      content,
      ccEmails,
      challenge,
    }: {
      orderId: string;
      content: string;
      ccEmails?: string[];
      challenge: string;
    }) =>
      apiClient
        .post(
          `/procurement/orders/${orderId}/manual-reply`,
          { content, ccEmails },
          { headers: { "X-Seal-Challenge": challenge } },
        )
        .then((r) => r.data),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
    },
  });
}

/** Pause/resume AI autonomy for one order (grab the wheel). */
export function useToggleAiPaused() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, paused }: { orderId: string; paused: boolean }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/ai-pause`, { paused })
        .then((r) => r.data as { paused: boolean }),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(variables.orderId),
      });
    },
  });
}

/** Undo a scheduled auto-send (revert it to a one-tap-approval draft). */
export function useCancelScheduledSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/cancel-scheduled-send`)
        .then((r) => r.data as { cancelled: boolean }),
    onSettled: (_d, _e, orderId) => {
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(orderId),
      });
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
    },
  });
}

/** Ask the AI to rewrite the current draft (optionally with a tone/steering hint). */
export function useRegenerateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      instruction,
    }: {
      orderId: string;
      instruction?: string;
    }) =>
      apiClient
        .post(`/procurement/orders/${orderId}/generate-ai-reply`, {
          regenerate: true,
          instruction,
        })
        .then((r) => r.data as { triggered: boolean; reason?: string }),
    onSettled: (_d, _e, variables) => {
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(variables.orderId),
      });
      queryClient.invalidateQueries({
        queryKey: draftKeys.byOrder(variables.orderId),
      });
    },
  });
}

/** Pull recent Gmail replies on demand (recovers any the live watch missed). */
export function useForceFetchReplies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient
        .post("/communications/webhooks/gmail/force-fetch")
        .then((r) => r.data as { processed?: number; fetched?: number }),
    onSettled: (_d, _e, _v) => {
      queryClient.invalidateQueries({ queryKey: orderConversationKeys.all });
      queryClient.invalidateQueries({ queryKey: ["deal-proposal"] });
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
    },
  });
}

export interface DiscountTierDto {
  threshold_qty: number | null;
  unit: string | null;
  discount_pct: number | null;
  discount_amount: number | null;
}

export interface CommercialTermsDto {
  currency: string | null;
  currency_ambiguous: boolean;
  unit_price: number | null;
  case_price: number | null;
  bottles_per_case: number | null;
  min_order_qty: number | null;
  min_order_unit: string | null;
  discount_tiers: DiscountTierDto[];
  tax_status: "included" | "excluded" | "unknown";
  tax_rate_pct: number | null;
  price_valid_until: string | null;
  payment_terms: string | null;
  delivery_lead_time: string | null;
  stock_status: "in_stock" | "limited" | "allocation" | "out_of_stock" | null;
  stock_qty_available: number | null;
  source_quotes?: Record<string, string> | null;
}

export interface DealProposalDto {
  orderId: string;
  conversationId: string;
  providerName: string;
  wineName: string;
  quantity: number;
  proposedPrice: number;
  finalPrice: number;
  deliveryEstimate: string;
  conditions: string;
  specialConditions: string[];
  commercialTerms?: CommercialTermsDto | null;
  sourceQuote: string;
  conversationSummary: string;
  dealKind: "offer" | "verification";
  urgency: "normal" | "urgent";
  confidence: number;
  timestamp: string;
  trust: { score: number; eligible: boolean; completedOrders: number };
}

export const dealProposalKeys = {
  byOrder: (orderId: string) => ["deal-proposal", orderId] as const,
};

/** Latest AI-detected deal proposal for an order (null when none pending). */
export function useDealProposal(orderId: string | null, enabled = true) {
  return useQuery({
    queryKey: dealProposalKeys.byOrder(orderId ?? ""),
    queryFn: () =>
      apiClient
        .get(`/procurement/orders/${orderId}/deal-proposal`)
        .then((r) => (r.data ?? null) as DealProposalDto | null),
    enabled: !!orderId && enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
}

/**
 * Confirm a deal — behind a redeemed seal since 2026-09-21 (ADR 0175 D9): the
 * challenge comes from `issueConfirmDealChallenge`, minted over the same terms
 * when the hold began.
 */
export function useConfirmDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      finalPrice,
      quantity,
      sendConfirmation,
      challenge,
    }: {
      orderId: string;
      finalPrice?: number;
      quantity?: number;
      sendConfirmation?: boolean;
      challenge: string;
    }) =>
      apiClient
        .post(
          `/procurement/orders/${orderId}/confirm-deal`,
          { finalPrice, quantity, sendConfirmation },
          { headers: { "X-Seal-Challenge": challenge } },
        )
        .then(
          (r) => r.data as { confirmed: boolean; sentConfirmation: boolean },
        ),
    onSettled: (_d, _e, variables) => {
      // Confirming a deal discards any pending AI draft server-side, so the draft
      // and the sidebar's active-conversation list must refetch too — otherwise the
      // just-resolved draft lingers on screen after the confirmation is sent.
      queryClient.invalidateQueries({
        queryKey: dealProposalKeys.byOrder(variables.orderId),
      });
      // A confirmation answers a staff member's waiting request for this deal.
      queryClient.invalidateQueries({
        queryKey: dealRequestKeys.byOrder(variables.orderId),
      });
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(variables.orderId),
      });
      queryClient.invalidateQueries({
        queryKey: draftKeys.byOrder(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
    },
  });
}

export function useDismissDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      apiClient
        .post(`/procurement/orders/${orderId}/dismiss-deal`)
        .then((r) => r.data as { dismissed: boolean; requestsClosed: number }),
    onSettled: (_d, _e, orderId) => {
      queryClient.invalidateQueries({
        queryKey: dealProposalKeys.byOrder(orderId),
      });
      // A dismissal closes a staff member's waiting request on the deal too.
      queryClient.invalidateQueries({ queryKey: dealRequestKeys.byOrder(orderId) });
      queryClient.invalidateQueries({
        queryKey: orderConversationKeys.byOrder(orderId),
      });
      queryClient.invalidateQueries({ queryKey: draftKeys.byOrder(orderId) });
      queryClient.invalidateQueries({ queryKey: activeConversationKeys.all });
    },
  });
}

export function useEditDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, content }: { orderId: string; content: string }) =>
      apiClient
        .patch(`/procurement/orders/${orderId}/draft`, {
          modifiedContent: content,
        })
        .then((r) => r.data),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: draftKeys.byOrder(variables.orderId),
      });
    },
  });
}
