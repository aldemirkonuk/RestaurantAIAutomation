/**
 * WineOps mobile design tokens.
 *
 * Light, Stripe-clean operator tool matching the web dashboard: neutral slate
 * ink, white surfaces, ONE accent (wine) used identically everywhere.
 * Semantic colors (success/warning/danger) signal state, never decoration.
 *
 * Radius rule (locked): cards 16, controls 12, pills full. Nothing else.
 */

export const color = {
  // Surfaces
  surface: "#FFFFFF",
  surfaceSecondary: "#F7F8F9",
  surfaceTertiary: "#F1F3F5",

  // Ink (slate, matching web tailwind)
  ink: "#111827",
  inkSecondary: "#4B5563",
  inkTertiary: "#6B7280",
  inkQuaternary: "#9CA3AF",

  // Hairlines and fills
  hairline: "#ECEEF0",
  fill: "#F3F4F6",
  fillStrong: "#E5E7EB",

  // Brand accent — wine. The only accent on the page.
  wine: "#AC204A",
  wineStrong: "#7C1D3C",
  wineDeep: "#450A1E",
  wineTint: "#FDF2F4",
  wineTintStrong: "#FCE7EB",

  // Semantic state
  success: "#059669",
  successTint: "#ECFDF5",
  warning: "#D97706",
  warningTint: "#FFFBEB",
  danger: "#DC2626",
  dangerTint: "#FEF2F2",

  // On-color
  onWine: "#FFFFFF",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radius = {
  card: 16,
  control: 12,
  pill: 999,
} as const;

export const font = {
  // Operator voice — all UI
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  // Sommelier voice — wine names, vintages, signature-moment text ONLY
  serif: "CormorantGaramond_600SemiBold",
  serifItalic: "CormorantGaramond_500Medium_Italic",
} as const;

export const type = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: font.sansBold },
  title: { fontSize: 22, lineHeight: 28, fontFamily: font.sansSemiBold },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: font.sansSemiBold },
  body: { fontSize: 15, lineHeight: 21, fontFamily: font.sans },
  bodyMedium: { fontSize: 15, lineHeight: 21, fontFamily: font.sansMedium },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: font.sans },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: font.sansMedium },
  // Wine names get the serif at a size where its shapes read
  wineName: { fontSize: 19, lineHeight: 24, fontFamily: font.serif },
  wineNameLarge: { fontSize: 26, lineHeight: 31, fontFamily: font.serif },
  signature: { fontSize: 24, lineHeight: 30, fontFamily: font.serifItalic },
} as const;

/** Tinted, never pure-black. Used sparingly — hierarchy comes from spacing. */
export const shadow = {
  card: {
    shadowColor: "#1F2937",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: "#1F2937",
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
} as const;
