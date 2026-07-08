/**
 * Base Email Template
 * Provides the HTML wrapper and common elements for all email templates
 */

import { EMAIL_CONFIG, RestaurantBranding } from "./template-config";

export interface BaseTemplateOptions {
  title: string;
  preheader?: string;
  content: string;
  ctaButton?: {
    text: string;
    url: string;
    color?: string;
  };
  showFooter?: boolean;
  branding?: RestaurantBranding & {
    brandName?: string;
    brandLogo?: string;
    brandColor?: string;
  };
}

/**
 * Generate the base HTML email template
 */
export function baseTemplate(options: BaseTemplateOptions): string {
  const {
    title,
    preheader,
    content,
    ctaButton,
    showFooter = true,
    branding,
  } = options;
  const { colors, brand, footer, styles } = EMAIL_CONFIG;

  // Apply restaurant branding overrides
  const headerBg =
    branding?.brandColor || branding?.primaryColor || colors.primary;
  const headerName = branding?.brandName || branding?.displayName || brand.name;
  const headerLogo = branding?.brandLogo || branding?.logoUrl || brand.logo;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${title}</title>
  ${preheader ? `<!--[if !mso]><!--><meta name="description" content="${preheader}"><!--<![endif]-->` : ""}
  <style>
    /* Reset styles */
    body, table, td, p, a, li, blockquote { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
    
    /* Responsive styles */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; }
      .fluid { max-width: 100% !important; height: auto !important; margin-left: auto !important; margin-right: auto !important; }
      .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; }
      .center-on-narrow { text-align: center !important; display: block !important; margin-left: auto !important; margin-right: auto !important; float: none !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: ${styles.fontFamily}; background-color: ${colors.gray[100]};">
  ${
    preheader
      ? `
  <!-- Preheader text (hidden) -->
  <div style="display: none; font-size: 1px; color: ${colors.gray[100]}; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader}
  </div>
  `
      : ""
  }

  <!-- Email Container -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${colors.gray[100]};">
    <tr>
      <td style="padding: 20px 0;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="email-container" style="margin: 0 auto; background-color: #ffffff; border-radius: ${styles.borderRadius}; overflow: hidden; box-shadow: ${styles.boxShadow};">
          
          <!-- Logo Header -->
          <tr>
            <td style="padding: 20px 30px; background-color: ${headerBg}; text-align: center;">
              ${headerLogo ? `<img src="${headerLogo}" alt="${headerName}" style="max-height: 40px; margin-bottom: 8px;" />` : ""}
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: bold;">
                ${headerName}
              </h1>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 30px;">
              ${content}
            </td>
          </tr>

          ${
            ctaButton
              ? `
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 30px 30px; text-align: center;">
              <a href="${ctaButton.url}" style="display: inline-block; padding: 14px 32px; background-color: ${ctaButton.color || colors.primary}; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: ${styles.borderRadius}; font-size: 16px;">
                ${ctaButton.text}
              </a>
            </td>
          </tr>
          `
              : ""
          }

          ${
            showFooter
              ? `
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: ${colors.gray[50]}; border-top: 1px solid ${colors.gray[200]};">
              <p style="margin: 0 0 10px; color: ${colors.gray[500]}; font-size: 12px; text-align: center;">
                ${footer.automated}
              </p>
              <p style="margin: 0; color: ${colors.gray[400]}; font-size: 11px; text-align: center;">
                ${footer.copyright}
              </p>
            </td>
          </tr>
          `
              : ""
          }

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Create a metric box for email templates
 */
export function metricBox(options: {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor: string;
}): string {
  return `
    <td width="50%" style="padding: 15px; text-align: center; background-color: ${options.backgroundColor}; border-radius: 8px;">
      <p style="margin: 0; color: ${options.textColor}; font-size: 32px; font-weight: bold;">${options.value}</p>
      <p style="margin: 5px 0 0; color: ${options.textColor}; font-size: 12px; opacity: 0.8;">${options.label}</p>
    </td>
  `;
}

/**
 * Create a table row for data display
 */
export function tableRow(
  label: string,
  value: string,
  isHighlighted = false,
): string {
  const { colors } = EMAIL_CONFIG;
  const bgColor = isHighlighted ? colors.gray[50] : "transparent";

  return `
    <tr style="background-color: ${bgColor};">
      <td style="padding: 12px 15px; border-bottom: 1px solid ${colors.gray[200]}; color: ${colors.gray[600]}; font-size: 14px;">
        ${label}
      </td>
      <td style="padding: 12px 15px; border-bottom: 1px solid ${colors.gray[200]}; color: ${colors.gray[900]}; font-size: 14px; font-weight: 600; text-align: right;">
        ${value}
      </td>
    </tr>
  `;
}

/**
 * Create an alert/callout box
 */
export function alertBox(options: {
  type: "warning" | "danger" | "success" | "info";
  title: string;
  message: string;
}): string {
  const { colors } = EMAIL_CONFIG;

  const colorMap = {
    warning: { bg: "#fef3c7", border: colors.warning, text: "#92400e" },
    danger: { bg: "#fef2f2", border: colors.danger, text: "#991b1b" },
    success: { bg: "#ecfdf5", border: colors.success, text: "#065f46" },
    info: { bg: "#eff6ff", border: colors.info, text: "#1e40af" },
  };

  const style = colorMap[options.type];

  return `
    <div style="padding: 15px 20px; background-color: ${style.bg}; border-left: 4px solid ${style.border}; border-radius: 0 8px 8px 0; margin: 20px 0;">
      <p style="margin: 0 0 5px; color: ${style.text}; font-size: 14px; font-weight: 600;">
        ${options.title}
      </p>
      <p style="margin: 0; color: ${style.text}; font-size: 14px;">
        ${options.message}
      </p>
    </div>
  `;
}
