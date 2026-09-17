import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

/**
 * Measured on Railway 2026-09-17 (SEO/GEO session): `FRONTEND_URL` on
 * api-gateway is the CORS allow-list —
 * "https://mudavym.com,https://www.mudavym.com,https://restaurant-ai-automation-web.vercel.app"
 * — not a single URL. Four AuthService call sites interpolated the whole
 * string into a user-facing link (onboarding email, verify-email, invite,
 * password reset), so those emails carried an unresolvable, comma-joined URL.
 *
 * Every case below sets FRONTEND_URL to that exact production value and
 * asserts the emitted link begins with the one canonical origin.
 */

const FRONTEND_URL_CORS_LIST =
  "https://mudavym.com,https://www.mudavym.com,https://restaurant-ai-automation-web.vercel.app";

function configWithCorsListFrontendUrl() {
  return { get: (key: string) => (key === "FRONTEND_URL" ? FRONTEND_URL_CORS_LIST : undefined) } as any;
}

describe("AuthService link-building call sites — FRONTEND_URL is a CORS list, not a URL", () => {
  describe("registerRestaurant — onboarding email frontendBaseUrl", () => {
    function makeService() {
      const chain = (result: any): any => {
        const c: any = {
          select: () => c,
          update: () => c,
          insert: () => c,
          delete: () => c,
          eq: () => c,
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => result,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return c;
      };

      const supabase = {
        from: (table: string) => {
          if (table === "organizations")
            return chain({ data: { id: "org-1" }, error: null });
          if (table === "restaurants")
            return chain({ data: { id: "rest-1" }, error: null });
          if (table === "users")
            return chain({
              data: { user_id: "user-1", email: "o@x.com", role: "owner" },
              error: null,
            });
          return chain({ data: null, error: null });
        },
      };

      const sendOnboardingEmail = jest.fn().mockResolvedValue(undefined);

      const svc = new AuthService(
        { sign: () => "tok", signAsync: async () => "tok" } as any,
        configWithCorsListFrontendUrl(),
        { supabase } as any,
        { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
        { sendOnboardingEmail } as any,
      );

      (svc as any).generateTokens = jest
        .fn()
        .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
      (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);

      return { svc, sendOnboardingEmail };
    }

    const BASE: RegisterRestaurantDto = {
      name: "Aldemir",
      email: "o@x.com",
      password: "a-long-enough-password",
      restaurantName: "Sim Meyhouse",
      address: "3130 Alpine Rd",
      city: "Portola Valley",
      country: "United States",
    };

    it("sends the onboarding email with a single canonical origin, not the CORS list", async () => {
      const { svc, sendOnboardingEmail } = makeService();

      await svc.registerRestaurant({ ...BASE });

      expect(sendOnboardingEmail).toHaveBeenCalledTimes(1);
      const { frontendBaseUrl } = sendOnboardingEmail.mock.calls[0][0];
      expect(frontendBaseUrl).toBe("https://mudavym.com");
    });
  });

  describe("queueEmailVerification — verify-email link", () => {
    function makeService(gmailOverrides: Partial<any> = {}) {
      const emailVerificationsChain: any = {
        insert: () => emailVerificationsChain,
        select: () => emailVerificationsChain,
        single: jest
          .fn()
          .mockResolvedValue({ data: { token: "verify-tok-1" }, error: null }),
      };
      const supabase = {
        from: (table: string) => {
          if (table === "email_verifications") return emailVerificationsChain;
          return emailVerificationsChain;
        },
      };

      const gmail = {
        sendEmail: jest
          .fn()
          .mockResolvedValue({ success: true, messageId: "m1" }),
        ...gmailOverrides,
      };

      const svc = new AuthService(
        { sign: () => "tok" } as any,
        configWithCorsListFrontendUrl(),
        { supabase } as any,
        { isBlacklisted: async () => false } as any,
        gmail as any,
      );

      return { svc, gmail };
    }

    it("builds the verify-email link off a single canonical origin", async () => {
      const { svc, gmail } = makeService();

      await (svc as any).queueEmailVerification("user-1", "ada@x.com");

      expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
      const html = gmail.sendEmail.mock.calls[0][0].html as string;
      expect(html).toContain(
        "https://mudavym.com/verify-email?token=verify-tok-1",
      );
      expect(html).not.toContain("restaurant-ai-automation-web.vercel.app");
    });
  });

  describe("generateInvite — inviteUrl", () => {
    function makeService() {
      const chain = (result: any): any => {
        const c: any = {
          select: () => c,
          update: () => c,
          insert: () => c,
          eq: () => c,
          maybeSingle: async () => result,
          single: async () => result,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve),
        };
        return c;
      };

      const supabase = {
        from: (table: string) => {
          if (table === "user_restaurant_access")
            return chain({ data: { role: "owner" }, error: null });
          if (table === "restaurants")
            return chain({
              data: { organization_id: "org-1" },
              error: null,
            });
          if (table === "organization_invites")
            return {
              ...chain({ data: null, error: null }),
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                single: async () => ({
                  data: {
                    id: "invite-1",
                    code: "ABCD2345",
                    expires_at: "2026-10-01T00:00:00Z",
                  },
                  error: null,
                }),
              }),
              insert: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      id: "invite-1",
                      code: "ABCD2345",
                      expires_at: "2026-10-01T00:00:00Z",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          if (table === "user_onboarding_progress")
            return chain({ data: null, error: null });
          return chain({ data: null, error: null });
        },
      };

      const svc = new AuthService(
        { sign: () => "tok" } as any,
        configWithCorsListFrontendUrl(),
        { supabase } as any,
        { isBlacklisted: async () => false } as any,
        { sendEmail: jest.fn() } as any,
      );

      (svc as any).ensureTeamMemberForInvite = jest
        .fn()
        .mockResolvedValue(undefined);

      return { svc };
    }

    it("builds the invite link off a single canonical origin", async () => {
      const { svc } = makeService();

      const result: any = await svc.generateInvite("user-1", "rest-1", {
        role: "manager",
      } as any);

      expect(result.inviteUrl).toBe("https://mudavym.com/invite/ABCD2345");
    });
  });

  describe("requestPasswordReset — resetUrl", () => {
    function makeService() {
      const usersChain: any = {
        select: () => usersChain,
        eq: () => usersChain,
        maybeSingle: jest.fn().mockResolvedValue({
          data: { user_id: "u1", name: "Ada Lovelace", email: "ada@x.com" },
          error: null,
        }),
      };
      const resetsSelectChain: any = {
        select: () => resetsSelectChain,
        eq: () => resetsSelectChain,
        is: () => resetsSelectChain,
        order: () => resetsSelectChain,
        limit: () => resetsSelectChain,
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      const resetsInsertChain: any = {
        insert: () => resetsInsertChain,
        select: () => resetsInsertChain,
        single: jest
          .fn()
          .mockResolvedValue({ data: { token: "reset-tok-1" }, error: null }),
      };

      const from = jest.fn((table: string) => {
        if (table === "users") return usersChain;
        if (table === "password_resets") {
          return {
            select: resetsSelectChain.select,
            insert: resetsInsertChain.insert,
          };
        }
        return usersChain;
      });

      const gmail = {
        sendEmail: jest
          .fn()
          .mockResolvedValue({ success: true, messageId: "m1" }),
      };

      const svc = new AuthService(
        { sign: () => "tok" } as any,
        configWithCorsListFrontendUrl(),
        { supabase: { from } } as any,
        { isBlacklisted: async () => false } as any,
        gmail as any,
      );

      return { svc, gmail };
    }

    it("builds the reset-password link off a single canonical origin", async () => {
      const { svc, gmail } = makeService();

      await svc.requestPasswordReset("ada@x.com", "1.2.3.4");

      expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
      const html = gmail.sendEmail.mock.calls[0][0].html as string;
      expect(html).toContain(
        "https://mudavym.com/reset-password?token=reset-tok-1",
      );
      expect(html).not.toContain("restaurant-ai-automation-web.vercel.app");
    });
  });
});
