/**
 * Stripe.js, loaded from Stripe's own host.
 *
 * Moved here from `pages/profile/next` on 2026-09-05 with `StripeCardPanel`,
 * which is its only caller for `loadStripe`. Leaving the loader on `/profile`
 * while the panel it serves is shared would have made `/connections` reach into
 * another page's directory for a script tag.
 *
 * WHY NOT `@stripe/stripe-js` (ADR 0110, option 3.2)
 * --------------------------------------------------
 * That package is itself a loader: it injects this exact script tag, because
 * Stripe's terms require the file be served from their domain and forbid
 * bundling it. So it buys typings and an `<Elements>` React context, not a
 * different network path — and it costs a rewrite of `pnpm-lock.yaml`, which
 * three concurrent builders share in this worktree and which both Vercel entry
 * points install with `--frozen-lockfile`.
 *
 * Measured before choosing: this app ships NO Content-Security-Policy — no
 * `<meta http-equiv>` in `apps/web/index.html`, no CSP header in either
 * `vercel.json`, no `helmet` in the gateway. There is no allow-list to add a
 * host to and nothing to break. If a CSP is ever introduced it must name
 * `https://js.stripe.com` in `script-src` and `frame-src`, plus
 * `https://hooks.stripe.com` in `frame-src` — which would be equally true of
 * the npm package.
 *
 * THE LOADER IS HONEST ABOUT FAILING
 * ----------------------------------
 * A blocked or offline script must not leave the panel sitting on "Loading…"
 * forever. `loadStripe` rejects with a sentence naming the host, and the panel
 * renders that sentence — an ad-blocker or a corporate proxy eating
 * `js.stripe.com` is a real and common cause, and it is the operator's to fix.
 */

const STRIPE_JS_URL = 'https://js.stripe.com/v3';
const SCRIPT_ID = 'mudavym-stripe-js';

/* ── the sliver of Stripe.js this page uses, typed by hand ─────────────── */

export interface StripeElement {
  mount: (target: HTMLElement | string) => void;
  unmount: () => void;
  destroy: () => void;
  on: (event: string, handler: (e: unknown) => void) => void;
}

export interface StripeElements {
  create: (type: string, options?: Record<string, unknown>) => StripeElement;
  getElement: (type: string) => StripeElement | null;
  submit: () => Promise<{ error?: { message?: string } }>;
}

export interface StripeInstance {
  elements: (options: Record<string, unknown>) => StripeElements;
  confirmSetup: (options: {
    elements: StripeElements;
    confirmParams?: Record<string, unknown>;
    redirect?: 'always' | 'if_required';
  }) => Promise<{
    error?: { message?: string; type?: string };
    setupIntent?: { id: string; status: string; payment_method?: string | null };
  }>;
}

type StripeFactory = (
  publishableKey: string,
  options?: Record<string, unknown>,
) => StripeInstance;

declare global {
  interface Window {
    Stripe?: StripeFactory;
  }
}

/** The browser's half of the credential. Absent is a state the page names. */
export function stripePublishableKey(): string | null {
  const raw = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

let pending: Promise<StripeFactory> | null = null;

/** Inject the script once per document, and reuse the promise afterwards. */
function ensureScript(): Promise<StripeFactory> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error('Stripe.js cannot be loaded outside a browser.'),
    );
  }
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (pending) return pending;

  pending = new Promise<StripeFactory>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');

    const settle = () => {
      if (window.Stripe) resolve(window.Stripe);
      else
        reject(
          new Error(
            `${STRIPE_JS_URL} loaded but did not define window.Stripe, so the card form cannot open.`,
          ),
        );
    };

    script.addEventListener('load', settle);
    script.addEventListener('error', () => {
      pending = null;
      reject(
        new Error(
          `${STRIPE_JS_URL} could not be loaded. A content blocker or a network policy on this machine is the usual cause; the card fields are served from Stripe's own domain and cannot be bundled.`,
        ),
      );
    });

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = STRIPE_JS_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return pending;
}

/**
 * The Stripe instance for this deployment's publishable key.
 *
 * Rejects rather than returning null when the key is absent, so a caller
 * cannot accidentally treat "no key" as "not ready yet" and spin.
 */
export async function loadStripe(publishableKey: string): Promise<StripeInstance> {
  const factory = await ensureScript();
  return factory(publishableKey);
}
