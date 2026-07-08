/**
 * Email Template Configuration
 * Shared constants for all email templates
 * Supports hybrid branding: global WineOps defaults + per-restaurant overrides
 */

export const EMAIL_CONFIG = {
  // Brand Colors
  colors: {
    primary: "#7c2d12", // Wine/burgundy - main brand color
    primaryDark: "#991b1b", // Darker wine for hover states
    secondary: "#f59e0b", // Amber - warning/attention
    success: "#10b981", // Emerald - success states
    danger: "#dc2626", // Red - critical alerts
    warning: "#f59e0b", // Amber - low stock
    info: "#3b82f6", // Blue - informational
    gray: {
      50: "#f9fafb",
      100: "#f3f4f6",
      200: "#e5e7eb",
      300: "#d1d5db",
      400: "#9ca3af",
      500: "#6b7280",
      600: "#4b5563",
      700: "#374151",
      800: "#1f2937",
      900: "#111827",
    },
  },

  // Brand Info
  brand: {
    name: "WineOps AI",
    logo: "", // Add logo URL when available
    website: "https://wineops.ai",
    supportEmail: "support@wineops.ai",
  },

  // Footer Text
  footer: {
    automated: "This is an automated message from WineOps AI.",
    unsubscribe:
      "To manage your notification preferences, visit your account settings.",
    copyright: `© ${new Date().getFullYear()} WineOps AI. All rights reserved.`,
  },

  // Email Styles
  styles: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    borderRadius: "8px",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
  },
};

/**
 * Restaurant branding override interface
 */
export interface RestaurantBranding {
  displayName?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tagline?: string;
}

/**
 * Get restaurant-specific branding from database.
 * Falls back to global WineOps branding if no override exists.
 */
export async function getRestaurantBranding(
  restaurantId: string,
  databaseService?: any,
): Promise<
  RestaurantBranding & {
    brandName: string;
    brandLogo: string;
    brandColor: string;
  }
> {
  const defaults = {
    brandName: EMAIL_CONFIG.brand.name,
    brandLogo: EMAIL_CONFIG.brand.logo,
    brandColor: EMAIL_CONFIG.colors.primary,
  };

  if (!databaseService || !restaurantId) {
    return defaults;
  }

  try {
    const client = databaseService.getClient();

    // Try restaurant_branding table first
    const { data: branding } = await client
      .from("restaurant_branding")
      .select("display_name, logo_url, primary_color, secondary_color, tagline")
      .eq("restaurant_id", restaurantId)
      .single();

    if (branding) {
      return {
        ...defaults,
        brandName: branding.display_name || defaults.brandName,
        brandLogo: branding.logo_url || defaults.brandLogo,
        brandColor: branding.primary_color || defaults.brandColor,
        displayName: branding.display_name,
        logoUrl: branding.logo_url,
        primaryColor: branding.primary_color,
        secondaryColor: branding.secondary_color,
        tagline: branding.tagline,
      };
    }

    // Fallback: try restaurant name from restaurants table
    const { data: restaurant } = await client
      .from("restaurants")
      .select("name")
      .eq("id", restaurantId)
      .single();

    if (restaurant?.name) {
      return {
        ...defaults,
        brandName: `${restaurant.name} | ${EMAIL_CONFIG.brand.name}`,
        displayName: restaurant.name,
      };
    }
  } catch (error) {
    // Non-critical: fall back to global branding
  }

  return defaults;
}

/**
 * Get severity color based on stock level
 */
export function getSeverityColor(
  currentStock: number,
  threshold: number,
): string {
  if (currentStock <= threshold * 0.5) {
    return EMAIL_CONFIG.colors.danger;
  }
  return EMAIL_CONFIG.colors.warning;
}

/**
 * Get severity label based on stock level
 */
export function getSeverityLabel(
  currentStock: number,
  threshold: number,
): string {
  if (currentStock <= threshold * 0.5) {
    return "CRITICAL";
  }
  return "LOW STOCK";
}

/**
 * Format currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Format date for emails
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format short date
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
