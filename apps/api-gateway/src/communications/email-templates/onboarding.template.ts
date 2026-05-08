import { baseTemplate } from './base-template';

interface OnboardingEmailData {
  ownerName: string;
  restaurantName: string;
  restaurantCity: string;
  dashboardUrl: string;
  settingsUrl: string;
  inviteUrl: string;
}

export function onboardingEmailTemplate(data: OnboardingEmailData): string {
  const { ownerName, restaurantName, restaurantCity, dashboardUrl, settingsUrl, inviteUrl } = data;
  const firstName = ownerName.split(' ')[0];

  const content = `
    <h2 style="margin: 0 0 8px; color: #111827; font-size: 22px; font-weight: 700;">
      Welcome to WineOps AI, ${firstName} 🍷
    </h2>
    <p style="margin: 0 0 24px; color: #6b7280; font-size: 15px; line-height: 1.6;">
      <strong>${restaurantName}</strong>${restaurantCity ? ` in ${restaurantCity}` : ''} is now set up.
      Here's everything you need to get the most out of WineOps in your first week.
    </p>

    <!-- Step cards -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">

      <!-- Step 1 -->
      <tr>
        <td style="padding: 16px; background-color: #fdf4ff; border-left: 4px solid #7c2d12; border-radius: 0 8px 8px 0; margin-bottom: 12px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="32" style="vertical-align: top; padding-right: 12px;">
                <div style="width: 28px; height: 28px; background-color: #7c2d12; border-radius: 50%; text-align: center; line-height: 28px; color: #fff; font-size: 13px; font-weight: 700;">1</div>
              </td>
              <td style="vertical-align: top;">
                <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 700;">Verify your email</p>
                <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">Check your inbox for the verification link we just sent. You'll need to verify before the dashboard unlocks.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr><td style="height: 8px;"></td></tr>

      <!-- Step 2 -->
      <tr>
        <td style="padding: 16px; background-color: #f0fdf4; border-left: 4px solid #10b981; border-radius: 0 8px 8px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="32" style="vertical-align: top; padding-right: 12px;">
                <div style="width: 28px; height: 28px; background-color: #10b981; border-radius: 50%; text-align: center; line-height: 28px; color: #fff; font-size: 13px; font-weight: 700;">2</div>
              </td>
              <td style="vertical-align: top;">
                <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 700;">Connect your wine inventory</p>
                <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">Add your bottles manually or sync with Toast POS. Your AI sommelier starts learning from your stock data immediately.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr><td style="height: 8px;"></td></tr>

      <!-- Step 3 -->
      <tr>
        <td style="padding: 16px; background-color: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="32" style="vertical-align: top; padding-right: 12px;">
                <div style="width: 28px; height: 28px; background-color: #3b82f6; border-radius: 50%; text-align: center; line-height: 28px; color: #fff; font-size: 13px; font-weight: 700;">3</div>
              </td>
              <td style="vertical-align: top;">
                <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 700;">Add your wine vendors</p>
                <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">WineOps AI negotiates with suppliers automatically once you add them. Add at least one vendor to unlock automated procurement.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr><td style="height: 8px;"></td></tr>

      <!-- Step 4 -->
      <tr>
        <td style="padding: 16px; background-color: #fff7ed; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td width="32" style="vertical-align: top; padding-right: 12px;">
                <div style="width: 28px; height: 28px; background-color: #f59e0b; border-radius: 50%; text-align: center; line-height: 28px; color: #fff; font-size: 13px; font-weight: 700;">4</div>
              </td>
              <td style="vertical-align: top;">
                <p style="margin: 0 0 4px; color: #111827; font-size: 14px; font-weight: 700;">Invite your team</p>
                <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">Managers and sommeliers each get their own login. Go to <a href="${settingsUrl}" style="color: #7c2d12; font-weight: 600;">Settings → Team</a> to generate invite links.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>

    <!-- Quick links row -->
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 24px;">
      <tr>
        <td width="50%" style="padding-right: 6px;">
          <a href="${dashboardUrl}" style="display: block; padding: 12px; background-color: #7c2d12; color: #fff; text-align: center; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Open Dashboard
          </a>
        </td>
        <td width="50%" style="padding-left: 6px;">
          <a href="${inviteUrl}" style="display: block; padding: 12px; background-color: #f3f4f6; color: #374151; text-align: center; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Invite a Team Member
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.6; border-top: 1px solid #f3f4f6; padding-top: 20px;">
      Questions? Reply to this email or visit our help centre. We typically respond within 2 hours.
      <br>— The WineOps AI team
    </p>
  `;

  return baseTemplate({
    title: `Welcome to WineOps AI — ${restaurantName}`,
    preheader: `Your restaurant is set up. Here's what to do next.`,
    content,
    showFooter: true,
  });
}
