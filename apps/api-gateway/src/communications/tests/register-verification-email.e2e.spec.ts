/**
 * E2E: registration email verification payload (matches AuthService.queueEmailVerification).
 *
 * Sends one real Gmail to verify credentials + outbound deliverability after registration flow changes.
 *
 * Requires (from repo root or apps/api-gateway .env):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   RUN_REGISTER_VERIFICATION_E2E=1  (opt-in so `pnpm test` is not flaky when Gmail errors)
 * Optional: FRONTEND_URL (defaults like auth.service), GMAIL_SENDER_EMAIL
 *
 * Run:
 *   cd apps/api-gateway && RUN_REGISTER_VERIFICATION_E2E=1 pnpm test:e2e:register-verification-email
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { config as loadDotenv } from 'dotenv';
import { GmailService } from '../gmail.service';

const VERIFICATION_TEST_TO = 'aldemirkonuk2204@gmail.com';

/** ConfigModule loads later; prime process.env for describe.skip / CI. */
for (const relative of ['../../../.env', '../../../../../.env']) {
  const envPath = resolve(__dirname, relative);
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

function buildVerificationMailBody(frontendBaseUrl: string, token: string) {
  const verifyUrl = `${frontendBaseUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Verify your WineOps account' as const,
    html:
      `<p>Click to verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>` +
      `<p>This link expires in 24 hours.</p>`,
  };
}

function hasGmailEnv(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN,
  );
}

const gmailEnv = hasGmailEnv();
const optIn = process.env.RUN_REGISTER_VERIFICATION_E2E === '1';
const describeGmail =
  gmailEnv && optIn ? describe : describe.skip;

describeGmail('Register verification email E2E (Gmail)', () => {
  let moduleRef: TestingModule;
  let gmailService: GmailService;
  let configService: ConfigService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // api-gateway cwd: load local .env and monorepo root .env
          envFilePath: ['.env', '.env.local', '../../.env'],
        }),
      ],
      providers: [GmailService],
    }).compile();

    gmailService = moduleRef.get(GmailService);
    configService = moduleRef.get(ConfigService);

    await moduleRef.init();
  }, 45000);

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('should send the same verification email payload used after registration', async () => {
    const frontendBase =
      configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    const fakeToken = `e2e-reg-verif-${Date.now()}`;
    const { subject, html } = buildVerificationMailBody(frontendBase, fakeToken);

    const result = await gmailService.sendEmail({
      to: [VERIFICATION_TEST_TO],
      subject,
      html,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.messageId?.startsWith('mock_')).toBe(false);
    console.log(
      `[register-verification] Sent to ${VERIFICATION_TEST_TO}, messageId=${result.messageId}`,
    );
    console.log(
      `[register-verification] Token in URL is a test dummy (not inserted in DB).`,
    );
  }, 45000);
});
