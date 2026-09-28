import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { AppText } from "@/components/ui/AppText";
import { PressableScale } from "@/components/ui/PressableScale";
import { Card, Hairline, Screen } from "@/components/ui/Screen";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/StateViews";
import { CapsuleSweep } from "@/components/cellar/CapsuleSweep";
import { BinBreath } from "@/components/cellar/BinBreath";
import { color, font, radius, space } from "@/design/tokens";
import { haptic } from "@/design/haptics";
import { feedKey, pulseKey, useOrder } from "@/api/queries";
import { useOutbox } from "@/state/outbox";
import { useFeedLocal } from "@/state/feedLocal";
import { receivingCountBasis } from "@/lib/receivingCountBasis";
import { computeMatch, money, verdictTone } from "@/lib/invoiceMatch";

/**
 * Receiving — the canonical WineOps invoice, phone edition.
 *
 * Vendors send wildly different paperwork; the manager never reads theirs.
 * This renders OUR three-way match: ORDERED (agreed) vs INVOICED (billed) vs
 * RECEIVED (accepted + rejected). Counting is thumb-first: steppers or the
 * camera (each barcode read accepts one bottle, with a Capsule Sweep). The
 * invoice section stays folded until the paper actually disagrees. The server
 * recomputes the verdict and derives the ledger correction — what we send is
 * evidence, not a decision. Rules mirrored in lib/invoiceMatch.ts.
 */
export default function ReceivingScreen() {
  const router = useRouter();
  const { orderId, feedItemId } = useLocalSearchParams<{
    orderId: string;
    feedItemId?: string;
  }>();
  const { data: order, isLoading, isError, refetch } = useOrder(orderId);

  const countBasis = receivingCountBasis(order);
  const orderedQty = countBasis.orderedBottles ?? 0;
  // Detail responses can omit the agreement's price unit. An unlabelled
  // header price cannot serve as a per-bottle comparison on this phone.
  const rawAgreedPrice =
    order?.finalPrice ?? order?.negotiatedPrice ?? order?.quotedPrice ?? null;
  const poUnitPrice =
    rawAgreedPrice != null && order?.pricePackSize && order?.priceUom
      ? rawAgreedPrice / order.pricePackSize
      : null;
  const stockedQty = countBasis.prefillBottles;
  const stockedNote = countBasis.note;

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const lastScanAt = useRef(0);

  // Physical count. null = untouched (defaults to what delivery stocked in).
  const [acceptedRaw, setAcceptedRaw] = useState<number | null>(null);
  const acceptedQty = acceptedRaw ?? stockedQty;
  const [rejectedQty, setRejectedQty] = useState(0);
  const [rejectedReason, setRejectedReason] = useState("");

  // Only figures explicitly copied from the vendor paper count as an invoice.
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceQtyRaw, setInvoiceQtyRaw] = useState<number | null>(null);
  const invoiceQty = invoiceQtyRaw;
  const [priceText, setPriceText] = useState<string | null>(null);
  const invoiceUnitPrice =
    priceText == null || priceText.trim() === ""
      ? null
      : Number(priceText.replace(",", "."));
  const [invoiceCurrency, setInvoiceCurrency] = useState("");
  const priceIsValid =
    invoiceUnitPrice == null ||
    (Number.isFinite(invoiceUnitPrice) && invoiceUnitPrice >= 0);
  const invoiceNeedsCurrency =
    invoiceUnitPrice != null && !/^[A-Z]{3}$/.test(invoiceCurrency);
  const canCommit =
    countBasis.orderedBottles != null && priceIsValid && !invoiceNeedsCurrency;
  const [priceOverrideReason, setPriceOverrideReason] = useState("");
  const [note, setNote] = useState("");

  const [sweepKey, setSweepKey] = useState(0);
  const [breatheKey, setBreatheKey] = useState(0);
  const [sealed, setSealed] = useState(false);

  const match = useMemo(
    () =>
      computeMatch({
        orderedQty,
        poUnitPrice,
        invoiceQty,
        invoiceUnitPrice,
        acceptedQty,
        rejectedQty,
        priceOverrideReason,
      }),
    [
      orderedQty,
      poUnitPrice,
      invoiceQty,
      invoiceUnitPrice,
      acceptedQty,
      rejectedQty,
      priceOverrideReason,
    ],
  );
  const tone = verdictTone(match.verdict);
  const priceDiffers =
    poUnitPrice != null &&
    invoiceUnitPrice != null &&
    Math.round(poUnitPrice * 100) !== Math.round(invoiceUnitPrice * 100);
  const receivedQty = acceptedQty + rejectedQty;

  const onScan = useCallback(() => {
    const now = Date.now();
    if (now - lastScanAt.current < 900) return; // one bottle per read
    lastScanAt.current = now;
    haptic.tick();
    setSweepKey((k) => k + 1);
    setAcceptedRaw((prev) => (prev ?? 0) + 1);
  }, []);

  const startScan = useCallback(async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setAcceptedRaw((prev) => prev ?? 0); // scanning counts from zero
    setScanning(true);
  }, [permission, requestPermission]);

  const commit = useCallback(() => {
    if (!order || sealed || match.requiresOverride || !canCommit) return;
    useOutbox.getState().enqueue({
      path: `/procurement/orders/${orderId}/verify-receipt`,
      body: {
        // Steppers and camera both count individual bottles. Invoice figures
        // are also explicitly entered as bottles; no order-unit fallback.
        countedUom: "bottle",
        invoiceUom: "bottle",
        invoiceCurrency: invoiceUnitPrice != null ? invoiceCurrency : undefined,
        invoiceQuantityInInvoiceUom: invoiceQty ?? undefined,
        invoiceUnitPrice: invoiceUnitPrice ?? undefined,
        acceptedQuantityInCountedUom: acceptedQty,
        rejectedQuantityInCountedUom: rejectedQty,
        rejectedReason:
          rejectedQty > 0
            ? rejectedReason.trim() || "damaged on arrival"
            : undefined,
        priceOverrideReason: priceDiffers
          ? priceOverrideReason.trim()
          : undefined,
        note: note.trim() || undefined,
      },
      label: "Receipt verification",
      graceMs: 0,
      invalidate: [
        [...feedKey],
        [...pulseKey],
        ["orders", "pending"],
        ["orders", "history"],
        ["orders", "item", orderId],
        ["inventory", "list"],
      ],
      feedItemId: typeof feedItemId === "string" ? feedItemId : undefined,
    });
    if (typeof feedItemId === "string") {
      useFeedLocal.getState().hide(feedItemId, "receiving");
      useFeedLocal.getState().markCleared();
    }
    setScanning(false);
    setSealed(true);
    setBreatheKey((k) => k + 1);
    haptic.confirm();
    setTimeout(() => router.back(), 900);
  }, [
    order,
    sealed,
    match.requiresOverride,
    match.backorderQty,
    orderId,
    invoiceQty,
    invoiceUnitPrice,
    invoiceCurrency,
    canCommit,
    acceptedQty,
    rejectedQty,
    rejectedReason,
    priceDiffers,
    priceOverrideReason,
    note,
    feedItemId,
    router,
  ]);

  if (isError && !order) {
    return (
      <Screen>
        <ErrorState
          title="Couldn't load this delivery"
          onAction={() => refetch()}
        />
      </Screen>
    );
  }

  const primaryLabel = !canCommit
    ? invoiceNeedsCurrency
      ? "State the invoice currency"
      : "Check the stated quantities and price"
    : match.requiresOverride
      ? "Reason required"
      : match.backorderQty > 0
        ? "Accept & keep open"
        : priceDiffers
          ? "Accept with override"
          : invoiceQty == null
            ? "Record count — invoice pending"
            : "Submit for verification";

  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          gap: space.sm,
        }}
      >
        <PressableScale
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{ padding: space.sm }}
        >
          <Ionicons name="chevron-back" size={24} color={color.inkSecondary} />
        </PressableScale>
        <AppText variant="caption" tone="tertiary">
          Match invoice{order?.orderNumber ? `  ·  ${order.orderNumber}` : ""}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.md,
          paddingBottom: space.huge,
        }}
      >
        {isLoading && !order ? (
          <Card style={{ gap: space.md }}>
            <Skeleton width={220} height={22} />
            <Skeleton width={140} height={14} />
          </Card>
        ) : (
          <>
            <BinBreath breatheKey={breatheKey}>
              <CapsuleSweep sweepKey={sweepKey} sealed={sealed}>
                <Card style={{ gap: space.md, borderRadius: radius.card }}>
                  <View>
                    {order?.wineName ? (
                      <AppText variant="wineName">{order.wineName}</AppText>
                    ) : (
                      <AppText variant="headline">
                        {order?.orderNumber ?? "Delivery"}
                      </AppText>
                    )}
                    <AppText variant="footnote" tone="secondary">
                      Agreed: {orderedQty}{" "}
                      {orderedQty === 1 ? "bottle" : "bottles"}
                      {poUnitPrice != null ? ` @ ${money(poUnitPrice)}` : ""}
                    </AppText>
                  </View>

                  <Hairline />

                  {/* ACCEPTED — the hero count */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <AppText variant="body" tone="secondary">
                        Accepted
                      </AppText>
                      <AppText variant="caption" tone="tertiary">
                        good bottles into stock
                      </AppText>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.lg,
                      }}
                    >
                      <Stepper
                        label="−"
                        onPress={() =>
                          setAcceptedRaw(Math.max(0, acceptedQty - 1))
                        }
                        disabled={sealed || acceptedQty <= 0}
                      />
                      <AppText
                        variant="display"
                        style={{
                          fontVariant: ["tabular-nums"],
                          minWidth: 56,
                          textAlign: "center",
                        }}
                      >
                        {acceptedQty}
                      </AppText>
                      <Stepper
                        label="+"
                        onPress={() => setAcceptedRaw(acceptedQty + 1)}
                        disabled={sealed}
                      />
                    </View>
                  </View>

                  {/*
                    Where the pre-filled count came from, or why it could not
                    come from what was already received. Rendered only when
                    there is something to say — an order nobody has booked
                    against needs no sentence.
                  */}
                  {stockedNote ? (
                    <AppText variant="caption" tone="tertiary">
                      {stockedNote}
                    </AppText>
                  ) : null}

                  {/* REJECTED */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <AppText variant="body" tone="secondary">
                        Rejected
                      </AppText>
                      <AppText variant="caption" tone="tertiary">
                        arrived broken or wrong
                      </AppText>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.lg,
                      }}
                    >
                      <Stepper
                        label="−"
                        onPress={() =>
                          setRejectedQty((n) => Math.max(0, n - 1))
                        }
                        disabled={sealed || rejectedQty <= 0}
                      />
                      <AppText
                        variant="title"
                        tone={rejectedQty > 0 ? "warning" : "primary"}
                        style={{
                          fontVariant: ["tabular-nums"],
                          minWidth: 56,
                          textAlign: "center",
                        }}
                      >
                        {rejectedQty}
                      </AppText>
                      <Stepper
                        label="+"
                        onPress={() => setRejectedQty((n) => n + 1)}
                        disabled={sealed}
                      />
                    </View>
                  </View>

                  {rejectedQty > 0 && !sealed ? (
                    <Animated.View
                      entering={FadeIn.duration(200)}
                      exiting={FadeOut.duration(150)}
                      style={{
                        backgroundColor: color.warningTint,
                        borderRadius: 12,
                        padding: space.md,
                        gap: space.xs,
                      }}
                    >
                      <AppText variant="caption" tone="warning">
                        Why were {rejectedQty} rejected?
                      </AppText>
                      <TextInput
                        value={rejectedReason}
                        onChangeText={setRejectedReason}
                        placeholder="e.g. 2 bottles broken in transit"
                        placeholderTextColor={color.inkQuaternary}
                        style={{
                          backgroundColor: color.surface,
                          borderRadius: 8,
                          paddingHorizontal: space.md,
                          paddingVertical: 9,
                          fontSize: 14,
                          fontFamily: font.sans,
                          color: color.ink,
                        }}
                      />
                      <AppText variant="caption" tone="tertiary">
                        They arrived but never entered stock — tracked as a
                        credit, not a short ship.
                      </AppText>
                    </Animated.View>
                  ) : null}
                </Card>
              </CapsuleSweep>
            </BinBreath>

            {/* Camera scan-to-count */}
            {scanning && permission?.granted ? (
              <View
                style={{
                  borderRadius: radius.card,
                  overflow: "hidden",
                  height: 240,
                }}
              >
                <CameraView
                  style={{ flex: 1 }}
                  barcodeScannerSettings={{
                    barcodeTypes: [
                      "ean13",
                      "ean8",
                      "upc_a",
                      "upc_e",
                      "code128",
                      "qr",
                    ],
                  }}
                  onBarcodeScanned={onScan}
                />
                <View
                  style={{
                    position: "absolute",
                    bottom: space.md,
                    alignSelf: "center",
                    backgroundColor: "#111827CC",
                    borderRadius: 999,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.sm,
                  }}
                >
                  <AppText variant="caption" tone="onWine">
                    Each read adds one bottle. Confirm it belongs to this order.
                  </AppText>
                </View>
              </View>
            ) : null}

            <PressableScale
              onPress={scanning ? () => setScanning(false) : startScan}
              disabled={sealed}
              style={{
                backgroundColor: color.fill,
                borderRadius: radius.control,
                paddingVertical: 13,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: space.sm,
                opacity: sealed ? 0.5 : 1,
              }}
            >
              <Ionicons
                name={scanning ? "stop-circle-outline" : "barcode-outline"}
                size={19}
                color={color.ink}
              />
              <AppText variant="bodyMedium">
                {scanning ? "Stop scanning" : "Scan bottles"}
              </AppText>
            </PressableScale>

            {/* Invoice disclosure — folded until the paper disagrees */}
            <Card
              style={{
                gap: invoiceOpen ? space.md : 0,
                paddingVertical: invoiceOpen ? space.lg : space.md,
              }}
            >
              <PressableScale
                onPress={() => setInvoiceOpen((v) => !v)}
                disabled={sealed}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View>
                  <AppText variant="bodyMedium">Record the invoice</AppText>
                  <AppText variant="caption" tone="tertiary">
                    {invoiceOpen
                      ? "Record what the vendor actually billed"
                      : invoiceQty == null
                        ? "No invoice quantities recorded"
                        : `${invoiceQty} bottles billed${invoiceUnitPrice != null ? ` at ${invoiceCurrency || "currency not stated"} ${invoiceUnitPrice.toFixed(2)}` : ""}`}
                  </AppText>
                </View>
                <Ionicons
                  name={invoiceOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={color.inkTertiary}
                />
              </PressableScale>

              {invoiceOpen ? (
                <Animated.View
                  entering={FadeIn.duration(200)}
                  style={{ gap: space.md }}
                >
                  <Hairline />
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <AppText variant="body" tone="secondary">
                      Bottles billed
                    </AppText>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.lg,
                      }}
                    >
                      <Stepper
                        label="−"
                        onPress={() =>
                          setInvoiceQtyRaw(Math.max(0, (invoiceQty ?? 0) - 1))
                        }
                        disabled={sealed || (invoiceQty ?? 0) <= 0}
                      />
                      <AppText
                        variant="title"
                        style={{
                          fontVariant: ["tabular-nums"],
                          minWidth: 56,
                          textAlign: "center",
                        }}
                      >
                        {invoiceQty ?? "—"}
                      </AppText>
                      <Stepper
                        label="+"
                        onPress={() => setInvoiceQtyRaw((invoiceQty ?? 0) + 1)}
                        disabled={sealed}
                      />
                    </View>
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View>
                      <AppText variant="body" tone="secondary">
                        Billed unit price
                      </AppText>
                      {poUnitPrice == null ? (
                        <AppText variant="caption" tone="tertiary">
                          Agreed bottle price not available here
                        </AppText>
                      ) : priceDiffers ? (
                        <AppText variant="caption" tone="danger">
                          {money(
                            Math.abs((invoiceUnitPrice ?? 0) - poUnitPrice),
                          )}
                          /btl{" "}
                          {(invoiceUnitPrice ?? 0) > poUnitPrice
                            ? "over"
                            : "under"}{" "}
                          agreed
                        </AppText>
                      ) : (
                        <AppText variant="caption" tone="success">
                          {invoiceUnitPrice == null
                            ? "No invoice price recorded"
                            : "Matches stated bottle price"}
                        </AppText>
                      )}
                    </View>
                    <TextInput
                      value={priceText ?? ""}
                      onChangeText={setPriceText}
                      editable={!sealed}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={color.inkQuaternary}
                      style={{
                        width: 92,
                        textAlign: "center",
                        backgroundColor: color.surface,
                        borderWidth: 1,
                        borderColor: priceDiffers ? "#FDA4AF" : color.hairline,
                        borderRadius: radius.control,
                        paddingVertical: 9,
                        fontSize: 15,
                        fontFamily: font.sansMedium,
                        color: color.ink,
                      }}
                    />
                  </View>

                  <View style={{ gap: space.xs }}>
                    <AppText variant="caption" tone="secondary">
                      Currency printed on the invoice
                    </AppText>
                    <TextInput
                      value={invoiceCurrency}
                      onChangeText={(value) =>
                        setInvoiceCurrency(
                          value
                            .toUpperCase()
                            .replace(/[^A-Z]/g, "")
                            .slice(0, 3),
                        )
                      }
                      autoCapitalize="characters"
                      maxLength={3}
                      placeholder="USD, TRY, GBP…"
                      editable={!sealed}
                      accessibilityLabel="Invoice currency code"
                      style={{
                        padding: space.md,
                        color: color.ink,
                        backgroundColor: color.fill,
                        borderRadius: radius.control,
                      }}
                    />
                    <AppText variant="caption" tone="tertiary">
                      Copy the currency from the vendor's paper. It is required
                      when recording a price.
                    </AppText>
                  </View>
                  {priceDiffers && !sealed ? (
                    <View
                      style={{
                        backgroundColor: color.dangerTint,
                        borderRadius: 12,
                        padding: space.md,
                        gap: space.xs,
                      }}
                    >
                      <AppText variant="caption" tone="danger">
                        Why accept this price?
                      </AppText>
                      <TextInput
                        value={priceOverrideReason}
                        onChangeText={setPriceOverrideReason}
                        placeholder="e.g. freight surcharge agreed with the rep by phone"
                        placeholderTextColor={color.inkQuaternary}
                        style={{
                          backgroundColor: color.surface,
                          borderRadius: 8,
                          paddingHorizontal: space.md,
                          paddingVertical: 9,
                          fontSize: 14,
                          fontFamily: font.sans,
                          color: color.ink,
                        }}
                      />
                      <AppText variant="caption" tone="tertiary">
                        Recorded against the order. The price stays marked
                        unverified either way.
                      </AppText>
                    </View>
                  ) : null}
                </Animated.View>
              ) : null}
            </Card>

            {/* Live verdict */}
            <View
              style={{
                backgroundColor: tone.bg,
                borderRadius: radius.card,
                padding: space.lg,
                gap: space.xs,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <AppText variant="bodyMedium" style={{ color: tone.text }}>
                  {tone.label}
                </AppText>
                {match.effectiveUnitCost != null ? (
                  <AppText variant="caption" tone="secondary">
                    Real cost {money(match.effectiveUnitCost)}/btl
                  </AppText>
                ) : null}
              </View>
              <AppText variant="footnote" tone="secondary">
                {match.summary} The server verifies the documents when this
                receipt is sent.
              </AppText>
              {match.creditDue ? (
                <AppText variant="caption" tone="warning">
                  Credit due from the vendor.
                </AppText>
              ) : null}
              {invoiceQty != null && receivedQty !== invoiceQty ? (
                <AppText variant="caption" tone="tertiary">
                  {receivedQty} physically arrived ({acceptedQty} accepted +{" "}
                  {rejectedQty} rejected) against {invoiceQty} billed.
                </AppText>
              ) : null}
            </View>

            {!sealed ? (
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (substitute vintage, driver waited, pallet damaged...)"
                placeholderTextColor={color.inkQuaternary}
                style={{
                  backgroundColor: color.surface,
                  borderWidth: 1,
                  borderColor: color.hairline,
                  borderRadius: radius.control,
                  paddingHorizontal: space.lg,
                  paddingVertical: 11,
                  fontSize: 14,
                  fontFamily: font.sans,
                  color: color.ink,
                }}
              />
            ) : null}

            {match.backorderQty > 0 ? (
              <AppText variant="caption" tone="warning" align="center">
                {match.backorderQty} bottle{match.backorderQty === 1 ? "" : "s"}{" "}
                stay on backorder — the order holds open.
              </AppText>
            ) : (
              <AppText variant="caption" tone="tertiary" align="center">
                The order will close.
              </AppText>
            )}

            <PressableScale
              onPress={commit}
              disabled={
                sealed || !order || match.requiresOverride || !canCommit
              }
              style={{
                backgroundColor: match.requiresOverride
                  ? color.fillStrong
                  : color.wine,
                borderRadius: radius.control,
                paddingVertical: 15,
                alignItems: "center",
                opacity: sealed ? 0.6 : 1,
              }}
            >
              <AppText
                variant="bodyMedium"
                tone={match.requiresOverride ? "tertiary" : "onWine"}
              >
                {sealed ? "Saved on this phone" : primaryLabel}
              </AppText>
            </PressableScale>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stepper({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      style={{
        width: 44,
        height: 44,
        borderRadius: 999,
        backgroundColor: color.fill,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <AppText variant="title">{label}</AppText>
    </PressableScale>
  );
}
